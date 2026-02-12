import type { GitHubIssue, GitHubInvestigationResult } from '../../../../shared/types';
import type { AutoFixConfig, AutoFixQueueItem } from '../../../../preload/api/modules/github-api';

export type FilterState = 'open' | 'closed' | 'all';

/**
 * Classification types for GitHub API errors.
 * Used to determine appropriate icon, message, and actions for error display.
 */
export type GitHubErrorType =
  | 'rate_limit'
  | 'auth'
  | 'permission'
  | 'network'
  | 'not_found'
  | 'unknown';

/**
 * Parsed GitHub error information with metadata.
 * Returned by the github-error-parser utility.
 *
 * IMPORTANT: The `message` field contains hardcoded English strings intended
 * ONLY as a fallback defaultValue for i18n translation. Direct consumers should
 * use the `type` field to look up the appropriate translation key (e.g.,
 * 'githubErrors.rateLimitMessage') via react-i18next rather than displaying
 * `message` directly. This ensures proper localization for all users.
 */
export interface GitHubErrorInfo {
  /** The classified error type */
  type: GitHubErrorType;
  /**
   * User-friendly error message in English.
   * NOTE: Use only as defaultValue for i18n - do not display directly.
   * Use type field to look up translation key (e.g., 'githubErrors.rateLimitMessage').
   */
  message: string;
  /** Original raw error string (for debugging/details) */
  rawMessage?: string;
  /** Rate limit reset time (only for rate_limit type) */
  rateLimitResetTime?: Date;
  /** Required OAuth scopes that are missing (only for permission type) */
  requiredScopes?: string[];
  /** HTTP status code if available */
  statusCode?: number;
}

export interface GitHubIssuesProps {
  onOpenSettings?: () => void;
  /** Navigate to view a task in the kanban board */
  onNavigateToTask?: (taskId: string) => void;
}

export interface IssueListItemProps {
  issue: GitHubIssue;
  isSelected: boolean;
  onClick: () => void;
  onInvestigate: () => void;
}

export interface IssueDetailProps {
  issue: GitHubIssue;
  onInvestigate: () => void;
  investigationResult: GitHubInvestigationResult | null;
  /** ID of existing task linked to this issue (from metadata.githubIssueNumber) */
  linkedTaskId?: string;
  /** Handler to navigate to view the linked task */
  onViewTask?: (taskId: string) => void;
  /** Project ID for auto-fix functionality */
  projectId?: string;
  /** Auto-fix configuration */
  autoFixConfig?: AutoFixConfig | null;
  /** Auto-fix queue item for this issue */
  autoFixQueueItem?: AutoFixQueueItem | null;
}

export interface InvestigationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIssue: GitHubIssue | null;
  investigationStatus: {
    phase: string;
    progress: number;
    message: string;
    error?: string;
  };
  onStartInvestigation: (selectedCommentIds: number[]) => void;
  onClose: () => void;
  projectId?: string;
}

export interface IssueListHeaderProps {
  repoFullName: string;
  openIssuesCount: number;
  isLoading: boolean;
  searchQuery: string;
  filterState: FilterState;
  onSearchChange: (query: string) => void;
  onFilterChange: (state: FilterState) => void;
  onRefresh: () => void;
  // Auto-fix toggle (reactive - for new issues)
  autoFixEnabled?: boolean;
  autoFixRunning?: boolean;
  autoFixProcessing?: number; // Number of issues being processed
  onAutoFixToggle?: (enabled: boolean) => void;
  // Analyze & Group (proactive - for existing issues)
  onAnalyzeAndGroup?: () => void;
  isAnalyzing?: boolean;
}

export interface IssueListProps {
  issues: GitHubIssue[];
  selectedIssueNumber: number | null;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  error: string | null;
  onSelectIssue: (issueNumber: number) => void;
  onInvestigate: (issue: GitHubIssue) => void;
  onLoadMore?: () => void;
  /** Callback for retry button in error display */
  onRetry?: () => void;
  /** Callback for settings button in error display */
  onOpenSettings?: () => void;
}

export interface EmptyStateProps {
  searchQuery?: string;
  icon?: React.ComponentType<{ className?: string }>;
  message: string;
}

export interface NotConnectedStateProps {
  error: string | null;
  onOpenSettings?: () => void;
}
