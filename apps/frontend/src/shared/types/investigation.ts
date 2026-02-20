/**
 * AI Issue Investigation types
 *
 * Defines the type contracts for the investigation system that replaces
 * the old triage/enrichment workflow. Investigation runs 4 specialist
 * agents in parallel to analyze GitHub issues.
 */

// ============================================
// Investigation State Machine
// ============================================

/**
 * Derived investigation state for an issue.
 * Computed from investigation data + linked task status, never manually set.
 */
export type InvestigationState =
  | 'new'
  | 'queued'
  | 'investigating'
  | 'interrupted'
  | 'findings_ready'
  | 'resolved'
  | 'failed'
  | 'task_created'
  | 'building'
  | 'done';

/**
 * The 4 specialist agent types that run during investigation.
 */
export type InvestigationAgentType = 'root_cause' | 'impact' | 'fix_advisor' | 'reproducer';

// ============================================
// Agent Output Types
// ============================================

/**
 * Code reference found by an investigation agent.
 */
export interface CodeReference {
  file: string;
  line?: number;
  endLine?: number;
  snippet?: string;
  description: string;
}

/**
 * Base output from any specialist agent.
 */
export interface InvestigationAgentResult {
  agentType: InvestigationAgentType;
  summary: string;
  findings: string[];
  codeReferences: CodeReference[];
  /** @deprecated Removed from UI — AI self-reported confidence was misleading */
  confidence?: number;
}

/**
 * Root Cause Analyzer output — traces the bug/issue to its source.
 */
export interface RootCauseAnalysis extends InvestigationAgentResult {
  agentType: 'root_cause';
  rootCause: string;
  codePaths: string[];
  relatedIssues?: number[];
}

/**
 * Impact Assessor output — determines blast radius.
 */
export interface ImpactAssessment extends InvestigationAgentResult {
  agentType: 'impact';
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedComponents: string[];
  userImpact: string;
  riskIfUnfixed: string;
}

/**
 * Fix Advisor output — suggests concrete fix approaches.
 */
export interface FixAdvice extends InvestigationAgentResult {
  agentType: 'fix_advisor';
  suggestedApproaches: Array<{
    title: string;
    description: string;
    filesToModify: string[];
    complexity: 'simple' | 'standard' | 'complex';
    risks: string[];
  }>;
  recommendedApproach: number; // index into suggestedApproaches
  patternsToFollow: string[];
}

/**
 * Reproducer output — reproducibility and test coverage.
 */
export interface ReproductionAnalysis extends InvestigationAgentResult {
  agentType: 'reproducer';
  reproducible: boolean | 'unknown';
  reproductionSteps?: string[];
  existingTests: string[];
  testGaps: string[];
  suggestedTests: string[];
}

// ============================================
// Investigation Report
// ============================================

/**
 * Linked PR detected during investigation.
 */
export interface LinkedPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
}

/**
 * AI-suggested label for the issue.
 */
export interface SuggestedLabel {
  name: string;
  reason: string;
  accepted?: boolean; // user accept/reject state
}

/**
 * Complete investigation report combining all 4 agent outputs.
 */
export interface InvestigationReport {
  rootCause: RootCauseAnalysis;
  impact: ImpactAssessment;
  fixAdvice: FixAdvice;
  reproduction: ReproductionAnalysis;
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestedLabels: SuggestedLabel[];
  likelyResolved: boolean;
  linkedPRs: LinkedPR[];
  timestamp: string;
}

// ============================================
// Investigation Progress & Result
// ============================================

/**
 * Per-agent status within an investigation.
 */
export interface AgentStatus {
  agentType: InvestigationAgentType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  message?: string;
}

/**
 * Real-time progress update during investigation.
 */
export interface InvestigationProgress {
  issueNumber: number;
  phase: string;
  progress: number; // 0-100
  message: string;
  agentStatuses: AgentStatus[];
  startedAt: string;
}

/**
 * Final investigation result delivered on completion.
 */
export interface InvestigationResult {
  issueNumber: number;
  report: InvestigationReport;
  specId?: string;
  worktreePath?: string;
  githubCommentId?: number;
  completedAt: string;
}

// ============================================
// Dismiss & Settings
// ============================================

/**
 * Reason for dismissing an issue.
 */
export type InvestigationDismissReason = 'wont_fix' | 'duplicate' | 'cannot_reproduce' | 'out_of_scope';

