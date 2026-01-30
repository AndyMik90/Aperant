/**
 * Rate limit detection utility for Claude CLI/SDK calls.
 * Detects rate limit errors in stdout/stderr output and provides context.
 */

import { getClaudeProfileManager } from './claude-profile-manager';
import { getUsageMonitor } from './claude-profile/usage-monitor';

/**
 * Regex pattern to detect Claude Code rate limit messages
 * Matches: "Limit reached · resets Dec 17 at 6am (Europe/Oslo)"
 */
const RATE_LIMIT_PATTERN = /Limit reached\s*[·•]\s*resets\s+(.+?)(?:\s*$|\n)/im;

/**
 * Additional patterns that might indicate rate limiting
 */
const RATE_LIMIT_INDICATORS = [
  /rate\s*limit/i,
  /usage\s*limit/i,
  /limit\s*reached/i,
  /exceeded.*limit/i,
  /too\s*many\s*requests/i
];

/**
 * Patterns that indicate authentication failures
 * These patterns detect when Claude CLI/SDK fails due to missing or invalid auth
 *
 * IMPORTANT: These patterns must be specific enough to NOT match on AI response
 * content that discusses authentication topics (e.g., PRs about auth features).
 * The patterns should only match actual API error messages.
 */
const AUTH_FAILURE_PATTERNS = [
  // Match Claude API authentication_error type in JSON responses (most reliable)
  /["']?type["']?\s*:\s*["']?authentication_error["']?/i,
  // Match plain "API Error: 401" - this is a structured error format
  /API\s*Error:\s*401/i,
  // Match "OAuth token has expired" format from Claude API (specific phrasing)
  /oauth\s*token\s+has\s+expired/i,
  // Match "Please obtain a new token" or "refresh your existing token" - API specific
  /please\s+(obtain\s+a\s+new|refresh\s+your)\s+(existing\s+)?token/i,
  // Match Claude CLI specific auth messages (with context markers)
  /\[.*\]\s*authentication\s*(is\s*)?required/i,
  /\[.*\]\s*not\s*(yet\s*)?authenticated/i,
  /\[.*\]\s*login\s*(is\s*)?required/i,
  // Match 401 status codes in structured error output
  /status[:\s]+401/i,
  /HTTP\s*401/i,
  // Match specific error prefixes that indicate actual errors (not AI discussion)
  /Error:\s*.*(?:unauthorized|authentication|invalid\s*token)/i,
  // Match · Please run /login format from Claude CLI
  /·\s*Please\s+run\s+\/login/i,
];

/**
 * Result of rate limit detection
 */
export interface RateLimitDetectionResult {
  /** Whether a rate limit was detected */
  isRateLimited: boolean;
  /** The reset time string if detected (e.g., "Dec 17 at 6am (Europe/Oslo)") */
  resetTime?: string;
  /** Type of limit: 'session' (5-hour) or 'weekly' (7-day) */
  limitType?: 'session' | 'weekly';
  /** The profile ID that hit the limit (if known) */
  profileId?: string;
  /** Best alternative profile to switch to */
  suggestedProfile?: {
    id: string;
    name: string;
  };
  /** Original error message */
  originalError?: string;
}

/**
 * Result of authentication failure detection
 */
export interface AuthFailureDetectionResult {
  /** Whether an authentication failure was detected */
  isAuthFailure: boolean;
  /** The profile ID that failed to authenticate (if known) */
  profileId?: string;
  /** The type of auth failure detected */
  failureType?: 'missing' | 'invalid' | 'expired' | 'unknown';
  /** User-friendly message describing the failure */
  message?: string;
  /** Original error message from the process output */
  originalError?: string;
}

/**
 * Classify rate limit type based on reset time string
 */
function classifyLimitType(resetTimeStr: string): 'session' | 'weekly' {
  // Weekly limits mention specific dates like "Dec 17" or "Nov 1"
  // Session limits are typically just times like "11:59pm"
  const hasDate = /[A-Za-z]{3}\s+\d+/i.test(resetTimeStr);
  const hasWeeklyIndicator = resetTimeStr.toLowerCase().includes('week');

  return (hasDate || hasWeeklyIndicator) ? 'weekly' : 'session';
}

/**
 * Detect rate limit from output (stdout + stderr combined)
 */
export function detectRateLimit(
  output: string,
  profileId?: string
): RateLimitDetectionResult {
  // Check for the primary rate limit pattern
  const match = output.match(RATE_LIMIT_PATTERN);

  if (match) {
    const resetTime = match[1].trim();
    const limitType = classifyLimitType(resetTime);

    // Record the rate limit event in the profile manager
    const profileManager = getClaudeProfileManager();
    const effectiveProfileId = profileId || profileManager.getActiveProfile().id;

    try {
      profileManager.recordRateLimitEvent(effectiveProfileId, resetTime);
    } catch (err) {
      console.error('[RateLimitDetector] Failed to record rate limit event:', err);
    }

    // Find best alternative profile
    const bestProfile = profileManager.getBestAvailableProfile(effectiveProfileId);

    return {
      isRateLimited: true,
      resetTime,
      limitType,
      profileId: effectiveProfileId,
      suggestedProfile: bestProfile ? {
        id: bestProfile.id,
        name: bestProfile.name
      } : undefined,
      originalError: output
    };
  }

  // Check for secondary rate limit indicators
  for (const pattern of RATE_LIMIT_INDICATORS) {
    if (pattern.test(output)) {
      const profileManager = getClaudeProfileManager();
      const effectiveProfileId = profileId || profileManager.getActiveProfile().id;
      const bestProfile = profileManager.getBestAvailableProfile(effectiveProfileId);

      return {
        isRateLimited: true,
        profileId: effectiveProfileId,
        suggestedProfile: bestProfile ? {
          id: bestProfile.id,
          name: bestProfile.name
        } : undefined,
        originalError: output
      };
    }
  }

  return { isRateLimited: false };
}

/**
 * Check if output contains rate limit error
 */
export function isRateLimitError(output: string): boolean {
  return detectRateLimit(output).isRateLimited;
}

/**
 * Extract reset time from rate limit message
 */
export function extractResetTime(output: string): string | null {
  const match = output.match(RATE_LIMIT_PATTERN);
  return match ? match[1].trim() : null;
}

/**
 * Classify the type of authentication failure based on the error message
 */
function classifyAuthFailureType(output: string): 'missing' | 'invalid' | 'expired' | 'unknown' {
  const lowerOutput = output.toLowerCase();

  if (/missing|not\s*(yet\s*)?authenticated|required/.test(lowerOutput)) {
    return 'missing';
  }
  // Check for expired tokens - includes "has expired", "obtain a new token", etc.
  if (/expired|session\s*expired|obtain\s*(a\s*)?new\s*token|refresh\s*(your\s*)?(existing\s*)?token/.test(lowerOutput)) {
    return 'expired';
  }
  // Check for invalid auth - includes 401, authentication_error, unauthorized
  if (/invalid|unauthorized|denied|401|authentication_error/.test(lowerOutput)) {
    return 'invalid';
  }
  return 'unknown';
}

/**
 * Get a user-friendly message for the authentication failure
 */
function getAuthFailureMessage(failureType: 'missing' | 'invalid' | 'expired' | 'unknown'): string {
  switch (failureType) {
    case 'missing':
      return 'Claude authentication required. Please go to Settings > Claude Profiles and authenticate your account.';
    case 'expired':
      return 'Your Claude session has expired. Please re-authenticate in Settings > Claude Profiles.';
    case 'invalid':
      return 'Invalid Claude credentials. Please check your OAuth token or re-authenticate in Settings > Claude Profiles.';
    case 'unknown':
    default:
      return 'Claude authentication failed. Please verify your authentication in Settings > Claude Profiles.';
  }
}

/**
 * Detect authentication failure from output (stdout + stderr combined)
 */
export function detectAuthFailure(
  output: string,
  profileId?: string
): AuthFailureDetectionResult {
  // First, make sure this isn't a rate limit error (those should be handled separately)
  if (detectRateLimit(output).isRateLimited) {
    return { isAuthFailure: false };
  }

  // Check for authentication failure patterns
  for (const pattern of AUTH_FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      const profileManager = getClaudeProfileManager();
      const effectiveProfileId = profileId || profileManager.getActiveProfile().id;
      const failureType = classifyAuthFailureType(output);

      return {
        isAuthFailure: true,
        profileId: effectiveProfileId,
        failureType,
        message: getAuthFailureMessage(failureType),
        originalError: output
      };
    }
  }

  return { isAuthFailure: false };
}

