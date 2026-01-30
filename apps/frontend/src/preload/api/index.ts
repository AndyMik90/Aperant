import { ProjectAPI, createProjectAPI } from './project-api';
import { TerminalAPI, createTerminalAPI } from './terminal-api';
import { TaskAPI, createTaskAPI } from './task-api';
import { SettingsAPI, createSettingsAPI } from './settings-api';
import { FileAPI, createFileAPI } from './file-api';
import { AgentAPI, createAgentAPI } from './agent-api';
import type { IdeationAPI } from './modules/ideation-api';
import type { InsightsAPI } from './modules/insights-api';
import { AppUpdateAPI, createAppUpdateAPI } from './app-update-api';
import { GitHubAPI, createGitHubAPI } from './modules/github-api';
import type { GitLabAPI } from './modules/gitlab-api';
import { DebugAPI, createDebugAPI } from './modules/debug-api';
import { ClaudeCodeAPI, createClaudeCodeAPI } from './modules/claude-code-api';
import { McpAPI, createMcpAPI } from './modules/mcp-api';
import { ProfileAPI, createProfileAPI } from './profile-api';
import { ScreenshotAPI, createScreenshotAPI } from './screenshot-api';
import { QueueAPI, createQueueAPI } from './queue-api';

export interface ElectronAPI extends
  ProjectAPI,
  TerminalAPI,
  TaskAPI,
  SettingsAPI,
  FileAPI,
  AgentAPI,
  IdeationAPI,
  InsightsAPI,
  AppUpdateAPI,
  GitLabAPI,
  DebugAPI,
  ClaudeCodeAPI,
  McpAPI,
  ProfileAPI,
  ScreenshotAPI {
  github: GitHubAPI;
  /** Queue routing API for rate limit recovery */
  queue: QueueAPI;
}

export const createElectronAPI = (): ElectronAPI => ({
  ...createProjectAPI(),
  ...createTerminalAPI(),
  ...createTaskAPI(),
  ...createSettingsAPI(),
  ...createFileAPI(),
  ...createAgentAPI(),  // Includes: Roadmap, Ideation, Insights, Changelog, Linear, GitHub, GitLab, Shell
  ...createAppUpdateAPI(),
  ...createDebugAPI(),
  ...createClaudeCodeAPI(),
  ...createMcpAPI(),
  ...createProfileAPI(),
  ...createScreenshotAPI(),
  github: createGitHubAPI(),
  queue: createQueueAPI()  // Queue routing for rate limit recovery
});

// Export individual API creators for potential use in tests or specialized contexts
// Note: IdeationAPI, InsightsAPI, and GitLabAPI are included in AgentAPI
export {
  createProjectAPI,
  createTerminalAPI,
  createTaskAPI,
  createSettingsAPI,
  createFileAPI,
  createAgentAPI,
  createAppUpdateAPI,
  createProfileAPI,
  createGitHubAPI,
  createDebugAPI,
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
  FileAPI,
  AgentAPI,
  IdeationAPI,
  InsightsAPI,
  AppUpdateAPI,
  ProfileAPI,
  GitHubAPI,
  GitLabAPI,
  DebugAPI,
  ClaudeCodeAPI,
  McpAPI,
  ScreenshotAPI,
  QueueAPI
};
