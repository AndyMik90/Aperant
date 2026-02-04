/**
 * IPC (Inter-Process Communication) types for Electron API
 */

import type { IPCResult } from './common';
import type { KanbanPreferences } from './kanban';
import type { SupportedIDE, SupportedTerminal } from './settings';
import type {
  Project,
  ProjectSettings,
  AutoBuildVersionInfo,
  InitializationResult,
  CreateProjectFolderResult,
  FileNode,
  ProjectContextData,
  ProjectIndex,
  GraphitiMemoryStatus,
  ContextSearchResult,
  MemoryEpisode,
  ProjectEnvConfig,
  InfrastructureStatus,
  GraphitiValidationResult,
  GraphitiConnectionTestResult,
  GitStatus,
  CustomMcpServer,
  McpHealthCheckResult,
  McpTestConnectionResult
} from './project';
import type { ScreenshotSource } from './screenshot';
import type {
  Task,
  TaskStatus,
  TaskStartOptions,
  ImplementationPlan,
  ExecutionProgress,
  WorktreeStatus,
  WorktreeDiff,
  WorktreeMergeResult,
  WorktreeDiscardResult,
  WorktreeListResult,
  WorktreeCreatePROptions,
  WorktreeCreatePRResult,
  TaskRecoveryResult,
  TaskRecoveryOptions,
  TaskMetadata,
  TaskLogs,
  TaskLogStreamChunk,
  ImageAttachment,
  ReviewReason,
  MergeProgress
} from './task';
import type {
  TerminalCreateOptions,
  TerminalSession,
  TerminalRestoreResult,
  SessionDateInfo,
  SessionDateRestoreResult,
  RateLimitInfo,
  SDKRateLimitInfo,
  AuthFailureInfo,
  RetryWithProfileRequest,
  CreateTerminalWorktreeRequest,
  TerminalWorktreeConfig,
  TerminalWorktreeResult,
  OtherWorktreeInfo,
} from './terminal';
import type {
  ClaudeProfileSettings,
  ClaudeProfile,
  ClaudeAutoSwitchSettings,
  ClaudeAuthResult,
  ClaudeUsageSnapshot,
  AllProfilesUsage,
  TerminalProfileChangedEvent
} from './agent';
import type { AppSettings, SourceEnvConfig, SourceEnvCheckResult } from './settings';
import type { AppUpdateInfo, AppUpdateProgress, AppUpdateAvailableEvent, AppUpdateDownloadedEvent } from './app-update';
import type {
  ChangelogTask,
  TaskSpecContent,
  ChangelogGenerationRequest,
  ChangelogGenerationResult,
  ChangelogSaveRequest,
  ChangelogSaveResult,
  ChangelogGenerationProgress,
  ExistingChangelog,
  GitBranchInfo,
  GitTagInfo,
  GitCommit,
  GitHistoryOptions,
  BranchDiffOptions,
  ReleaseableVersion,
  ReleasePreflightStatus,
  CreateReleaseRequest,
  CreateReleaseResult,
  ReleaseProgress
} from './changelog';
import type {
  IdeationSession,
  IdeationConfig,
  IdeationStatus,
  IdeationGenerationStatus,
  Idea,
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsModelConfig
} from './insights';
import type {
  Roadmap,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  PersistedRoadmapProgress
} from './roadmap';
import type {
  LinearTeam,
  LinearProject,
  LinearIssue,
  LinearImportResult,
  LinearSyncStatus,
  GitHubRepository,
  GitHubIssue,
  GitHubSyncStatus,
  GitHubImportResult,
  GitHubInvestigationResult,
  GitHubInvestigationStatus,
  GitLabProject,
  GitLabIssue,
  GitLabMergeRequest,
  GitLabNote,
  GitLabGroup,
  GitLabSyncStatus,
  GitLabImportResult,
  GitLabInvestigationResult,
  GitLabInvestigationStatus,
  GitLabMRReviewResult,
  GitLabMRReviewProgress,
  GitLabNewCommitsCheck
} from './integrations';
import type { APIProfile, ProfilesFile, TestConnectionResult, DiscoverModelsResult } from './profile';

// ============================================
// Branch Types
// ============================================

/**
 * Branch type indicator for distinguishing local from remote branches
 */
export type GitBranchType = 'local' | 'remote';

/**
 * Structured branch information for UI display with type indicators
 * Used in branch selection dropdowns to distinguish local vs remote branches
 */
export interface GitBranchDetail {
  /** The branch name (e.g., 'main', 'origin/main') */
  name: string;
  /** Whether this is a local or remote branch */
  type: GitBranchType;
  /** Display name for UI (e.g., 'main' for local, 'origin/main' for remote) */
  displayName: string;
  /** Whether this is the currently checked out branch */
  isCurrent?: boolean;
}

// ============================================
// Electron API
// ============================================

// Electron API exposed via contextBridge
// Tab state interface (persisted in main process)
export interface TabState {
  openProjectIds: string[];
  activeProjectId: string | null;
  tabOrder: string[];
}

export interface ElectronAPI {
  // Project operations
  addProject: (projectPath: string) => Promise<IPCResult<Project>>;
  removeProject: (projectId: string) => Promise<IPCResult>;
  getProjects: () => Promise<IPCResult<Project[]>>;
  updateProjectSettings: (projectId: string, settings: Partial<ProjectSettings>) => Promise<IPCResult>;
  initializeProject: (projectId: string) => Promise<IPCResult<InitializationResult>>;
  checkProjectVersion: (projectId: string) => Promise<IPCResult<AutoBuildVersionInfo>>;

