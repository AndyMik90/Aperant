/**
 * Tests for claude-code-handlers.ts
 *
 * Tests the cache invalidation logic when the installed CLI version
 * is newer than the cached latest version from npm registry.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Store registered IPC handlers so we can call them directly
type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const registeredHandlers: Map<string, IpcHandler> = new Map();

// Mock ipcMain to capture registered handlers
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

// Mock cli-tool-manager
const mockGetToolInfo = vi.fn();
vi.mock('../cli-tool-manager', () => ({
  getToolInfo: mockGetToolInfo,
  configureTools: vi.fn(),
  getClaudeDetectionPaths: vi.fn(() => ({
    homebrewPaths: [],
    platformPaths: [],
    nvmVersionsDir: '',
  })),
  sortNvmVersionDirs: vi.fn(() => []),
}));

// Mock settings-utils
vi.mock('../settings-utils', () => ({
  readSettingsFile: vi.fn(() => ({})),
  writeSettingsFile: vi.fn(),
}));

// Mock utils/windows-paths
vi.mock('../utils/windows-paths', () => ({
  isSecurePath: vi.fn(() => true),
}));

// Mock utils/config-path-validator
vi.mock('../utils/config-path-validator', () => ({
  isValidConfigDir: vi.fn(() => true),
}));

// Mock claude-profile-manager
vi.mock('../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => ({
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    setProfileToken: vi.fn(),
  })),
}));

// Mock fs and child_process
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  promises: {
    readdir: vi.fn(() => Promise.resolve([])),
    mkdir: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    unlink: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import { IPC_CHANNELS } from '../../shared/constants';

describe('claude-code-handlers - Cache Invalidation', () => {
  let checkVersionHandler: IpcHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    // Reset module cache to get fresh state
    vi.resetModules();

    // Re-import to re-register handlers with fresh cache state
    const { registerClaudeCodeHandlers } = await import('../ipc-handlers/claude-code-handlers');
    registerClaudeCodeHandlers();

    // Get the check version handler
    const handler = registeredHandlers.get(IPC_CHANNELS.CLAUDE_CODE_CHECK_VERSION);
    if (!handler) {
      throw new Error('CLAUDE_CODE_CHECK_VERSION handler not registered');
    }
    checkVersionHandler = handler;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when installed version is newer than cached latest', () => {
    test('should invalidate cache and refetch from npm', async () => {
      // Setup: CLI returns installed version 2.1.16
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.16',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // First call: npm returns 2.1.15, gets cached
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      // Call to populate cache with 2.1.15
      const firstResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { installed: string | null; latest: string };
      };
      expect(firstResult.success).toBe(true);
      expect(firstResult.data?.latest).toBe('2.1.15');

      // Now npm has 2.1.16 (matching installed)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.16' }),
      });

      // Second call: installed (2.1.16) > cached (2.1.15), should refetch
      const secondResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { installed: string | null; latest: string };
      };
      expect(secondResult.success).toBe(true);
      expect(secondResult.data?.installed).toBe('2.1.16');
      expect(secondResult.data?.latest).toBe('2.1.16');

      // Verify fetch was called twice (once for initial, once after invalidation)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('when installed version equals cached latest', () => {
    test('should use cached value without refetching', async () => {
      // Setup: CLI returns installed version 2.1.15
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.15',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // npm returns 2.1.15
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      // First call to populate cache
      const firstResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(firstResult.success).toBe(true);
      expect(firstResult.data?.latest).toBe('2.1.15');

      // Second call: installed (2.1.15) = cached (2.1.15), should use cache
      const secondResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(secondResult.success).toBe(true);
      expect(secondResult.data?.latest).toBe('2.1.15');

      // Verify fetch was called only once (cache used for second call)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('when installed version is older than cached latest', () => {
    test('should use cached value without refetching', async () => {
      // Setup: CLI returns installed version 2.1.14 (older)
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.14',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // npm returns 2.1.16 (newer)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.16' }),
      });

      // First call to populate cache
      const firstResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string; isOutdated: boolean };
      };
      expect(firstResult.success).toBe(true);
      expect(firstResult.data?.latest).toBe('2.1.16');
      expect(firstResult.data?.isOutdated).toBe(true);

      // Second call: installed (2.1.14) < cached (2.1.16), should use cache
      const secondResult = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string; isOutdated: boolean };
      };
      expect(secondResult.success).toBe(true);
      expect(secondResult.data?.latest).toBe('2.1.16');
      expect(secondResult.data?.isOutdated).toBe(true);

      // Verify fetch was called only once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('version handling edge cases', () => {
    test('should handle versions with v prefix', async () => {
      // Setup: CLI returns version with 'v' prefix
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: 'v2.1.16',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // First call: npm returns v2.1.15
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: 'v2.1.15' }),
      });

      // Populate cache with v2.1.15
      await checkVersionHandler({}, null);

      // Now npm has v2.1.16
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: 'v2.1.16' }),
      });

      // Second call should invalidate and refetch
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.latest).toBe('v2.1.16');

      // Cache should have been invalidated
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should handle invalid semver gracefully (falls back to cached)', async () => {
      // Setup: CLI returns invalid version string
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: 'not-a-valid-version',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // npm returns valid version
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      // First call to populate cache
      await checkVersionHandler({}, null);

      // Second call: invalid installed version should fall back to cached
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.latest).toBe('2.1.15');

      // Should only fetch once (cached value used)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should handle null installed version (CLI not found)', async () => {
      // Setup: CLI not found
      mockGetToolInfo.mockReturnValue({
        found: false,
        version: null,
        path: null,
        source: 'fallback',
        message: 'Not found',
      });

      // npm returns version
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.16' }),
      });

      // First call to populate cache
      await checkVersionHandler({}, null);

      // Second call: null installed should use cache
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { installed: string | null; latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.installed).toBeNull();
      expect(result.data?.latest).toBe('2.1.16');

      // Should only fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('network error handling', () => {
    test('should return unknown when cache invalidation triggers refetch that fails', async () => {
      // Setup: CLI returns installed version 2.1.16
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.16',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // First call: npm returns 2.1.15, gets cached
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      await checkVersionHandler({}, null);

      // Network error on second call
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Second call: installed > cached triggers cache invalidation and refetch
      // When refetch fails after cache invalidation, the stale cache is already cleared
      // so we get 'unknown' as the fallback
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      // After cache invalidation + network failure, returns unknown
      expect(result.data?.latest).toBe('unknown');
    });

    test('should return cached value on network error when cache is still valid', async () => {
      // Setup: CLI returns installed version 2.1.14 (older than cached)
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.14',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // First call: npm returns 2.1.15, gets cached
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      await checkVersionHandler({}, null);

      // Since installed (2.1.14) < cached (2.1.15), cache won't be invalidated
      // The cached value will be returned without making another fetch call
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.latest).toBe('2.1.15');

      // Only one fetch call should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should return unknown when fetch fails and no cache exists', async () => {
      // Setup: CLI found
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.16',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // Network error on first call (no cache)
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.latest).toBe('unknown');
    });
  });

  describe('pre-release version handling', () => {
    test('should invalidate cache when beta installed is newer than cached stable', async () => {
      // Setup: CLI returns installed beta version 2.1.16-beta.1
      mockGetToolInfo.mockReturnValue({
        found: true,
        version: '2.1.16-beta.1',
        path: '/usr/local/bin/claude',
        source: 'system-path',
        message: 'Found',
      });

      // First call: npm returns stable 2.1.15
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.15' }),
      });

      await checkVersionHandler({}, null);

      // npm now has 2.1.16
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '2.1.16' }),
      });

      // Beta 2.1.16-beta.1 > stable 2.1.15, should invalidate
      const result = await checkVersionHandler({}, null) as {
        success: boolean;
        data?: { latest: string };
      };
      expect(result.success).toBe(true);
      expect(result.data?.latest).toBe('2.1.16');

      // Cache should have been invalidated
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
