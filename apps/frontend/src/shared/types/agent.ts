/**
 * Agent-related types (Claude profiles and authentication)
 */

// ============================================
// Claude Profile Types (Multi-Account Support)
// ============================================

/**
 * Usage data parsed from Claude Code's /usage command
 */
export interface ClaudeUsageData {
  /** Session usage percentage (0-100) */
  sessionUsagePercent: number;
  /** When the session limit resets (ISO string or description like "11:59pm") */
  sessionResetTime: string;
  /** Weekly usage percentage across all models (0-100) */
  weeklyUsagePercent: number;
  /** When the weekly limit resets (ISO string or description) */
  weeklyResetTime: string;
  /** Weekly Opus usage percentage (0-100), if applicable */
  opusUsagePercent?: number;
  /** When this usage data was last updated */
  lastUpdated: Date;
}

/**
 * Real-time usage snapshot for proactive monitoring
 * Returned from API or CLI usage check
 */
export interface ClaudeUsageSnapshot {
  /** Session usage percentage (0-100) - represents 5-hour window for most providers */
  sessionPercent: number;
  /** Weekly usage percentage (0-100) - represents 7-day window for Anthropic, monthly for z.ai */
  weeklyPercent: number;
  /**
   * When the session limit resets (human-readable or ISO)
   *
   * NOTE: This value may contain hardcoded English strings ('Unknown', 'Expired', 'Resets in ...')
   * from the main process. Renderer components should use the sessionResetTimestamp field
   * with formatTimeRemaining() to generate localized countdown text when available.
   */
  sessionResetTime?: string;
  /**
   * When the weekly limit resets (human-readable or ISO)
   *
   * NOTE: This value may contain hardcoded English strings ('Unknown', '1st of January', etc.)
   * from the main process. Renderer components should localize these values before display.
   */
  weeklyResetTime?: string;
  /** ISO timestamp of when the session limit resets (for dynamic countdown calculation) */
  sessionResetTimestamp?: string;
  /** ISO timestamp of when the weekly limit resets (for dynamic countdown calculation) */
  weeklyResetTimestamp?: string;
  /** Profile ID this snapshot belongs to */
  profileId: string;
  /** Profile name for display */
  profileName: string;
  /** Email address associated with the profile (from Keychain or profile data) */
  profileEmail?: string;
  /** When this snapshot was captured */
  fetchedAt: Date;
  /** Which limit is closest to threshold ('session' or 'weekly') */
  limitType?: 'session' | 'weekly';
  /** Usage window types for this provider */
  usageWindows?: {
    /** Label for the session window (e.g., '5-hour', '5-hour window') */
    sessionWindowLabel: string;
    /** Label for the weekly window (e.g., '7-day', 'monthly', 'calendar month') */
    weeklyWindowLabel: string;
  };
  /** Raw session usage value (e.g., tokens used) */
  sessionUsageValue?: number;
  /** Session usage limit (total quota) */
  sessionUsageLimit?: number;
  /** Raw weekly usage value (e.g., tools used) */
  weeklyUsageValue?: number;
  /** Weekly usage limit (total quota) */
  weeklyUsageLimit?: number;
  /** True if profile has invalid refresh token and needs re-authentication */
  needsReauthentication?: boolean;
}

/**
 * Profile usage summary for multi-profile display
 * Contains the essential data needed to rank and display profiles in the usage indicator
 */
export interface ProfileUsageSummary {
  /** Profile ID */
  profileId: string;
  /** Profile name for display */
  profileName: string;
  /** Email address (from Keychain or profile) */
  profileEmail?: string;
  /** Session usage percentage (0-100) */
  sessionPercent: number;
  /** Weekly usage percentage (0-100) */
  weeklyPercent: number;
  /** ISO timestamp of when the session limit resets */
  sessionResetTimestamp?: string;
  /** ISO timestamp of when the weekly limit resets */
  weeklyResetTimestamp?: string;
  /** Whether this profile is authenticated */
  isAuthenticated: boolean;
  /** Whether this profile is currently rate limited */
  isRateLimited: boolean;
  /** Type of rate limit if limited */
  rateLimitType?: 'session' | 'weekly';
  /** Availability score (higher = more available, used for sorting) */
  availabilityScore: number;
  /** Whether this is the currently active profile */
  isActive: boolean;
  /** When this data was last fetched (ISO timestamp) */
  lastFetchedAt?: string;
  /** Error message if usage fetch failed */
  fetchError?: string;
  /** True if profile has invalid refresh token and needs re-authentication */
  needsReauthentication?: boolean;
}

/**
 * All profiles usage data for the usage indicator
 * Emitted alongside the active profile's detailed snapshot
 */
export interface AllProfilesUsage {
  /** Detailed snapshot for the active profile */
  activeProfile: ClaudeUsageSnapshot;
  /** Summary usage data for all profiles (sorted by availability, best first) */
  allProfiles: ProfileUsageSummary[];
  /** When this data was collected */
  fetchedAt: Date;
}

/**
 * Rate limit event recorded for a profile
 */