  // Tab State (persisted in main process for reliability)
  getTabState: () => Promise<IPCResult<TabState>>;
  saveTabState: (tabState: TabState) => Promise<IPCResult>;

  // Kanban preferences (per-project column collapse state)
  getKanbanPreferences: (projectId: string) => Promise<IPCResult<KanbanPreferences | null>>;
  saveKanbanPreferences: (projectId: string, preferences: KanbanPreferences) => Promise<IPCResult>;

  // Task operations
  getTasks: (projectId: string, options?: { forceRefresh?: boolean }) => Promise<IPCResult<Task[]>>;
  createTask: (projectId: string, title: string, description: string, metadata?: TaskMetadata) => Promise<IPCResult<Task>>;
  deleteTask: (taskId: string) => Promise<IPCResult>;
  updateTask: (taskId: string, updates: { title?: string; description?: string }) => Promise<IPCResult<Task>>;
  startTask: (taskId: string, options?: TaskStartOptions) => void;
  stopTask: (taskId: string) => void;
  submitReview: (taskId: string, approved: boolean, feedback?: string, images?: ImageAttachment[]) => Promise<IPCResult>;
  updateTaskStatus: (taskId: string, status: TaskStatus, options?: { forceCleanup?: boolean }) => Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }>;
  recoverStuckTask: (taskId: string, options?: TaskRecoveryOptions) => Promise<IPCResult<TaskRecoveryResult>>;
  checkTaskRunning: (taskId: string) => Promise<IPCResult<boolean>>;
  resumePausedTask: (taskId: string) => Promise<IPCResult>;

  // Image operations
  loadImageThumbnail: (projectPath: string, specId: string, imagePath: string) => Promise<IPCResult<string>>;

  // Workspace management (for human review)
  // Per-spec architecture: Each spec has its own worktree at .worktrees/{spec-name}/
  getWorktreeStatus: (taskId: string) => Promise<IPCResult<WorktreeStatus>>;
  getWorktreeDiff: (taskId: string) => Promise<IPCResult<WorktreeDiff>>;
  mergeWorktree: (taskId: string, options?: { noCommit?: boolean }) => Promise<IPCResult<WorktreeMergeResult>>;
  mergeWorktreePreview: (taskId: string) => Promise<IPCResult<WorktreeMergeResult>>;
  createWorktreePR: (taskId: string, options?: WorktreeCreatePROptions) => Promise<IPCResult<WorktreeCreatePRResult>>;
  discardWorktree: (taskId: string, skipStatusChange?: boolean) => Promise<IPCResult<WorktreeDiscardResult>>;
  discardOrphanedWorktree: (projectId: string, specName: string) => Promise<IPCResult<WorktreeDiscardResult>>;
  clearStagedState: (taskId: string) => Promise<IPCResult<{ cleared: boolean }>>;
  listWorktrees: (projectId: string, options?: { includeStats?: boolean }) => Promise<IPCResult<WorktreeListResult>>;
  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeDetectTools: () => Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>>;

  // Task archive operations
  archiveTasks: (projectId: string, taskIds: string[], version?: string) => Promise<IPCResult<boolean>>;
  unarchiveTasks: (projectId: string, taskIds: string[]) => Promise<IPCResult<boolean>>;

  // Event listeners
  onTaskProgress: (callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void) => () => void;
  onTaskError: (callback: (taskId: string, error: string, projectId?: string) => void) => () => void;
  onTaskLog: (callback: (taskId: string, log: string, projectId?: string) => void) => () => void;
  onTaskStatusChange: (callback: (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: ReviewReason) => void) => () => void;
  onTaskExecutionProgress: (callback: (taskId: string, progress: ExecutionProgress, projectId?: string) => void) => () => void;

  // Terminal operations
  createTerminal: (options: TerminalCreateOptions) => Promise<IPCResult>;
  destroyTerminal: (id: string) => Promise<IPCResult>;
  sendTerminalInput: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<IPCResult<{ success: boolean }>>;
  invokeClaudeInTerminal: (id: string, cwd?: string) => void;
  generateTerminalName: (command: string, cwd?: string) => Promise<IPCResult<string>>;
  setTerminalTitle: (id: string, title: string) => void;
  setTerminalWorktreeConfig: (id: string, config: TerminalWorktreeConfig | undefined) => void;

  // Terminal session management (persistence/restore)
  getTerminalSessions: (projectPath: string) => Promise<IPCResult<TerminalSession[]>>;
  restoreTerminalSession: (session: TerminalSession, cols?: number, rows?: number) => Promise<IPCResult<TerminalRestoreResult>>;
  clearTerminalSessions: (projectPath: string) => Promise<IPCResult>;
  resumeClaudeInTerminal: (id: string, sessionId?: string) => void;
  activateDeferredClaudeResume: (id: string) => void;
  getTerminalSessionDates: (projectPath?: string) => Promise<IPCResult<SessionDateInfo[]>>;
  getTerminalSessionsForDate: (date: string, projectPath: string) => Promise<IPCResult<TerminalSession[]>>;
  restoreTerminalSessionsFromDate: (date: string, projectPath: string, cols?: number, rows?: number) => Promise<IPCResult<SessionDateRestoreResult>>;
  saveTerminalBuffer: (terminalId: string, serialized: string) => Promise<void>;
  checkTerminalPtyAlive: (terminalId: string) => Promise<IPCResult<{ alive: boolean }>>;
  updateTerminalDisplayOrders: (
    projectPath: string,
    orders: Array<{ terminalId: string; displayOrder: number }>
  ) => Promise<IPCResult>;

  // Terminal worktree operations (isolated development)
  createTerminalWorktree: (request: CreateTerminalWorktreeRequest) => Promise<TerminalWorktreeResult>;
  listTerminalWorktrees: (projectPath: string) => Promise<IPCResult<TerminalWorktreeConfig[]>>;
  removeTerminalWorktree: (projectPath: string, name: string, deleteBranch?: boolean) => Promise<IPCResult>;
  listOtherWorktrees: (projectPath: string) => Promise<IPCResult<OtherWorktreeInfo[]>>;

  // Terminal event listeners
  onTerminalOutput: (callback: (id: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (id: string, exitCode: number) => void) => () => void;
  onTerminalTitleChange: (callback: (id: string, title: string) => void) => () => void;
  /** Listen for worktree config changes (synced from main process during restoration) */
  onTerminalWorktreeConfigChange: (callback: (id: string, config: TerminalWorktreeConfig | undefined) => void) => () => void;
  onTerminalClaudeSession: (callback: (id: string, sessionId: string) => void) => () => void;
  onTerminalRateLimit: (callback: (info: RateLimitInfo) => void) => () => void;
  /** Listen for OAuth authentication completion (token is auto-saved to profile, never exposed to frontend) */
  onTerminalOAuthToken: (callback: (info: {
    terminalId: string;
    profileId?: string;
    email?: string;
    success: boolean;
    message?: string;
    detectedAt: string;
    /** If true, user should complete onboarding in terminal before closing */
    needsOnboarding?: boolean;
  }) => void) => () => void;
  /** Listen for auth terminal creation - allows UI to display the OAuth terminal */
  onTerminalAuthCreated: (callback: (info: {
    terminalId: string;
    profileId: string;
    profileName: string
  }) => void) => () => void;
  /** Listen for Claude busy state changes (for visual indicator: red=busy, green=idle) */
  onTerminalClaudeBusy: (callback: (id: string, isBusy: boolean) => void) => () => void;
  /** Listen for Claude exit (user closed Claude within terminal, returned to shell) */
  onTerminalClaudeExit: (callback: (id: string) => void) => () => void;
  /** Listen for onboarding complete (Claude shows ready state after login/onboarding) */
  onTerminalOnboardingComplete: (callback: (info: {
    terminalId: string;
    profileId?: string;
    detectedAt: string;
  }) => void) => () => void;
  /** Listen for pending Claude resume notifications (for deferred resume on tab activation) */
  onTerminalPendingResume: (callback: (id: string, sessionId?: string) => void) => () => void;
  /** Listen for profile change events - terminals need to be recreated with new profile env vars */
  onTerminalProfileChanged: (callback: (event: TerminalProfileChangedEvent) => void) => () => void;
  /** Listen for OAuth code input requests (manual OAuth flow) */
  onTerminalOAuthCodeNeeded: (callback: (info: {
    terminalId: string;
    profileId: string;
    profileName: string
  }) => void) => () => void;
  /** Submit OAuth code from user (for manual OAuth flow) */
  submitOAuthCode: (terminalId: string, code: string) => Promise<IPCResult>;

  // Claude profile management (multi-account support)
  getClaudeProfiles: () => Promise<IPCResult<ClaudeProfileSettings>>;
  saveClaudeProfile: (profile: ClaudeProfile) => Promise<IPCResult<ClaudeProfile>>;
  deleteClaudeProfile: (profileId: string) => Promise<IPCResult>;
  renameClaudeProfile: (profileId: string, newName: string) => Promise<IPCResult>;
  setActiveClaudeProfile: (profileId: string) => Promise<IPCResult>;
  /** Switch terminal to use a different Claude profile (restarts Claude with new config) */
  switchClaudeProfile: (terminalId: string, profileId: string) => Promise<IPCResult>;
  /** Initialize authentication for a Claude profile (legacy - uses hidden terminal) */
  initializeClaudeProfile: (profileId: string) => Promise<IPCResult>;
  /** Set OAuth token for a profile (used when capturing from terminal) */
  setClaudeProfileToken: (profileId: string, token: string, email?: string) => Promise<IPCResult>;
  /** Prepare authentication for a Claude profile - returns terminal config for embedded terminal */
  authenticateClaudeProfile: (profileId: string) => Promise<IPCResult<{ terminalId: string; configDir: string }>>;
  /** Check if a profile has been authenticated (by checking .claude.json) */
  verifyClaudeProfileAuth: (profileId: string) => Promise<IPCResult<{ authenticated: boolean; email?: string }>>;
  /** Get auto-switch settings */
  getAutoSwitchSettings: () => Promise<IPCResult<ClaudeAutoSwitchSettings>>;
  /** Update auto-switch settings */
  updateAutoSwitchSettings: (settings: Partial<ClaudeAutoSwitchSettings>) => Promise<IPCResult>;
  /** Get unified account priority order (both OAuth and API profiles) */
  getAccountPriorityOrder: () => Promise<IPCResult<string[]>>;
  /** Set unified account priority order */
  setAccountPriorityOrder: (order: string[]) => Promise<IPCResult>;
  /** Request usage fetch from a terminal (sends /usage command) */
  fetchClaudeUsage: (terminalId: string) => Promise<IPCResult>;
  /** Get the best available profile (for manual switching) */
  getBestAvailableProfile: (excludeProfileId?: string) => Promise<IPCResult<ClaudeProfile | null>>;
  /** Listen for SDK/CLI rate limit events (non-terminal) */
  onSDKRateLimit: (callback: (info: SDKRateLimitInfo) => void) => () => void;
  /** Listen for auth failure events (401 errors requiring re-authentication) */
  onAuthFailure: (callback: (info: AuthFailureInfo) => void) => () => void;
  /** Retry a rate-limited operation with a different profile */
  retryWithProfile: (request: RetryWithProfileRequest) => Promise<IPCResult>;

  // Usage Monitoring (Proactive Account Switching)
  /** Request current usage snapshot */
  requestUsageUpdate: () => Promise<IPCResult<ClaudeUsageSnapshot | null>>;
  /** Request all profiles usage immediately (for startup/refresh)
   * @param forceRefresh - If true, bypasses cache to get fresh data for all profiles
   */
  requestAllProfilesUsage: (forceRefresh?: boolean) => Promise<IPCResult<AllProfilesUsage | null>>;
  /** Listen for usage data updates */
  onUsageUpdated: (callback: (usage: ClaudeUsageSnapshot) => void) => () => void;
  /** Listen for proactive swap notifications */
  onProactiveSwapNotification: (callback: (notification: {
    fromProfile: { id: string; name: string };
    toProfile: { id: string; name: string };
    reason: string;
    usageSnapshot: ClaudeUsageSnapshot;
  }) => void) => () => void;
  /** Listen for all profiles usage updates (for multi-profile display) */
  onAllProfilesUsageUpdated?: (callback: (allProfilesUsage: AllProfilesUsage) => void) => () => void;

  // App settings
  getSettings: () => Promise<IPCResult<AppSettings>>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<IPCResult>;

  // Spell check
  setSpellCheckLanguages: (language: string) => Promise<IPCResult<{ success: boolean }>>;

  // Sentry error reporting
  notifySentryStateChanged: (enabled: boolean) => void;
  getSentryDsn: () => Promise<string>;
  getSentryConfig: () => Promise<{ dsn: string; tracesSampleRate: number; profilesSampleRate: number }>;

  getCliToolsInfo: () => Promise<IPCResult<{
    python: import('./cli').ToolDetectionResult;
    git: import('./cli').ToolDetectionResult;
    gh: import('./cli').ToolDetectionResult;
    glab: import('./cli').ToolDetectionResult;
    claude: import('./cli').ToolDetectionResult;
  }>>;
  /** Check if Claude Code onboarding is complete (reads ~/.claude.json) */
  getClaudeCodeOnboardingStatus: () => Promise<IPCResult<{ hasCompletedOnboarding: boolean }>>;

  // API Profile management (custom Anthropic-compatible endpoints)
  getAPIProfiles: () => Promise<IPCResult<ProfilesFile>>;
  saveAPIProfile: (profile: Omit<APIProfile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<IPCResult<APIProfile>>;
  updateAPIProfile: (profile: APIProfile) => Promise<IPCResult<APIProfile>>;
  deleteAPIProfile: (profileId: string) => Promise<IPCResult>;
  setActiveAPIProfile: (profileId: string | null) => Promise<IPCResult>;
  // Note: AbortSignal is handled in preload via separate cancel IPC channels, not passed through IPC
  testConnection: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<IPCResult<TestConnectionResult>>;
  discoverModels: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<IPCResult<DiscoverModelsResult>>;

  // Dialog operations
  selectDirectory: () => Promise<string | null>;
  createProjectFolder: (location: string, name: string, initGit: boolean) => Promise<IPCResult<CreateProjectFolderResult>>;
  getDefaultProjectLocation: () => Promise<string | null>;

  // App info
  getAppVersion: () => Promise<string>;

  // Roadmap operations
  getRoadmap: (projectId: string) => Promise<IPCResult<Roadmap | null>>;
  getRoadmapStatus: (projectId: string) => Promise<IPCResult<{ isRunning: boolean }>>;
  saveRoadmap: (projectId: string, roadmap: Roadmap) => Promise<IPCResult>;
  generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => void;
  refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => void;
  stopRoadmap: (projectId: string) => Promise<IPCResult>;
  updateFeatureStatus: (
    projectId: string,
    featureId: string,
    status: RoadmapFeatureStatus
  ) => Promise<IPCResult>;
  convertFeatureToSpec: (
    projectId: string,
    featureId: string
  ) => Promise<IPCResult<Task>>;

  // Roadmap progress persistence
  saveRoadmapProgress: (projectId: string, progress: PersistedRoadmapProgress) => Promise<IPCResult>;
  loadRoadmapProgress: (projectId: string) => Promise<IPCResult<PersistedRoadmapProgress | null>>;
  clearRoadmapProgress: (projectId: string) => Promise<IPCResult>;

  // Roadmap event listeners
  onRoadmapProgress: (
    callback: (projectId: string, status: RoadmapGenerationStatus) => void
  ) => () => void;
  onRoadmapComplete: (
    callback: (projectId: string, roadmap: Roadmap) => void
  ) => () => void;
  onRoadmapError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;
  onRoadmapStopped: (
    callback: (projectId: string) => void
  ) => () => void;

  // Context operations
  getProjectContext: (projectId: string) => Promise<IPCResult<ProjectContextData>>;
  refreshProjectIndex: (projectId: string) => Promise<IPCResult<ProjectIndex>>;
  getMemoryStatus: (projectId: string) => Promise<IPCResult<GraphitiMemoryStatus>>;
  searchMemories: (projectId: string, query: string) => Promise<IPCResult<ContextSearchResult[]>>;
  getRecentMemories: (projectId: string, limit?: number) => Promise<IPCResult<MemoryEpisode[]>>;

  // Environment configuration operations
  getProjectEnv: (projectId: string) => Promise<IPCResult<ProjectEnvConfig>>;
  updateProjectEnv: (projectId: string, config: Partial<ProjectEnvConfig>) => Promise<IPCResult>;
  checkClaudeAuth: (projectId: string) => Promise<IPCResult<ClaudeAuthResult>>;
  invokeClaudeSetup: (projectId: string) => Promise<IPCResult<ClaudeAuthResult>>;

  // Memory Infrastructure operations (LadybugDB - no Docker required)
  getMemoryInfrastructureStatus: (dbPath?: string) => Promise<IPCResult<InfrastructureStatus>>;
  listMemoryDatabases: (dbPath?: string) => Promise<IPCResult<string[]>>;
  testMemoryConnection: (dbPath?: string, database?: string) => Promise<IPCResult<GraphitiValidationResult>>;

  // Graphiti validation operations
  validateLLMApiKey: (provider: string, apiKey: string) => Promise<IPCResult<GraphitiValidationResult>>;
  testGraphitiConnection: (config: {
    dbPath?: string;
    database?: string;
    llmProvider: string;
    apiKey: string;
  }) => Promise<IPCResult<GraphitiConnectionTestResult>>;

  // Linear integration operations
  getLinearTeams: (projectId: string) => Promise<IPCResult<LinearTeam[]>>;
  getLinearProjects: (projectId: string, teamId: string) => Promise<IPCResult<LinearProject[]>>;
  getLinearIssues: (projectId: string, teamId?: string, projectId_?: string) => Promise<IPCResult<LinearIssue[]>>;
  importLinearIssues: (projectId: string, issueIds: string[]) => Promise<IPCResult<LinearImportResult>>;
  checkLinearConnection: (projectId: string) => Promise<IPCResult<LinearSyncStatus>>;

  // GitHub integration operations
  getGitHubRepositories: (projectId: string) => Promise<IPCResult<GitHubRepository[]>>;
  getGitHubIssues: (
    projectId: string,
    state?: 'open' | 'closed' | 'all',
    page?: number,
    fetchAll?: boolean
  ) => Promise<IPCResult<{ issues: GitHubIssue[]; hasMore: boolean }>>;
  getGitHubIssue: (projectId: string, issueNumber: number) => Promise<IPCResult<GitHubIssue>>;
  checkGitHubConnection: (projectId: string) => Promise<IPCResult<GitHubSyncStatus>>;
  investigateGitHubIssue: (projectId: string, issueNumber: number, selectedCommentIds?: number[]) => void;
  getIssueComments: (projectId: string, issueNumber: number) => Promise<IPCResult<Array<{ id: number; body: string; user: { login: string; avatar_url?: string }; created_at: string; updated_at: string }>>>;
  importGitHubIssues: (projectId: string, issueNumbers: number[]) => Promise<IPCResult<GitHubImportResult>>;
  createGitHubRelease: (
    projectId: string,
    version: string,
    releaseNotes: string,
    options?: { draft?: boolean; prerelease?: boolean }
  ) => Promise<IPCResult<{ url: string }>>;

  // GitHub OAuth operations (gh CLI)
  checkGitHubCli: () => Promise<IPCResult<{ installed: boolean; version?: string }>>;
  checkGitHubAuth: () => Promise<IPCResult<{ authenticated: boolean; username?: string }>>;
  startGitHubAuth: () => Promise<IPCResult<{
    success: boolean;
    message?: string;
    deviceCode?: string;
    authUrl?: string;
    browserOpened?: boolean;
    fallbackUrl?: string;
  }>>;
  getGitHubToken: () => Promise<IPCResult<{ token: string }>>;
  getGitHubUser: () => Promise<IPCResult<{ username: string; name?: string }>>;
  listGitHubUserRepos: () => Promise<IPCResult<{ repos: Array<{ fullName: string; description: string | null; isPrivate: boolean }> }>>;
  detectGitHubRepo: (projectPath: string) => Promise<IPCResult<string>>;
  getGitHubBranches: (repo: string, token: string) => Promise<IPCResult<string[]>>;
  createGitHubRepo: (
    repoName: string,
    options: { description?: string; isPrivate?: boolean; projectPath: string; owner?: string }
  ) => Promise<IPCResult<{ fullName: string; url: string }>>;
  addGitRemote: (
    projectPath: string,
    repoFullName: string
  ) => Promise<IPCResult<{ remoteUrl: string }>>;
  listGitHubOrgs: () => Promise<IPCResult<{ orgs: Array<{ login: string; avatarUrl?: string }> }>>;

  // GitHub OAuth device code event (streams device code during auth flow)
  onGitHubAuthDeviceCode: (
    callback: (data: { deviceCode: string; authUrl: string; browserOpened: boolean }) => void
  ) => () => void;

  // GitHub event listeners
  onGitHubInvestigationProgress: (
    callback: (projectId: string, status: GitHubInvestigationStatus) => void
  ) => () => void;
  onGitHubInvestigationComplete: (
    callback: (projectId: string, result: GitHubInvestigationResult) => void
  ) => () => void;
  onGitHubInvestigationError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;

  // GitLab integration operations
  getGitLabProjects: (projectId: string) => Promise<IPCResult<GitLabProject[]>>;
  getGitLabIssues: (projectId: string, state?: 'opened' | 'closed' | 'all') => Promise<IPCResult<GitLabIssue[]>>;
  getGitLabIssue: (projectId: string, issueIid: number) => Promise<IPCResult<GitLabIssue>>;
  getGitLabIssueNotes: (projectId: string, issueIid: number) => Promise<IPCResult<GitLabNote[]>>;
  checkGitLabConnection: (projectId: string) => Promise<IPCResult<GitLabSyncStatus>>;
  investigateGitLabIssue: (projectId: string, issueIid: number, selectedNoteIds?: number[]) => void;
  importGitLabIssues: (projectId: string, issueIids: number[]) => Promise<IPCResult<GitLabImportResult>>;
  createGitLabRelease: (
    projectId: string,
    tagName: string,
    releaseNotes: string,
    options?: { ref?: string }
  ) => Promise<IPCResult<{ url: string }>>;

  // GitLab Merge Request operations
  getGitLabMergeRequests: (projectId: string, state?: 'opened' | 'closed' | 'merged' | 'all') => Promise<IPCResult<GitLabMergeRequest[]>>;
  getGitLabMergeRequest: (projectId: string, mrIid: number) => Promise<IPCResult<GitLabMergeRequest>>;
  createGitLabMergeRequest: (
    projectId: string,
    options: {
      title: string;
      description?: string;
      sourceBranch: string;
      targetBranch: string;
      labels?: string[];
      assigneeIds?: number[];
      removeSourceBranch?: boolean;
      squash?: boolean;
    }
  ) => Promise<IPCResult<GitLabMergeRequest>>;
  updateGitLabMergeRequest: (
    projectId: string,
    mrIid: number,
    updates: { title?: string; description?: string; labels?: string[]; state_event?: 'close' | 'reopen' }
  ) => Promise<IPCResult<GitLabMergeRequest>>;

  // GitLab MR Review operations (AI-powered)
  getGitLabMRReview: (projectId: string, mrIid: number) => Promise<GitLabMRReviewResult | null>;
  runGitLabMRReview: (projectId: string, mrIid: number) => void;
  runGitLabMRFollowupReview: (projectId: string, mrIid: number) => void;
  postGitLabMRReview: (projectId: string, mrIid: number, selectedFindingIds?: string[]) => Promise<boolean>;
  postGitLabMRNote: (projectId: string, mrIid: number, body: string) => Promise<boolean>;
  mergeGitLabMR: (projectId: string, mrIid: number, mergeMethod?: 'merge' | 'squash' | 'rebase') => Promise<boolean>;
  assignGitLabMR: (projectId: string, mrIid: number, userIds: number[]) => Promise<boolean>;
  approveGitLabMR: (projectId: string, mrIid: number) => Promise<boolean>;
  cancelGitLabMRReview: (projectId: string, mrIid: number) => Promise<boolean>;
  checkGitLabMRNewCommits: (projectId: string, mrIid: number) => Promise<GitLabNewCommitsCheck>;

  // GitLab MR Review event listeners
  onGitLabMRReviewProgress: (
    callback: (projectId: string, progress: GitLabMRReviewProgress) => void
  ) => () => void;
  onGitLabMRReviewComplete: (
    callback: (projectId: string, result: GitLabMRReviewResult) => void
  ) => () => void;
  onGitLabMRReviewError: (
    callback: (projectId: string, data: { mrIid: number; error: string }) => void
  ) => () => void;

  // GitLab OAuth operations (glab CLI)
  checkGitLabCli: () => Promise<IPCResult<{ installed: boolean; version?: string }>>;
  installGitLabCli: () => Promise<IPCResult<{ command: string }>>;
  checkGitLabAuth: (hostname?: string) => Promise<IPCResult<{ authenticated: boolean; username?: string }>>;
  startGitLabAuth: (hostname?: string) => Promise<IPCResult<{
    success: boolean;
    message?: string;
    browserOpened?: boolean;
    fallbackUrl?: string;
  }>>;
  getGitLabToken: (hostname?: string) => Promise<IPCResult<{ token: string }>>;
  getGitLabUser: (hostname?: string) => Promise<IPCResult<{ username: string; name?: string }>>;
  listGitLabUserProjects: (hostname?: string) => Promise<IPCResult<{ projects: Array<{ pathWithNamespace: string; description: string | null; visibility: string }> }>>;
  detectGitLabProject: (projectPath: string) => Promise<IPCResult<{ project: string; instanceUrl: string } | null>>;
  getGitLabBranches: (projectPath: string, token: string, instanceUrl?: string) => Promise<IPCResult<string[]>>;
  createGitLabProject: (
    projectName: string,
    options: { description?: string; visibility?: 'private' | 'internal' | 'public'; projectPath: string; namespaceId?: number; hostname?: string }
  ) => Promise<IPCResult<{ pathWithNamespace: string; webUrl: string }>>;
  addGitLabRemote: (
    projectPath: string,
    projectPathWithNamespace: string,
    instanceUrl?: string
  ) => Promise<IPCResult<{ remoteUrl: string }>>;
  listGitLabGroups: (hostname?: string) => Promise<IPCResult<{ groups: GitLabGroup[] }>>;

  // GitLab event listeners
  onGitLabInvestigationProgress: (
    callback: (projectId: string, status: GitLabInvestigationStatus) => void
  ) => () => void;
  onGitLabInvestigationComplete: (
    callback: (projectId: string, result: GitLabInvestigationResult) => void
  ) => () => void;
  onGitLabInvestigationError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;

  // Release operations
  getReleaseableVersions: (projectId: string) => Promise<IPCResult<ReleaseableVersion[]>>;
  runReleasePreflightCheck: (projectId: string, version: string) => Promise<IPCResult<ReleasePreflightStatus>>;
  createRelease: (request: CreateReleaseRequest) => void;

  // Release event listeners
  onReleaseProgress: (
    callback: (projectId: string, progress: ReleaseProgress) => void
  ) => () => void;
  onReleaseComplete: (
    callback: (projectId: string, result: CreateReleaseResult) => void
  ) => () => void;
  onReleaseError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;

  // Ideation operations
  getIdeation: (projectId: string) => Promise<IPCResult<IdeationSession | null>>;
  generateIdeation: (projectId: string, config: IdeationConfig) => void;
  refreshIdeation: (projectId: string, config: IdeationConfig) => void;
  stopIdeation: (projectId: string) => Promise<IPCResult>;
  updateIdeaStatus: (projectId: string, ideaId: string, status: IdeationStatus) => Promise<IPCResult>;
  convertIdeaToTask: (projectId: string, ideaId: string) => Promise<IPCResult<Task>>;
  dismissIdea: (projectId: string, ideaId: string) => Promise<IPCResult>;
  dismissAllIdeas: (projectId: string) => Promise<IPCResult>;
  archiveIdea: (projectId: string, ideaId: string) => Promise<IPCResult>;
  deleteIdea: (projectId: string, ideaId: string) => Promise<IPCResult>;
  deleteMultipleIdeas: (projectId: string, ideaIds: string[]) => Promise<IPCResult>;

  // Ideation event listeners
  onIdeationProgress: (
    callback: (projectId: string, status: IdeationGenerationStatus) => void
  ) => () => void;
  onIdeationLog: (
    callback: (projectId: string, log: string) => void
  ) => () => void;
  onIdeationComplete: (
    callback: (projectId: string, session: IdeationSession) => void
  ) => () => void;
  onIdeationError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;
  onIdeationStopped: (
    callback: (projectId: string) => void
  ) => () => void;
  onIdeationTypeComplete: (
    callback: (projectId: string, ideationType: string, ideas: Idea[]) => void
  ) => () => void;
  onIdeationTypeFailed: (
    callback: (projectId: string, ideationType: string) => void
  ) => () => void;

  // Electron app update operations
  checkAppUpdate: () => Promise<IPCResult<AppUpdateInfo | null>>;
  downloadAppUpdate: () => Promise<IPCResult>;
  downloadStableUpdate: () => Promise<IPCResult>;
  installAppUpdate: () => void;
  getDownloadedAppUpdate: () => Promise<IPCResult<AppUpdateInfo | null>>;

  // Electron app update event listeners
  onAppUpdateAvailable: (
    callback: (info: AppUpdateAvailableEvent) => void
  ) => () => void;
  onAppUpdateDownloaded: (
    callback: (info: AppUpdateDownloadedEvent) => void
  ) => () => void;
  onAppUpdateProgress: (
    callback: (progress: AppUpdateProgress) => void
  ) => () => void;
  onAppUpdateStableDowngrade: (
    callback: (info: AppUpdateInfo) => void
  ) => () => void;

  // Shell operations
  openExternal: (url: string) => Promise<void>;
  openTerminal: (dirPath: string) => Promise<IPCResult<void>>;

  // Auto Claude source environment operations
  getSourceEnv: () => Promise<IPCResult<SourceEnvConfig>>;
  updateSourceEnv: (config: { claudeOAuthToken?: string }) => Promise<IPCResult>;
  checkSourceToken: () => Promise<IPCResult<SourceEnvCheckResult>>;

  // Changelog operations
  getChangelogDoneTasks: (projectId: string, tasks?: Task[]) => Promise<IPCResult<ChangelogTask[]>>;
  loadTaskSpecs: (projectId: string, taskIds: string[]) => Promise<IPCResult<TaskSpecContent[]>>;
  generateChangelog: (request: ChangelogGenerationRequest) => void; // Async with progress events
  saveChangelog: (request: ChangelogSaveRequest) => Promise<IPCResult<ChangelogSaveResult>>;
  readExistingChangelog: (projectId: string) => Promise<IPCResult<ExistingChangelog>>;
  suggestChangelogVersion: (
    projectId: string,
    taskIds: string[]
  ) => Promise<IPCResult<{ version: string; reason: string }>>;
  suggestChangelogVersionFromCommits: (
    projectId: string,
    commits: import('./changelog').GitCommit[]
  ) => Promise<IPCResult<{ version: string; reason: string }>>;

  // Changelog git operations (for git-based changelog generation)
  getChangelogBranches: (projectId: string) => Promise<IPCResult<GitBranchInfo[]>>;
  getChangelogTags: (projectId: string) => Promise<IPCResult<GitTagInfo[]>>;
  getChangelogCommitsPreview: (
    projectId: string,
    options: GitHistoryOptions | BranchDiffOptions,
    mode: 'git-history' | 'branch-diff'
  ) => Promise<IPCResult<GitCommit[]>>;
  saveChangelogImage: (
    projectId: string,
    imageData: string,
    filename: string
  ) => Promise<IPCResult<{ relativePath: string; url: string }>>;
  readLocalImage: (
    projectPath: string,
    relativePath: string
  ) => Promise<IPCResult<string>>;

  // Changelog event listeners
  onChangelogGenerationProgress: (
    callback: (projectId: string, progress: ChangelogGenerationProgress) => void
  ) => () => void;
  onChangelogGenerationComplete: (
    callback: (projectId: string, result: ChangelogGenerationResult) => void
  ) => () => void;
  onChangelogGenerationError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;

  // Insights operations
  getInsightsSession: (projectId: string) => Promise<IPCResult<InsightsSession | null>>;
  sendInsightsMessage: (projectId: string, message: string, modelConfig?: InsightsModelConfig) => void;
  clearInsightsSession: (projectId: string) => Promise<IPCResult>;
  createTaskFromInsights: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ) => Promise<IPCResult<Task>>;
  listInsightsSessions: (projectId: string) => Promise<IPCResult<InsightsSessionSummary[]>>;
  newInsightsSession: (projectId: string) => Promise<IPCResult<InsightsSession>>;
  switchInsightsSession: (projectId: string, sessionId: string) => Promise<IPCResult<InsightsSession | null>>;
  deleteInsightsSession: (projectId: string, sessionId: string) => Promise<IPCResult>;
  renameInsightsSession: (projectId: string, sessionId: string, newTitle: string) => Promise<IPCResult>;
  updateInsightsModelConfig: (projectId: string, sessionId: string, modelConfig: InsightsModelConfig) => Promise<IPCResult>;

  // Insights event listeners
  onInsightsStreamChunk: (
    callback: (projectId: string, chunk: InsightsStreamChunk) => void
  ) => () => void;
  onInsightsStatus: (
    callback: (projectId: string, status: InsightsChatStatus) => void
  ) => () => void;
  onInsightsError: (
    callback: (projectId: string, error: string) => void
  ) => () => void;
  onInsightsSessionUpdated: (
    callback: (projectId: string, session: InsightsSession) => void
  ) => () => void;

  // Task logs operations
  getTaskLogs: (projectId: string, specId: string) => Promise<IPCResult<TaskLogs | null>>;
  watchTaskLogs: (projectId: string, specId: string) => Promise<IPCResult>;
  unwatchTaskLogs: (specId: string) => Promise<IPCResult>;

  // Task logs event listeners
  onTaskLogsChanged: (
    callback: (specId: string, logs: TaskLogs) => void
  ) => () => void;
  onTaskLogsStream: (
    callback: (specId: string, chunk: TaskLogStreamChunk) => void
  ) => () => void;
  onMergeProgress: (
    callback: (taskId: string, progress: MergeProgress) => void
  ) => () => void;

  // File explorer operations
  listDirectory: (dirPath: string) => Promise<IPCResult<FileNode[]>>;
  readFile: (filePath: string) => Promise<IPCResult<string>>;

  // Git operations
  /** @deprecated Will return GitBranchDetail[] in future - see getGitBranchesWithInfo */
  getGitBranches: (projectPath: string) => Promise<IPCResult<string[]>>;
  /** Get branches with structured type information (local vs remote) */
  getGitBranchesWithInfo: (projectPath: string) => Promise<IPCResult<GitBranchDetail[]>>;
  getCurrentGitBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  detectMainBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  checkGitStatus: (projectPath: string) => Promise<IPCResult<GitStatus>>;
  initializeGit: (projectPath: string) => Promise<IPCResult<InitializationResult>>;

  // Ollama model detection operations
  checkOllamaStatus: (baseUrl?: string) => Promise<IPCResult<{
    running: boolean;
    url: string;
    version?: string;
    message?: string;
  }>>;
  checkOllamaInstalled: () => Promise<IPCResult<{
    installed: boolean;
    path?: string;
    version?: string;
  }>>;
  installOllama: () => Promise<IPCResult<{ command: string }>>;
  listOllamaModels: (baseUrl?: string) => Promise<IPCResult<{
    models: Array<{
      name: string;
      size_bytes: number;
      size_gb: number;
      modified_at: string;
      is_embedding: boolean;
      embedding_dim?: number | null;
      description?: string;
    }>;
    count: number;
  }>>;
  listOllamaEmbeddingModels: (baseUrl?: string) => Promise<IPCResult<{
    embedding_models: Array<{
      name: string;
      embedding_dim: number | null;
      description: string;
      size_bytes: number;
      size_gb: number;
    }>;
    count: number;
  }>>;
  pullOllamaModel: (modelName: string, baseUrl?: string) => Promise<IPCResult<{
    model: string;
    status: 'completed' | 'failed';
    output: string[];
  }>>;

  // Ollama download progress listener
  onDownloadProgress: (
    callback: (data: {
      modelName: string;
      status: string;
      completed: number;
      total: number;
      percentage: number;
    }) => void
  ) => () => void;

  // GitHub API (nested for organized access)
  github: import('../../preload/api/modules/github-api').GitHubAPI;

  // Claude Code CLI operations
  checkClaudeCodeVersion: () => Promise<IPCResult<import('./cli').ClaudeCodeVersionInfo>>;
  installClaudeCode: () => Promise<IPCResult<{ command: string }>>;
  getClaudeCodeVersions: () => Promise<IPCResult<import('./cli').ClaudeCodeVersionList>>;
  installClaudeCodeVersion: (version: string) => Promise<IPCResult<{ command: string; version: string }>>;
  getClaudeCodeInstallations: () => Promise<IPCResult<import('./cli').ClaudeInstallationList>>;
  setClaudeCodeActivePath: (cliPath: string) => Promise<IPCResult<{ path: string }>>;

  // Debug operations
  getDebugInfo: () => Promise<{
    systemInfo: Record<string, string>;
    recentErrors: string[];
    logsPath: string;
    debugReport: string;
  }>;
  openLogsFolder: () => Promise<{ success: boolean; error?: string }>;
  copyDebugInfo: () => Promise<{ success: boolean; error?: string }>;
  getRecentErrors: (maxCount?: number) => Promise<string[]>;
  listLogFiles: () => Promise<Array<{
    name: string;
    path: string;
    size: number;
    modified: string;
  }>>;

  // MCP Server health check operations
  checkMcpHealth: (server: CustomMcpServer) => Promise<IPCResult<McpHealthCheckResult>>;
  testMcpConnection: (server: CustomMcpServer) => Promise<IPCResult<McpTestConnectionResult>>;

  // Screenshot capture operations
  getSources: () => Promise<IPCResult<ScreenshotSource[]> & { devMode?: boolean }>;
  capture: (options: { sourceId: string }) => Promise<IPCResult<string>>;

  // Queue Routing API (rate limit recovery)
  queue: import('../../preload/api/queue-api').QueueAPI;
}

/** Platform information exposed via contextBridge for platform-specific behavior */
export interface PlatformInfo {
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  isUnix: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    DEBUG: boolean;
    platform?: PlatformInfo;
  }
}
