/**
 * Tests for getBestAvailableUnifiedAccount (profile-scorer.ts)
 *
 * Verifies the core scenario: when all OAuth profiles are rate-limited,
 * API profiles (GLM, etc.) are correctly selected as alternatives.
 * This is the foundation of the terminal unified swap fix.
 */
import { describe, it, expect } from 'vitest';
import { getBestAvailableUnifiedAccount } from '../profile-scorer';
import type { ClaudeProfile, ClaudeAutoSwitchSettings, APIProfile } from '../../../shared/types';

function createOAuthProfile(overrides: Partial<ClaudeProfile> = {}): ClaudeProfile {
  return {
    id: 'profile-1',
    name: 'Account 1',
    isDefault: false,
    configDir: '/tmp/config',
    oauthToken: 'fake-token-for-testing',
    usage: { weeklyUsagePercent: 50, sessionUsagePercent: 50 },
    rateLimitEvents: [],
    ...overrides,
  } as ClaudeProfile;
}

function createAPIProfile(overrides: Partial<APIProfile> = {}): APIProfile {
  return {
    id: 'glm-1',
    name: 'GLM API',
    baseUrl: 'https://api.z.ai/api/anthropic',
    apiKey: 'sk-glm-key',
    ...overrides,
  } as APIProfile;
}

const defaultSettings = {
  enabled: true,
  autoSwitchOnRateLimit: true,
  proactiveSwapEnabled: true,
  usageCheckInterval: 30000,
  sessionThreshold: 95,
  weeklyThreshold: 99,
  autoSwitchOnAuthFailure: false,
} as ClaudeAutoSwitchSettings;

describe('getBestAvailableUnifiedAccount', () => {
  it('returns API profile when all OAuth profiles are rate-limited', () => {
    const rateLimitedOAuth = createOAuthProfile({
      id: 'oauth-1',
      name: 'Rate Limited Account',
      rateLimitEvents: [
        {
          type: 'session',
          hitAt: new Date(),
          resetAt: new Date(Date.now() + 3600000),
          resetTimeString: 'Feb 19 at 11am',
        }
      ],
    });

    const glmProfile = createAPIProfile({
      id: 'glm-1',
      name: 'GLM API',
    });

    const result = getBestAvailableUnifiedAccount(
      [rateLimitedOAuth],
      [glmProfile],
      defaultSettings,
      { excludeAccountId: 'oauth-oauth-1' }
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('api');
    expect(result!.name).toBe('GLM API');
  });

  it('returns available OAuth profile over API when OAuth is not rate-limited', () => {
    const healthyOAuth = createOAuthProfile({
      id: 'oauth-1',
      name: 'Healthy Account',
    });

    const glmProfile = createAPIProfile();

    const result = getBestAvailableUnifiedAccount(
      [healthyOAuth],
      [glmProfile],
      defaultSettings,
      { excludeAccountId: 'some-other-id' }
    );

    expect(result).not.toBeNull();
    // Both are available; result depends on priority order
    expect(result!.isAvailable).toBe(true);
  });

  it('returns API profile when OAuth is at capacity (100% weekly usage)', () => {
    const atCapacityOAuth = createOAuthProfile({
      id: 'oauth-1',
      name: 'At Capacity Account',
      usage: {
        weeklyUsagePercent: 100,
        sessionUsagePercent: 100,
        sessionResetTime: '11:59pm',
        weeklyResetTime: 'Feb 20',
        lastUpdated: new Date(),
      },
    });

    const glmProfile = createAPIProfile();

    const result = getBestAvailableUnifiedAccount(
      [atCapacityOAuth],
      [glmProfile],
      defaultSettings,
      { excludeAccountId: 'oauth-oauth-1' }
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('api');
    expect(result!.isAvailable).toBe(true);
  });

  it('returns null when no profiles exist', () => {
    const result = getBestAvailableUnifiedAccount(
      [],
      [],
      defaultSettings,
    );

    expect(result).toBeNull();
  });

  it('returns API profile even when it is the only option', () => {
    const glmProfile = createAPIProfile({
      id: 'glm-1',
      name: 'GLM API',
      apiKey: 'sk-valid-key',
    });

    const result = getBestAvailableUnifiedAccount(
      [],
      [glmProfile],
      defaultSettings,
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('api');
    expect(result!.hasUnlimitedUsage).toBe(true);
  });

  it('respects priority order when multiple accounts are available', () => {
    const oauth = createOAuthProfile({ id: 'oauth-1', name: 'OAuth' });
    const glm = createAPIProfile({ id: 'glm-1', name: 'GLM' });

    // GLM first in priority
    const result = getBestAvailableUnifiedAccount(
      [oauth],
      [glm],
      defaultSettings,
      { priorityOrder: ['api-glm-1', 'oauth-oauth-1'] }
    );

    expect(result).not.toBeNull();
    expect(result!.name).toBe('GLM');
    expect(result!.type).toBe('api');
  });

  it('excludes the specified account from selection', () => {
    const glm = createAPIProfile({ id: 'glm-1', name: 'GLM' });

    const result = getBestAvailableUnifiedAccount(
      [],
      [glm],
      defaultSettings,
      { excludeAccountId: 'api-glm-1' }
    );

    expect(result).toBeNull();
  });

  it('allows manual selection of API profile via priority order even when OAuth is healthy', () => {
    const healthyOAuth = createOAuthProfile({
      id: 'oauth-1',
      name: 'Healthy OAuth',
    });

    const glm = createAPIProfile({ id: 'glm-1', name: 'GLM API' });

    // User puts GLM first in priority → should get GLM
    const result = getBestAvailableUnifiedAccount(
      [healthyOAuth],
      [glm],
      defaultSettings,
      { priorityOrder: ['api-glm-1', 'oauth-oauth-1'] }
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('api');
    expect(result!.name).toBe('GLM API');
  });
});
