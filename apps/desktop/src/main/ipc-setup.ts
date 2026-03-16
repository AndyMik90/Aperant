/**
 * IPC Handlers Setup
 *
 * This file now serves as a simple entry point that delegates to modularized handlers.
 * All IPC handlers have been organized into domain-specific modules in ./ipc-handlers/
 */

import type { BrowserWindow } from "electron";
import { AgentManager } from "./agent";
import { TerminalManager } from "./terminal-manager";
import { setupIpcHandlers as setupModularHandlers } from "./ipc-handlers";

/**
 * Setup all IPC handlers
 *
 * This function has been refactored to use modular handlers for better organization.
 * The monolithic 6900+ line file has been split into domain-specific modules:
 *
 * - project-handlers.ts: Project CRUD and initialization
 * - task-handlers.ts: Task management and execution
 * - terminal-handlers.ts: Terminal operations and Claude profiles
 * - agent-events-handlers.ts: Agent event forwarding
 * - settings-handlers.ts: App settings and dialogs
 * - file-handlers.ts: File system operations
 * - roadmap-handlers.ts: Roadmap generation and management
 * - context-handlers.ts: Project context and memory
 * - env-handlers.ts: Environment configuration
 * - linear/: Linear integration (connection, issues, investigation, import, sync)
 * - github-handlers.ts: GitHub integration
 * - autobuild-source-handlers.ts: Source updates
 * - ideation-handlers.ts: Ideation generation
 * - changelog-handlers.ts: Changelog operations
 * - insights-handlers.ts: AI insights chat
 *
 * @param agentManager - The agent manager instance
 * @param terminalManager - The terminal manager instance
 * @param getMainWindow - Function to get the main BrowserWindow
 */
export function setupIpcHandlers(
  agentManager: AgentManager,
  terminalManager: TerminalManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  // Delegate to modular handler setup
  setupModularHandlers(agentManager, terminalManager, getMainWindow);
}
