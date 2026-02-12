/**
 * Unit tests for GitHub API error parser utility.
 * Tests error classification, metadata extraction, and helper functions.
 */
import { describe, it, expect } from 'vitest';
import {
  parseGitHubError,
  isRateLimitError,
  isAuthError,
  isNetworkError,
  isRecoverableError,
  requiresSettingsAction,
} from '../github-error-parser';
import type { GitHubErrorType } from '../../types';

describe('parseGitHubError', () => {
  describe('null/undefined/empty handling', () => {
    it('should return unknown for null input', () => {
      const result = parseGitHubError(null);
      expect(result.type).toBe('unknown');
      expect(result.message).toBeDefined();
    });

    it('should return unknown for undefined input', () => {
      const result = parseGitHubError(undefined);
      expect(result.type).toBe('unknown');
      expect(result.message).toBeDefined();
    });

    it('should return unknown for empty string', () => {
      const result = parseGitHubError('');
      expect(result.type).toBe('unknown');
      expect(result.message).toBeDefined();
    });

    it('should return unknown for whitespace-only string', () => {
      const result = parseGitHubError('   ');
      expect(result.type).toBe('unknown');
      expect(result.message).toBeDefined();
    });
  });

  describe('rate_limit errors', () => {
    it('should detect "rate limit exceeded" pattern', () => {
      const result = parseGitHubError('GitHub API error: rate limit exceeded');
      expect(result.type).toBe('rate_limit');
      expect(result.message).toContain('rate limit');
      expect(result.statusCode).toBe(403);
    });

    it('should detect "API rate limit exceeded" pattern', () => {
      const result = parseGitHubError('API rate limit exceeded for user');
      expect(result.type).toBe('rate_limit');
    });

    it('should detect "too many requests" pattern', () => {
      const result = parseGitHubError('Error: too many requests');
      expect(result.type).toBe('rate_limit');
    });

    it('should detect "403 rate limit" pattern', () => {
      const result = parseGitHubError('403 rate limit reached');
      expect(result.type).toBe('rate_limit');
      expect(result.statusCode).toBe(403);
    });

    it('should detect "abuse rate limit" pattern', () => {
      const result = parseGitHubError('Abuse rate limit triggered');
      expect(result.type).toBe('rate_limit');
    });

    it('should detect "secondary rate limit" pattern', () => {
      const result = parseGitHubError('Secondary rate limit exceeded');
      expect(result.type).toBe('rate_limit');
    });

    it('should extract rate limit reset time from ISO date format', () => {
      const result = parseGitHubError('rate limit exceeded, resets at 2024-01-15T12:00:00Z');
      expect(result.type).toBe('rate_limit');
      expect(result.rateLimitResetTime).toBeInstanceOf(Date);
      expect(result.rateLimitResetTime?.getUTCFullYear()).toBe(2024);
    });

    it('should extract rate limit reset time from Unix timestamp', () => {
      const result = parseGitHubError('X-RateLimit-Reset: 1705312800');
      expect(result.type).toBe('rate_limit');
      expect(result.rateLimitResetTime).toBeInstanceOf(Date);
    });

    it('should generate user-friendly message with time remaining', () => {
      // Create a date 5 minutes in the future
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      const isoString = futureDate.toISOString();
      const result = parseGitHubError(`rate limit exceeded, resets at ${isoString}`);
      expect(result.type).toBe('rate_limit');
      expect(result.message).toContain('rate limit');
    });

    it('should generate fallback message when reset time has passed', () => {
      // Create a date in the past
      const pastDate = new Date(Date.now() - 5 * 60 * 1000);
      const isoString = pastDate.toISOString();
      const result = parseGitHubError(`rate limit exceeded, resets at ${isoString}`);
      expect(result.type).toBe('rate_limit');
      expect(result.message).toContain('moment');
    });

    it('should include raw message truncated to MAX_RAW_ERROR_LENGTH', () => {
      const longError = 'rate limit exceeded ' + 'x'.repeat(600);
      const result = parseGitHubError(longError);
      expect(result.type).toBe('rate_limit');
      expect(result.rawMessage).toBeDefined();
      expect(result.rawMessage?.length).toBeLessThanOrEqual(503); // 500 + '...'
    });
  });

  describe('auth errors', () => {
    it('should detect "401" pattern', () => {
      const result = parseGitHubError('HTTP 401 Unauthorized');
      expect(result.type).toBe('auth');
      expect(result.statusCode).toBe(401);
    });

    it('should detect "unauthorized" pattern', () => {
      const result = parseGitHubError('Error: unauthorized access');
      expect(result.type).toBe('auth');
    });

    it('should detect "bad credentials" pattern', () => {
      const result = parseGitHubError('Bad credentials');
      expect(result.type).toBe('auth');
    });

    it('should detect "authentication failed" pattern', () => {
      const result = parseGitHubError('Authentication failed');
      expect(result.type).toBe('auth');
    });

    it('should detect "invalid token" pattern', () => {
      const result = parseGitHubError('Invalid token provided');
      expect(result.type).toBe('auth');
    });

    it('should detect "token expired" pattern', () => {
      const result = parseGitHubError('Token expired');
      expect(result.type).toBe('auth');
    });

    it('should detect "not authenticated" pattern', () => {
      const result = parseGitHubError('Not authenticated');
      expect(result.type).toBe('auth');
    });

    it('should generate user-friendly message mentioning Settings', () => {
      const result = parseGitHubError('401 Unauthorized');
      expect(result.message).toContain('authentication');
      expect(result.message).toContain('Settings');
    });
  });

  describe('not_found errors', () => {
    it('should detect "404" pattern', () => {
      const result = parseGitHubError('HTTP 404 Not Found');
      expect(result.type).toBe('not_found');
      expect(result.statusCode).toBe(404);
    });

    it('should detect "not found" pattern', () => {
      const result = parseGitHubError('Repository not found');
      expect(result.type).toBe('not_found');
    });

    it('should detect "no such repository" pattern', () => {
      const result = parseGitHubError('No such repository exists');
      expect(result.type).toBe('not_found');
    });

    it('should detect "does not exist" pattern', () => {
      const result = parseGitHubError('Resource does not exist');
      expect(result.type).toBe('not_found');
    });

    it('should detect "user not found" pattern', () => {
      const result = parseGitHubError('User not found');
      expect(result.type).toBe('not_found');
    });

    it('should generate user-friendly message about verifying repository', () => {
      const result = parseGitHubError('404 Not Found');
      expect(result.message).toContain('not found');
      expect(result.message).toContain('verify');
    });
  });

  describe('network errors', () => {
    it('should detect "network error" pattern', () => {
      const result = parseGitHubError('Network error');
      expect(result.type).toBe('network');
    });

    it('should detect "failed to fetch" pattern', () => {
      const result = parseGitHubError('Failed to fetch data');
      expect(result.type).toBe('network');
    });

    it('should detect "ECONNREFUSED" pattern', () => {
      const result = parseGitHubError('Error: ECONNREFUSED');
      expect(result.type).toBe('network');
    });

    it('should detect "ECONNRESET" pattern', () => {
      const result = parseGitHubError('Error: ECONNRESET');
      expect(result.type).toBe('network');
    });

    it('should detect "ETIMEDOUT" pattern', () => {
      const result = parseGitHubError('Error: ETIMEDOUT');
      expect(result.type).toBe('network');
    });

    it('should detect "connection refused" pattern', () => {
      const result = parseGitHubError('Connection refused');
      expect(result.type).toBe('network');
    });

    it('should detect "connection timeout" pattern', () => {
      const result = parseGitHubError('Connection timeout');
      expect(result.type).toBe('network');
    });

    it('should detect "DNS error" pattern', () => {
      const result = parseGitHubError('DNS error occurred');
      expect(result.type).toBe('network');
    });

    it('should detect "offline" pattern', () => {
      const result = parseGitHubError('You are offline');
      expect(result.type).toBe('network');
    });

    it('should detect "no internet" pattern', () => {
      const result = parseGitHubError('No internet connection');
      expect(result.type).toBe('network');
    });

    it('should generate user-friendly message about internet connection', () => {
      const result = parseGitHubError('Network error');
      expect(result.message).toContain('internet');
    });
  });

  describe('permission errors', () => {
    it('should detect "403" pattern (without rate limit context)', () => {
      const result = parseGitHubError('HTTP 403 Forbidden');
      expect(result.type).toBe('permission');
      expect(result.statusCode).toBe(403);
    });

    it('should detect "forbidden" pattern', () => {
      const result = parseGitHubError('Access forbidden');
      expect(result.type).toBe('permission');
    });

    it('should detect "permission denied" pattern', () => {
      const result = parseGitHubError('Permission denied');
      expect(result.type).toBe('permission');
    });

    it('should detect "insufficient scope" pattern', () => {
      const result = parseGitHubError('Insufficient scope');
      expect(result.type).toBe('permission');
    });

    it('should detect "access denied" pattern', () => {
      const result = parseGitHubError('Access denied');
      expect(result.type).toBe('permission');
    });

    it('should detect "repository access denied" pattern', () => {
      const result = parseGitHubError('Repository access denied');
      expect(result.type).toBe('permission');
    });

    it('should detect "requires admin access" pattern', () => {
      const result = parseGitHubError('Requires admin access');
      expect(result.type).toBe('permission');
    });

    it('should detect "missing required scope" pattern', () => {
      const result = parseGitHubError('Missing required scope');
      expect(result.type).toBe('permission');
    });

    it('should extract required scopes from error message with 403', () => {
      const result = parseGitHubError('403 Forbidden - missing scopes: repo, read:org');
      expect(result.type).toBe('permission');
      expect(result.requiredScopes).toContain('repo');
      expect(result.requiredScopes).toContain('read:org');
    });

    it('should extract scopes from "requires:" format with 403', () => {
      const result = parseGitHubError('403 - Requires: repo, workflow');
      expect(result.type).toBe('permission');
      expect(result.requiredScopes).toContain('repo');
      expect(result.requiredScopes).toContain('workflow');
    });

    it('should extract scopes from X-Accepted-OAuth-Scopes header with 403', () => {
      const result = parseGitHubError('403 Forbidden X-Accepted-OAuth-Scopes: repo');
      expect(result.type).toBe('permission');
      expect(result.requiredScopes).toContain('repo');
    });

    it('should generate user-friendly message with scopes', () => {
      const result = parseGitHubError('403 Forbidden - missing scopes: repo, workflow');
      expect(result.message).toContain('repo');
      expect(result.message).toContain('workflow');
      expect(result.message).toContain('Settings');
    });

    it('should generate user-friendly message without scopes', () => {
      const result = parseGitHubError('403 Forbidden');
      expect(result.message).toContain('permission');
      expect(result.message).toContain('Settings');
    });
  });

  describe('unknown errors', () => {
    it('should return unknown for unrecognized error patterns', () => {
      const result = parseGitHubError('Something unexpected happened');
      expect(result.type).toBe('unknown');
      expect(result.message).toBeDefined();
    });

    it('should include raw message for unknown errors', () => {
      const result = parseGitHubError('Custom error message');
      expect(result.rawMessage).toBe('Custom error message');
    });

    it('should extract status code even for unknown errors', () => {
      const result = parseGitHubError('HTTP 500 Internal Server Error');
      expect(result.type).toBe('unknown');
      expect(result.statusCode).toBe(500);
    });
  });

  describe('error classification priority', () => {
    it('should prioritize rate_limit over permission (both 403)', () => {
      const result = parseGitHubError('403 rate limit exceeded');
      expect(result.type).toBe('rate_limit');
    });

    it('should classify as permission when 403 without rate limit context', () => {
      const result = parseGitHubError('403 forbidden');
      expect(result.type).toBe('permission');
    });

    it('should handle errors with multiple patterns correctly', () => {
      // Rate limit should take priority
      const result = parseGitHubError('403 API rate limit exceeded');
      expect(result.type).toBe('rate_limit');
    });

    it('should prioritize auth over not_found when both patterns present', () => {
      // "401" should be classified as auth, not not_found
      const result = parseGitHubError('HTTP 401 Unauthorized - user not found');
      expect(result.type).toBe('auth');
    });

    it('should prioritize auth over network when 401 appears with network context', () => {
      const result = parseGitHubError('Network error: HTTP 401');
      expect(result.type).toBe('auth');
    });

    it('should classify as not_found when 404 without auth patterns', () => {
      const result = parseGitHubError('HTTP 404 Not Found');
      expect(result.type).toBe('not_found');
    });

    it('should not match bare 401 in unrelated numbers', () => {
      // The word boundary should prevent matching "1401" as a 401 error
      const result = parseGitHubError('Error code 14010 occurred');
      expect(result.type).toBe('unknown');
    });

    it('should not match bare 404 embedded in other numbers', () => {
      // The word boundary should prevent matching "404" embedded in "14040"
      const result = parseGitHubError('Error code 14040 occurred');
      expect(result.type).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('should handle multiline error messages', () => {
      const result = parseGitHubError(`Error occurred:
        HTTP 401 Unauthorized
        Please check your credentials`);
      expect(result.type).toBe('auth');
    });

    it('should handle case-insensitive matching', () => {
      const testCases = [
        { input: 'RATE LIMIT EXCEEDED', expected: 'rate_limit' as GitHubErrorType },
        { input: 'UNAUTHORIZED', expected: 'auth' as GitHubErrorType },
        { input: 'NOT FOUND', expected: 'not_found' as GitHubErrorType },
        { input: 'NETWORK ERROR', expected: 'network' as GitHubErrorType },
        { input: 'FORBIDDEN', expected: 'permission' as GitHubErrorType },
      ];

      for (const { input, expected } of testCases) {
        const result = parseGitHubError(input);
        expect(result.type).toBe(expected);
      }
    });

    it('should handle errors with JSON content', () => {
      const result = parseGitHubError('{"message":"Bad credentials","status":401}');
      expect(result.type).toBe('auth');
    });

    it('should handle errors with leading/trailing whitespace', () => {
      const result = parseGitHubError('  401 Unauthorized  ');
      expect(result.type).toBe('auth');
    });

    it('should sanitize very long error messages', () => {
      const longError = 'A'.repeat(1000);
      const result = parseGitHubError(longError);
      expect(result.rawMessage?.length).toBeLessThanOrEqual(503);
      expect(result.rawMessage).toContain('...');
    });

    it('should not include rateLimitResetTime for non-rate-limit errors', () => {
      const result = parseGitHubError('401 Unauthorized');
      expect(result.rateLimitResetTime).toBeUndefined();
    });

    it('should not include requiredScopes for non-permission errors', () => {
      const result = parseGitHubError('401 Unauthorized');
      expect(result.requiredScopes).toBeUndefined();
    });
  });
});

describe('isRateLimitError', () => {
  it('should return true for rate limit errors', () => {
    expect(isRateLimitError('rate limit exceeded')).toBe(true);
    expect(isRateLimitError('API rate limit exceeded')).toBe(true);
    expect(isRateLimitError('too many requests')).toBe(true);
  });

  it('should return false for non-rate-limit errors', () => {
    expect(isRateLimitError('401 Unauthorized')).toBe(false);
    expect(isRateLimitError('404 Not Found')).toBe(false);
    expect(isRateLimitError('Network error')).toBe(false);
  });

  it('should return false for null/undefined/empty', () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError('')).toBe(false);
  });

  it('should use parsedInfo when provided', () => {
    const parsedInfo = { type: 'rate_limit' as const, message: 'test' };
    expect(isRateLimitError('unrelated error', parsedInfo)).toBe(true);
    expect(isRateLimitError(null, parsedInfo)).toBe(true);
    expect(isRateLimitError(undefined, parsedInfo)).toBe(true);
  });

  it('should ignore parsedInfo when error type differs', () => {
    const authParsedInfo = { type: 'auth' as const, message: 'test' };
    expect(isRateLimitError('rate limit exceeded', authParsedInfo)).toBe(false);
  });
});

