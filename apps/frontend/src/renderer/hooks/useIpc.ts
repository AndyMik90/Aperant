import { useEffect } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useTaskStore } from '../stores/task-store';
import { useRoadmapStore } from '../stores/roadmap-store';
import { useRateLimitStore } from '../stores/rate-limit-store';
import { useProjectStore } from '../stores/project-store';
import { useInsightsTaskQueueStore } from '../stores/insights-task-queue-store';
import { useNotificationStore } from '../stores/notification-store';
import { toast } from './use-toast';  // FIX-7: Import toast for spec-ready notification
import type { ImplementationPlan, TaskStatus, RoadmapGenerationStatus, Roadmap, ExecutionProgress, RateLimitInfo, SDKRateLimitInfo } from '../../shared/types';

/**
 * Batched update queue for IPC events.
 * Collects updates within a 16ms window (one frame) and flushes them together.
 * This prevents multiple sequential re-renders when multiple IPC events arrive.
 */
interface BatchedUpdate {
  status?: TaskStatus;
  progress?: ExecutionProgress;
  plan?: ImplementationPlan;
  logs?: string[]; // Batched log lines
  queuedAt?: number; // For debug timing
}

/**
 * Store action references type for batch flushing.
 */
interface StoreActions {
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateExecutionProgress: (taskId: string, progress: ExecutionProgress) => void;
  updateTaskFromPlan: (taskId: string, plan: ImplementationPlan) => void;
  batchAppendLogs: (taskId: string, logs: string[]) => void;
}

/**
 * Module-level batch state.
 *
 * DESIGN NOTE: These module-level variables are intentionally shared across all hook instances.
 * This is acceptable because:
 * 1. There's only one Zustand store instance (singleton pattern)
 * 2. The app has a single main window that uses this hook
 * 3. Batching IPC updates at module level ensures all events within a frame are coalesced
 *
 * flushBatch() pulls fresh actions via useTaskStore.getState() to avoid stale closures.
 * storeActionsRef is only used for immediate (non-batched) phase change updates.
 */
const batchQueue = new Map<string, BatchedUpdate>();
let batchTimeout: NodeJS.Timeout | null = null;
let storeActionsRef: StoreActions | null = null;
let isListenersMounted = false; // Guard against updates after unmount

function flushBatch(): void {
  if (batchQueue.size === 0) return;

  const flushStart = performance.now();
  const updateCount = batchQueue.size;
  let totalUpdates = 0;
  let totalLogs = 0;

  // Use get() for current state to avoid stale closures from timer callbacks
  const store = useTaskStore.getState();
  const actions: StoreActions = {
    updateTaskStatus: store.updateTaskStatus,
    updateExecutionProgress: store.updateExecutionProgress,
    updateTaskFromPlan: store.updateTaskFromPlan,
    batchAppendLogs: store.batchAppendLogs,
  };

  // Batch all React updates together
  unstable_batchedUpdates(() => {
    batchQueue.forEach((updates, taskId) => {
      // Apply updates in order: status first (authoritative), then progress, then plan (derived data), then logs
      // Status must come before plan because updateTaskFromPlan recalculates status from subtask
      // completion, which could override a status event that arrived in the same batch window.
      if (updates.status) {
        actions.updateTaskStatus(taskId, updates.status);
        totalUpdates++;
      }
      if (updates.progress) {
        actions.updateExecutionProgress(taskId, updates.progress);
        totalUpdates++;
      }
      if (updates.plan) {
        actions.updateTaskFromPlan(taskId, updates.plan);
        totalUpdates++;
      }
      // Batch append all logs at once (instead of one state update per log line)
      if (updates.logs && updates.logs.length > 0) {
        actions.batchAppendLogs(taskId, updates.logs);
        totalLogs += updates.logs.length;
        totalUpdates++;
      }
    });
  });

  if (window.DEBUG) {
    const flushDuration = performance.now() - flushStart;
    console.warn(`[IPC Batch] Flushed ${totalUpdates} updates (${totalLogs} logs) for ${updateCount} tasks in ${flushDuration.toFixed(2)}ms`);
  }

  batchQueue.clear();
  batchTimeout = null;
}

