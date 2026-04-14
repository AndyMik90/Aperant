import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  Task,
  IPCResult,
  TaskStartOptions,
  TaskStatus,
  TaskRecoveryResult,
  ImplementationPlan,
  TaskMetadata,
  TaskLogs,
  TaskLogStreamChunk,
  ReviewReason,
  MergeProgress,
  SupportedIDE,
  SupportedTerminal,
  WorktreeCreatePROptions,
  WorktreeCreatePRResult,
  ImageAttachment,
  AutoShutdownStatus
} from '../../shared/types';

// Types for detailed RDR batch information
export interface RdrTaskDetail {
  specId: string;
  title: string;
  description: string;
  status: TaskStatus;
  reviewReason?: string;
  exitReason?: string;
  subtasks?: Array<{ name: string; status: string }>;
  errorSummary?: string;
}

export interface RdrBatchDetails {
  batches: Array<{
    type: 'json_error' | 'incomplete' | 'qa_rejected' | 'errors';
    taskIds: string[];
    taskCount: number;
  }>;
  taskDetails: RdrTaskDetail[];
}

export interface AssignedWindow {
  handle?: number;
  processId: number;
  title: string;
  provider?: string;
  assignedAt: string;
}

export interface TaskAPI {
  // Task Operations
  getTasks: (projectId: string, options?: { forceRefresh?: boolean }) => Promise<IPCResult<Task[]>>;
  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ) => Promise<IPCResult<Task>>;
  deleteTask: (taskId: string) => Promise<IPCResult>;
  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string }
  ) => Promise<IPCResult<Task>>;
  startTask: (taskId: string, options?: TaskStartOptions) => void;
  stopTask: (taskId: string, options?: { skipRdrDisable?: boolean }) => void;
  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string,
    images?: ImageAttachment[]
  ) => Promise<IPCResult>;
  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    options?: { forceCleanup?: boolean }
  ) => Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }>;
  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ) => Promise<IPCResult<TaskRecoveryResult>>;
  checkTaskRunning: (taskId: string) => Promise<IPCResult<boolean>>;
  resumePausedTask: (taskId: string) => Promise<IPCResult>;

  // Worktree Change Detection
  checkWorktreeChanges: (taskId: string) => Promise<IPCResult<{ hasChanges: boolean; worktreePath?: string; changedFileCount?: number }>>;

  // Image Operations
  loadImageThumbnail: (projectPath: string, specId: string, imagePath: string) => Promise<IPCResult<string>>;

  // Workspace Management (for human review)
  getWorktreeStatus: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeStatus>>;
  getWorktreeDiff: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiff>>;
  mergeWorktree: (taskId: string, options?: { noCommit?: boolean }) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  mergeWorktreePreview: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  discardWorktree: (taskId: string, skipStatusChange?: boolean) => Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>>;
  discardOrphanedWorktree: (projectId: string, specName: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>>;
  clearStagedState: (taskId: string) => Promise<IPCResult<{ cleared: boolean }>>;
  listWorktrees: (projectId: string, options?: { includeStats?: boolean }) => Promise<IPCResult<import('../../shared/types').WorktreeListResult>>;
  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeDetectTools: () => Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>>;
  archiveTasks: (projectId: string, taskIds: string[], version?: string) => Promise<IPCResult<boolean>>;
  unarchiveTasks: (projectId: string, taskIds: string[]) => Promise<IPCResult<boolean>>;
  toggleTaskRdr: (taskId: string, disabled: boolean) => Promise<IPCResult<boolean>>;
  createWorktreePR: (taskId: string, options?: WorktreeCreatePROptions) => Promise<IPCResult<WorktreeCreatePRResult>>;

  // Task Event Listeners
  // Note: projectId is optional for backward compatibility - events without projectId will still work
  onTaskProgress: (callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void) => () => void;
  onTaskError: (callback: (taskId: string, error: string, projectId?: string) => void) => () => void;
  onTaskLog: (callback: (taskId: string, log: string, projectId?: string) => void) => () => void;
  onTaskStatusChange: (callback: (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: ReviewReason) => void) => () => void;
  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ) => () => void;
  onTaskListRefresh: (callback: (projectId: string) => void) => () => void;
  onTaskAutoStart: (callback: (projectId: string, taskId: string) => void) => () => void;
  onTaskStatusChanged: (callback: (data: {
    projectId: string;
    taskId: string;
    specId: string;
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
  }) => void) => () => void;
  onTaskRegressionDetected: (callback: (data: {
    projectId: string;
    specId: string;
    oldStatus: string;
    newStatus: string;
    timestamp: string;
  }) => void) => () => void;

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string) => Promise<IPCResult<TaskLogs | null>>;
  watchTaskLogs: (projectId: string, specId: string) => Promise<IPCResult>;
  unwatchTaskLogs: (specId: string) => Promise<IPCResult>;
  onTaskLogsChanged: (callback: (specId: string, logs: TaskLogs) => void) => () => void;
  onTaskLogsStream: (callback: (specId: string, chunk: TaskLogStreamChunk) => void) => () => void;

  // Merge Progress Events
  onMergeProgress: (callback: (taskId: string, progress: MergeProgress) => void) => () => void;

  // RDR (Recover Debug Resend) Processing
  triggerRdrProcessing: (projectId: string, taskIds: string[]) => Promise<IPCResult<{ processed: number }>>;
  pingRdrImmediate: (projectId: string, tasks: Task[]) => Promise<IPCResult<{ taskCount: number; signalPath: string }>>;
  autoRecoverAllTasks: (projectId: string) => Promise<IPCResult<{ recovered: number; taskIds: string[] }>>;

  // VS Code Window Management (for RDR message sending)
  getVSCodeWindows: () => Promise<IPCResult<Array<{ handle: number; title: string; processId: number }>>>;
  sendRdrToWindow: (identifier: number | string, message: string) => Promise<IPCResult<{ success: boolean; error?: string }>>;
  sendTestRdrToWindow: (identifier: number | string) => Promise<IPCResult<{ success: boolean; error?: string }>>;

  // Detailed RDR batch info for auto-send
  getRdrBatchDetails: (projectId: string) => Promise<IPCResult<RdrBatchDetails>>;
  isClaudeCodeBusy: (identifier: number | string) => Promise<IPCResult<boolean>>;

  // RDR Rate Limit Pause
  getRdrCooldownStatus: () => Promise<IPCResult<{ paused: boolean; reason: string; rateLimitResetAt: number }>>;
  onRdrRateLimited: (callback: (data: { paused: boolean; reason: string; rateLimitResetAt: number }) => void) => () => void;
  onRdrRateLimitCleared: (callback: (data: { reason: string }) => void) => () => void;

  // Auto Shutdown (Global - monitors ALL projects)
  getAutoShutdownStatus: () => Promise<IPCResult<AutoShutdownStatus>>;
  setAutoShutdown: (enabled: boolean) => Promise<IPCResult<AutoShutdownStatus>>;
  cancelAutoShutdown: () => Promise<IPCResult<void>>;

  // Debug Events (forwarded from main process for devtools logging)
  onDebugEvent: (callback: (data: { type: string; taskId?: string; agentKilled?: boolean; timestamp: string; [key: string]: unknown }) => void) => () => void;
}