/**
 * Check if output contains authentication failure error
 */
export function isAuthFailureError(output: string): boolean {
  return detectAuthFailure(output).isAuthFailure;
}

/**
 * Get environment variables for a specific Claude profile.
 *
 * IMPORTANT: Always uses CLAUDE_CONFIG_DIR to let Claude CLI read fresh tokens from Keychain.
 * We do NOT use cached OAuth tokens (CLAUDE_CODE_OAUTH_TOKEN) because:
 * 1. OAuth tokens expire in 8-12 hours
 * 2. Claude CLI's token refresh mechanism works (updates Keychain)
 * 3. Cached tokens don't benefit from Claude CLI's automatic refresh
 *
 * By using CLAUDE_CONFIG_DIR, Claude CLI reads fresh tokens from Keychain each time,
 * which includes any refreshed tokens. This solves the 401 errors after a few hours.
 *
 * See: docs/LONG_LIVED_AUTH_PLAN.md for full context.
 *
 * @param profileId - Optional profile ID. If not provided, uses active profile.
 * @returns Environment variables for Claude CLI invocation
 */
export function getProfileEnv(profileId?: string): Record<string, string> {
  const profileManager = getClaudeProfileManager();

  // Delegate to profile manager's implementation to avoid code duplication
  if (profileId) {
    return profileManager.getProfileEnv(profileId);
  }
  return profileManager.getActiveProfileEnv();
}

