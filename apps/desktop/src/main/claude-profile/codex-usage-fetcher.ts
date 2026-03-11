import type { ClaudeUsageSnapshot } from '../../shared/types/agent';

// =============================================================================
// Constants
// =============================================================================

const CODEX_USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

// =============================================================================
// Types
// =============================================================================

export interface CodexRateWindow {
  used_percent: number; // 0-100 integer (e.g., 96 = 96%)
  limit_window_seconds: number;
  reset_at: number; // Unix timestamp in seconds
  reset_after_seconds: number;
}

export interface CodexUsageResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexRateWindow;
    secondary_window?: CodexRateWindow | null;
  };
  credits?: unknown;
}

// =============================================================================
// API Fetch
// =============================================================================

/**
 * Fetch Codex usage from the wham/usage API.
 * Returns raw response or null on failure.
 *
 * Auth errors (401/403) are re-thrown so callers can handle reauthentication.
 */
export async function fetchCodexUsage(
  accessToken: string,
  accountId?: string,
): Promise<CodexUsageResponse | null> {
  // CodeQL: file data in outbound request - validate token is a non-empty string before use in Authorization header
  const safeToken = typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : '';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${safeToken}`,
    'Content-Type': 'application/json',
  };
  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(CODEX_USAGE_ENDPOINT, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const error = new Error(`Codex API Auth Failure: ${response.status}`);
        (error as NodeJS.ErrnoException & { statusCode?: number }).statusCode = response.status;
        throw error;
      }
      console.error('[CodexUsageFetcher] API error:', response.status, response.statusText);
      return null;
    }

    return (await response.json()) as CodexUsageResponse;
  } catch (error) {
    // Re-throw auth errors so callers can handle reauthentication
    const statusCode = (error as NodeJS.ErrnoException & { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      throw error;
    }
    console.error('[CodexUsageFetcher] Fetch failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// Response Normalization
// =============================================================================

/**
 * Normalize Codex usage response to ClaudeUsageSnapshot.
 * Maps primary_window → session (~5h), secondary_window → weekly.
 */
export function normalizeCodexResponse(
  data: CodexUsageResponse,
  profileId: string,
  profileName: string,
  profileEmail?: string,
): ClaudeUsageSnapshot {
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;

  // used_percent is already 0-100 integer from the API (e.g., 96 = 96%)
  const sessionPercent = primary
    ? Math.min(100, Math.max(0, Math.round(primary.used_percent)))
    : 0;
  const weeklyPercent = secondary
    ? Math.min(100, Math.max(0, Math.round(secondary.used_percent)))
    : 0;

  // Convert Unix timestamp (seconds) to ISO 8601 string for ClaudeUsageSnapshot
  const toISO = (ts: number | undefined): string | undefined => {
    if (!ts) return undefined;
    return new Date(ts * 1000).toISOString();
  };

  // Determine which limit is more constraining
  const limitType: 'session' | 'weekly' | undefined =
    sessionPercent >= 95 ? 'session' : weeklyPercent >= 95 ? 'weekly' : undefined;

  // Use email from the API response if available
  const resolvedEmail = profileEmail ?? data.email;

  return {
    profileId,
    profileName,
    profileEmail: resolvedEmail,
    sessionPercent,
    weeklyPercent,
    sessionResetTimestamp: toISO(primary?.reset_at),
    weeklyResetTimestamp: toISO(secondary?.reset_at),
    fetchedAt: new Date(),
    limitType,
    needsReauthentication: false,
  };
}

// =============================================================================
// JWT Utilities
// =============================================================================

/**
 * Extract account ID from a Codex JWT access token.
 *
 * The JWT payload typically contains a `chatgpt_account_id` or `account_id`
 * field for team accounts. Returns undefined if extraction fails — non-critical
 * because the endpoint works without it for personal accounts.
 */
export function getCodexAccountId(accessToken: string): string | undefined {
  try {
    // JWT is three base64url-encoded parts separated by dots
    const parts = accessToken.split('.');
    if (parts.length !== 3) return undefined;

    // Decode the payload (second part)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<
      string,
      unknown
    >;

    const id = payload.chatgpt_account_id ?? payload.account_id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    // JWT decode failed — non-critical
    return undefined;
  }
}
