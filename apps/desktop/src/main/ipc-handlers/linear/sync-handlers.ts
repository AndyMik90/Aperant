/**
 * Linear two-way status sync IPC handlers
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type { IPCResult, LinearSyncEvent, TaskMetadata } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { AgentManager } from '../../agent';
import { getLinearApiKey, linearGraphQL } from './utils';

/**
 * Map Aperant task status to Linear workflow state type
 */
function mapTaskStatusToLinearStateType(status: string): string | null {
  switch (status) {
    case 'in_progress':
    case 'building':
    case 'planning':
    case 'spec_creation':
      return 'started';
    case 'done':
    case 'pr_created':
    case 'merged':
      return 'completed';
    case 'error':
      // Don't sync error states
      return null;
    default:
      return null;
  }
}

/**
 * Get the workflow state ID for a given state type from a team's states
 */
async function getWorkflowStateId(
  apiKey: string,
  teamId: string,
  stateType: string
): Promise<string | null> {
  const query = `
    query($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;

  const data = await linearGraphQL(apiKey, query, { teamId }) as {
    team: {
      states: {
        nodes: Array<{ id: string; name: string; type: string }>;
      };
    };
  };

  // Find the first state matching the desired type
  const matchingState = data.team.states.nodes.find(s => s.type === stateType);
  return matchingState?.id || null;
}

/**
 * Sync task status to Linear issue
 */
function registerSyncIssueStatus(
  _agentManager: AgentManager,
  _getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_SYNC_ISSUE_STATUS,
    async (_, projectId: string, taskId: string): Promise<IPCResult<LinearSyncEvent>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        // Read task_metadata.json to get Linear issue info
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);
        const specDir = path.join(specsDir, taskId);
        const metadataPath = path.join(specDir, 'task_metadata.json');

        if (!existsSync(metadataPath)) {
          return { success: false, error: 'Task metadata not found' };
        }

        const metadata: TaskMetadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

        if (metadata.sourceType !== 'linear' || !metadata.linearIssueId) {
          return { success: false, error: 'Task is not linked to a Linear issue' };
        }

        // Read current task status from implementation_plan.json
        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        if (!existsSync(planPath)) {
          return { success: false, error: 'Implementation plan not found' };
        }

        const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
        const taskStatus = plan.status as string;

        // Map task status to Linear state type
        const linearStateType = mapTaskStatusToLinearStateType(taskStatus);
        if (!linearStateType) {
          return {
            success: true,
            data: {
              success: false,
              issueId: metadata.linearIssueId,
              issueIdentifier: metadata.linearIdentifier,
              error: `Task status "${taskStatus}" does not map to a Linear state`
            }
          };
        }

        // Fetch the current issue to get its team and current state
        const issueQuery = `
          query($issueId: String!) {
            issue(id: $issueId) {
              id
              identifier
              state {
                id
                name
                type
              }
              team {
                id
              }
            }
          }
        `;

        const issueData = await linearGraphQL(apiKey, issueQuery, { issueId: metadata.linearIssueId }) as {
          issue: {
            id: string;
            identifier: string;
            state: { id: string; name: string; type: string };
            team: { id: string };
          };
        };

        const currentState = issueData.issue.state;

        // If already in the target state type, no update needed
        if (currentState.type === linearStateType) {
          return {
            success: true,
            data: {
              success: true,
              issueId: metadata.linearIssueId,
              issueIdentifier: issueData.issue.identifier,
              previousState: currentState.name,
              newState: currentState.name
            }
          };
        }

        // Get the target state ID from the team's workflow states
        const targetStateId = await getWorkflowStateId(apiKey, issueData.issue.team.id, linearStateType);
        if (!targetStateId) {
          return {
            success: true,
            data: {
              success: false,
              issueId: metadata.linearIssueId,
              issueIdentifier: issueData.issue.identifier,
              error: `No workflow state found for type "${linearStateType}" in the team`
            }
          };
        }

        // Update the issue state
        const updateMutation = `
          mutation($issueId: String!, $stateId: String!) {
            issueUpdate(id: $issueId, input: { stateId: $stateId }) {
              success
              issue {
                id
                state {
                  id
                  name
                  type
                }
              }
            }
          }
        `;

        const updateResult = await linearGraphQL(apiKey, updateMutation, {
          issueId: metadata.linearIssueId,
          stateId: targetStateId
        }) as {
          issueUpdate: {
            success: boolean;
            issue: {
              id: string;
              state: { id: string; name: string; type: string };
            };
          };
        };

        if (!updateResult.issueUpdate.success) {
          return {
            success: true,
            data: {
              success: false,
              issueId: metadata.linearIssueId,
              issueIdentifier: issueData.issue.identifier,
              error: 'Linear API returned unsuccessful update'
            }
          };
        }

        return {
          success: true,
          data: {
            success: true,
            issueId: metadata.linearIssueId,
            issueIdentifier: issueData.issue.identifier,
            previousState: currentState.name,
            newState: updateResult.issueUpdate.issue.state.name
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to sync issue status'
        };
      }
    }
  );
}

/**
 * Register all sync-related handlers
 */
export function registerLinearSyncHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerSyncIssueStatus(agentManager, getMainWindow);
}
