import { useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useTaskStore, loadTasks } from '../stores/task-store';
import { useRoadmapStore } from '../stores/roadmap-store';
import { useRateLimitStore } from '../stores/rate-limit-store';
import { useAuthFailureStore } from '../stores/auth-failure-store';
import { loadProjects, useProjectStore } from '../stores/project-store';
import type {
  AuthFailureInfo,
  ExecutionProgress,
  ImplementationPlan,
  ProjectAutomationSettingsChangedEvent,
  RateLimitInfo,
  Roadmap,
  RoadmapGenerationStatus,
  SDKRateLimitInfo,
  TaskStatus,
} from '../../shared/types';

/** Maximum log entries to buffer in the batch queue between flushes (OOM prevention) */
const MAX_BATCH_QUEUE_LOGS = 100;

/**
 * Batched update queue for IPC events.
 * Collects updates within a 16ms window (one frame) and flushes them together.
 * This prevents multiple sequential re-renders when multiple IPC events arrive.
 */
interface BatchedUpdate {
  status?: TaskStatus;
  reviewReason?: import('../../shared/types').ReviewReason;
  progress?: ExecutionProgress;
  plan?: ImplementationPlan;
  logs?: string[]; // Batched log lines
  queuedAt?: number; // For debug timing
}

/**
 * Store action references type for batch flushing.
 */