describe('isAuthError', () => {
  it('should return true for auth errors', () => {
    expect(isAuthError('401 Unauthorized')).toBe(true);
    expect(isAuthError('Bad credentials')).toBe(true);
    expect(isAuthError('Invalid token')).toBe(true);
    expect(isAuthError('Not authenticated')).toBe(true);
  });

  it('should return false for non-auth errors', () => {
    expect(isAuthError('rate limit exceeded')).toBe(false);
    expect(isAuthError('404 Not Found')).toBe(false);
    expect(isAuthError('Network error')).toBe(false);
  });

  it('should return false for null/undefined/empty', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError('')).toBe(false);
  });

  it('should use parsedInfo when provided', () => {
    const parsedInfo = { type: 'auth' as const, message: 'test' };
    expect(isAuthError('unrelated error', parsedInfo)).toBe(true);
    expect(isAuthError(null, parsedInfo)).toBe(true);
    expect(isAuthError(undefined, parsedInfo)).toBe(true);
  });

  it('should ignore parsedInfo when error type differs', () => {
    const rateLimitParsedInfo = { type: 'rate_limit' as const, message: 'test' };
    expect(isAuthError('401 Unauthorized', rateLimitParsedInfo)).toBe(false);
  });
});

describe('isNetworkError', () => {
  it('should return true for network errors', () => {
    expect(isNetworkError('Network error')).toBe(true);
    expect(isNetworkError('Failed to fetch')).toBe(true);
    expect(isNetworkError('ECONNREFUSED')).toBe(true);
    expect(isNetworkError('Connection timeout')).toBe(true);
  });

  it('should return false for non-network errors', () => {
    expect(isNetworkError('401 Unauthorized')).toBe(false);
    expect(isNetworkError('rate limit exceeded')).toBe(false);
    expect(isNetworkError('404 Not Found')).toBe(false);
  });

  it('should return false for null/undefined/empty', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError('')).toBe(false);
  });

  it('should use parsedInfo when provided', () => {
    const parsedInfo = { type: 'network' as const, message: 'test' };
    expect(isNetworkError('unrelated error', parsedInfo)).toBe(true);
    expect(isNetworkError(null, parsedInfo)).toBe(true);
    expect(isNetworkError(undefined, parsedInfo)).toBe(true);
  });

  it('should ignore parsedInfo when error type differs', () => {
    const authParsedInfo = { type: 'auth' as const, message: 'test' };
    expect(isNetworkError('Network error', authParsedInfo)).toBe(false);
  });
});

