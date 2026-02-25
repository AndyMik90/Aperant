/**
 * OAuth Token Refresh Module
 *
 * Handles automatic token refresh for Claude Code OAuth tokens.
 * Supports proactive refresh (before expiry) and reactive refresh (on 401 errors).
 *
 * CRITICAL: When a token is refreshed, the old token is IMMEDIATELY REVOKED by Anthropic.
 * Therefore, new tokens must be written back to the credential store immediately.
 *
 * Verified endpoint:
 * POST https://console.anthropic.com/v1/oauth/token
 * Content-Type: application/x-www-form-urlencoded
 * Body: grant_type=refresh_token&refresh_token=sk-ant-ort01-...&client_id=<CLIENT_ID>
 * Response: { access_token, refresh_token, expires_in: 28800, token_type: "Bearer" }
 */

import { homedir } from 'os';
import {
  getFullCredentialsFromKeychain,
  updateKeychainCredentials,
  clearKeychainCache,
} from './credential-utils';

// =============================================================================
// Constants
// =============================================================================

/**
 * Anthropic OAuth token endpoint
 */
const ANTHROPIC_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';

/**
 * Claude Code OAuth client ID (public - same for all Claude Code installations)
 * This is the official client ID used by Claude Code CLI
 */
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

/**
 * Proactive refresh threshold: refresh tokens 30 minutes before expiry
 * This provides a buffer to handle network issues and ensures tokens are
 * always valid when needed for autonomous overnight operation.
 */
const PROACTIVE_REFRESH_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maximum retry attempts for token refresh
 */
const MAX_REFRESH_RETRIES = 2;

/**
 * Delay between retry attempts (exponential backoff base)
 */
const RETRY_DELAY_BASE_MS = 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a token refresh operation
 */
export interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix timestamp in ms
  expiresIn?: number;  // Seconds until expiry
  error?: string;
  errorCode?: string;  // 'invalid_grant', 'invalid_client', 'network_error', etc.
}

/**
 * Result of ensuring a valid token
 */
export interface EnsureValidTokenResult {
  token: string | null;
  wasRefreshed: boolean;
  error?: string;
  errorCode?: string;  // 'invalid_grant', 'invalid_client', 'network_error', etc.
  /**
   * True if token was refreshed but failed to persist to keychain.
   * The token is valid for this session but will be lost on restart.
   * Callers should alert the user to re-authenticate.
   */
  persistenceFailed?: boolean;
}

/**
 * Callback for when tokens are refreshed
 */
export type OnTokenRefreshedCallback = (
  configDir: string | undefined,
  newAccessToken: string,
  newRefreshToken: string,
  expiresAt: number
) => void;

// =============================================================================
// Token Expiry Detection
// =============================================================================

/**
 * Check if a token is expired or near expiry.
 *
 * @param expiresAt - Unix timestamp in ms when the token expires, or null if unknown
 * @param thresholdMs - How far before expiry to consider "near expiry" (default: 30 minutes)
 * @returns true if token is expired or will expire within the threshold
 */
export function isTokenExpiredOrNearExpiry(
  expiresAt: number | null,
  thresholdMs: number = PROACTIVE_REFRESH_THRESHOLD_MS
): boolean {
  // If we don't know the expiry time, assume it might be expired
  // This is safer than assuming it's valid
  if (expiresAt === null) {
    return true;
  }

  const now = Date.now();
  const expiryThreshold = expiresAt - thresholdMs;

  return now >= expiryThreshold;
}

/**
 * Get time remaining until token expiry.
 *
 * @param expiresAt - Unix timestamp in ms when the token expires
 * @returns Time remaining in ms, or null if expiresAt is null
 */
export function getTimeUntilExpiry(expiresAt: number | null): number | null {
  if (expiresAt === null) return null;
  return Math.max(0, expiresAt - Date.now());
}

/**
 * Format time remaining for logging
 */
