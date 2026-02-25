/**
 * Queue Routing API
 *
 * Preload API for rate limit recovery queue routing.
 * Exposes IPC methods to the renderer for profile-aware task distribution.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  IPCResult,
  RunningTasksByProfile,
  ProfileAssignmentReason,
  ProfileSwapRecord,
} from '../../shared/types';
import type { UnifiedAccount } from '../../shared/types/unified-account';

/**
 * Result of best profile selection for a task
 */
export interface BestProfileResult {
  profileId: string;
  profileName: string;
  availabilityScore: number;
  reason: ProfileAssignmentReason;
  runningTaskCount: number;
}

/**
 * Options for getting the best profile for a task
 */
export interface GetBestProfileOptions {
  /** Profile ID to exclude (e.g., one that just hit rate limit) */
  excludeProfileId?: string;
  /** Maximum tasks per profile before load balancing (default: 2) */
  perProfileMaxTasks?: number;
  /** Usage threshold (0-1) before considering profile "busy" (default: 0.85) */
  profileThreshold?: number;
}

/**
 * Options for getting the best unified account for a task
 */
export interface GetBestUnifiedAccountOptions {
  /** Unified account ID to exclude (e.g., 'oauth-profile1' or 'api-profile2') */
  excludeAccountId?: string;
}

/**
 * Profile swap notification event payload
 */
export interface QueueProfileSwapEvent {
  taskId: string;
  swap: ProfileSwapRecord;
}

/**
 * Session captured event payload
 */
export interface QueueSessionCapturedEvent {
  taskId: string;
  sessionId: string;
  capturedAt: string;
}

export interface QueueAPI {
  // Queue Routing Operations
  /**
   * Get running tasks grouped by profile
   * Used for queue routing decisions
   */
  getRunningTasksByProfile: () => Promise<IPCResult<RunningTasksByProfile>>;

  /**
   * Get the best available profile for a new task
   * Considers availability scores, running task counts, and rate limit status
   */
  getBestProfileForTask: (options?: GetBestProfileOptions) => Promise<IPCResult<BestProfileResult | null>>;

  /**
   * Get the best available unified account for a new task
   * Considers both OAuth profiles and API profiles in unified selection
   * Used for cross-type account switching when OAuth profiles are exhausted
   */
  getBestUnifiedAccount: (options?: GetBestUnifiedAccountOptions) => Promise<IPCResult<UnifiedAccount | null>>;

  /**
   * Assign a profile to a task
   * Called when a task is started or when profile is swapped
   */
  assignProfileToTask: (
    taskId: string,
    profileId: string,
    profileName: string,
    reason: ProfileAssignmentReason
  ) => Promise<IPCResult>;

  /**
   * Update session ID for a task
   * Called when session ID is captured from agent stdout
   */
  updateTaskSession: (taskId: string, sessionId: string) => Promise<IPCResult>;

  /**
   * Get session ID for a task
   */
  getTaskSession: (taskId: string) => Promise<IPCResult<string | null>>;

  // Queue Routing Event Listeners
  /**
   * Listen for profile swap events
   * Fired when a task's profile is swapped due to rate limit or capacity
   */
  onQueueProfileSwapped: (callback: (event: QueueProfileSwapEvent) => void) => () => void;

  /**
   * Listen for session captured events
   * Fired when a session ID is captured from a running task
   */
  onQueueSessionCaptured: (callback: (event: QueueSessionCapturedEvent) => void) => () => void;

  /**
   * Listen for queue blocked events
   * Fired when no profiles are available to run queued tasks
   */
  onQueueBlockedNoProfiles: (callback: (info: { reason: string; timestamp: string }) => void) => () => void;
}

export const createQueueAPI = (): QueueAPI => ({
  // Queue Routing Operations
  getRunningTasksByProfile: (): Promise<IPCResult<RunningTasksByProfile>> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE),

  getBestProfileForTask: (options?: GetBestProfileOptions): Promise<IPCResult<BestProfileResult | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_GET_BEST_PROFILE_FOR_TASK, options),

  getBestUnifiedAccount: (options?: GetBestUnifiedAccountOptions): Promise<IPCResult<UnifiedAccount | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_GET_BEST_UNIFIED_ACCOUNT, options),

  assignProfileToTask: (
    taskId: string,
    profileId: string,
    profileName: string,
    reason: ProfileAssignmentReason
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK, taskId, profileId, profileName, reason),

  updateTaskSession: (taskId: string, sessionId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_UPDATE_TASK_SESSION, taskId, sessionId),

  getTaskSession: (taskId: string): Promise<IPCResult<string | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.QUEUE_GET_TASK_SESSION, taskId),

  // Queue Routing Event Listeners
  onQueueProfileSwapped: (callback: (event: QueueProfileSwapEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: QueueProfileSwapEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_PROFILE_SWAPPED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_PROFILE_SWAPPED, handler);
  },

  onQueueSessionCaptured: (callback: (event: QueueSessionCapturedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: QueueSessionCapturedEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_SESSION_CAPTURED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_SESSION_CAPTURED, handler);
  },

  onQueueBlockedNoProfiles: (callback: (info: { reason: string; timestamp: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { reason: string; timestamp: string }) => callback(info);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES, handler);
  },
});