describe('isRecoverableError', () => {
  it('should return true for recoverable errors (rate_limit, network, unknown)', () => {
    expect(isRecoverableError('rate limit exceeded')).toBe(true);
    expect(isRecoverableError('Network error')).toBe(true);
    expect(isRecoverableError('Unknown error occurred')).toBe(true);
  });

  it('should return false for non-recoverable errors (auth, permission, not_found)', () => {
    expect(isRecoverableError('401 Unauthorized')).toBe(false);
    expect(isRecoverableError('403 Forbidden')).toBe(false);
    expect(isRecoverableError('404 Not Found')).toBe(false);
  });

  it('should return false for null/undefined/empty', () => {
    expect(isRecoverableError(null)).toBe(false);
    expect(isRecoverableError(undefined)).toBe(false);
    expect(isRecoverableError('')).toBe(false);
  });

  it('should use parsedInfo when provided', () => {
    const rateLimitInfo = { type: 'rate_limit' as const, message: 'test' };
    const networkInfo = { type: 'network' as const, message: 'test' };
    const unknownInfo = { type: 'unknown' as const, message: 'test' };
    expect(isRecoverableError('unrelated error', rateLimitInfo)).toBe(true);
    expect(isRecoverableError(null, networkInfo)).toBe(true);
    expect(isRecoverableError(undefined, unknownInfo)).toBe(true);
  });

  it('should ignore parsedInfo when error type is non-recoverable', () => {
    const authParsedInfo = { type: 'auth' as const, message: 'test' };
    const permissionParsedInfo = { type: 'permission' as const, message: 'test' };
    const notFoundParsedInfo = { type: 'not_found' as const, message: 'test' };
    expect(isRecoverableError('Network error', authParsedInfo)).toBe(false);
    expect(isRecoverableError('rate limit exceeded', permissionParsedInfo)).toBe(false);
    expect(isRecoverableError('unknown', notFoundParsedInfo)).toBe(false);
  });
});

