/**
 * Linear issue fetching IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, LinearTeam, LinearProject, LinearIssue, LinearComment } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getLinearApiKey, linearGraphQL } from './utils';

/**
 * Get all teams for the authenticated user
 */
function registerGetTeams(): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_GET_TEAMS,
    async (_, projectId: string): Promise<IPCResult<LinearTeam[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        const query = `
          query {
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
          teams: { nodes: LinearTeam[] };
        };

        return { success: true, data: data.teams.nodes };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch teams'
        };
      }
    }
  );
}

/**
 * Get projects for a specific team
 */
function registerGetProjects(): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_GET_PROJECTS,
    async (_, projectId: string, teamId: string): Promise<IPCResult<LinearProject[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        const query = `
          query($teamId: String!) {
            team(id: $teamId) {
              projects {
                nodes {
                  id
                  name
                  state
                }
              }
            }
          }
        `;

        const data = await linearGraphQL(apiKey, query, { teamId }) as {
          team: { projects: { nodes: LinearProject[] } };
        };

        return { success: true, data: data.team.projects.nodes };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch projects'
        };
      }
    }
  );
}

/**
 * Get issues with optional team and project filters
 */
function registerGetIssues(): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_GET_ISSUES,
    async (_, projectId: string, teamId?: string, linearProjectId?: string): Promise<IPCResult<LinearIssue[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        // Build filter using GraphQL variables for safety
        const variables: Record<string, string> = {};
        const filterParts: string[] = [];
        const variableDeclarations: string[] = [];

        if (teamId) {
          variables.teamId = teamId;
          variableDeclarations.push('$teamId: ID!');
          filterParts.push('team: { id: { eq: $teamId } }');
        }
        if (linearProjectId) {
          variables.linearProjectId = linearProjectId;
          variableDeclarations.push('$linearProjectId: ID!');
          filterParts.push('project: { id: { eq: $linearProjectId } }');
        }

        const variablesDef = variableDeclarations.length > 0 ? `(${variableDeclarations.join(', ')})` : '';
        const filterClause = filterParts.length > 0 ? `filter: { ${filterParts.join(', ')} }, ` : '';

        const query = `
          query${variablesDef} {
            issues(${filterClause}first: 250, orderBy: updatedAt) {
              nodes {
                id
                identifier
                title
                description
                state {
                  id
                  name
                  type
                }
                priority
                priorityLabel
                labels {
                  nodes {
                    id
                    name
                    color
                  }
                }
                assignee {
                  id
                  name
                  email
                }
                project {
                  id
                  name
                }
                createdAt
                updatedAt
                url
              }
            }
          }
        `;

        const data = await linearGraphQL(apiKey, query, variables) as {
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              description?: string;
              state: { id: string; name: string; type: string };
              priority: number;
              priorityLabel: string;
              labels: { nodes: Array<{ id: string; name: string; color: string }> };
              assignee?: { id: string; name: string; email: string };
              project?: { id: string; name: string };
              createdAt: string;
              updatedAt: string;
              url: string;
            }>;
          };
        };

        // Transform to our LinearIssue format
        const issues: LinearIssue[] = data.issues.nodes.map(issue => ({
          ...issue,
          labels: issue.labels.nodes
        }));

        return { success: true, data: issues };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issues'
        };
      }
    }
  );
}

/**
 * Get comments for a specific issue
 */
function registerGetIssueComments(): void {
  ipcMain.handle(
    IPC_CHANNELS.LINEAR_GET_ISSUE_COMMENTS,
    async (_, projectId: string, issueId: string): Promise<IPCResult<LinearComment[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        const query = `
          query($issueId: String!) {
            issue(id: $issueId) {
              comments {
                nodes {
                  id
                  body
                  user {
                    id
                    name
                    email
                  }
                  createdAt
                  updatedAt
                }
              }
            }
          }
        `;

        const data = await linearGraphQL(apiKey, query, { issueId }) as {
          issue: {
            comments: {
              nodes: Array<{
                id: string;
                body: string;
                user: { id: string; name: string; email?: string };
                createdAt: string;
                updatedAt: string;
              }>;
            };
          };
        };

        const comments: LinearComment[] = data.issue.comments.nodes.map(comment => ({
          id: comment.id,
          body: comment.body,
          author: {
            id: comment.user.id,
            name: comment.user.name,
            email: comment.user.email
          },
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt
        }));

        return { success: true, data: comments };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch issue comments'
        };
      }
    }
  );
}

/**
 * Register all issue-related handlers
 */
export function registerLinearIssueHandlers(): void {
  registerGetTeams();
  registerGetProjects();
  registerGetIssues();
  registerGetIssueComments();
}
