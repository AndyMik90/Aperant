/**
 * JIRA IPC Handlers Module
 *
 * This module exports the main registration function for all JIRA-related IPC handlers.
 */

import type { BrowserWindow } from 'electron';
import type { AgentManager } from '../../agent';

import { registerJiraIssueHandlers } from './issue-handlers';
import { registerJiraInvestigationHandlers } from './investigation-handlers';

/**
 * Register all JIRA IPC handlers
 */
export function registerJiraHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  console.warn('[JIRA] Registering JIRA handlers');
  registerJiraIssueHandlers();
  registerJiraInvestigationHandlers(agentManager, getMainWindow);
  console.warn('[JIRA] JIRA handlers registered');
}

// Re-export individual registration functions for custom usage
export { registerJiraIssueHandlers, registerJiraInvestigationHandlers };
