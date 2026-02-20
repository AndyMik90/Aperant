import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  GitHubRepository,
  GitHubIssue,
  GitHubSyncStatus,
  GitHubImportResult,
  GitHubInvestigationStatus,
  GitHubInvestigationResult,
  IPCResult,
  VersionSuggestion,
  PaginatedIssuesResult,
  PRStatusUpdate,
  PollingMetadata,
  InvestigationProgress,
  InvestigationResult,
  InvestigationDismissReason,
  InvestigationSettings,
  PersistedInvestigationState,
  InvestigationLogs,
} from '../../../shared/types';
import type { EnrichmentFile, IssueEnrichment, WorkflowState, Resolution } from '../../../shared/types/enrichment';
import type { LabelSyncConfig, LabelSyncResult } from '../../../shared/types/label-sync';
import type { IssueDependencies } from '../../../shared/types/dependencies';
import type { TriageMetrics, MetricsTimeWindow } from '../../../shared/types/metrics';
import type { MutationResult, BulkExecuteParams, BulkOperationProgress, BulkOperationResult } from '../../../shared/types/mutations';
import type {
  CreateIssueParams,
  CreateIssueResult,
  TriageReviewItem,
  AIEnrichmentResult,
  SplitSuggestion,
  EnrichmentProgress,
  SplitProgress,
  ApplyResultsProgress,
} from '../../../shared/types/ai-triage';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Analyze preview progress (proactive workflow)
 */
export interface AnalyzePreviewProgress {
  phase: 'analyzing' | 'complete';
  progress: number;
  message: string;
}

/**
 * Proposed batch from analyze-preview
 */
export interface ProposedBatch {
  primaryIssue: number;
  issues: Array<{
    issueNumber: number;
    title: string;
    labels: string[];
    similarityToPrimary: number;
  }>;
  issueCount: number;
  commonThemes: string[];
  validated: boolean;
  confidence: number;
  reasoning: string;
  theme: string;
}

/**
 * Analyze preview result (proactive batch workflow)
 */
export interface AnalyzePreviewResult {
  success: boolean;
  totalIssues: number;
  analyzedIssues: number;
  alreadyBatched: number;
  proposedBatches: ProposedBatch[];
  singleIssues: Array<{
    issueNumber: number;
    title: string;
    labels: string[];
  }>;
  message: string;
  error?: string;
}

/**
 * Issue batch for grouped fixing
 */
export interface IssueBatch {
  batchId: string;
  repo: string;
  primaryIssue: number;
  issues: Array<{
    issueNumber: number;
    title: string;
    similarityToPrimary: number;
  }>;
  commonThemes: string[];
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  prNumber?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Workflow run awaiting approval (for fork PRs)
 */
export interface WorkflowAwaitingApproval {
  id: number;
  name: string;
  html_url: string;
  workflow_name: string;
}

/**
 * Workflows awaiting approval result
 */
export interface WorkflowsAwaitingApprovalResult {
  awaiting_approval: number;
  workflow_runs: WorkflowAwaitingApproval[];
  can_approve: boolean;
  error?: string;
}

// Re-export PaginatedIssuesResult from shared types for API consumers
export type { PaginatedIssuesResult };

/**
 * GitHub Integration API operations
 */
export interface GitHubAPI {
  // Operations
  getGitHubRepositories: (projectId: string) => Promise<IPCResult<GitHubRepository[]>>;
  getGitHubIssues: (
    projectId: string,
    state?: 'open' | 'closed' | 'all',
    page?: number,
    fetchAll?: boolean
  ) => Promise<IPCResult<PaginatedIssuesResult>>;
  getGitHubIssue: (projectId: string, issueNumber: number) => Promise<IPCResult<GitHubIssue>>;
  getIssueComments: (projectId: string, issueNumber: number) => Promise<IPCResult<any[]>>;
  checkGitHubConnection: (projectId: string) => Promise<IPCResult<GitHubSyncStatus>>;
  investigateGitHubIssue: (projectId: string, issueNumber: number, selectedCommentIds?: number[]) => void;
  importGitHubIssues: (projectId: string, issueNumbers: number[]) => Promise<IPCResult<GitHubImportResult>>;
  createGitHubRelease: (
    projectId: string,
    version: string,
    releaseNotes: string,
    options?: { draft?: boolean; prerelease?: boolean }
  ) => Promise<IPCResult<{ url: string }>>;

  /** AI-powered version suggestion based on commits since last release */
  suggestReleaseVersion: (projectId: string) => Promise<IPCResult<VersionSuggestion>>;

  // OAuth operations (gh CLI)
  checkGitHubCli: () => Promise<IPCResult<{ installed: boolean; version?: string }>>;
  checkGitHubAuth: () => Promise<IPCResult<{ authenticated: boolean; username?: string }>>;
  startGitHubAuth: () => Promise<IPCResult<{ success: boolean; message?: string }>>;
  getGitHubToken: () => Promise<IPCResult<{ token: string }>>;
  getGitHubUser: () => Promise<IPCResult<{ username: string; name?: string }>>;
  listGitHubUserRepos: () => Promise<IPCResult<{ repos: Array<{ fullName: string; description: string | null; isPrivate: boolean }> }>>;