export interface ClaudeRateLimitEvent {
  /** Type of limit hit: 'session' or 'weekly' */
  type: 'session' | 'weekly';
  /** When the limit was hit */
  hitAt: Date;
  /** When it's expected to reset */
  resetAt: Date;
  /** The reset time string from Claude (e.g., "Dec 17 at 6am") */
  resetTimeString: string;
}

/**
 * A Claude Code subscription profile for multi-account support.
 * Profiles store OAuth tokens for instant switching without browser re-auth.
 */
export interface ClaudeProfile {
  id: string;
  name: string;
  /**
   * OAuth token (sk-ant-oat01-...) for this profile.
   * When set, CLAUDE_CODE_OAUTH_TOKEN env var is used instead of config dir.
   * Token is valid for 1 year from creation.
   */
  oauthToken?: string;
  /** Email address associated with this profile (for display) */
  email?: string;
  /** When the OAuth token was created (for expiry tracking - 1 year validity) */
  tokenCreatedAt?: Date;
  /**
   * Path to the Claude config directory (e.g., ~/.claude or ~/.claude-profiles/work)
   * @deprecated Use oauthToken instead for reliable multi-profile switching
   */
  configDir?: string;
  /** Whether this is the default profile (uses ~/.claude) */
  isDefault: boolean;
  /** Optional description/notes for this profile */
  description?: string;
  /** When the profile was created */
  createdAt: Date;
  /** Last time this profile was used */
  lastUsedAt?: Date;
  /** Current usage data from /usage command */
  usage?: ClaudeUsageData;
  /** Recent rate limit events for this profile */
  rateLimitEvents?: ClaudeRateLimitEvent[];
  /**
   * Whether this profile has valid authentication.
   * Computed server-side by checking configDir for credential files.
   * This is NOT persisted, it's computed dynamically on each getSettings() call.
   */
  isAuthenticated?: boolean;
  /**
   * Subscription type from OAuth credentials (e.g., "max" for Claude Max subscription).
   * Used to display "Max" vs "Pro" in the UI. Populated from Keychain credentials.
   */
  subscriptionType?: string;
  /**
   * Rate limit tier from OAuth credentials (e.g., "default_claude_max_20x").
   * Indicates the user's rate limit tier level. Populated from Keychain credentials.
   */
  rateLimitTier?: string;
}

/**
 * Settings for Claude profile management
 */
export interface ClaudeProfileSettings {
  /** All configured Claude profiles */
  profiles: ClaudeProfile[];
  /** ID of the currently active profile */
  activeProfileId: string;
  /** Auto-switch settings */
  autoSwitch?: ClaudeAutoSwitchSettings;
}

/**
 * Settings for automatic profile switching
 */
export interface ClaudeAutoSwitchSettings {
  /** Master toggle - enables all auto-switch features */
  enabled: boolean;

  // Proactive monitoring settings
  /** Enable proactive monitoring and swapping before hitting limits */
  proactiveSwapEnabled: boolean;
  /** Interval (ms) to check usage (default: 30000 = 30s, 0 = disabled) */
  usageCheckInterval: number;

  // Threshold settings
  /** Session usage threshold (0-100) to trigger proactive switch (default: 95) */
  sessionThreshold: number;
  /** Weekly usage threshold (0-100) to trigger proactive switch (default: 99) */
  weeklyThreshold: number;

  // Reactive recovery
  /** Whether to automatically switch on unexpected rate limit (vs. prompting user) */
  autoSwitchOnRateLimit: boolean;

  /** Whether to automatically switch on authentication failure (vs. prompting user) */
  autoSwitchOnAuthFailure: boolean;
}

export interface ClaudeAuthResult {
  success: boolean;
  authenticated: boolean;
  error?: string;
}

/**
 * Payload for TERMINAL_PROFILE_CHANGED event.
 * Sent when profile switches and terminals need to be refreshed.
 */
export interface TerminalProfileChangedEvent {
  previousProfileId: string;
  newProfileId: string;
  terminals: Array<{
    id: string;
    /** Session ID if terminal had an active Claude session */
    sessionId?: string;
    /** Whether the session was successfully migrated to new profile */
    sessionMigrated?: boolean;
  }>;
}

// ============================================
// Queue Routing Types (Rate Limit Recovery)
// ============================================

/**
 * Reason for profile assignment to a task
 */
export type ProfileAssignmentReason = 'proactive' | 'reactive' | 'manual';

/**
 * Tracking of running tasks grouped by profile
 */
export interface RunningTasksByProfile {
  /** Map of profileId → array of task IDs running on that profile */
  byProfile: Record<string, string[]>;
  /** Total number of running tasks across all profiles */
  totalRunning: number;
}

/**
 * Profile swap record for tracking history
 */
export interface ProfileSwapRecord {
  fromProfileId: string;
  fromProfileName: string;
  toProfileId: string;
  toProfileName: string;
  swappedAt: string;
  reason: 'capacity' | 'rate_limit' | 'manual' | 'recovery';
  sessionId?: string;
  sessionResumed: boolean;
}
