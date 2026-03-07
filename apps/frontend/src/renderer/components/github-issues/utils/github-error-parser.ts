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
 * Patterns for rate limit errors (HTTP 403 with rate limit context).
 * Note: Pattern 1 covers all "rate limit" variations (api rate limit exceeded,
 * abuse rate limit, secondary rate limit, etc.) via substring matching.
 */
const RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i, // Covers all variations containing "rate limit"
  /too\s*many\s*requests/i,
  /403.*rate/i,
];

/**
 * Patterns for authentication errors (HTTP 401)
 * Note: Bare status codes are intentionally omitted here - STATUS_CODE_PATTERN
 * handles HTTP-context-aware matching to avoid false positives.
 */
const AUTH_PATTERNS = [
  /unauthorized/i,
  /bad\s*credentials/i,
  /authentication\s*failed/i,
  /invalid\s*(oauth\s*)?token/i,
  /token\s*(is\s*)?(invalid|expired|required)/i,
  /not\s*authenticated/i,
  /requires\s*authentication/i, // GitHub 401 response body
];

/**
 * Patterns for permission/scope errors (HTTP 403 with scope context)
 * Note: Bare status codes are intentionally omitted here - STATUS_CODE_PATTERN
 * handles HTTP-context-aware matching to avoid false positives.
 */
const PERMISSION_PATTERNS = [
  /forbidden/i,
  /permission\s*denied/i,
  /insufficient\s*(scope|permission)/i,
  /access\s*denied/i,
  /repository\s*access\s*denied/i,
  /not\s*authorized\s*to\s*access/i,
  /requires\s*(admin|write|read)\s*access/i,
  /missing\s*required\s*scope/i,
  // Matches "requires: repo" or "requires workflow" for OAuth scope context
  // Uses specific scope names to avoid matching "requires authentication" (auth error)
  /requires[:\s]+(?:repo|admin|write|read|workflow|org|gist|notification|user|project|package|delete|discussion)/i,
];

/**
 * Patterns for not found errors (HTTP 404)
 * Note: Bare status codes are intentionally omitted here - STATUS_CODE_PATTERN
 * handles HTTP-context-aware matching to avoid false positives (e.g., "Issue #404").
 */
const NOT_FOUND_PATTERNS = [
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
 * Pattern to extract HTTP status code from error messages.
 * Matches status codes preceded by HTTP context keywords or at string start
 * (for common error formats like "403 Forbidden").
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
 * Maximum reasonable reset duration in seconds (24 hours).
 * Prevents malformed error strings from creating far-future dates.
 */
const MAX_RESET_SECONDS = 86400;

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
    // Validate: positive, non-NaN, and within reasonable bounds (24 hours max)
    if (!Number.isNaN(seconds) && seconds > 0 && seconds <= MAX_RESET_SECONDS) {
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
    if (Number.isNaN(date.getTime())) return undefined;
    // Validate: within reasonable bounds (24 hours max from now)
    if (date.getTime() - Date.now() > MAX_RESET_SECONDS * 1000) return undefined;
    return date;
  }

  // Check if it's a Unix timestamp (seconds or milliseconds)
  const numericValue = parseInt(resetValue, 10);
  if (!Number.isNaN(numericValue)) {
    // GitHub API uses seconds, JavaScript uses milliseconds
    // Values > 1e12 are likely milliseconds already
    const timestamp = numericValue > 1e12 ? numericValue : numericValue * 1000;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return undefined;
    // Validate: within reasonable bounds (24 hours max from now)
    if (date.getTime() - Date.now() > MAX_RESET_SECONDS * 1000) return undefined;
    return date;
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
 * Classify error type based on pattern matching and optional status code.
 * Priority: rate_limit > auth > permission > not_found > network > unknown
 * Note: Permission checks run before not_found to properly classify 403 responses.
 * Status code fallback takes priority over network patterns since HTTP status
 * codes are more specific than generic network error text.
 * @param error - The error string to classify
 * @param statusCode - Optional HTTP status code extracted with context (helps classify when text patterns don't match)
 */
function classifyError(error: string, statusCode?: number): GitHubErrorType {
  // Check rate limit first (403 can also be permission, but rate limit is more specific)
  if (matchesPatterns(error, RATE_LIMIT_PATTERNS)) {
    return 'rate_limit';
  }

  // Check auth (401 is always auth)
  if (matchesPatterns(error, AUTH_PATTERNS)) {
    return 'auth';
  }

  // Check permission (403 without rate limit context) before not_found
  // to properly classify 403 responses that might contain "not found" text
  if (matchesPatterns(error, PERMISSION_PATTERNS)) {
    return 'permission';
  }

  // Check not found (404 is always not_found)
  if (matchesPatterns(error, NOT_FOUND_PATTERNS)) {
    return 'not_found';
  }

  // Use status code fallback BEFORE network patterns
  // HTTP status codes are more specific than generic network error text
  if (statusCode === 401) return 'auth';
  if (statusCode === 403) return 'permission';
  if (statusCode === 404) return 'not_found';

  // Check network errors (only if no status code fallback matched)
  if (matchesPatterns(error, NETWORK_PATTERNS)) {
    return 'network';
  }

  return 'unknown';
}

/**
 * Parse a GitHub API error string and return classified error information.
 *
 * IMPORTANT: The returned `message` field contains hardcoded English strings
 * intended ONLY as a fallback defaultValue for i18n translation. Consumers
 * should use the `type` field to look up the appropriate translation key
 * (e.g., 'githubErrors.rateLimitMessage') via react-i18next rather than
 * displaying `message` directly. This ensures proper localization.
 *
 * Translation key mapping by type:
 * - rate_limit → 'githubErrors.rateLimitMessage' (or rateLimitMessageMinutes/Hours)
 * - auth → 'githubErrors.authMessage'
 * - permission → 'githubErrors.permissionMessage' (or permissionMessageScopes)
 * - not_found → 'githubErrors.notFoundMessage'
 * - network → 'githubErrors.networkMessage'
 * - unknown → 'githubErrors.unknownMessage'
 *
 * @param error - The raw error string (typically from issues-store error state)
 * @returns GitHubErrorInfo object with classified type, user-friendly message, and metadata
 *
 * @example
 * ```typescript
 * const errorInfo = parseGitHubError('GitHub API error: 403 - API rate limit exceeded');
 * // Use type to get i18n key, message only as fallback:
 * // t(`githubErrors.${errorInfo.type}Message`, { defaultValue: errorInfo.message })
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
  // Extract status code first so we can use it for classification fallback
  const statusCode = extractStatusCode(trimmedError);
  const errorType = classifyError(trimmedError, statusCode);

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
  const trimmed = error.trim();
  return classifyError(trimmed, extractStatusCode(trimmed)) === 'rate_limit';
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
  const trimmed = error.trim();
  return classifyError(trimmed, extractStatusCode(trimmed)) === 'auth';
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
  const trimmed = error.trim();
  return classifyError(trimmed, extractStatusCode(trimmed)) === 'network';
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
  const trimmed = error.trim();
  const errorType = classifyError(trimmed, extractStatusCode(trimmed));
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
  const trimmed = error.trim();
  const errorType = classifyError(trimmed, extractStatusCode(trimmed));
  return ['auth', 'permission'].includes(errorType);
}
