/**
 * Linear connection check IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, LinearSyncStatus } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getLinearApiKey, linearGraphQL } from './utils';

/**
 * Check Linear API connection status
 */
function registerCheckConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_CHECK_CONNECTION,
    async (_, projectId: string): Promise<IPCResult<LinearSyncStatus>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return {
          success: true,
          data: {
            connected: false,
            error: 'No Linear API key configured'
          }
        };
      }

      try {
        const query = `
          query {
            viewer {
              id
              name
            }
            teams {
              nodes {
                id
                name
                key
              }
            }
          }
        `;

        const data = await linearGraphQL(apiKey, query) as {
          viewer: { id: string; name: string };
          teams: { nodes: Array<{ id: string; name: string; key: string }> };
        };

        // Get issue count for the first team
        let issueCount = 0;
        let teamName: string | undefined;

        if (data.teams.nodes.length > 0) {
          teamName = data.teams.nodes[0].name;

          // Simple count estimation - get first 250 issues
          const countData = await linearGraphQL(apiKey, `
            query($teamId: ID!) {
              issues(filter: { team: { id: { eq: $teamId } } }, first: 250) {
                nodes { id }
              }
            }
          `, { teamId: data.teams.nodes[0].id }) as {
            issues: { nodes: Array<{ id: string }> };
          };
          issueCount = countData.issues.nodes.length;
        }

        return {
          success: true,
          data: {
            connected: true,
            teamName,
            issueCount,
            lastSyncedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: true,
          data: {
            connected: false,
            error: error instanceof Error ? error.message : 'Failed to connect to Linear'
          }
        };
      }
    }
  );
}

/**
 * Register all connection-related handlers
 */
export function registerLinearConnectionHandlers(): void {
  registerCheckConnection();
}