export function formatTimeRemaining(ms: number | null): string {
  if (ms === null) return 'unknown';
  if (ms <= 0) return 'expired';

  const minutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

// =============================================================================
// Token Refresh
// =============================================================================

/**
 * Refresh an OAuth token using the refresh_token grant type.
 *
 * CRITICAL: After a successful refresh, the old access token AND refresh token are REVOKED.
 * The new tokens must be stored immediately.
 *
 * @param refreshToken - The refresh token to use
 * @param configDir - Optional config directory for the profile (used to clear cache on error)
 * @returns Result containing new tokens or error information
 */
export async function refreshOAuthToken(
  refreshToken: string,
  configDir?: string
): Promise<TokenRefreshResult> {
  const isDebug = process.env.DEBUG === 'true';

  if (isDebug) {
    // Reduce fingerprint to fewer characters to minimize information exposure
    // Show only first 4 and last 2 characters for debugging purposes
    console.warn('[TokenRefresh] Starting token refresh', {
      refreshTokenFingerprint: refreshToken ? `${refreshToken.slice(0, 4)}...${refreshToken.slice(-2)}` : 'null'
    });
  }

  if (!refreshToken) {
    return {
      success: false,
      error: 'No refresh token provided',
      errorCode: 'missing_refresh_token'
    };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff between retries
      const delay = RETRY_DELAY_BASE_MS * 2 ** (attempt - 1);
      if (isDebug) {
        console.warn('[TokenRefresh] Retrying after delay:', delay, 'ms (attempt', attempt + 1, ')');
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      // Build form-urlencoded body
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_CODE_CLIENT_ID
      });

      const response = await fetch(ANTHROPIC_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        let errorData: Record<string, string> = {};
        try {
          errorData = await response.json();
        } catch {
          // Ignore JSON parse errors
        }

        const errorCode = errorData.error || `http_${response.status}`;
        const errorDescription = errorData.error_description || response.statusText;

        // Check for permanent errors that shouldn't be retried
        if (errorCode === 'invalid_grant' || errorCode === 'invalid_client') {
          console.error('[TokenRefresh] Permanent error - refresh token invalid:', {
            errorCode,
            errorDescription
          });

          // Clear credential cache to ensure stale tokens aren't reused
          // This prevents infinite loops where cached invalid tokens are repeatedly used
          clearKeychainCache(configDir);

          return {
            success: false,
            error: `Token refresh failed: ${errorDescription}`,
            errorCode
          };
        }

        // Temporary errors - continue to retry
        lastError = new Error(`HTTP ${response.status}: ${errorDescription}`);
        if (isDebug) {
          console.warn('[TokenRefresh] Temporary error, will retry:', lastError.message);
        }
        continue;
      }

      // Parse successful response
      const data = await response.json();

      if (!data.access_token) {
        return {
          success: false,
          error: 'Response missing access_token',
          errorCode: 'invalid_response'
        };
      }

      // Calculate expiry timestamp
      // expires_in is in seconds, convert to ms and add to current time
      const expiresIn = data.expires_in || 28800; // Default 8 hours if not provided
      const expiresAt = Date.now() + (expiresIn * 1000);

      if (isDebug) {
        console.warn('[TokenRefresh] Token refresh successful', {
          newTokenFingerprint: `${data.access_token.slice(0, 12)}...${data.access_token.slice(-4)}`,
          expiresIn: expiresIn,
          expiresAt: new Date(expiresAt).toISOString()
        });
      }

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        expiresIn
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isDebug) {
        console.warn('[TokenRefresh] Network error, will retry:', lastError.message);
      }
    }
  }

  // All retries exhausted
  console.error('[TokenRefresh] All retry attempts failed');
  return {
    success: false,
    error: lastError?.message || 'Token refresh failed after retries',
    errorCode: 'network_error'
  };
}

// =============================================================================
// Integrated Token Validation and Refresh
// =============================================================================

/**
 * Ensure a valid token is available, refreshing if necessary.
 *
 * This function:
 * 1. Reads credentials from keychain
 * 2. Checks if token is expired or near expiry
 * 3. If needed, refreshes the token and writes back to keychain
 * 4. Returns a valid token
 *
 * @param configDir - Config directory for the profile (can be undefined for default profile)
 * @param onRefreshed - Optional callback when tokens are refreshed
 * @returns Valid token or null with error information
 */
