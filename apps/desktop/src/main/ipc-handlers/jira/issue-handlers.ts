/**
 * JIRA issue handlers
 * Handles JIRA issue CRUD, transitions, and project listing
 */

import { ipcMain } from 'electron';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getJiraConfig, jiraFetch } from './utils';
import type {
  JiraIssue,
  JiraProject,
  JiraTransition,
  JiraSearchResult,
  JiraAPIIssue,
  JiraAPISearchResponse,
  JiraAPIProject,
  JiraAPITransition,
  JiraAPIUser
} from './types';

// Debug logging helper - enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[JIRA Issues] ${message}`, data);
    } else {
      console.debug(`[JIRA Issues] ${message}`);
    }
  }
}

/**
 * Transform JIRA API issue to our format
 */
function transformIssue(apiIssue: JiraAPIIssue): JiraIssue {
  return {
    key: apiIssue.key,
    summary: apiIssue.fields.summary,
    description: apiIssue.fields.description ?? undefined,
    status: apiIssue.fields.status.name,
    assignee: apiIssue.fields.assignee?.displayName,
    priority: apiIssue.fields.priority?.name,
    issueType: apiIssue.fields.issuetype.name,
    created: apiIssue.fields.created,
    updated: apiIssue.fields.updated,
    labels: apiIssue.fields.labels ?? []
  };
}

/**
 * Transform JIRA API project to our format
 */
function transformProject(apiProject: JiraAPIProject): JiraProject {
  return {
    key: apiProject.key,
    name: apiProject.name,
    id: apiProject.id
  };
}

/**
 * Transform JIRA API transition to our format
 */
function transformTransition(apiTransition: JiraAPITransition): JiraTransition {
  return {
    id: apiTransition.id,
    name: apiTransition.name,
    to: { name: apiTransition.to.name }
  };
}

/**
 * Test JIRA connectivity - returns user display name
 */
export function registerTestConnection(): void {
  ipcMain.handle(
    'jira:testConnection',
    async (_event, projectId: string): Promise<IPCResult<{ displayName: string }>> => {
      debugLog('testConnection handler called');

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const user = (await jiraFetch(config, '/myself')) as JiraAPIUser;
        debugLog('Connection test successful:', user.displayName);

        return {
          success: true,
          data: { displayName: user.displayName }
        };
      } catch (error) {
        debugLog('Connection test failed:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to connect to JIRA'
        };
      }
    }
  );
}

/**
 * List accessible JIRA projects
 */
export function registerListProjects(): void {
  ipcMain.handle(
    'jira:listProjects',
    async (_event, projectId: string): Promise<IPCResult<JiraProject[]>> => {
      debugLog('listProjects handler called');

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const apiProjects = (await jiraFetch(config, '/project')) as JiraAPIProject[];
        const projects = apiProjects.map(transformProject);
        debugLog('Fetched projects:', projects.length);

        return { success: true, data: projects };
      } catch (error) {
        debugLog('Failed to list projects:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list projects'
        };
      }
    }
  );
}

/**
 * Search JIRA issues using JQL
 */
export function registerSearchIssues(): void {
  ipcMain.handle(
    'jira:searchIssues',
    async (
      _event,
      projectId: string,
      jql: string,
      maxResults?: number
    ): Promise<IPCResult<JiraSearchResult>> => {
      debugLog('searchIssues handler called', { jql, maxResults });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const limit = maxResults ?? 50;
        const encodedJql = encodeURIComponent(jql);
        const apiResponse = (await jiraFetch(
          config,
          `/search?jql=${encodedJql}&maxResults=${limit}&fields=summary,description,status,assignee,priority,issuetype,created,updated,labels,project`
        )) as JiraAPISearchResponse;

        const issues = apiResponse.issues.map(transformIssue);
        debugLog('Search returned issues:', issues.length);

        return {
          success: true,
          data: {
            issues,
            total: apiResponse.total,
            maxResults: apiResponse.maxResults
          }
        };
      } catch (error) {
        debugLog('Failed to search issues:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to search issues'
        };
      }
    }
  );
}

/**
 * Get a single JIRA issue by key
 */
export function registerGetIssue(): void {
  ipcMain.handle(
    'jira:getIssue',
    async (_event, projectId: string, issueKey: string): Promise<IPCResult<JiraIssue>> => {
      debugLog('getIssue handler called', { issueKey });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const apiIssue = (await jiraFetch(
          config,
          `/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status,assignee,priority,issuetype,created,updated,labels,project`
        )) as JiraAPIIssue;

        const issue = transformIssue(apiIssue);
        return { success: true, data: issue };
      } catch (error) {
        debugLog('Failed to get issue:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get issue'
        };
      }
    }
  );
}

