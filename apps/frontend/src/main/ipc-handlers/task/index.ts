/**
 * Task handlers module
 *
 * This module organizes all task-related IPC handlers into logical groups:
 * - CRUD operations (create, read, update, delete)
 * - Execution management (start, stop, review, status, recovery)
 * - Worktree operations (status, diff, merge, discard, list)
 * - Logs management (get, watch, unwatch)
 */

import { BrowserWindow } from 'electron';
import { AgentManager } from '../../agent';
import { PythonEnvManager } from '../../python-env-manager';
import { TerminalManager } from '../../terminal/terminal-manager';
import { registerTaskCRUDHandlers } from './crud-handlers';
import { registerTaskExecutionHandlers } from './execution-handlers';
import { registerWorktreeHandlers } from './worktree-handlers';
import { registerTaskLogsHandlers } from './logs-handlers';
import { registerTaskArchiveHandlers } from './archive-handlers';

/**
 * Register all task-related IPC handlers
 */
export function registerTaskHandlers(
  agentManager: AgentManager,
  pythonEnvManager: PythonEnvManager,
  getMainWindow: () => BrowserWindow | null,
  terminalManager: TerminalManager
): void {
  // Register CRUD handlers (create, read, update, delete)
  // Phase 2: CRUD handlers now need terminalManager and mainWindow to spawn planning agent at task creation
  registerTaskCRUDHandlers(agentManager, getMainWindow, terminalManager);

  // Register execution handlers (start, stop, review, status management, recovery)
  registerTaskExecutionHandlers(agentManager, getMainWindow, terminalManager);

  // Register worktree handlers (status, diff, merge, discard, list)
  registerWorktreeHandlers(pythonEnvManager, getMainWindow);

  // Register logs handlers (get, watch, unwatch)
  registerTaskLogsHandlers(getMainWindow);

  // Register archive handlers (archive, unarchive)
  registerTaskArchiveHandlers();
}

// Export shared utilities for use by other modules if needed
export { findTaskAndProject } from './shared';
