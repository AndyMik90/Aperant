/**
 * Context Handlers
 *
 * This module serves as the entry point for all context-related IPC handlers.
 * The implementation has been refactored into smaller, focused modules in the context/ subdirectory:
 *
 * - utils.ts: Shared utility functions for environment parsing and configuration
 * - memory-status-handlers.ts: Handlers for checking memory configuration
 * - memory-data-handlers.ts: Handlers for getting and searching memories
 * - project-context-handlers.ts: Handlers for project context and index operations
 *
 * All handlers are registered through the main registerContextHandlers function.
 */

import type { BrowserWindow } from 'electron';
import { registerContextHandlers } from './context';

export { registerContextHandlers };

/**
 * Register all context-related IPC handlers
 *
 * @param getMainWindow - Function that returns the main BrowserWindow instance
 */
export function setupContextHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  registerContextHandlers(getMainWindow);
}