  // OAuth event listener - receives device code immediately when extracted
  onGitHubAuthDeviceCode: (
    callback: (data: { deviceCode: string; authUrl: string; browserOpened: boolean }) => void
  ) => IpcListenerCleanup;

  // OAuth event listener - notifies when GitHub account changes (via gh auth login)
  onGitHubAuthChanged: (
    callback: (data: { oldUsername: string | null; newUsername: string }) => void
  ) => IpcListenerCleanup;

  // Repository detection and management
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

  // Investigation operations (new system)
  startInvestigation: (projectId: string, issueNumber: number) => void;
  cancelInvestigation: (projectId: string, issueNumber: number) => void;
  cancelAllInvestigations: (projectId: string) => void;
  createTaskFromInvestigation: (projectId: string, issueNumber: number) => Promise<IPCResult<{ specId: string }>>;
  dismissIssue: (projectId: string, issueNumber: number, reason: InvestigationDismissReason) => Promise<IPCResult>;
  postInvestigationToGitHub: (projectId: string, issueNumber: number) => Promise<IPCResult<{ commentId: number }>>;
  getInvestigationSettings: (projectId: string) => Promise<IPCResult<InvestigationSettings>>;
  saveInvestigationSettings: (projectId: string, settings: Partial<InvestigationSettings>) => Promise<IPCResult>;
  loadPersistedInvestigations: (projectId: string) => Promise<IPCResult<PersistedInvestigationState[]>>;

  // Investigation logs (live agent output)
  getInvestigationLogs: (projectId: string, issueNumber: number) => Promise<InvestigationLogs | null>;
  onInvestigationLogsUpdated: (
    callback: (projectId: string, data: { issueNumber: number; entryCount: number }) => void
  ) => IpcListenerCleanup;

  // Investigation event listeners (new system)
  onInvestigationProgress: (
    callback: (projectId: string, progress: InvestigationProgress) => void
  ) => IpcListenerCleanup;
  onInvestigationComplete: (
    callback: (projectId: string, result: InvestigationResult) => void
  ) => IpcListenerCleanup;
  onInvestigationError: (
    callback: (projectId: string, error: string | { error: string; issueNumber?: number }) => void
  ) => IpcListenerCleanup;

  // Legacy Event Listeners (deprecated — use investigation methods above)
  onGitHubInvestigationProgress: (
    callback: (projectId: string, status: GitHubInvestigationStatus) => void
  ) => IpcListenerCleanup;
  onGitHubInvestigationComplete: (
    callback: (projectId: string, result: GitHubInvestigationResult) => void
  ) => IpcListenerCleanup;
  onGitHubInvestigationError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;

  // Analyze & Group Issues (proactive batch workflow)
  analyzeIssuesPreview: (projectId: string, issueNumbers?: number[], maxIssues?: number) => void;
  approveBatches: (projectId: string, approvedBatches: ProposedBatch[]) => Promise<{ success: boolean; batches?: IssueBatch[]; error?: string }>;

  // Analyze preview event listeners
  onAnalyzePreviewProgress: (
    callback: (projectId: string, progress: AnalyzePreviewProgress) => void
  ) => IpcListenerCleanup;
  onAnalyzePreviewComplete: (
    callback: (projectId: string, result: AnalyzePreviewResult) => void
  ) => IpcListenerCleanup;
  onAnalyzePreviewError: (
    callback: (projectId: string, error: { error: string }) => void
  ) => IpcListenerCleanup;

  // PR operations (fetches up to 100 open PRs at once - GitHub GraphQL limit)
  listPRs: (projectId: string) => Promise<PRListResult>;
  /** Load more PRs using cursor-based pagination */
  listMorePRs: (projectId: string, cursor: string) => Promise<PRListResult>;
  getPR: (projectId: string, prNumber: number) => Promise<PRData | null>;
  runPRReview: (projectId: string, prNumber: number) => void;
  cancelPRReview: (projectId: string, prNumber: number) => Promise<boolean>;
  postPRReview: (projectId: string, prNumber: number, selectedFindingIds?: string[], options?: { forceApprove?: boolean }) => Promise<boolean>;
  deletePRReview: (projectId: string, prNumber: number) => Promise<boolean>;
  postPRComment: (projectId: string, prNumber: number, body: string) => Promise<boolean>;
  mergePR: (projectId: string, prNumber: number, mergeMethod?: 'merge' | 'squash' | 'rebase') => Promise<boolean>;
  assignPR: (projectId: string, prNumber: number, username: string) => Promise<boolean>;
  markReviewPosted: (projectId: string, prNumber: number) => Promise<boolean>;
  getPRReview: (projectId: string, prNumber: number) => Promise<PRReviewResult | null>;
  getPRReviewsBatch: (projectId: string, prNumbers: number[]) => Promise<Record<number, PRReviewResult | null>>;

  // External review notification (renderer tells main process about external review completion/timeout)
  notifyExternalReviewComplete: (projectId: string, prNumber: number, result: PRReviewResult | null) => Promise<void>;

