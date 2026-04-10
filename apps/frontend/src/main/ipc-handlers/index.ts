/**
 * IPC Handlers Module Index
 *
 * This module exports a single setup function that registers all IPC handlers
 * organized by domain into separate handler modules.
 */

import { type BrowserWindow, ipcMain } from 'electron';
import { AgentManager } from '../agent';
import { TerminalManager } from '../terminal-manager';
import { PythonEnvManager } from '../python-env-manager';

// Import all handler registration functions
import { registerProjectHandlers } from './project-handlers';
import { registerTaskHandlers } from './task-handlers';
import { registerTerminalHandlers } from './terminal-handlers';
import { registerAgenteventsHandlers } from './agent-events-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerProviderAccountHandlers } from './provider-account-handlers';
import { registerFileHandlers } from './file-handlers';
import { registerRoadmapHandlers } from './roadmap-handlers';
import { registerContextHandlers } from './context-handlers';
import { registerEnvHandlers } from './env-handlers';
import { registerCodexAuthHandlers } from './codex-auth-handlers';
import { registerLinearHandlers } from './linear-handlers';
import { registerGithubHandlers } from './github-handlers';
import { registerGitlabHandlers } from './gitlab-handlers';
import { registerHuggingFaceHandlers } from './huggingface-handlers';
import { registerIdeationHandlers } from './ideation-handlers';
import { registerChangelogHandlers } from './changelog-handlers';
import { registerInsightsHandlers } from './insights-handlers';
import { registerMemoryHandlers } from './memory-handlers';
import { registerAppUpdateHandlers } from './app-update-handlers';
import { registerDebugHandlers } from './debug-handlers';
import { registerDiagnosticsHandlers } from './diagnostics-handlers';
import { registerClaudeCodeHandlers } from './claude-code-handlers';
import { registerMcpHandlers } from './mcp-handlers';
import { registerProfileHandlers } from './profile-handlers';
import { registerScreenshotHandlers } from './screenshot-handlers';
import { registerTerminalWorktreeIpcHandlers } from './terminal';
import { registerRateLimitHandlers } from './rate-limit-handlers';
import { registerQueueRoutingHandlers } from './queue-routing-handlers';
import { registerRdrHandlers } from './rdr-handlers';
import { registerRestartHandlers } from './restart-handlers';
import { notificationService } from '../notification-service';
import { setAgentManagerRef } from './utils';
import { activityMonitor } from '../activity-monitor';

// Auto-shutdown handlers (self-registering on import)
import './auto-shutdown-handlers';
import { initAutoShutdown } from './auto-shutdown-handlers';

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

  // Wire up agent manager for circuit breaker cleanup
  setAgentManagerRef(agentManager);

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
  registerProviderAccountHandlers();
  registerCodexAuthHandlers();

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

  // Hugging Face integration handlers
  registerHuggingFaceHandlers();

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
  registerDiagnosticsHandlers();

  // Claude Code CLI handlers (version checking, installation)
  registerClaudeCodeHandlers();

  // MCP server health check handlers
  registerMcpHandlers();

  // API Profile handlers (custom Anthropic-compatible endpoints)
  registerProfileHandlers();

  // Screenshot capture handlers
  registerScreenshotHandlers();

  // Rate limit wait-and-resume handlers (single account scenario)
  registerRateLimitHandlers(agentManager, getMainWindow);

  // Queue routing handlers (rate limit recovery, profile-aware task distribution)
  registerQueueRoutingHandlers(agentManager, getMainWindow);

  // RDR (Recover Debug Resend) handlers - auto-recovery for stuck/errored tasks
  registerRdrHandlers(agentManager);

  // Auto-restart on loop/crash handlers - rebuild and restart on failure
  registerRestartHandlers(agentManager);

  // Activity monitor IPC (renderer reports RDR send success)
  ipcMain.on('activity:record', (_event, source: string) => {
    activityMonitor.recordActivity(source);
  });

  // Restore auto-shutdown monitor if it was enabled before last close
  initAutoShutdown();

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
  registerProviderAccountHandlers,
  registerCodexAuthHandlers,
  registerFileHandlers,
  registerRoadmapHandlers,
  registerContextHandlers,
  registerEnvHandlers,
  registerLinearHandlers,
  registerGithubHandlers,
  registerGitlabHandlers,
  registerHuggingFaceHandlers,
  registerIdeationHandlers,
  registerChangelogHandlers,
  registerInsightsHandlers,
  registerMemoryHandlers,
  registerAppUpdateHandlers,
  registerDebugHandlers,
  registerDiagnosticsHandlers,
  registerClaudeCodeHandlers,
  registerMcpHandlers,
  registerProfileHandlers,
  registerScreenshotHandlers,
  registerRateLimitHandlers,
  registerQueueRoutingHandlers,
  registerRdrHandlers,
  registerRestartHandlers
};