/**
 * Result of getting the best available profile environment
 */
export interface BestProfileEnvResult {
  /** Environment variables for the selected profile */
  env: Record<string, string>;
  /** The profile ID that was selected */
  profileId: string;
  /** The profile name for logging/display */
  profileName: string;
  /** Whether a swap was performed (true if different from active profile) */
  wasSwapped: boolean;
  /** Reason for the swap if one occurred */
  swapReason?: 'rate_limited' | 'at_capacity' | 'proactive';
  /** The original active profile if a swap occurred */
  originalProfile?: {
    id: string;
    name: string;
  };
}

/**
 * Get environment variables for the BEST available Claude profile and persist the profile swap.
 *
 * IMPORTANT: This function has the side effect of calling profileManager.setActiveProfile()
 * when a better profile is found. This modifies global state and persists the profile swap.
 *
 * This is the preferred function for SDK operations that need profile environment.
 * It automatically handles:
 * 1. Checking if the active profile is explicitly rate-limited (received 429/rate limit error)
 * 2. Checking if the active profile is at capacity (100% weekly usage)
 * 3. Finding a better alternative profile if available
 * 4. PERSISTING the swap by updating the active profile
 *
 * Use this instead of getProfileEnv() for any operation that will make Claude API calls.
 *
 * @returns Object containing env vars and metadata about which profile was selected
 */
export function getBestAvailableProfileEnv(): BestProfileEnvResult {
  const profileManager = getClaudeProfileManager();
  const activeProfile = profileManager.getActiveProfile();

  // Check for explicit rate limit (from previous API errors)
  const rateLimitStatus = profileManager.isProfileRateLimited(activeProfile.id);

  // Check for capacity limit (100% weekly usage - will be rate limited on next request)
  const isAtCapacity = activeProfile.usage?.weeklyUsagePercent !== undefined &&
                       activeProfile.usage.weeklyUsagePercent >= 100;

  // Determine if we need to find an alternative
  const needsSwap = rateLimitStatus.limited || isAtCapacity;
  const swapReason: BestProfileEnvResult['swapReason'] = rateLimitStatus.limited
    ? 'rate_limited'
    : isAtCapacity
      ? 'at_capacity'
      : undefined;

  if (needsSwap) {
    if (process.env.DEBUG === 'true') {
      console.warn('[RateLimitDetector] Active profile needs swap:', {
        activeProfile: activeProfile.name,
        isRateLimited: rateLimitStatus.limited,
        isAtCapacity,
        weeklyUsage: activeProfile.usage?.weeklyUsagePercent,
        limitType: rateLimitStatus.type,
        resetAt: rateLimitStatus.resetAt
      });
    }

    // Try to find a better profile
    const bestProfile = profileManager.getBestAvailableProfile(activeProfile.id);

    if (bestProfile) {
      if (process.env.DEBUG === 'true') {
        console.warn('[RateLimitDetector] Using alternative profile:', {
          originalProfile: activeProfile.name,
          alternativeProfile: bestProfile.name,
          reason: swapReason
        });
      }

      // Persist the swap by updating the active profile
      // This ensures the UI reflects which account is actually being used
      profileManager.setActiveProfile(bestProfile.id);
      console.warn('[RateLimitDetector] Switched active profile:', {
        from: activeProfile.name,
        to: bestProfile.name,
        reason: swapReason
      });

      // Trigger a usage refresh so the UI shows the new active profile
      // This updates the UsageIndicator in the header
      // We use fire-and-forget pattern to avoid making this function async
      try {
        const usageMonitor = getUsageMonitor();
        // Force refresh all profiles usage data, which will emit 'all-profiles-usage-updated' event
        // The UI components listen for this and will update automatically
        usageMonitor.getAllProfilesUsage(true).then((allProfilesUsage) => {
          if (allProfilesUsage) {
            // Find the new active profile in allProfiles and emit its usage
            // This ensures UsageIndicator.usage state also updates to show the new active account
            const newActiveProfile = allProfilesUsage.allProfiles.find(p => p.isActive);
            if (newActiveProfile) {
              // Construct a ClaudeUsageSnapshot for the new active profile
              const newActiveUsage = {
                profileId: newActiveProfile.profileId,
                profileName: newActiveProfile.profileName,
                profileEmail: newActiveProfile.profileEmail,
                sessionPercent: newActiveProfile.sessionPercent,
                weeklyPercent: newActiveProfile.weeklyPercent,
                sessionResetTimestamp: newActiveProfile.sessionResetTimestamp,
                weeklyResetTimestamp: newActiveProfile.weeklyResetTimestamp,
                fetchedAt: allProfilesUsage.fetchedAt,
                needsReauthentication: newActiveProfile.needsReauthentication,
              };
              usageMonitor.emit('usage-updated', newActiveUsage);
            }
            // Also emit all-profiles-usage-updated for the other profiles list
            usageMonitor.emit('all-profiles-usage-updated', allProfilesUsage);
          }
        }).catch((err) => {
          console.warn('[RateLimitDetector] Failed to refresh usage after swap:', err);
        });
      } catch (err) {
        // Usage monitor may not be initialized yet, that's OK
        console.warn('[RateLimitDetector] Could not trigger usage refresh:', err);
      }

      const profileEnv = profileManager.getProfileEnv(bestProfile.id);

      return {
        env: ensureCleanProfileEnv(profileEnv),
        profileId: bestProfile.id,
        profileName: bestProfile.name,
        wasSwapped: true,
        swapReason,
        originalProfile: {
          id: activeProfile.id,
          name: activeProfile.name
        }
      };
    } else {
      if (process.env.DEBUG === 'true') {
        console.warn('[RateLimitDetector] No alternative profile available, using rate-limited/at-capacity profile');
      }
    }
  }

  // Use active profile (either it's fine, or no better alternative exists)
  const activeEnv = profileManager.getActiveProfileEnv();
  return {
    env: ensureCleanProfileEnv(activeEnv),
    profileId: activeProfile.id,
    profileName: activeProfile.name,
    wasSwapped: false
  };
}

