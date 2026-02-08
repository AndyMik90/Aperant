/**
 * Rate limit detection utility for Claude CLI/SDK calls.
 * Detects rate limit errors in stdout/stderr output and provides context.
 */

import { getClaudeProfileManager } from './claude-profile-manager';

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
 */
const AUTH_FAILURE_PATTERNS = [
  /authentication\s*(is\s*)?required/i,
  /not\s*(yet\s*)?authenticated/i,
  /login\s*(is\s*)?required/i,
  /oauth\s*token\s*(is\s*)?(invalid|expired|missing)/i,
  /unauthorized/i,
  /please\s*(log\s*in|login|authenticate)/i,
  /invalid\s*(credentials|token|api\s*key)/i,
  /auth(entication)?\s*(failed|error|failure)/i,
  /session\s*(expired|invalid)/i,
  /access\s*denied/i,
  /permission\s*denied/i,
  /401\s*unauthorized/i,
  /credentials\s*(are\s*)?(missing|invalid|expired)/i
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
  if (/expired|session\s*expired/.test(lowerOutput)) {
    return 'expired';
  }
  if (/invalid|unauthorized|denied/.test(lowerOutput)) {
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
 * Uses OAuth token (CLAUDE_CODE_OAUTH_TOKEN) if available, otherwise falls back to CLAUDE_CONFIG_DIR.
 * OAuth tokens are preferred as they provide instant, reliable profile switching.
 * Note: Tokens are decrypted automatically by the profile manager.
 */
export function getProfileEnv(profileId?: string): Record<string, string> {
  const profileManager = getClaudeProfileManager();
  const profile = profileId
    ? profileManager.getProfile(profileId)
    : profileManager.getActiveProfile();

  console.warn('[getProfileEnv] Active profile:', {
    profileId: profile?.id,
    profileName: profile?.name,
    email: profile?.email,
    isDefault: profile?.isDefault,
    hasOAuthToken: !!profile?.oauthToken,
    configDir: profile?.configDir
  });

  if (!profile) {
    console.warn('[getProfileEnv] No profile found, using defaults');
    return {};
  }

  // Prefer OAuth token (instant switching, no browser auth needed)
  // Use profile manager to get decrypted token
  if (profile.oauthToken) {
    const decryptedToken = profileId
      ? profileManager.getProfileToken(profileId)
      : profileManager.getActiveProfileToken();

    if (decryptedToken) {
      console.warn('[getProfileEnv] Using OAuth token for profile:', profile.name);
      return {
        CLAUDE_CODE_OAUTH_TOKEN: decryptedToken
      };
    } else {
      console.error('[getProfileEnv] Failed to decrypt OAuth token for profile:', profile.name,
        '— token exists but decryption returned empty. Re-authenticate to fix.');
    }
  }

  // FIX: For default profile, also try getActiveProfileEnv() which handles
  // token decryption via the profile manager. Previously this returned {}
  // and relied on the Python backend to find the token from the keychain,
  // which fails when the keychain entry format doesn't match expectations.
  if (profile.isDefault) {
    // Try the profile manager's own env method which handles decryption
    const profileManagerEnv = profileManager.getActiveProfileEnv();
    if (profileManagerEnv.CLAUDE_CODE_OAUTH_TOKEN) {
      console.warn('[getProfileEnv] Using token from profile manager for default profile');
      return profileManagerEnv;
    }
    console.warn('[getProfileEnv] Default profile has no usable token — backend will attempt keychain fallback');
    return {};
  }

  // Fallback: Use configDir for profiles without OAuth token (legacy)
  if (profile.configDir) {
    console.warn('[getProfileEnv] Using configDir fallback for profile:', profile.name);
    console.warn('[getProfileEnv] WARNING: Profile has no OAuth token. Run "claude setup-token" and save the token to enable instant switching.');
    return {
      CLAUDE_CONFIG_DIR: profile.configDir
    };
  }

  console.warn('[getProfileEnv] Profile has no auth method configured');
  return {};
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
