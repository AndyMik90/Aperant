/**
 * Windows Paths Utility Tests
 *
 * Tests for getWhereExePath() and getTaskkillExePath() helper functions,
 * including the private getSystemRoot() fallback logic tested indirectly.
 *
 * Note: On Windows, environment variables are case-insensitive, so
 * `process.env.SystemRoot` and `process.env.SYSTEMROOT` always refer to the
 * same value. The separate-casing fallback in getSystemRoot() is for
 * cross-platform compatibility (Linux/macOS where env vars are case-sensitive).
 * We test the fallback behavior using a platform-aware approach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWhereExePath, getTaskkillExePath } from '../windows-paths';

const isWindows = process.platform === 'win32';

describe('windows-paths', () => {
  // On Windows, SystemRoot and SYSTEMROOT are the same env var (case-insensitive).
  // We save whichever exists and restore it after each test.
  let savedSystemRoot: string | undefined;

  beforeEach(() => {
    // Save the current value (reading either casing works on Windows)
    savedSystemRoot = process.env.SystemRoot;
  });

  afterEach(() => {
    // Restore original env value
    if (savedSystemRoot !== undefined) {
      process.env.SystemRoot = savedSystemRoot;
    } else {
      delete process.env.SystemRoot;
      // On non-Windows, also clean up the uppercase variant independently
      if (!isWindows) {
        delete process.env.SYSTEMROOT;
      }
    }
  });

  describe('getWhereExePath', () => {
    it('returns correct path when SystemRoot env is set', () => {
      process.env.SystemRoot = 'D:\\CustomWindows';

      const result = getWhereExePath();

      expect(result).toContain('CustomWindows');
      expect(result).toContain('System32');
      expect(result).toContain('where.exe');
    });

    it('returns correct path when SYSTEMROOT env is set', () => {
      // On Windows, this is the same as setting SystemRoot (case-insensitive).
      // On non-Windows, this tests the uppercase fallback in getSystemRoot().
      if (!isWindows) {
        delete process.env.SystemRoot;
      }
      process.env.SYSTEMROOT = 'E:\\AltWindows';

      const result = getWhereExePath();

      expect(result).toContain('AltWindows');
      expect(result).toContain('System32');
      expect(result).toContain('where.exe');
    });

    it('falls back to C:\\Windows when neither env var is set', () => {
      delete process.env.SystemRoot;
      if (!isWindows) {
        delete process.env.SYSTEMROOT;
      }

      const result = getWhereExePath();

      // When no env var is set, should fall back to C:\Windows
      expect(result).toContain('Windows');
      expect(result).toContain('System32');
      expect(result).toContain('where.exe');
    });

    it('constructs path ending with System32/where.exe', () => {
      process.env.SystemRoot = 'C:\\Windows';

      const result = getWhereExePath();

      // Accept either backslash (Windows) or forward slash (Unix) as separator
      expect(result).toMatch(/System32[/\\]where\.exe$/);
    });
  });

  describe('getTaskkillExePath', () => {
    it('returns correct path when SystemRoot env is set', () => {
      process.env.SystemRoot = 'D:\\CustomWindows';

      const result = getTaskkillExePath();

      expect(result).toContain('CustomWindows');
      expect(result).toContain('System32');
      expect(result).toContain('taskkill.exe');
    });

    it('returns correct path when SYSTEMROOT env is set', () => {
      if (!isWindows) {
        delete process.env.SystemRoot;
      }
      process.env.SYSTEMROOT = 'E:\\AltWindows';

      const result = getTaskkillExePath();

      expect(result).toContain('AltWindows');
      expect(result).toContain('System32');
      expect(result).toContain('taskkill.exe');
    });

    it('falls back to C:\\Windows when neither env var is set', () => {
      delete process.env.SystemRoot;
      if (!isWindows) {
        delete process.env.SYSTEMROOT;
      }

      const result = getTaskkillExePath();

      expect(result).toContain('Windows');
      expect(result).toContain('System32');
      expect(result).toContain('taskkill.exe');
    });

    it('constructs path ending with System32/taskkill.exe', () => {
      process.env.SystemRoot = 'C:\\Windows';

      const result = getTaskkillExePath();

      // Accept either backslash (Windows) or forward slash (Unix) as separator
      expect(result).toMatch(/System32[/\\]taskkill\.exe$/);
    });
  });

  describe('getSystemRoot precedence (indirect)', () => {
    it('uses the env var value for both functions consistently', () => {
      process.env.SystemRoot = 'F:\\TestRoot';

      const wherePath = getWhereExePath();
      const taskkillPath = getTaskkillExePath();

      expect(wherePath).toContain('TestRoot');
      expect(taskkillPath).toContain('TestRoot');
      expect(wherePath).toMatch(/System32[/\\]where\.exe$/);
      expect(taskkillPath).toMatch(/System32[/\\]taskkill\.exe$/);
    });

    // On non-Windows platforms, env vars are case-sensitive, so we can test
    // that SystemRoot takes precedence over SYSTEMROOT
    it.skipIf(isWindows)('prefers SystemRoot over SYSTEMROOT when both are set (non-Windows only)', () => {
      process.env.SystemRoot = 'D:\\Primary';
      process.env.SYSTEMROOT = 'E:\\Secondary';

      const wherePath = getWhereExePath();
      const taskkillPath = getTaskkillExePath();

      expect(wherePath).toContain('Primary');
      expect(wherePath).not.toContain('Secondary');
      expect(taskkillPath).toContain('Primary');
      expect(taskkillPath).not.toContain('Secondary');
    });
  });
});
