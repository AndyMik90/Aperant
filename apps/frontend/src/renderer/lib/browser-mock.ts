/**
 * Browser mock for window.electronAPI
 * This allows the app to run in a regular browser for UI development/testing
 *
 * This module aggregates all mock implementations from separate modules
 * for better code organization and maintainability.
 */

import type { ElectronAPI } from '../../shared/types';
import {
  projectMock,
  taskMock,
  workspaceMock,
  terminalMock,
  claudeProfileMock,
  contextMock,
  integrationMock,
  changelogMock,
  insightsMock,
  infrastructureMock,
  settingsMock
} from './mocks';

// Check if we're in a browser (not Electron)
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Create mock electronAPI for browser
 * Aggregates all mock implementations from separate modules
 */
const browserMockAPI: ElectronAPI = {
  // Project Operations
  ...projectMock,

  // Task Operations
  ...taskMock,

  // Workspace Management
  ...workspaceMock,

  // Terminal Operations
  ...terminalMock,

  // Claude Profile Management
  ...claudeProfileMock,

  // Settings
  ...settingsMock,

  // Roadmap Operations
  getRoadmap: async () => ({
    success: true,
    data: null
  }),

  getRoadmapStatus: async () => ({
    success: true,
    data: { isRunning: false }
  }),

  saveRoadmap: async () => ({
    success: true
  }),

  saveCompetitorAnalysis: async () => ({
    success: true
  }),

  generateRoadmap: (_projectId: string, _enableCompetitorAnalysis?: boolean, _refreshCompetitorAnalysis?: boolean) => {
    console.warn('[Browser Mock] generateRoadmap called');
  },

  refreshRoadmap: (_projectId: string, _enableCompetitorAnalysis?: boolean, _refreshCompetitorAnalysis?: boolean) => {
    console.warn('[Browser Mock] refreshRoadmap called');
  },

  updateFeatureStatus: async () => ({ success: true }),

  convertFeatureToSpec: async (projectId: string, _featureId: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      specId: '',
      projectId,
      title: 'Converted Feature',
      description: 'Feature converted from roadmap',
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  stopRoadmap: async () => ({ success: true }),

  // Roadmap Progress Persistence
  saveRoadmapProgress: async () => ({ success: true }),
  loadRoadmapProgress: async () => ({ success: true, data: null }),
  clearRoadmapProgress: async () => ({ success: true }),

  // Roadmap Event Listeners
  onRoadmapProgress: () => () => { /* noop */ },
  onRoadmapComplete: () => () => { /* noop */ },
  onRoadmapError: () => () => { /* noop */ },
  onRoadmapStopped: () => () => { /* noop */ },
  // Context Operations
  ...contextMock,

  // Environment Configuration & Integration Operations
  ...integrationMock,

  // Changelog & Release Operations
  ...changelogMock,

  // Insights Operations
  ...insightsMock,

  // Infrastructure & Docker Operations
  ...infrastructureMock,

  // API Profile Management (custom Anthropic-compatible endpoints)
  getAPIProfiles: async () => ({
    success: true,
    data: {
      profiles: [],
      activeProfileId: null,
      version: 1
    }
  }),

  saveAPIProfile: async (profile) => ({
    success: true,
    data: {
      id: `mock-profile-${Date.now()}`,
      ...profile,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }),

  updateAPIProfile: async (profile) => ({
    success: true,
    data: {
      ...profile,
      updatedAt: Date.now()
    }
  }),

  deleteAPIProfile: async (_profileId: string) => ({
    success: true
  }),

  setActiveAPIProfile: async (_profileId: string | null) => ({
    success: true
  }),

  testConnection: async (_baseUrl: string, _apiKey: string, _signal?: AbortSignal) => ({
    success: true,
    data: {
      success: true,
      message: 'Connection successful (mock)'
    }
  }),

  discoverModels: async (_baseUrl: string, _apiKey: string, _signal?: AbortSignal) => ({
    success: true,
    data: {
      models: []
    }
  }),

  // GitHub API
  github: {
    getGitHubRepositories: async () => ({ success: true, data: [] }),
    getGitHubIssues: async () => ({ success: true, data: { issues: [], hasMore: false } }),
    getGitHubIssue: async () => ({ success: true, data: null as any }),
    getIssueComments: async () => ({ success: true, data: [] }),
    checkGitHubConnection: async () => ({ success: true, data: { connected: false, repoFullName: undefined, error: undefined } }),
    investigateGitHubIssue: () => { /* noop */ },
    importGitHubIssues: async () => ({ success: true, data: { success: true, imported: 0, failed: 0, issues: [] } }),
    createGitHubRelease: async () => ({ success: true, data: { url: '' } }),
    suggestReleaseVersion: async () => ({ success: true, data: { suggestedVersion: '1.0.0', currentVersion: '0.0.0', bumpType: 'minor' as const, commitCount: 0, reason: 'Initial' } }),
    checkGitHubCli: async () => ({ success: true, data: { installed: false } }),
    checkGitHubAuth: async () => ({ success: true, data: { authenticated: false } }),
    startGitHubAuth: async () => ({ success: true, data: { success: false } }),
    getGitHubToken: async () => ({ success: true, data: { token: '' } }),
    getGitHubUser: async () => ({ success: true, data: { username: '' } }),
    listGitHubUserRepos: async () => ({ success: true, data: { repos: [] } }),
    detectGitHubRepo: async () => ({ success: true, data: '' }),
    getGitHubBranches: async () => ({ success: true, data: [] }),
    createGitHubRepo: async () => ({ success: true, data: { fullName: '', url: '' } }),
    addGitRemote: async () => ({ success: true, data: { remoteUrl: '' } }),
    listGitHubOrgs: async () => ({ success: true, data: { orgs: [] } }),
    onGitHubAuthDeviceCode: () => () => { /* noop */ },
    onGitHubAuthChanged: () => () => { /* noop */ },
    // Investigation operations (new system)
    startInvestigation: () => { /* noop */ },
    cancelInvestigation: () => { /* noop */ },
    cancelAllInvestigations: () => { /* noop */ },
    createTaskFromInvestigation: async () => ({ success: true, data: { specId: '' } }),
    dismissIssue: async () => ({ success: true }),
    postInvestigationToGitHub: async () => ({ success: true, data: { commentId: 0 } }),
    getInvestigationSettings: async () => ({ success: true, data: { autoCreateTasks: false, autoStartTasks: false, pipelineMode: 'full' as const, phase1ExecutionMode: 'sequential' as const, autoPostToGitHub: false, autoCloseIssues: false, maxParallelInvestigations: 3, labelIncludeFilter: [], labelExcludeFilter: [] } }),
    saveInvestigationSettings: async () => ({ success: true }),
    loadPersistedInvestigations: async () => ({ success: true, data: [] }),
    getInvestigationLogs: async () => null,
    onInvestigationLogsUpdated: () => () => { /* noop */ },
    onInvestigationProgress: () => () => { /* noop */ },
    onInvestigationComplete: () => () => { /* noop */ },
    onInvestigationError: () => () => { /* noop */ },
    // Legacy investigation listeners
    onGitHubInvestigationProgress: () => () => { /* noop */ },
    onGitHubInvestigationComplete: () => () => { /* noop */ },
    onGitHubInvestigationError: () => () => { /* noop */ },
    listPRs: async () => ({ prs: [], hasNextPage: false }),
    listMorePRs: async () => ({ prs: [], hasNextPage: false }),
    getPR: async () => null,
    runPRReview: () => { /* noop */ },
    cancelPRReview: async () => true,
    postPRReview: async () => true,
    postPRComment: async () => true,
    mergePR: async () => true,
    assignPR: async () => true,
    markReviewPosted: async () => true,
    getPRReview: async () => null,
    getPRReviewsBatch: async () => ({}),
    notifyExternalReviewComplete: async () => {},
    deletePRReview: async () => true,
    checkNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
    checkMergeReadiness: async () => ({ isDraft: false, mergeable: 'UNKNOWN' as const, isBehind: false, ciStatus: 'none' as const, blockers: [] }),
    updatePRBranch: async () => ({ success: true }),
    runFollowupReview: () => { /* noop */ },
    getPRLogs: async () => null,
    getWorkflowsAwaitingApproval: async () => ({ awaiting_approval: 0, workflow_runs: [], can_approve: false }),
    approveWorkflow: async () => true,
    onPRReviewProgress: () => () => {},
    onPRReviewComplete: () => () => {},
    onPRReviewError: () => () => {},
    onPRReviewStateChange: () => () => {},
    onPRLogsUpdated: () => () => {},
    batchAutoFix: () => {},
    getBatches: async () => [],
    onBatchProgress: () => () => {},
    onBatchComplete: () => () => {},
    onBatchError: () => () => {},
    // Analyze & Group Issues (proactive workflow)
    analyzeIssuesPreview: () => { /* noop */ },
    approveBatches: async () => ({ success: true, batches: [] }),
    onAnalyzePreviewProgress: () => () => { /* noop */ },
    onAnalyzePreviewComplete: () => () => { /* noop */ },
    onAnalyzePreviewError: () => () => { /* noop */ },
    // PR status polling
    startStatusPolling: async () => true,
    stopStatusPolling: async () => true,
    getPollingMetadata: async () => null,
    onPRStatusUpdate: () => () => { /* noop */ },

    // Enrichment operations
    getAllEnrichment: async () => ({ schemaVersion: 1, issues: {} }),
    getEnrichment: async () => null,
    saveEnrichment: async () => true,
    transitionWorkflowState: async () => null as any,
    bootstrapEnrichment: async () => ({ schemaVersion: 1, issues: {} }),
    reconcileEnrichment: async () => ({ schemaVersion: 1, issues: {} }),
    gcEnrichment: async () => ({ pruned: 0, orphaned: 0 }),

    // Issue Mutations
    editIssueTitle: async () => ({ success: true, issueNumber: 0 }),
    editIssueBody: async () => ({ success: true, issueNumber: 0 }),
    addIssueLabels: async () => ({ success: true, issueNumber: 0 }),
    removeIssueLabels: async () => ({ success: true, issueNumber: 0 }),
    addIssueAssignees: async () => ({ success: true, issueNumber: 0 }),
    removeIssueAssignees: async () => ({ success: true, issueNumber: 0 }),
    closeIssue: async () => ({ success: true, issueNumber: 0 }),
    reopenIssue: async () => ({ success: true, issueNumber: 0 }),
    addIssueComment: async () => ({ success: true, issueNumber: 0 }),

    // Bulk Operations
    executeBulk: async () => ({ action: 'close' as const, totalItems: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }),
    onBulkProgress: () => () => { /* noop */ },
    onBulkComplete: () => () => { /* noop */ },

    // Repository Data
    getRepoLabels: async () => ({ success: true, data: [] }),
    getRepoCollaborators: async () => ({ success: true, data: [] }),

    // Spec from Issue
    createSpecFromIssue: async () => ({ success: true, issueNumber: 0 }),

    // AI Triage (Phase 3)
    cancelTriage: async () => ({ cancelled: false }),
    runEnrichment: () => { /* noop */ },
    onEnrichmentProgress: () => () => { /* noop */ },
    onEnrichmentError: () => () => { /* noop */ },
    onEnrichmentComplete: () => () => { /* noop */ },

    runSplitSuggestion: () => { /* noop */ },
    onSplitProgress: () => () => { /* noop */ },
    onSplitError: () => () => { /* noop */ },
    onSplitComplete: () => () => { /* noop */ },

    createIssue: async () => ({ number: 0, url: '' }),

    applyTriageResults: () => { /* noop */ },
    onApplyResultsProgress: () => () => { /* noop */ },
    onApplyResultsError: () => () => { /* noop */ },
    onApplyResultsComplete: () => () => { /* noop */ },

    savePendingReview: async () => true,
    loadPendingReview: async () => [],
    // Label Sync (Phase 4)
    enableLabelSync: async () => ({ created: 0, updated: 0, removed: 0, errors: [] }),
    disableLabelSync: async () => ({ success: true }),
    syncIssueLabel: async () => ({ synced: true }),
    getLabelSyncStatus: async () => ({ enabled: false, lastSyncedAt: null }),
    saveLabelSyncConfig: async () => ({ success: true }),
    bulkLabelSync: async () => ({ synced: 0, errors: 0 }),

    // Dependencies (Phase 4)
    fetchDependencies: async () => ({ tracks: [], trackedBy: [] }),

    // Metrics (Phase 4)
    computeMetrics: async () => ({ stateCounts: { new: 0, triage: 0, ready: 0, in_progress: 0, review: 0, done: 0, blocked: 0 }, completenessDistribution: { low: 0, medium: 0, high: 0, excellent: 0 }, totalTransitions: 0, avgBacklogAge: 0, avgTimeInState: { new: 0, triage: 0, ready: 0, in_progress: 0, review: 0, done: 0, blocked: 0 }, weeklyThroughput: [], computedAt: new Date().toISOString() }),
    getStateCounts: async () => ({ new: 0, triage: 0, ready: 0, in_progress: 0, review: 0, done: 0, blocked: 0 }),
  },

  // Queue Routing API (rate limit recovery)
  queue: {
    getRunningTasksByProfile: async () => ({ success: true, data: { byProfile: {}, totalRunning: 0 } }),
    getBestProfileForTask: async () => ({ success: true, data: null }),
    getBestUnifiedAccount: async () => ({ success: true, data: null }),
    assignProfileToTask: async () => ({ success: true }),
    updateTaskSession: async () => ({ success: true }),
    getTaskSession: async () => ({ success: true, data: null }),
    onQueueProfileSwapped: () => () => { /* noop */ },
    onQueueSessionCaptured: () => () => { /* noop */ },
    onQueueBlockedNoProfiles: () => () => { /* noop */ }
  },

  // Claude Code Operations
  checkClaudeCodeVersion: async () => ({
    success: true,
    data: {
      installed: '1.0.0',
      latest: '1.0.0',
      isOutdated: false,
      path: '/usr/local/bin/claude',
      detectionResult: {
        found: true,
        version: '1.0.0',
        path: '/usr/local/bin/claude',
        source: 'system-path' as const,
        message: 'Claude Code CLI found'
      }
    }
  }),
  installClaudeCode: async () => ({
    success: true,
    data: { command: 'npm install -g @anthropic-ai/claude-code' }
  }),
  getClaudeCodeVersions: async () => ({
    success: true,
    data: {
      versions: ['1.0.5', '1.0.4', '1.0.3', '1.0.2', '1.0.1', '1.0.0']
    }
  }),
  installClaudeCodeVersion: async (version: string) => ({
    success: true,
    data: { command: `npm install -g @anthropic-ai/claude-code@${version}`, version }
  }),
  getClaudeCodeInstallations: async () => ({
    success: true,
    data: {
      installations: [
        {
          path: '/usr/local/bin/claude',
          version: '1.0.0',
          source: 'system-path' as const,
          isActive: true,
        }
      ],
      activePath: '/usr/local/bin/claude',
    }
  }),
  setClaudeCodeActivePath: async (cliPath: string) => ({
    success: true,
    data: { path: cliPath }
  }),

  // Worktree Change Detection
  checkWorktreeChanges: async () => ({
    success: true,
    data: { hasChanges: false, changedFileCount: 0 }
  }),

  // Terminal Worktree Operations
  createTerminalWorktree: async () => ({
    success: false,
    error: 'Not available in browser mode'
  }),
  listTerminalWorktrees: async () => ({
    success: true,
    data: []
  }),
  removeTerminalWorktree: async () => ({
    success: false,
    error: 'Not available in browser mode'
  }),
  listOtherWorktrees: async () => ({
    success: true,
    data: []
  }),

  // MCP Server Health Check Operations
  checkMcpHealth: async (server) => ({
    success: true,
    data: {
      serverId: server.id,
      status: 'unknown' as const,
      message: 'Health check not available in browser mode',
      checkedAt: new Date().toISOString()
    }
  }),
  testMcpConnection: async (server) => ({
    success: true,
    data: {
      serverId: server.id,
      success: false,
      message: 'Connection test not available in browser mode'
    }
  }),

  // Screenshot capture operations
  getSources: async () => ({
    success: true,
    data: []
  }),
  capture: async (_options: { sourceId: string }) => ({
    success: false,
    error: 'Screenshot capture not available in browser mode'
  }),

  // Debug Operations
  getDebugInfo: async () => ({
    systemInfo: {
      appVersion: '0.0.0-browser-mock',
      platform: 'browser',
      isPackaged: 'false'
    },
    recentErrors: [],
    logsPath: '/mock/logs',
    debugReport: '[Browser Mock] Debug report not available in browser mode'
  }),
  openLogsFolder: async () => ({ success: false, error: 'Not available in browser mode' }),
  copyDebugInfo: async () => ({ success: false, error: 'Not available in browser mode' }),
  getRecentErrors: async () => [],
  listLogFiles: async () => [],

  // Top-level investigation operations (legacy ElectronAPI surface)
  startInvestigation: () => { /* noop */ },
  cancelInvestigation: () => { /* noop */ },
  cancelAllInvestigations: () => { /* noop */ },
  createTaskFromInvestigation: async () => ({ success: true, data: { specId: '' } }),
  dismissIssue: async () => ({ success: true }),
  postInvestigationToGitHub: async () => ({ success: true, data: { commentId: 0 } }),
  getInvestigationSettings: async () => ({ success: true, data: { autoCreateTasks: false, autoStartTasks: false, pipelineMode: 'full' as const, phase1ExecutionMode: 'sequential' as const, autoPostToGitHub: false, autoCloseIssues: false, maxParallelInvestigations: 3, labelIncludeFilter: [], labelExcludeFilter: [] } }),
  saveInvestigationSettings: async () => ({ success: true }),
};

/**
 * Initialize browser mock if not running in Electron
 */
export function initBrowserMock(): void {
  if (!isElectron) {
    console.warn('%c[Browser Mock] Initializing mock electronAPI for browser preview', 'color: #f0ad4e; font-weight: bold;');
    (window as Window & { electronAPI: ElectronAPI }).electronAPI = browserMockAPI;
  }
}

// Auto-initialize
initBrowserMock();
