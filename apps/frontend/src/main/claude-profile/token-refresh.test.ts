/**
 * Tests for OAuth Token Refresh Module
 *
 * Tests token expiry detection and refresh functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTokenExpiredOrNearExpiry,
  getTimeUntilExpiry,
  formatTimeRemaining,
  refreshOAuthToken,
  ensureValidToken,
  reactiveTokenRefresh,
} from './token-refresh';

// Mock credential-utils
vi.mock('./credential-utils', () => ({
  getFullCredentialsFromKeychain: vi.fn(() => ({
    token: 'mock-access-token',
    email: 'test@example.com',
    refreshToken: 'mock-refresh-token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
    scopes: ['user:read']
  })),
  updateKeychainCredentials: vi.fn(() => ({ success: true })),
  clearKeychainCache: vi.fn()
}));

// Mock fetch for token refresh
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('token-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isTokenExpiredOrNearExpiry', () => {
    it('should return true when expiresAt is null', () => {
      expect(isTokenExpiredOrNearExpiry(null)).toBe(true);
    });

    it('should return true when token is expired', () => {
      const expiredAt = Date.now() - 1000; // 1 second ago
      expect(isTokenExpiredOrNearExpiry(expiredAt)).toBe(true);
    });

    it('should return true when token is within threshold', () => {
      const expiresIn25Min = Date.now() + 25 * 60 * 1000; // 25 minutes
      // Default threshold is 30 minutes
      expect(isTokenExpiredOrNearExpiry(expiresIn25Min)).toBe(true);
    });

    it('should return false when token is valid beyond threshold', () => {
      const expiresIn2Hours = Date.now() + 2 * 60 * 60 * 1000;
      expect(isTokenExpiredOrNearExpiry(expiresIn2Hours)).toBe(false);
    });

    it('should respect custom threshold', () => {
      const expiresIn45Min = Date.now() + 45 * 60 * 1000;
      const threshold1Hour = 60 * 60 * 1000;

      // Within 1 hour threshold = near expiry
      expect(isTokenExpiredOrNearExpiry(expiresIn45Min, threshold1Hour)).toBe(true);

      // Beyond 30 minute threshold = valid
      expect(isTokenExpiredOrNearExpiry(expiresIn45Min, 30 * 60 * 1000)).toBe(false);
    });
  });

  describe('getTimeUntilExpiry', () => {
    it('should return null when expiresAt is null', () => {
      expect(getTimeUntilExpiry(null)).toBeNull();
    });

    it('should return 0 for expired tokens', () => {
      const expired = Date.now() - 1000;
      expect(getTimeUntilExpiry(expired)).toBe(0);
    });

    it('should return correct time remaining', () => {
      const expiresIn1Hour = Date.now() + 60 * 60 * 1000;
      const remaining = getTimeUntilExpiry(expiresIn1Hour);

      expect(remaining).toBeCloseTo(60 * 60 * 1000, -2); // Within 100ms
    });
  });

  describe('formatTimeRemaining', () => {
    it('should return "unknown" for null', () => {
      expect(formatTimeRemaining(null)).toBe('unknown');
    });

    it('should return "expired" for 0 or negative', () => {
      expect(formatTimeRemaining(0)).toBe('expired');
      expect(formatTimeRemaining(-1000)).toBe('expired');
    });

    it('should format minutes correctly', () => {
      expect(formatTimeRemaining(45 * 60 * 1000)).toBe('45m');
      expect(formatTimeRemaining(5 * 60 * 1000)).toBe('5m');
    });

    it('should format hours and minutes correctly', () => {
      expect(formatTimeRemaining(90 * 60 * 1000)).toBe('1h 30m');
      expect(formatTimeRemaining(3 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe('3h 15m');
    });
  });

  describe('refreshOAuthToken', () => {
    it('should return error when no refresh token provided', async () => {
      const result = await refreshOAuthToken('');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('missing_refresh_token');
    });

    it('should successfully refresh token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 28800
        })
      });

      const result = await refreshOAuthToken('old-refresh-token');

      expect(result.success).toBe(true);
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresIn).toBe(28800);
      expect(result.expiresAt).toBeDefined();
    });

    it('should handle invalid_grant error without retry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Refresh token is invalid or expired'
        })
      });

      const result = await refreshOAuthToken('invalid-refresh-token');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid_grant');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry on network errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'new-token',
            refresh_token: 'new-refresh',
            expires_in: 28800
          })
        });

      // Start the async operation
      const resultPromise = refreshOAuthToken('valid-refresh-token');

      // Advance timers to handle retry delays (1s, 2s exponential backoff)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent network error'));

      // Start the async operation
      const resultPromise = refreshOAuthToken('valid-refresh-token');

      // Advance timers to handle retry delays
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('network_error');
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('ensureValidToken', () => {
    it('should return existing token if not near expiry', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
        email: 'test@example.com'
      });

      const result = await ensureValidToken(undefined);

      expect(result.token).toBe('valid-token');
      expect(result.wasRefreshed).toBe(false);
    });

    it('should refresh token when near expiry', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'old-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes - within threshold
        email: 'test@example.com'
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 28800
        })
      });

      const result = await ensureValidToken(undefined);

      expect(result.wasRefreshed).toBe(true);
      expect(result.token).toBe('new-token');
    });

    it('should return error when no token available', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: null,
        refreshToken: null,
        expiresAt: null,
        email: null
      });

      const result = await ensureValidToken(undefined);

      expect(result.token).toBeNull();
      expect(result.error).toContain('No access token');
    });

    it('should return existing token if no refresh token available', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'expiring-token',
        refreshToken: null, // No refresh token
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
        email: 'test@example.com'
      });

      const result = await ensureValidToken(undefined);

      expect(result.token).toBe('expiring-token');
      expect(result.wasRefreshed).toBe(false);
      expect(result.error).toContain('no refresh token');
    });

    it('should call onRefreshed callback when token is refreshed', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'old-token',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 5 * 60 * 1000,
        email: 'test@example.com'
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 28800
        })
      });

      const onRefreshed = vi.fn();
      await ensureValidToken(undefined, onRefreshed);

      expect(onRefreshed).toHaveBeenCalledWith(
        undefined,
        'new-token',
        'new-refresh',
        expect.any(Number)
      );
    });
  });

  describe('reactiveTokenRefresh', () => {
    it('should force refresh even if token appears valid', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'current-token',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
        email: 'test@example.com'
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 28800
        })
      });

      const result = await reactiveTokenRefresh(undefined);

      expect(result.wasRefreshed).toBe(true);
      expect(result.token).toBe('new-token');
    });

    it('should return error when no refresh token available', async () => {
      const { getFullCredentialsFromKeychain } = await import('./credential-utils');
      (getFullCredentialsFromKeychain as ReturnType<typeof vi.fn>).mockReturnValue({
        token: 'current-token',
        refreshToken: null,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
        email: 'test@example.com'
      });

      const result = await reactiveTokenRefresh(undefined);

      expect(result.token).toBeNull();
      expect(result.error).toContain('No refresh token');
    });
  });
});
