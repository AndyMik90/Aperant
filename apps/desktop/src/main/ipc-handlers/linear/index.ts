/**
 * Linear integration IPC handlers
 *
 * Main entry point that registers all Linear-related handlers.
 * Handlers are organized into modules by functionality:
 * - connection-handlers: API connection checking
 * - issue-handlers: Issue and comment fetching
 * - investigation-handlers: AI-powered issue investigation
 * - import-handlers: Bulk issue import
 * - sync-handlers: Two-way status synchronization
 */

import type { BrowserWindow } from 'electron';
import { AgentManager } from '../../agent';
import { registerLinearConnectionHandlers } from './connection-handlers';
import { registerLinearIssueHandlers } from './issue-handlers';
import { registerLinearInvestigationHandlers } from './investigation-handlers';
import { registerLinearImportHandlers } from './import-handlers';
import { registerLinearSyncHandlers } from './sync-handlers';

/**
 * Register all Linear-related IPC handlers
 */
export function registerLinearHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerLinearConnectionHandlers();
  registerLinearIssueHandlers();
  registerLinearInvestigationHandlers(agentManager, getMainWindow);
  registerLinearImportHandlers(agentManager);
  registerLinearSyncHandlers(agentManager, getMainWindow);
}

// Re-export utilities for potential external use
export { getLinearApiKey, linearGraphQL } from './utils';