/**
 * Create a new JIRA issue
 */
export function registerCreateIssue(): void {
  ipcMain.handle(
    'jira:createIssue',
    async (
      _event,
      projectId: string,
      fields: {
        projectKey: string;
        summary: string;
        description?: string;
        issueType: string;
        priority?: string;
        labels?: string[];
        assigneeAccountId?: string;
      }
    ): Promise<IPCResult<JiraIssue>> => {
      debugLog('createIssue handler called', { projectKey: fields.projectKey, summary: fields.summary });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const issueFields: Record<string, unknown> = {
          project: { key: fields.projectKey },
          summary: fields.summary,
          issuetype: { name: fields.issueType }
        };

        if (fields.description) {
          // JIRA API v3 uses Atlassian Document Format (ADF)
          issueFields.description = {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: fields.description }]
              }
            ]
          };
        }

        if (fields.priority) {
          issueFields.priority = { name: fields.priority };
        }

        if (fields.labels && fields.labels.length > 0) {
          issueFields.labels = fields.labels;
        }

        if (fields.assigneeAccountId) {
          issueFields.assignee = { accountId: fields.assigneeAccountId };
        }

        const created = (await jiraFetch(config, '/issue', {
          method: 'POST',
          body: JSON.stringify({ fields: issueFields })
        })) as { id: string; key: string; self: string };

        debugLog('Issue created:', created.key);

        // Fetch the full issue to return complete data
        const apiIssue = (await jiraFetch(
          config,
          `/issue/${created.key}?fields=summary,description,status,assignee,priority,issuetype,created,updated,labels,project`
        )) as JiraAPIIssue;

        const issue = transformIssue(apiIssue);
        return { success: true, data: issue };
      } catch (error) {
        debugLog('Failed to create issue:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create issue'
        };
      }
    }
  );
}

/**
 * Add a comment to a JIRA issue
 */
export function registerAddComment(): void {
  ipcMain.handle(
    'jira:addComment',
    async (
      _event,
      projectId: string,
      issueKey: string,
      body: string
    ): Promise<IPCResult<{ id: string }>> => {
      debugLog('addComment handler called', { issueKey });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        // JIRA API v3 uses Atlassian Document Format (ADF) for comments
        const comment = (await jiraFetch(config, `/issue/${encodeURIComponent(issueKey)}/comment`, {
          method: 'POST',
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: body }]
                }
              ]
            }
          })
        })) as { id: string };

        debugLog('Comment added:', comment.id);
        return { success: true, data: { id: comment.id } };
      } catch (error) {
        debugLog('Failed to add comment:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add comment'
        };
      }
    }
  );
}

/**
 * Get available transitions for a JIRA issue
 */
export function registerGetTransitions(): void {
  ipcMain.handle(
    'jira:getTransitions',
    async (
      _event,
      projectId: string,
      issueKey: string
    ): Promise<IPCResult<JiraTransition[]>> => {
      debugLog('getTransitions handler called', { issueKey });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const response = (await jiraFetch(
          config,
          `/issue/${encodeURIComponent(issueKey)}/transitions`
        )) as { transitions: JiraAPITransition[] };

        const transitions = response.transitions.map(transformTransition);
        debugLog('Fetched transitions:', transitions.length);

        return { success: true, data: transitions };
      } catch (error) {
        debugLog('Failed to get transitions:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get transitions'
        };
      }
    }
  );
}

/**
 * Transition a JIRA issue to a new status
 */
export function registerTransitionIssue(): void {
  ipcMain.handle(
    'jira:transitionIssue',
    async (
      _event,
      projectId: string,
      issueKey: string,
      transitionId: string
    ): Promise<IPCResult<void>> => {
      debugLog('transitionIssue handler called', { issueKey, transitionId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        await jiraFetch(config, `/issue/${encodeURIComponent(issueKey)}/transitions`, {
          method: 'POST',
          body: JSON.stringify({
            transition: { id: transitionId }
          })
        });

        debugLog('Issue transitioned successfully:', issueKey);
        return { success: true };
      } catch (error) {
        debugLog('Failed to transition issue:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to transition issue'
        };
      }
    }
  );
}

/**
 * Register all JIRA issue handlers
 */
export function registerJiraIssueHandlers(): void {
  debugLog('Registering JIRA issue handlers');
  registerTestConnection();
  registerListProjects();
  registerSearchIssues();
  registerGetIssue();
  registerCreateIssue();
  registerAddComment();
  registerGetTransitions();
  registerTransitionIssue();
  debugLog('JIRA issue handlers registered');
}
