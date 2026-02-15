import { create } from 'zustand';
import { arrayMove } from '@dnd-kit/sortable';
import type { Task, TaskStatus, SubtaskStatus, ImplementationPlan, Subtask, TaskMetadata, ExecutionProgress, ExecutionPhase, ReviewReason, TaskDraft, ImageAttachment, TaskOrderState } from '../../shared/types';
import { debugLog, debugWarn } from '../../shared/utils/debug-logger';
import { useProjectStore } from './project-store';

/** Default max parallel tasks when no project setting is configured */
export const DEFAULT_MAX_PARALLEL_TASKS = 3;

/** Maximum log entries stored per task to prevent renderer OOM */
export const MAX_LOG_ENTRIES = 5000;

interface TaskState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  taskOrder: TaskOrderState | null;  // Per-column task ordering for kanban board

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewReason?: ReviewReason) => void;
  updateTaskFromPlan: (taskId: string, plan: ImplementationPlan) => void;
  updateExecutionProgress: (taskId: string, progress: Partial<ExecutionProgress>) => void;
  appendLog: (taskId: string, log: string) => void;
  batchAppendLogs: (taskId: string, logs: string[]) => void;
  selectTask: (taskId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTasks: () => void;
  // Task order actions for kanban drag-and-drop reordering
  setTaskOrder: (order: TaskOrderState) => void;
  reorderTasksInColumn: (status: TaskStatus, activeId: string, overId: string) => void;
  moveTaskToColumnTop: (taskId: string, targetStatus: TaskStatus, sourceStatus?: TaskStatus) => void;
  loadTaskOrder: (projectId: string) => void;
  saveTaskOrder: (projectId: string) => boolean;
  clearTaskOrder: (projectId: string) => void;

  // Task status change listeners (for queue auto-promotion)
  registerTaskStatusChangeListener: (listener: (taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus) => void) => () => void;

  // Selectors
  getSelectedTask: () => Task | undefined;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

/**
 * Helper to find task index by id or specId.
 * Returns -1 if not found.
 */
function findTaskIndex(tasks: Task[], taskId: string): number {
  return tasks.findIndex((t) => t.id === taskId || t.specId === taskId);
}

/**
 * Task status change listeners for queue auto-promotion
 * Stored outside the store to avoid triggering re-renders
 */
const taskStatusChangeListeners = new Set<(taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus) => void>();

/**
 * Track last activity timestamp per task for stuck detection.
 * If we've received activity (execution progress, status update) within a threshold,
 * the task is considered active even if the process check fails.
 * This prevents race conditions where stuck detection fires before process is registered.
 */
const taskLastActivity = new Map<string, number>();
const STUCK_ACTIVITY_THRESHOLD_MS = 60_000; // 60 seconds — matches catastrophic stuck check interval

/**
 * Record activity for a task (call this when we receive execution progress or status updates)
 */
export function recordTaskActivity(taskId: string): void {
  taskLastActivity.set(taskId, Date.now());
}

/**
 * Check if a task has had recent activity within the threshold.
 * Used by stuck detection to avoid false positives.
 */
export function hasRecentActivity(taskId: string): boolean {
  const lastActivity = taskLastActivity.get(taskId);
  if (!lastActivity) return false;
  return Date.now() - lastActivity < STUCK_ACTIVITY_THRESHOLD_MS;
}

/**
 * Clear activity tracking for a task (call when task completes or is deleted)
 */
export function clearTaskActivity(taskId: string): void {
  taskLastActivity.delete(taskId);
}

/**
 * Notify all registered listeners when a task status changes
 */
function notifyTaskStatusChange(taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus): void {
  for (const listener of taskStatusChangeListeners) {
    try {
      listener(taskId, oldStatus, newStatus);
    } catch (error) {
      console.error('[TaskStore] Error in task status change listener:', error);
    }
  }
}

/**
 * Helper to update a single task efficiently.
 * Uses slice instead of map to avoid iterating all tasks.
 */
function updateTaskAtIndex(tasks: Task[], index: number, updater: (task: Task) => Task): Task[] {
  if (index < 0 || index >= tasks.length) return tasks;

  const updatedTask = updater(tasks[index]);

  // If the task reference didn't change, return original array
  if (updatedTask === tasks[index]) {
    return tasks;
  }

  // Create new array with only the changed task replaced
  const newTasks = [...tasks];
  newTasks[index] = updatedTask;

  return newTasks;
}

/**
 * Validates implementation plan data structure before processing.
 * Returns true if valid, false if invalid/incomplete.
 */
function validatePlanData(plan: ImplementationPlan): boolean {
  // Validate plan has phases array
  if (!plan.phases || !Array.isArray(plan.phases)) {
    console.warn('[validatePlanData] Invalid plan: missing or invalid phases array');
    return false;
  }

  // Validate each phase has subtasks array
  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase || !phase.subtasks || !Array.isArray(phase.subtasks)) {
      console.warn(`[validatePlanData] Invalid phase ${i}: missing or invalid subtasks array`);
      return false;
    }

    // Validate each subtask has at minimum a description
    for (let j = 0; j < phase.subtasks.length; j++) {
      const subtask = phase.subtasks[j];
      if (!subtask || typeof subtask !== 'object') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: not an object`);
        return false;
      }

      // Description is critical - we can't show a subtask without it
      if (!subtask.description || typeof subtask.description !== 'string' || subtask.description.trim() === '') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: missing or empty description`);
        return false;
      }
    }
  }

  return true;
}