export async function ensureValidToken(
  configDir: string | undefined,
  onRefreshed?: OnTokenRefreshedCallback
): Promise<EnsureValidTokenResult> {
  const isDebug = process.env.DEBUG === 'true';

  // Expand ~ in configDir if present
  const expandedConfigDir = configDir?.startsWith('~')
    ? configDir.replace(/^~/, homedir())
    : configDir;

  if (isDebug) {
    console.warn('[TokenRefresh:ensureValidToken] Checking token validity', {
      configDir: expandedConfigDir || 'default'
    });
  }

  // Step 1: Read full credentials from keychain
  const creds = getFullCredentialsFromKeychain(expandedConfigDir);

  if (creds.error) {
    return {
      token: null,
      wasRefreshed: false,
      error: `Failed to read credentials: ${creds.error}`
    };
  }

  if (!creds.token) {
    return {
      token: null,
      wasRefreshed: false,
      error: 'No access token found in credentials',
      errorCode: 'missing_credentials'
    };
  }

  // Step 2: Check if token is expired or near expiry
  const needsRefresh = isTokenExpiredOrNearExpiry(creds.expiresAt);

  if (!needsRefresh) {
    if (isDebug) {
      console.warn('[TokenRefresh:ensureValidToken] Token is valid', {
        timeRemaining: formatTimeRemaining(getTimeUntilExpiry(creds.expiresAt))
      });
    }
    return {
      token: creds.token,
      wasRefreshed: false
    };
  }

  if (isDebug) {
    console.warn('[TokenRefresh:ensureValidToken] Token needs refresh', {
      expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'unknown',
      hasRefreshToken: !!creds.refreshToken
    });
  }

  // Step 3: Check if we have a refresh token
  if (!creds.refreshToken) {
    // Can't refresh - return existing token and let caller handle potential 401
    if (isDebug) {
      console.warn('[TokenRefresh:ensureValidToken] No refresh token available, returning existing token');
    }
    return {
      token: creds.token,
      wasRefreshed: false,
      error: 'Token expired but no refresh token available'
    };
  }

  // Step 4: Refresh the token
  const refreshResult = await refreshOAuthToken(creds.refreshToken, expandedConfigDir);

  if (!refreshResult.success || !refreshResult.accessToken || !refreshResult.refreshToken || !refreshResult.expiresAt) {
    console.error('[TokenRefresh:ensureValidToken] Token refresh failed:', refreshResult.error);

    // Check for permanent errors (revoked/invalid tokens)
    const isPermanentError = refreshResult.errorCode === 'invalid_grant' ||
                             refreshResult.errorCode === 'invalid_client';

    if (isPermanentError) {
      // Return null for permanent errors to prevent infinite 401 loops
      console.error('[TokenRefresh:ensureValidToken] Permanent error detected, returning null token');
      return {
        token: null,
        wasRefreshed: false,
        error: `Token refresh failed: ${refreshResult.error}`,
        errorCode: refreshResult.errorCode
      };
    }

    // For transient errors (network issues, etc.), return old token as best-effort fallback
    return {
      token: creds.token,
      wasRefreshed: false,
      error: `Token refresh failed: ${refreshResult.error}`,
      errorCode: refreshResult.errorCode
    };
  }

  // Step 5: CRITICAL - Write new tokens to keychain immediately
  // The old token is now REVOKED, so we must persist the new one
  const updateResult = updateKeychainCredentials(expandedConfigDir, {
    accessToken: refreshResult.accessToken,
    refreshToken: refreshResult.refreshToken,
    expiresAt: refreshResult.expiresAt,
    scopes: creds.scopes || undefined
  });

  // Track if persistence failed - callers can alert user to re-authenticate
  let persistenceFailed = false;

  if (!updateResult.success) {
    // This is a critical error - we have new tokens but can't persist them
    console.error('[TokenRefresh:ensureValidToken] CRITICAL: Failed to persist refreshed tokens:', updateResult.error);
    console.error('[TokenRefresh:ensureValidToken] The new token will be lost on next restart!');
    console.error('[TokenRefresh:ensureValidToken] Old credentials in keychain are now REVOKED and must be cleared on restart');
    persistenceFailed = true;

    // Clear credential cache immediately to prevent serving revoked tokens from cache
    // On restart, the revoked tokens will trigger re-authentication via Bugs #3 and #4 fixes
    clearKeychainCache(expandedConfigDir);
    // Still return the new token for this session
  } else {
    if (isDebug) {
      console.warn('[TokenRefresh:ensureValidToken] Successfully refreshed and persisted token', {
        newExpiresAt: new Date(refreshResult.expiresAt).toISOString()
      });
    }
  }

  // Step 6: Clear the credential cache so next read gets fresh data
  clearKeychainCache(expandedConfigDir);

  // Step 7: Call the callback if provided
  if (onRefreshed) {
    onRefreshed(
      expandedConfigDir,
      refreshResult.accessToken,
      refreshResult.refreshToken,
      refreshResult.expiresAt
    );
  }

  return {
    token: refreshResult.accessToken,
    wasRefreshed: true,
    ...(persistenceFailed && { persistenceFailed: true })
  };
}

