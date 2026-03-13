/**
 * Tests for AI Auth Resolver
 *
 * Validates the multi-stage credential resolution fallback chain,
 * provider account resolution, settings accessor registration,
 * environment variable fallback, and Z.AI endpoint routing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock token-refresh before importing resolver
// Path resolution from src/main/ai/auth/__tests__/:
//   ../     = src/main/ai/auth/
//   ../../  = src/main/ai/
//   ../../../ = src/main/
// So ../../../claude-profile/ = src/main/claude-profile/
vi.mock('../../../claude-profile/token-refresh', () => ({
  ensureValidToken: vi.fn(),
  reactiveTokenRefresh: vi.fn(),
}));

// Mock profile-scorer
vi.mock('../../../claude-profile/profile-scorer', () => ({
  scoreProviderAccount: vi.fn(),
}));

// Mock model equivalence
// ../../../../shared/ = src/shared/ (4 levels up from __tests__ = src/)
vi.mock('../../../../shared/constants/models', () => ({
  resolveModelEquivalent: vi.fn(),
}));

// Mock provider factory detection
// ../../providers/ = src/main/ai/providers/
vi.mock('../../providers/factory', () => ({
  detectProviderFromModel: vi.fn(),
}));

import { ensureValidToken, reactiveTokenRefresh } from '../../../claude-profile/token-refresh';
import { scoreProviderAccount } from '../../../claude-profile/profile-scorer';
import { resolveModelEquivalent } from '../../../../shared/constants/models';
import { detectProviderFromModel } from '../../providers/factory';
import {
  resolveAuth,
  hasCredentials,
  registerSettingsAccessor,
  refreshOAuthTokenReactive,
  resolveAuthFromQueue,
  buildDefaultQueueConfig,
} from '../resolver';

const mockEnsureValidToken = vi.mocked(ensureValidToken);
const mockReactiveTokenRefresh = vi.mocked(reactiveTokenRefresh);
const mockScoreProviderAccount = vi.mocked(scoreProviderAccount);
const mockResolveModelEquivalent = vi.mocked(resolveModelEquivalent);
const _mockDetectProviderFromModel = vi.mocked(detectProviderFromModel);

// Helper: reset the module-level settings accessor between tests
function clearSettingsAccessor() {
  registerSettingsAccessor(() => undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSettingsAccessor();
  // Clean up any environment variable side effects
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
});

// =============================================================================
// registerSettingsAccessor
// =============================================================================

describe('registerSettingsAccessor', () => {
  it('wires up settings so subsequent calls read from the accessor', async () => {
    registerSettingsAccessor((key) => (key === 'globalAnthropicApiKey' ? 'sk-from-settings' : undefined));

    const auth = await resolveAuth({ provider: 'anthropic' });
    expect(auth).not.toBeNull();
    expect(auth?.apiKey).toBe('sk-from-settings');
    expect(auth?.source).toBe('profile-api-key');
  });
});

// =============================================================================
// Stage 1: Profile OAuth Token
// =============================================================================

describe('resolveAuth — Stage 1: Profile OAuth', () => {
  it('returns oauth token for anthropic when ensureValidToken resolves', async () => {
    mockEnsureValidToken.mockResolvedValueOnce({ token: 'oauth-token-abc', wasRefreshed: false });

    const auth = await resolveAuth({ provider: 'anthropic', configDir: '/home/.config/claude' });

    expect(auth).not.toBeNull();
    expect(auth?.apiKey).toBe('oauth-token-abc');
    expect(auth?.source).toBe('profile-oauth');
    expect(auth?.headers).toMatchObject({ 'anthropic-beta': expect.stringContaining('oauth') });
  });

  it('includes custom base URL when ANTHROPIC_BASE_URL is set', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com';
    mockEnsureValidToken.mockResolvedValueOnce({ token: 'oauth-token-abc', wasRefreshed: false });

    const auth = await resolveAuth({ provider: 'anthropic' });

    expect(auth?.baseURL).toBe('https://proxy.example.com');
  });

  it('skips oauth stage for non-anthropic providers', async () => {
    // openai has no oauth stage; should fall through to environment
    process.env.OPENAI_API_KEY = 'sk-env-openai';

    const auth = await resolveAuth({ provider: 'openai' });

    expect(mockEnsureValidToken).not.toHaveBeenCalled();
    expect(auth?.source).toBe('environment');
  });

  it('falls through when ensureValidToken throws', async () => {
    mockEnsureValidToken.mockRejectedValueOnce(new Error('keychain locked'));
    process.env.ANTHROPIC_API_KEY = 'sk-env-fallback';

    const auth = await resolveAuth({ provider: 'anthropic' });

    expect(auth?.apiKey).toBe('sk-env-fallback');
    expect(auth?.source).toBe('environment');
  });

  it('falls through when ensureValidToken returns no token', async () => {
    mockEnsureValidToken.mockResolvedValueOnce({ token: null, wasRefreshed: false });
    process.env.ANTHROPIC_API_KEY = 'sk-env-fallback';

    const auth = await resolveAuth({ provider: 'anthropic' });

    expect(auth?.source).toBe('environment');
  });
});

// =============================================================================
// Stage 2: Profile API Key (from settings)
// =============================================================================

describe('resolveAuth — Stage 2: Profile API Key', () => {
  it('returns api-key from settings when no oauth token available', async () => {
    mockEnsureValidToken.mockResolvedValueOnce({ token: null, wasRefreshed: false });
    registerSettingsAccessor((key) => (key === 'globalAnthropicApiKey' ? 'sk-settings-key' : undefined));

    const auth = await resolveAuth({ provider: 'anthropic' });

    expect(auth?.apiKey).toBe('sk-settings-key');
    expect(auth?.source).toBe('profile-api-key');
  });

  it('includes base URL from environment even for settings-based keys', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.proxy.io';
    mockEnsureValidToken.mockResolvedValueOnce({ token: null, wasRefreshed: false });
    registerSettingsAccessor((key) => (key === 'globalAnthropicApiKey' ? 'sk-settings' : undefined));

    const auth = await resolveAuth({ provider: 'anthropic' });

    expect(auth?.baseURL).toBe('https://custom.proxy.io');
  });

  it('returns null from settings stage when accessor returns nothing', async () => {
    mockEnsureValidToken.mockResolvedValueOnce({ token: null, wasRefreshed: false });
    // settings accessor returns undefined for everything, env also not set
    const auth = await resolveAuth({ provider: 'anthropic' });
    expect(auth).toBeNull();
  });
});

// =============================================================================
// Stage 3: Environment Variable
// =============================================================================

describe('resolveAuth — Stage 3: Environment Variable', () => {
  it('returns env key for openai', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-openai-123';

    const auth = await resolveAuth({ provider: 'openai' });

    expect(auth?.apiKey).toBe('sk-env-openai-123');
    expect(auth?.source).toBe('environment');
  });

  it('includes base URL from env when OPENAI_BASE_URL is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    process.env.OPENAI_BASE_URL = 'https://openai-proxy.com';

    const auth = await resolveAuth({ provider: 'openai' });

    expect(auth?.baseURL).toBe('https://openai-proxy.com');
  });

  it('returns null for bedrock (no env var defined)', async () => {
    const auth = await resolveAuth({ provider: 'bedrock' });
    expect(auth).toBeNull();
  });
});

// =============================================================================
// Stage 4: Default Credentials (no-auth providers)
// =============================================================================

describe('resolveAuth — Stage 4: Default Credentials', () => {
  it('returns empty api key for ollama', async () => {
    const auth = await resolveAuth({ provider: 'ollama' });

    expect(auth).not.toBeNull();
    expect(auth?.apiKey).toBe('');
    expect(auth?.source).toBe('default');
  });

  it('returns null for unknown provider with no credentials', async () => {
    const auth = await resolveAuth({ provider: 'groq' });
    expect(auth).toBeNull();
  });
});

// =============================================================================
// hasCredentials
// =============================================================================

describe('hasCredentials', () => {
  it('returns true when credentials resolve', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(await hasCredentials({ provider: 'openai' })).toBe(true);
  });

  it('returns true for ollama (no-auth)', async () => {
    expect(await hasCredentials({ provider: 'ollama' })).toBe(true);
  });

  it('returns false when no credentials available', async () => {
    expect(await hasCredentials({ provider: 'groq' })).toBe(false);
  });
});

// =============================================================================
// refreshOAuthTokenReactive
// =============================================================================

describe('refreshOAuthTokenReactive', () => {
  it('returns new token from reactiveTokenRefresh', async () => {
    mockReactiveTokenRefresh.mockResolvedValueOnce({ token: 'refreshed-token-xyz', wasRefreshed: true });

    const result = await refreshOAuthTokenReactive('/some/config/dir');

    expect(result).toBe('refreshed-token-xyz');
    expect(mockReactiveTokenRefresh).toHaveBeenCalledWith('/some/config/dir');
  });

  it('returns null when reactiveTokenRefresh returns no token', async () => {
    mockReactiveTokenRefresh.mockResolvedValueOnce({ token: null, wasRefreshed: false });

    const result = await refreshOAuthTokenReactive(undefined);

    expect(result).toBeNull();
  });

  it('returns null when reactiveTokenRefresh throws', async () => {
    mockReactiveTokenRefresh.mockRejectedValueOnce(new Error('network error'));

    const result = await refreshOAuthTokenReactive('/config');

    expect(result).toBeNull();
  });
});

// =============================================================================
// Provider Account Resolution (Stage 0)
// =============================================================================

describe('resolveAuth — Stage 0: Provider Account', () => {
  it('returns api-key auth from providerAccounts setting', async () => {
    const accounts = [
      {
        provider: 'openai',
        isActive: true,
        authType: 'api-key',
        apiKey: 'sk-provider-account-key',
      },
    ];
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      return undefined;
    });

    const auth = await resolveAuth({ provider: 'openai' });

    expect(auth?.apiKey).toBe('sk-provider-account-key');
    expect(auth?.source).toBe('profile-api-key');
  });

  it('routes z.ai subscription to coding API endpoint', async () => {
    const accounts = [
      {
        provider: 'zai',
        isActive: true,
        authType: 'api-key',
        apiKey: 'zhipu-key',
        billingModel: 'subscription',
      },
    ];
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      return undefined;
    });

    const auth = await resolveAuth({ provider: 'zai' });

    expect(auth?.apiKey).toBe('zhipu-key');
    expect(auth?.baseURL).toContain('/coding/paas/v4');
  });

  it('routes z.ai pay-per-use to general API endpoint', async () => {
    const accounts = [
      {
        provider: 'zai',
        isActive: true,
        authType: 'api-key',
        apiKey: 'zhipu-key',
        billingModel: 'pay-per-use',
      },
    ];
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      return undefined;
    });

    const auth = await resolveAuth({ provider: 'zai' });

    expect(auth?.baseURL).toContain('/paas/v4');
    expect(auth?.baseURL).not.toContain('/coding/');
  });

  it('skips inactive accounts and falls through', async () => {
    const accounts = [
      { provider: 'openai', isActive: false, authType: 'api-key', apiKey: 'sk-inactive' },
    ];
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      return undefined;
    });
    process.env.OPENAI_API_KEY = 'sk-env-fallback';

    const auth = await resolveAuth({ provider: 'openai' });

    expect(auth?.source).toBe('environment');
  });

  it('handles malformed providerAccounts JSON gracefully', async () => {
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return 'not-valid-json{{';
      return undefined;
    });
    process.env.OPENAI_API_KEY = 'sk-fallback';

    const auth = await resolveAuth({ provider: 'openai' });
    expect(auth?.source).toBe('environment');
  });
});

// =============================================================================
// resolveAuthFromQueue
// =============================================================================

describe('resolveAuthFromQueue', () => {
  const baseAccount = {
    id: 'acc-1',
    provider: 'anthropic' as const,
    authType: 'api-key' as const,
    apiKey: 'sk-queue-key',
    isActive: true,
    name: 'Primary Account',
    billingModel: 'pay-per-use' as const,
    createdAt: 0,
    updatedAt: 0,
  };

  beforeEach(() => {
    mockScoreProviderAccount.mockReturnValue({ available: true, score: 100 });
    mockResolveModelEquivalent.mockReturnValue({
      modelId: 'claude-sonnet-4-5-20250929',
      reasoning: { type: 'none' },
    });
  });

  it('resolves auth from the first available account in queue', async () => {
    const result = await resolveAuthFromQueue('sonnet', [baseAccount]);

    expect(result).not.toBeNull();
    expect(result?.accountId).toBe('acc-1');
    expect(result?.apiKey).toBe('sk-queue-key');
    expect(result?.resolvedProvider).toBe('anthropic');
  });

  it('skips excluded account IDs', async () => {
    const result = await resolveAuthFromQueue('sonnet', [baseAccount], {
      excludeAccountIds: ['acc-1'],
    });

    expect(result).toBeNull();
  });

  it('skips unavailable accounts', async () => {
    mockScoreProviderAccount.mockReturnValueOnce({ available: false, score: 0 });

    const result = await resolveAuthFromQueue('sonnet', [baseAccount]);

    expect(result).toBeNull();
  });

  it('returns null when queue is empty', async () => {
    const result = await resolveAuthFromQueue('sonnet', []);
    expect(result).toBeNull();
  });

  it('uses the resolved model ID from equivalence table', async () => {
    mockResolveModelEquivalent.mockReturnValueOnce({
      modelId: 'claude-haiku-4-5',
      reasoning: { type: 'none' },
    });

    const result = await resolveAuthFromQueue('haiku', [baseAccount]);

    expect(result?.resolvedModelId).toBe('claude-haiku-4-5');
  });

  it('falls through to next account when first has no credentials', async () => {
    const noKeyAccount = { ...baseAccount, id: 'acc-no-key', apiKey: undefined, authType: 'api-key' as const };
    const goodAccount = { ...baseAccount, id: 'acc-2' };

    const result = await resolveAuthFromQueue('sonnet', [noKeyAccount, goodAccount]);

    expect(result?.accountId).toBe('acc-2');
  });
});

// =============================================================================
// buildDefaultQueueConfig
// =============================================================================

describe('buildDefaultQueueConfig', () => {
  it('returns undefined when no settings accessor is registered', () => {
    // accessor returns undefined for everything
    const result = buildDefaultQueueConfig('claude-sonnet-4-5-20250929');
    expect(result).toBeUndefined();
  });

  it('returns sorted queue when providerAccounts are configured', () => {
    const accounts = [
      { id: 'b', provider: 'openai', isActive: true },
      { id: 'a', provider: 'anthropic', isActive: true },
    ];
    const priorityOrder = ['a', 'b'];

    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      if (key === 'globalPriorityOrder') return JSON.stringify(priorityOrder);
      return undefined;
    });

    const result = buildDefaultQueueConfig('claude-sonnet-4-5-20250929');

    expect(result).not.toBeUndefined();
    expect(result?.queue[0].id).toBe('a');
    expect(result?.queue[1].id).toBe('b');
  });

  it('returns undefined when providerAccounts is empty array', () => {
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify([]);
      return undefined;
    });

    const result = buildDefaultQueueConfig('sonnet');
    expect(result).toBeUndefined();
  });

  it('returns accounts in natural order when no priority order is set', () => {
    const accounts = [
      { id: 'x', provider: 'groq', isActive: true },
      { id: 'y', provider: 'mistral', isActive: true },
    ];
    registerSettingsAccessor((key) => {
      if (key === 'providerAccounts') return JSON.stringify(accounts);
      return undefined;
    });

    const result = buildDefaultQueueConfig('some-model');

    expect(result?.queue[0].id).toBe('x');
    expect(result?.queue[1].id).toBe('y');
  });
});
