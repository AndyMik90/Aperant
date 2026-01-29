/**
 * Cross-Platform Credential Utilities Tests
 *
 * Tests for credential retrieval on macOS, Linux, and Windows platforms.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { join } from 'path';

// Mock dependencies before importing the module
vi.mock('../platform', () => ({
  isMacOS: vi.fn(() => false),
  isWindows: vi.fn(() => false),
  isLinux: vi.fn(() => false),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

// Import after mocks are set up
import {
  calculateConfigDirHash,
  getKeychainServiceName,
  getWindowsCredentialTarget,
  getCredentialsFromKeychain,
  getCredentials,
  clearKeychainCache,
  clearCredentialCache,
} from './credential-utils';
import { isMacOS, isWindows, isLinux } from '../platform';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';

describe('credential-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the credential cache before each test
    clearCredentialCache();
  });

  describe('calculateConfigDirHash', () => {
    it('should return first 8 characters of SHA256 hash', () => {
      const configDir = '/home/user/.claude-profiles/work';
      const expectedHash = createHash('sha256').update(configDir).digest('hex').slice(0, 8);
      expect(calculateConfigDirHash(configDir)).toBe(expectedHash);
    });

    it('should return different hashes for different paths', () => {
      const hash1 = calculateConfigDirHash('/path/one');
      const hash2 = calculateConfigDirHash('/path/two');
      expect(hash1).not.toBe(hash2);
    });

    it('should return consistent hash for same path', () => {
      const path = '/home/user/.claude';
      expect(calculateConfigDirHash(path)).toBe(calculateConfigDirHash(path));
    });
  });

  describe('getKeychainServiceName', () => {
    it('should return default service name when no configDir provided', () => {
      expect(getKeychainServiceName()).toBe('Claude Code-credentials');
    });

    it('should return default service name for undefined', () => {
      expect(getKeychainServiceName(undefined)).toBe('Claude Code-credentials');
    });

    it('should return hashed service name for custom configDir', () => {
      const configDir = '/home/user/.claude-profiles/work';
      const hash = calculateConfigDirHash(configDir);
      expect(getKeychainServiceName(configDir)).toBe(`Claude Code-credentials-${hash}`);
    });
  });

  describe('getWindowsCredentialTarget', () => {
    it('should use same naming convention as macOS Keychain', () => {
      expect(getWindowsCredentialTarget()).toBe('Claude Code-credentials');

      const configDir = '/home/user/.claude-profiles/work';
      expect(getWindowsCredentialTarget(configDir)).toBe(getKeychainServiceName(configDir));
    });
  });

  describe('getCredentialsFromKeychain (macOS)', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(true);
      vi.mocked(isWindows).mockReturnValue(false);
      vi.mocked(isLinux).mockReturnValue(false);
    });

    it('should return credentials from macOS Keychain', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
          email: 'test@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBe('sk-ant-test-token-123');
      expect(result.email).toBe('test@example.com');
      expect(result.error).toBeUndefined();
    });

    it('should return null when security command not found', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
      expect(result.error).toBe('macOS security command not found');
    });

    it('should return null for invalid JSON', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue('invalid json');

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
    });

    it('should reject invalid token format', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'invalid-token',
          email: 'test@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBe('test@example.com');
    });

    it('should handle exit code 44 (item not found)', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockImplementation(() => {
        const error = new Error('Item not found') as Error & { status: number };
        error.status = 44;
        throw error;
      });

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('should use cache on subsequent calls', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
          email: 'test@example.com',
        },
      }));

      // First call
      getCredentialsFromKeychain();
      // Second call should use cache
      getCredentialsFromKeychain();

      expect(execFileSync).toHaveBeenCalledTimes(1);
    });

    it('should bypass cache when forceRefresh is true', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
          email: 'test@example.com',
        },
      }));

      // First call
      getCredentialsFromKeychain();
      // Second call with forceRefresh
      getCredentialsFromKeychain(undefined, true);

      expect(execFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCredentialsFromKeychain (Linux)', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(false);
      vi.mocked(isWindows).mockReturnValue(false);
      vi.mocked(isLinux).mockReturnValue(true);
      vi.mocked(homedir).mockReturnValue('/home/testuser');
    });

    // Helper to mock Secret Service not available (secret-tool not found)
    const mockSecretServiceUnavailable = () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        // secret-tool not found
        if (pathStr.includes('secret-tool')) return false;
        // credentials file exists
        if (pathStr.includes('.credentials.json')) return true;
        return false;
      });
    };

    it('should return credentials from Secret Service when available', () => {
      // secret-tool exists and returns credentials
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-secret-service-token',
          email: 'secretservice@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBe('sk-ant-secret-service-token');
      expect(result.email).toBe('secretservice@example.com');
      expect(result.error).toBeUndefined();
    });

    it('should fall back to .credentials.json when Secret Service unavailable', () => {
      mockSecretServiceUnavailable();
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-linux-token-456',
          email: 'linux@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBe('sk-ant-linux-token-456');
      expect(result.email).toBe('linux@example.com');
      expect(result.error).toBeUndefined();
    });

    it('should return null when credentials file not found and Secret Service unavailable', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
    });

    it('should use custom configDir for credentials path', () => {
      const customConfigDir = '/home/user/.claude-profiles/work';
      mockSecretServiceUnavailable();
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('secret-tool')) return false;
        return true; // credentials file exists
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-custom-token',
          email: 'custom@example.com',
        },
      }));

      const result = getCredentialsFromKeychain(customConfigDir);

      expect(existsSync).toHaveBeenCalledWith(join(customConfigDir, '.credentials.json'));
      expect(result.token).toBe('sk-ant-custom-token');
    });

    it('should handle emailAddress field (alternative email location)', () => {
      mockSecretServiceUnavailable();
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token',
          emailAddress: 'alternative@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.email).toBe('alternative@example.com');
    });

    it('should handle top-level email field', () => {
      mockSecretServiceUnavailable();
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token',
        },
        email: 'toplevel@example.com',
      }));

      const result = getCredentialsFromKeychain();

      expect(result.email).toBe('toplevel@example.com');
    });

    it('should handle file read permission errors', () => {
      mockSecretServiceUnavailable();
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
    });

    it('should fall back to file when Secret Service lookup fails', () => {
      // secret-tool exists but lookup fails
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('secret-tool')) return true;
        if (pathStr.includes('.credentials.json')) return true;
        return false;
      });
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('secret-tool lookup failed');
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-fallback-token',
          email: 'fallback@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBe('sk-ant-fallback-token');
      expect(result.email).toBe('fallback@example.com');
    });
  });

  describe('getCredentialsFromKeychain (Windows)', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(false);
      vi.mocked(isWindows).mockReturnValue(true);
      vi.mocked(isLinux).mockReturnValue(false);
      vi.mocked(homedir).mockReturnValue('C:\\Users\\TestUser');
    });

    it('should return null when PowerShell not found', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
      expect(result.error).toBe('PowerShell not found');
    });

    it('should return credentials from Windows Credential Manager', () => {
      // Mock PowerShell path found
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'sk-ant-windows-token-789',
          email: 'windows@example.com',
        },
      }));

      const result = getCredentialsFromKeychain();

      expect(result.token).toBe('sk-ant-windows-token-789');
      expect(result.email).toBe('windows@example.com');
    });

    it('should return null when credential not found', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue('');

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
    });

    it('should handle invalid JSON from Credential Manager', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(execFileSync).mockReturnValue('invalid json');

      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
    });
  });

  describe('getCredentialsFromKeychain (unsupported platform)', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(false);
      vi.mocked(isWindows).mockReturnValue(false);
      vi.mocked(isLinux).mockReturnValue(false);
    });

    it('should return error for unsupported platform', () => {
      const result = getCredentialsFromKeychain();

      expect(result.token).toBeNull();
      expect(result.email).toBeNull();
      expect(result.error).toContain('Unsupported platform');
    });
  });

  describe('getCredentials alias', () => {
    it('should be an alias for getCredentialsFromKeychain', () => {
      expect(getCredentials).toBe(getCredentialsFromKeychain);
    });
  });

  describe('clearKeychainCache', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it('should clear all caches when no configDir provided', () => {
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { accessToken: 'sk-ant-test', email: 'test@test.com' },
      }));

      // Prime the cache
      getCredentialsFromKeychain();
      expect(execFileSync).toHaveBeenCalledTimes(1);

      // Clear cache
      clearKeychainCache();

      // Should fetch again
      getCredentialsFromKeychain();
      expect(execFileSync).toHaveBeenCalledTimes(2);
    });

    it('should clear specific profile cache when configDir provided', () => {
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { accessToken: 'sk-ant-test', email: 'test@test.com' },
      }));

      const configDir = '/custom/path';

      // Prime the cache
      getCredentialsFromKeychain(configDir);
      expect(execFileSync).toHaveBeenCalledTimes(1);

      // Clear specific cache
      clearKeychainCache(configDir);

      // Should fetch again
      getCredentialsFromKeychain(configDir);
      expect(execFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCredentialCache alias', () => {
    it('should be an alias for clearKeychainCache', () => {
      expect(clearCredentialCache).toBe(clearKeychainCache);
    });
  });

  describe('token validation', () => {
    beforeEach(() => {
      vi.mocked(isMacOS).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it('should accept tokens starting with sk-ant-', () => {
      const validTokens = [
        'sk-ant-oat01-test',
        'sk-ant-oat02-test',
        'sk-ant-api-key',
      ];

      for (const token of validTokens) {
        clearCredentialCache();
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
          claudeAiOauth: { accessToken: token, email: 'test@test.com' },
        }));

        const result = getCredentialsFromKeychain();
        expect(result.token).toBe(token);
      }
    });

    it('should reject tokens not starting with sk-ant-', () => {
      const invalidTokens = [
        'invalid-token',
        'sk-api-key',
        'api-key-123',
      ];

      for (const token of invalidTokens) {
        clearCredentialCache();
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
          claudeAiOauth: { accessToken: token, email: 'test@test.com' },
        }));

        const result = getCredentialsFromKeychain();
        expect(result.token).toBeNull();
      }
    });

    it('should reject empty token string', () => {
      clearCredentialCache();
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { accessToken: '', email: 'test@test.com' },
      }));

      const result = getCredentialsFromKeychain();
      expect(result.token).toBeNull();
      expect(result.email).toBe('test@test.com');
    });
  });
});