  // Follow-up review operations
  checkNewCommits: (projectId: string, prNumber: number) => Promise<NewCommitsCheck>;
  checkMergeReadiness: (projectId: string, prNumber: number) => Promise<MergeReadiness>;
  updatePRBranch: (projectId: string, prNumber: number) => Promise<{ success: boolean; error?: string }>;
  runFollowupReview: (projectId: string, prNumber: number) => void;

  // PR logs
  getPRLogs: (projectId: string, prNumber: number) => Promise<PRLogs | null>;

  // Workflow approval (for fork PRs)
  getWorkflowsAwaitingApproval: (projectId: string, prNumber: number) => Promise<WorkflowsAwaitingApprovalResult>;
  approveWorkflow: (projectId: string, runId: number) => Promise<boolean>;

  // PR event listeners
  onPRReviewProgress: (
    callback: (projectId: string, progress: PRReviewProgress) => void
  ) => IpcListenerCleanup;
  onPRReviewComplete: (
    callback: (projectId: string, result: PRReviewResult) => void
  ) => IpcListenerCleanup;
  onPRReviewError: (
    callback: (projectId: string, error: { prNumber: number; error: string }) => void
  ) => IpcListenerCleanup;
  onPRReviewStateChange: (
    callback: (key: string, state: PRReviewStatePayload) => void
  ) => IpcListenerCleanup;
  onPRLogsUpdated: (
    callback: (projectId: string, data: { prNumber: number; entryCount: number }) => void
  ) => IpcListenerCleanup;

  // PR status polling operations
  /** Start background polling for PR status (CI checks, reviews, mergeability) */
  startStatusPolling: (projectId: string, prNumbers: number[]) => Promise<boolean>;
  /** Stop background polling for a project */
  stopStatusPolling: (projectId: string) => Promise<boolean>;
  /** Get current polling metadata (rate limits, errors, etc.) */
  getPollingMetadata: (projectId: string) => Promise<PollingMetadata | null>;

  // PR status polling event listener
  /** Subscribe to PR status updates from background polling */
  onPRStatusUpdate: (
    callback: (update: PRStatusUpdate) => void
  ) => IpcListenerCleanup;

  // Enrichment operations
  getAllEnrichment: (projectId: string) => Promise<EnrichmentFile>;
  getEnrichment: (projectId: string, issueNumber: number) => Promise<IssueEnrichment | null>;
  saveEnrichment: (projectId: string, enrichment: IssueEnrichment) => Promise<boolean>;
  transitionWorkflowState: (projectId: string, issueNumber: number, to: WorkflowState, resolution?: Resolution) => Promise<IssueEnrichment>;
  bootstrapEnrichment: (projectId: string, issues: GitHubIssue[]) => Promise<EnrichmentFile>;
  reconcileEnrichment: (projectId: string, issues: GitHubIssue[]) => Promise<EnrichmentFile>;
  gcEnrichment: (projectId: string, issueNumbers: number[]) => Promise<{ pruned: number; orphaned: number }>;

  // Issue Mutations
  editIssueTitle: (projectId: string, issueNumber: number, title: string) => Promise<MutationResult>;
  editIssueBody: (projectId: string, issueNumber: number, body: string | null) => Promise<MutationResult>;
  addIssueLabels: (projectId: string, issueNumber: number, labels: string[]) => Promise<MutationResult>;
  removeIssueLabels: (projectId: string, issueNumber: number, labels: string[]) => Promise<MutationResult>;
  addIssueAssignees: (projectId: string, issueNumber: number, assignees: string[]) => Promise<MutationResult>;
  removeIssueAssignees: (projectId: string, issueNumber: number, assignees: string[]) => Promise<MutationResult>;
  closeIssue: (projectId: string, issueNumber: number) => Promise<MutationResult>;
  reopenIssue: (projectId: string, issueNumber: number) => Promise<MutationResult>;
  addIssueComment: (projectId: string, issueNumber: number, body: string) => Promise<MutationResult>;

  // Bulk Operations
  executeBulk: (params: BulkExecuteParams) => Promise<BulkOperationResult>;
  onBulkProgress: (callback: (progress: BulkOperationProgress) => void) => IpcListenerCleanup;
  onBulkComplete: (callback: (result: BulkOperationResult) => void) => IpcListenerCleanup;

