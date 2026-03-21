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
  jiraCreateIssue: (projectId: string, fields: Record<string, unknown>) => Promise<IPCResult<{ key: string }>>;
  jiraAddComment: (projectId: string, issueKey: string, body: string) => Promise<IPCResult>;
  jiraGetTransitions: (projectId: string, issueKey: string) => Promise<IPCResult<Array<{ id: string; name: string }>>>;
  jiraTransitionIssue: (projectId: string, issueKey: string, transitionId: string) => Promise<IPCResult>;
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

  jiraCreateIssue: (projectId: string, fields: Record<string, unknown>): Promise<IPCResult<{ key: string }>> =>
    invokeIpc(IPC_CHANNELS.JIRA_CREATE_ISSUE, projectId, fields),

  jiraAddComment: (projectId: string, issueKey: string, body: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.JIRA_ADD_COMMENT, projectId, issueKey, body),

  jiraGetTransitions: (projectId: string, issueKey: string): Promise<IPCResult<Array<{ id: string; name: string }>>> =>
    invokeIpc(IPC_CHANNELS.JIRA_GET_TRANSITIONS, projectId, issueKey),

  jiraTransitionIssue: (projectId: string, issueKey: string, transitionId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.JIRA_TRANSITION_ISSUE, projectId, issueKey, transitionId),
});
