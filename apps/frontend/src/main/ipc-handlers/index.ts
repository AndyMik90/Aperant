/**
 * IPC Handlers Module Index
 *
 * This module exports a single setup function that registers all IPC handlers
 * organized by domain into separate handler modules.
 */

import type { BrowserWindow } from 'electron';
import { AgentManager } from '../agent';
import { TerminalManager } from '../terminal-manager';
import { PythonEnvManager } from '../python-env-manager';

// Import all handler registration functions
import { registerProjectHandlers } from './project-handlers';
import { registerTaskHandlers } from './task-handlers';
import { registerTerminalHandlers } from './terminal-handlers';
import { registerAgenteventsHandlers } from './agent-events-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerFileHandlers } from './file-handlers';
import { registerRoadmapHandlers } from './roadmap-handlers';
import { registerContextHandlers } from './context-handlers';
import { registerEnvHandlers } from './env-handlers';
import { registerLinearHandlers } from './linear-handlers';
import { registerGithubHandlers } from './github-handlers';
import { registerGitlabHandlers } from './gitlab-handlers';
import { registerIdeationHandlers } from './ideation-handlers';
import { registerChangelogHandlers } from './changelog-handlers';
import { registerInsightsHandlers } from './insights-handlers';
import { registerMemoryHandlers } from './memory-handlers';
import { registerAppUpdateHandlers } from './app-update-handlers';
import { registerDebugHandlers } from './debug-handlers';
import { registerClaudeCodeHandlers } from './claude-code-handlers';
import { registerMcpHandlers } from './mcp-handlers';
import { registerProfileHandlers } from './profile-handlers';
import { registerScreenshotHandlers } from './screenshot-handlers';
import { registerTerminalWorktreeIpcHandlers } from './terminal';
import { notificationService } from '../notification-service';

/**
 * Setup all IPC handlers across all domains
 *
 * @param agentManager - The agent manager instance
 * @param terminalManager - The terminal manager instance
 * @param getMainWindow - Function to get the main BrowserWindow
 * @param pythonEnvManager - The Python environment manager instance
 */
export function setupIpcHandlers(
  agentManager: AgentManager,
  terminalManager: TerminalManager,
  getMainWindow: () => BrowserWindow | null,
  pythonEnvManager: PythonEnvManager
): void {
  // Initialize notification service
  notificationService.initialize(getMainWindow);

  // Project handlers (including Python environment setup)
  registerProjectHandlers(pythonEnvManager, agentManager, getMainWindow);

  // Task handlers
  registerTaskHandlers(agentManager, pythonEnvManager, getMainWindow);

  // Terminal and Claude profile handlers
  registerTerminalHandlers(terminalManager, getMainWindow);

  // Terminal worktree handlers (isolated development in worktrees)
  registerTerminalWorktreeIpcHandlers();

  // Agent event handlers (event forwarding from agent manager to renderer)
  registerAgenteventsHandlers(agentManager, getMainWindow);

  // Settings and dialog handlers
  registerSettingsHandlers(agentManager, getMainWindow);

  // File explorer handlers
  registerFileHandlers();

  // Roadmap handlers
  registerRoadmapHandlers(agentManager, getMainWindow);

  // Context and memory handlers
  registerContextHandlers(getMainWindow);

  // Environment configuration handlers
  registerEnvHandlers(getMainWindow);

  // Linear integration handlers
  registerLinearHandlers(agentManager, getMainWindow);

  // GitHub integration handlers
  registerGithubHandlers(agentManager, getMainWindow);

  // GitLab integration handlers
  registerGitlabHandlers(agentManager, getMainWindow);

  // Ideation handlers
  registerIdeationHandlers(agentManager, getMainWindow);

  // Changelog handlers
  registerChangelogHandlers(getMainWindow);

  // Insights handlers
  registerInsightsHandlers(getMainWindow);

  // Memory & infrastructure handlers (for Graphiti/LadybugDB)
  registerMemoryHandlers();

  // App auto-update handlers
  registerAppUpdateHandlers();

  // Debug handlers (logs, debug info, etc.)
  registerDebugHandlers();

  // Claude Code CLI handlers (version checking, installation)
  registerClaudeCodeHandlers();

  // MCP server health check handlers
  registerMcpHandlers();

  // API Profile handlers (custom Anthropic-compatible endpoints)
  registerProfileHandlers();

  // Screenshot capture handlers
  registerScreenshotHandlers();

  console.warn('[IPC] All handler modules registered successfully');
}

// Re-export all individual registration functions for potential custom usage
export {
  registerProjectHandlers,
  registerTaskHandlers,
  registerTerminalHandlers,
  registerTerminalWorktreeIpcHandlers,
  registerAgenteventsHandlers,
  registerSettingsHandlers,
  registerFileHandlers,
  registerRoadmapHandlers,
  registerContextHandlers,
  registerEnvHandlers,
  registerLinearHandlers,
  registerGithubHandlers,
  registerGitlabHandlers,
  registerIdeationHandlers,
  registerChangelogHandlers,
  registerInsightsHandlers,
  registerMemoryHandlers,
  registerAppUpdateHandlers,
  registerDebugHandlers,
  registerClaudeCodeHandlers,
  registerMcpHandlers,
  registerProfileHandlers,
  registerScreenshotHandlers
};