// localStorage key prefix for task order persistence
const TASK_ORDER_KEY_PREFIX = 'task-order-state';

/**
 * Get the localStorage key for a project's task order
 */
function getTaskOrderKey(projectId: string): string {
  return `${TASK_ORDER_KEY_PREFIX}-${projectId}`;
}

/**
 * Create an empty task order state with all status columns
 */
function createEmptyTaskOrder(): TaskOrderState {
  return {
    backlog: [],
    queue: [],
    in_progress: [],
    ai_review: [],
    human_review: [],
    done: [],
    pr_created: [],
    error: []
  };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,
  taskOrder: null,

  setTasks: (tasks) => {
    debugLog('[TaskStore.setTasks] Hydrating tasks:', {
      count: tasks.length,
      taskIds: tasks.map(t => ({
        id: t.id,
        status: t.status,
        logCount: t.logs?.length || 0,
        hasExecutionProgress: !!t.executionProgress,
        phase: t.executionProgress?.phase
      }))
    });

    // Log detailed info for each task with logs
    tasks.forEach(task => {
      if (task.logs && task.logs.length > 0) {
        debugLog(`[TaskStore.setTasks] Task ${task.id} has ${task.logs.length} logs:`, {
          firstLogPreview: task.logs[0]?.substring(0, 100),
          lastLogPreview: task.logs[task.logs.length - 1]?.substring(0, 100)
        });
      }
    });

    return set({ tasks });
  },

  addTask: (task) =>
    set((state) => {
      // Determine which column the task belongs to based on its status
      const status = task.status || 'backlog';

      // Update task order if it exists - new tasks go to top of their column
      let taskOrder = state.taskOrder;
      if (taskOrder) {
        const newTaskOrder = { ...taskOrder };

        // Add task ID to the top of the appropriate column
        if (newTaskOrder[status]) {
          // Ensure the task isn't already in the array (safety check)
          newTaskOrder[status] = newTaskOrder[status].filter(id => id !== task.id);
          // Add to top (index 0)
          newTaskOrder[status] = [task.id, ...newTaskOrder[status]];
        } else {
          // Initialize column order array if it doesn't exist
          newTaskOrder[status] = [task.id];
        }

        taskOrder = newTaskOrder;
      }

      return {
        tasks: [...state.tasks, task],
        taskOrder
      };
    }),

  updateTask: (taskId, updates) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({ ...t, ...updates }))
      };
    }),

  updateTaskStatus: (taskId, status, reviewReason) => {
    // Record activity for stuck detection — status changes prove the task is alive
    recordTaskActivity(taskId);

    // Capture old status before update
    const state = get();
    const index = findTaskIndex(state.tasks, taskId);
    if (index === -1) {
      debugLog('[updateTaskStatus] Task not found:', taskId);
      return;
    }
    const oldTask = state.tasks[index];
    const oldStatus = oldTask.status;

    // Skip if status AND reviewReason are the same
    if (oldStatus === status && oldTask.reviewReason === reviewReason) {
      debugLog('[updateTaskStatus] Status and reviewReason unchanged, skipping:', { taskId, status, reviewReason });
      return;
    }

    debugLog('[updateTaskStatus] START:', {
      taskId,
      oldStatus,
      newStatus: status,
      allInProgress: state.tasks.filter(t => t.status === 'in_progress' && !t.metadata?.archivedAt).map(t => t.id)
    });

    // Perform the state update
    set((state) => {
      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          // Determine execution progress based on status transition
          let executionProgress = t.executionProgress;

          // Track status transition for debugging flip-flop issues
          const previousStatus = t.status;
          const statusChanged = previousStatus !== status;

          if (status === 'backlog') {
            // When status goes to backlog, reset execution progress to idle
            // This ensures the planning/coding animation stops when task is stopped
            executionProgress = { phase: 'idle' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
          } else if (status === 'in_progress' && !t.executionProgress?.phase) {
            // When starting a task and no phase is set yet, default to planning
            // This prevents the "no active phase" UI state during startup race condition
            executionProgress = { phase: 'planning' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
          }

          // Log status transitions to help diagnose flip-flop issues
          debugLog('[updateTaskStatus] Status transition:', {
            taskId,
            previousStatus,
            newStatus: status,
            statusChanged,
            currentPhase: t.executionProgress?.phase,
            newPhase: executionProgress?.phase
          });

          return { ...t, status, reviewReason, executionProgress, updatedAt: new Date() };
        })
      };
    });

    // Notify listeners after state update (schedule after current tick)
    queueMicrotask(() => {
      notifyTaskStatusChange(taskId, oldStatus, status);
    });
  },

  updateTaskFromPlan: (taskId, plan) =>
    set((state) => {
      // FIX (PR Review): Gate debug logging to prevent production console clutter
      debugLog('[updateTaskFromPlan] called with plan:', {
        taskId,
        feature: plan.feature,
        phases: plan.phases?.length || 0,
        totalSubtasks: plan.phases?.reduce((acc, p) => acc + (p.subtasks?.length || 0), 0) || 0
        // Note: planData removed to avoid verbose output in logs
      });

      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) {
        console.log('[updateTaskFromPlan] Task not found:', taskId);
        return state;
      }

      // Validate plan data before processing
      if (!validatePlanData(plan)) {
        console.error('[updateTaskFromPlan] Invalid plan data, skipping update:', {
          taskId,
          plan
        });
        return state;
      }

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          const subtasks: Subtask[] = plan.phases.flatMap((phase) =>
            phase.subtasks.map((subtask) => {
              // Ensure all required fields have valid values to prevent UI issues
              // Use crypto.randomUUID() for stronger randomness when available
              const id = subtask.id || (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
              // Defensive fallback: validatePlanData() ensures description exists, but kept for safety
              const description = subtask.description || 'No description available';
              const title = description; // Title and description are the same for subtasks
              const status = (subtask.status as SubtaskStatus) || 'pending';

              return {
                id,
                title,
                description,
                status,
                files: [],
                verification: subtask.verification as Subtask['verification']
              };
            })
          );

          debugLog('[updateTaskFromPlan] Created subtasks:', {
            taskId,
            subtaskCount: subtasks.length,
            subtasks: subtasks.map(s => ({
              id: s.id,
              title: s.title,
              status: s.status
            }))
          });

          // NOTE: We do NOT update status from plan anymore.
          // XState is the source of truth for status - it emits TASK_STATUS_CHANGE.
          // Plan updates only update subtasks, title, and other non-status fields.
          // This prevents race conditions where a stale plan overwrites XState status.

          return {
            ...t,
            title: plan.feature || t.title,
            subtasks,
            // Keep existing status and reviewReason - XState manages these via TASK_STATUS_CHANGE
            updatedAt: new Date()
          };
        })
      };
    }),

  updateExecutionProgress: (taskId, progress) => {
    // Record activity for stuck detection (outside of set() to avoid triggering extra renders)
    recordTaskActivity(taskId);

    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => {
          const existingProgress = t.executionProgress || {
            phase: 'idle' as ExecutionPhase,
            phaseProgress: 0,
            overallProgress: 0,
            sequenceNumber: 0
          };

          const incomingSeq = progress.sequenceNumber ?? 0;
          const currentSeq = existingProgress.sequenceNumber ?? 0;
          if (incomingSeq > 0 && currentSeq > 0 && incomingSeq < currentSeq) {
            // FIX (ACS-55): Log when updates are dropped due to sequence numbers
            // This helps debug phase transition issues
            console.warn('[updateExecutionProgress] Dropping out-of-order update:', {
              taskId,
              incomingSeq,
              currentSeq,
              incomingPhase: progress.phase,
              currentPhase: existingProgress.phase
            });
            return t; // Skip out-of-order update
          }

          // Only update updatedAt on phase transitions (not on every progress tick)
          // This prevents unnecessary re-renders from the memo comparator
          const phaseChanged = progress.phase && progress.phase !== existingProgress.phase;

          return {
            ...t,
            executionProgress: {
              ...existingProgress,
              ...progress
            },
            // Only set updatedAt on phase changes to reduce re-renders
            ...(phaseChanged ? { updatedAt: new Date() } : {})
          };
        })
      };
    });
  },

  appendLog: (taskId, log) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) {
        debugWarn('[TaskStore.appendLog] Task not found:', taskId);
        return state;
      }

      const currentLogCount = state.tasks[index].logs?.length || 0;
      debugLog('[TaskStore.appendLog] Appending log:', {
        taskId,
        currentLogCount,
        newLogCount: currentLogCount + 1,
        logPreview: log.substring(0, 100)
      });

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({
          ...t,
          logs: [...(t.logs || []), log].slice(-MAX_LOG_ENTRIES)
        }))
      };
    }),

  // Batch append multiple logs at once (single state update instead of N updates)
  batchAppendLogs: (taskId, logs) => {
    // Record activity for stuck detection — log output proves the task is alive
    recordTaskActivity(taskId);
    return set((state) => {
      if (logs.length === 0) {
        debugLog('[TaskStore.batchAppendLogs] No logs to append for task:', taskId);
        return state;
      }
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) {
        debugWarn('[TaskStore.batchAppendLogs] Task not found:', taskId);
        return state;
      }

      const currentLogCount = state.tasks[index].logs?.length || 0;
      const newLogCount = currentLogCount + logs.length;
      debugLog('[TaskStore.batchAppendLogs] Batch appending logs:', {
        taskId,
        currentLogCount,
        newLogsCount: logs.length,
        newLogCount,
        firstLogPreview: logs[0]?.substring(0, 100)
      });

      return {
        tasks: updateTaskAtIndex(state.tasks, index, (t) => ({
          ...t,
          logs: [...(t.logs || []), ...logs].slice(-MAX_LOG_ENTRIES)
        }))
      };
    });
  },

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearTasks: () => set({ tasks: [], selectedTaskId: null, taskOrder: null }),

  // Task order actions for kanban drag-and-drop reordering
  setTaskOrder: (order) => set({ taskOrder: order }),

  reorderTasksInColumn: (status, activeId, overId) => {
    set((state) => {
      if (!state.taskOrder) return state;

      const columnOrder = state.taskOrder[status];
      if (!columnOrder) return state;

      const oldIndex = columnOrder.indexOf(activeId);
      const newIndex = columnOrder.indexOf(overId);

      // Both tasks must be in the column order array
      if (oldIndex === -1 || newIndex === -1) return state;

      return {
        taskOrder: {
          ...state.taskOrder,
          [status]: arrayMove(columnOrder, oldIndex, newIndex)
        }
      };
    });
  },

  moveTaskToColumnTop: (taskId, targetStatus, sourceStatus) => {
    set((state) => {
      if (!state.taskOrder) return state;

      // Create a copy of the task order to modify
      const newTaskOrder = { ...state.taskOrder };

      // Remove from source column if provided
      if (sourceStatus && newTaskOrder[sourceStatus]) {
        newTaskOrder[sourceStatus] = newTaskOrder[sourceStatus].filter(id => id !== taskId);
      }

      // Add to top of target column
      if (newTaskOrder[targetStatus]) {
        // Remove from target column first (in case it already exists there)
        newTaskOrder[targetStatus] = newTaskOrder[targetStatus].filter(id => id !== taskId);
        // Add to top (index 0)
        newTaskOrder[targetStatus] = [taskId, ...newTaskOrder[targetStatus]];
      } else {
        // Initialize column order array if it doesn't exist
        newTaskOrder[targetStatus] = [taskId];
      }

      return { taskOrder: newTaskOrder };
    });
  },

  loadTaskOrder: (projectId) => {
    try {
      const key = getTaskOrderKey(projectId);
      debugLog('[TaskStore.loadTaskOrder] Loading task order:', { projectId, key });
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate structure before assigning - type assertion is compile-time only
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          debugWarn('[TaskStore.loadTaskOrder] Invalid task order data in localStorage, resetting to empty');
          set({ taskOrder: createEmptyTaskOrder() });
          return;
        }

        // Helper to validate column values are string arrays
        const isValidColumnArray = (val: unknown): val is string[] =>
          Array.isArray(val) && val.every(item => typeof item === 'string');

        // Merge with empty order to handle partial data and validate each column
        const emptyOrder = createEmptyTaskOrder();
        const validatedOrder: TaskOrderState = {
          backlog: isValidColumnArray(parsed.backlog) ? parsed.backlog : emptyOrder.backlog,
          queue: isValidColumnArray(parsed.queue) ? parsed.queue : emptyOrder.queue,
          in_progress: isValidColumnArray(parsed.in_progress) ? parsed.in_progress : emptyOrder.in_progress,
          ai_review: isValidColumnArray(parsed.ai_review) ? parsed.ai_review : emptyOrder.ai_review,
          human_review: isValidColumnArray(parsed.human_review) ? parsed.human_review : emptyOrder.human_review,
          done: isValidColumnArray(parsed.done) ? parsed.done : emptyOrder.done,
          pr_created: isValidColumnArray(parsed.pr_created) ? parsed.pr_created : emptyOrder.pr_created,
          error: isValidColumnArray(parsed.error) ? parsed.error : emptyOrder.error
        };

        debugLog('[TaskStore.loadTaskOrder] Loaded task order:', {
          projectId,
          columnCounts: Object.entries(validatedOrder).map(([col, ids]) => ({ col, count: ids.length }))
        });
        set({ taskOrder: validatedOrder });
      } else {
        debugLog('[TaskStore.loadTaskOrder] No stored task order found, using empty order');
        set({ taskOrder: createEmptyTaskOrder() });
      }
    } catch (error) {
      debugWarn('[TaskStore.loadTaskOrder] Failed to load task order:', error);
      set({ taskOrder: createEmptyTaskOrder() });
    }
  },

  saveTaskOrder: (projectId) => {
    try {
      const state = get();
      if (!state.taskOrder) {
        // Nothing to save - return false to indicate no save occurred
        return false;
      }

      const key = getTaskOrderKey(projectId);
      localStorage.setItem(key, JSON.stringify(state.taskOrder));
      return true;
    } catch (error) {
      console.error('Failed to save task order:', error);
      return false;
    }
  },

  clearTaskOrder: (projectId) => {
    try {
      const key = getTaskOrderKey(projectId);
      localStorage.removeItem(key);
      set({ taskOrder: null });
    } catch (error) {
      console.error('Failed to clear task order:', error);
    }
  },

  getSelectedTask: () => {
    const state = get();
    return state.tasks.find((t) => t.id === state.selectedTaskId);
  },

  getTasksByStatus: (status) => {
    const state = get();
    return state.tasks.filter((t) => t.status === status);
  },

  registerTaskStatusChangeListener: (listener) => {
    taskStatusChangeListeners.add(listener);
    // Return cleanup function to unregister
    return () => {
      taskStatusChangeListeners.delete(listener);
    };
  }
}));

