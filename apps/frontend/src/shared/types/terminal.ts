/**
 * Terminal-related types
 */

/**
 * Shell type for Windows terminals.
 * Used to determine correct command chaining syntax:
 * - 'powershell': Uses ';' (PowerShell 5.1 doesn't support '&&')
 * - 'cmd': Uses '&&' (cmd.exe, PowerShell 7+, bash, etc.)
 */
export type WindowsShellType = 'powershell' | 'cmd';

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  projectPath?: string;
  /** Skip injecting OAuth token into terminal environment (used for auth terminals) */
  skipOAuthToken?: boolean;
  /** Custom environment variables to add to the terminal (merged with defaults) */
  env?: Record<string, string>;
}

export interface TerminalResizeOptions {
  id: string;
  cols: number;
  rows: number;
}

/**
 * Persisted terminal session data for restoring sessions on app restart
 */
export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  projectPath: string;
  isClaudeMode: boolean;
  claudeSessionId?: string;  // Claude Code session ID for --resume
  outputBuffer: string;
  createdAt: string;
  lastActiveAt: string;
  /** Display order for tab persistence (lower = further left) */
  displayOrder?: number;
  /** Associated worktree configuration (validated on restore) */
  worktreeConfig?: TerminalWorktreeConfig;
}

export interface TerminalRestoreResult {
  success: boolean;
  terminalId: string;
  outputBuffer?: string;  // For replay in UI
  error?: string;
}

/**
 * Session date information for dropdown display
 */
export interface SessionDateInfo {
  date: string;  // YYYY-MM-DD format
  label: string;  // Human readable: "Today", "Yesterday", "Dec 10"
  sessionCount: number;  // Total sessions across all projects
  projectCount: number;  // Number of projects with sessions
}

/**
 * Result of restoring sessions from a specific date
 */