describe('requiresSettingsAction', () => {
  it('should return true for errors requiring settings action (auth, permission)', () => {
    expect(requiresSettingsAction('401 Unauthorized')).toBe(true);
    expect(requiresSettingsAction('403 Forbidden')).toBe(true);
    expect(requiresSettingsAction('Invalid token')).toBe(true);
    expect(requiresSettingsAction('403 Forbidden - missing scopes: repo')).toBe(true);
  });

  it('should return false for errors not requiring settings (rate_limit, network, not_found, unknown)', () => {
    expect(requiresSettingsAction('rate limit exceeded')).toBe(false);
    expect(requiresSettingsAction('Network error')).toBe(false);
    expect(requiresSettingsAction('404 Not Found')).toBe(false);
    expect(requiresSettingsAction('Unknown error')).toBe(false);
  });

  it('should return false for null/undefined/empty', () => {
    expect(requiresSettingsAction(null)).toBe(false);
    expect(requiresSettingsAction(undefined)).toBe(false);
    expect(requiresSettingsAction('')).toBe(false);
  });

  it('should use parsedInfo when provided', () => {
    const authInfo = { type: 'auth' as const, message: 'test' };
    const permissionInfo = { type: 'permission' as const, message: 'test' };
    expect(requiresSettingsAction('unrelated error', authInfo)).toBe(true);
    expect(requiresSettingsAction(null, permissionInfo)).toBe(true);
    expect(requiresSettingsAction(undefined, authInfo)).toBe(true);
  });

  it('should ignore parsedInfo when error type does not require settings', () => {
    const rateLimitInfo = { type: 'rate_limit' as const, message: 'test' };
    const networkInfo = { type: 'network' as const, message: 'test' };
    const notFoundInfo = { type: 'not_found' as const, message: 'test' };
    expect(requiresSettingsAction('401 Unauthorized', rateLimitInfo)).toBe(false);
    expect(requiresSettingsAction('403 Forbidden', networkInfo)).toBe(false);
    expect(requiresSettingsAction('invalid token', notFoundInfo)).toBe(false);
  });
});

