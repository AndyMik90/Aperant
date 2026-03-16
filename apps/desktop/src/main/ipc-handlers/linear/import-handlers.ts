/**
 * Linear issue import IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, LinearImportResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { AgentManager } from '../../agent';
import { getLinearApiKey, linearGraphQL } from './utils';
import { createSpecForLinearIssue } from './spec-utils';
import { sanitizeText } from '../shared/sanitize';

/**
 * Import multiple Linear issues as tasks
 */
function registerImportIssues(agentManager: AgentManager): void {
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
        // Fetch the full details of selected issues
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

        // Create tasks for each imported issue
        for (const issue of data.issues.nodes) {
          try {
            const safeTitle = sanitizeText(issue.title, 500);
            const safeIdentifier = sanitizeText(issue.identifier, 50);
            const safeDescription = sanitizeText(issue.description ?? '', 50000, true);
            const safePriorityLabel = sanitizeText(issue.priorityLabel, 100);
            const safeStateName = sanitizeText(issue.state.name, 100);
            const labelNames = issue.labels.nodes.map(l => l.name);
            const labelsStr = labelNames.map(l => sanitizeText(l, 200)).filter(Boolean).join(', ');

            // Build description from Linear issue
            const description = `# ${safeTitle}

**Linear Issue:** [${safeIdentifier}](${issue.url})
**Priority:** ${safePriorityLabel}
**Status:** ${safeStateName}
${labelsStr ? `**Labels:** ${labelsStr}` : ''}

## Description

${safeDescription || 'No description provided.'}
`;

            // Create spec directory and files (with coordinated numbering)
            const specData = await createSpecForLinearIssue(
              project,
              issue.id,
              issue.identifier,
              issue.title,
              description,
              issue.url,
              labelNames,
              project.settings?.mainBranch  // Pass project's configured main branch
            );

            // Start spec creation with the existing spec directory
            agentManager.startSpecCreation(
              specData.specId,
              project.path,
              specData.taskDescription,
              specData.specDir,
              specData.metadata
            );

            imported++;
          } catch (err) {
            failed++;
            errors.push(`Failed to import ${sanitizeText(issue.identifier, 50)}: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

/**
 * Register all import-related handlers
 */
export function registerLinearImportHandlers(agentManager: AgentManager): void {
  registerImportIssues(agentManager);
}
