/**
 * GitHub API error parser utility.
 * Parses raw error strings to classify GitHub API errors and extract metadata.
 */

import type { GitHubErrorType, GitHubErrorInfo } from '../types';

/**
 * Maximum length for raw error messages stored in GitHubErrorInfo.
 * Truncates to prevent memory bloat and UI issues.
 */
const MAX_RAW_ERROR_LENGTH = 500;

/**
 * Patterns for rate limit errors (HTTP 403 with rate limit context)
 */
const RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /api\s*rate\s*limit\s*exceeded/i,
  /rate\s*limit\s*exceeded/i,
  /too\s*many\s*requests/i,
  /403.*rate/i,
  /abuse\s*rate\s*limit/i,
  /secondary\s*rate\s*limit/i,
];

/**
 * Patterns for authentication errors (HTTP 401)
 */
const AUTH_PATTERNS = [
  /\b401\b/i,
  /unauthorized/i,
  /bad\s*credentials/i,
  /authentication\s*failed/i,
  /invalid\s*(oauth\s*)?token/i,
  /token\s*(is\s*)?(invalid|expired|required)/i,
  /not\s*authenticated/i,
];

/**
 * Patterns for permission/scope errors (HTTP 403 with scope context)
 */
const PERMISSION_PATTERNS = [
  /\b403\b/i,
  /forbidden/i,
  /permission\s*denied/i,
  /insufficient\s*(scope|permission)/i,
  /access\s*denied/i,
  /repository\s*access\s*denied/i,
  /not\s*authorized\s*to\s*access/i,
  /requires\s*(admin|write|read)\s*access/i,
  /missing\s*required\s*scope/i,
];

/**
 * Patterns for not found errors (HTTP 404)
 */
const NOT_FOUND_PATTERNS = [
  /\b404\b/i,
  /not\s*found/i,
  /no\s*such\s*(repository|repo|issue|resource)/i,
  /does\s*not\s*exist/i,
  /repository\s*not\s*found/i,
  /user\s*not\s*found/i,
];

/**
 * Patterns for network/connectivity errors
 */
const NETWORK_PATTERNS = [
  /network\s*(error|failed|unreachable)/i,
  /failed\s*to\s*fetch/i,
  /enetunreach/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /dns\s*(error|failed)/i,
  /offline/i,
  /no\s*internet/i,
  /unable\s*to\s*connect/i,
  /connection\s*(refused|reset|timeout|failed)/i,
];

/**
 * Pattern to extract required OAuth scopes from error messages
 * Matches formats like:
 * - "requires: repo, read:org"
 * - "missing scopes: repo, workflow"
 * - "X-Accepted-OAuth-Scopes: repo"
 * Stops at sentence boundaries or non-scope characters
 */
const REQUIRED_SCOPES_PATTERN = /(?:requires?[:\s]*|missing\s*scopes?[:\s]*|X-Accepted-OAuth-Scopes[:\s]*)([a-z0-9_:]+(?:[,\s]+[a-z0-9_:]+)*)/i;

/**
 * Pattern to extract HTTP status code from error messages
 * Matches status codes with HTTP context keywords to avoid false positives
 */
const STATUS_CODE_PATTERN = /(?:^|HTTP\s*|status[:\s]*|error[:\s]*|code[:\s]*)\b([1-5]\d{2})\b/i;

/**
 * Sanitize error output to a reasonable length.
 * Prevents memory bloat and UI issues from very long error messages.
 */
function sanitizeRawError(error: string): string {
  if (error.length > MAX_RAW_ERROR_LENGTH) {
    return error.substring(0, MAX_RAW_ERROR_LENGTH) + '...';
  }
  return error;
}

/**
 * Extract rate limit reset time from error message.
 * Parses various formats and returns a Date object if found.
 * Handles both absolute timestamps and relative durations ("in X seconds").
 */