  // Repository Data
  getRepoLabels: (projectId: string) => Promise<{ success: boolean; data?: Array<{ name: string; color: string; description: string }>; error?: string }>;
  getRepoCollaborators: (projectId: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;

  // Spec from Issue
  createSpecFromIssue: (projectId: string, issueNumber: number) => Promise<MutationResult>;

  // AI Triage (Phase 3)
  cancelTriage: () => Promise<{ cancelled: boolean }>;
  runEnrichment: (projectId: string, issueNumber: number) => void;
  onEnrichmentProgress: (callback: (projectId: string, progress: EnrichmentProgress) => void) => IpcListenerCleanup;
  onEnrichmentError: (callback: (projectId: string, error: { error: string }) => void) => IpcListenerCleanup;
  onEnrichmentComplete: (callback: (projectId: string, result: AIEnrichmentResult) => void) => IpcListenerCleanup;

  runSplitSuggestion: (projectId: string, issueNumber: number) => void;
  onSplitProgress: (callback: (projectId: string, progress: SplitProgress) => void) => IpcListenerCleanup;
  onSplitError: (callback: (projectId: string, error: { error: string }) => void) => IpcListenerCleanup;
  onSplitComplete: (callback: (projectId: string, result: SplitSuggestion) => void) => IpcListenerCleanup;

  createIssue: (projectId: string, params: CreateIssueParams) => Promise<CreateIssueResult>;

  applyTriageResults: (projectId: string, items: TriageReviewItem[]) => void;
  onApplyResultsProgress: (callback: (projectId: string, progress: ApplyResultsProgress) => void) => IpcListenerCleanup;
  onApplyResultsError: (callback: (projectId: string, error: { error: string }) => void) => IpcListenerCleanup;
  onApplyResultsComplete: (callback: (projectId: string, results: { succeeded: number; failed: number; skipped: number }) => void) => IpcListenerCleanup;

  savePendingReview: (projectId: string, items: TriageReviewItem[]) => Promise<boolean>;
  loadPendingReview: (projectId: string) => Promise<TriageReviewItem[]>;
  // Label Sync (Phase 4)
  enableLabelSync: (projectId: string) => Promise<LabelSyncResult>;
  disableLabelSync: (projectId: string, cleanup: boolean) => Promise<{ success: boolean }>;
  syncIssueLabel: (projectId: string, issueNumber: number, newState: string, oldState: string | null) => Promise<{ synced?: boolean; skipped?: boolean; error?: string }>;
  getLabelSyncStatus: (projectId: string) => Promise<LabelSyncConfig>;
  saveLabelSyncConfig: (projectId: string, config: LabelSyncConfig) => Promise<{ success: boolean }>;
  bulkLabelSync: (projectId: string, issueNumbers: number[]) => Promise<{ synced: number; errors: number }>;

  // Dependencies (Phase 4)
  fetchDependencies: (projectId: string, issueNumber: number) => Promise<IssueDependencies & { error?: string; unavailable?: boolean }>;

  // Metrics (Phase 4)
  computeMetrics: (projectId: string, timeWindow: MetricsTimeWindow) => Promise<TriageMetrics>;
  getStateCounts: (projectId: string) => Promise<Record<WorkflowState, number>>;
}

/**
 * PR data from GitHub API
 */
export interface PRData {
  number: number;
  title: string;
  body: string;
  state: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  assignees: Array<{ login: string }>;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    status: string;
  }>;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

/**
 * PR list result with pagination info
 */
export interface PRListResult {
  prs: PRData[];
  hasNextPage: boolean; // True if more PRs exist beyond the 100 limit
  endCursor?: string | null; // Cursor for fetching next page (null if no more pages)
}

/**
 * PR review finding
 */
export interface PRReviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'quality' | 'style' | 'test' | 'docs' | 'pattern' | 'performance' | 'verification_failed' | 'redundancy';
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  suggestedFix?: string;
  fixable: boolean;
  validationStatus?: 'confirmed_valid' | 'dismissed_false_positive' | 'needs_human_review' | null;
  validationExplanation?: string;
  sourceAgents?: string[];
  crossValidated?: boolean;
}

/**
 * PR review result
 */
export interface PRReviewResult {
  prNumber: number;
  repo: string;
  success: boolean;
  findings: PRReviewFinding[];
  summary: string;
  overallStatus: 'approve' | 'request_changes' | 'comment' | 'in_progress';
  reviewId?: number;
  reviewedAt: string;
  error?: string;
  // Follow-up review fields
  reviewedCommitSha?: string;
  reviewedFileBlobs?: Record<string, string>; // filename → blob SHA for rebase-resistant follow-ups
  isFollowupReview?: boolean;
  previousReviewId?: number;
  resolvedFindings?: string[];
  unresolvedFindings?: string[];
  newFindingsSinceLastReview?: string[];
  // Track if findings have been posted to GitHub (enables follow-up review)
  hasPostedFindings?: boolean;
  postedFindingIds?: string[];
  postedAt?: string;
  // In-progress review tracking
  inProgressSince?: string;
}

/**
 * Result of checking for new commits since last review
 */
export interface NewCommitsCheck {
  hasNewCommits: boolean;
  newCommitCount: number;
  lastReviewedCommit?: string;
  currentHeadCommit?: string;
  /** Whether new commits happened AFTER findings were posted (for "Ready for Follow-up" status) */
  hasCommitsAfterPosting?: boolean;
  /** Whether new commits touch files that had findings (requires verification) */
  hasOverlapWithFindings?: boolean;
  /** Files from new commits that overlap with finding files */
  overlappingFiles?: string[];
  /** Whether this appears to be a merge from base branch (develop/main) */
  isMergeFromBase?: boolean;
}

/**
 * Lightweight merge readiness check result
 * Used for real-time validation of AI verdict freshness
 */
export interface MergeReadiness {
  /** PR is in draft mode */
  isDraft: boolean;
  /** GitHub's mergeable status */
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** Branch is behind base branch (out of date) */
  isBehind: boolean;
  /** Simplified CI status */
  ciStatus: 'passing' | 'failing' | 'pending' | 'none';
  /** List of blockers that contradict a "ready to merge" verdict */
  blockers: string[];
}

/**
 * Review progress status
 */
export interface PRReviewProgress {
  phase: 'fetching' | 'analyzing' | 'generating' | 'posting' | 'complete';
  prNumber: number;
  progress: number;
  message: string;
}

/**
 * PR review state payload (emitted on state machine transitions)
 */
export interface PRReviewStatePayload {
  state: string;
  prNumber: number;
  projectId: string;
  isReviewing: boolean;
  startedAt: string | null;
  progress: PRReviewProgress | null;
  result: PRReviewResult | null;
  previousResult: PRReviewResult | null;
  error: string | null;
  isExternalReview: boolean;
  isFollowup: boolean;
}

/**
 * PR review log entry type
 */
export type PRLogEntryType = 'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error' | 'success' | 'info';

/**
 * PR review log phase
 */
export type PRLogPhase = 'context' | 'analysis' | 'synthesis';

/**
 * Single log entry in PR review
 */
export interface PRLogEntry {
  timestamp: string;
  type: PRLogEntryType;
  content: string;
  phase: PRLogPhase;
  source?: string;  // e.g., 'Context', 'AI', 'Orchestrator', 'ParallelFollowup'
  detail?: string;  // Expandable detail content
  collapsed?: boolean;
}

/**
 * Phase log containing entries
 */
export interface PRPhaseLog {
  phase: PRLogPhase;
  status: 'pending' | 'active' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  entries: PRLogEntry[];
}

/**
 * Complete PR review logs
 */
export interface PRLogs {
  pr_number: number;
  repo: string;
  created_at: string;
  updated_at: string;
  is_followup: boolean;
  phases: {
    context: PRPhaseLog;
    analysis: PRPhaseLog;
    synthesis: PRPhaseLog;
  };
}

/**
 * Creates the GitHub Integration API implementation
 */
export const createGitHubAPI = (): GitHubAPI => ({
  // Operations
  getGitHubRepositories: (projectId: string): Promise<IPCResult<GitHubRepository[]>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_REPOSITORIES, projectId),

  getGitHubIssues: (
    projectId: string,
    state?: 'open' | 'closed' | 'all',
    page?: number,
    fetchAll?: boolean
  ): Promise<IPCResult<PaginatedIssuesResult>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_ISSUES, projectId, state, page, fetchAll),

