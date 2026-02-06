/**
 * GitHub integration IPC handlers
 *
 * Main entry point that registers all GitHub-related handlers.
 * Handlers are organized into modules by functionality:
 * - repository-handlers: Repository and connection management
 * - issue-handlers: Issue fetching and retrieval
 * - investigation-handlers: AI-powered issue investigation
 * - import-handlers: Bulk issue import
 * - release-handlers: GitHub release creation
 * - oauth-handlers: GitHub CLI OAuth authentication
 * - autofix-handlers: Automatic issue fixing with label triggers
 * - pr-handlers: PR review, polling status, and status updates
 * - triage-handlers: Issue triage automation
 */

import type { BrowserWindow } from 'electron';
import { AgentManager } from '../../agent';
import { registerRepositoryHandlers } from './repository-handlers';
import { registerIssueHandlers } from './issue-handlers';
import { registerInvestigationHandlers } from './investigation-handlers';
import { registerImportHandlers } from './import-handlers';
import { registerReleaseHandlers } from './release-handlers';
import { registerGithubOAuthHandlers } from './oauth-handlers';
import { registerAutoFixHandlers } from './autofix-handlers';
import { registerPRHandlers } from './pr-handlers';
import { registerTriageHandlers } from './triage-handlers';

/**
 * Register all GitHub-related IPC handlers
 */
export function registerGithubHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerRepositoryHandlers();
  registerIssueHandlers();
  registerInvestigationHandlers(agentManager, getMainWindow);
  registerImportHandlers(agentManager);
  registerReleaseHandlers();
  registerGithubOAuthHandlers();
  registerAutoFixHandlers(agentManager, getMainWindow);
  registerPRHandlers(getMainWindow);
  registerTriageHandlers(getMainWindow);
}

// Re-export utilities for potential external use
export { getGitHubConfig, githubFetch } from './utils';
export type { GitHubConfig } from './types';