function queueUpdate(taskId: string, update: BatchedUpdate): void {
  // Guard: don't queue updates after listeners have been unmounted
  if (!isListenersMounted) return;

  const existing = batchQueue.get(taskId) || {};

  // FIX 3.14: Add safety cap to prevent unbounded queue growth
  const MAX_BATCH_SIZE = 1000;
  if (batchQueue.size >= MAX_BATCH_SIZE) {
    if (window.DEBUG) {
      console.warn(`[IPC Batch] Queue size (${batchQueue.size}) exceeds limit, forcing flush`);
    }
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    flushBatch();
  }

  // FIX (ACS-55): Phase changes bypass batching - apply immediately
  // This ensures phase transitions are applied in order and not batched together,
  // so the UI accurately reflects each phase state (e.g., planning → coding shows both)
  // rather than skipping directly to the latest phase if they arrive within 16ms.
  // Phase changes are rare (~3-4 per task) vs progress ticks (hundreds), so this is safe for perf
  if (update.progress?.phase && storeActionsRef) {
    const currentPhase = existing.progress?.phase ||
      useTaskStore.getState().tasks.find(t => t.id === taskId || t.specId === taskId)?.executionProgress?.phase;

    if (update.progress.phase !== currentPhase) {
      // Flush any pending updates first to ensure correct ordering
      if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
        flushBatch();
      }
      // Apply phase change immediately
      if (window.DEBUG) {
        console.warn(`[IPC Batch] Phase change detected: ${currentPhase} → ${update.progress.phase}, applying immediately`);
      }
      storeActionsRef.updateExecutionProgress(taskId, update.progress);
      return;
    }
  }

  // For logs, accumulate rather than replace
  let mergedLogs = existing.logs;
  if (update.logs) {
    mergedLogs = [...(existing.logs || []), ...update.logs];
  }

  batchQueue.set(taskId, {
    ...existing,
    ...update,
    logs: mergedLogs,
    queuedAt: existing.queuedAt || performance.now()
  });

  // Schedule flush after 16ms (one frame at 60fps)
  if (!batchTimeout) {
    batchTimeout = setTimeout(flushBatch, 16);
  }
}

/**
 * Check if a task event is for the currently selected project.
 * This prevents multi-project interference where events from one project's
 * running task incorrectly update another project's task state (issue #723).
 * Handles backward compatibility and no-project-selected cases.
 */
function isTaskForCurrentProject(eventProjectId?: string): boolean {
  const currentProjectId = useProjectStore.getState().selectedProjectId;
  // If no project selected, accept the event
  if (!currentProjectId) return true;
  // If no projectId provided (backward compatibility), accept but warn
  if (!eventProjectId) {
    console.debug('[useIpc] Event missing projectId — accepting for backward compat');
    return true;
  }
  return currentProjectId === eventProjectId;
}

/**
 * Hook to set up IPC event listeners for task updates
 */