interface StoreActions {
  updateTaskStatus: (taskId: string, status: TaskStatus, reviewReason?: import('../../shared/types').ReviewReason) => void;
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
 * The storeActionsRef pattern ensures we always have the latest action references when
 * flushing, avoiding stale closure issues from component re-renders.
 */
const batchQueue = new Map<string, BatchedUpdate>();
let batchTimeout: NodeJS.Timeout | null = null;
let storeActionsRef: StoreActions | null = null;

function flushBatch(): void {
  if (batchQueue.size === 0 || !storeActionsRef) return;

  const flushStart = performance.now();
  const updateCount = batchQueue.size;
  let totalUpdates = 0;
  let totalLogs = 0;

  // Capture current actions reference to avoid stale closures during batch processing
  const actions = storeActionsRef;

  // Batch all React updates together
  unstable_batchedUpdates(() => {
    batchQueue.forEach((updates, taskId) => {
      // Apply updates in order: plan first (has most data), then status, then progress, then logs
      if (updates.plan) {
        actions.updateTaskFromPlan(taskId, updates.plan);
        totalUpdates++;
      }
      if (updates.status) {
        actions.updateTaskStatus(taskId, updates.status, updates.reviewReason);
        totalUpdates++;
      }
      if (updates.progress) {
        actions.updateExecutionProgress(taskId, updates.progress);
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
  const existing = batchQueue.get(taskId) || {};

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
    // Cap batch queue logs to prevent OOM when logs arrive faster than flush interval
    if (mergedLogs.length > MAX_BATCH_QUEUE_LOGS) {
      mergedLogs = mergedLogs.slice(-MAX_BATCH_QUEUE_LOGS);
    }
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
  // If no projectId provided (backward compatibility), accept the event
  if (!eventProjectId) return true;
  const { activeProjectId, selectedProjectId } = useProjectStore.getState();
  // Keep filtering aligned with App task loading logic (active first, selected fallback)
  const currentProjectId = activeProjectId || selectedProjectId;
  // If no project selected/active, accept the event
  if (!currentProjectId) return true;
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
  const updateProject = useProjectStore((state) => state.updateProject);

  // Update module-level store actions reference for batch flushing
  // This ensures flushBatch() always has access to current action implementations
  storeActionsRef = { updateTaskStatus, updateExecutionProgress, updateTaskFromPlan, batchAppendLogs };

  useEffect(() => {
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
      (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: import('../../shared/types').ReviewReason) => {
        // Debug: Log received status change (use console.warn + stringified for devtools visibility)
        console.warn(`[useIpc] TASK_STATUS_CHANGE: ${taskId} → ${status} (reason: ${reviewReason || 'none'}, project: ${projectId || 'unknown'})`);
        // Filter by project to prevent multi-project interference
        if (!isTaskForCurrentProject(projectId)) return;
        queueUpdate(taskId, { status, reviewReason });

        // Sync roadmap feature when task completes
        if (status === 'done' || status === 'pr_created') {
          useRoadmapStore.getState().markFeatureDoneBySpecId(taskId);
          // Re-read state after mutation to get updated roadmap
          const rm = useRoadmapStore.getState().roadmap;
          const currentProjectId = useProjectStore.getState().activeProjectId || useProjectStore.getState().selectedProjectId;
          if (rm && currentProjectId) {
            window.electronAPI.saveRoadmap(currentProjectId, rm).catch((err) => {
              console.error('[useIpc] Failed to persist roadmap after task completion:', err);
            });
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

    // Auth failure listener (401 errors requiring re-authentication)
    const showAuthFailureModal = useAuthFailureStore.getState().showAuthFailureModal;
    const cleanupAuthFailure = window.electronAPI.onAuthFailure(
      (info: AuthFailureInfo) => {
        // Convert detectedAt string to Date if needed
        showAuthFailureModal({
          ...info,
          detectedAt: typeof info.detectedAt === 'string'
            ? new Date(info.detectedAt)
            : info.detectedAt
        });
      }
    );

    // Task list refresh listener (for MCP-created tasks)
    // Debounced to coalesce rapid-fire refresh events (main + worktree file writes)
    // Note: loadTasks is imported directly from task-store.ts (it's a standalone function, not a store method)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanupTaskListRefresh = window.electronAPI.onTaskListRefresh(
      (projectId: string) => {
        // Only refresh if this is for the currently selected project
        if (isTaskForCurrentProject(projectId)) {
          // Debounce: coalesce multiple rapid refresh events into one
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            refreshTimer = null;
            console.log('[IPC] Task list refresh (debounced) for project:', projectId);
            // Light refresh: cache already invalidated in main process by agent-events handler
            // Do NOT use forceRefresh — it calls clearAllTasks() which destroys running XState actors
            loadTasks(projectId);
          }, 500);
        }
      }
    );

    // Task auto-start listener (for MCP start_task requests)
    const cleanupTaskAutoStart = window.electronAPI.onTaskAutoStart(
      (projectId: string, taskId: string) => {
        // Only auto-start if this is for the currently selected project
        if (isTaskForCurrentProject(projectId)) {
          console.log('[IPC] Task auto-start requested for task:', taskId);
          // Light refresh: cache already invalidated in main process
          loadTasks(projectId).then(() => {
            // Then trigger the task start
            window.electronAPI.startTask(taskId);
          });
        }
      }
    );

    // Task status changed listener (for RDR auto-recovery)
    const cleanupTaskStatusChanged = window.electronAPI.onTaskStatusChanged(
      (data: {
        projectId: string;
        taskId: string;
        specId: string;
        oldStatus: import('../../shared/types').TaskStatus;
        newStatus: import('../../shared/types').TaskStatus;
      }) => {
        // Only refresh if this is for the currently selected project
        if (isTaskForCurrentProject(data.projectId)) {
          console.log(`[IPC] Task ${data.specId} status changed: ${data.oldStatus} → ${data.newStatus}`);
          // Light refresh: cache already invalidated in main process
          loadTasks(data.projectId);
        }
      }
    );

    // Rate limit auto-resume listener (after waiting for rate limit reset)
    const cleanupRateLimitAutoResume = window.electronAPI.onRateLimitAutoResume(
      (data: { taskId: string; projectId: string; source: string; profileId: string }) => {
        // Only auto-resume if this is for the currently selected project
        if (isTaskForCurrentProject(data.projectId)) {
          console.log('[IPC] Rate limit auto-resume requested for task:', data.taskId);
          // Light refresh: cache already invalidated in main process
          loadTasks(data.projectId).then(() => {
            // Then trigger the task start
            window.electronAPI.startTask(data.taskId);
          });
        }
      }
    );

    const cleanupProjectAutomationSettingsChanged = window.electronAPI.onProjectAutomationSettingsChanged(
      (event: ProjectAutomationSettingsChangedEvent) => {
        const store = useProjectStore.getState();
        const project = store.projects.find((candidate) => candidate.id === event.projectId);

        if (!project) {
          loadProjects().catch((error) => {
            console.error('[useIpc] Failed to reload projects after automation settings update:', error);
          });
          return;
        }

        updateProject(event.projectId, {
          settings: {
            ...project.settings,
            ...event.settings,
          },
        });
      }
    );

    // Debug event listener (force-recovery, agent kills, etc.)
    const cleanupDebugEvent = window.electronAPI.onDebugEvent?.(
      (data: { type: string; taskId?: string; agentKilled?: boolean; timestamp: string }) => {
        console.warn(`[DEBUG] ${data.type}: task=${data.taskId || 'unknown'} agentKilled=${data.agentKilled ?? 'n/a'} @ ${data.timestamp}`);
      }
    );

    // Cleanup on unmount
    return () => {
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
      cleanupRoadmapProgress();
      cleanupRoadmapComplete();
      cleanupRoadmapError();
      cleanupRoadmapStopped();
      cleanupRateLimit();
      cleanupSDKRateLimit();
      cleanupAuthFailure();
      cleanupTaskListRefresh();
      if (refreshTimer) clearTimeout(refreshTimer);
      cleanupTaskAutoStart();
      cleanupTaskStatusChanged();
      cleanupRateLimitAutoResume();
      cleanupProjectAutomationSettingsChanged();
      cleanupDebugEvent?.();
    };
  }, [appendLog, setError, updateProject]);
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