/**
 * Perform a reactive token refresh (called on 401 error).
 *
 * This is similar to ensureValidToken but:
 * - Doesn't check expiry (we know the token is invalid)
 * - Forces a refresh regardless of apparent token state
 *
 * @param configDir - Config directory for the profile
 * @param onRefreshed - Optional callback when tokens are refreshed
 * @returns New token or null with error information
 */
export async function reactiveTokenRefresh(
  configDir: string | undefined,
  onRefreshed?: OnTokenRefreshedCallback
): Promise<EnsureValidTokenResult> {
  const isDebug = process.env.DEBUG === 'true';

  const expandedConfigDir = configDir?.startsWith('~')
    ? configDir.replace(/^~/, homedir())
    : configDir;

  if (isDebug) {
    console.warn('[TokenRefresh:reactive] Performing reactive token refresh (401 received)', {
      configDir: expandedConfigDir || 'default'
    });
  }

  // Read credentials to get refresh token
  const creds = getFullCredentialsFromKeychain(expandedConfigDir);

  if (creds.error) {
    return {
      token: null,
      wasRefreshed: false,
      error: `Failed to read credentials: ${creds.error}`
    };
  }

  if (!creds.refreshToken) {
    return {
      token: null,
      wasRefreshed: false,
      error: 'No refresh token available for reactive refresh'
    };
  }

  // Perform refresh
  const refreshResult = await refreshOAuthToken(creds.refreshToken, expandedConfigDir);

  if (!refreshResult.success || !refreshResult.accessToken || !refreshResult.refreshToken || !refreshResult.expiresAt) {
    return {
      token: null,
      wasRefreshed: false,
      error: `Reactive refresh failed: ${refreshResult.error}`,
      errorCode: refreshResult.errorCode
    };
  }

  // Write new tokens to keychain
  const updateResult = updateKeychainCredentials(expandedConfigDir, {
    accessToken: refreshResult.accessToken,
    refreshToken: refreshResult.refreshToken,
    expiresAt: refreshResult.expiresAt,
    scopes: creds.scopes || undefined
  });

  // Track if persistence failed - callers can alert user to re-authenticate
  let persistenceFailed = false;
  if (!updateResult.success) {
    console.error('[TokenRefresh:reactive] CRITICAL: Failed to persist refreshed tokens:', updateResult.error);
    console.error('[TokenRefresh:reactive] Old credentials in keychain are now REVOKED and must be cleared on restart');
    persistenceFailed = true;

    // Clear credential cache immediately to prevent serving revoked tokens from cache
    // On restart, the revoked tokens will trigger re-authentication via Bugs #3 and #4 fixes
    clearKeychainCache(expandedConfigDir);
  }

  // Also clear cache on success to ensure fresh data is loaded next time
  clearKeychainCache(expandedConfigDir);

  if (onRefreshed) {
    onRefreshed(
      expandedConfigDir,
      refreshResult.accessToken,
      refreshResult.refreshToken,
      refreshResult.expiresAt
    );
  }

  if (isDebug) {
    console.warn('[TokenRefresh:reactive] Reactive refresh successful');
  }

  return {
    token: refreshResult.accessToken,
    wasRefreshed: true,
    ...(persistenceFailed && { persistenceFailed: true })
  };
}
