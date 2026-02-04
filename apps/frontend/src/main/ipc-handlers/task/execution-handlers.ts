import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, TaskStartOptions, TaskStatus, ImageAttachment } from '../../../shared/types';
import path from 'path';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import { spawnSync, execFileSync } from 'child_process';
import { getToolPath } from '../../cli-tool-manager';
import { AgentManager } from '../../agent';
import { fileWatcher } from '../../file-watcher';
import { findTaskAndProject } from './shared';
import { checkGitStatus } from '../../project-initializer';
import { initializeClaudeProfileManager, type ClaudeProfileManager } from '../../claude-profile-manager';
import {
  getPlanPath,
  persistPlanStatus,
  createPlanIfNotExists
} from './plan-file-utils';
import { findTaskWorktree } from '../../worktree-paths';
import { projectStore } from '../../project-store';
import { getIsolatedGitEnv } from '../../utils/git-isolation';
import { TerminalManager } from '../../terminal/terminal-manager';
import { v4 as uuidv4 } from 'uuid';

/**
 * Atomic file write to prevent TOCTOU race conditions.
 * Writes to a temporary file first, then atomically renames to target.
 * This ensures the target file is never in an inconsistent state.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Safe file read that handles missing files without TOCTOU issues.
 * Returns null if file doesn't exist or can't be read.
 */
function safeReadFileSync(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    // ENOENT (file not found) is expected, other errors should be logged
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[safeReadFileSync] Error reading ${filePath}:`, error);
    }
    return null;
  }
}

/**
 * Helper function to check subtask completion status
 */
function checkSubtasksCompletion(plan: Record<string, unknown> | null): {
  allSubtasks: Array<{ status: string }>;
  completedCount: number;
  totalCount: number;
  allCompleted: boolean;
} {
  const allSubtasks = (plan?.phases as Array<{ subtasks?: Array<{ status: string }> }> | undefined)?.flatMap(phase =>
    phase.subtasks || []
  ) || [];
  const completedCount = allSubtasks.filter(s => s.status === 'completed').length;
  const totalCount = allSubtasks.length;
  const allCompleted = totalCount > 0 && completedCount === totalCount;

  return { allSubtasks, completedCount, totalCount, allCompleted };
}

/**
 * Helper function to ensure profile manager is initialized.
 * Returns a discriminated union for type-safe error handling.
 *
 * @returns Success with profile manager, or failure with error message
 */
async function ensureProfileManagerInitialized(): Promise<
  | { success: true; profileManager: ClaudeProfileManager }
  | { success: false; error: string }
> {
  try {
    const profileManager = await initializeClaudeProfileManager();
    return { success: true, profileManager };
  } catch (error) {
    console.error('[ensureProfileManagerInitialized] Failed to initialize:', error);
    // Include actual error details for debugging while providing actionable guidance
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to initialize profile manager. Please check file permissions and disk space. (${errorMessage})`
    };
  }
}

/**
 * Register task execution handlers (start, stop, review, status management, recovery)
 */
