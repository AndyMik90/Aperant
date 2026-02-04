/**
 * GitHub issue investigation IPC handlers
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { GitHubInvestigationResult, GitHubInvestigationStatus } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { AgentManager } from '../../agent';
import { getGitHubConfig, githubFetch } from './utils';
import type { GitHubAPIComment } from './types';
import { createSpecForIssue, buildIssueContext, buildInvestigationTask } from './spec-utils';

/**
 * Send investigation progress update to renderer
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  status: GitHubInvestigationStatus
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
    projectId,
    status
  );
}

/**
 * Send investigation error to renderer
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
    projectId,
    error
  );
}

/**
 * Send investigation completion to renderer
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  result: GitHubInvestigationResult
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
    projectId,
    result
  );
}

/**
 * Investigate a GitHub issue and create a task
 */
export function registerInvestigateIssue(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.GITHUB_INVESTIGATE_ISSUE,
    async (_, projectId: string, issueNumber: number, selectedCommentIds?: number[]) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(mainWindow, projectId, 'Project not found');
        return;
      }

      const config = getGitHubConfig(project);
      if (!config) {
        sendError(mainWindow, projectId, 'No GitHub token or repository configured');
        return;
      }

      try {
        // Phase 1: Fetching issue details
        sendProgress(mainWindow, projectId, {
          phase: 'fetching',
          issueNumber,
          progress: 10,
          message: 'Fetching issue details...'
        });

        // Fetch the issue
        const issue = await githubFetch(
          config.token,
          `/repos/${config.repo}/issues/${issueNumber}`
        ) as {
          number: number;
          title: string;
          body?: string;
          labels: Array<{ name: string }>;
          html_url: string;
        };

        // Fetch issue comments for more context
        const allComments = await githubFetch(
          config.token,
          `/repos/${config.repo}/issues/${issueNumber}/comments`
        ) as GitHubAPIComment[];

        // Filter comments based on selection (if provided)
        // Use Array.isArray to handle empty array case (all comments deselected)
        const comments = Array.isArray(selectedCommentIds)
          ? allComments.filter(c => selectedCommentIds.includes(c.id))
          : allComments;

        // Build context for the AI investigation
        const labels = issue.labels.map(l => l.name);
        const issueContext = buildIssueContext(
          issue.number,
          issue.title,
          issue.body,
          labels,
          issue.html_url,
          comments
        );

        // Phase 2: Analyzing issue
        sendProgress(mainWindow, projectId, {
          phase: 'analyzing',
          issueNumber,
          progress: 30,
          message: 'AI is analyzing the issue...'
        });

        // Build task description
        const taskDescription = buildInvestigationTask(
          issue.number,
          issue.title,
          issueContext
        );

        // Create spec directory and files (with coordinated numbering)
        const specData = await createSpecForIssue(
          project,
          issue.number,
          issue.title,
          taskDescription,
          issue.html_url,
          labels,
          project.settings?.mainBranch  // Pass project's configured main branch
        );

        // NOTE: We intentionally do NOT call agentManager.startSpecCreation() here
        // This allows the task to stay in "backlog" status until the user manually starts it
        // Previously, calling startSpecCreation would auto-start the task immediately

        // Phase 3: Creating task
        sendProgress(mainWindow, projectId, {
          phase: 'creating_task',
          issueNumber,
          progress: 70,
          message: 'Creating task from investigation...'
        });

        // Build investigation result
        const investigationResult: GitHubInvestigationResult = {
          success: true,
          issueNumber,
          analysis: {
            summary: `Investigation of issue #${issueNumber}: ${issue.title}`,
            proposedSolution: 'Task has been created for AI agent to implement the solution.',
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: [
              `Issue #${issueNumber} requirements are met`,
              'All existing tests pass',
              'New functionality is tested'
            ]
          },
          taskId: specData.specId
        };

        // Phase 4: Complete
        sendProgress(mainWindow, projectId, {
          phase: 'complete',
          issueNumber,
          progress: 100,
          message: 'Investigation complete!'
        });

        sendComplete(mainWindow, projectId, investigationResult);

      } catch (error) {
        sendError(
          mainWindow,
          projectId,
          error instanceof Error ? error.message : 'Failed to investigate issue'
        );
      }
    }
  );
}

/**
 * Register all investigation-related handlers
 */
export function registerInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerInvestigateIssue(agentManager, getMainWindow);
}
