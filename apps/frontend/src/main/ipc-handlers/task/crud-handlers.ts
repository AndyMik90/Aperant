import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, Task, TaskMetadata } from '../../../shared/types';
import path from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { projectStore } from '../../project-store';
import { titleGenerator } from '../../title-generator';
import { AgentManager } from '../../agent';
import { TerminalManager } from '../../terminal/terminal-manager';
import { checkGitStatus } from '../../project-initializer';
import { initializeClaudeProfileManager } from '../../claude-profile-manager';
import { findTaskAndProject } from './shared';
import { fileWatcher } from '../../file-watcher';
import { getTaskWorktreeDir } from '../../worktree-paths';

// Serialize task creation to prevent specId race condition.
// The await in title generation yields control, allowing concurrent TASK_CREATE
// calls to read the same max spec number from the directory listing.
let taskCreateLock: Promise<void> = Promise.resolve();

/**
 * Register task CRUD (Create, Read, Update, Delete) handlers
 *
 * Phase 2: Now receives terminalManager and getMainWindow to spawn planning agent at task creation
 */
export function registerTaskCRUDHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
  terminalManager: TerminalManager
): void {
  /**
   * List all tasks for a project
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST,
    async (_, projectId: string): Promise<IPCResult<Task[]>> => {
      console.warn('[IPC] TASK_LIST called with projectId:', projectId);
      const tasks = projectStore.getTasks(projectId);
      console.warn('[IPC] TASK_LIST returning', tasks.length, 'tasks');
      return { success: true, data: tasks };
    }
  );

  /**
   * Create a new task
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE,
    async (
      _,
      projectId: string,
      title: string,
      description: string,
      metadata?: TaskMetadata
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Serialize task creation: wait for any previous TASK_CREATE to finish
      // so that specId generation reads the latest directory state.
      let resolveCreation!: () => void;
      const previousLock = taskCreateLock;
      taskCreateLock = new Promise<void>(r => { resolveCreation = r; });
      try {
        await previousLock;
      } catch {
        // Previous creation failed - continue anyway
      }

      try {
      // Auto-generate title if empty using Claude AI
      let finalTitle = title;
      if (!title || !title.trim()) {
        console.warn('[TASK_CREATE] Title is empty, generating with Claude AI...');
        try {
          const generatedTitle = await titleGenerator.generateTitle(description);
          if (generatedTitle) {
            finalTitle = generatedTitle;
            console.warn('[TASK_CREATE] Generated title:', finalTitle);
          } else {
            // Fallback: create title from first line of description
            finalTitle = description.split('\n')[0].substring(0, 60);
            if (finalTitle.length === 60) finalTitle += '...';
            console.warn('[TASK_CREATE] AI generation failed, using fallback:', finalTitle);
          }
        } catch (err) {
          console.error('[TASK_CREATE] Title generation error:', err);
          // Fallback: create title from first line of description
          finalTitle = description.split('\n')[0].substring(0, 60);
          if (finalTitle.length === 60) finalTitle += '...';
        }
      }

      // Generate a unique spec ID based on existing specs
      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const specsDir = path.join(project.path, specsBaseDir);

      // Find next available spec number
      let specNumber = 1;
      if (existsSync(specsDir)) {
        const existingDirs = readdirSync(specsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);

        // Extract numbers from spec directory names (e.g., "001-feature" -> 1)
        const existingNumbers = existingDirs
          .map(name => {
            const match = name.match(/^(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => n > 0);

        if (existingNumbers.length > 0) {
          specNumber = Math.max(...existingNumbers) + 1;
        }
      }

      // Create spec ID with zero-padded number and slugified title
      const slugifiedTitle = finalTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50) || 'task';
      const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle}`;

      // Create spec directory
      const specDir = path.join(specsDir, specId);
      mkdirSync(specDir, { recursive: true });

      // Build metadata with source type
      const taskMetadata: TaskMetadata = {
        sourceType: 'manual',
        ...metadata,
        // Preserve the user-provided title so agents can't overwrite it
        originalTitle: metadata?.originalTitle || finalTitle,
      };

      // Process and save attached images
      if (taskMetadata.attachedImages && taskMetadata.attachedImages.length > 0) {
        const attachmentsDir = path.join(specDir, 'attachments');
        mkdirSync(attachmentsDir, { recursive: true });

        const savedImages: typeof taskMetadata.attachedImages = [];

        for (const image of taskMetadata.attachedImages) {
          if (image.data) {
            try {
              // Decode base64 and save to file
              const buffer = Buffer.from(image.data, 'base64');
              const imagePath = path.join(attachmentsDir, image.filename);
              writeFileSync(imagePath, buffer);

              // Store relative path instead of base64 data
              savedImages.push({
                id: image.id,
                filename: image.filename,
                mimeType: image.mimeType,
                size: image.size,
                path: `attachments/${image.filename}`
                // Don't include data or thumbnail to save space
              });
            } catch (err) {
              console.error(`Failed to save image ${image.filename}:`, err);
            }
          }
        }

        // Update metadata with saved image paths (without base64 data)
        taskMetadata.attachedImages = savedImages;
      }

      // Create initial implementation_plan.json (task is created but not started)
      // Status must be 'planning' to match the task object status and prevent
      // inconsistency when getTasks() reads the file on refresh
      const now = new Date().toISOString();
      const implementationPlan = {
        feature: finalTitle,
        description: description,
        created_at: now,
        updated_at: now,
        status: 'planning',
        planStatus: 'pending',
        phases: []
      };

      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
      writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2));

      // Save task metadata if provided
      if (taskMetadata) {
        const metadataPath = path.join(specDir, 'task_metadata.json');
        writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2));
      }

      // Create requirements.json with attached images
      const requirements: Record<string, unknown> = {
        task_description: description,
        workflow_type: taskMetadata.category || 'feature'
      };

      // Add attached images to requirements if present
      if (taskMetadata.attachedImages && taskMetadata.attachedImages.length > 0) {
        requirements.attached_images = taskMetadata.attachedImages.map(img => ({
          filename: img.filename,
          path: img.path,
          description: '' // User can add descriptions later
        }));
      }

      const requirementsPath = path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS);
      writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));

      // Create the task object
      const task: Task = {
        id: specId,
        specId: specId,
        projectId,
        title: finalTitle,
        description,
        status: 'planning',
        subtasks: [],
        logs: [],
        metadata: taskMetadata,
        // SUG-6: Map metadata dependencies to top-level field for blocking logic
        dependencies: taskMetadata.dependencies?.filter((d): d is string => typeof d === 'string' && d.length > 0) || undefined,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Invalidate cache since a new task was created
      projectStore.invalidateTasksCache(projectId);

      // =====================================================================
      // PHASE 2: Agent at Task Creation
      // Spawn planning agent and create task monitor terminal immediately
      // =====================================================================
      const mainWindow = getMainWindow();

      // Check prerequisites before spawning agent
      const gitStatus = checkGitStatus(project.path);
      const canSpawnAgent = gitStatus.isGitRepo && gitStatus.hasCommits;

      // Check authentication
      let hasAuth = false;
      try {
        const profileManager = await initializeClaudeProfileManager();
        hasAuth = profileManager.hasValidAuth();
      } catch (error) {
        console.warn('[TASK_CREATE] Failed to check auth, will skip planning agent:', error);
      }

      if (canSpawnAgent && hasAuth && mainWindow) {
        console.log('[TASK_CREATE] Phase 2: Spawning planning agent for task:', specId);

        // Create task monitor terminal ID
        const terminalId = `task-${specId}`;

        // Notify renderer to add terminal to store
        mainWindow.webContents.send(
          IPC_CHANNELS.TASK_MONITOR_TERMINAL_CREATE,
          {
            id: terminalId,
            title: finalTitle,
            projectPath: project.path,
            taskId: specId,
            specId: specId,
            isTaskMonitor: true,
            taskStatus: 'running', // Planning agent is "running" in planning mode
          }
        );

        // Create the virtual terminal in main process (for output streaming)
        const terminalResult = await terminalManager.create({
          id: terminalId,
          cwd: project.path,
          projectPath: project.path,
          isTaskMonitor: true,
          taskId: specId,
          specId: specId,
          taskTitle: finalTitle,
        });

        if (!terminalResult.success) {
          console.error('[TASK_CREATE] Failed to create task monitor terminal:', terminalResult.error);
        }

        // Get base branch: task-level override takes precedence over project settings
        const baseBranch = taskMetadata?.baseBranch || project.settings?.mainBranch;

        // Start file watcher BEFORE starting agent so we detect spec.md and implementation_plan.json changes
        // This is critical for updating the task UI with subtasks as they are created
        fileWatcher.watch(specId, specDir);
        console.log('[TASK_CREATE] File watcher started for spec dir:', specDir);

        // Start the planning agent (does NOT auto-continue to coding)
        // The agent will create the worktree and spec.md, then wait for user approval
        const agentStarted = await agentManager.startPlanningAgent(
          specId,
          project.path,
          description,
          specDir,
          taskMetadata,
          baseBranch
        );

        if (agentStarted) {
          console.log('[TASK_CREATE] Planning agent started successfully');
        } else {
          console.warn('[TASK_CREATE] Planning agent failed to start, task created without agent');
        }
      } else {
        // Log why agent wasn't spawned (for debugging)
        if (!gitStatus.isGitRepo) {
          console.log('[TASK_CREATE] Skipping planning agent: not a git repo');
        } else if (!gitStatus.hasCommits) {
          console.log('[TASK_CREATE] Skipping planning agent: no commits');
        } else if (!hasAuth) {
          console.log('[TASK_CREATE] Skipping planning agent: no valid auth');
        } else if (!mainWindow) {
          console.log('[TASK_CREATE] Skipping planning agent: no main window');
        }
      }

      return { success: true, data: task };
      } finally {
        resolveCreation();
      }
    }
  );

  /**
   * Delete a task
   * FIX-27: Now deletes task from ALL locations (main project AND worktrees)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_DELETE,
    async (_, taskId: string): Promise<IPCResult> => {
      const { rm } = await import('fs/promises');

      // Find task and project
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        return { success: false, error: 'Task or project not found' };
      }

      // Check if task is currently running
      const isRunning = agentManager.isRunning(taskId);
      if (isRunning) {
        return { success: false, error: 'Cannot delete a running task. Stop the task first.' };
      }

      const specsBaseDir = getSpecsDir(project.autoBuildPath);
      const deletedPaths: string[] = [];
      const errors: string[] = [];

      // FIX-025: Task delete cleans up spec directories from main project and
      // worktrees. However, archived tasks that are NOT explicitly deleted will
      // accumulate in .auto-claude/specs/ indefinitely. There is no automatic GC
      // for old archived specs. cleanup_old_worktrees() in worktree.py handles
      // stale worktrees (30+ days) but spec dirs are not covered.
      // TODO: Add age-based GC for archived spec directories.

      // Delete from ALL locations - main project AND worktrees

      // 1. Delete from main project specs directory
      const mainSpecDir = path.join(project.path, specsBaseDir, task.specId);
      try {
        console.warn(`[TASK_DELETE] Checking main project: ${mainSpecDir}`);
        if (existsSync(mainSpecDir)) {
          await rm(mainSpecDir, { recursive: true, force: true });
          deletedPaths.push(`main: ${mainSpecDir}`);
          console.warn(`[TASK_DELETE] Deleted from main project: ${mainSpecDir}`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        errors.push(`main: ${errMsg}`);
        console.error('[TASK_DELETE] Error deleting from main project:', error);
      }

      // 2. Delete from ALL worktrees that contain this task
      const worktreesDir = getTaskWorktreeDir(project.path);
      if (existsSync(worktreesDir)) {
        try {
          const worktrees = readdirSync(worktreesDir, { withFileTypes: true });
          for (const worktree of worktrees) {
            if (!worktree.isDirectory()) continue;

            const worktreeSpecDir = path.join(worktreesDir, worktree.name, specsBaseDir, task.specId);
            try {
              if (existsSync(worktreeSpecDir)) {
                await rm(worktreeSpecDir, { recursive: true, force: true });
                deletedPaths.push(`worktree/${worktree.name}: ${worktreeSpecDir}`);
                console.warn(`[TASK_DELETE] Deleted from worktree ${worktree.name}: ${worktreeSpecDir}`);
              }
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : String(error);
              errors.push(`worktree/${worktree.name}: ${errMsg}`);
              console.error(`[TASK_DELETE] Error deleting from worktree ${worktree.name}:`, error);
            }
          }
        } catch (error) {
          console.error('[TASK_DELETE] Error scanning worktrees:', error);
        }
      }

      // Invalidate cache since a task was deleted
      projectStore.invalidateTasksCache(project.id);

      // Report results
      if (deletedPaths.length === 0 && errors.length === 0) {
        console.warn(`[TASK_DELETE] Task ${taskId} not found in any location`);
        return { success: true }; // Task doesn't exist anywhere, consider it deleted
      }

      if (errors.length > 0) {
        console.error(`[TASK_DELETE] Completed with errors:`, { deleted: deletedPaths, errors });
        // Return partial success if we deleted at least one location
        if (deletedPaths.length > 0) {
          return { success: true }; // Partial success - some locations deleted
        }
        return {
          success: false,
          error: `Failed to delete task: ${errors.join(', ')}`
        };
      }

      console.warn(`[TASK_DELETE] Successfully deleted task from ${deletedPaths.length} location(s):`, deletedPaths);
      return { success: true };
    }
  );

  /**
   * Update a task
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_UPDATE,
    async (
      _,
      taskId: string,
      updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
    ): Promise<IPCResult<Task>> => {
      try {
        // Find task and project
        const { task, project } = findTaskAndProject(taskId);

        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        const autoBuildDir = project.autoBuildPath || '.auto-claude';
        const specDir = path.join(project.path, autoBuildDir, 'specs', task.specId);

        if (!existsSync(specDir)) {
          return { success: false, error: 'Spec directory not found' };
        }

        // Auto-generate title if empty
        let finalTitle = updates.title;
        if (updates.title !== undefined && !updates.title.trim()) {
          // Get description to use for title generation
          const descriptionToUse = updates.description ?? task.description;
          console.warn('[TASK_UPDATE] Title is empty, generating with Claude AI...');
          try {
            const generatedTitle = await titleGenerator.generateTitle(descriptionToUse);
            if (generatedTitle) {
              finalTitle = generatedTitle;
              console.warn('[TASK_UPDATE] Generated title:', finalTitle);
            } else {
              // Fallback: create title from first line of description
              finalTitle = descriptionToUse.split('\n')[0].substring(0, 60);
              if (finalTitle.length === 60) finalTitle += '...';
              console.warn('[TASK_UPDATE] AI generation failed, using fallback:', finalTitle);
            }
          } catch (err) {
            console.error('[TASK_UPDATE] Title generation error:', err);
            // Fallback: create title from first line of description
            finalTitle = descriptionToUse.split('\n')[0].substring(0, 60);
            if (finalTitle.length === 60) finalTitle += '...';
          }
        }

        // Update implementation_plan.json
        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        if (existsSync(planPath)) {
          try {
            const planContent = readFileSync(planPath, 'utf-8');
            const plan = JSON.parse(planContent);

            if (finalTitle !== undefined) {
              plan.feature = finalTitle;
            }
            if (updates.description !== undefined) {
              plan.description = updates.description;
            }
            plan.updated_at = new Date().toISOString();

            writeFileSync(planPath, JSON.stringify(plan, null, 2));
          } catch {
            // Plan file might not be valid JSON, continue anyway
          }
        }

        // Update spec.md if it exists
        const specPath = path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE);
        if (existsSync(specPath)) {
          try {
            let specContent = readFileSync(specPath, 'utf-8');

            // Update title (first # heading)
            if (finalTitle !== undefined) {
              specContent = specContent.replace(
                /^#\s+.*$/m,
                `# ${finalTitle}`
              );
            }

            // Update description (## Overview section content)
            if (updates.description !== undefined) {
              // Replace content between ## Overview and the next ## section
              specContent = specContent.replace(
                /(## Overview\n)([\s\S]*?)((?=\n## )|$)/,
                `$1${updates.description}\n\n$3`
              );
            }

            writeFileSync(specPath, specContent);
          } catch {
            // Spec file update failed, continue anyway
          }
        }

        // Update metadata if provided
        let updatedMetadata = task.metadata;
        if (updates.metadata) {
          updatedMetadata = { ...task.metadata, ...updates.metadata };

          // Process and save attached images if provided
          if (updates.metadata.attachedImages && updates.metadata.attachedImages.length > 0) {
            const attachmentsDir = path.join(specDir, 'attachments');
            mkdirSync(attachmentsDir, { recursive: true });

            const savedImages: typeof updates.metadata.attachedImages = [];

            for (const image of updates.metadata.attachedImages) {
              // If image has data (new image), save it
              if (image.data) {
                try {
                  const buffer = Buffer.from(image.data, 'base64');
                  const imagePath = path.join(attachmentsDir, image.filename);
                  writeFileSync(imagePath, buffer);

                  savedImages.push({
                    id: image.id,
                    filename: image.filename,
                    mimeType: image.mimeType,
                    size: image.size,
                    path: `attachments/${image.filename}`
                  });
                } catch (err) {
                  console.error(`Failed to save image ${image.filename}:`, err);
                }
              } else if (image.path) {
                // Existing image, keep it
                savedImages.push(image);
              }
            }

            updatedMetadata.attachedImages = savedImages;
          }

          // Update task_metadata.json
          const metadataPath = path.join(specDir, 'task_metadata.json');
          try {
            writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2));
          } catch (err) {
            console.error('Failed to update task_metadata.json:', err);
          }

          // Update requirements.json if it exists
          const requirementsPath = path.join(specDir, 'requirements.json');
          if (existsSync(requirementsPath)) {
            try {
              const requirementsContent = readFileSync(requirementsPath, 'utf-8');
              const requirements = JSON.parse(requirementsContent);

              if (updates.description !== undefined) {
                requirements.task_description = updates.description;
              }
              if (updates.metadata.category) {
                requirements.workflow_type = updates.metadata.category;
              }

              writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));
            } catch (err) {
              console.error('Failed to update requirements.json:', err);
            }
          }
        }

        // Build the updated task object
        const updatedTask: Task = {
          ...task,
          title: finalTitle ?? task.title,
          description: updates.description ?? task.description,
          metadata: updatedMetadata,
          updatedAt: new Date()
        };

        // Invalidate cache since a task was updated
        projectStore.invalidateTasksCache(project.id);

        return { success: true, data: updatedTask };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );
}