/**
 * Ensure the profile environment is clean for subprocess invocation.
 *
 * When CLAUDE_CONFIG_DIR is set, we MUST clear CLAUDE_CODE_OAUTH_TOKEN to prevent
 * the Claude Agent SDK from using a hardcoded/cached token (e.g., from .env file)
 * instead of reading fresh credentials from the specified config directory.
 *
 * This is critical for multi-account switching: when switching from a rate-limited
 * account to an available one, the subprocess must use the new account's credentials.
 *
 * @param env - Profile environment from getProfileEnv() or getActiveProfileEnv()
 * @returns Environment with CLAUDE_CODE_OAUTH_TOKEN cleared if CLAUDE_CONFIG_DIR is set
 */
function ensureCleanProfileEnv(env: Record<string, string>): Record<string, string> {
  if (env.CLAUDE_CONFIG_DIR) {
    // Clear CLAUDE_CODE_OAUTH_TOKEN to ensure SDK uses credentials from CLAUDE_CONFIG_DIR
    return {
      ...env,
      CLAUDE_CODE_OAUTH_TOKEN: ''
    };
  }
  return env;
}

/**
 * Get the active Claude profile ID
 */
export function getActiveProfileId(): string {
  return getClaudeProfileManager().getActiveProfile().id;
}

/**
 * Information about a rate limit event for the UI
 */
export interface SDKRateLimitInfo {
  /** Source of the rate limit (which feature hit it) */
  source: 'changelog' | 'task' | 'roadmap' | 'ideation' | 'title-generator' | 'other';
  /** Project ID if applicable */
  projectId?: string;
  /** Task ID if applicable */
  taskId?: string;
  /** The reset time string */
  resetTime?: string;
  /** Type of limit */
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

  // Auto-swap information
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
 * Create SDK rate limit info object for emitting to UI
 */
export function createSDKRateLimitInfo(
  source: SDKRateLimitInfo['source'],
  detection: RateLimitDetectionResult,
  options?: {
    projectId?: string;
    taskId?: string;
  }
): SDKRateLimitInfo {
  const profileManager = getClaudeProfileManager();
  const profile = detection.profileId
    ? profileManager.getProfile(detection.profileId)
    : profileManager.getActiveProfile();

  return {
    source,
    projectId: options?.projectId,
    taskId: options?.taskId,
    resetTime: detection.resetTime,
    limitType: detection.limitType,
    profileId: detection.profileId || profileManager.getActiveProfile().id,
    profileName: profile?.name,
    suggestedProfile: detection.suggestedProfile,
    detectedAt: new Date(),
    originalError: detection.originalError
  };
}