describe('cross-cutting concerns', () => {
  describe('consistency between parseGitHubError and helper functions', () => {
    it('should have consistent rate_limit detection', () => {
      const error = 'rate limit exceeded';
      const parsed = parseGitHubError(error);
      expect(parsed.type).toBe('rate_limit');
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should have consistent auth detection', () => {
      const error = '401 Unauthorized';
      const parsed = parseGitHubError(error);
      expect(parsed.type).toBe('auth');
      expect(isAuthError(error)).toBe(true);
    });

    it('should have consistent network detection', () => {
      const error = 'Network error';
      const parsed = parseGitHubError(error);
      expect(parsed.type).toBe('network');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should have consistent recoverable classification', () => {
      const errors = ['rate limit exceeded', 'Network error', 'Unknown error'];
      for (const error of errors) {
        const parsed = parseGitHubError(error);
        expect(isRecoverableError(error)).toBe(['rate_limit', 'network', 'unknown'].includes(parsed.type));
      }
    });

    it('should have consistent settings action classification', () => {
      const errors = ['401 Unauthorized', '403 Forbidden'];
      for (const error of errors) {
        const parsed = parseGitHubError(error);
        expect(requiresSettingsAction(error)).toBe(['auth', 'permission'].includes(parsed.type));
      }
    });
  });

  describe('statusCode extraction', () => {
    it('should extract 403 for rate_limit errors', () => {
      const result = parseGitHubError('rate limit exceeded');
      expect(result.statusCode).toBe(403);
    });

    it('should extract 401 for auth errors', () => {
      const result = parseGitHubError('Bad credentials');
      expect(result.statusCode).toBe(401);
    });

    it('should extract 404 for not_found errors', () => {
      const result = parseGitHubError('Not found');
      expect(result.statusCode).toBe(404);
    });

    it('should extract 403 for permission errors', () => {
      const result = parseGitHubError('Forbidden');
      expect(result.statusCode).toBe(403);
    });

    it('should extract status code from message when present', () => {
      const result = parseGitHubError('HTTP 429 Too Many Requests');
      expect(result.statusCode).toBe(429);
    });

    it('should not extract invalid status codes', () => {
      const result = parseGitHubError('Error 999');
      expect(result.statusCode).toBeUndefined();
    });
  });
});