/**
 * Pipeline mode for investigation-created tasks.
 */
export type InvestigationPipelineMode = 'full' | 'skip_to_planning' | 'minimal';
/**
 * How phase 1 specialists are dispatched (root_cause + reproducer).
 */
export type InvestigationPhase1ExecutionMode = 'parallel' | 'sequential';

// ============================================
// Investigation Label Customization
// ============================================

export type InvestigationLabelKey =
  | 'investigating'
  | 'findings_ready'
  | 'task_created'
  | 'building'
  | 'done';

export interface CustomInvestigationLabel {
  suffix: string;
  color: string; // 6-char hex, no #
  description: string;
}

export interface InvestigationLabelCustomization {
  prefix: string; // default "auto-claude:"
  labels: Record<InvestigationLabelKey, CustomInvestigationLabel>;
}

/**
 * Investigation settings (subsection of GitHub settings).
 */
export interface InvestigationSettings {
  autoCreateTasks: boolean;
  autoStartTasks: boolean;
  pipelineMode: InvestigationPipelineMode;
  /** Phase 1 specialist execution strategy */
  phase1ExecutionMode?: InvestigationPhase1ExecutionMode;
  autoPostToGitHub: boolean;
  autoCloseIssues: boolean;
  maxParallelInvestigations: number;
  labelIncludeFilter: string[];
  labelExcludeFilter: string[];
  /** Whether user has consented to auto-claude label creation on the repo */
  labelConsentGiven?: boolean;
  /** Custom investigation label configuration */
  labelCustomization?: InvestigationLabelCustomization;
  /** Enable Opus 4.6 Fast Mode for investigations (2.5x faster, higher cost) */
  fastInvestigations?: boolean;
}

// ============================================
// Persisted Investigation (for app restart recovery)
// ============================================

/**
 * Persisted investigation data loaded from disk on app restart.
 * Used to restore completed/failed investigation state into the store.
 */
export interface PersistedInvestigationState {
  issueNumber: number;
  status: 'investigating' | 'findings_ready' | 'resolved' | 'failed' | 'task_created';
  report?: InvestigationReport;
  completedAt?: string;
  specId?: string;
  githubCommentId?: number;
  /** Timestamp when results were posted to GitHub */
  postedAt?: string;
  /** True if the investigation was in-progress when the app shut down */
  wasInterrupted?: boolean;
  /** True if the investigation has saved session IDs that can be resumed */
  hasResumeSessions?: boolean;
  /** Persisted activity log entries */
  activityLog?: Array<{ event: string; timestamp: string }>;
}

// ============================================
// Batch Staging
// ============================================

/**
 * An item in the batch staging area (auto-create review).
 */
export interface BatchStagingItem {
  issueNumber: number;
  issueTitle: string;
  report: InvestigationReport;
  specId: string;
  approved?: boolean;
  createdAt: string;
}

// ============================================
// Investigation Logs (Live Agent Output)
// ============================================

/**
 * Single log entry from an investigation agent's stdout.
 */
export interface InvestigationLogEntry {
  timestamp: string;
  type: 'text' | 'tool_start' | 'tool_end' | 'error' | 'info' | 'thinking';
  content: string;
  agentType: InvestigationAgentType | 'orchestrator';
  source?: string;
  detail?: string;
  /** Tool name for tool_start/tool_end events */
  toolName?: string;
  /** Preview of thinking content */
  thinkingPreview?: string;
  /** Number of thinking chars */
  thinkingChars?: number;
  /** Whether this was parsed from structured JSON */
  isStructured?: boolean;
}

/**
 * Log entries and status for a single investigation agent.
 */
export interface InvestigationAgentLog {
  agentType: InvestigationAgentType | 'orchestrator';
  status: 'pending' | 'active' | 'completed' | 'failed';
  entries: InvestigationLogEntry[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Complete investigation logs for an issue, containing per-agent log streams.
 */
export interface InvestigationLogs {
  issueNumber: number;
  createdAt: string;
  updatedAt: string;
  agents: Record<InvestigationAgentType | 'orchestrator', InvestigationAgentLog>;
}

// ============================================
// Investigation Data for UI (from spec directory)
// ============================================

/**
 * Investigation data loaded from spec directory for GitHub-sourced tasks.
 * Includes the report plus the file path for reference.
 */
export interface InvestigationData extends InvestigationReport {
  reportPath: string;
}
