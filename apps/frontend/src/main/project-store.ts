import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, Dirent } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Project, ProjectSettings, Task, TaskStatus, TaskMetadata, ImplementationPlan, ReviewReason, PlanSubtask, KanbanPreferences, ExecutionPhase } from '../shared/types';
import { DEFAULT_PROJECT_SETTINGS, AUTO_BUILD_PATHS, getSpecsDir, JSON_ERROR_PREFIX, JSON_ERROR_TITLE_SUFFIX, TASK_STATUS_PRIORITY } from '../shared/constants';
import { getAutoBuildPath, isInitialized } from './project-initializer';
import { getTaskWorktreeDir } from './worktree-paths';
import { findAllSpecPaths } from './utils/spec-path-helpers';
import { ensureAbsolutePath } from './utils/path-helpers';

interface TabState {
  openProjectIds: string[];
  activeProjectId: string | null;
  tabOrder: string[];
}

interface StoreData {
  projects: Project[];
  settings: Record<string, unknown>;
  tabState?: TabState;
  kanbanPreferences?: Record<string, KanbanPreferences>;
}

interface TasksCacheEntry {
  tasks: Task[];
  timestamp: number;
}

/**
 * Persistent storage for projects and settings
 */
export class ProjectStore {
  private storePath: string;
  private data: StoreData;
  private tasksCache: Map<string, TasksCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 3000; // 3 seconds TTL for task cache

  constructor() {
    // Store in app's userData directory
    const userDataPath = app.getPath('userData');
    const storeDir = path.join(userDataPath, 'store');

    // Ensure directory exists
    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    this.storePath = path.join(storeDir, 'projects.json');
    this.data = this.load();
  }

