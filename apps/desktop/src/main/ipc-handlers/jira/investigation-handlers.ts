/**
 * JIRA investigation handlers
 * Handles AI-powered issue investigation
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { JiraInvestigationStatus, JiraInvestigationResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getJiraConfig, jiraFetch } from './utils';
import type { JiraAPIIssue } from './types';
import { createSpecFromJiraIssue, fetchAllIssueComments } from './spec-utils';
import type { JiraAPIComment } from './spec-utils';
import type { AgentManager } from '../../agent';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[JIRA Investigation] ${message}`, data);
    } else {
      console.debug(`[JIRA Investigation] ${message}`);
    }
  }
}

/**
 * Send investigation progress to renderer
 */
function sendProgress(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  status: JiraInvestigationStatus
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.JIRA_INVESTIGATION_PROGRESS, projectId, status);
  }
}

/**
 * Send investigation complete to renderer
 */
function sendComplete(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  result: JiraInvestigationResult
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.JIRA_INVESTIGATION_COMPLETE, projectId, result);
  }
}

/**
 * Send investigation error to renderer
 */
function sendError(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  error: string
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.JIRA_INVESTIGATION_ERROR, projectId, error);
  }
}

/**
 * Register the get issue comments handler
 */
function registerGetIssueComments(): void {
  ipcMain.handle(
    IPC_CHANNELS.JIRA_GET_ISSUE_COMMENTS,
    async (_event, projectId: string, issueKey: string) => {
      debugLog('getIssueComments handler called', { projectId, issueKey });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getJiraConfig(project);
      if (!config) {
        return { success: false, error: 'JIRA not configured' };
      }

      try {
        const comments = await fetchAllIssueComments(config, issueKey);
        return { success: true, data: comments };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch comments';
        debugLog('Failed to fetch comments:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );
}

/**
 * Register investigation handler
 */
export function registerInvestigateIssue(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.JIRA_INVESTIGATE_ISSUE,
    async (_event, projectId: string, issueKey: string, selectedCommentIds?: string[]) => {
      debugLog('investigateJiraIssue handler called', { projectId, issueKey, selectedCommentIds });

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(getMainWindow, projectId, 'Project not found');
        return;
      }

      const config = await getJiraConfig(project);
      if (!config) {
        sendError(getMainWindow, projectId, 'JIRA not configured');
        return;
      }

      try {
        // Phase 1: Fetching issue
        sendProgress(getMainWindow, project.id, {
          phase: 'fetching',
          issueKey,
          progress: 10,
          message: 'Fetching issue details...'
        });

        // Fetch issue with all needed fields
        const issue = await jiraFetch(
          config,
          `/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status,assignee,priority,issuetype,created,updated,labels,project`
        ) as JiraAPIIssue;

        // Fetch all comments (include by default, filter if specific IDs provided)
        let filteredComments: JiraAPIComment[] = [];
        try {
          const allComments = await fetchAllIssueComments(config, issueKey);
          if (selectedCommentIds && selectedCommentIds.length > 0) {
            filteredComments = allComments.filter(comment => selectedCommentIds.includes(comment.id));
          } else {
            // Include all comments by default
            filteredComments = allComments;
          }
        } catch (commentErr) {
          debugLog('Failed to fetch comments (non-fatal):', commentErr);
          // Continue without comments
        }

        // Phase 2: Creating task
        sendProgress(getMainWindow, project.id, {
          phase: 'creating_task',
          issueKey,
          progress: 50,
          message: 'Creating task from issue...'
        });

        // Create spec for the issue with comments
        const task = await createSpecFromJiraIssue(
          project,
          issueKey,
          issue,
          config,
          project.settings?.mainBranch,
          filteredComments
        );

        if (!task) {
          sendError(getMainWindow, project.id, 'Failed to create task from issue');
          return;
        }

        // Phase 3: Complete
        sendProgress(getMainWindow, project.id, {
          phase: 'complete',
          issueKey,
          progress: 100,
          message: 'Investigation complete'
        });

        // Send result
        const result: JiraInvestigationResult = {
          success: true,
          issueKey,
          analysis: {
            summary: `Investigation of JIRA issue ${issueKey}: ${issue.fields.summary}`,
            proposedSolution: issue.fields.description
              ? 'See task details for more information.'
              : 'No description provided. See task details.',
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: []
          },
          taskId: task.id
        };

        sendComplete(getMainWindow, project.id, result);
        debugLog('Investigation complete:', { issueKey, taskId: task.id });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Investigation failed';
        debugLog('Investigation failed:', errorMessage);
        sendError(getMainWindow, project.id, errorMessage);
      }
    }
  );
}

/**
 * Register all JIRA investigation handlers
 */
export function registerJiraInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering JIRA investigation handlers');
  registerGetIssueComments();
  registerInvestigateIssue(agentManager, getMainWindow);
  debugLog('JIRA investigation handlers registered');
}