function extractRateLimitResetTime(error: string): Date | undefined {
  // First, try to match relative duration pattern (e.g., "reset in 3600 seconds")
  const relativePattern = /reset[s]?\s*in[:\s]*(\d+)\s*seconds?/i;
  const relativeMatch = error.match(relativePattern);
  if (relativeMatch) {
    const seconds = parseInt(relativeMatch[1], 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return new Date(Date.now() + seconds * 1000);
    }
  }

  // Then try absolute timestamp pattern
  const absolutePattern = /(?:reset[s]?\s*at[:\s]*|X-RateLimit-Reset[:\s]*)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?|\d+)/i;
  const match = error.match(absolutePattern);
  if (!match) {
    return undefined;
  }

  const resetValue = match[1].trim();

  // Check if it's an ISO date string
  if (resetValue.includes('-') && resetValue.includes('T')) {
    const date = new Date(resetValue);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  // Check if it's a Unix timestamp (seconds or milliseconds)
  const numericValue = parseInt(resetValue, 10);
  if (!Number.isNaN(numericValue)) {
    // GitHub API uses seconds, JavaScript uses milliseconds
    // Values > 1e12 are likely milliseconds already
    const timestamp = numericValue > 1e12 ? numericValue : numericValue * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

/**
 * Extract required OAuth scopes from error message.
 * Returns an array of scope strings if found.
 */
function extractRequiredScopes(error: string): string[] | undefined {
  const match = error.match(REQUIRED_SCOPES_PATTERN);
  if (!match) {
    return undefined;
  }

  const scopes = match[1]
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return scopes.length > 0 ? scopes : undefined;
}

/**
 * Extract HTTP status code from error message.
 */
function extractStatusCode(error: string): number | undefined {
  const match = error.match(STATUS_CODE_PATTERN);
  if (!match) {
    return undefined;
  }

  const code = parseInt(match[1], 10);
  // Only return valid HTTP status codes
  if (code >= 100 && code < 600) {
    return code;
  }
  return undefined;
}

/**
 * Check if the error matches any of the given patterns.
 */
function matchesPatterns(error: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(error));
}

/**
 * Get a user-friendly message for rate limit errors.
 */
function getRateLimitMessage(_error: string, resetTime?: Date): string {
  if (resetTime) {
    const now = new Date();
    const diffMs = resetTime.getTime() - now.getTime();

    if (diffMs > 0) {
      const diffMins = Math.ceil(diffMs / 60000);
      if (diffMins < 60) {
        return `GitHub API rate limit reached. Please wait ${diffMins} minute${diffMins !== 1 ? 's' : ''} before trying again.`;
      }
      const diffHours = Math.ceil(diffMins / 60);
      return `GitHub API rate limit reached. Rate limit resets in approximately ${diffHours} hour${diffHours !== 1 ? 's' : ''}.`;
    }
  }

  return 'GitHub API rate limit reached. Please wait a moment before trying again.';
}

/**
 * Get a user-friendly message for authentication errors.
 */
function getAuthMessage(): string {
  return 'GitHub authentication failed. Please check your GitHub token in Settings and try again.';
}

/**
 * Get a user-friendly message for permission errors.
 */
function getPermissionMessage(scopes?: string[]): string {
  if (scopes && scopes.length > 0) {
    return `GitHub permission denied. Your token is missing required scopes: ${scopes.join(', ')}. Please update your GitHub token in Settings.`;
  }
  return 'GitHub permission denied. Your token may not have the required access. Please check your token permissions in Settings.';
}

/**
 * Get a user-friendly message for not found errors.
 */
function getNotFoundMessage(): string {
  return 'The requested GitHub resource was not found. Please verify the repository exists and you have access to it.';
}

/**
 * Get a user-friendly message for network errors.
 */
function getNetworkMessage(): string {
  return 'Unable to connect to GitHub. Please check your internet connection and try again.';
}

/**
 * Get a user-friendly message for unknown errors.
 */
function getUnknownMessage(): string {
  return 'An unexpected error occurred while communicating with GitHub. Please try again.';
}

/**
 * Classify error type based on pattern matching.
 * Priority: rate_limit > auth > not_found > network > permission > unknown
 */
function classifyError(error: string): GitHubErrorType {
  // Check rate limit first (403 can also be permission, but rate limit is more specific)
  if (matchesPatterns(error, RATE_LIMIT_PATTERNS)) {
    return 'rate_limit';
  }

  // Check auth (401 is always auth)
  if (matchesPatterns(error, AUTH_PATTERNS)) {
    return 'auth';
  }

  // Check not found (404 is always not_found)
  if (matchesPatterns(error, NOT_FOUND_PATTERNS)) {
    return 'not_found';
  }

  // Check network errors
  if (matchesPatterns(error, NETWORK_PATTERNS)) {
    return 'network';
  }

  // Check permission (403 without rate limit context)
  if (matchesPatterns(error, PERMISSION_PATTERNS)) {
    return 'permission';
  }

  return 'unknown';
}

/**
 * Parse a GitHub API error string and return classified error information.
 *
 * @param error - The raw error string (typically from issues-store error state)
 * @returns GitHubErrorInfo object with classified type, user-friendly message, and metadata
 *
 * @example
 * ```typescript
 * const errorInfo = parseGitHubError('GitHub API error: 403 - API rate limit exceeded');
 * // Returns:
 * // {
 * //   type: 'rate_limit',
 * //   message: 'GitHub API rate limit reached. Please wait a moment before trying again.',
 * //   rawMessage: 'GitHub API error: 403 - API rate limit exceeded',
 * //   statusCode: 403
 * // }
 * ```
 */
export function parseGitHubError(error: string | null | undefined): GitHubErrorInfo {
  // Handle null/undefined/empty errors
  if (!error || typeof error !== 'string' || error.trim() === '') {
    return {
      type: 'unknown',
      message: getUnknownMessage(),
    };
  }

  const trimmedError = error.trim();
  const errorType = classifyError(trimmedError);
  const statusCode = extractStatusCode(trimmedError);

  switch (errorType) {
    case 'rate_limit': {
      const resetTime = extractRateLimitResetTime(trimmedError);
      return {
        type: 'rate_limit',
        message: getRateLimitMessage(trimmedError, resetTime),
        rawMessage: sanitizeRawError(trimmedError),
        rateLimitResetTime: resetTime,
        statusCode: statusCode ?? 403,
      };
    }

    case 'auth':
      return {
        type: 'auth',
        message: getAuthMessage(),
        rawMessage: sanitizeRawError(trimmedError),
        statusCode: statusCode ?? 401,
      };

    case 'permission': {
      const scopes = extractRequiredScopes(trimmedError);
      return {
        type: 'permission',
        message: getPermissionMessage(scopes),
        rawMessage: sanitizeRawError(trimmedError),
        requiredScopes: scopes,
        statusCode: statusCode ?? 403,
      };
    }

    case 'not_found':
      return {
        type: 'not_found',
        message: getNotFoundMessage(),
        rawMessage: sanitizeRawError(trimmedError),
        statusCode: statusCode ?? 404,
      };

    case 'network':
      return {
        type: 'network',
        message: getNetworkMessage(),
        rawMessage: sanitizeRawError(trimmedError),
      };

    default:
      return {
        type: 'unknown',
        message: getUnknownMessage(),
        rawMessage: sanitizeRawError(trimmedError),
        statusCode,
      };
  }
}

/**
 * Check if an error is a rate limit error.
 * Convenience function for quick checks without full parsing.
 * @param error - Raw error string or null/undefined
 * @param parsedInfo - Optional pre-parsed GitHubErrorInfo to avoid re-classification
 */
export function isRateLimitError(
  error: string | null | undefined,
  parsedInfo?: GitHubErrorInfo | null
): boolean {
  if (parsedInfo) return parsedInfo.type === 'rate_limit';
  if (!error) return false;
  return classifyError(error.trim()) === 'rate_limit';
}

/**
 * Check if an error is an authentication error.
 * Convenience function for quick checks without full parsing.
 * @param error - Raw error string or null/undefined
 * @param parsedInfo - Optional pre-parsed GitHubErrorInfo to avoid re-classification
 */
export function isAuthError(
  error: string | null | undefined,
  parsedInfo?: GitHubErrorInfo | null
): boolean {
  if (parsedInfo) return parsedInfo.type === 'auth';
  if (!error) return false;
  return classifyError(error.trim()) === 'auth';
}

/**
 * Check if an error is a network error.
 * Convenience function for quick checks without full parsing.
 * @param error - Raw error string or null/undefined
 * @param parsedInfo - Optional pre-parsed GitHubErrorInfo to avoid re-classification
 */
export function isNetworkError(
  error: string | null | undefined,
  parsedInfo?: GitHubErrorInfo | null
): boolean {
  if (parsedInfo) return parsedInfo.type === 'network';
  if (!error) return false;
  return classifyError(error.trim()) === 'network';
}

/**
 * Check if an error is recoverable (user can retry).
 * Rate limit, network, and unknown errors are considered recoverable.
 * @param error - Raw error string or null/undefined
 * @param parsedInfo - Optional pre-parsed GitHubErrorInfo to avoid re-classification
 */
export function isRecoverableError(
  error: string | null | undefined,
  parsedInfo?: GitHubErrorInfo | null
): boolean {
  if (parsedInfo) return ['rate_limit', 'network', 'unknown'].includes(parsedInfo.type);
  if (!error) return false;
  const errorType = classifyError(error.trim());
  return ['rate_limit', 'network', 'unknown'].includes(errorType);
}

/**
 * Check if an error requires user action in settings.
 * Auth and permission errors require settings changes.
 * @param error - Raw error string or null/undefined
 * @param parsedInfo - Optional pre-parsed GitHubErrorInfo to avoid re-classification
 */
export function requiresSettingsAction(
  error: string | null | undefined,
  parsedInfo?: GitHubErrorInfo | null
): boolean {
  if (parsedInfo) return ['auth', 'permission'].includes(parsedInfo.type);
  if (!error) return false;
  const errorType = classifyError(error.trim());
  return ['auth', 'permission'].includes(errorType);
}
