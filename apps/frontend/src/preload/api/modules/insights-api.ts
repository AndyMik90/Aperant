import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsModelConfig,
  Task,
  TaskMetadata,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Insights API operations
 */
export interface InsightsAPI {
  // Operations
  getInsightsSession: (projectId: string) => Promise<IPCResult<InsightsSession | null>>;
  sendInsightsMessage: (projectId: string, message: string, modelConfig?: InsightsModelConfig) => void;
  clearInsightsSession: (projectId: string) => Promise<IPCResult>;
  createTaskFromInsights: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ) => Promise<IPCResult<Task>>;
  listInsightsSessions: (projectId: string) => Promise<IPCResult<InsightsSessionSummary[]>>;
  newInsightsSession: (projectId: string) => Promise<IPCResult<InsightsSession>>;
  switchInsightsSession: (projectId: string, sessionId: string) => Promise<IPCResult<InsightsSession | null>>;
  deleteInsightsSession: (projectId: string, sessionId: string) => Promise<IPCResult>;
  renameInsightsSession: (projectId: string, sessionId: string, newTitle: string) => Promise<IPCResult>;
  updateInsightsModelConfig: (projectId: string, sessionId: string, modelConfig: InsightsModelConfig) => Promise<IPCResult>;

  // Event Listeners
  onInsightsStreamChunk: (
    callback: (projectId: string, chunk: InsightsStreamChunk) => void
  ) => IpcListenerCleanup;
  onInsightsStatus: (
    callback: (projectId: string, status: InsightsChatStatus) => void
  ) => IpcListenerCleanup;
  onInsightsError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
  onInsightsSessionUpdated: (
    callback: (projectId: string, session: InsightsSession) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Insights API implementation
 */
export const createInsightsAPI = (): InsightsAPI => ({
  // Operations
  getInsightsSession: (projectId: string): Promise<IPCResult<InsightsSession | null>> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_GET_SESSION, projectId),

  sendInsightsMessage: (projectId: string, message: string, modelConfig?: InsightsModelConfig): void =>
    sendIpc(IPC_CHANNELS.INSIGHTS_SEND_MESSAGE, projectId, message, modelConfig),

  clearInsightsSession: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_CLEAR_SESSION, projectId),

  createTaskFromInsights: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ): Promise<IPCResult<Task>> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_CREATE_TASK, projectId, title, description, metadata),

  listInsightsSessions: (projectId: string): Promise<IPCResult<InsightsSessionSummary[]>> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_LIST_SESSIONS, projectId),

  newInsightsSession: (projectId: string): Promise<IPCResult<InsightsSession>> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_NEW_SESSION, projectId),

  switchInsightsSession: (projectId: string, sessionId: string): Promise<IPCResult<InsightsSession | null>> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_SWITCH_SESSION, projectId, sessionId),

  deleteInsightsSession: (projectId: string, sessionId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_DELETE_SESSION, projectId, sessionId),

  renameInsightsSession: (projectId: string, sessionId: string, newTitle: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_RENAME_SESSION, projectId, sessionId, newTitle),

  updateInsightsModelConfig: (projectId: string, sessionId: string, modelConfig: InsightsModelConfig): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.INSIGHTS_UPDATE_MODEL_CONFIG, projectId, sessionId, modelConfig),

  // Event Listeners
  onInsightsStreamChunk: (
    callback: (projectId: string, chunk: InsightsStreamChunk) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.INSIGHTS_STREAM_CHUNK, callback),

  onInsightsStatus: (
    callback: (projectId: string, status: InsightsChatStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.INSIGHTS_STATUS, callback),

  onInsightsError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.INSIGHTS_ERROR, callback),

  onInsightsSessionUpdated: (
    callback: (projectId: string, session: InsightsSession) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.INSIGHTS_SESSION_UPDATED, callback)
});