/**
 * Load tasks for a project
 * @param projectId - The project ID to load tasks for
 * @param options - Optional parameters
 * @param options.forceRefresh - If true, invalidates server-side cache before fetching (for refresh button)
 */
export async function loadTasks(projectId: string, options?: { forceRefresh?: boolean }): Promise<void> {
  const store = useTaskStore.getState();
  store.setLoading(true);
  store.setError(null);

  debugLog('[TaskStore.loadTasks] Loading tasks for project:', {
    projectId,
    forceRefresh: options?.forceRefresh || false,
    currentTaskCount: store.tasks.length
  });

  try {
    const result = await window.electronAPI.getTasks(projectId, options);

    debugLog('[TaskStore.loadTasks] Received result from IPC:', {
      success: result.success,
      dataPresent: !!result.data,
      taskCount: result.data?.length || 0,
      error: result.error
    });

    if (result.success && result.data) {
      debugLog('[TaskStore.loadTasks] Tasks loaded successfully:', {
        count: result.data.length,
        tasksWithLogs: result.data.filter(t => t.logs && t.logs.length > 0).length,
        totalLogCount: result.data.reduce((sum, t) => sum + (t.logs?.length || 0), 0)
      });
      store.setTasks(result.data);
    } else {
      debugWarn('[TaskStore.loadTasks] Failed to load tasks:', result.error);
      store.setError(result.error || 'Failed to load tasks');
    }
  } catch (error) {
    debugWarn('[TaskStore.loadTasks] Exception while loading tasks:', error);
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Create a new task
 */
export async function createTask(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.createTask(projectId, title, description, metadata);
    if (result.success && result.data) {
      store.addTask(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create task');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Start a task
 */
export function startTask(taskId: string, options?: { parallel?: boolean; workers?: number }): void {
  window.electronAPI.startTask(taskId, options);
}

/**
 * Stop a task
 */
export function stopTask(taskId: string): void {
  window.electronAPI.stopTask(taskId);
}

/**
 * Submit review for a task
 */
export async function submitReview(
  taskId: string,
  approved: boolean,
  feedback?: string,
  images?: ImageAttachment[]
): Promise<boolean> {
  try {
    const result = await window.electronAPI.submitReview(taskId, approved, feedback, images);
    if (result.success) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Result type for persistTaskStatus with worktree info
 */
export interface PersistStatusResult {
  success: boolean;
  worktreeExists?: boolean;
  worktreePath?: string;
  error?: string;
}

/**
 * Update task status and persist to file
 * Returns additional info if a worktree exists and needs cleanup confirmation
 */
export async function persistTaskStatus(
  taskId: string,
  status: TaskStatus,
  options?: { forceCleanup?: boolean }
): Promise<PersistStatusResult> {
  const store = useTaskStore.getState();

  try {
    // Persist to file first (don't optimistically update for 'done' status)
    const result = await window.electronAPI.updateTaskStatus(taskId, status, options);

    if (!result.success) {
      // Check if this is a worktree exists case
      if (result.worktreeExists) {
        console.log('[persistTaskStatus] Worktree exists, confirmation needed');
        return {
          success: false,
          worktreeExists: true,
          worktreePath: result.worktreePath,
          error: result.error
        };
      }
      console.error('Failed to persist task status:', result.error);
      return { success: false, error: result.error };
    }

    // Only update local state after backend confirms success
    store.updateTaskStatus(taskId, status);
    return { success: true };
  } catch (error) {
    console.error('Error persisting task status:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Force complete a task by cleaning up its worktree
 * Used when user confirms they want to delete the worktree and mark as done
 * Returns full result including error details for better UX
 */
export async function forceCompleteTask(taskId: string): Promise<PersistStatusResult> {
  return persistTaskStatus(taskId, 'done', { forceCleanup: true });
}

/**
 * Check if the in_progress queue is at capacity.
 * @param excludeTaskId - Task ID to exclude from the count (e.g., when restarting a stuck task already in in_progress)
 */
export function isQueueAtCapacity(excludeTaskId?: string): boolean {
  const maxParallelTasks = useProjectStore.getState().getActiveProject()?.settings?.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS;
  const currentTasks = useTaskStore.getState().tasks;
  const inProgressCount = currentTasks.filter((t) =>
    t.status === 'in_progress' && !t.metadata?.archivedAt && (!excludeTaskId || t.id !== excludeTaskId)
  ).length;
  return inProgressCount >= maxParallelTasks;
}

export interface StartTaskOrQueueResult {
  /** Whether the task was started ('started') or redirected to queue ('queued') */
  action: 'started' | 'queued';
  success: boolean;
  error?: string;
}

/**
 * Start a task or queue it if parallel task capacity is full.
 * If the task is already in_progress (stuck restart), it is excluded from the
 * capacity count so restarting is always allowed.
 * Returns a result so callers can provide user-facing feedback.
 *
 * For action 'started', success indicates the IPC start command was dispatched.
 * Backend failures are surfaced asynchronously through task status change events,
 * not through this return value.
 */
export async function startTaskOrQueue(taskId: string): Promise<StartTaskOrQueueResult> {
  const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
  // Exclude this task from the capacity check when it's already in_progress (stuck restart)
  const excludeId = task?.status === 'in_progress' ? taskId : undefined;

  if (isQueueAtCapacity(excludeId)) {
    const result = await persistTaskStatus(taskId, 'queue');
    if (!result.success) {
      console.error('[Queue] Failed to queue task:', taskId, result.error);
      return { action: 'queued', success: false, error: result.error };
    }
    return { action: 'queued', success: true };
  }

  startTask(taskId);
  return { action: 'started', success: true };
}

/**
 * Update task title/description/metadata and persist to file
 */
export async function persistUpdateTask(
  taskId: string,
  updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    // Call the IPC to persist changes to spec files
    const result = await window.electronAPI.updateTask(taskId, updates);

    if (result.success && result.data) {
      // Update local state with the returned task data
      store.updateTask(taskId, {
        title: result.data.title,
        description: result.data.description,
        metadata: result.data.metadata,
        updatedAt: new Date()
      });
      return true;
    }

    console.error('Failed to persist task update:', result.error);
    return false;
  } catch (error) {
    console.error('Error persisting task update:', error);
    return false;
  }
}

/**
 * Check if a task has an active running process
 */
export async function checkTaskRunning(taskId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.checkTaskRunning(taskId);
    return result.success && result.data === true;
  } catch (error) {
    console.error('Error checking task running status:', error);
    return false;
  }
}

/**
 * Recover a stuck task (status shows in_progress but no process running)
 * @param taskId - The task ID to recover
 * @param options - Recovery options (autoRestart defaults to true)
 */
export async function recoverStuckTask(
  taskId: string,
  options: { targetStatus?: TaskStatus; autoRestart?: boolean } = { autoRestart: true }
): Promise<{ success: boolean; message: string; autoRestarted?: boolean }> {
  try {
    const result = await window.electronAPI.recoverStuckTask(taskId, options);

    if (result.success && result.data) {
      return {
        success: true,
        message: result.data.message,
        autoRestarted: result.data.autoRestarted
      };
    }

    return {
      success: false,
      message: result.error || 'Failed to recover task'
    };
  } catch (error) {
    console.error('Error recovering stuck task:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Delete a task and its spec directory
 */
export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.deleteTask(taskId);

    if (result.success) {
      // Remove from local state
      store.setTasks(store.tasks.filter(t => t.id !== taskId && t.specId !== taskId));
      // Clear selection if this task was selected
      if (store.selectedTaskId === taskId) {
        store.selectTask(null);
      }
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to delete task'
    };
  } catch (error) {
    console.error('Error deleting task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Delete multiple tasks
 * Permanently removes tasks from the project
 */
export async function deleteTasks(
  taskIds: string[]
): Promise<{ success: boolean; error?: string; failedIds?: string[] }> {
  const store = useTaskStore.getState();
  const failedIds: string[] = [];

  try {
    // Delete tasks one by one (API only supports single delete)
    for (const taskId of taskIds) {
      const result = await window.electronAPI.deleteTask(taskId);
      if (!result.success) {
        failedIds.push(taskId);
      }
    }

    // Remove successfully deleted tasks from local state
    const deletedIds = new Set(taskIds.filter(id => !failedIds.includes(id)));
    store.setTasks(store.tasks.filter(t => !deletedIds.has(t.id) && !deletedIds.has(t.specId || '')));

    // Clear selection if selected task was deleted
    if (store.selectedTaskId && deletedIds.has(store.selectedTaskId)) {
      store.selectTask(null);
    }

    if (failedIds.length > 0) {
      return {
        success: false,
        error: `Failed to delete ${failedIds.length} task(s)`,
        failedIds
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting tasks:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Archive tasks
 * Marks tasks as archived by adding archivedAt timestamp to metadata
 */
export async function archiveTasks(
  projectId: string,
  taskIds: string[],
  version?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await window.electronAPI.archiveTasks(projectId, taskIds, version);

    if (result.success) {
      // Reload tasks to update the UI (archived tasks will be filtered out by default)
      await loadTasks(projectId);
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to archive tasks'
    };
  } catch (error) {
    console.error('Error archiving tasks:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// Task Creation Draft Management
// ============================================

const DRAFT_KEY_PREFIX = 'task-creation-draft';

/**
 * Get the localStorage key for a project's draft
 */
function getDraftKey(projectId: string): string {
  return `${DRAFT_KEY_PREFIX}-${projectId}`;
}

/**
 * Save a task creation draft to localStorage
 * Note: For large images, we only store thumbnails in the draft to avoid localStorage limits
 */
export function saveDraft(draft: TaskDraft): void {
  try {
    const key = getDraftKey(draft.projectId);
    // Create a copy with thumbnails only to avoid localStorage size limits
    const draftToStore = {
      ...draft,
      images: draft.images.map(img => ({
        ...img,
        data: undefined // Don't store full image data in localStorage
      })),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(draftToStore));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

/**
 * Load a task creation draft from localStorage
 */
export function loadDraft(projectId: string): TaskDraft | null {
  try {
    const key = getDraftKey(projectId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const draft = JSON.parse(stored);
    // Convert savedAt back to Date
    draft.savedAt = new Date(draft.savedAt);
    return draft as TaskDraft;
  } catch (error) {
    console.error('Failed to load draft:', error);
    return null;
  }
}

/**
 * Clear a task creation draft from localStorage
 */
export function clearDraft(projectId: string): void {
  try {
    const key = getDraftKey(projectId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear draft:', error);
  }
}

/**
 * Check if a draft exists for a project
 */
export function hasDraft(projectId: string): boolean {
  const key = getDraftKey(projectId);
  return localStorage.getItem(key) !== null;
}

/**
 * Check if a draft has any meaningful content (title, description, or images)
 */
export function isDraftEmpty(draft: TaskDraft | null): boolean {
  if (!draft) return true;
  return (
    !draft.title.trim() &&
    !draft.description.trim() &&
    draft.images.length === 0 &&
    !draft.category &&
    !draft.priority &&
    !draft.complexity &&
    !draft.impact
  );
}

// ============================================
// GitHub Issue Linking Helpers
// ============================================

/**
 * Find a task by GitHub issue number
 * Used to check if a task already exists for a GitHub issue
 */
export function getTaskByGitHubIssue(issueNumber: number): Task | undefined {
  const store = useTaskStore.getState();
  return store.tasks.find(t => t.metadata?.githubIssueNumber === issueNumber);
}

// ============================================
// Task State Detection Helpers
// ============================================

/**
 * Check if a task is in human_review but has no completed subtasks.
 * This indicates the task crashed/exited before implementation completed
 * and should be resumed rather than reviewed.
 */
export function isIncompleteHumanReview(task: Task): boolean {
  if (task.status !== 'human_review') return false;

  // JSON error tasks are intentionally in human_review with no subtasks - not incomplete
  // plan_review tasks are waiting for human approval before coding - not incomplete
  if (task.reviewReason === 'errors' || task.reviewReason === 'stopped' || task.reviewReason === 'plan_review') return false;

  // If no subtasks defined, task hasn't been planned yet (shouldn't be in human_review)
  if (!task.subtasks || task.subtasks.length === 0) return true;

  // Check if any subtasks are completed
  const completedSubtasks = task.subtasks.filter(s => s.status === 'completed').length;

  // If 0 completed subtasks, this task crashed before implementation
  return completedSubtasks === 0;
}

/**
 * Get the count of completed subtasks for a task
 */
export function getCompletedSubtaskCount(task: Task): number {
  if (!task.subtasks || task.subtasks.length === 0) return 0;
  return task.subtasks.filter(s => s.status === 'completed').length;
}

/**
 * Get task progress info
 */
export function getTaskProgress(task: Task): { completed: number; total: number; percentage: number } {
  const total = task.subtasks?.length || 0;
  const completed = task.subtasks?.filter(s => s.status === 'completed').length || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percentage };
}
