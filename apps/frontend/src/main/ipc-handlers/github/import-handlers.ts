/**
 * GitHub issue import IPC handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, GitHubImportResult, Task } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { AgentManager } from '../../agent';
import { getGitHubConfig, githubFetch } from './utils';
import { createSpecForIssue } from './spec-utils';

/**
 * Import multiple GitHub issues as tasks
 */
export function registerImportIssues(agentManager: AgentManager): void {
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_IMPORT_ISSUES,
    async (_, projectId: string, issueNumbers: number[]): Promise<IPCResult<GitHubImportResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = getGitHubConfig(project);
      if (!config) {
        return { success: false, error: 'No GitHub token or repository configured' };
      }

      let imported = 0;
      let failed = 0;
      const errors: string[] = [];
      const tasks: Task[] = [];

      for (const issueNumber of issueNumbers) {
        try {
          // Fetch issue details
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

          // Build description with metadata
          const labelNames = issue.labels.map(l => l.name);
          const labelsString = labelNames.join(', ');
          const description = `# ${issue.title}

**GitHub Issue:** [#${issue.number}](${issue.html_url})
${labelsString ? `**Labels:** ${labelsString}` : ''}

## Description

${issue.body || 'No description provided.'}
`;

          // Create spec directory and files (with coordinated numbering)
          const specData = await createSpecForIssue(
            project,
            issue.number,
            issue.title,
            description,
            issue.html_url,
            labelNames,
            project.settings?.mainBranch  // Pass project's configured main branch
          );

          // FIX-19: Use startPlanningAgent instead of startSpecCreation
          // This ensures --no-build flag is used to prevent auto-continuation to coding
          agentManager.startPlanningAgent(
            specData.specId,
            project.path,
            specData.taskDescription,
            specData.specDir,
            specData.metadata,
            project.settings?.mainBranch
          );

          imported++;
        } catch (err) {
          failed++;
          errors.push(
            `Failed to import #${issueNumber}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      }

      return {
        success: true,
        data: {
          success: failed === 0,
          imported,
          failed,
          errors: errors.length > 0 ? errors : undefined,
          tasks
        }
      };
    }
  );
}

/**
 * Register all import-related handlers
 */
export function registerImportHandlers(agentManager: AgentManager): void {
  registerImportIssues(agentManager);
}
