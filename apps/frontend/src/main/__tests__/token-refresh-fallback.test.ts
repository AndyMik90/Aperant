/**
 * Unit tests for OAuth token refresh and fallback mechanisms
 * Tests the critical token acquisition strategy:
 * 1. Profile-specific token refresh
 * 2. Fallback to default keychain (for external /login recovery)
 * 3. Stateless async profile selection (no race conditions)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const mockEnsureValidToken = vi.fn();
const mockGetCredentialsFromKeychain = vi.fn();
const mockGetFullCredentialsFromKeychain = vi.fn();
const mockIsTokenExpiredOrNearExpiry = vi.fn();
const mockSetActiveProfile = vi.fn();
const mockGetAllProfilesUsage = vi.fn();

vi.mock('../claude-profile/token-refresh', () => ({
  ensureValidToken: (...args: unknown[]) => mockEnsureValidToken(...args),
  isTokenExpiredOrNearExpiry: (...args: unknown[]) => mockIsTokenExpiredOrNearExpiry(...args)
}));

vi.mock('../claude-profile/credential-utils', () => ({
  getCredentialsFromKeychain: (...args: unknown[]) => mockGetCredentialsFromKeychain(...args),
  getFullCredentialsFromKeychain: (...args: unknown[]) => mockGetFullCredentialsFromKeychain(...args)
}));

vi.mock('../claude-profile/usage-monitor', () => ({
  getUsageMonitor: vi.fn(() => ({
    getAllProfilesUsage: mockGetAllProfilesUsage.mockResolvedValue(null),
    emit: vi.fn()
  }))
}));

// Default mock - healthy profile, no swap needed
const createMockProfileManager = (options: {
  weeklyUsagePercent?: number;
  isRateLimited?: boolean;
} = {}) => ({
  getActiveProfile: vi.fn(() => ({
    id: 'profile-1',
    name: 'Profile 1',
    configDir: '~/.claude-profiles/profile-1',
    usage: { weeklyUsagePercent: options.weeklyUsagePercent ?? 50 }
  })),
  getProfile: vi.fn((id: string) => ({
    id,
    name: `Profile ${id}`,
    configDir: `~/.claude-profiles/${id}`
  })),
  getBestAvailableProfile: vi.fn(() => ({
    id: 'profile-2',
    name: 'Profile 2',
    configDir: '~/.claude-profiles/profile-2'
  })),
  isProfileRateLimited: vi.fn(() => ({ limited: options.isRateLimited ?? false })),
  setActiveProfile: mockSetActiveProfile,
  getProfileEnv: vi.fn((id: string) => ({
    CLAUDE_CONFIG_DIR: `~/.claude-profiles/${id}`
  })),
  getActiveProfileEnv: vi.fn(() => ({
    CLAUDE_CONFIG_DIR: '~/.claude-profiles/profile-1'
  }))
});

describe('Token Refresh and Fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockEnsureValidToken.mockReset();
    mockGetCredentialsFromKeychain.mockReset();
    mockGetFullCredentialsFromKeychain.mockReset();
    mockIsTokenExpiredOrNearExpiry.mockReset();
    mockSetActiveProfile.mockReset();
    mockGetAllProfilesUsage.mockReset();
    // Default: tokens are not expired
    mockIsTokenExpiredOrNearExpiry.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getBestAvailableProfileEnvAsync - Stateless Behavior', () => {
    it('should NOT call setActiveProfile when swap is needed (stateless)', async () => {
      // Mock at-capacity profile (100% weekly usage triggers swap)
      const mockProfileManager = createMockProfileManager({ weeklyUsagePercent: 100 });

      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockProfileManager)
      }));

      // Mock successful token retrieval
      mockEnsureValidToken.mockResolvedValue({ token: 'fresh-token', wasRefreshed: false });

      const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');
      const result = await getBestAvailableProfileEnvAsync();

      // Key assertion: setActiveProfile should NOT be called (stateless)
      expect(mockSetActiveProfile).not.toHaveBeenCalled();

      // But the result should indicate a swap was needed
      expect(result.wasSwapped).toBe(true);
      expect(result.profileId).toBe('profile-2');
    });

    it('should return correct env vars when no swap is needed', async () => {
      // Mock healthy profile (50% usage, no rate limit)
      const mockProfileManager = createMockProfileManager({ weeklyUsagePercent: 50 });

      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockProfileManager)
      }));

      mockEnsureValidToken.mockResolvedValue({ token: 'profile-token', wasRefreshed: false });

      const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');
      const result = await getBestAvailableProfileEnvAsync();

      expect(result.wasSwapped).toBe(false);
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('profile-token');
    });
  });

  describe('Token Fallback to Default Keychain', () => {
    beforeEach(() => {
      const mockProfileManager = createMockProfileManager({ weeklyUsagePercent: 50 });
      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockProfileManager)
      }));
    });

    it('should fall back to default keychain when profile token unavailable', async () => {
      // Profile token fails
      mockEnsureValidToken.mockResolvedValue({ token: null, error: 'Token expired' });
      // Default keychain has token
      mockGetCredentialsFromKeychain.mockReturnValue({ token: 'default-keychain-token' });

      const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');
      const result = await getBestAvailableProfileEnvAsync();

      // Should have called getCredentialsFromKeychain with undefined (default keychain)
      expect(mockGetCredentialsFromKeychain).toHaveBeenCalledWith(undefined, true);
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('default-keychain-token');
    });

    it('should set empty token when both profile and default keychain fail', async () => {
      // Both fail
      mockEnsureValidToken.mockResolvedValue({ token: null, error: 'Token expired' });
      mockGetCredentialsFromKeychain.mockReturnValue({ token: null });

      const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');
      const result = await getBestAvailableProfileEnvAsync();

      // Should set empty string (not undefined/null) for consistency
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
    });

    it('should use profile token when available (no fallback needed)', async () => {
      mockEnsureValidToken.mockResolvedValue({ token: 'profile-token', wasRefreshed: true });

      const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');
      const result = await getBestAvailableProfileEnvAsync();

      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('profile-token');
    });
  });

  describe('Sync version - ensureCleanProfileEnv', () => {
    beforeEach(() => {
      const mockProfileManager = createMockProfileManager({ weeklyUsagePercent: 50 });
      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockProfileManager)
      }));
    });

    it('should set empty token when no valid token found (sync)', async () => {
      // Both keychains return no token
      mockGetFullCredentialsFromKeychain.mockReturnValue({ token: null, expiresAt: null });

      const { getBestAvailableProfileEnv } = await import('../rate-limit-detector');
      const result = getBestAvailableProfileEnv();

      // Sync version should also set empty string for no token
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
    });

    it('should use fresh token from keychain (sync)', async () => {
      // Return valid token with future expiry
      mockGetFullCredentialsFromKeychain.mockReturnValue({
        token: 'fresh-sync-token',
        expiresAt: Date.now() + 3600000 // 1 hour from now
      });
      mockIsTokenExpiredOrNearExpiry.mockReturnValue(false);

      const { getBestAvailableProfileEnv } = await import('../rate-limit-detector');
      const result = getBestAvailableProfileEnv();

      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('fresh-sync-token');
    });

    it('should reject expired tokens and return empty (sync)', async () => {
      // Return expired token
      mockGetFullCredentialsFromKeychain.mockReturnValue({
        token: 'expired-token',
        expiresAt: Date.now() - 1000 // expired
      });
      mockIsTokenExpiredOrNearExpiry.mockReturnValue(true);

      const { getBestAvailableProfileEnv } = await import('../rate-limit-detector');
      const result = getBestAvailableProfileEnv();

      // Should reject expired token and return empty
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
    });
  });
});

describe('Race Condition Prevention', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const mockProfileManager = createMockProfileManager({ weeklyUsagePercent: 100 });
    vi.doMock('../claude-profile-manager', () => ({
      getClaudeProfileManager: vi.fn(() => mockProfileManager)
    }));
  });

  it('should allow concurrent calls without corrupting global state', async () => {
    // Simulate concurrent subprocess spawns with delayed token retrieval
    mockEnsureValidToken.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ token: 'token', wasRefreshed: false }), 10))
    );

    const { getBestAvailableProfileEnvAsync } = await import('../rate-limit-detector');

    // Spawn multiple concurrent calls
    const results = await Promise.all([
      getBestAvailableProfileEnvAsync(),
      getBestAvailableProfileEnvAsync(),
      getBestAvailableProfileEnvAsync()
    ]);

    // All should succeed with valid env
    for (const result of results) {
      expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBeDefined();
    }

    // setActiveProfile should never be called (stateless)
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });
});