  getGitHubIssue: (projectId: string, issueNumber: number): Promise<IPCResult<GitHubIssue>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_ISSUE, projectId, issueNumber),

  getIssueComments: (projectId: string, issueNumber: number): Promise<IPCResult<any[]>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_ISSUE_COMMENTS, projectId, issueNumber),

  checkGitHubConnection: (projectId: string): Promise<IPCResult<GitHubSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_CHECK_CONNECTION, projectId),

  investigateGitHubIssue: (projectId: string, issueNumber: number, selectedCommentIds?: number[]): void =>
    sendIpc(IPC_CHANNELS.GITHUB_INVESTIGATE_ISSUE, projectId, issueNumber, selectedCommentIds),

  importGitHubIssues: (projectId: string, issueNumbers: number[]): Promise<IPCResult<GitHubImportResult>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_IMPORT_ISSUES, projectId, issueNumbers),

  createGitHubRelease: (
    projectId: string,
    version: string,
    releaseNotes: string,
    options?: { draft?: boolean; prerelease?: boolean }
  ): Promise<IPCResult<{ url: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_CREATE_RELEASE, projectId, version, releaseNotes, options),

  suggestReleaseVersion: (projectId: string): Promise<IPCResult<VersionSuggestion>> =>
    invokeIpc(IPC_CHANNELS.RELEASE_SUGGEST_VERSION, projectId),

  // OAuth operations (gh CLI)
  checkGitHubCli: (): Promise<IPCResult<{ installed: boolean; version?: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_CHECK_CLI),

  checkGitHubAuth: (): Promise<IPCResult<{ authenticated: boolean; username?: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_CHECK_AUTH),

  startGitHubAuth: (): Promise<IPCResult<{ success: boolean; message?: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_START_AUTH),

  getGitHubToken: (): Promise<IPCResult<{ token: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_TOKEN),

  getGitHubUser: (): Promise<IPCResult<{ username: string; name?: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_USER),

  listGitHubUserRepos: (): Promise<IPCResult<{ repos: Array<{ fullName: string; description: string | null; isPrivate: boolean }> }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LIST_USER_REPOS),

  // OAuth event listener - receives device code immediately when extracted (during auth process)
  onGitHubAuthDeviceCode: (
    callback: (data: { deviceCode: string; authUrl: string; browserOpened: boolean }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_AUTH_DEVICE_CODE, callback),

  // OAuth event listener - notifies when GitHub account changes (via gh auth login)
  onGitHubAuthChanged: (
    callback: (data: { oldUsername: string | null; newUsername: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_AUTH_CHANGED, callback),

  // Repository detection and management
  detectGitHubRepo: (projectPath: string): Promise<IPCResult<string>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_DETECT_REPO, projectPath),

  getGitHubBranches: (repo: string, token: string): Promise<IPCResult<string[]>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_GET_BRANCHES, repo, token),

  createGitHubRepo: (
    repoName: string,
    options: { description?: string; isPrivate?: boolean; projectPath: string; owner?: string }
  ): Promise<IPCResult<{ fullName: string; url: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_CREATE_REPO, repoName, options),

  addGitRemote: (
    projectPath: string,
    repoFullName: string
  ): Promise<IPCResult<{ remoteUrl: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ADD_REMOTE, projectPath, repoFullName),

  listGitHubOrgs: (): Promise<IPCResult<{ orgs: Array<{ login: string; avatarUrl?: string }> }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LIST_ORGS),

  // Investigation operations (new system)
  startInvestigation: (projectId: string, issueNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_START, projectId, issueNumber),

  cancelInvestigation: (projectId: string, issueNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_CANCEL, projectId, issueNumber),

  cancelAllInvestigations: (projectId: string): void =>
    sendIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_CANCEL_ALL, projectId),

  createTaskFromInvestigation: (projectId: string, issueNumber: number): Promise<IPCResult<{ specId: string }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_CREATE_TASK, projectId, issueNumber),

  dismissIssue: (projectId: string, issueNumber: number, reason: InvestigationDismissReason): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_DISMISS, projectId, issueNumber, reason),

  postInvestigationToGitHub: (projectId: string, issueNumber: number): Promise<IPCResult<{ commentId: number }>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_POST_GITHUB, projectId, issueNumber),

  getInvestigationSettings: (projectId: string): Promise<IPCResult<InvestigationSettings>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_GET_SETTINGS, projectId),

  saveInvestigationSettings: (projectId: string, settings: Partial<InvestigationSettings>): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_SAVE_SETTINGS, projectId, settings),

  loadPersistedInvestigations: (projectId: string): Promise<IPCResult<PersistedInvestigationState[]>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_LOAD_PERSISTED, projectId),

  // Investigation logs (live agent output)
  getInvestigationLogs: (projectId: string, issueNumber: number): Promise<InvestigationLogs | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_INVESTIGATION_GET_LOGS, projectId, issueNumber),

  onInvestigationLogsUpdated: (
    callback: (projectId: string, data: { issueNumber: number; entryCount: number }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_LOGS_UPDATED, callback),

  // Investigation event listeners (new system)
  onInvestigationProgress: (
    callback: (projectId: string, progress: InvestigationProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS, callback),

  onInvestigationComplete: (
    callback: (projectId: string, result: InvestigationResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE, callback),

  onInvestigationError: (
    callback: (projectId: string, error: string | { error: string; issueNumber?: number }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR, callback),

  // Legacy Event Listeners (deprecated — use investigation methods above)
  onGitHubInvestigationProgress: (
    callback: (projectId: string, status: GitHubInvestigationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS, callback),

  onGitHubInvestigationComplete: (
    callback: (projectId: string, result: GitHubInvestigationResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE, callback),

  onGitHubInvestigationError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR, callback),

  // Analyze & Group Issues (proactive batch workflow)
  analyzeIssuesPreview: (projectId: string, issueNumbers?: number[], maxIssues?: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW, projectId, issueNumbers, maxIssues),

  approveBatches: (projectId: string, approvedBatches: ProposedBatch[]): Promise<{ success: boolean; batches?: IssueBatch[]; error?: string }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_AUTOFIX_APPROVE_BATCHES, projectId, approvedBatches),

  // Analyze preview event listeners
  onAnalyzePreviewProgress: (
    callback: (projectId: string, progress: AnalyzePreviewProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS, callback),

  onAnalyzePreviewComplete: (
    callback: (projectId: string, result: AnalyzePreviewResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE, callback),

  onAnalyzePreviewError: (
    callback: (projectId: string, error: { error: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW_ERROR, callback),

  // PR operations
  // Fetches up to 100 open PRs at once (GitHub GraphQL limit)
  listPRs: (projectId: string): Promise<PRListResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_LIST, projectId),

  // Load more PRs using cursor-based pagination
  listMorePRs: (projectId: string, cursor: string): Promise<PRListResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_LIST_MORE, projectId, cursor),

  getPR: (projectId: string, prNumber: number): Promise<PRData | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_GET, projectId, prNumber),

  runPRReview: (projectId: string, prNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_PR_REVIEW, projectId, prNumber),

  cancelPRReview: (projectId: string, prNumber: number): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_REVIEW_CANCEL, projectId, prNumber),

  postPRReview: (projectId: string, prNumber: number, selectedFindingIds?: string[], options?: { forceApprove?: boolean }): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_POST_REVIEW, projectId, prNumber, selectedFindingIds, options),

  deletePRReview: (projectId: string, prNumber: number): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_DELETE_REVIEW, projectId, prNumber),

  postPRComment: (projectId: string, prNumber: number, body: string): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_POST_COMMENT, projectId, prNumber, body),

  mergePR: (projectId: string, prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_MERGE, projectId, prNumber, mergeMethod),

  assignPR: (projectId: string, prNumber: number, username: string): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_ASSIGN, projectId, prNumber, username),

  markReviewPosted: (projectId: string, prNumber: number): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_MARK_REVIEW_POSTED, projectId, prNumber),

  getPRReview: (projectId: string, prNumber: number): Promise<PRReviewResult | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_GET_REVIEW, projectId, prNumber),

  getPRReviewsBatch: (projectId: string, prNumbers: number[]): Promise<Record<number, PRReviewResult | null>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_GET_REVIEWS_BATCH, projectId, prNumbers),

  // External review notification
  notifyExternalReviewComplete: (projectId: string, prNumber: number, result: PRReviewResult | null): Promise<void> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_NOTIFY_EXTERNAL_REVIEW_COMPLETE, projectId, prNumber, result),

  // Follow-up review operations
  checkNewCommits: (projectId: string, prNumber: number): Promise<NewCommitsCheck> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_CHECK_NEW_COMMITS, projectId, prNumber),

  checkMergeReadiness: (projectId: string, prNumber: number): Promise<MergeReadiness> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_CHECK_MERGE_READINESS, projectId, prNumber),

  updatePRBranch: (projectId: string, prNumber: number): Promise<{ success: boolean; error?: string }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_UPDATE_BRANCH, projectId, prNumber),

  runFollowupReview: (projectId: string, prNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_PR_FOLLOWUP_REVIEW, projectId, prNumber),

  // PR logs
  getPRLogs: (projectId: string, prNumber: number): Promise<PRLogs | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_GET_LOGS, projectId, prNumber),

  // Workflow approval (for fork PRs)
  getWorkflowsAwaitingApproval: (projectId: string, prNumber: number): Promise<WorkflowsAwaitingApprovalResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_WORKFLOWS_AWAITING_APPROVAL, projectId, prNumber),

  approveWorkflow: (projectId: string, runId: number): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_WORKFLOW_APPROVE, projectId, runId),

  // PR event listeners
  onPRReviewProgress: (
    callback: (projectId: string, progress: PRReviewProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_REVIEW_PROGRESS, callback),

  onPRReviewComplete: (
    callback: (projectId: string, result: PRReviewResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_REVIEW_COMPLETE, callback),

  onPRReviewError: (
    callback: (projectId: string, error: { prNumber: number; error: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_REVIEW_ERROR, callback),

  onPRReviewStateChange: (
    callback: (key: string, state: PRReviewStatePayload) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_REVIEW_STATE_CHANGE, callback),

  onPRLogsUpdated: (
    callback: (projectId: string, data: { prNumber: number; entryCount: number }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_LOGS_UPDATED, callback),

  // PR status polling operations
  startStatusPolling: (projectId: string, prNumbers: number[]): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_STATUS_POLL_START, { projectId, prNumbers }),

  stopStatusPolling: (projectId: string): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_STATUS_POLL_STOP, { projectId }),

  getPollingMetadata: (projectId: string): Promise<PollingMetadata | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_PR_STATUS_UPDATE, projectId),

  // PR status polling event listener
  onPRStatusUpdate: (
    callback: (update: PRStatusUpdate) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_PR_STATUS_UPDATE, callback),

  // Enrichment operations
  getAllEnrichment: (projectId: string): Promise<EnrichmentFile> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_GET_ALL, projectId),

  getEnrichment: (projectId: string, issueNumber: number): Promise<IssueEnrichment | null> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_GET, projectId, issueNumber),

  saveEnrichment: (projectId: string, enrichment: IssueEnrichment): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_SAVE, projectId, enrichment),

  transitionWorkflowState: (projectId: string, issueNumber: number, to: WorkflowState, resolution?: Resolution): Promise<IssueEnrichment> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_TRANSITION, projectId, issueNumber, to, resolution),

  bootstrapEnrichment: (projectId: string, issues: GitHubIssue[]): Promise<EnrichmentFile> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_BOOTSTRAP, projectId, issues),

  reconcileEnrichment: (projectId: string, issues: GitHubIssue[]): Promise<EnrichmentFile> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_RECONCILE, projectId, issues),

  gcEnrichment: (projectId: string, issueNumbers: number[]): Promise<{ pruned: number; orphaned: number }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ENRICHMENT_GC, projectId, issueNumbers),

  // Issue Mutations
  editIssueTitle: (projectId: string, issueNumber: number, title: string): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_EDIT_TITLE, projectId, issueNumber, title),

  editIssueBody: (projectId: string, issueNumber: number, body: string | null): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_EDIT_BODY, projectId, issueNumber, body),

  addIssueLabels: (projectId: string, issueNumber: number, labels: string[]): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_ADD_LABELS, projectId, issueNumber, labels),

  removeIssueLabels: (projectId: string, issueNumber: number, labels: string[]): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_REMOVE_LABELS, projectId, issueNumber, labels),

  addIssueAssignees: (projectId: string, issueNumber: number, assignees: string[]): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_ADD_ASSIGNEES, projectId, issueNumber, assignees),

  removeIssueAssignees: (projectId: string, issueNumber: number, assignees: string[]): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_REMOVE_ASSIGNEES, projectId, issueNumber, assignees),

  closeIssue: (projectId: string, issueNumber: number): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_CLOSE, projectId, issueNumber),

  reopenIssue: (projectId: string, issueNumber: number): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_REOPEN, projectId, issueNumber),

  addIssueComment: (projectId: string, issueNumber: number, body: string): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_COMMENT, projectId, issueNumber, body),

  // Bulk Operations
  executeBulk: (params: BulkExecuteParams): Promise<BulkOperationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_BULK_EXECUTE, params),

  onBulkProgress: (callback: (progress: BulkOperationProgress) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_BULK_PROGRESS, callback),

  onBulkComplete: (callback: (result: BulkOperationResult) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_BULK_COMPLETE, callback),

  // Repository Data
  getRepoLabels: (projectId: string) =>
    invokeIpc(IPC_CHANNELS.GITHUB_REPO_GET_LABELS, projectId),

  getRepoCollaborators: (projectId: string) =>
    invokeIpc(IPC_CHANNELS.GITHUB_REPO_GET_COLLABORATORS, projectId),

  // Spec from Issue
  createSpecFromIssue: (projectId: string, issueNumber: number): Promise<MutationResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_CREATE_SPEC, projectId, issueNumber),

  // AI Triage (Phase 3)
  cancelTriage: (): Promise<{ cancelled: boolean }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_TRIAGE_CANCEL),

  runEnrichment: (projectId: string, issueNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_TRIAGE_ENRICH, projectId, issueNumber),

  onEnrichmentProgress: (callback: (projectId: string, progress: EnrichmentProgress) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_ENRICH_PROGRESS, callback),

  onEnrichmentError: (callback: (projectId: string, error: { error: string }) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_ENRICH_ERROR, callback),

  onEnrichmentComplete: (callback: (projectId: string, result: AIEnrichmentResult) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_ENRICH_COMPLETE, callback),

  runSplitSuggestion: (projectId: string, issueNumber: number): void =>
    sendIpc(IPC_CHANNELS.GITHUB_TRIAGE_SPLIT, projectId, issueNumber),

  onSplitProgress: (callback: (projectId: string, progress: SplitProgress) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_SPLIT_PROGRESS, callback),

  onSplitError: (callback: (projectId: string, error: { error: string }) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_SPLIT_ERROR, callback),

  onSplitComplete: (callback: (projectId: string, result: SplitSuggestion) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_SPLIT_COMPLETE, callback),

  createIssue: (projectId: string, params: CreateIssueParams): Promise<CreateIssueResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_ISSUE_CREATE, projectId, params),

  applyTriageResults: (projectId: string, items: TriageReviewItem[]): void =>
    sendIpc(IPC_CHANNELS.GITHUB_TRIAGE_APPLY_RESULTS, projectId, items),

  onApplyResultsProgress: (callback: (projectId: string, progress: ApplyResultsProgress) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_APPLY_RESULTS_PROGRESS, callback),

  onApplyResultsError: (callback: (projectId: string, error: { error: string }) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_APPLY_RESULTS_ERROR, callback),

  onApplyResultsComplete: (callback: (projectId: string, results: { succeeded: number; failed: number; skipped: number }) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.GITHUB_TRIAGE_APPLY_RESULTS_COMPLETE, callback),

  savePendingReview: (projectId: string, items: TriageReviewItem[]): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.GITHUB_TRIAGE_SAVE_PENDING_REVIEW, projectId, items),

  loadPendingReview: (projectId: string): Promise<TriageReviewItem[]> =>
    invokeIpc(IPC_CHANNELS.GITHUB_TRIAGE_LOAD_PENDING_REVIEW, projectId),

  // Label Sync (Phase 4)
  enableLabelSync: (projectId: string): Promise<LabelSyncResult> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_ENABLE, projectId),

  disableLabelSync: (projectId: string, cleanup: boolean): Promise<{ success: boolean }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_DISABLE, projectId, cleanup),

  syncIssueLabel: (projectId: string, issueNumber: number, newState: string, oldState: string | null) =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_ISSUE, projectId, issueNumber, newState, oldState),

  getLabelSyncStatus: (projectId: string): Promise<LabelSyncConfig> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_STATUS, projectId),

  saveLabelSyncConfig: (projectId: string, config: LabelSyncConfig): Promise<{ success: boolean }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_SAVE, projectId, config),

  bulkLabelSync: (projectId: string, issueNumbers: number[]): Promise<{ synced: number; errors: number }> =>
    invokeIpc(IPC_CHANNELS.GITHUB_LABEL_SYNC_BULK, projectId, issueNumbers),

  // Dependencies (Phase 4)
  fetchDependencies: (projectId: string, issueNumber: number) =>
    invokeIpc(IPC_CHANNELS.GITHUB_DEPS_FETCH, projectId, issueNumber),

  // Metrics (Phase 4)
  computeMetrics: (projectId: string, timeWindow: MetricsTimeWindow): Promise<TriageMetrics> =>
    invokeIpc(IPC_CHANNELS.GITHUB_METRICS_COMPUTE, projectId, timeWindow),

  getStateCounts: (projectId: string): Promise<Record<WorkflowState, number>> =>
    invokeIpc(IPC_CHANNELS.GITHUB_METRICS_STATE_COUNTS, projectId),
});
