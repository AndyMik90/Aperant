import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import type { ClaudeCodeSettings } from '../types';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

// Mock platform module
vi.mock('../../platform', () => ({
  isWindows: vi.fn(() => false),
  isMacOS: vi.fn(() => false),
}));

// Mock debug logger
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

// Import mocked functions after vi.mock calls
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { isWindows, isMacOS } from '../../platform';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const _mockHomedir = vi.mocked(homedir);
const mockIsWindows = vi.mocked(isWindows);
const mockIsMacOS = vi.mocked(isMacOS);

// Build cross-platform expected paths using path.join so tests work on Windows too
const HOME = '/home/testuser';
const USER_SETTINGS = path.join(HOME, '.claude', 'settings.json');
const LINUX_MANAGED = '/etc/claude-code/managed-settings.json';
const projectSettings = (projectPath: string) => path.join(projectPath, '.claude', 'settings.json');
const projectLocalSettings = (projectPath: string) => path.join(projectPath, '.claude', 'settings.local.json');

// Import module under test after mocks
import { readAllSettings, readUserGlobalSettings, readProjectSharedSettings, readProjectLocalSettings, readManagedSettings } from '../reader';

describe('reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset platform mocks to Linux by default
    mockIsWindows.mockReturnValue(false);
    mockIsMacOS.mockReturnValue(false);
    // Reset environment variables
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.ProgramFiles;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('readUserGlobalSettings', () => {
    it('returns settings when file exists and is valid JSON', () => {
      const expectedSettings: ClaudeCodeSettings = {
        model: 'claude-sonnet-4-5-20250929',
        env: { USER_VAR: 'value' },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(expectedSettings));

      const result = readUserGlobalSettings();

      expect(result).toEqual(expectedSettings);
      expect(mockExistsSync).toHaveBeenCalledWith(USER_SETTINGS);
      expect(mockReadFileSync).toHaveBeenCalledWith(USER_SETTINGS, 'utf-8');
    });

    it('returns undefined when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = readUserGlobalSettings();

      expect(result).toBeUndefined();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('returns undefined when file contains invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{ invalid json }');

      const result = readUserGlobalSettings();

      expect(result).toBeUndefined();
    });

    it('uses CLAUDE_CONFIG_DIR env var when set', () => {
      process.env.CLAUDE_CONFIG_DIR = '/custom/config';

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'test' }));

      readUserGlobalSettings();

      expect(mockExistsSync).toHaveBeenCalledWith(path.join('/custom/config', 'settings.json'));
    });

    it('falls back to ~/.claude when no profile manager', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'test' }));

      readUserGlobalSettings();

      expect(mockExistsSync).toHaveBeenCalledWith(USER_SETTINGS);
    });

    it('sanitizes env field when it is a string instead of object', () => {
      const invalidSettings = {
        model: 'valid-model',
        env: 'not-an-object',
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid env
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes env field when it is an array', () => {
      const invalidSettings = {
        model: 'valid-model',
        env: ['VAR1=value1', 'VAR2=value2'],
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid env
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes env field when it is a number', () => {
      const invalidSettings = {
        model: 'valid-model',
        env: 12345,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid env
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes env field with non-string values, keeping only valid entries', () => {
      const invalidSettings = {
        model: 'valid-model',
        env: {
          VALID_STRING: 'value',
          INVALID_NUMBER: 123,
          INVALID_BOOLEAN: true,
          INVALID_NULL: null,
          INVALID_OBJECT: { nested: 'object' },
          ANOTHER_VALID: 'another-value',
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields and only valid env entries
      expect(result).toEqual({
        model: 'valid-model',
        env: {
          VALID_STRING: 'value',
          ANOTHER_VALID: 'another-value',
        },
      });
    });

    it('removes env field if all entries are invalid', () => {
      const invalidSettings = {
        model: 'valid-model',
        env: {
          NUMBER: 123,
          BOOLEAN: false,
          NULL: null,
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove env entirely
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes invalid model field (non-string)', () => {
      const invalidSettings = {
        model: 12345,
        env: { VALID: 'value' },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid model
      expect(result).toEqual({
        env: { VALID: 'value' },
      });
    });

    it('sanitizes invalid alwaysThinkingEnabled field (non-boolean)', () => {
      const invalidSettings = {
        model: 'valid-model',
        alwaysThinkingEnabled: 'yes',
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid alwaysThinkingEnabled
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes invalid permissions field (non-object)', () => {
      const invalidSettings = {
        model: 'valid-model',
        permissions: 'not-an-object',
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid permissions
      expect(result).toEqual({
        model: 'valid-model',
      });
    });

    it('sanitizes permissions with invalid array entries, keeping valid ones', () => {
      const invalidSettings = {
        model: 'valid-model',
        permissions: {
          allow: ['git', 123, 'npm', false, null],
          deny: [456, true],
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid strings in arrays, remove deny if empty after sanitization
      expect(result).toEqual({
        model: 'valid-model',
        permissions: {
          allow: ['git', 'npm'],
        },
      });
    });

    it('sanitizes permissions with invalid defaultMode', () => {
      const invalidSettings = {
        model: 'valid-model',
        permissions: {
          defaultMode: 'invalid-mode',
          allow: ['git'],
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should keep valid fields, remove invalid defaultMode
      expect(result).toEqual({
        model: 'valid-model',
        permissions: {
          allow: ['git'],
        },
      });
    });

    it('keeps valid defaultMode values (ask, acceptEdits, plan)', () => {
      const validSettings = {
        model: 'valid-model',
        permissions: {
          defaultMode: 'ask',
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(validSettings));

      const result = readUserGlobalSettings();

      expect(result).toEqual(validSettings);
    });

    it('returns undefined when all fields are invalid', () => {
      const invalidSettings = {
        model: 12345,
        env: 'not-an-object',
        alwaysThinkingEnabled: 'yes',
        permissions: 'not-an-object',
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidSettings));

      const result = readUserGlobalSettings();

      // Should return undefined because no valid fields remain
      expect(result).toBeUndefined();
    });
  });

  describe('readProjectSharedSettings', () => {
    it('returns settings when file exists and is valid JSON', () => {
      const expectedSettings: ClaudeCodeSettings = {
        permissions: {
          allow: ['git', 'npm'],
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(expectedSettings));

      const result = readProjectSharedSettings('/project/path');

      expect(result).toEqual(expectedSettings);
      expect(mockExistsSync).toHaveBeenCalledWith(projectSettings('/project/path'));
      expect(mockReadFileSync).toHaveBeenCalledWith(projectSettings('/project/path'), 'utf-8');
    });

    it('returns undefined when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = readProjectSharedSettings('/project/path');

      expect(result).toBeUndefined();
    });

    it('returns undefined when file contains invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json');

      const result = readProjectSharedSettings('/project/path');

      expect(result).toBeUndefined();
    });
  });

  describe('readProjectLocalSettings', () => {
    it('returns settings when file exists and is valid JSON', () => {
      const expectedSettings: ClaudeCodeSettings = {
        alwaysThinkingEnabled: true,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(expectedSettings));

      const result = readProjectLocalSettings('/project/path');

      expect(result).toEqual(expectedSettings);
      expect(mockExistsSync).toHaveBeenCalledWith(projectLocalSettings('/project/path'));
      expect(mockReadFileSync).toHaveBeenCalledWith(projectLocalSettings('/project/path'), 'utf-8');
    });

    it('returns undefined when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = readProjectLocalSettings('/project/path');

      expect(result).toBeUndefined();
    });
  });

  describe('readManagedSettings', () => {
    it('reads from Linux path when on Linux', () => {
      mockIsWindows.mockReturnValue(false);
      mockIsMacOS.mockReturnValue(false);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'managed' }));

      const result = readManagedSettings();

      expect(mockExistsSync).toHaveBeenCalledWith(LINUX_MANAGED);
      expect(result).toEqual({ model: 'managed' });
    });

    it('reads from macOS path when on macOS', () => {
      mockIsWindows.mockReturnValue(false);
      mockIsMacOS.mockReturnValue(true);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'managed' }));

      const result = readManagedSettings();

      expect(mockExistsSync).toHaveBeenCalledWith('/Library/Application Support/ClaudeCode/managed-settings.json');
      expect(result).toEqual({ model: 'managed' });
    });

    it('reads from Windows path when on Windows', () => {
      mockIsWindows.mockReturnValue(true);
      process.env.ProgramFiles = 'C:\\Program Files';
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'managed' }));

      const result = readManagedSettings();

      // path.join uses forward slashes on non-Windows, backslashes on Windows
      // Accept either format since tests run on different platforms
      const callArg = mockExistsSync.mock.calls[0][0] as string;
      expect(callArg).toMatch(/C:\\Program Files[\\/]ClaudeCode[\\/]managed-settings\.json/);
      expect(result).toEqual({ model: 'managed' });
    });

    it('uses default Windows path when ProgramFiles env is not set', () => {
      mockIsWindows.mockReturnValue(true);
      delete process.env.ProgramFiles;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ model: 'managed' }));

      readManagedSettings();

      // Accept either forward or backslashes
      const callArg = mockExistsSync.mock.calls[0][0] as string;
      expect(callArg).toMatch(/C:\\Program Files[\\/]ClaudeCode[\\/]managed-settings\.json/);
    });

    it('returns undefined when managed settings file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = readManagedSettings();

      expect(result).toBeUndefined();
    });
  });

  describe('readAllSettings', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue('{}');
    });

    it('reads only user and managed settings when no project path', () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s === USER_SETTINGS || s === LINUX_MANAGED;
      });

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({ model: 'user-model' });
        }
        if (s === LINUX_MANAGED) {
          return JSON.stringify({ alwaysThinkingEnabled: false });
        }
        return '{}';
      });

      const result = readAllSettings();

      expect(result.user).toEqual({ model: 'user-model' });
      expect(result.projectShared).toBeUndefined();
      expect(result.projectLocal).toBeUndefined();
      expect(result.managed).toEqual({ alwaysThinkingEnabled: false });
      expect(result.merged).toEqual({
        model: 'user-model',
        alwaysThinkingEnabled: false,
      });
    });

    it('reads all 4 levels when project path is provided', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({ model: 'user-model' });
        }
        if (s === projectSettings('/project')) {
          return JSON.stringify({ env: { PROJECT: 'shared' } });
        }
        if (s === projectLocalSettings('/project')) {
          return JSON.stringify({ alwaysThinkingEnabled: true });
        }
        if (s === LINUX_MANAGED) {
          return JSON.stringify({ permissions: { deny: ['rm'] } });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      expect(result.user).toEqual({ model: 'user-model' });
      expect(result.projectShared).toEqual({ env: { PROJECT: 'shared' } });
      expect(result.projectLocal).toEqual({ alwaysThinkingEnabled: true });
      expect(result.managed).toEqual({ permissions: { deny: ['rm'] } });
      expect(result.merged).toEqual({
        model: 'user-model',
        env: { PROJECT: 'shared' },
        alwaysThinkingEnabled: true,
        permissions: { deny: ['rm'] },
      });
    });

    it('handles missing files by returning undefined for those levels', () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p) === USER_SETTINGS;
      });

      mockReadFileSync.mockImplementation((p) => {
        if (String(p) === USER_SETTINGS) {
          return JSON.stringify({ model: 'user-only' });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      expect(result.user).toEqual({ model: 'user-only' });
      expect(result.projectShared).toBeUndefined();
      expect(result.projectLocal).toBeUndefined();
      expect(result.managed).toBeUndefined();
      expect(result.merged).toEqual({ model: 'user-only' });
    });

    it('handles invalid JSON by returning undefined for that level', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({ model: 'valid' });
        }
        if (s === projectSettings('/project')) {
          return '{ invalid json';
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      expect(result.user).toEqual({ model: 'valid' });
      expect(result.projectShared).toBeUndefined();
      expect(result.merged).toEqual({ model: 'valid' });
    });

    it('returns empty merged object when all levels are undefined', () => {
      mockExistsSync.mockReturnValue(false);

      const result = readAllSettings();

      expect(result.user).toBeUndefined();
      expect(result.projectShared).toBeUndefined();
      expect(result.projectLocal).toBeUndefined();
      expect(result.managed).toBeUndefined();
      expect(result.merged).toEqual({});
    });

    it('merges settings with correct precedence', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({
            model: 'user-model',
            env: { A: 'user', B: 'user' },
            permissions: { allow: ['user-tool'] },
          });
        }
        if (s === projectSettings('/project')) {
          return JSON.stringify({
            model: 'shared-model',
            env: { B: 'shared', C: 'shared' },
            permissions: { allow: ['shared-tool'] },
          });
        }
        if (s === projectLocalSettings('/project')) {
          return JSON.stringify({
            env: { C: 'local', D: 'local' },
          });
        }
        if (s === LINUX_MANAGED) {
          return JSON.stringify({
            model: 'managed-model',
            permissions: { deny: ['dangerous'] },
          });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      expect(result.merged.model).toBe('managed-model'); // managed wins
      expect(result.merged.env).toEqual({
        A: 'user',
        B: 'shared',
        C: 'local',
        D: 'local',
      });
      expect(result.merged.permissions).toEqual({
        allow: ['user-tool', 'shared-tool'],
        deny: ['dangerous'],
      });
    });

    it('sanitizes invalid env values across multiple levels and merges correctly', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({
            model: 'user-model',
            env: 'not-an-object', // Invalid - should be removed
          });
        }
        if (s === projectSettings('/project')) {
          return JSON.stringify({
            env: { VALID: 'shared', INVALID: 123 }, // Partial sanitization
          });
        }
        if (s === projectLocalSettings('/project')) {
          return JSON.stringify({
            env: { OVERRIDE: 'local' },
          });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      // User env should be removed, project shared should be sanitized, project local should be kept
      expect(result.user).toEqual({ model: 'user-model' });
      expect(result.projectShared).toEqual({ env: { VALID: 'shared' } });
      expect(result.projectLocal).toEqual({ env: { OVERRIDE: 'local' } });
      expect(result.merged).toEqual({
        model: 'user-model',
        env: {
          VALID: 'shared',
          OVERRIDE: 'local',
        },
      });
    });

    it('sanitizes invalid permissions across multiple levels and merges correctly', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({
            permissions: {
              allow: ['git', 123, 'npm'], // Mixed valid/invalid
              defaultMode: 'invalid', // Invalid - should be removed
            },
          });
        }
        if (s === projectSettings('/project')) {
          return JSON.stringify({
            permissions: 'not-an-object', // Invalid - should be removed entirely
          });
        }
        if (s === LINUX_MANAGED) {
          return JSON.stringify({
            permissions: {
              deny: ['rm', false, 'sudo'], // Mixed valid/invalid
              defaultMode: 'ask', // Valid
            },
          });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      // User permissions should be sanitized, project shared should be removed, managed should be sanitized
      expect(result.user).toEqual({
        permissions: {
          allow: ['git', 'npm'],
        },
      });
      expect(result.projectShared).toBeUndefined();
      expect(result.managed).toEqual({
        permissions: {
          deny: ['rm', 'sudo'],
          defaultMode: 'ask',
        },
      });
      expect(result.merged).toEqual({
        permissions: {
          allow: ['git', 'npm'],
          deny: ['rm', 'sudo'],
          defaultMode: 'ask',
        },
      });
    });

    it('handles completely invalid settings at one level while keeping valid levels', () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((p) => {
        const s = String(p);
        if (s === USER_SETTINGS) {
          return JSON.stringify({
            model: 12345, // Invalid
            env: 'not-an-object', // Invalid
            alwaysThinkingEnabled: 'yes', // Invalid
            permissions: 'not-an-object', // Invalid
          });
        }
        if (s === projectSettings('/project')) {
          return JSON.stringify({
            model: 'valid-project-model',
            env: { VALID: 'value' },
          });
        }
        return '{}';
      });

      const result = readAllSettings('/project');

      // User settings should be completely removed, project settings should be kept
      expect(result.user).toBeUndefined();
      expect(result.projectShared).toEqual({
        model: 'valid-project-model',
        env: { VALID: 'value' },
      });
      expect(result.merged).toEqual({
        model: 'valid-project-model',
        env: { VALID: 'value' },
      });
    });
  });
});
