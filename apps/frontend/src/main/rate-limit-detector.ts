/**
 * Rate limit detection utility for Claude CLI/SDK calls.
 * Detects rate limit errors in stdout/stderr output and provides context.
 */

import { getClaudeProfileManager } from './claude-profile-manager';
import { getUsageMonitor } from './claude-profile/usage-monitor';
import { debugLog } from '../shared/utils/debug-logger';

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
 * Patterns that indicate billing/credit failures
 * These patterns detect when Claude API fails due to insufficient credits or billing issues
 */
const BILLING_FAILURE_PATTERNS = [
  // Credit balance patterns
  /credit\s*balance\s*(is\s+)?(too\s+)?(insufficient|low|empty|zero|exhausted)/i,
  /insufficient\s*credit(s)?/i,
  /no\s*(remaining\s*)?credit(s)?/i,
  /credit(s)?\s*(are\s*)?(exhausted|depleted|used\s*up)/i,
  /out\s*of\s*credit(s)?/i,
  /credit\s*limit\s*(reached|exceeded)/i,
  // Billing error patterns
  /billing\s*(error|issue|problem|failure)/i,
  /payment\s*(required|failed|issue|problem)/i,
  /subscription\s*(expired|inactive|cancelled|canceled)/i,
  /account\s*(suspended|inactive)\s*(due\s*to\s*billing)?/i,
  // Usage limit patterns (billing-related, not rate limits)
  /usage\s*quota\s*(exceeded|reached)/i,
  /monthly\s*(usage\s*)?(limit|quota)\s*(exceeded|reached)/i,
  /plan\s*(limit|quota)\s*(exceeded|reached)/i,
  // API error patterns for billing
  /["']?type["']?\s*:\s*["']?billing_error["']?/i,
  /["']?type["']?\s*:\s*["']?insufficient_credits["']?/i,
  /["']?error["']?\s*:\s*["']?insufficient_credits["']?/i,
  // extra_usage patterns from Claude API
  /extra_usage\s*(exceeded|limit|error)?/i,
  // Match HTTP 402 Payment Required (require context to avoid false positives on "line 402" etc.)
  /(?:HTTP|status|code|error)\s*:?\s*402\b/i,
  /\b402\s+payment\s+required/i,
  /API\s*Error:\s*402/i,
  // Balance/funds patterns
  /insufficient\s*(funds|balance)/i,
  /balance\s*(is\s*)?(zero|empty|insufficient)/i,
  // Add funds/credits messages
  /please\s*(add|purchase)\s*(more\s*)?(credits?|funds)/i,
  /top\s*up\s*(your\s*)?(account|credits|balance)/i
];

/**
 * Maximum length for error messages sent to renderer.
 * Truncates to prevent exposing excessive internal details.
 */
const MAX_ERROR_LENGTH = 500;

/**
 * Sanitize error output before sending to renderer.
 * Truncates long output to prevent exposing excessive internal details
 * like full paths, API responses, or stack traces.
 */
function sanitizeErrorOutput(output: string): string {
  // Truncate long output to limit exposure of internal details
  if (output.length > MAX_ERROR_LENGTH) {
    return output.substring(0, MAX_ERROR_LENGTH) + '... (truncated)';
  }
  return output;
}

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
  /** Original error message (truncated to 500 chars for security) */
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
 * Result of billing failure detection
 */
export interface BillingFailureDetectionResult {
  /** Whether a billing failure was detected */
  isBillingFailure: boolean;
  /** The profile ID that has billing issues (if known) */
  profileId?: string;
  /** The type of billing failure detected */
  failureType?: 'insufficient_credits' | 'payment_required' | 'subscription_inactive' | 'unknown';
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
      originalError: sanitizeErrorOutput(output)
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
        originalError: sanitizeErrorOutput(output)
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
    default:
      return 'Claude authentication failed. Please verify your authentication in Settings > Claude Profiles.';
  }
}

/**
 * Classify the type of billing failure based on the error message
 */
function classifyBillingFailureType(output: string): 'insufficient_credits' | 'payment_required' | 'subscription_inactive' | 'unknown' {
  const lowerOutput = output.toLowerCase();

  // Check for credit-related failures (including extra_usage which indicates usage exhaustion)
  if (/credit\s*(balance|s)?|insufficient\s*(credit|funds|balance)|out\s*of\s*credit|no\s*(remaining\s*)?credit|extra_usage/.test(lowerOutput)) {
    return 'insufficient_credits';
  }
  // Check for subscription-related failures
  if (/subscription\s*(expired|inactive|cancelled|canceled)|account\s*(suspended|inactive)/.test(lowerOutput)) {
    return 'subscription_inactive';
  }
  // Check for payment-related failures
  if (/payment\s*(required|failed)|402|billing\s*(error|issue|problem|failure)/.test(lowerOutput)) {
    return 'payment_required';
  }
  return 'unknown';
}

/**
 * Get a user-friendly message for the billing failure
 */
function getBillingFailureMessage(failureType: 'insufficient_credits' | 'payment_required' | 'subscription_inactive' | 'unknown'): string {
  switch (failureType) {
    case 'insufficient_credits':
      return 'Your Claude API credit balance is too low. Please add credits to your account or switch to another profile in Settings > Claude Profiles.';
    case 'payment_required':
      return 'A billing error occurred with your Claude API account. Please check your payment method or switch to another profile in Settings > Claude Profiles.';
    case 'subscription_inactive':
      return 'Your Claude API subscription is inactive or expired. Please renew your subscription or switch to another profile in Settings > Claude Profiles.';
    default:
      return 'A billing issue was detected with your Claude API account. Please check your account status or switch to another profile in Settings > Claude Profiles.';
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
        originalError: sanitizeErrorOutput(output)
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
 * Detect billing failure from output (stdout + stderr combined)
 */
export function detectBillingFailure(
  output: string,
  profileId?: string
): BillingFailureDetectionResult {
  // First, make sure this isn't a rate limit or auth error (those should be handled separately)
  if (detectRateLimit(output).isRateLimited) {
    return { isBillingFailure: false };
  }
  if (detectAuthFailure(output).isAuthFailure) {
    return { isBillingFailure: false };
  }

  // Check for billing failure patterns
  for (const pattern of BILLING_FAILURE_PATTERNS) {
    if (pattern.test(output)) {
      const profileManager = getClaudeProfileManager();
      const effectiveProfileId = profileId || profileManager.getActiveProfile().id;
      const failureType = classifyBillingFailureType(output);

      return {
        isBillingFailure: true,
        profileId: effectiveProfileId,
        failureType,
        message: getBillingFailureMessage(failureType),
        originalError: sanitizeErrorOutput(output)
      };
    }
  }

  return { isBillingFailure: false };
}

/**
 * Check if output contains billing failure error
 */
export function isBillingFailureError(output: string): boolean {
  return detectBillingFailure(output).isBillingFailure;
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

  debugLog('[RateLimitDetector] getBestAvailableProfileEnv() called:', {
    activeProfileId: activeProfile.id,
    activeProfileName: activeProfile.name,
    hasConfigDir: !!activeProfile.configDir,
    configDir: activeProfile.configDir,
    weeklyUsagePercent: activeProfile.usage?.weeklyUsagePercent,
  });

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
    debugLog('[RateLimitDetector] Active profile needs swap:', {
      activeProfile: activeProfile.name,
      isRateLimited: rateLimitStatus.limited,
      isAtCapacity,
      weeklyUsage: activeProfile.usage?.weeklyUsagePercent,
      limitType: rateLimitStatus.type,
      resetAt: rateLimitStatus.resetAt
    });

    // Try to find a better profile
    const bestProfile = profileManager.getBestAvailableProfile(activeProfile.id);

    if (bestProfile) {
      debugLog('[RateLimitDetector] Using alternative profile:', {
        originalProfile: activeProfile.name,
        alternativeProfile: bestProfile.name,
        reason: swapReason
      });

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

      debugLog('[RateLimitDetector] Profile env for swapped profile:', {
        profileId: bestProfile.id,
        hasClaudeConfigDir: !!profileEnv.CLAUDE_CONFIG_DIR,
        claudeConfigDir: profileEnv.CLAUDE_CONFIG_DIR,
        hasOAuthToken: !!profileEnv.CLAUDE_CODE_OAUTH_TOKEN,
        envKeys: Object.keys(profileEnv),
      });

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
      debugLog('[RateLimitDetector] No alternative profile available, using rate-limited/at-capacity profile');
    }
  }

  // Use active profile (either it's fine, or no better alternative exists)
  const activeEnv = profileManager.getActiveProfileEnv();

  debugLog('[RateLimitDetector] Using active profile env (no swap):', {
    profileId: activeProfile.id,
    hasClaudeConfigDir: !!activeEnv.CLAUDE_CONFIG_DIR,
    claudeConfigDir: activeEnv.CLAUDE_CONFIG_DIR,
    hasOAuthToken: !!activeEnv.CLAUDE_CODE_OAUTH_TOKEN,
    envKeys: Object.keys(activeEnv),
  });

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
 * When CLAUDE_CONFIG_DIR is set, we MUST clear both CLAUDE_CODE_OAUTH_TOKEN and
 * ANTHROPIC_API_KEY to prevent the Claude Agent SDK from using hardcoded/cached
 * tokens or API keys (e.g., from .env file or shell environment) instead of reading
 * fresh credentials from the specified config directory.
 *
 * ANTHROPIC_API_KEY is cleared to prevent Claude Code from using API keys present
 * in the shell environment, which would cause it to show "Claude API" instead of
 * "Claude Max" and bypass the intended config dir credentials.
 *
 * This is critical for multi-account switching: when switching from a rate-limited
 * account to an available one, the subprocess must use the new account's credentials.
 *
 * Also warns if the profile env is empty, which indicates a misconfigured profile.
 *
 * @param env - Profile environment from getProfileEnv() or getActiveProfileEnv()
 * @returns Environment with CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY cleared if CLAUDE_CONFIG_DIR is set
 */
export function ensureCleanProfileEnv(env: Record<string, string>): Record<string, string> {
  debugLog('[RateLimitDetector] ensureCleanProfileEnv() input:', {
    hasClaudeConfigDir: !!env.CLAUDE_CONFIG_DIR,
    claudeConfigDir: env.CLAUDE_CONFIG_DIR,
    hasOAuthToken: !!env.CLAUDE_CODE_OAUTH_TOKEN,
    willClearOAuthToken: !!env.CLAUDE_CONFIG_DIR,
    willClearApiKey: !!env.CLAUDE_CONFIG_DIR,
  });

  // Warn if the profile environment is empty — this likely indicates a misconfigured profile
  if (Object.keys(env).length === 0) {
    console.warn('[RateLimitDetector] ensureCleanProfileEnv() received empty profile env — profile may be misconfigured');
  }

  if (env.CLAUDE_CONFIG_DIR) {
    // Clear CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY to ensure SDK uses credentials from CLAUDE_CONFIG_DIR
    // ANTHROPIC_API_KEY must also be cleared to prevent Claude Code from using
    // API keys that may be present in the shell environment instead of the config dir credentials.
    const cleanedEnv = {
      ...env,
      CLAUDE_CODE_OAUTH_TOKEN: '',
      ANTHROPIC_API_KEY: ''
    };

    debugLog('[RateLimitDetector] ensureCleanProfileEnv() output:', {
      claudeConfigDirPreserved: 'CLAUDE_CONFIG_DIR' in cleanedEnv,
      claudeConfigDir: (cleanedEnv as Record<string, string>).CLAUDE_CONFIG_DIR,
      oauthTokenCleared: cleanedEnv.CLAUDE_CODE_OAUTH_TOKEN === '',
      envKeys: Object.keys(cleanedEnv),
    });

    return cleanedEnv;
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
  /** Original error message (truncated to 500 chars for security) */
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
