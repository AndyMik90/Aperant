/**
 * GitLab repository handlers
 * Handles connection status and project management
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitLabSyncStatus } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getGitLabConfig, gitlabFetch, gitlabFetchWithCount, encodeProjectPath } from './utils';
import type { GitLabAPIProject } from './types';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[GitLab Repo] ${message}`, data);
    } else {
      console.debug(`[GitLab Repo] ${message}`);
    }
  }
}

/**
 * Check GitLab connection status for a project
 */
export function registerCheckConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_CHECK_CONNECTION,
    async (_event, projectId: string): Promise<IPCResult<GitLabSyncStatus>> => {
      debugLog('checkGitLabConnection handler called', { projectId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getGitLabConfig(project);
      if (!config) {
        debugLog('No GitLab config found');
        return {
          success: true,
          data: {
            connected: false,
            error: 'GitLab not configured. Please add GITLAB_TOKEN and GITLAB_PROJECT to your .env file.'
          }
        };
      }

      // Always log connection attempts (not just in debug mode) to help diagnose self-hosted issues
      console.info(
        `[GitLab] Checking connection: instance=${config.instanceUrl}, project=${config.project}, sslVerify=${config.sslVerify}`
      );

      try {
        const encodedProject = encodeProjectPath(config.project);

        // Fetch project info
        const projectInfo = await gitlabFetch(
          config.token,
          config.instanceUrl,
          `/projects/${encodedProject}`
        ) as GitLabAPIProject;

        console.info(`[GitLab] Connection OK: ${projectInfo.path_with_namespace}`);
        debugLog('Project info retrieved:', { name: projectInfo.name });

        // Get issue count from X-Total header
        const { totalCount: issueCount } = await gitlabFetchWithCount(
          config.token,
          config.instanceUrl,
          `/projects/${encodedProject}/issues?state=opened&per_page=1`
        );

        return {
          success: true,
          data: {
            connected: true,
            instanceUrl: config.instanceUrl,
            projectPathWithNamespace: projectInfo.path_with_namespace,
            projectDescription: projectInfo.description,
            issueCount,
            lastSyncedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to connect to GitLab';
        // Always log connection failures with full details
        console.warn(`[GitLab] Connection check failed for ${config.instanceUrl}: ${errorMessage}`);
        if (error instanceof Error && (error as Error & { cause?: unknown }).cause) {
          console.warn(`[GitLab] Root cause:`, (error as Error & { cause?: unknown }).cause);
        }
        return {
          success: true,
          data: {
            connected: false,
            error: errorMessage
          }
        };
      }
    }
  );
}

/**
 * Get list of GitLab projects accessible to the user
 */
export function registerGetProjects(): void {
  ipcMain.handle(
    IPC_CHANNELS.GITLAB_GET_PROJECTS,
    async (_event, projectId: string): Promise<IPCResult<GitLabAPIProject[]>> => {
      debugLog('getGitLabProjects handler called');

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getGitLabConfig(project);
      if (!config) {
        return {
          success: false,
          error: 'GitLab not configured'
        };
      }

      try {
        const projects = await gitlabFetch(
          config.token,
          config.instanceUrl,
          '/projects?membership=true&per_page=100'
        ) as GitLabAPIProject[];

        debugLog('Found projects:', projects.length);

        return {
          success: true,
          data: projects
        };
      } catch (error) {
        debugLog('Failed to get projects:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get projects'
        };
      }
    }
  );
}

/**
 * Register all repository handlers
 */
export function registerRepositoryHandlers(): void {
  debugLog('Registering GitLab repository handlers');
  registerCheckConnection();
  registerGetProjects();
  debugLog('GitLab repository handlers registered');
}