export function registerTaskExecutionHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
  terminalManager: TerminalManager
): void {
  /**
   * Start a task
   */
  ipcMain.on(
    IPC_CHANNELS.TASK_START,
    async (_, taskId: string, options?: TaskStartOptions) => {
      console.warn('[TASK_START] Received request for taskId:', taskId);
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        console.warn('[TASK_START] No main window found');
        return;
      }

      // Ensure profile manager is initialized before checking auth
      // This prevents race condition where auth check runs before profile data loads from disk
      const initResult = await ensureProfileManagerInitialized();
      if (!initResult.success) {
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_ERROR,
          taskId,
          initResult.error
        );
        return;
      }
      const profileManager = initResult.profileManager;

      // Find task and project
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        console.warn('[TASK_START] Task or project not found for taskId:', taskId);
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_ERROR,
          taskId,
          'Task or project not found'
        );
        return;
      }

      // Check git status - Auto Claude requires git for worktree-based builds
      const gitStatus = checkGitStatus(project.path);
      if (!gitStatus.isGitRepo) {
        console.warn('[TASK_START] Project is not a git repository:', project.path);
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_ERROR,
          taskId,
          'Git repository required. Please run "git init" in your project directory. Auto Claude uses git worktrees for isolated builds.'
        );
        return;
      }
      if (!gitStatus.hasCommits) {
        console.warn('[TASK_START] Git repository has no commits:', project.path);
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_ERROR,
          taskId,
          'Git repository has no commits. Please make an initial commit first (git add . && git commit -m "Initial commit").'
        );
        return;
      }

      // Check authentication - Claude requires valid auth to run tasks
      if (!profileManager.hasValidAuth()) {
        console.warn('[TASK_START] No valid authentication for active profile');
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_ERROR,
          taskId,
          'Claude authentication required. Please go to Settings > Claude Profiles and authenticate your account, or set an OAuth token.'
        );
        return;
      }

      console.warn('[TASK_START] Found task:', task.specId, 'status:', task.status, 'subtasks:', task.subtasks.length);

      // Start file watcher for this task
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(
        project.path,
        specsBaseDir,
        task.specId
      );
      fileWatcher.watch(taskId, specDir);

      // Create task monitor terminal for live output viewing
      const terminalId = `task-${taskId}`;
      console.warn('[TASK_START] Creating task monitor terminal:', terminalId);

      // First notify renderer to add terminal to store
      mainWindow.webContents.send(
        IPC_CHANNELS.TASK_MONITOR_TERMINAL_CREATE,
        {
          id: terminalId,
          title: task.title,
          projectPath: project.path,
          taskId,
          specId: task.specId,
          isTaskMonitor: true,
          taskStatus: 'running',
        }
      );

      // Then create the virtual terminal in main process (for output streaming)
      const terminalResult = await terminalManager.create({
        id: terminalId,
        cwd: project.path,
        projectPath: project.path,
        isTaskMonitor: true,
        taskId,
        specId: task.specId,
        taskTitle: task.title,
      });

      if (!terminalResult.success) {
        console.error('[TASK_START] Failed to create task monitor terminal:', terminalResult.error);
      }

      // Check if spec.md exists (indicates spec creation was already done or in progress)
      const specFilePath = path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE);
      const hasSpec = existsSync(specFilePath);

      // Check if this task needs spec creation first (no spec file = not yet created)
      // OR if it has a spec but no implementation plan subtasks (spec created, needs planning/building)
      const needsSpecCreation = !hasSpec;
      const needsImplementation = hasSpec && task.subtasks.length === 0;

      console.warn('[TASK_START] hasSpec:', hasSpec, 'needsSpecCreation:', needsSpecCreation, 'needsImplementation:', needsImplementation);

      // Get base branch: task-level override takes precedence over project settings
      const baseBranch = task.metadata?.baseBranch || project.settings?.mainBranch;

      if (needsSpecCreation) {
        // No spec file - need to run spec_runner.py to create the spec
        const taskDescription = task.description || task.title;
        console.warn('[TASK_START] Starting spec creation for:', task.specId, 'in:', specDir, 'baseBranch:', baseBranch);

        // Start spec creation process - pass the existing spec directory
        // so spec_runner uses it instead of creating a new one
        // Also pass baseBranch so worktrees are created from the correct branch
        agentManager.startSpecCreation(task.specId, project.path, taskDescription, specDir, task.metadata, baseBranch);
      } else if (needsImplementation) {
        // Spec exists but no subtasks - run run.py to create implementation plan and execute
        // Read the spec.md to get the task description
        const _taskDescription = task.description || task.title;
        try {
          readFileSync(specFilePath, 'utf-8');
        } catch {
          // Use default description
        }

        console.warn('[TASK_START] Starting task execution (no subtasks) for:', task.specId);
        // Start task execution which will create the implementation plan
        // Note: No parallel mode for planning phase - parallel only makes sense with multiple subtasks
        agentManager.startTaskExecution(
          taskId,
          project.path,
          task.specId,
          {
            parallel: false,  // Sequential for planning phase
            workers: 1,
            baseBranch,
            useWorktree: task.metadata?.useWorktree
          }
        );
      } else {
        // Task has subtasks, start normal execution
        // Note: Parallel execution is handled internally by the agent, not via CLI flags
        console.warn('[TASK_START] Starting task execution (has subtasks) for:', task.specId);

        agentManager.startTaskExecution(
          taskId,
          project.path,
          task.specId,
          {
            parallel: false,
            workers: 1,
            baseBranch,
            useWorktree: task.metadata?.useWorktree
          }
        );
      }

      // Send any pending messages that were queued before the task started
      // These are messages the user typed in the chat before starting the task
      if (options?.pendingMessages && options.pendingMessages.length > 0) {
        console.log(`[TASK_START] Delivering ${options.pendingMessages.length} pending message(s) to task ${taskId}`);
        // Give the process time to initialize and set up the message queue
        setTimeout(() => {
          for (const message of options.pendingMessages!) {
            const sent = agentManager.sendMessageToTask(taskId, message);
            if (sent) {
              console.log(`[TASK_START] Delivered pending message to task ${taskId} (${message.length} chars)`);
            } else {
              console.warn(`[TASK_START] Failed to deliver pending message to task ${taskId}`);
            }
          }
        }, 2000); // 2 second delay to allow Python process to initialize message queue
      }

      // Notify status change IMMEDIATELY (don't wait for file write)
      // This provides instant UI feedback while file persistence happens in background
      const ipcSentAt = Date.now();
      mainWindow.webContents.send(
        IPC_CHANNELS.TASK_STATUS_CHANGE,
        taskId,
        'coding'
      );

      const DEBUG = process.env.DEBUG === 'true';
      if (DEBUG) {
        console.log(`[TASK_START] IPC sent immediately for task ${taskId}, deferring file persistence`);
      }

      // CRITICAL: Persist status to implementation_plan.json to prevent status flip-flop
      // When getTasks() is called (on refresh), it reads status from the plan file.
      // Without persisting here, the old status (e.g., 'human_review') would override
      // the in-memory 'coding' status, causing the task to flip back and forth.
      // Uses shared utility for consistency with agent-events-handlers.ts
      // NOTE: This is now async and non-blocking for better UI responsiveness
      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
      setImmediate(async () => {
        const persistStart = Date.now();
        try {
          const persisted = await persistPlanStatus(planPath, 'coding', project.id);
          if (persisted) {
            console.warn('[TASK_START] Updated plan status to: coding');
          }
          if (DEBUG) {
            const delay = persistStart - ipcSentAt;
            const duration = Date.now() - persistStart;
            console.log(`[TASK_START] File persistence: delayed ${delay}ms after IPC, completed in ${duration}ms`);
          }
        } catch (err) {
          console.error('[TASK_START] Failed to persist plan status:', err);
        }
      });
      // Note: Plan file may not exist yet for new tasks - that's fine (persistPlanStatus handles ENOENT)
    }
  );

  /**
   * Stop a task
   */
  ipcMain.on(IPC_CHANNELS.TASK_STOP, (_, taskId: string) => {
    const DEBUG = process.env.DEBUG === 'true';

    agentManager.killTask(taskId);
    fileWatcher.unwatch(taskId);

    // Notify that agent was stopped IMMEDIATELY for instant UI feedback
    // We use TASK_AGENT_STOPPED instead of TASK_STATUS_CHANGE because status doesn't change
    // (task stays in 'planning' or 'coding' but agent process is now stopped)
    const ipcSentAt = Date.now();
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(
        IPC_CHANNELS.TASK_AGENT_STOPPED,
        taskId
      );
    }

    if (DEBUG) {
      console.log(`[TASK_STOP] IPC sent immediately for task ${taskId}, deferring file persistence`);
    }

    // Find task and project to update the plan file (async, non-blocking)
    const { task, project } = findTaskAndProject(taskId);

    if (task && project) {
      // Persist status to implementation_plan.json to prevent status flip-flop on refresh
      // Uses shared utility for consistency with agent-events-handlers.ts
      // NOTE: This is now async and non-blocking for better UI responsiveness
      const planPath = getPlanPath(project, task);
      setImmediate(async () => {
        const persistStart = Date.now();
        try {
          const persisted = await persistPlanStatus(planPath, 'planning', project.id);
          if (persisted) {
            console.warn('[TASK_STOP] Updated plan status to planning');
          }
          if (DEBUG) {
            const delay = persistStart - ipcSentAt;
            const duration = Date.now() - persistStart;
            console.log(`[TASK_STOP] File persistence: delayed ${delay}ms after IPC, completed in ${duration}ms`);
          }
        } catch (err) {
          console.error('[TASK_STOP] Failed to persist plan status:', err);
        }
      });
      // Note: File not found is expected for tasks without a plan file (persistPlanStatus handles ENOENT)
    }
  });

  /**
   * Start Build: Phase 4 - Transition from planning → coding
   *
   * FIX-9: This is the ONLY path that starts the coding agent. It represents an
   * explicit user action (clicking "Start Build" button). Kanban drag operations
   * use TASK_UPDATE_STATUS which only changes status, not start agents.
   *
   * This is called when the user clicks "Start Build" after the planning agent
   * has created spec.md and implementation_plan.json. It:
   * 1. Validates that spec.md and implementation_plan.json exist
   * 2. Stops the planning agent gracefully (memory already saved)
   * 3. Starts the coding agent
   * 4. Updates status to 'coding'
   *
   * User-Initiated Gate: This handler is the user action gate between planning
   * and coding phases. The agent will NOT start automatically - user must
   * explicitly click "Start Build" to transition.
   *
   * Memory handoff: The coding agent reads the same /memories directory that
   * the planning agent wrote to, ensuring full context continuity.
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_START_BUILD,
    async (_, taskId: string): Promise<IPCResult> => {
      console.log('[TASK_START_BUILD] Transitioning task to coding:', taskId);

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return { success: false, error: 'No main window found' };
      }

      // Find task and project
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: false, error: 'Task or project not found' };
      }

      // Get spec directory
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(project.path, specsBaseDir, task.specId);

      // Validate that plan exists
      const specFilePath = path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE);
      const planFilePath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

      if (!existsSync(specFilePath)) {
        return {
          success: false,
          error: 'Cannot start build: spec.md has not been created yet. Continue planning first.'
        };
      }

      if (!existsSync(planFilePath)) {
        return {
          success: false,
          error: 'Cannot start build: implementation_plan.json has not been created yet. Continue planning first.'
        };
      }

      // Stop the planning agent if it's running
      if (agentManager.isRunning(taskId)) {
        console.log('[TASK_START_BUILD] Stopping planning agent...');
        agentManager.killTask(taskId);
        // Give it a moment to clean up
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Check authentication
      const initResult = await ensureProfileManagerInitialized();
      if (!initResult.success) {
        return { success: false, error: initResult.error };
      }
      const profileManager = initResult.profileManager;
      if (!profileManager.hasValidAuth()) {
        return {
          success: false,
          error: 'Claude authentication required. Please go to Settings > Claude Profiles and authenticate your account.'
        };
      }

      // Check git status
      const gitStatus = checkGitStatus(project.path);
      if (!gitStatus.isGitRepo || !gitStatus.hasCommits) {
        return {
          success: false,
          error: gitStatus.error || 'Git repository with commits required.'
        };
      }

      // Start file watcher for this task
      fileWatcher.watch(taskId, specDir);

      // Get base branch
      const baseBranch = task.metadata?.baseBranch || project.settings?.mainBranch;

      // Start the coding agent (task execution)
      console.log('[TASK_START_BUILD] Starting coding agent for:', task.specId);
      agentManager.startTaskExecution(
        taskId,
        project.path,
        task.specId,
        {
          parallel: false,
          workers: 1,
          baseBranch,
          useWorktree: task.metadata?.useWorktree
        }
      );

      // Update status to coding
      mainWindow.webContents.send(
        IPC_CHANNELS.TASK_STATUS_CHANGE,
        taskId,
        'coding'
      );

      // Persist status change
      const planPath = getPlanPath(project, task);
      setImmediate(async () => {
        try {
          await persistPlanStatus(planPath, 'coding', project.id);
          console.log('[TASK_START_BUILD] Updated plan status to: coding');
        } catch (err) {
          console.error('[TASK_START_BUILD] Failed to persist plan status:', err);
        }
      });

      return { success: true };
    }
  );

  /**
   * Review a task (approve or reject)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_REVIEW,
    async (
      _,
      taskId: string,
      approved: boolean,
      feedback?: string,
      images?: ImageAttachment[]
    ): Promise<IPCResult> => {
      // Find task and project
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      // Check if dev mode is enabled for this project
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(
        project.path,
        specsBaseDir,
        task.specId
      );

      // Check if worktree exists - QA needs to run in the worktree where the build happened
      const worktreePath = findTaskWorktree(project.path, task.specId);
      const worktreeSpecDir = worktreePath ? path.join(worktreePath, specsBaseDir, task.specId) : null;
      const hasWorktree = worktreePath !== null;

      if (approved) {
        // Write approval to QA report
        const qaReportPath = path.join(specDir, AUTO_BUILD_PATHS.QA_REPORT);
        try {
          writeFileSync(
            qaReportPath,
            `# QA Review\n\nStatus: APPROVED\n\nReviewed at: ${new Date().toISOString()}\n`
          );
        } catch (error) {
          console.error('[TASK_REVIEW] Failed to write QA report:', error);
          return { success: false, error: 'Failed to write QA report file' };
        }

        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(
            IPC_CHANNELS.TASK_STATUS_CHANGE,
            taskId,
            'done'
          );
        }
      } else {
        // Reset and discard all changes from worktree merge in main
        // The worktree still has all changes, so nothing is lost
        if (hasWorktree) {
          // Step 1: Unstage all changes
          const resetResult = spawnSync(getToolPath('git'), ['reset', 'HEAD'], {
            cwd: project.path,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
          if (resetResult.status === 0) {
            console.log('[TASK_REVIEW] Unstaged changes in main');
          }

          // Step 2: Discard all working tree changes (restore to pre-merge state)
          const checkoutResult = spawnSync(getToolPath('git'), ['checkout', '--', '.'], {
            cwd: project.path,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
          if (checkoutResult.status === 0) {
            console.log('[TASK_REVIEW] Discarded working tree changes in main');
          }

          // Step 3: Clean untracked files that came from the merge
          // IMPORTANT: Exclude .auto-claude directory to preserve specs and worktree data
          const cleanResult = spawnSync(getToolPath('git'), ['clean', '-fd', '-e', '.auto-claude'], {
            cwd: project.path,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: getIsolatedGitEnv()
          });
          if (cleanResult.status === 0) {
            console.log('[TASK_REVIEW] Cleaned untracked files in main (excluding .auto-claude)');
          }

          console.log('[TASK_REVIEW] Main branch restored to pre-merge state');
        }

        // Write feedback for QA fixer - write to WORKTREE spec dir if it exists
        // The QA process runs in the worktree where the build and implementation_plan.json are
        const targetSpecDir = hasWorktree && worktreeSpecDir ? worktreeSpecDir : specDir;
        const fixRequestPath = path.join(targetSpecDir, 'QA_FIX_REQUEST.md');

        console.warn('[TASK_REVIEW] Writing QA fix request to:', fixRequestPath);
        console.warn('[TASK_REVIEW] hasWorktree:', hasWorktree, 'worktreePath:', worktreePath);

        // Process images if provided
        let imageReferences = '';
        if (images && images.length > 0) {
          const imagesDir = path.join(targetSpecDir, 'feedback_images');
          try {
            if (!existsSync(imagesDir)) {
              mkdirSync(imagesDir, { recursive: true });
            }
            const savedImages: string[] = [];
            for (const image of images) {
              try {
                if (!image.data) {
                  console.warn('[TASK_REVIEW] Skipping image with no data:', image.filename);
                  continue;
                }
                // Server-side MIME type validation (defense in depth - frontend also validates)
                // Reject missing mimeType to prevent bypass attacks
                const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
                if (!image.mimeType || !ALLOWED_MIME_TYPES.includes(image.mimeType)) {
                  console.warn('[TASK_REVIEW] Skipping image with missing or disallowed MIME type:', image.mimeType);
                  continue;
                }
                // Sanitize filename to prevent path traversal attacks
                const sanitizedFilename = path.basename(image.filename);
                if (!sanitizedFilename || sanitizedFilename === '.' || sanitizedFilename === '..') {
                  console.warn('[TASK_REVIEW] Skipping image with invalid filename:', image.filename);
                  continue;
                }
                // Remove data URL prefix if present (e.g., "data:image/png;base64," or "data:image/svg+xml;base64,")
                const base64Data = image.data.replace(/^data:image\/[^;]+;base64,/, '');
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const imagePath = path.join(imagesDir, sanitizedFilename);
                // Verify the resolved path is within the images directory (defense in depth)
                const resolvedPath = path.resolve(imagePath);
                const resolvedImagesDir = path.resolve(imagesDir);
                if (!resolvedPath.startsWith(resolvedImagesDir + path.sep)) {
                  console.warn('[TASK_REVIEW] Skipping image with path outside target directory:', image.filename);
                  continue;
                }
                writeFileSync(imagePath, imageBuffer);
                savedImages.push(`feedback_images/${sanitizedFilename}`);
                console.log('[TASK_REVIEW] Saved image:', sanitizedFilename);
              } catch (imgError) {
                console.error('[TASK_REVIEW] Failed to save image:', image.filename, imgError);
              }
            }
            if (savedImages.length > 0) {
              imageReferences = '\n\n## Reference Images\n\n' +
                savedImages.map(imgPath => `![Feedback Image](${imgPath})`).join('\n\n');
            }
          } catch (dirError) {
            console.error('[TASK_REVIEW] Failed to create images directory:', dirError);
          }
        }

        try {
          writeFileSync(
            fixRequestPath,
            `# QA Fix Request\n\nStatus: REJECTED\n\n## Feedback\n\n${feedback || 'No feedback provided'}${imageReferences}\n\nCreated at: ${new Date().toISOString()}\n`
          );
        } catch (error) {
          console.error('[TASK_REVIEW] Failed to write QA fix request:', error);
          return { success: false, error: 'Failed to write QA fix request file' };
        }

        // Restart QA process - use worktree path if it exists, otherwise main project
        // The QA process needs to run where the implementation_plan.json with completed subtasks is
        const qaProjectPath = hasWorktree ? worktreePath : project.path;
        console.warn('[TASK_REVIEW] Starting QA process with projectPath:', qaProjectPath);
        agentManager.startQAProcess(taskId, qaProjectPath, task.specId);

        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(
            IPC_CHANNELS.TASK_STATUS_CHANGE,
            taskId,
            'coding'
          );
        }
      }

      return { success: true };
    }
  );

  /**
   * Update task status manually (used by Kanban drag-and-drop)
   *
   * FIX-8/FIX-9: This handler ONLY changes the task status. It does NOT start
   * any agents. This is intentional - status changes via Kanban drag should not
   * auto-start agents. Users must use TASK_START_BUILD (via "Start Build" button)
   * to explicitly start the coding agent.
   *
   * This separation ensures:
   * 1. Kanban drag = status change only (for organization)
   * 2. Start Build button = status change + agent start (explicit user action)
   *
   * Options:
   * - forceCleanup: When setting to 'done' with a worktree present, delete the worktree first
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_UPDATE_STATUS,
    async (
      _,
      taskId: string,
      status: TaskStatus,
      options?: { forceCleanup?: boolean }
    ): Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }> => {
      // Find task and project first (needed for worktree check)
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      // Validate status transition - 'done' can only be set through merge handler
      // UNLESS there's no worktree (limbo state - already merged/discarded or failed)
      // OR forceCleanup is requested (user confirmed they want to delete the worktree)
      if (status === 'done') {
        // Check if worktree exists (task.specId matches worktree folder name)
        const worktreePath = findTaskWorktree(project.path, task.specId);
        const hasWorktree = worktreePath !== null;

        if (hasWorktree) {
          if (options?.forceCleanup) {
            // User confirmed cleanup - delete worktree and branch
            console.warn(`[TASK_UPDATE_STATUS] Cleaning up worktree for task ${taskId} (user confirmed)`);
            try {
              // Get the branch name before removing the worktree
              let branch = '';
              let usingFallbackBranch = false;
              try {
                branch = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
                  cwd: worktreePath,
                  encoding: 'utf-8',
                  timeout: 30000,
                  env: getIsolatedGitEnv()
                }).trim();
              } catch (branchError) {
                // If we can't get branch name, use the default pattern
                branch = `auto-claude/${task.specId}`;
                usingFallbackBranch = true;
                console.warn(`[TASK_UPDATE_STATUS] Could not get branch name, using fallback pattern: ${branch}`, branchError);
              }

              // Remove the worktree
              execFileSync(getToolPath('git'), ['worktree', 'remove', '--force', worktreePath], {
                cwd: project.path,
                encoding: 'utf-8',
                timeout: 30000,
                env: getIsolatedGitEnv()
              });
              console.warn(`[TASK_UPDATE_STATUS] Worktree removed: ${worktreePath}`);

              // Delete the branch (ignore errors if branch doesn't exist)
              try {
                execFileSync(getToolPath('git'), ['branch', '-D', branch], {
                  cwd: project.path,
                  encoding: 'utf-8',
                  timeout: 30000,
                  env: getIsolatedGitEnv()
                });
                console.warn(`[TASK_UPDATE_STATUS] Branch deleted: ${branch}`);
              } catch (branchDeleteError) {
                // Branch may not exist or may be the current branch
                if (usingFallbackBranch) {
                  // More concerning - fallback pattern didn't match actual branch
                  console.warn(`[TASK_UPDATE_STATUS] Could not delete branch ${branch} using fallback pattern. Actual branch may still exist and need manual cleanup.`, branchDeleteError);
                } else {
                  console.warn(`[TASK_UPDATE_STATUS] Could not delete branch ${branch} (may not exist or be checked out elsewhere)`);
                }
              }

              console.warn(`[TASK_UPDATE_STATUS] Worktree cleanup completed successfully`);
            } catch (cleanupError) {
              console.error(`[TASK_UPDATE_STATUS] Failed to cleanup worktree:`, cleanupError);
              return {
                success: false,
                error: `Failed to cleanup worktree: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
              };
            }
          } else {
            // Worktree exists but no forceCleanup - return special response for UI to show confirmation
            console.warn(`[TASK_UPDATE_STATUS] Worktree exists for task ${taskId}. Requesting user confirmation.`);
            return {
              success: false,
              worktreeExists: true,
              worktreePath: worktreePath,
              error: "A worktree still exists for this task. Would you like to delete it and mark the task as complete?"
            };
          }
        } else {
          // No worktree - allow marking as done (limbo state recovery)
          console.warn(`[TASK_UPDATE_STATUS] Allowing status 'done' for task ${taskId} (no worktree found - limbo state)`);
        }
      }

      // Validate status transition - 'human_review' requires actual work to have been done
      // This prevents tasks from being incorrectly marked as ready for review when execution failed
      if (status === 'human_review') {
        const specsBaseDirForValidation = getSpecsDir(project.autoBuildPath);
        const specDirForValidation = path.join(
          project.path,
          specsBaseDirForValidation,
          task.specId
        );
        const specFilePath = path.join(specDirForValidation, AUTO_BUILD_PATHS.SPEC_FILE);

        // Check if spec.md exists and has meaningful content (at least 100 chars)
        const MIN_SPEC_CONTENT_LENGTH = 100;
        let specContent = '';
        try {
          if (existsSync(specFilePath)) {
            specContent = readFileSync(specFilePath, 'utf-8');
          }
        } catch {
          // Ignore read errors - treat as empty spec
        }

        if (!specContent || specContent.length < MIN_SPEC_CONTENT_LENGTH) {
          console.warn(`[TASK_UPDATE_STATUS] Blocked attempt to set status 'human_review' for task ${taskId}. No spec has been created yet.`);
          return {
            success: false,
            error: "Cannot move to human review - no spec has been created yet. The task must complete processing before review."
          };
        }
      }

      // Get the spec directory and plan path using shared utility
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(project.path, specsBaseDir, task.specId);
      const planPath = getPlanPath(project, task);

      try {
        // Use shared utility for thread-safe plan file updates
        const persisted = await persistPlanStatus(planPath, status, project.id);

        if (!persisted) {
          // If no implementation plan exists yet, create a basic one
          await createPlanIfNotExists(planPath, task, status);
          // Invalidate cache after creating new plan
          projectStore.invalidateTasksCache(project.id);
        }

        // Auto-stop task when status changes AWAY from 'coding' and process IS running
        // This handles the case where user drags a running task back to Planning
        if (status !== 'coding' && agentManager.isRunning(taskId)) {
          console.warn('[TASK_UPDATE_STATUS] Stopping task due to status change away from coding:', taskId);
          agentManager.killTask(taskId);
        }

        // FIX-8: Auto-start removed - user must click "Start Build" button to start agent
        // Status change to 'coding' now only changes the status, not auto-start agent

        return { success: true };
      } catch (error) {
        console.error('Failed to update task status:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update task status'
        };
      }
    }
  );

  /**
   * Check if a task is actually running (has active process)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_CHECK_RUNNING,
    async (_, taskId: string): Promise<IPCResult<boolean>> => {
      const isRunning = agentManager.isRunning(taskId);
      return { success: true, data: isRunning };
    }
  );

  /**
   * Send a chat message to a running task's agent.
   * The message is queued and processed at the next iteration boundary.
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_SEND_MESSAGE,
    async (_, taskId: string, message: string): Promise<IPCResult<boolean>> => {
      console.log('[TASK_SEND_MESSAGE] Sending message to task:', taskId, 'length:', message.length);

      // Check if task is running first
      if (!agentManager.isRunning(taskId)) {
        console.warn('[TASK_SEND_MESSAGE] Task is not running:', taskId);
        return { success: false, error: 'Task is not running' };
      }

      const sent = agentManager.sendMessageToTask(taskId, message);
      if (!sent) {
        return { success: false, error: 'Failed to send message to task' };
      }

      return { success: true, data: true };
    }
  );

  /**
   * Recover a stuck task (status says coding but no process running)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_RECOVER_STUCK,
    async (
      _,
      taskId: string,
      options?: { targetStatus?: TaskStatus; autoRestart?: boolean }
    ): Promise<IPCResult<{ taskId: string; recovered: boolean; newStatus: TaskStatus; message: string; autoRestarted?: boolean }>> => {
      const targetStatus = options?.targetStatus;
      const autoRestart = options?.autoRestart ?? false;
      // Check if task is actually running
      const isActuallyRunning = agentManager.isRunning(taskId);

      if (isActuallyRunning) {
        return {
          success: false,
          error: 'Task is still running. Stop it first before recovering.',
          data: {
            taskId,
            recovered: false,
            newStatus: 'coding' as TaskStatus,
            message: 'Task is still running'
          }
        };
      }

      // Find task and project
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      // Get the spec directory - use task.specsPath if available (handles worktree vs main)
      // This is critical: task might exist in worktree, and getTasks() prefers worktree version.
      // If we write to main project but task is in worktree, the worktree's old status takes precedence on refresh.
      const specDir = task.specsPath || path.join(
        project.path,
        getSpecsDir(project.autoBuildPath),
        task.specId
      );

      // Update implementation_plan.json
      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
      console.log(`[Recovery] Writing to plan file at: ${planPath} (task location: ${task.location || 'main'})`);

      // Also update the OTHER location if task exists in both main and worktree
      // This ensures consistency regardless of which version getTasks() prefers
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const mainSpecDir = path.join(project.path, specsBaseDir, task.specId);
      const worktreePath = findTaskWorktree(project.path, task.specId);
      const worktreeSpecDir = worktreePath ? path.join(worktreePath, specsBaseDir, task.specId) : null;

      // Collect all plan file paths that need updating
      const planPathsToUpdate: string[] = [planPath];
      if (mainSpecDir !== specDir && existsSync(path.join(mainSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN))) {
        planPathsToUpdate.push(path.join(mainSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN));
      }
      if (worktreeSpecDir && worktreeSpecDir !== specDir && existsSync(path.join(worktreeSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN))) {
        planPathsToUpdate.push(path.join(worktreeSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN));
      }
      console.log(`[Recovery] Will update ${planPathsToUpdate.length} plan file(s):`, planPathsToUpdate);

      try {
        // Read the plan to analyze subtask progress
        // Using safe read to avoid TOCTOU race conditions
        let plan: Record<string, unknown> | null = null;
        const planContent = safeReadFileSync(planPath);
        if (planContent) {
          try {
            plan = JSON.parse(planContent);
          } catch (parseError) {
            console.error('[Recovery] Failed to parse plan file as JSON:', parseError);
            return {
              success: false,
              error: 'Plan file contains invalid JSON. The file may be corrupted.'
            };
          }
        }

        // Determine the target status intelligently based on subtask progress
        // If targetStatus is explicitly provided, use it; otherwise calculate from subtasks
        let newStatus: TaskStatus = targetStatus || 'planning';

        if (!targetStatus && plan?.phases && Array.isArray(plan.phases)) {
          // Analyze subtask statuses to determine appropriate recovery status
          const { completedCount, totalCount, allCompleted } = checkSubtasksCompletion(plan);

          if (totalCount > 0) {
            if (allCompleted) {
              // All subtasks completed - should go to review (ai_review or human_review based on source)
              // For recovery, human_review is safer as it requires manual verification
              newStatus = 'human_review';
            } else if (completedCount > 0) {
              // Some subtasks completed, some still pending - task is coding
              newStatus = 'coding';
            }
            // else: no subtasks completed, stay with 'planning'
          }
        }

        if (plan) {
          // Update status
          plan.status = newStatus;
          plan.planStatus = newStatus === 'done' ? 'completed'
            : newStatus === 'coding' ? 'coding'
            : newStatus === 'ai_review' ? 'review'
            : newStatus === 'human_review' ? 'review'
            : 'pending';
          plan.updated_at = new Date().toISOString();

          // Add recovery note
          plan.recoveryNote = `Task recovered from stuck state at ${new Date().toISOString()}`;

          // Check if task is actually stuck or just completed and waiting for merge
          const { allCompleted } = checkSubtasksCompletion(plan);

          if (allCompleted) {
            console.log('[Recovery] Task is fully complete (all subtasks done), setting to human_review without restart');
            // Don't reset any subtasks - task is done!
            // Just update status in plan file (project store reads from file, no separate update needed)
            plan.status = 'human_review';
            plan.planStatus = 'review';

            // Write to ALL plan file locations to ensure consistency
            const planContent = JSON.stringify(plan, null, 2);
            let writeSucceededForComplete = false;
            for (const pathToUpdate of planPathsToUpdate) {
              try {
                atomicWriteFileSync(pathToUpdate, planContent);
                console.log(`[Recovery] Successfully wrote to: ${pathToUpdate}`);
                writeSucceededForComplete = true;
              } catch (writeError) {
                console.error(`[Recovery] Failed to write plan file at ${pathToUpdate}:`, writeError);
                // Continue trying other paths
              }
            }

            if (!writeSucceededForComplete) {
              return {
                success: false,
                error: 'Failed to write plan file during recovery (all locations failed)'
              };
            }

            return {
              success: true,
              data: {
                taskId,
                recovered: true,
                newStatus: 'human_review',
                message: 'Task is complete and ready for review',
                autoRestarted: false
              }
            };
          }

          // Task is not complete - reset only stuck subtasks for retry
          // Keep completed subtasks as-is so run.py can resume from where it left off
          if (plan.phases && Array.isArray(plan.phases)) {
            for (const phase of plan.phases as Array<{ subtasks?: Array<{ status: string; actual_output?: string; started_at?: string; completed_at?: string }> }>) {
              if (phase.subtasks && Array.isArray(phase.subtasks)) {
                for (const subtask of phase.subtasks) {
                  // Reset in_progress subtasks to pending (they were interrupted)
                  // Keep completed subtasks as-is so run.py can resume
                  if (subtask.status === 'in_progress') {
                    const originalStatus = subtask.status;
                    subtask.status = 'pending';
                    // Clear execution data to maintain consistency
                    delete subtask.actual_output;
                    delete subtask.started_at;
                    delete subtask.completed_at;
                    console.log(`[Recovery] Reset stuck subtask: ${originalStatus} -> pending`);
                  }
                  // Also reset failed subtasks so they can be retried
                  if (subtask.status === 'failed') {
                    subtask.status = 'pending';
                    // Clear execution data to maintain consistency
                    delete subtask.actual_output;
                    delete subtask.started_at;
                    delete subtask.completed_at;
                    console.log(`[Recovery] Reset failed subtask for retry`);
                  }
                }
              }
            }
          }

          // Write to ALL plan file locations to ensure consistency
          const planContent = JSON.stringify(plan, null, 2);
          let writeSucceeded = false;
          for (const pathToUpdate of planPathsToUpdate) {
            try {
              atomicWriteFileSync(pathToUpdate, planContent);
              console.log(`[Recovery] Successfully wrote to: ${pathToUpdate}`);
              writeSucceeded = true;
            } catch (writeError) {
              console.error(`[Recovery] Failed to write plan file at ${pathToUpdate}:`, writeError);
            }
          }
          if (!writeSucceeded) {
            return {
              success: false,
              error: 'Failed to write plan file during recovery'
            };
          }
        }

        // Stop file watcher if it was watching this task
        fileWatcher.unwatch(taskId);

        // Auto-restart the task if requested
        let autoRestarted = false;
        if (autoRestart && project) {
          // Check git status before auto-restarting
          const gitStatusForRestart = checkGitStatus(project.path);
          if (!gitStatusForRestart.isGitRepo || !gitStatusForRestart.hasCommits) {
            console.warn('[Recovery] Git check failed, cannot auto-restart task');
            // Recovery succeeded but we can't restart without git
            return {
              success: true,
              data: {
                taskId,
                recovered: true,
                newStatus,
                message: `Task recovered but cannot restart: ${gitStatusForRestart.error || 'Git repository with commits required.'}`,
                autoRestarted: false
              }
            };
          }

          // Check authentication before auto-restarting
          // Ensure profile manager is initialized to prevent race condition
          const initResult = await ensureProfileManagerInitialized();
          if (!initResult.success) {
            // Recovery succeeded but we can't restart without profile manager
            return {
              success: true,
              data: {
                taskId,
                recovered: true,
                newStatus,
                message: `Task recovered but cannot restart: ${initResult.error}`,
                autoRestarted: false
              }
            };
          }
          const profileManager = initResult.profileManager;
          if (!profileManager.hasValidAuth()) {
            console.warn('[Recovery] Auth check failed, cannot auto-restart task');
            // Recovery succeeded but we can't restart without auth
            return {
              success: true,
              data: {
                taskId,
                recovered: true,
                newStatus,
                message: 'Task recovered but cannot restart: Claude authentication required. Please go to Settings > Claude Profiles and authenticate your account.',
                autoRestarted: false
              }
            };
          }

          try {
            // Start file watcher for this task
            const specsBaseDir = getSpecsDir(project.autoBuildPath);
            const specDirForWatcher = path.join(project.path, specsBaseDir, task.specId);
            fileWatcher.watch(taskId, specDirForWatcher);

            // Check if spec.md exists to determine whether to run spec creation or task execution
            const specFilePath = path.join(specDirForWatcher, AUTO_BUILD_PATHS.SPEC_FILE);
            const hasSpec = existsSync(specFilePath);

            // Get base branch: task-level override takes precedence over project settings
            const baseBranchForRecovery = task.metadata?.baseBranch || project.settings?.mainBranch;

            // Phase 2: Handle planning tasks differently
            // If task is in 'planning' status, restart as planning agent (not coding)
            if (task.status === 'planning') {
              console.log(`[Recovery] Task ${taskId} is in planning status, restarting as planning agent`);
              newStatus = 'planning';

              // Update plan status for restart - keep as planning
              if (plan) {
                plan.status = 'planning';
                plan.planStatus = 'pending';
                const restartPlanContent = JSON.stringify(plan, null, 2);
                for (const pathToUpdate of planPathsToUpdate) {
                  try {
                    atomicWriteFileSync(pathToUpdate, restartPlanContent);
                    console.log(`[Recovery] Wrote restart status (planning) to: ${pathToUpdate}`);
                  } catch (writeError) {
                    console.error(`[Recovery] Failed to write plan file for restart at ${pathToUpdate}:`, writeError);
                  }
                }
              }

              // Start the planning agent
              const taskDescription = task.description || task.title;
              console.warn(`[Recovery] Starting planning agent for: ${task.specId}`);
              await agentManager.startPlanningAgent(
                task.specId,
                project.path,
                taskDescription,
                specDirForWatcher,
                task.metadata,
                baseBranchForRecovery
              );
              autoRestarted = true;
              console.warn(`[Recovery] Auto-restarted planning agent for task ${taskId}`);
            } else {
              // FIX-3/FIX-4: Coding tasks should NOT auto-restart on recovery
              // Instead, mark as interrupted so user can click "Resume" button
              // This prevents unwanted auto-starts after app restart or recovery
              console.log(`[Recovery] Task ${taskId} is in coding status, marking as interrupted (no auto-restart)`);
              newStatus = 'coding';

              // Update plan status to indicate interrupted state
              if (plan) {
                plan.status = 'coding';
                plan.planStatus = 'coding';
                plan.interrupted = true;
                plan.interruptedAt = new Date().toISOString();
                const interruptedPlanContent = JSON.stringify(plan, null, 2);
                for (const pathToUpdate of planPathsToUpdate) {
                  try {
                    atomicWriteFileSync(pathToUpdate, interruptedPlanContent);
                    console.log(`[Recovery] Wrote interrupted status to: ${pathToUpdate}`);
                  } catch (writeError) {
                    console.error(`[Recovery] Failed to write plan file for interrupted status at ${pathToUpdate}:`, writeError);
                  }
                }
              }

              // Do NOT auto-start the coding agent - user must click "Resume"
              autoRestarted = false;
            }
          } catch (restartError) {
            console.error('Failed to auto-restart task after recovery:', restartError);
            // Recovery succeeded but restart failed - still report success
          }
        }

        // Notify renderer of status change
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(
            IPC_CHANNELS.TASK_STATUS_CHANGE,
            taskId,
            newStatus
          );
        }

        return {
          success: true,
          data: {
            taskId,
            recovered: true,
            newStatus,
            message: autoRestarted
              ? 'Task recovered and restarted successfully'
              : `Task recovered successfully and moved to ${newStatus}`,
            autoRestarted
          }
        };
      } catch (error) {
        console.error('Failed to recover stuck task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to recover task'
        };
      }
    }
  );
}
