/**
 * Repository data IPC handlers.
 * Fetch labels and collaborators for use in mutation UI components.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import { withProject } from './utils/project-middleware';
import { createContextLogger } from './utils/logger';
import { getGitHubConfig, githubFetch, normalizeRepoReference } from './utils';

const logger = createContextLogger('GitHub Repo Data');

interface RepoDataResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface LabelInfo {
  name: string;
  color: string;
  description: string;
}

export function registerRepoDataHandlers(
  _getMainWindow: () => BrowserWindow | null,
): void {
  // ---- Get Repository Labels ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_REPO_GET_LABELS,
    async (_, projectId: string): Promise<RepoDataResult<LabelInfo[]>> => {
      return withProject(projectId, async (project) => {
        try {
          const config = getGitHubConfig(project);
          if (!config) {
            return { success: false, error: 'GitHub token/repository not configured' };
          }

          const normalizedRepo = normalizeRepoReference(config.repo);
          const labels = await githubFetch(
            config.token,
            `/repos/${normalizedRepo}/labels?per_page=100`,
          ) as Array<{ name: string; color: string; description?: string | null }>;

          const data: LabelInfo[] = labels.map((label) => ({
            name: label.name,
            color: label.color,
            description: label.description ?? '',
          }));

          return { success: true, data };
        } catch (error) {
          logger.debug('Failed to fetch labels', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch labels',
          };
        }
      });
    },
  );

  // ---- Get Repository Collaborators ----
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_REPO_GET_COLLABORATORS,
    async (_, projectId: string): Promise<RepoDataResult<string[]>> => {
      return withProject(projectId, async (project) => {
        try {
          const config = getGitHubConfig(project);
          if (!config) {
            return { success: false, error: 'GitHub token/repository not configured' };
          }

          const normalizedRepo = normalizeRepoReference(config.repo);
          const collaborators = await githubFetch(
            config.token,
            `/repos/${normalizedRepo}/collaborators?per_page=100`,
          ) as Array<{ login: string }>;

          const logins = collaborators.map((collaborator) => collaborator.login);

          return { success: true, data: logins };
        } catch (error) {
          logger.debug('Failed to fetch collaborators', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch collaborators',
          };
        }
      });
    },
  );
}