  /**
   * Load store from disk
   */
  private load(): StoreData {
    if (existsSync(this.storePath)) {
      try {
        const content = readFileSync(this.storePath, 'utf-8');
        const data = JSON.parse(content);
        // Convert date strings back to Date objects and normalize paths to absolute
        data.projects = data.projects.map((p: Project) => ({
          ...p,
          // Ensure project.path is always absolute (critical for dev mode path resolution)
          path: ensureAbsolutePath(p.path),
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt)
        }));
        return data;
      } catch {
        return { projects: [], settings: {} };
      }
    }
    return { projects: [], settings: {} };
  }

  /**
   * Save store to disk
   */
  private save(): void {
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /**
   * Add a new project
   */
  addProject(projectPath: string, name?: string): Project {
    // CRITICAL: Normalize to absolute path for dev mode compatibility
    // This prevents path resolution issues after app restart
    const absolutePath = ensureAbsolutePath(projectPath);

    // Check if project already exists (using absolute path for comparison)
    const existing = this.data.projects.find((p) => p.path === absolutePath);
    if (existing) {
      // Validate that .auto-claude folder still exists for existing project
      // If manually deleted, reset autoBuildPath so UI prompts for reinitialization
      if (existing.autoBuildPath && !isInitialized(existing.path)) {
        console.warn(`[ProjectStore] .auto-claude folder was deleted for project "${existing.name}" - resetting autoBuildPath`);
        existing.autoBuildPath = '';
        existing.updatedAt = new Date();
        this.save();
      }
      return existing;
    }

    // Derive name from path if not provided
    const projectName = name || path.basename(absolutePath);

    // Determine auto-claude path (supports both 'auto-claude' and '.auto-claude')
    const autoBuildPath = getAutoBuildPath(absolutePath) || '';

    const project: Project = {
      id: uuidv4(),
      name: projectName,
      path: absolutePath, // Store absolute path
      autoBuildPath,
      settings: { ...DEFAULT_PROJECT_SETTINGS },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.data.projects.push(project);
    this.save();

    return project;
  }

  /**
   * Update project's autoBuildPath after initialization
   */
  updateAutoBuildPath(projectId: string, autoBuildPath: string): Project | undefined {
    const project = this.data.projects.find((p) => p.id === projectId);
    if (project) {
      project.autoBuildPath = autoBuildPath;
      project.updatedAt = new Date();
      this.save();
    }
    return project;
  }

  /**
   * Remove a project
   */
  removeProject(projectId: string): boolean {
    const index = this.data.projects.findIndex((p) => p.id === projectId);
    if (index !== -1) {
      this.data.projects.splice(index, 1);
      // Clean up kanban preferences to avoid orphaned data
      if (this.data.kanbanPreferences?.[projectId]) {
        delete this.data.kanbanPreferences[projectId];
      }
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Get all projects
   */
  getProjects(): Project[] {
    return this.data.projects;
  }

  /**
   * Get tab state
   */
  getTabState(): TabState {
    return this.data.tabState || {
      openProjectIds: [],
      activeProjectId: null,
      tabOrder: []
    };
  }

  /**
   * Save tab state
   */
  saveTabState(tabState: TabState): void {
    // Filter out any project IDs that no longer exist
    const validProjectIds = this.data.projects.map(p => p.id);
    this.data.tabState = {
      openProjectIds: tabState.openProjectIds.filter(id => validProjectIds.includes(id)),
      activeProjectId: tabState.activeProjectId && validProjectIds.includes(tabState.activeProjectId)
        ? tabState.activeProjectId
        : null,
      tabOrder: tabState.tabOrder.filter(id => validProjectIds.includes(id))
    };
    this.save();
  }

  /**
   * Get kanban column preferences for a specific project
   */
  getKanbanPreferences(projectId: string): KanbanPreferences | null {
    return this.data.kanbanPreferences?.[projectId] ?? null;
  }

  /**
   * Save kanban column preferences for a specific project
   */
  saveKanbanPreferences(projectId: string, preferences: KanbanPreferences): void {
    if (!this.data.kanbanPreferences) {
      this.data.kanbanPreferences = {};
    }
    this.data.kanbanPreferences[projectId] = preferences;
    this.save();
  }

  /**
   * Validate all projects to ensure their .auto-claude folders still exist.
   * If a project has autoBuildPath set but the folder was deleted,
   * reset autoBuildPath to empty string so the UI prompts for reinitialization.
   *
   * @returns Array of project IDs that were reset due to missing .auto-claude folder
   */
  validateProjects(): string[] {
    const resetProjectIds: string[] = [];
    let hasChanges = false;

    for (const project of this.data.projects) {
      // Skip projects that aren't initialized (autoBuildPath is empty)
      if (!project.autoBuildPath) {
        continue;
      }

      // Check if the project path still exists
      if (!existsSync(project.path)) {
        console.warn(`[ProjectStore] Project path no longer exists: ${project.path}`);
        continue; // Don't reset - let user handle this case
      }

      // Check if .auto-claude folder still exists
      if (!isInitialized(project.path)) {
        console.warn(`[ProjectStore] .auto-claude folder missing for project "${project.name}" at ${project.path}`);
        project.autoBuildPath = '';
        project.updatedAt = new Date();
        resetProjectIds.push(project.id);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.save();
      console.warn(`[ProjectStore] Reset ${resetProjectIds.length} project(s) due to missing .auto-claude folder`);
    }

    return resetProjectIds;
  }

  /**
   * Get a project by ID
   */
  getProject(projectId: string): Project | undefined {
    return this.data.projects.find((p) => p.id === projectId);
  }

  /**
   * Update project settings
   */
  updateProjectSettings(
    projectId: string,
    settings: Partial<ProjectSettings>
  ): Project | undefined {
    const project = this.data.projects.find((p) => p.id === projectId);
    if (project) {
      project.settings = { ...project.settings, ...settings };
      project.updatedAt = new Date();
      this.save();
    }
    return project;
  }

  /**
   * Get tasks for a project by scanning specs directory
   * Implements caching with 3-second TTL to prevent excessive worktree scanning
   */
  getTasks(projectId: string): Task[] {
    // Check cache first
    const cached = this.tasksCache.get(projectId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      return cached.tasks;
    }

    const project = this.getProject(projectId);
    if (!project) {
      return [];
    }

    const allTasks: Task[] = [];
    const specsBaseDir = getSpecsDir(project.autoBuildPath);

    // 1. Scan main project specs directory (source of truth for task existence)
    const mainSpecsDir = path.join(project.path, specsBaseDir);
    const mainSpecIds = new Set<string>();
    if (existsSync(mainSpecsDir)) {
      const mainTasks = this.loadTasksFromSpecsDir(mainSpecsDir, project.path, 'main', projectId, specsBaseDir);
      allTasks.push(...mainTasks);
      // Track which specs exist in main project
      mainTasks.forEach(t => mainSpecIds.add(t.specId));
    }

    // 2. Scan worktree specs directories
    // NOTE FOR MAINTAINERS: Worktree tasks are only included if the spec also exists in main.
    // This prevents deleted tasks from "coming back" when the worktree isn't cleaned up.
    const worktreesDir = getTaskWorktreeDir(project.path);
    if (existsSync(worktreesDir)) {
      try {
        const worktrees = readdirSync(worktreesDir, { withFileTypes: true });
        for (const worktree of worktrees) {
          if (!worktree.isDirectory()) continue;

          const worktreeSpecsDir = path.join(worktreesDir, worktree.name, specsBaseDir);
          if (existsSync(worktreeSpecsDir)) {
            const worktreeTasks = this.loadTasksFromSpecsDir(
              worktreeSpecsDir,
              path.join(worktreesDir, worktree.name),
              'worktree',
              projectId,
              specsBaseDir
            );
            // Only include worktree tasks if the spec exists in main project
            const validWorktreeTasks = worktreeTasks.filter(t => mainSpecIds.has(t.specId));
            allTasks.push(...validWorktreeTasks);
          }
        }
      } catch (error) {
        console.error('[ProjectStore] Error scanning worktrees:', error);
      }
    }

    // 3. Deduplicate tasks by ID
    // CRITICAL FIX: Don't blindly prefer worktree - it may be stale!
    // If main project task is "done", it should win over worktree's "in_progress".
    // Worktrees can linger after completion, containing outdated task data.
    const taskMap = new Map<string, Task>();
    for (const task of allTasks) {
      const existing = taskMap.get(task.id);
      if (!existing) {
        // First occurrence wins
        taskMap.set(task.id, task);
      } else {
        // PREFER MAIN PROJECT over worktree - main has current user changes
        // Only use status priority when both are from same location
        const existingIsMain = existing.location === 'main';
        const newIsMain = task.location === 'main';

        if (existingIsMain && !newIsMain) {
        } else if (!existingIsMain && newIsMain) {
          // New is main, replace existing worktree
          taskMap.set(task.id, task);
        } else {
          // Same location - use status priority to determine which is more complete
          const existingPriority = TASK_STATUS_PRIORITY[existing.status] || 0;
          const newPriority = TASK_STATUS_PRIORITY[task.status] || 0;

          if (newPriority > existingPriority) {
            // New version has higher priority (more complete status)
            taskMap.set(task.id, task);
          }
          // Otherwise keep existing version
        }
      }
    }

    const tasks = Array.from(taskMap.values());

    // Update cache
    this.tasksCache.set(projectId, { tasks, timestamp: now });

    return tasks;
  }

  /**
   * Invalidate the tasks cache for a specific project
   * Call this when tasks are modified (created, deleted, status changed, etc.)
   */
  invalidateTasksCache(projectId: string): void {
    this.tasksCache.delete(projectId);
  }

  /**
   * Clear all tasks cache entries
   * Useful for global refresh scenarios
   */
  clearTasksCache(): void {
    this.tasksCache.clear();
  }

  /**
   * Load tasks from a specs directory (helper method for main project and worktrees)
   */
  private loadTasksFromSpecsDir(
    specsDir: string,
    _basePath: string,
    location: 'main' | 'worktree',
    projectId: string,
    _specsBaseDir: string
  ): Task[] {
    const tasks: Task[] = [];
    let specDirs: Dirent[] = [];

    try {
      specDirs = readdirSync(specsDir, { withFileTypes: true });
    } catch (error) {
      console.error('[ProjectStore] Error reading specs directory:', error);
      return [];
    }

    for (const dir of specDirs) {
      if (!dir.isDirectory()) continue;
      if (dir.name === '.gitkeep') continue;

      try {
        const specPath = path.join(specsDir, dir.name);
        const planPath = path.join(specPath, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        const specFilePath = path.join(specPath, AUTO_BUILD_PATHS.SPEC_FILE);

        // Try to read implementation plan
        let plan: ImplementationPlan | null = null;
        let hasJsonError = false;
        let jsonErrorMessage = '';
        if (existsSync(planPath)) {
          try {
            const content = readFileSync(planPath, 'utf-8');
            plan = JSON.parse(content);
          } catch (err) {
            // Don't skip - create task with error indicator so user knows it exists
            hasJsonError = true;
            jsonErrorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[ProjectStore] JSON parse error for spec ${dir.name}:`, jsonErrorMessage);
          }
        }

        // PRIORITY 1: Read description from implementation_plan.json (user's original)
        let description = '';
        if (plan?.description) {
          description = plan.description;
        }

        // PRIORITY 2: Fallback to requirements.json
        if (!description) {
          const requirementsPath = path.join(specPath, AUTO_BUILD_PATHS.REQUIREMENTS);
          if (existsSync(requirementsPath)) {
            try {
              const reqContent = readFileSync(requirementsPath, 'utf-8');
              const requirements = JSON.parse(reqContent);
              if (requirements.task_description) {
                // Use the full task description for the modal view
                description = requirements.task_description;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }

        // PRIORITY 3: Final fallback to spec.md Overview (AI-synthesized content)
        if (!description && existsSync(specFilePath)) {
          try {
            const content = readFileSync(specFilePath, 'utf-8');
            // Extract full Overview section until next heading or end of file
            // Use \n#{1,6}\s to match valid markdown headings (# to ######) with required space
            // This avoids truncating at # in code blocks (e.g., Python comments)
            const overviewMatch = content.match(/## Overview\s*\n+([\s\S]*?)(?=\n#{1,6}\s|$)/);
            if (overviewMatch) {
              description = overviewMatch[1].trim();
            }
          } catch {
            // Ignore read errors
          }
        }

        // Try to read task metadata
        const metadataPath = path.join(specPath, 'task_metadata.json');
        let metadata: TaskMetadata | undefined;
        if (existsSync(metadataPath)) {
          try {
            const content = readFileSync(metadataPath, 'utf-8');
            metadata = JSON.parse(content);
          } catch {
            // Ignore parse errors
          }
        }

        // Determine task status and review reason from plan
        // For JSON errors, store just the raw error - renderer will use i18n to format
        const finalDescription = hasJsonError
          ? `${JSON_ERROR_PREFIX}${jsonErrorMessage}`
          : description;
        // Tasks with JSON errors go to human_review with errors reason
        const { status: finalStatus, reviewReason: finalReviewReason } = hasJsonError
          ? { status: 'human_review' as TaskStatus, reviewReason: 'errors' as ReviewReason }
          : this.determineTaskStatusAndReason(plan);

        // Extract subtasks from plan (handle both 'subtasks' and 'chunks' naming)
        const subtasks = plan?.phases?.flatMap((phase) => {
          const items = phase.subtasks || (phase as { chunks?: PlanSubtask[] }).chunks || [];
          return items.map((subtask) => ({
            id: subtask.id,
            title: subtask.description,
            description: subtask.description,
            status: subtask.status,
            files: []
          }));
        }) || [];

        // Auto-correct status to human_review if all subtasks are completed
        // This handles cases where task completed but app restarted before XState persisted the status
        // (e.g., QA_PASSED event emitted but not processed before shutdown)
        const { status: correctedStatus, reviewReason: correctedReviewReason } = this.correctStaleTaskStatus(
          subtasks, hasJsonError, finalStatus, finalReviewReason, plan, planPath, dir.name
        );

        // Extract staged status from plan (set when changes are merged with --no-commit)
        const planWithStaged = plan as unknown as { stagedInMainProject?: boolean; stagedAt?: string } | null;
        const stagedInMainProject = planWithStaged?.stagedInMainProject;
        const stagedAt = planWithStaged?.stagedAt;

        // Determine title - check if feature looks like a spec ID (e.g., "054-something-something")
        // For JSON error tasks, use directory name with marker for i18n suffix
        let title = hasJsonError ? `${dir.name}${JSON_ERROR_TITLE_SUFFIX}` : (plan?.feature || plan?.title || dir.name);
        const looksLikeSpecId = /^\d{3}-/.test(title) && !hasJsonError;
        if (looksLikeSpecId && existsSync(specFilePath)) {
          try {
            const specContent = readFileSync(specFilePath, 'utf-8');
            // Extract title from first # line, handling patterns like:
            // "# Quick Spec: Title" -> "Title"
            // "# Specification: Title" -> "Title"
            // "# Title" -> "Title"
            const titleMatch = specContent.match(/^#\s+(?:Quick Spec:|Specification:)?\s*(.+)$/m);
            if (titleMatch?.[1]) {
              title = titleMatch[1].trim();
            }
          } catch {
            // Keep the original title on error
          }
        }

        // Use persisted executionPhase (from text parser) or xstateState for exact restoration
        // Priority: executionPhase > xstateState > inferred from status
        const persistedPhase = (plan as { executionPhase?: string } | null)?.executionPhase as ExecutionPhase | undefined;
        const xstateState = (plan as { xstateState?: string } | null)?.xstateState;
        const executionProgress = persistedPhase
          ? { phase: persistedPhase, phaseProgress: 50, overallProgress: 50 }
          : xstateState
            ? this.inferExecutionProgressFromXState(xstateState)
            : this.inferExecutionProgress(plan?.status);

        tasks.push({
          id: dir.name, // Use spec directory name as ID
          specId: dir.name,
          projectId,
          title,
          description: finalDescription,
          status: correctedStatus,
          subtasks,
          logs: [],
          metadata,
          ...(correctedReviewReason !== undefined && { reviewReason: correctedReviewReason }),
          ...(executionProgress && { executionProgress }),
          stagedInMainProject,
          stagedAt,
          location, // Add location metadata (main vs worktree)
          specsPath: specPath, // Add full path to specs directory
          createdAt: new Date(plan?.created_at || Date.now()),
          updatedAt: new Date(plan?.updated_at || Date.now())
        });
      } catch (error) {
        // Log error but continue processing other specs
        console.error(`[ProjectStore] Error loading spec ${dir.name}:`, error);
      }
    }

    return tasks;
  }

  /**
   * Correct stale task status when all subtasks are completed but status wasn't persisted.
   * Extracted from loadTasksFromSpecsDir to keep read/write separation clear.
   *
   * NOTE: This method intentionally writes to implementation_plan.json to persist the
   * correction and prevent repeated auto-corrections on every getTasks() call. The plan
   * object is NOT mutated unless the write succeeds, preserving memory/disk consistency.
   */
  private correctStaleTaskStatus(
    subtasks: { status: string }[],
    hasJsonError: boolean,
    finalStatus: TaskStatus,
    finalReviewReason: ReviewReason | undefined,
    plan: ImplementationPlan | null,
    planPath: string,
    taskName: string
  ): { status: TaskStatus; reviewReason: ReviewReason | undefined } {
    if (subtasks.length === 0 || hasJsonError) {
      return { status: finalStatus, reviewReason: finalReviewReason };
    }

    const completedCount = subtasks.filter(s => s.status === 'completed').length;
    const allCompleted = completedCount === subtasks.length;

    // Only auto-correct if all subtasks are done and status is in an incomplete coding state.
    // Preserve ai_review (QA in progress), error (needs investigation), human_review, done, pr_created.
    if (!allCompleted || finalStatus === 'human_review' || finalStatus === 'done' || finalStatus === 'pr_created' || finalStatus === 'ai_review' || finalStatus === 'error') {
      return { status: finalStatus, reviewReason: finalReviewReason };
    }

    // Skip auto-correction if plan was recently updated (backend may still be writing)
    if (plan?.updated_at) {
      const updatedAt = new Date(plan.updated_at).getTime();
      const ageMs = Date.now() - updatedAt;
      if (ageMs < 30_000) {
        return { status: finalStatus, reviewReason: finalReviewReason };
      }
    }

    console.warn(`[ProjectStore] Auto-correcting task ${taskName}: all ${subtasks.length} subtasks completed but status was ${finalStatus}. Setting to human_review.`);

    if (plan) {
      // Clone before mutation — only apply to the original plan object if the write succeeds
      const correctedPlan = {
        ...plan,
        status: 'human_review' as const,
        planStatus: 'review',
        reviewReason: 'completed' as ReviewReason,
        updated_at: new Date().toISOString(),
        xstateState: 'human_review',
        executionPhase: 'complete'
      };
      try {
        writeFileSync(planPath, JSON.stringify(correctedPlan, null, 2), 'utf-8');
        // Write succeeded — apply mutations to the in-memory plan so the rest of
        // loadTasksFromSpecsDir sees the corrected values (e.g., executionProgress)
        Object.assign(plan, correctedPlan);
        console.warn(`[ProjectStore] Persisted corrected status for task ${taskName}`);
      } catch (writeError) {
        // Write failed — leave the plan object unchanged and return the original status
        // so there's no memory/disk inconsistency
        console.error(`[ProjectStore] Failed to persist corrected status for task ${taskName}:`, writeError);
        return { status: finalStatus, reviewReason: finalReviewReason };
      }
    }

    return { status: 'human_review', reviewReason: 'completed' };
  }

  /**
   * Determine task status and review reason from the plan file.
   *
   * With the XState refactor, status and reviewReason are authoritative fields
   * written by the TaskStateManager. The renderer should not recompute status
   * from subtasks or QA files.
   */
  private determineTaskStatusAndReason(
    plan: ImplementationPlan | null
  ): { status: TaskStatus; reviewReason?: ReviewReason } {
    if (!plan?.status) {
      return { status: 'backlog' };
    }

    const statusMap: Record<string, TaskStatus> = {
      'pending': 'backlog',
      'planning': 'in_progress',
      'in_progress': 'in_progress',
      'coding': 'in_progress',
      'review': 'ai_review',
      'completed': 'done',
      'done': 'done',
      'human_review': 'human_review',
      'ai_review': 'ai_review',
      'pr_created': 'pr_created',
      'backlog': 'backlog',
      'error': 'error',
      'queue': 'queue',
      'queued': 'queue'
    };

    const storedStatus = statusMap[plan.status] || 'backlog';
    const reviewReason = storedStatus === 'human_review' ? plan.reviewReason : undefined;

    return { status: storedStatus, reviewReason };
  }

  /**
   * Infer execution progress from plan status for XState snapshot restoration.
   * Maps plan status values to ExecutionPhase so buildSnapshotFromTask can
   * correctly determine the XState state (planning vs coding vs qa_review, etc.).
   */
  private inferExecutionProgress(planStatus: string | undefined): { phase: ExecutionPhase; phaseProgress: number; overallProgress: number } | undefined {
    if (!planStatus) return undefined;

    // Map plan status to execution phase
    const phaseMap: Record<string, ExecutionPhase> = {
      'pending': 'idle',
      'backlog': 'idle',
      'queue': 'idle',
      'queued': 'idle',
      'planning': 'planning',
      'coding': 'coding',
      'in_progress': 'coding', // Default in_progress to coding
      'review': 'qa_review',
      'ai_review': 'qa_review',
      'qa_review': 'qa_review',
      'qa_fixing': 'qa_fixing',
      'human_review': 'complete',
      'completed': 'complete',
      'done': 'complete',
      'error': 'failed'
    };

    const phase = phaseMap[planStatus];
    if (!phase) return undefined;

    return {
      phase,
      phaseProgress: 50,
      overallProgress: 50
    };
  }

  /**
   * Infer execution progress from persisted XState state.
   * This is more precise than inferring from plan status since it uses the exact machine state.
   */
  private inferExecutionProgressFromXState(xstateState: string): { phase: ExecutionPhase; phaseProgress: number; overallProgress: number } | undefined {
    // Map XState state directly to execution phase
    const phaseMap: Record<string, ExecutionPhase> = {
      'backlog': 'idle',
      'planning': 'planning',
      'plan_review': 'planning',
      'coding': 'coding',
      'qa_review': 'qa_review',
      'qa_fixing': 'qa_fixing',
      'human_review': 'complete',
      'error': 'failed',
      'creating_pr': 'complete',
      'pr_created': 'complete',
      'done': 'complete'
    };

    const phase = phaseMap[xstateState];
    if (!phase) return undefined;

    return {
      phase,
      phaseProgress: phase === 'complete' ? 100 : 50,
      overallProgress: phase === 'complete' ? 100 : 50
    };
  }

  /**
   * Archive tasks by writing archivedAt to their metadata
   * @param projectId - Project ID
   * @param taskIds - IDs of tasks to archive
   * @param version - Version they were archived in (optional)
   */
  archiveTasks(projectId: string, taskIds: string[], version?: string): boolean {
    const project = this.getProject(projectId);
    if (!project) {
      console.error('[ProjectStore] archiveTasks: Project not found:', projectId);
      return false;
    }

    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const archivedAt = new Date().toISOString();
    let hasErrors = false;

    for (const taskId of taskIds) {
      // Find ALL locations where this task exists (main + worktrees)
      const specPaths = findAllSpecPaths(project.path, specsBaseDir, taskId);

      // If spec directory doesn't exist anywhere, skip gracefully
      if (specPaths.length === 0) {
        continue;
      }

      // Archive in ALL locations
      for (const specPath of specPaths) {
        try {
          const metadataPath = path.join(specPath, 'task_metadata.json');
          let metadata: TaskMetadata = {};

          // Read existing metadata, handling missing file without TOCTOU race
          try {
            metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
          } catch (readErr: unknown) {
            // File doesn't exist yet - start with empty metadata
            if ((readErr as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw readErr;
            }
          }

          // Add archive info
          metadata.archivedAt = archivedAt;
          if (version) {
            metadata.archivedInVersion = version;
          }

          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        } catch (error) {
          console.error(`[ProjectStore] archiveTasks: Failed to archive task ${taskId} at ${specPath}:`, error);
          hasErrors = true;
          // Continue with other locations/tasks even if one fails
        }
      }
    }

    // Invalidate cache since task metadata changed
    this.invalidateTasksCache(projectId);

    return !hasErrors;
  }

  /**
   * Unarchive tasks by removing archivedAt from their metadata
   * @param projectId - Project ID
   * @param taskIds - IDs of tasks to unarchive
   */
  unarchiveTasks(projectId: string, taskIds: string[]): boolean {
    const project = this.getProject(projectId);
    if (!project) {
      console.error('[ProjectStore] unarchiveTasks: Project not found:', projectId);
      return false;
    }

    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    let hasErrors = false;

    for (const taskId of taskIds) {
      // Find ALL locations where this task exists (main + worktrees)
      const specPaths = findAllSpecPaths(project.path, specsBaseDir, taskId);

      if (specPaths.length === 0) {
        console.warn(`[ProjectStore] unarchiveTasks: Spec directory not found for task ${taskId}`);
        continue;
      }

      // Unarchive in ALL locations
      for (const specPath of specPaths) {
        try {
          const metadataPath = path.join(specPath, 'task_metadata.json');
          let metadata: TaskMetadata;

          // Read metadata, handling missing file without TOCTOU race
          try {
            metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
          } catch (readErr: unknown) {
            if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
              console.warn(`[ProjectStore] unarchiveTasks: Metadata file not found for task ${taskId} at ${specPath}`);
              continue;
            }
            throw readErr;
          }

          delete metadata.archivedAt;
          delete metadata.archivedInVersion;
          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        } catch (error) {
          console.error(`[ProjectStore] unarchiveTasks: Failed to unarchive task ${taskId} at ${specPath}:`, error);
          hasErrors = true;
          // Continue with other locations/tasks even if one fails
        }
      }
    }

    // Invalidate cache since task metadata changed
    this.invalidateTasksCache(projectId);

    return !hasErrors;
  }
}

// Singleton instance
export const projectStore = new ProjectStore();
