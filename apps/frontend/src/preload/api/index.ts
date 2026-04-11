import { ProjectAPI, createProjectAPI } from './project-api';
import { TerminalAPI, createTerminalAPI } from './terminal-api';
import { TaskAPI, createTaskAPI } from './task-api';
import { SettingsAPI, createSettingsAPI } from './settings-api';
import { DesktopAPI, createDesktopAPI } from './desktop-api';
import { FileAPI, createFileAPI } from './file-api';
import { AgentAPI, createAgentAPI } from './agent-api';
import type { IdeationAPI } from './modules/ideation-api';
import type { InsightsAPI } from './modules/insights-api';
import { AppUpdateAPI, createAppUpdateAPI } from './app-update-api';
import { GitHubAPI, createGitHubAPI } from './modules/github-api';
import type { GitLabAPI } from './modules/gitlab-api';
import type { HuggingFaceAPI } from './modules/huggingface-api';
import { DebugAPI, createDebugAPI } from './modules/debug-api';
import { DiagnosticsAPI, createDiagnosticsAPI } from './modules/diagnostics-api';
import { ClaudeCodeAPI, createClaudeCodeAPI } from './modules/claude-code-api';
import { McpAPI, createMcpAPI } from './modules/mcp-api';
import { ProfileAPI, createProfileAPI } from './profile-api';
import { ScreenshotAPI, createScreenshotAPI } from './screenshot-api';
import { QueueAPI, createQueueAPI } from './queue-api';
import { ipcRenderer } from 'electron';
export interface ElectronAPI extends
  ProjectAPI,
  TerminalAPI,
  TaskAPI,
  SettingsAPI,
  DesktopAPI,
  FileAPI,
  AgentAPI,
  IdeationAPI,
  InsightsAPI,
  AppUpdateAPI,
  GitLabAPI,
  HuggingFaceAPI,
  DebugAPI,
  DiagnosticsAPI,
  ClaudeCodeAPI,
  McpAPI,
  ProfileAPI,
  ScreenshotAPI {
  github: GitHubAPI;
  /** Queue routing API for rate limit recovery */
  queue: QueueAPI;
  /** Notify main process activity monitor of meaningful work */
  recordActivity: (source: string) => void;
}

export const createElectronAPI = (): ElectronAPI => ({
  ...createProjectAPI(),
  ...createTerminalAPI(),
  ...createTaskAPI(),
  ...createSettingsAPI(),
  ...createDesktopAPI(),
  ...createFileAPI(),
  ...createAgentAPI(),  // Includes: Roadmap, Ideation, Insights, Changelog, Linear, GitHub, GitLab, HuggingFace, Shell
  ...createAppUpdateAPI(),
  ...createDebugAPI(),
  ...createDiagnosticsAPI(),
  ...createClaudeCodeAPI(),
  ...createMcpAPI(),
  ...createProfileAPI(),
  ...createScreenshotAPI(),
  github: createGitHubAPI(),
  queue: createQueueAPI(),  // Queue routing for rate limit recovery
  recordActivity: (source: string) => ipcRenderer.send('activity:record', source),
});

// Export individual API creators for potential use in tests or specialized contexts
// Note: IdeationAPI, InsightsAPI, GitLabAPI, and HuggingFaceAPI are included in AgentAPI
export {
  createProjectAPI,
  createTerminalAPI,
  createTaskAPI,
  createSettingsAPI,
  createDesktopAPI,
  createFileAPI,
  createAgentAPI,
  createAppUpdateAPI,
  createProfileAPI,
  createGitHubAPI,
  createDebugAPI,
  createDiagnosticsAPI,
  createClaudeCodeAPI,
  createMcpAPI,
  createScreenshotAPI,
  createQueueAPI
};

export type {
  ProjectAPI,
  TerminalAPI,
  TaskAPI,
  SettingsAPI,
  DesktopAPI,
  FileAPI,
  AgentAPI,
  IdeationAPI,
  InsightsAPI,
  AppUpdateAPI,
  ProfileAPI,
  GitHubAPI,
  GitLabAPI,
  HuggingFaceAPI,
  DebugAPI,
  DiagnosticsAPI,
  ClaudeCodeAPI,
  McpAPI,
  ScreenshotAPI,
  QueueAPI
};
