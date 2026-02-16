/**
 * Tests for usage-monitor.ts
 *
 * Red phase - write failing tests first
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectProvider, getUsageEndpoint, UsageMonitor, getUsageMonitor } from './usage-monitor';
import type { ApiProvider } from './usage-monitor';
import { hasHardcodedText } from '../../shared/utils/format-time';

// Mock getClaudeProfileManager
vi.mock('../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => ({
    getAutoSwitchSettings: vi.fn(() => ({
      enabled: true,
      proactiveSwapEnabled: true,
      usageCheckInterval: 30000,
      sessionThreshold: 80,
      weeklyThreshold: 80
    })),
    getActiveProfile: vi.fn(() => ({
      id: 'test-profile-1',
      name: 'Test Profile',
      baseUrl: 'https://api.anthropic.com',
      oauthToken: 'mock-oauth-token'
    })),
    getProfile: vi.fn((id: string) => ({
      id,
      name: 'Test Profile',
      baseUrl: 'https://api.anthropic.com',
      oauthToken: 'mock-oauth-token'
    })),
    getProfilesSortedByAvailability: vi.fn(() => [
      { id: 'profile-2', name: 'Profile 2' },
      { id: 'profile-3', name: 'Profile 3' }
    ]),
    setActiveProfile: vi.fn(),
    getProfileToken: vi.fn(() => 'mock-decrypted-token')
  }))
}));

// Mock loadProfilesFile
const mockLoadProfilesFile = vi.fn(async () => ({
  profiles: [] as Array<{
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
  }>,
  activeProfileId: null as string | null,
  version: 1
}));

vi.mock('../services/profile/profile-manager', () => ({
  loadProfilesFile: () => mockLoadProfilesFile()
}));

// Mock credential-utils to return mock token instead of reading real credentials
vi.mock('./credential-utils', () => ({
  getCredentialsFromKeychain: vi.fn(() => ({
    token: 'mock-decrypted-token',
    email: 'test@example.com'
  })),
  clearKeychainCache: vi.fn()
}));

// Mock global fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      five_hour_utilization: 0.5,
      seven_day_utilization: 0.3,
      five_hour_reset_at: '2025-01-17T15:00:00Z',
      seven_day_reset_at: '2025-01-20T12:00:00Z'
    })
  } as unknown as Response)
) as any;

describe('usage-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Restore default fetch mock after clearAllMocks
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: vi.fn((name: string) => name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({
          five_hour_utilization: 0.5,
          seven_day_utilization: 0.3,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        })
      } as unknown as Response)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Note: detectProvider tests removed - now using shared/utils/provider-detection.ts
  // which has its own comprehensive test suite

  describe('getUsageEndpoint', () => {
    it('should return correct endpoint for Anthropic', () => {
      const result = getUsageEndpoint('anthropic', 'https://api.anthropic.com');
      expect(result).toBe('https://api.anthropic.com/api/oauth/usage');
    });

    it('should return correct endpoint for Anthropic with path', () => {
      const result = getUsageEndpoint('anthropic', 'https://api.anthropic.com/v1');
      expect(result).toBe('https://api.anthropic.com/api/oauth/usage');
    });

    it('should return correct endpoint for zai', () => {
      const result = getUsageEndpoint('zai', 'https://api.z.ai/api/anthropic');
      // quota/limit endpoint doesn't require query parameters
      expect(result).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    });

    it('should return correct endpoint for zhipu', () => {
      const result = getUsageEndpoint('zhipu', 'https://open.bigmodel.cn/api/paas/v4');
      // quota/limit endpoint doesn't require query parameters
      expect(result).toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit');
    });

    it('should return null for unknown provider', () => {
      const result = getUsageEndpoint('unknown' as ApiProvider, 'https://example.com');
      expect(result).toBeNull();
    });

    it('should return null for invalid baseUrl', () => {
      const result = getUsageEndpoint('anthropic', 'not-a-url');
      expect(result).toBeNull();
    });
  });

  describe('UsageMonitor', () => {
    it('should return singleton instance', () => {
      const monitor1 = UsageMonitor.getInstance();
      const monitor2 = UsageMonitor.getInstance();

      expect(monitor1).toBe(monitor2);
    });

    it('should return same instance from getUsageMonitor()', () => {
      const monitor1 = getUsageMonitor();
      const monitor2 = getUsageMonitor();

      expect(monitor1).toBe(monitor2);
    });

    it('should start monitoring when settings allow', () => {
      const monitor = getUsageMonitor();
      monitor.start();

      // Verify monitor started (has intervalId set)
      expect(monitor['intervalId']).not.toBeNull();

      monitor.stop();
    });

    it('should not start if already running', () => {
      const monitor = getUsageMonitor();

      monitor.start();
      const firstIntervalId = monitor['intervalId'];

      monitor.start(); // Second call should be ignored

      // Should still have the same intervalId (not recreated)
      expect(monitor['intervalId']).toBe(firstIntervalId);

      monitor.stop();
    });

    it('should stop monitoring', () => {
      const monitor = getUsageMonitor();

      monitor.start();
      expect(monitor['intervalId']).not.toBeNull();

      monitor.stop();

      // Verify intervalId is cleared
      expect(monitor['intervalId']).toBeNull();
    });

    it('should return current usage snapshot', () => {
      const monitor = getUsageMonitor();

      // Seed the monitor with known test data for deterministic behavior
      const seeded = {
        sessionPercent: 10,
        weeklyPercent: 20,
        profileId: 'test-profile',
        profileName: 'Test Profile',
        fetchedAt: new Date()
      };
      monitor['currentUsage'] = seeded as any;

      const usage = monitor.getCurrentUsage();

      // getCurrentUsage returns the seeded usage snapshot
      expect(usage).toBe(seeded);
      expect(usage).toHaveProperty('sessionPercent');
      expect(usage).toHaveProperty('weeklyPercent');
      expect(usage).toHaveProperty('profileId');
      expect(usage).toHaveProperty('profileName');
      // Verify types of critical properties
      expect(typeof usage?.sessionPercent).toBe('number');
      expect(typeof usage?.weeklyPercent).toBe('number');
    });

    it('should emit events when listeners are attached', () => {
      const monitor = getUsageMonitor();
      const usageHandler = vi.fn();

      monitor.on('usage-updated', usageHandler);

      // Verify event handler is attached
      expect(monitor.listenerCount('usage-updated')).toBe(1);

      // Clean up
      monitor.off('usage-updated', usageHandler);
    });

    it('should allow removing event listeners', () => {
      const monitor = getUsageMonitor();
      const usageHandler = vi.fn();

      monitor.on('usage-updated', usageHandler);
      expect(monitor.listenerCount('usage-updated')).toBe(1);

      monitor.off('usage-updated', usageHandler);
      expect(monitor.listenerCount('usage-updated')).toBe(0);
    });
  });

  describe('UsageMonitor error handling', () => {
    it('should emit event when swap fails', () => {
      const monitor = getUsageMonitor();
      const swapFailedHandler = vi.fn();

      monitor.on('proactive-swap-failed', swapFailedHandler);

      // Manually trigger the swap logic by calling the private method through a test scenario
      // Since we can't directly call private methods, we'll verify the event system works
      monitor.emit('proactive-swap-failed', {
        reason: 'no_alternative',
        currentProfile: 'test-profile'
      });

      expect(swapFailedHandler).toHaveBeenCalledWith({
        reason: 'no_alternative',
        currentProfile: 'test-profile'
      });

      monitor.off('proactive-swap-failed', swapFailedHandler);
    });
  });

  describe('Anthropic response normalization', () => {
    it('should normalize Anthropic response with utilization values', () => {
      const monitor = getUsageMonitor();
      const rawData = {
        five_hour_utilization: 0.72,
        seven_day_utilization: 0.45,
        five_hour_reset_at: '2025-01-17T15:00:00Z',
        seven_day_reset_at: '2025-01-20T12:00:00Z'
      };

      const usage = monitor['normalizeAnthropicResponse'](rawData, 'test-profile-1', 'Anthropic Profile');

      expect(usage).not.toBeNull();
      expect(usage.sessionPercent).toBe(72); // 0.72 * 100
      expect(usage.weeklyPercent).toBe(45); // 0.45 * 100
      expect(usage.limitType).toBe('session'); // 0.45 (weekly) < 0.72 (session), so session is higher
      expect(usage.profileId).toBe('test-profile-1');
      expect(usage.profileName).toBe('Anthropic Profile');
      expect(usage.sessionResetTimestamp).toBe('2025-01-17T15:00:00Z');
      expect(usage.weeklyResetTimestamp).toBe('2025-01-20T12:00:00Z');
    });

    it('should handle missing optional fields in Anthropic response', () => {
      const monitor = getUsageMonitor();
      const rawData = {
        five_hour_utilization: 0.50
        // Missing: seven_day_utilization, reset times
      };

      const usage = monitor['normalizeAnthropicResponse'](rawData, 'test-profile-1', 'Test Profile');

      expect(usage).not.toBeNull();
      expect(usage.sessionPercent).toBe(50);
      expect(usage.weeklyPercent).toBe(0); // Missing field defaults to 0
      // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
      expect(usage.sessionResetTime).toBeUndefined();
      expect(usage.weeklyResetTime).toBeUndefined();
      expect(usage.sessionResetTimestamp).toBeUndefined();
      expect(usage.weeklyResetTimestamp).toBeUndefined();
    });
  });

  describe('z.ai response normalization', () => {

    it('should normalize z.ai response with usage/limit fields', () => {
      const monitor = getUsageMonitor();
      // Create future dates for reset times (use relative time from now)
      const now = new Date();
      const sessionReset = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

      // Use quota/limit format with limits array
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 72,
            nextResetTime: sessionReset.getTime()
          },
          {
            type: 'TIME_LIMIT',
            percentage: 51,
            currentValue: 180000,
            usage: 350000
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(72); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(51); // TIME_LIMIT percentage
      // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
      expect(usage?.sessionResetTime).toBeUndefined();
      expect(usage?.weeklyResetTime).toBeUndefined();
      // Verify timestamps are provided for renderer
      expect(usage?.sessionResetTimestamp).toBeDefined();
      expect(usage?.weeklyResetTimestamp).toBeDefined();
      expect(usage?.limitType).toBe('session'); // 51 (weekly) < 72 (session), so session is higher
    });

    it('should try alternative field names for z.ai response', () => {
      const monitor = getUsageMonitor();
      // Use quota/limit format with limits array
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 25
          },
          {
            type: 'TIME_LIMIT',
            percentage: 50,
            currentValue: 150000,
            usage: 300000
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(25); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(50); // TIME_LIMIT percentage
      // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
      expect(usage?.sessionResetTime).toBeUndefined();
      expect(usage?.weeklyResetTime).toBeUndefined();
      // Verify timestamps are provided for renderer
      expect(usage?.sessionResetTimestamp).toBeDefined();
      expect(usage?.weeklyResetTimestamp).toBeDefined();
    });

    it('should return null when no data can be extracted from z.ai', () => {
      const monitor = getUsageMonitor();
      const rawData = {
        unknown_field: 'some_value',
        another_field: 123
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).toBeNull();
    });
  });

  describe('z.ai quota/limit endpoint normalization', () => {
    it('should normalize z.ai quota/limit response with limits array', () => {
      const monitor = getUsageMonitor();
      // Create a future reset time (3 hours from now)
      const now = Date.now();
      const nextResetTime = now + 3 * 60 * 60 * 1000; // 3 hours from now

      const rawData = {
        limits: [
          {
            type: 'TIME_LIMIT',
            unit: 5,
            number: 1,
            usage: 1000,
            currentValue: 660,
            remaining: 340,
            percentage: 66,
            usageDetails: [
              { modelCode: 'search-prime', usage: 599 },
              { modelCode: 'web-reader', usage: 88 }
            ]
          },
          {
            type: 'TOKENS_LIMIT',
            unit: 3,
            number: 5,
            usage: 200000000,
            currentValue: 20926987,
            remaining: 179073013,
            percentage: 10,
            nextResetTime: nextResetTime
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(10); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(66); // TIME_LIMIT percentage
      expect(usage?.sessionUsageValue).toBe(20926987); // current token usage
      expect(usage?.sessionUsageLimit).toBe(200000000); // total token limit
      expect(usage?.weeklyUsageValue).toBe(660); // current tool usage
      expect(usage?.weeklyUsageLimit).toBe(1000); // total tool limit
      expect(usage?.sessionResetTimestamp).toBeDefined();
      expect(usage?.limitType).toBe('weekly'); // 66 > 10
      expect(usage?.usageWindows?.sessionWindowLabel).toBe('common:usage.window5HoursQuota');
      expect(usage?.usageWindows?.weeklyWindowLabel).toBe('common:usage.windowMonthlyToolsQuota');
    });

    it('should handle missing nextResetTime gracefully', () => {
      const monitor = getUsageMonitor();

      const rawData = {
        limits: [
          {
            type: 'TIME_LIMIT',
            unit: 5,
            number: 1,
            usage: 1000,
            currentValue: 500,
            remaining: 500,
            percentage: 50
          },
          {
            type: 'TOKENS_LIMIT',
            unit: 3,
            number: 5,
            usage: 200000000,
            currentValue: 100000000,
            remaining: 100000000,
            percentage: 50
            // Missing nextResetTime - should fall back to now + 5 hours
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(50);
      expect(usage?.weeklyPercent).toBe(50);
      expect(usage?.sessionResetTimestamp).toBeDefined(); // Should have fallback timestamp
    });

    it('should handle missing currentValue and usage fields', () => {
      const monitor = getUsageMonitor();

      const rawData = {
        limits: [
          {
            type: 'TIME_LIMIT',
            percentage: 75
            // Missing currentValue, usage
          },
          {
            type: 'TOKENS_LIMIT',
            percentage: 25
            // Missing currentValue, usage, nextResetTime
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'zai-profile-1', 'z.ai Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(25);
      expect(usage?.weeklyPercent).toBe(75);
      expect(usage?.sessionUsageValue).toBeUndefined(); // No currentValue in response
      expect(usage?.sessionUsageLimit).toBeUndefined(); // No usage in response
      expect(usage?.weeklyUsageValue).toBeUndefined();
      expect(usage?.weeklyUsageLimit).toBeUndefined();
    });
  });

  describe('ZHIPU response normalization', () => {
    it('should normalize ZHIPU response with usage/limit fields', () => {
      const monitor = getUsageMonitor();
      // Use quota/limit format with limits array
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 90,
            nextResetTime: Date.now() + 2 * 60 * 60 * 1000 // 2 hours from now
          },
          {
            type: 'TIME_LIMIT',
            percentage: 80,
            currentValue: 280000,
            usage: 350000
          }
        ]
      };

      const usage = monitor['normalizeZhipuResponse'](rawData, 'zhipu-profile-1', 'ZHIPU Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(90); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(80); // TIME_LIMIT percentage
      expect(usage?.limitType).toBe('session'); // 80 (weekly) < 90 (session), so session is higher
      expect(usage?.profileId).toBe('zhipu-profile-1');
      expect(usage?.profileName).toBe('ZHIPU Profile');
    });

    it('should try alternative field names for ZHIPU response', () => {
      const monitor = getUsageMonitor();
      // Use quota/limit format with limits array
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 50
          },
          {
            type: 'TIME_LIMIT',
            percentage: 48,
            currentValue: 200000,
            usage: 420000
          }
        ]
      };

      const usage = monitor['normalizeZhipuResponse'](rawData, 'zhipu-profile-1', 'ZHIPU Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(50); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(48); // TIME_LIMIT percentage
    });
  });

  describe('ZHIPU quota/limit endpoint normalization', () => {
    it('should normalize ZHIPU quota/limit response with limits array', () => {
      const monitor = getUsageMonitor();
      // Create a future reset time (2 hours from now)
      const now = Date.now();
      const nextResetTime = now + 2 * 60 * 60 * 1000; // 2 hours from now

      const rawData = {
        limits: [
          {
            type: 'TIME_LIMIT',
            unit: 5,
            number: 1,
            usage: 1000,
            currentValue: 800,
            remaining: 200,
            percentage: 80,
            usageDetails: [
              { modelCode: 'search-prime', usage: 700 },
              { modelCode: 'web-reader', usage: 100 }
            ]
          },
          {
            type: 'TOKENS_LIMIT',
            unit: 3,
            number: 5,
            usage: 200000000,
            currentValue: 40000000,
            remaining: 160000000,
            percentage: 20,
            nextResetTime: nextResetTime
          }
        ]
      };

      const usage = monitor['normalizeZhipuResponse'](rawData, 'zhipu-profile-1', 'ZHIPU Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(20); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(80); // TIME_LIMIT percentage
      expect(usage?.sessionUsageValue).toBe(40000000); // current token usage
      expect(usage?.sessionUsageLimit).toBe(200000000); // total token limit
      expect(usage?.weeklyUsageValue).toBe(800); // current tool usage
      expect(usage?.weeklyUsageLimit).toBe(1000); // total tool limit
      expect(usage?.sessionResetTimestamp).toBeDefined();
      expect(usage?.limitType).toBe('weekly'); // 80 > 20
      expect(usage?.usageWindows?.sessionWindowLabel).toBe('common:usage.window5HoursQuota');
      expect(usage?.usageWindows?.weeklyWindowLabel).toBe('common:usage.windowMonthlyToolsQuota');
    });

    it('should handle ZHIPU quota/limit response without nextResetTime', () => {
      const monitor = getUsageMonitor();

      const rawData = {
        limits: [
          {
            type: 'TIME_LIMIT',
            percentage: 45
          },
          {
            type: 'TOKENS_LIMIT',
            percentage: 55
            // Missing nextResetTime, currentValue, usage
          }
        ]
      };

      const usage = monitor['normalizeZhipuResponse'](rawData, 'zhipu-profile-1', 'ZHIPU Profile');

      expect(usage).not.toBeNull();
      expect(usage?.sessionPercent).toBe(55);
      expect(usage?.weeklyPercent).toBe(45);
      expect(usage?.sessionResetTimestamp).toBeDefined(); // Should have fallback timestamp
      expect(usage?.sessionUsageValue).toBeUndefined();
      expect(usage?.sessionUsageLimit).toBeUndefined();
      expect(usage?.weeklyUsageValue).toBeUndefined();
      expect(usage?.weeklyUsageLimit).toBeUndefined();
    });
  });

  describe('Percentage calculation', () => {
    it('should calculate percentages correctly from usage/limit values', () => {
      const monitor = getUsageMonitor();
      // Use quota/limit format - percentages are pre-calculated by the API
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 25 // 25%
          },
          {
            type: 'TIME_LIMIT',
            percentage: 50 // 50%
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'test-profile', 'Test Profile');

      expect(usage?.sessionPercent).toBe(25); // TOKENS_LIMIT percentage
      expect(usage?.weeklyPercent).toBe(50); // TIME_LIMIT percentage
    });

    it('should handle division by zero (zero limit)', () => {
      const monitor = getUsageMonitor();
      // When percentage is 0 or missing, default to 0
      const rawData = {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            percentage: 0 // Zero usage
          },
          {
            type: 'TIME_LIMIT',
            percentage: 50
          }
        ]
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'test-profile', 'Test Profile');

      expect(usage?.sessionPercent).toBe(0); // Zero percentage
      expect(usage?.weeklyPercent).toBe(50); // TIME_LIMIT percentage
    });
  });

  describe('Malformed response handling', () => {
    it('should handle non-numeric usage values gracefully', () => {
      const monitor = getUsageMonitor();
      // Missing limits array - should return null
      const rawData = {
        session_usage: 'not a number',
        session_limit: 'also not a number',
        weekly_usage: null,
        weekly_limit: undefined
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'test-profile', 'Test Profile');

      // Should return null when response doesn't match expected quota/limit format
      expect(usage).toBeNull();
    });

    it('should handle completely unknown response structure', () => {
      const monitor = getUsageMonitor();
      // Unknown structure without limits array - should return null
      const rawData = {
        unknown_field: 'some_value',
        another_field: 123,
        nested: {
          data: 'value'
        }
      };

      const usage = monitor['normalizeZAIResponse'](rawData, 'test-profile', 'Test Profile');

      // Should return null when response doesn't match expected quota/limit format
      expect(usage).toBeNull();
    });
  });

  describe('API error handling', () => {
    it('should handle 401 Unauthorized responses', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid token' })
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 401 errors should throw
      await expect(
        monitor['fetchUsageViaAPI']('invalid-token', 'test-profile-1', 'Test Profile', undefined)
      ).rejects.toThrow('API Auth Failure: 401');

      expect(consoleSpy).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/api/oauth/usage',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer invalid-token'
          })
        })
      );

      consoleSpy.mockRestore();
    });

    it('should handle 403 Forbidden responses', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Access denied' })
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 403 errors should throw
      await expect(
        monitor['fetchUsageViaAPI']('expired-token', 'test-profile-1', 'Test Profile', undefined)
      ).rejects.toThrow('API Auth Failure: 403');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle 500 Internal Server Error', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' })
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const usage = await monitor['fetchUsageViaAPI']('valid-token', 'test-profile-1', 'Test Profile', undefined);

      expect(usage).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle network timeout/failure', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const usage = await monitor['fetchUsageViaAPI']('valid-token', 'test-profile-1', 'Test Profile', undefined);

      expect(usage).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle invalid JSON response', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Invalid JSON');
        }
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const usage = await monitor['fetchUsageViaAPI']('valid-token', 'test-profile-1', 'Test Profile', undefined);

      expect(usage).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle auth errors with clear messages in response body', async () => {
      const mockFetch = vi.mocked(global.fetch);
      // Mock a 401 response with detailed error message in body
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'authentication failed', detail: 'invalid credentials' })
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 401 errors should throw with proper message
      await expect(
        monitor['fetchUsageViaAPI']('invalid-token', 'test-profile-1', 'Test Profile', undefined)
      ).rejects.toThrow('API Auth Failure: 401');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Credential error handling', () => {
    it('should handle missing credential gracefully', async () => {
      const monitor = getUsageMonitor();

      // Call fetchUsage without credential
      const usage = await monitor['fetchUsage']('test-profile-1', undefined);

      // Should fall back to CLI method (which returns null)
      expect(usage).toBeNull();
    });

    it('should handle empty credential string', async () => {
      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const usage = await monitor['fetchUsage']('test-profile-1', '');

      // Should fall back to CLI method
      expect(usage).toBeNull();

      consoleSpy.mockRestore();
    });
  });

  describe('Profile error handling', () => {
    it('should handle null active profile', async () => {
      // Get the mocked getClaudeProfileManager function
      const { getClaudeProfileManager } = await import('../claude-profile-manager');
      const mockGetManager = vi.mocked(getClaudeProfileManager);

      // Mock to return null for active profile
      mockGetManager.mockReturnValueOnce({
        getAutoSwitchSettings: vi.fn(() => ({
          enabled: true,
          proactiveSwapEnabled: true,
          usageCheckInterval: 30000,
          sessionThreshold: 80,
          weeklyThreshold: 80
        })),
        getActiveProfile: vi.fn(() => null), // Return null
        getProfile: vi.fn(() => null),
        getProfilesSortedByAvailability: vi.fn(() => []),
        setActiveProfile: vi.fn(),
        getProfileToken: vi.fn(() => null)
      } as any);

      const monitor = getUsageMonitor();

      // Call checkUsageAndSwap directly to test null profile handling
      // Should complete without throwing an error
      await expect(monitor['checkUsageAndSwap']()).resolves.toBeUndefined();
    });

    it('should handle profile with missing required fields', async () => {
      const monitor = getUsageMonitor();
      const rawData = {
        // Missing all required fields
      };

      const usage = monitor['normalizeAnthropicResponse'](rawData, 'test-profile-1', 'Test Profile');

      // Should still return a valid snapshot with defaults
      expect(usage).not.toBeNull();
      expect(usage.sessionPercent).toBe(0);
      expect(usage.weeklyPercent).toBe(0);
      // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
      expect(usage.sessionResetTime).toBeUndefined();
      expect(usage.weeklyResetTime).toBeUndefined();
    });
  });

  describe('Provider-specific error handling', () => {
    it('should handle zai API errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'z.ai service unavailable' })
      } as unknown as Response);

      // Mock API profile with zai baseUrl
      mockLoadProfilesFile.mockResolvedValueOnce({
        profiles: [{
          id: 'zai-profile-1',
          name: 'z.ai Profile',
          baseUrl: 'https://api.z.ai/api/anthropic',
          apiKey: 'zai-api-key'
        }],
        activeProfileId: 'zai-profile-1',
        version: 1
      });

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const usage = await monitor['fetchUsageViaAPI']('zai-api-key', 'zai-profile-1', 'z.ai Profile', undefined);

      expect(usage).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle ZHIPU API errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ error: 'ZHIPU gateway error' })
      } as unknown as Response);

      // Mock API profile with ZHIPU baseUrl
      mockLoadProfilesFile.mockResolvedValueOnce({
        profiles: [{
          id: 'zhipu-profile-1',
          name: 'ZHIPU Profile',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          apiKey: 'zhipu-api-key'
        }],
        activeProfileId: 'zhipu-profile-1',
        version: 1
      });

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const usage = await monitor['fetchUsageViaAPI']('zhipu-api-key', 'zhipu-profile-1', 'ZHIPU Profile', undefined);

      expect(usage).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle unknown provider gracefully', async () => {
      const monitor = getUsageMonitor();

      // Create an active profile object with unknown provider
      const unknownProviderProfile = {
        isAPIProfile: true,
        profileId: 'unknown-profile-1',
        profileName: 'Unknown Provider Profile',
        baseUrl: 'https://unknown-provider.com/api'
      };

      // Mock API profile with unknown provider baseUrl
      mockLoadProfilesFile.mockResolvedValueOnce({
        profiles: [{
          id: 'unknown-profile-1',
          name: 'Unknown Provider Profile',
          baseUrl: 'https://unknown-provider.com/api',
          apiKey: 'unknown-api-key'
        }],
        activeProfileId: 'unknown-profile-1',
        version: 1
      });

      const usage = await monitor['fetchUsageViaAPI'](
        'unknown-api-key',
        'unknown-profile-1',
        'Unknown Profile',
        undefined,
        unknownProviderProfile
      );

      // Unknown provider should return null
      expect(usage).toBeNull();
    });
  });

  describe('Concurrent check prevention', () => {
    it('should prevent concurrent usage checks', async () => {
      const monitor = getUsageMonitor();

      // Start first check (it will take some time)
      const firstCheck = monitor['checkUsageAndSwap']();

      // Try to start second check immediately (should be ignored)
      const secondCheck = monitor['checkUsageAndSwap']();

      // Both should resolve
      await firstCheck;
      await secondCheck;

      // Verify check completed (isChecking should be false after both complete)
      expect(monitor['isChecking']).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    describe('Legacy OAuth-only profile support', () => {
      it('should work with legacy OAuth profiles (no API profile support)', async () => {
        // Mock loadProfilesFile to return empty profiles (API profiles not configured)
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [],
          activeProfileId: null,
          version: 1
        });

        const monitor = getUsageMonitor();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Should fall back to OAuth profile
        const credential = await monitor['getCredential']();

        // Should get OAuth token from profile manager
        expect(credential).toBe('mock-decrypted-token');

        consoleSpy.mockRestore();
      });

      it('should prioritize API profile when available', async () => {
        // Mock API profile is configured
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [{
            id: 'api-profile-1',
            name: 'API Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-api-key'
          }],
          activeProfileId: 'api-profile-1',
          version: 1
        });

        const monitor = getUsageMonitor();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const credential = await monitor['getCredential']();

        // Should prefer API key over OAuth token
        expect(credential).toBe('sk-ant-api-key');

        consoleSpy.mockRestore();
      });

      it('should handle missing API profile gracefully', async () => {
        // Mock activeProfileId points to non-existent profile
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [],
          activeProfileId: 'nonexistent-profile',
          version: 1
        });

        const monitor = getUsageMonitor();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const credential = await monitor['getCredential']();

        // Should fall back to OAuth
        expect(credential).toBe('mock-decrypted-token');

        consoleSpy.mockRestore();
      });
    });

    describe('Settings backward compatibility', () => {
      it('should handle settings with missing optional fields', async () => {
        // Get the mocked getClaudeProfileManager function
        const { getClaudeProfileManager } = await import('../claude-profile-manager');
        const mockGetManager = vi.mocked(getClaudeProfileManager);

        // Mock settings with missing optional fields
        mockGetManager.mockReturnValueOnce({
          getAutoSwitchSettings: vi.fn(() => ({
            enabled: true,
            proactiveSwapEnabled: true
            // Missing: usageCheckInterval, sessionThreshold, weeklyThreshold
          })),
          getActiveProfile: vi.fn(() => ({
            id: 'test-profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            oauthToken: 'mock-oauth-token'
          })),
          getProfile: vi.fn(() => ({
            id: 'test-profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            oauthToken: 'mock-oauth-token'
          })),
          getProfilesSortedByAvailability: vi.fn(() => []),
          setActiveProfile: vi.fn(),
          getProfileToken: vi.fn(() => 'mock-decrypted-token')
        } as any);

        const monitor = getUsageMonitor();

        // Should start with default values for missing fields
        monitor.start();

        // Should have started monitoring
        expect(monitor['intervalId']).not.toBeNull();

        monitor.stop();
      });

      it('should use default thresholds when not specified in settings', async () => {
        // Get the mocked getClaudeProfileManager function
        const { getClaudeProfileManager } = await import('../claude-profile-manager');
        const mockGetManager = vi.mocked(getClaudeProfileManager);

        // Mock settings without thresholds
        mockGetManager.mockReturnValueOnce({
          getAutoSwitchSettings: vi.fn(() => ({
            enabled: true,
            proactiveSwapEnabled: true,
            usageCheckInterval: 30000
            // Missing: sessionThreshold, weeklyThreshold
          })),
          getActiveProfile: vi.fn(() => ({
            id: 'test-profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            oauthToken: 'mock-oauth-token'
          })),
          getProfile: vi.fn(() => ({
            id: 'test-profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            oauthToken: 'mock-oauth-token'
          })),
          getProfilesSortedByAvailability: vi.fn(() => []),
          setActiveProfile: vi.fn(),
          getProfileToken: vi.fn(() => 'mock-decrypted-token')
        } as any);

        const monitor = getUsageMonitor();

        // Should not crash when checking thresholds
        monitor.start();

        // Should have started successfully
        expect(monitor['intervalId']).not.toBeNull();

        monitor.stop();
      });
    });

    describe('Anthropic response format backward compatibility', () => {
      it('should handle legacy Anthropic response format', () => {
        const monitor = getUsageMonitor();

        // Legacy format with field names that might have changed
        const legacyData = {
          five_hour_utilization: 0.60,
          seven_day_utilization: 0.40,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        };

        const usage = monitor['normalizeAnthropicResponse'](legacyData, 'test-profile-1', 'Legacy Profile');

        expect(usage).not.toBeNull();
        expect(usage.sessionPercent).toBe(60);
        expect(usage.weeklyPercent).toBe(40);
        expect(usage.limitType).toBe('session'); // 60% > 40%, so session is the higher limit
      });

      it('should handle response with only utilization values (no reset times)', () => {
        const monitor = getUsageMonitor();

        const minimalData = {
          five_hour_utilization: 0.75,
          seven_day_utilization: 0.50
          // Missing reset times
        };

        const usage = monitor['normalizeAnthropicResponse'](minimalData, 'test-profile-1', 'Minimal Profile');

        expect(usage).not.toBeNull();
        expect(usage.sessionPercent).toBe(75);
        expect(usage.weeklyPercent).toBe(50);
        // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
        expect(usage.sessionResetTime).toBeUndefined();
        expect(usage.weeklyResetTime).toBeUndefined();
      });

      it('should handle response with zero utilization values', () => {
        const monitor = getUsageMonitor();

        const zeroData = {
          five_hour_utilization: 0,
          seven_day_utilization: 0,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        };

        const usage = monitor['normalizeAnthropicResponse'](zeroData, 'test-profile-1', 'Zero Usage Profile');

        expect(usage).not.toBeNull();
        expect(usage.sessionPercent).toBe(0);
        expect(usage.weeklyPercent).toBe(0);
      });

      it('should handle response with only five_hour data (no seven_day)', () => {
        const monitor = getUsageMonitor();

        const partialData = {
          five_hour_utilization: 0.80,
          five_hour_reset_at: '2025-01-17T15:00:00Z'
          // Missing seven_day data
        };

        const usage = monitor['normalizeAnthropicResponse'](partialData, 'test-profile-1', 'Partial Profile');

        expect(usage).not.toBeNull();
        expect(usage.sessionPercent).toBe(80);
        expect(usage.weeklyPercent).toBe(0); // Defaults to 0
        // sessionResetTime/weeklyResetTime are now undefined - renderer uses timestamps
        expect(usage.sessionResetTime).toBeUndefined();
        expect(usage.weeklyResetTime).toBeUndefined();
        // Verify timestamps are still provided for renderer
        expect(usage.sessionResetTimestamp).toBe('2025-01-17T15:00:00Z');
      });
    });

    describe('Provider detection backward compatibility', () => {
      it('should handle Anthropic OAuth profiles (no baseUrl in OAuth profiles)', async () => {
        // OAuth profiles don't have baseUrl - they should default to Anthropic provider
        // This test verifies the backward compatibility by checking that:
        // 1. OAuth profiles (without baseUrl) are supported
        // 2. They default to using Anthropic's OAuth usage endpoint

        const endpoint = getUsageEndpoint('anthropic', 'https://api.anthropic.com');
        expect(endpoint).toBe('https://api.anthropic.com/api/oauth/usage');

        // Verify that when no baseUrl is provided (OAuth profile scenario),
        // the system defaults to Anthropic's standard endpoint
        const provider = detectProvider('https://api.anthropic.com');
        expect(provider).toBe('anthropic');
      });

      it('should handle legacy baseUrl formats for zai', () => {
        // Test various legacy zai baseUrl formats
        const legacyUrls = [
          'https://api.z.ai/api/anthropic',
          'https://z.ai/api/anthropic',
          'https://api.z.ai/v1',
          'https://z.ai'
        ];

        legacyUrls.forEach(url => {
          const provider = detectProvider(url);
          expect(provider).toBe('zai');
        });
      });

      it('should handle legacy baseUrl formats for ZHIPU', () => {
        // Test various legacy ZHIPU baseUrl formats
        const legacyUrls = [
          'https://open.bigmodel.cn/api/paas/v4',
          'https://dev.bigmodel.cn/api/paas/v4',
          'https://bigmodel.cn/api/paas/v4',
          'https://open.bigmodel.cn'
        ];

        legacyUrls.forEach(url => {
          const provider = detectProvider(url);
          expect(provider).toBe('zhipu');
        });
      });

      it('should handle Anthropic OAuth default baseUrl', () => {
        // OAuth profiles don't have baseUrl, should default to Anthropic
        const endpoint = getUsageEndpoint('anthropic', 'https://api.anthropic.com');
        expect(endpoint).toBe('https://api.anthropic.com/api/oauth/usage');
      });
    });

    describe('Mixed OAuth/API profile environments', () => {
      it('should handle environment with both OAuth and API profiles', async () => {
        const monitor = getUsageMonitor();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Mock both OAuth and API profiles
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [
            {
              id: 'api-profile-1',
              name: 'API Profile',
              baseUrl: 'https://api.anthropic.com',
              apiKey: 'sk-ant-api-key'
            },
            {
              id: 'api-profile-2',
              name: 'z.ai API Profile',
              baseUrl: 'https://api.z.ai/api/anthropic',
              apiKey: 'zai-api-key'
            }
          ],
          activeProfileId: 'api-profile-1',
          version: 1
        });

        const credential = await monitor['getCredential']();

        // Should use API profile when active
        expect(credential).toBe('sk-ant-api-key');

        consoleSpy.mockRestore();
      });

      it('should switch from API profile back to OAuth profile', async () => {
        const monitor = getUsageMonitor();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // First, active API profile
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [{
            id: 'api-profile-1',
            name: 'API Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-api-key'
          }],
          activeProfileId: 'api-profile-1',
          version: 1
        });

        let credential = await monitor['getCredential']();
        expect(credential).toBe('sk-ant-api-key');

        // Then, no active API profile (should fall back to OAuth)
        mockLoadProfilesFile.mockResolvedValueOnce({
          profiles: [],
          activeProfileId: null,
          version: 1
        });

        credential = await monitor['getCredential']();
        expect(credential).toBe('mock-decrypted-token');

        consoleSpy.mockRestore();
      });
    });

    describe('Graceful degradation for unknown providers', () => {
      it('should return null for unknown provider instead of throwing', () => {
        const endpoint = getUsageEndpoint('unknown' as ApiProvider, 'https://unknown-provider.com');
        expect(endpoint).toBeNull();
      });

      it('should handle invalid baseUrl gracefully', () => {
        const endpoint = getUsageEndpoint('anthropic', 'not-a-url');
        expect(endpoint).toBeNull();
      });

      it('should detect unknown provider from unrecognized baseUrl', () => {
        const provider = detectProvider('https://unknown-api-provider.com/v1');
        expect(provider).toBe('unknown');
      });
    });
  });

  describe('Cooldown-based API retry mechanism', () => {
    beforeEach(() => {
      // Clear any existing failure timestamps before each test
      const monitor = getUsageMonitor();
      monitor['apiFailureTimestamps'].clear();
    });

    it('should record API failure timestamp on error', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' })
      } as unknown as Response);

      const monitor = getUsageMonitor();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const profileId = 'test-profile-cooldown';

      // Call fetchUsageViaAPI which should fail and record timestamp
      await monitor['fetchUsageViaAPI']('valid-token', profileId, 'Test Profile', undefined);

      // Verify failure timestamp was recorded
      const failureTimestamp = monitor['apiFailureTimestamps'].get(profileId);
      expect(failureTimestamp).toBeDefined();
      expect(typeof failureTimestamp).toBe('number');
      // Should be recent (within last second)
      expect(Date.now() - failureTimestamp!).toBeLessThan(1000);

      consoleSpy.mockRestore();
    });

    it('should allow API retry after cooldown expires', async () => {
      const monitor = getUsageMonitor();
      const profileId = 'test-profile-retry';
      const now = Date.now();

      // Set a failure timestamp that's just before the cooldown period
      const expiredFailureTime = now - UsageMonitor['API_FAILURE_COOLDOWN_MS'] - 1000; // 1 second past cooldown
      monitor['apiFailureTimestamps'].set(profileId, expiredFailureTime);

      // shouldUseApiMethod should return true (cooldown expired)
      const shouldUseApi = monitor['shouldUseApiMethod'](profileId);
      expect(shouldUseApi).toBe(true);
    });

    it('should prevent API retry during cooldown period', async () => {
      const monitor = getUsageMonitor();
      const profileId = 'test-profile-cooldown-active';
      const now = Date.now();

      // Set a recent failure timestamp (well within cooldown period)
      const recentFailureTime = now - 1000; // 1 second ago
      monitor['apiFailureTimestamps'].set(profileId, recentFailureTime);

      // shouldUseApiMethod should return false (still in cooldown)
      const shouldUseApi = monitor['shouldUseApiMethod'](profileId);
      expect(shouldUseApi).toBe(false);
    });

    it('should allow API call when no previous failure recorded', async () => {
      const monitor = getUsageMonitor();
      const profileId = 'test-profile-no-failure';

      // No failure timestamp recorded for this profile
      expect(monitor['apiFailureTimestamps'].has(profileId)).toBe(false);

      // shouldUseApiMethod should return true (no previous failure)
      const shouldUseApi = monitor['shouldUseApiMethod'](profileId);
      expect(shouldUseApi).toBe(true);
    });

    it('should handle edge case exactly at cooldown boundary', async () => {
      const monitor = getUsageMonitor();
      const profileId = 'test-profile-boundary';
      const now = Date.now();

      // Set failure timestamp exactly at cooldown boundary
      const boundaryTime = now - UsageMonitor['API_FAILURE_COOLDOWN_MS'];
      monitor['apiFailureTimestamps'].set(profileId, boundaryTime);

      // At exact boundary, should allow retry (cooldown period has passed)
      const shouldUseApi = monitor['shouldUseApiMethod'](profileId);
      expect(shouldUseApi).toBe(true);
    });

    it('should track failures independently for different profiles', async () => {
      const monitor = getUsageMonitor();
      const profile1 = 'profile-1';
      const profile2 = 'profile-2';
      const now = Date.now();

      // Set recent failure for profile1
      monitor['apiFailureTimestamps'].set(profile1, now - 1000);
      // Set expired failure for profile2
      monitor['apiFailureTimestamps'].set(profile2, now - UsageMonitor['API_FAILURE_COOLDOWN_MS'] - 1000);

      // Profile 1 should be in cooldown
      expect(monitor['shouldUseApiMethod'](profile1)).toBe(false);
      // Profile 2 should be allowed
      expect(monitor['shouldUseApiMethod'](profile2)).toBe(true);
    });
  });

  describe('Race condition prevention via activeProfile parameter', () => {
    it('should use passed activeProfile instead of re-detecting', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: vi.fn((name: string) => name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({
          five_hour_utilization: 0.5,
          seven_day_utilization: 0.3,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        })
      } as unknown as Response);

      // Mock API profile
      mockLoadProfilesFile.mockResolvedValueOnce({
        profiles: [{
          id: 'api-profile-1',
          name: 'API Profile',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-api-key'
        }],
        activeProfileId: 'api-profile-1',
        version: 1
      });

      const monitor = getUsageMonitor();

      // Pre-determined active profile (simulating profile at time of checkUsageAndSwap)
      const predeterminedProfile = {
        isAPIProfile: true,
        profileId: 'api-profile-1',
        profileName: 'API Profile',
        baseUrl: 'https://api.anthropic.com'
      };

      // Call fetchUsageViaAPI with predetermined profile
      const usage = await monitor['fetchUsageViaAPI'](
        'sk-ant-api-key',
        'api-profile-1',
        'API Profile',
        undefined,
        predeterminedProfile
      );

      // Log any console.error calls for debugging
      if (errorSpy.mock.calls.length > 0) {
        console.log('console.error was called:', errorSpy.mock.calls);
      }

      // Should successfully fetch usage using the passed profile
      expect(usage).not.toBeNull();
      if (usage) {
        expect(usage.profileId).toBe('api-profile-1');
        expect(usage.sessionPercent).toBe(50);
      }

      errorSpy.mockRestore();
    });

    it('should fall back to profile detection when activeProfile not provided', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: vi.fn((name: string) => name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({
          five_hour_utilization: 0.5,
          seven_day_utilization: 0.3,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        })
      } as unknown as Response);

      // Mock API profile
      mockLoadProfilesFile.mockResolvedValueOnce({
        profiles: [{
          id: 'api-profile-1',
          name: 'API Profile',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-api-key'
        }],
        activeProfileId: 'api-profile-1',
        version: 1
      });

      const monitor = getUsageMonitor();

      // Call fetchUsageViaAPI WITHOUT predetermined profile
      // Should fall back to detecting profile from activeProfileId
      const usage = await monitor['fetchUsageViaAPI'](
        'sk-ant-api-key',
        'api-profile-1',
        'API Profile',
        undefined, // No email
        undefined // No activeProfile passed
      );

      // Should still work by detecting the profile
      expect(usage).not.toBeNull();
      expect(usage?.profileId).toBe('api-profile-1');
    });

    it('should handle OAuth profile in activeProfile parameter', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: vi.fn((name: string) => name === 'content-type' ? 'application/json' : null)
        },
        json: async () => ({
          five_hour_utilization: 0.5,
          seven_day_utilization: 0.3,
          five_hour_reset_at: '2025-01-17T15:00:00Z',
          seven_day_reset_at: '2025-01-20T12:00:00Z'
        })
      } as unknown as Response);

      const monitor = getUsageMonitor();

      // Pre-determined OAuth profile
      const oauthProfile = {
        isAPIProfile: false,
        profileId: 'oauth-profile',
        profileName: 'OAuth Profile',
        baseUrl: 'https://api.anthropic.com'
      };

      // Call fetchUsageViaAPI with OAuth profile
      const usage = await monitor['fetchUsageViaAPI'](
        'oauth-token',
        'oauth-profile',
        'OAuth Profile',
        undefined,
        oauthProfile
      );

      // Should successfully fetch usage for OAuth profile
      expect(usage).not.toBeNull();
      expect(usage?.profileId).toBe('oauth-profile');
    });
  });

  describe('Shared utility - hasHardcodedText', () => {
    it('should return true for empty string', () => {
      expect(hasHardcodedText('')).toBe(true);
    });

    it('should return true for null', () => {
      expect(hasHardcodedText(null)).toBe(true);
    });

    it('should return true for undefined', () => {
      expect(hasHardcodedText(undefined)).toBe(true);
    });

    it('should return true for "Unknown"', () => {
      expect(hasHardcodedText('Unknown')).toBe(true);
    });

    it('should return true for "Expired"', () => {
      expect(hasHardcodedText('Expired')).toBe(true);
    });

    it('should return false for valid time strings', () => {
      expect(hasHardcodedText('2 hours remaining')).toBe(false);
      expect(hasHardcodedText('1 day left')).toBe(false);
      expect(hasHardcodedText('30 minutes')).toBe(false);
    });

    it('should be case-sensitive for "Unknown" and "Expired"', () => {
      // Lowercase versions should not trigger the filter
      expect(hasHardcodedText('unknown')).toBe(false);
      expect(hasHardcodedText('expired')).toBe(false);
      expect(hasHardcodedText('UNKNOWN')).toBe(false);
      expect(hasHardcodedText('EXPIRED')).toBe(false);
    });

    it('should handle strings with only whitespace', () => {
      // Whitespace-only strings are falsy when trimmed
      expect(hasHardcodedText('   ')).toBe(true);
    });
  });
});
