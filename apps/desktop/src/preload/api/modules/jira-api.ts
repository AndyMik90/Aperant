import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * JIRA Integration API operations
 */
export interface JiraAPI {
  jiraTestConnection: (projectId: string) => Promise<IPCResult<{ displayName: string }>>;
  jiraListProjects: (projectId: string) => Promise<IPCResult<Array<{ key: string; name: string; id: string }>>>;
  jiraSearchIssues: (projectId: string, jql: string) => Promise<IPCResult<{ issues: Array<Record<string, unknown>>; total: number }>>;
  jiraGetIssue: (projectId: string, issueKey: string) => Promise<IPCResult<Record<string, unknown>>>;
  jiraGetIssueComments: (projectId: string, issueKey: string) => Promise<IPCResult<Array<Record<string, unknown>>>>;
  jiraCreateIssue: (projectId: string, fields: Record<string, unknown>) => Promise<IPCResult<{ key: string }>>;
  jiraAddComment: (projectId: string, issueKey: string, body: string) => Promise<IPCResult>;
  jiraGetTransitions: (projectId: string, issueKey: string) => Promise<IPCResult<Array<{ id: string; name: string }>>>;
  jiraTransitionIssue: (projectId: string, issueKey: string, transitionId: string) => Promise<IPCResult>;
  // Investigation (async - fires events)
  investigateJiraIssue: (projectId: string, issueKey: string, selectedCommentIds?: string[]) => void;
  // Event listeners for investigation progress
  onJiraInvestigationProgress: (callback: (projectId: string, status: { phase: string; progress: number; message: string }) => void) => () => void;
  onJiraInvestigationComplete: (callback: (projectId: string, result: { taskId: string; specId: string }) => void) => () => void;
  onJiraInvestigationError: (callback: (projectId: string, error: string) => void) => () => void;
}

/**
 * Creates the JIRA Integration API implementation
 */
export const createJiraAPI = (): JiraAPI => ({
  jiraTestConnection: (projectId: string): Promise<IPCResult<{ displayName: string }>> =>
    invokeIpc(IPC_CHANNELS.JIRA_TEST_CONNECTION, projectId),

  jiraListProjects: (projectId: string): Promise<IPCResult<Array<{ key: string; name: string; id: string }>>> =>
    invokeIpc(IPC_CHANNELS.JIRA_LIST_PROJECTS, projectId),

  jiraSearchIssues: (projectId: string, jql: string): Promise<IPCResult<{ issues: Array<Record<string, unknown>>; total: number }>> =>
    invokeIpc(IPC_CHANNELS.JIRA_SEARCH_ISSUES, projectId, jql),

  jiraGetIssue: (projectId: string, issueKey: string): Promise<IPCResult<Record<string, unknown>>> =>
    invokeIpc(IPC_CHANNELS.JIRA_GET_ISSUE, projectId, issueKey),

  jiraGetIssueComments: (projectId: string, issueKey: string): Promise<IPCResult<Array<Record<string, unknown>>>> =>
    invokeIpc(IPC_CHANNELS.JIRA_GET_ISSUE_COMMENTS, projectId, issueKey),

  jiraCreateIssue: (projectId: string, fields: Record<string, unknown>): Promise<IPCResult<{ key: string }>> =>
    invokeIpc(IPC_CHANNELS.JIRA_CREATE_ISSUE, projectId, fields),

  jiraAddComment: (projectId: string, issueKey: string, body: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.JIRA_ADD_COMMENT, projectId, issueKey, body),

  jiraGetTransitions: (projectId: string, issueKey: string): Promise<IPCResult<Array<{ id: string; name: string }>>> =>
    invokeIpc(IPC_CHANNELS.JIRA_GET_TRANSITIONS, projectId, issueKey),

  jiraTransitionIssue: (projectId: string, issueKey: string, transitionId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.JIRA_TRANSITION_ISSUE, projectId, issueKey, transitionId),

  // Investigation (one-way send, results come via events)
  investigateJiraIssue: (projectId: string, issueKey: string, selectedCommentIds?: string[]): void => {
    ipcRenderer.send(IPC_CHANNELS.JIRA_INVESTIGATE_ISSUE, projectId, issueKey, selectedCommentIds);
  },

  // Event listeners
  onJiraInvestigationProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string, status: { phase: string; progress: number; message: string }) => {
      callback(projectId, status);
    };
    ipcRenderer.on(IPC_CHANNELS.JIRA_INVESTIGATION_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.JIRA_INVESTIGATION_PROGRESS, handler); };
  },

  onJiraInvestigationComplete: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string, result: { taskId: string; specId: string }) => {
      callback(projectId, result);
    };
    ipcRenderer.on(IPC_CHANNELS.JIRA_INVESTIGATION_COMPLETE, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.JIRA_INVESTIGATION_COMPLETE, handler); };
  },

  onJiraInvestigationError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string, error: string) => {
      callback(projectId, error);
    };
    ipcRenderer.on(IPC_CHANNELS.JIRA_INVESTIGATION_ERROR, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.JIRA_INVESTIGATION_ERROR, handler); };
  },
});