export function useIpcListeners(): void {
  const updateTaskFromPlan = useTaskStore((state) => state.updateTaskFromPlan);
  const updateTaskStatus = useTaskStore((state) => state.updateTaskStatus);
  const updateExecutionProgress = useTaskStore((state) => state.updateExecutionProgress);
  const appendLog = useTaskStore((state) => state.appendLog);
  const batchAppendLogs = useTaskStore((state) => state.batchAppendLogs);
  const setError = useTaskStore((state) => state.setError);

  useEffect(() => {
    // Update module-level store actions reference inside useEffect (not during render)
    // to avoid stale closures when the component re-renders between queuing and flushing
    storeActionsRef = { updateTaskStatus, updateExecutionProgress, updateTaskFromPlan, batchAppendLogs };
    isListenersMounted = true;

    // Set up listeners with batched updates
    const cleanupProgress = window.electronAPI.onTaskProgress(
      (taskId: string, plan: ImplementationPlan, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;
        queueUpdate(taskId, { plan });
      }
    );

    const cleanupError = window.electronAPI.onTaskError(
      (taskId: string, error: string, projectId?: string) => {
        // Filter by project to prevent multi-project interference (issue #723)
        if (!isTaskForCurrentProject(projectId)) return;
        // Errors are not batched - show immediately
        setError(`Task ${taskId}: ${error}`);
        appendLog(taskId, `[ERROR] ${error}`);
        // Add notification for task error
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Task Error',
          message: error,
          taskId,
        });
      }
    );

    const cleanupLog = window.electronAPI.onTaskLog(
      (taskId: string, log: string, projectId?: string) => {
        // Filter by project to prevent multi-project interference (issue #723)
        if (!isTaskForCurrentProject(projectId)) return;
        // Logs are now batched to reduce state updates (was causing 100+ updates/sec)
        queueUpdate(taskId, { logs: [log] });
      }
    );

    const cleanupStatus = window.electronAPI.onTaskStatusChange(
      (taskId: string, status: TaskStatus, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;
        queueUpdate(taskId, { status });

        // Toast notifications for key status transitions
        const taskStore = useTaskStore.getState();
        const task = taskStore.tasks.find(t => t.id === taskId);
        const taskTitle = task?.title ? (task.title.length > 40 ? task.title.slice(0, 40) + '...' : task.title) : taskId;

        if (status === 'human_review') {
          toast({
            title: '👀 Task needs review',
            description: taskTitle,
            duration: 6000,
          });
          // Add notification for human review
          useNotificationStore.getState().addNotification({
            type: 'warning',
            title: 'Task needs review',
            message: taskTitle,
            taskId,
            taskTitle,
          });
        } else if (status === 'done') {
          toast({
            title: '✅ Task completed',
            description: taskTitle,
            duration: 5000,
          });
          // Add notification for task completion
          useNotificationStore.getState().addNotification({
            type: 'success',
            title: 'Task completed',
            message: taskTitle,
            taskId,
            taskTitle,
          });
        } else if (status === 'ai_review') {
          toast({
            title: '🔍 AI reviewing task',
            description: taskTitle,
            duration: 4000,
          });
          // Add notification for AI review
          useNotificationStore.getState().addNotification({
            type: 'info',
            title: 'AI reviewing task',
            message: taskTitle,
            taskId,
            taskTitle,
          });
        }

        // Sync insights task queue: mark queue task as complete when Kanban task is done
        if (status === 'done') {
          const queueStore = useInsightsTaskQueueStore.getState();
          const queueTask = queueStore.tasks.find((t) => t.taskId === taskId);
          if (queueTask && queueTask.status === 'running') {
            queueStore.setTaskCompleted(queueTask.id);
          }
        }
      }
    );

    const cleanupExecutionProgress = window.electronAPI.onTaskExecutionProgress(
      (taskId: string, progress: ExecutionProgress, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        // This is the critical fix for issue #723 - without this check,
        // execution progress from Project A's task could update Project B's UI
        if (!isTaskForCurrentProject(projectId)) return;
        queueUpdate(taskId, { progress });
      }
    );

    const cleanupAgentStopped = window.electronAPI.onTaskAgentStopped(
      (taskId: string) => {
        // Mark agent as stopped for UI feedback
        useTaskStore.getState().setAgentStopped(taskId, true);
      }
    );

    // Companion agent event listeners
    const cleanupCompanionSpawned = window.electronAPI.onTaskCompanionSpawned(
      (taskId: string, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;
        // Mark companion as active
        useTaskStore.getState().setCompanionActive(taskId, true);
      }
    );

    const cleanupCompanionStopped = window.electronAPI.onTaskCompanionStopped(
      (taskId: string, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;
        // Mark companion as inactive
        useTaskStore.getState().setCompanionActive(taskId, false);
      }
    );

    // Supervisor agent event listeners
    const cleanupSupervisorSpawned = window.electronAPI.onTaskSupervisorSpawned(
      (taskId: string, projectId?: string) => {
        if (!isTaskForCurrentProject(projectId)) return;
        useTaskStore.getState().setSupervisorActive(taskId, true);
      }
    );

    const cleanupSupervisorStopped = window.electronAPI.onTaskSupervisorStopped(
      (taskId: string, projectId?: string) => {
        if (!isTaskForCurrentProject(projectId)) return;
        useTaskStore.getState().setSupervisorActive(taskId, false);
      }
    );

    // FIX-7: Listen for spec-ready events to show toast notification
    const cleanupSpecReady = window.electronAPI.onTaskSpecReady(
      (taskId: string, specId: string, projectId?: string) => {
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;

        // Find the task to get its title
        const task = useTaskStore.getState().tasks.find(t => t.id === taskId || t.specId === specId);
        const taskTitle = task?.title || specId;

        // Show toast notification
        toast({
          title: "Spec Ready for Review",
          description: `"${taskTitle}" spec is complete. Review and click "Start Build" to begin coding.`,
          duration: 10000, // 10 seconds - longer for important notification
        });
        // Add notification for spec ready
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'Spec Ready for Review',
          message: `"${taskTitle}" spec is complete`,
          taskId,
          taskTitle,
        });
      }
    );

    // Roadmap event listeners
    // Helper to check if event is for the currently viewed project
    const isCurrentProject = (eventProjectId: string): boolean => {
      const currentProjectId = useRoadmapStore.getState().currentProjectId;
      return currentProjectId === eventProjectId;
    };

    const cleanupRoadmapProgress = window.electronAPI.onRoadmapProgress(
      (projectId: string, status: RoadmapGenerationStatus) => {
        // Debug logging
        if (window.DEBUG) {
          console.warn('[Roadmap] Progress update:', {
            projectId,
            currentProjectId: useRoadmapStore.getState().currentProjectId,
            phase: status.phase,
            progress: status.progress,
            message: status.message
          });
        }
        // Only update if this is for the currently viewed project
        if (isCurrentProject(projectId)) {
          useRoadmapStore.getState().setGenerationStatus(status);
        }
      }
    );

    const cleanupRoadmapComplete = window.electronAPI.onRoadmapComplete(
      (projectId: string, roadmap: Roadmap) => {
        // Debug logging
        if (window.DEBUG) {
          console.warn('[Roadmap] Generation complete:', {
            projectId,
            currentProjectId: useRoadmapStore.getState().currentProjectId,
            featuresCount: roadmap.features?.length || 0,
            phasesCount: roadmap.phases?.length || 0
          });
        }
        // Only update if this is for the currently viewed project
        if (isCurrentProject(projectId)) {
          useRoadmapStore.getState().setRoadmap(roadmap);
          useRoadmapStore.getState().setGenerationStatus({
            phase: 'complete',
            progress: 100,
            message: 'Roadmap ready'
          });
        }
      }
    );

    const cleanupRoadmapError = window.electronAPI.onRoadmapError(
      (projectId: string, error: string) => {
        // Debug logging
        if (window.DEBUG) {
          console.error('[Roadmap] Error received:', {
            projectId,
            currentProjectId: useRoadmapStore.getState().currentProjectId,
            error
          });
        }
        // Only update if this is for the currently viewed project
        if (isCurrentProject(projectId)) {
          useRoadmapStore.getState().setGenerationStatus({
            phase: 'error',
            progress: 0,
            message: 'Generation failed',
            error
          });
        }
      }
    );

    const cleanupRoadmapStopped = window.electronAPI.onRoadmapStopped(
      (projectId: string) => {
        // Debug logging
        if (window.DEBUG) {
          console.warn('[Roadmap] Generation stopped:', {
            projectId,
            currentProjectId: useRoadmapStore.getState().currentProjectId
          });
        }
        // Only update if this is for the currently viewed project
        if (isCurrentProject(projectId)) {
          useRoadmapStore.getState().setGenerationStatus({
            phase: 'idle',
            progress: 0,
            message: 'Generation stopped'
          });
        }
      }
    );

    // Terminal rate limit listener
    const showRateLimitModal = useRateLimitStore.getState().showRateLimitModal;
    const cleanupRateLimit = window.electronAPI.onTerminalRateLimit(
      (info: RateLimitInfo) => {
        // Convert detectedAt string to Date if needed
        showRateLimitModal({
          ...info,
          detectedAt: typeof info.detectedAt === 'string'
            ? new Date(info.detectedAt)
            : info.detectedAt
        });
      }
    );

    // SDK rate limit listener (for changelog, tasks, roadmap, ideation)
    const showSDKRateLimitModal = useRateLimitStore.getState().showSDKRateLimitModal;
    const cleanupSDKRateLimit = window.electronAPI.onSDKRateLimit(
      (info: SDKRateLimitInfo) => {
        // Convert detectedAt string to Date if needed
        showSDKRateLimitModal({
          ...info,
          detectedAt: typeof info.detectedAt === 'string'
            ? new Date(info.detectedAt)
            : info.detectedAt
        });
      }
    );

    // Cleanup on unmount
    return () => {
      // Mark as unmounted first to prevent new updates from being queued
      isListenersMounted = false;
      storeActionsRef = null;

      // Flush any pending batched updates before cleanup
      if (batchTimeout) {
        clearTimeout(batchTimeout);
        flushBatch();
        batchTimeout = null;
      }
      cleanupProgress();
      cleanupError();
      cleanupLog();
      cleanupStatus();
      cleanupExecutionProgress();
      cleanupAgentStopped();
      cleanupCompanionSpawned();
      cleanupCompanionStopped();
      cleanupSupervisorSpawned();
      cleanupSupervisorStopped();
      cleanupSpecReady();  // FIX-7
      cleanupRoadmapProgress();
      cleanupRoadmapComplete();
      cleanupRoadmapError();
      cleanupRoadmapStopped();
      cleanupRateLimit();
      cleanupSDKRateLimit();
    };
  }, [updateTaskFromPlan, updateTaskStatus, updateExecutionProgress, appendLog, batchAppendLogs, setError]);
}

/**
 * Hook to manage app settings
 */
export function useAppSettings() {
  const getSettings = async () => {
    const result = await window.electronAPI.getSettings();
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  };

  const saveSettings = async (settings: Parameters<typeof window.electronAPI.saveSettings>[0]) => {
    const result = await window.electronAPI.saveSettings(settings);
    return result.success;
  };

  return { getSettings, saveSettings };
}

/**
 * Hook to get the app version
 */
export function useAppVersion() {
  const getVersion = async () => {
    return window.electronAPI.getAppVersion();
  };

  return { getVersion };
}
