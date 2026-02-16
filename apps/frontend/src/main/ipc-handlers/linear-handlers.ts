import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS, getSpecsDir, AUTO_BUILD_PATHS } from '../../shared/constants';
import type { IPCResult, LinearIssue, LinearTeam, LinearProject, LinearImportResult, LinearSyncStatus, Project, TaskMetadata } from '../../shared/types';
import path from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { projectStore } from '../project-store';
import { parseEnvFile } from './utils';
import { sanitizeText, sanitizeUrl } from './shared/sanitize';


import { AgentManager } from '../agent';

/**
 * Register all linear-related IPC handlers
 */
export function registerLinearHandlers(
  agentManager: AgentManager,
  _getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Linear Integration Operations
  // ============================================

  /**
   * Helper to get Linear API key from project env
   */
  const getLinearApiKey = (project: Project): string | null => {
    if (!project.autoBuildPath) return null;
    const envPath = path.join(project.path, project.autoBuildPath, '.env');
    if (!existsSync(envPath)) return null;

    try {
      const content = readFileSync(envPath, 'utf-8');
      const vars = parseEnvFile(content);
      return vars['LINEAR_API_KEY'] || null;
    } catch {
      return null;
    }
  };

  /**
   * Make a request to the Linear API
   */
  const linearGraphQL = async (
    apiKey: string,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<unknown> => {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ query, variables })
    });

    // Check response.ok first, then try to parse JSON
    // This handles cases where the API returns non-JSON errors (e.g., 503 from proxy)
    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorResult = await response.json();
        errorMessage = errorResult?.errors?.[0]?.message
          || errorResult?.error
          || errorResult?.message
          || response.statusText;
      } catch {
        // JSON parsing failed - use status text as fallback
      }
      throw new Error(`Linear API error: ${response.status} - ${errorMessage}`);
    }

    const result = await response.json();
    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Linear API error');
    }

    return result.data;
  };

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
          // Note: These queries are kept as documentation for future API reference
          const _countQuery = `
            query($teamId: String!) {
              team(id: $teamId) {
                issues {
                  totalCount: nodes { id }
                }
              }
            }
          `;
          // Get approximate count
          const _issuesQuery = `
            query($teamId: ID!) {
              issues(filter: { team: { id: { eq: $teamId } } }, first: 0) {
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
          void _countQuery;
          void _issuesQuery;

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

  ipcMain.handle(
    IPC_CHANNELS.LINEAR_IMPORT_ISSUES,
    async (_, projectId: string, issueIds: string[]): Promise<IPCResult<LinearImportResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        return { success: false, error: 'No Linear API key configured' };
      }

      try {
        // First, fetch the full details of selected issues
        const query = `
          query($ids: [ID!]!) {
            issues(filter: { id: { in: $ids } }) {
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
                url
              }
            }
          }
        `;

        const data = await linearGraphQL(apiKey, query, { ids: issueIds }) as {
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
              url: string;
            }>;
          };
        };

        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        // Set up specs directory
                const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);
        if (!existsSync(specsDir)) {
          mkdirSync(specsDir, { recursive: true });
        }

        // Create tasks for each imported issue
        for (const issue of data.issues.nodes) {
          try {
            // Sanitize network-sourced data before writing to disk
            const safeTitle = sanitizeText(issue.title, 500);
            const safeIdentifier = sanitizeText(issue.identifier, 50);
            const safeDescription = sanitizeText(issue.description ?? '', 50000, true);
            const safePriorityLabel = sanitizeText(issue.priorityLabel, 100);
            const safeStateName = sanitizeText(issue.state.name, 100);
            const safeUrl = sanitizeUrl(issue.url);
            const safeLabels = issue.labels.nodes.map(l => sanitizeText(l.name, 200)).filter(Boolean);

            // Build description from Linear issue
            const labelsStr = safeLabels.join(', ');
            const description = `# ${safeTitle}

**Linear Issue:** [${safeIdentifier}](${safeUrl})
**Priority:** ${safePriorityLabel}
**Status:** ${safeStateName}
${labelsStr ? `**Labels:** ${labelsStr}` : ''}

## Description

${safeDescription || 'No description provided.'}
`;

            // Find next available spec number
            let specNumber = 1;
            const existingDirs = readdirSync(specsDir, { withFileTypes: true })
              .filter(d => d.isDirectory())
              .map(d => d.name);
            const existingNumbers = existingDirs
              .map(name => {
                const match = name.match(/^(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
              })
              .filter(n => n > 0);
            if (existingNumbers.length > 0) {
              specNumber = Math.max(...existingNumbers) + 1;
            }

            // Create spec ID with zero-padded number and slugified title
            const slugifiedTitle = safeTitle
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .substring(0, 50);
            const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle}`;

            // Create spec directory
            const specDir = path.join(specsDir, specId);
            mkdirSync(specDir, { recursive: true });

            // Create initial implementation_plan.json
            const now = new Date().toISOString();
            const implementationPlan = {
              feature: safeTitle,
              description: description,
              created_at: now,
              updated_at: now,
              status: 'pending',
              phases: []
            };
            // lgtm[js/http-to-file-access] - specDir is controlled, Linear data sanitized
            writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN), JSON.stringify(implementationPlan, null, 2), 'utf-8');

            // Create requirements.json
            const requirements = {
              task_description: description,
              workflow_type: 'feature'
            };
            // lgtm[js/http-to-file-access] - specDir is controlled, Linear data sanitized
            writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS), JSON.stringify(requirements, null, 2), 'utf-8');

            // Build metadata
            const metadata: TaskMetadata = {
              sourceType: 'linear',
              linearIssueId: sanitizeText(issue.id, 100),
              linearIdentifier: safeIdentifier,
              linearUrl: safeUrl,
              category: 'feature'
            };
            // lgtm[js/http-to-file-access] - specDir is controlled, Linear data sanitized
            writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

            // Start spec creation with the existing spec directory
            agentManager.startSpecCreation(specId, project.path, description, specDir, metadata);

            imported++;
          } catch (err) {
            failed++;
            errors.push(`Failed to import ${issue.identifier}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }

        return {
          success: true,
          data: {
            success: failed === 0,
            imported,
            failed,
            errors: errors.length > 0 ? errors : undefined
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to import issues'
        };
      }
    }
  );

}