export interface SessionDateRestoreResult {
  restored: number;
  failed: number;
  sessions: Array<{
    id: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Rate limit information when Claude Code hits subscription limits
 */
export interface RateLimitInfo {
  terminalId: string;
  resetTime: string;  // e.g., "Dec 17 at 6am (Europe/Oslo)"
  detectedAt: Date;
  /** ID of the profile that hit the limit */
  profileId?: string;
  /** ID of a suggested alternative profile to switch to */
  suggestedProfileId?: string;
  /** Name of the suggested alternative profile */
  suggestedProfileName?: string;
  /** Whether auto-switch on rate limit is enabled */
  autoSwitchEnabled?: boolean;
}

/**
 * Rate limit information for SDK/CLI calls (non-terminal)
 * Used for changelog, task execution, roadmap, ideation, etc.
 */
export interface SDKRateLimitInfo {
  /** Source of the rate limit (which feature hit it) */
  source: 'changelog' | 'task' | 'roadmap' | 'ideation' | 'title-generator' | 'other';
  /** Project ID if applicable */
  projectId?: string;
  /** Task ID if applicable */
  taskId?: string;
  /** The reset time string (e.g., "Dec 17 at 6am (Europe/Oslo)") */
  resetTime?: string;
  /** Type of limit: 'session' (5-hour) or 'weekly' (7-day) */
  limitType?: 'session' | 'weekly';
  /** Profile that hit the limit */
  profileId: string;
  /** Profile name for display */
  profileName?: string;
  /** Suggested alternative profile */
  suggestedProfile?: {
    id: string;
    name: string;
  };
  /** When detected */
  detectedAt: Date;
  /** Original error message */
  originalError?: string;

  // Auto-swap information (NEW)
  /** Whether this rate limit was automatically handled via account swap */
  wasAutoSwapped?: boolean;
  /** Profile that was swapped to (if auto-swapped) */
  swappedToProfile?: {
    id: string;
    name: string;
  };
  /** Why the swap occurred: 'proactive' (before limit) or 'reactive' (after limit hit) */
  swapReason?: 'proactive' | 'reactive';
}

/**
 * Authentication failure information for SDK/CLI operations.
 * Emitted when Claude CLI encounters a 401 or other auth error,
 * indicating the token needs to be refreshed via re-authentication.
 */
export interface AuthFailureInfo {
  /** The profile ID that failed to authenticate */
  profileId: string;
  /** The profile name for display */
  profileName?: string;
  /** Type of auth failure */
  failureType: 'missing' | 'invalid' | 'expired' | 'unknown';
  /** User-friendly message describing the failure */
  message: string;
  /** Original error message from the process output */
  originalError?: string;
  /** Task ID if applicable (for task-related auth failures) */
  taskId?: string;
  /** When detected (Note: serialized as ISO string over IPC) */
  detectedAt: Date;
}

/**
 * Billing/credit exhaustion failure information for SDK/CLI operations.
 * Emitted when Claude API returns billing-related errors (HTTP 400 with
 * invalid_request_error), indicating the account has insufficient credits,
 * exceeded usage limits, or has a billing configuration issue.
 */
export interface BillingFailureInfo {
  /** The profile ID that has billing issues */
  profileId: string;
  /** The profile name for display */
  profileName?: string;
  /** Type of billing failure */
  failureType: 'insufficient_credits' | 'payment_required' | 'subscription_inactive' | 'unknown';
  /** User-friendly message describing the failure */
  message: string;
  /** Original error message from the process output */
  originalError?: string;
  /** Task ID if applicable (for task-related billing failures) */
  taskId?: string;
  /** When detected (Note: serialized as ISO string over IPC) */
  detectedAt: Date;
}

/**
 * Request to retry a rate-limited operation with a different profile
 */
export interface RetryWithProfileRequest {
  /** Source of the original operation */
  source: SDKRateLimitInfo['source'];
  /** Project ID */
  projectId: string;
  /** Task ID if applicable */
  taskId?: string;
  /** Profile ID to retry with */
  profileId: string;
}

// ============================================================================
// Terminal Worktree Types
// ============================================================================

/**
 * Configuration for a terminal-associated git worktree
 * Enables isolated development environments for each terminal session
 */
export interface TerminalWorktreeConfig {
  /** Unique worktree name (used as directory name) */
  name: string;
  /** Path to the worktree directory (.auto-claude/worktrees/terminal/{name}/) */
  worktreePath: string;
  /** Git branch name (terminal/{name}) - empty if no branch created */
  branchName: string;
  /** Base branch the worktree was created from (from project settings or auto-detected) */
  baseBranch: string;
  /** Whether a git branch was created for this worktree */
  hasGitBranch: boolean;
  /** Associated task ID (optional - for task-linked worktrees) */
  taskId?: string;
  /** When the worktree was created */
  createdAt: string;
  /** Terminal ID this worktree is associated with */
  terminalId: string;
  /** Whether the branch was pushed to remote with tracking set up */
  remoteTrackingSetUp?: boolean;
}

/**
 * Request to create a terminal worktree
 */
export interface CreateTerminalWorktreeRequest {
  /** Terminal ID to associate with */
  terminalId: string;
  /** Worktree name (alphanumeric, dashes, underscores only) */
  name: string;
  /** Optional task ID to link */
  taskId?: string;
  /** Whether to create a git branch (terminal/{name}) */
  createGitBranch: boolean;
  /** Project path where the worktree will be created */
  projectPath: string;
  /** Optional base branch to create worktree from (defaults to project default) */
  baseBranch?: string;
  /**
   * When true, use the local branch directly without auto-switching to remote.
   * This preserves gitignored files (.env, configs) that may not exist on remote.
   * When false or undefined, the default behavior prefers origin/branch if it exists.
   */
  useLocalBranch?: boolean;
}

/**
 * Result of terminal worktree creation
 */
export interface TerminalWorktreeResult {
  success: boolean;
  config?: TerminalWorktreeConfig;
  error?: string;
  /** Warning when worktree was created but remote push failed */
  warning?: string;
}

/**
 * Information about a worktree not managed by Auto Claude
 * Discovered via `git worktree list` excluding Auto Claude paths
 */
export interface OtherWorktreeInfo {
  /** Full path to the worktree */
  path: string;
  /** Git branch name, or null if in detached HEAD state */
  branch: string | null;
  /** Short commit SHA (first 8 chars) */
  commitSha: string;
  /** Display name (last directory component of path) */
  displayName: string;
}
