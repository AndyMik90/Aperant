/**
 * JIRA IPC Handlers Module
 *
 * This module exports the main registration function for all JIRA-related IPC handlers.
 */

import { registerJiraIssueHandlers } from './issue-handlers';

/**
 * Register all JIRA IPC handlers
 */
export function registerJiraHandlers(): void {
  console.warn('[JIRA] Registering JIRA handlers');
  registerJiraIssueHandlers();
  console.warn('[JIRA] JIRA handlers registered');
}

// Re-export individual registration functions for custom usage
export { registerJiraIssueHandlers };