export const createTaskAPI = (): TaskAPI => ({
  // Task Operations
  getTasks: (projectId: string, options?: { forceRefresh?: boolean }): Promise<IPCResult<Task[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, projectId, options),

  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, projectId, title, description, metadata),

  deleteTask: (taskId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, taskId),

  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string }
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE, taskId, updates),

  startTask: (taskId: string, options?: TaskStartOptions): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_START, taskId, options),

  stopTask: (taskId: string, options?: { skipRdrDisable?: boolean }): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_STOP, taskId, options),

  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string,
    images?: ImageAttachment[]
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REVIEW, taskId, approved, feedback, images),

  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    options?: { forceCleanup?: boolean }
  ): Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE_STATUS, taskId, status, options),

  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ): Promise<IPCResult<TaskRecoveryResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RECOVER_STUCK, taskId, options),

  checkTaskRunning: (taskId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CHECK_RUNNING, taskId),

  resumePausedTask: (taskId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RESUME_PAUSED, taskId),

  // Worktree Change Detection
  checkWorktreeChanges: (taskId: string): Promise<IPCResult<{ hasChanges: boolean; worktreePath?: string; changedFileCount?: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CHECK_WORKTREE_CHANGES, taskId),

  // Image Operations
  loadImageThumbnail: (projectPath: string, specId: string, imagePath: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOAD_IMAGE_THUMBNAIL, projectPath, specId, imagePath),

  // Workspace Management
  getWorktreeStatus: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_STATUS, taskId),

  getWorktreeDiff: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeDiff>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DIFF, taskId),

  mergeWorktree: (taskId: string, options?: { noCommit?: boolean }): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE, taskId, options),

  mergeWorktreePreview: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE_PREVIEW, taskId),

  discardWorktree: (taskId: string, skipStatusChange?: boolean): Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DISCARD, taskId, skipStatusChange),

  discardOrphanedWorktree: (projectId: string, specName: string): Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DISCARD_ORPHAN, projectId, specName),

  clearStagedState: (taskId: string): Promise<IPCResult<{ cleared: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CLEAR_STAGED_STATE, taskId),

  listWorktrees: (projectId: string, options?: { includeStats?: boolean }): Promise<IPCResult<import('../../shared/types').WorktreeListResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_WORKTREES, projectId, options),

  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_IDE, worktreePath, ide, customPath),

  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_TERMINAL, worktreePath, terminal, customPath),

  worktreeDetectTools: (): Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DETECT_TOOLS),

  archiveTasks: (projectId: string, taskIds: string[], version?: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_ARCHIVE, projectId, taskIds, version),

  unarchiveTasks: (projectId: string, taskIds: string[]): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UNARCHIVE, projectId, taskIds),

  toggleTaskRdr: (taskId: string, disabled: boolean): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_TOGGLE_RDR, taskId, disabled),

  createWorktreePR: (taskId: string, options?: WorktreeCreatePROptions): Promise<IPCResult<WorktreeCreatePRResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_CREATE_PR, taskId, options),

  // Task Event Listeners
  onTaskProgress: (
    callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      plan: ImplementationPlan,
      projectId?: string
    ): void => {
      callback(taskId, plan, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_PROGRESS, handler);
    };
  },

  onTaskError: (
    callback: (taskId: string, error: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      error: string,
      projectId?: string
    ): void => {
      callback(taskId, error, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_ERROR, handler);
    };
  },

  onTaskLog: (
    callback: (taskId: string, log: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      log: string,
      projectId?: string
    ): void => {
      callback(taskId, log, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOG, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOG, handler);
    };
  },

  onTaskStatusChange: (
    callback: (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: ReviewReason) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      status: TaskStatus,
      projectId?: string,
      reviewReason?: ReviewReason
    ): void => {
      callback(taskId, status, projectId, reviewReason);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    };
  },

  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      progress: import('../../shared/types').ExecutionProgress,
      projectId?: string
    ): void => {
      callback(taskId, progress, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    };
  },

  onTaskListRefresh: (callback: (projectId: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      projectId: string
    ): void => {
      callback(projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LIST_REFRESH, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LIST_REFRESH, handler);
    };
  },

  onTaskAutoStart: (callback: (projectId: string, taskId: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      projectId: string,
      taskId: string
    ): void => {
      callback(projectId, taskId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_AUTO_START, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_AUTO_START, handler);
    };
  },

  onTaskStatusChanged: (callback: (data: {
    projectId: string;
    taskId: string;
    specId: string;
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
  }) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        projectId: string;
        taskId: string;
        specId: string;
        oldStatus: TaskStatus;
        newStatus: TaskStatus;
      }
    ): void => {
      callback(data);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STATUS_CHANGED, handler);
    };
  },

  onTaskRegressionDetected: (
    callback: (data: { projectId: string; specId: string; oldStatus: string; newStatus: string; timestamp: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { projectId: string; specId: string; oldStatus: string; newStatus: string; timestamp: string }
    ): void => {
      callback(data);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_REGRESSION_DETECTED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_REGRESSION_DETECTED, handler);
    };
  },

  // Auto-refresh trigger (from file watcher)
  onTaskAutoRefresh: (
    callback: (data: { reason: string; projectId: string; specId: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { reason: string; projectId: string; specId: string }
    ): void => {
      callback(data);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_AUTO_REFRESH_TRIGGER, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_AUTO_REFRESH_TRIGGER, handler);
    };
  },

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_GET, projectId, specId),

  watchTaskLogs: (projectId: string, specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_WATCH, projectId, specId),

  unwatchTaskLogs: (specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_UNWATCH, specId),

  onTaskLogsChanged: (
    callback: (specId: string, logs: TaskLogs) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      logs: TaskLogs
    ): void => {
      callback(specId, logs);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    };
  },

  onTaskLogsStream: (
    callback: (specId: string, chunk: TaskLogStreamChunk) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      chunk: TaskLogStreamChunk
    ): void => {
      callback(specId, chunk);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    };
  },

  // Merge Progress Events
  onMergeProgress: (
    callback: (taskId: string, progress: MergeProgress) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      progress: MergeProgress
    ): void => {
      callback(taskId, progress);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_MERGE_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_MERGE_PROGRESS, handler);
    };
  },

  // RDR (Recover Debug Resend) Processing
  triggerRdrProcessing: (projectId: string, taskIds: string[]): Promise<IPCResult<{ processed: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_RDR_PROCESSING, projectId, taskIds),

  // Immediate RDR ping - writes signal file now (no 30s timer)
  pingRdrImmediate: (projectId: string, tasks: Task[]): Promise<IPCResult<{ taskCount: number; signalPath: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PING_RDR_IMMEDIATE, projectId, tasks),

  // Auto-recover all tasks with start_requested status or incomplete subtasks
  autoRecoverAllTasks: (projectId: string): Promise<IPCResult<{ recovered: number; taskIds: string[] }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTO_RECOVER_ALL_TASKS, projectId),

  // VS Code Window Management (for RDR message sending)
  getVSCodeWindows: (): Promise<IPCResult<Array<{ handle: number; title: string; processId: number }>>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_VSCODE_WINDOWS),

  sendRdrToWindow: (identifier: number | string, message: string): Promise<IPCResult<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_RDR_TO_WINDOW, identifier, message),

  sendTestRdrToWindow: (identifier: number | string): Promise<IPCResult<{ success: boolean; error?: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_TEST_RDR_TO_WINDOW, identifier),

  getAssignedWindow: (projectId: string): Promise<IPCResult<AssignedWindow | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.RDR_GET_ASSIGNED_WINDOW, projectId),

  setAssignedWindow: (projectId: string, window: { handle: number; processId: number; title: string }): Promise<IPCResult<AssignedWindow>> =>
    ipcRenderer.invoke(IPC_CHANNELS.RDR_SET_ASSIGNED_WINDOW, projectId, window),

  // Detailed RDR batch info for auto-send
  getRdrBatchDetails: (projectId: string): Promise<IPCResult<RdrBatchDetails>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_RDR_BATCH_DETAILS, projectId),

  // Check if Claude Code is busy (in a prompt loop)
  isClaudeCodeBusy: (identifier: number | string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.IS_CLAUDE_CODE_BUSY, identifier),

  // RDR Rate Limit Pause
  getRdrCooldownStatus: (): Promise<IPCResult<{ paused: boolean; reason: string; rateLimitResetAt: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.RDR_GET_COOLDOWN_STATUS),

  onRdrRateLimited: (
    callback: (data: { paused: boolean; reason: string; rateLimitResetAt: number }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { paused: boolean; reason: string; rateLimitResetAt: number }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.RDR_RATE_LIMITED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RDR_RATE_LIMITED, handler);
  },

  onRdrRateLimitCleared: (
    callback: (data: { reason: string }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { reason: string }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.RDR_RATE_LIMIT_CLEARED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RDR_RATE_LIMIT_CLEARED, handler);
  },

  // Auto Shutdown (Global - monitors ALL projects)
  getAutoShutdownStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_AUTO_SHUTDOWN_STATUS),

  setAutoShutdown: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_AUTO_SHUTDOWN, enabled),

  cancelAutoShutdown: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CANCEL_AUTO_SHUTDOWN),

  // Debug Events
  onDebugEvent: (
    callback: (data: { type: string; taskId?: string; agentKilled?: boolean; timestamp: string; [key: string]: unknown }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { type: string; taskId?: string; agentKilled?: boolean; timestamp: string }
    ): void => {
      callback(data);
    };
    ipcRenderer.on(IPC_CHANNELS.DEBUG_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DEBUG_EVENT, handler);
    };
  }
});
