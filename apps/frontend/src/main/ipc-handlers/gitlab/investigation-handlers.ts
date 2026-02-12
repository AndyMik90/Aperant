/**
 * GitLab investigation handlers
 * Handles AI-powered issue investigation
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { GitLabInvestigationStatus, GitLabInvestigationResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getGitLabConfig, gitlabFetch, encodeProjectPath } from './utils';
import type { GitLabAPIIssue, GitLabNoteBasic } from './types';
import { createSpecForIssue } from './spec-utils';
import type { AgentManager } from '../../agent';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[GitLab Investigation] ${message}`, data);
    } else {
      console.debug(`[GitLab Investigation] ${message}`);
    }
  }
}

/**
 * Send investigation progress to renderer
 */
function sendProgress(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  status: GitLabInvestigationStatus
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.GITLAB_INVESTIGATION_PROGRESS, projectId, status);
  }
}

/**
 * Send investigation complete to renderer
 */
function sendComplete(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  result: GitLabInvestigationResult
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.GITLAB_INVESTIGATION_COMPLETE, projectId, result);
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
    mainWindow.webContents.send(IPC_CHANNELS.GITLAB_INVESTIGATION_ERROR, projectId, error);
  }
}

/**
 * Register investigation handler
 */
export function registerInvestigateIssue(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.GITLAB_INVESTIGATE_ISSUE,
    async (_event, projectId: string, issueIid: number, selectedNoteIds?: number[]) => {
      debugLog('investigateGitLabIssue handler called', { projectId, issueIid, selectedNoteIds });

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(getMainWindow, projectId, 'Project not found');
        return;
      }

      const config = await getGitLabConfig(project);
      if (!config) {
        sendError(getMainWindow, projectId, 'GitLab not configured');
        return;
      }

      try {
        // Phase 1: Fetching issue
        sendProgress(getMainWindow, project.id, {
          phase: 'fetching',
          issueIid,
          progress: 10,
          message: 'Fetching issue details...'
        });

        const encodedProject = encodeProjectPath(config.project);

        // Fetch issue
        const issue = await gitlabFetch(
          config.token,
          config.instanceUrl,
          `/projects/${encodedProject}/issues/${issueIid}`
        ) as GitLabAPIIssue;

        // Fetch notes if any selected (with pagination to get all notes)
        let filteredNotes: GitLabNoteBasic[] = [];
        if (selectedNoteIds && selectedNoteIds.length > 0) {
          // Fetch all notes with pagination (GitLab defaults to 20 per page)
          const allNotes: GitLabNoteBasic[] = [];
          let page = 1;
          const perPage = 100;
          const MAX_PAGES = 50; // Safety limit: max 5000 notes
          let hasMore = true;

          while (hasMore && page <= MAX_PAGES) {
            try {
              const notesPage = await gitlabFetch(
                config.token,
                config.instanceUrl,
                `/projects/${encodedProject}/issues/${issueIid}/notes?page=${page}&per_page=${perPage}`
              ) as unknown[];

              // Runtime validation: ensure we got an array
              if (!Array.isArray(notesPage)) {
                debugLog('GitLab notes API returned non-array, stopping pagination');
                break;
              }

              if (notesPage.length === 0) {
                hasMore = false;
              } else {
                // Extract only needed fields with null-safe defaults
                const noteSummaries: GitLabNoteBasic[] = notesPage
                  .filter((note: unknown): note is Record<string, unknown> =>
                    note !== null && typeof note === 'object' && typeof (note as Record<string, unknown>).id === 'number'
                  )
                  .map((note) => {
                    // Validate author structure defensively
                    const author = note.author;
                    const username = (author !== null && typeof author === 'object' && typeof (author as Record<string, unknown>).username === 'string')
                      ? (author as Record<string, unknown>).username as string
                      : 'unknown';
                    return {
                      id: note.id as number,
                      body: (note.body as string | undefined) || '',
                      author: { username },
                    };
                  });
                allNotes.push(...noteSummaries);
                if (notesPage.length < perPage) {
                  hasMore = false;
                } else {
                  page++;
                }
              }
            } catch (error) {
              // Log pagination failure as warning, but proceed with partial notes
              const errorMessage = error instanceof Error ? error.message : String(error);
              debugLog('Failed to fetch notes page, using partial notes', { page, error: errorMessage, notesRetrieved: allNotes.length });
              hasMore = false;
            }
          }

          // Warn if we hit the pagination limit
          if (page > MAX_PAGES && hasMore) {
            debugLog('Pagination limit reached, some notes may be missing', { maxPages: MAX_PAGES, notesRetrieved: allNotes.length });
          }

          // Filter notes based on selection
          filteredNotes = allNotes.filter(note => selectedNoteIds.includes(note.id));
        }

        // Phase 2: Analyzing
        sendProgress(getMainWindow, project.id, {
          phase: 'analyzing',
          issueIid,
          progress: 30,
          message: 'Analyzing issue with AI...'
        });

        // Phase 3: Creating task
        sendProgress(getMainWindow, project.id, {
          phase: 'creating_task',
          issueIid,
          progress: 80,
          message: 'Creating task from analysis...'
        });

        // Create spec for the issue with notes
        const task = await createSpecForIssue(
          project,
          issue,
          config,
          project.settings?.mainBranch,
          filteredNotes
        );

        if (!task) {
          sendError(getMainWindow, project.id, 'Failed to create task from issue');
          return;
        }

        // Phase 4: Complete
        sendProgress(getMainWindow, project.id, {
          phase: 'complete',
          issueIid,
          progress: 100,
          message: 'Investigation complete'
        });

        // Send result
        const result: GitLabInvestigationResult = {
          success: true,
          issueIid,
          analysis: {
            summary: `Investigation of GitLab issue #${issueIid}: ${issue.title}`,
            proposedSolution: issue.description || 'See task details for more information.',
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: []
          },
          taskId: task.id
        };

        sendComplete(getMainWindow, project.id, result);
        debugLog('Investigation complete:', { issueIid, taskId: task.id });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Investigation failed';
        debugLog('Investigation failed:', errorMessage);
        sendError(getMainWindow, project.id, errorMessage);
      }
    }
  );
}

/**
 * Register all investigation handlers
 */
export function registerInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering GitLab investigation handlers');
  registerInvestigateIssue(agentManager, getMainWindow);
  debugLog('GitLab investigation handlers registered');
}
