import { IPC_CHANNELS } from "../../../shared/constants";
import type {
  LinearTeam,
  LinearProject,
  LinearIssue,
  LinearImportResult,
  LinearSyncStatus,
  LinearComment,
  LinearInvestigationStatus,
  LinearInvestigationResult,
  LinearSyncEvent,
  IPCResult,
} from "../../../shared/types";
import { invokeIpc, sendIpc, createIpcListener } from "./ipc-utils";
import type { IpcListenerCleanup } from "./ipc-utils";

/**
 * Linear Integration API operations
 */
export interface LinearAPI {
  getLinearTeams: (projectId: string) => Promise<IPCResult<LinearTeam[]>>;
  getLinearProjects: (
    projectId: string,
    teamId: string,
  ) => Promise<IPCResult<LinearProject[]>>;
  getLinearIssues: (
    projectId: string,
    teamId?: string,
    linearProjectId?: string,
  ) => Promise<IPCResult<LinearIssue[]>>;
  getLinearIssueComments: (
    projectId: string,
    issueId: string,
  ) => Promise<IPCResult<LinearComment[]>>;
  importLinearIssues: (
    projectId: string,
    issueIds: string[],
  ) => Promise<IPCResult<LinearImportResult>>;
  checkLinearConnection: (
    projectId: string,
  ) => Promise<IPCResult<LinearSyncStatus>>;
  investigateLinearIssue: (
    projectId: string,
    issueId: string,
    selectedCommentIds?: string[],
  ) => void;
  syncLinearIssueStatus: (
    projectId: string,
    taskId: string,
  ) => Promise<IPCResult<LinearSyncEvent>>;

  // Event listeners
  onLinearInvestigationProgress: (
    callback: (projectId: string, status: LinearInvestigationStatus) => void,
  ) => IpcListenerCleanup;
  onLinearInvestigationComplete: (
    callback: (projectId: string, result: LinearInvestigationResult) => void,
  ) => IpcListenerCleanup;
  onLinearInvestigationError: (
    callback: (projectId: string, error: string) => void,
  ) => IpcListenerCleanup;
}

/**
 * Creates the Linear Integration API implementation
 */
export const createLinearAPI = (): LinearAPI => ({
  getLinearTeams: (projectId: string): Promise<IPCResult<LinearTeam[]>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_GET_TEAMS, projectId),

  getLinearProjects: (
    projectId: string,
    teamId: string,
  ): Promise<IPCResult<LinearProject[]>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_GET_PROJECTS, projectId, teamId),

  getLinearIssues: (
    projectId: string,
    teamId?: string,
    linearProjectId?: string,
  ): Promise<IPCResult<LinearIssue[]>> =>
    invokeIpc(
      IPC_CHANNELS.LINEAR_GET_ISSUES,
      projectId,
      teamId,
      linearProjectId,
    ),

  getLinearIssueComments: (
    projectId: string,
    issueId: string,
  ): Promise<IPCResult<LinearComment[]>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_GET_ISSUE_COMMENTS, projectId, issueId),

  importLinearIssues: (
    projectId: string,
    issueIds: string[],
  ): Promise<IPCResult<LinearImportResult>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_IMPORT_ISSUES, projectId, issueIds),

  checkLinearConnection: (
    projectId: string,
  ): Promise<IPCResult<LinearSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_CHECK_CONNECTION, projectId),

  investigateLinearIssue: (
    projectId: string,
    issueId: string,
    selectedCommentIds?: string[],
  ): void =>
    sendIpc(
      IPC_CHANNELS.LINEAR_INVESTIGATE_ISSUE,
      projectId,
      issueId,
      selectedCommentIds,
    ),

  syncLinearIssueStatus: (
    projectId: string,
    taskId: string,
  ): Promise<IPCResult<LinearSyncEvent>> =>
    invokeIpc(IPC_CHANNELS.LINEAR_SYNC_ISSUE_STATUS, projectId, taskId),

  // Event listeners
  onLinearInvestigationProgress: (
    callback: (projectId: string, status: LinearInvestigationStatus) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.LINEAR_INVESTIGATION_PROGRESS, callback),

  onLinearInvestigationComplete: (
    callback: (projectId: string, result: LinearInvestigationResult) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.LINEAR_INVESTIGATION_COMPLETE, callback),

  onLinearInvestigationError: (
    callback: (projectId: string, error: string) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.LINEAR_INVESTIGATION_ERROR, callback),
});
