/**
 * Unit tests for package-with-python.cjs security validation
 *
 * Tests the validateArgs function which prevents command injection via
 * shell metacharacters when shell: true is used on Windows.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
// Import from the scripts directory (relative to src/main/__tests__)
// @ts-expect-error - TypeScript doesn't auto-resolve .d.ts for .cjs imports (types exist in package-with-python.d.ts)
import { validateArgs, SHELL_METACHARACTERS } from '../../../scripts/package-with-python.cjs';

// Mock the isWindows function from platform.cjs
const originalPlatform = process.platform;

describe('validateArgs', () => {
  // We need to mock the isWindows function by modifying process.platform
  // since the platform.cjs module uses process.platform === 'win32' to check

  afterEach(() => {
    // Restore original platform after each test
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  describe('on Windows (shell injection risk)', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });
    });

    describe('should throw for shell metacharacters', () => {
      // Test each metacharacter individually
      it.each([
        ['&', 'command & malicious'],
        ['|', 'command | malicious'],
        ['>', 'output > file.txt'],
        ['<', 'command < input.txt'],
        ['^', 'escape ^ character'],
        ['%', '%PATH%'],
        [';', 'command ; malicious'],
        ['$', '$variable'],
        ['(', 'command (group)'],
        [')', 'command)after'],
        ['[', 'array[index]'],
        [']', 'command]after'],
        ['{', '{block}'],
        ['}', 'command}after'],
        ['!', '!delayed!'],
        ['"', '"quoted"'],
        ['`', 'command `subshell`'],
        ['\n', 'command\nnext'],
        ['\r', 'command\rnext'],
      ])('should throw for metacharacter "%s"', (char, arg) => {
        expect(() => validateArgs([arg])).toThrowError(/shell metacharacter/);
        expect(() => validateArgs([arg])).toThrowError(new RegExp(`\\${char}`));
      });

      // Test metacharacters in different positions
      it('should throw when metacharacter is at the start', () => {
        expect(() => validateArgs(['& malicious'])).toThrow();
      });

      it('should throw when metacharacter is in the middle', () => {
        expect(() => validateArgs(['config&malicious'])).toThrow();
      });

      it('should throw when metacharacter is at the end', () => {
        expect(() => validateArgs(['config&'])).toThrow();
      });

      // Test multiple metacharacters
      it('should throw for multiple metacharacters in one argument', () => {
        expect(() => validateArgs(['& | >'])).toThrow();
      });

      // Test metacharacters across multiple arguments
      it('should throw for metacharacters in different arguments', () => {
        expect(() => validateArgs(['--flag', 'value&', 'other'])).toThrow();
      });

      // Test error message includes the offending argument
      it('should include offending argument in error message', () => {
        expect(() => validateArgs(['file&evil.exe']))
          .toThrowError(/Argument: "file&evil\.exe"/);
      });
    });

    describe('should throw for non-string arguments', () => {
      it('should throw TypeError for null argument', () => {
        expect(() => validateArgs([null])).toThrowError(TypeError);
        expect(() => validateArgs([null])).toThrowError(/must be a string/);
      });

      it('should throw TypeError for undefined argument', () => {
        expect(() => validateArgs([undefined])).toThrowError(TypeError);
        expect(() => validateArgs([undefined])).toThrowError(/must be a string/);
      });

      it('should throw TypeError for number argument', () => {
        expect(() => validateArgs([123])).toThrowError(TypeError);
        expect(() => validateArgs([123])).toThrowError(/got number/);
      });

      it('should throw TypeError for object argument', () => {
        expect(() => validateArgs([{ key: 'value' }])).toThrowError(TypeError);
        expect(() => validateArgs([{ key: 'value' }])).toThrowError(/got object/);
      });

      it('should throw TypeError for mixed valid and invalid arguments', () => {
        expect(() => validateArgs(['--flag', null])).toThrowError(TypeError);
      });
    });

    describe('should NOT throw for safe inputs', () => {
      it('should allow empty array', () => {
        expect(() => validateArgs([])).not.toThrow();
      });

      it('should allow alphanumeric arguments', () => {
        expect(() => validateArgs(['build', 'test', 'production'])).not.toThrow();
      });

      it('should allow flag arguments', () => {
        expect(() => validateArgs(['--win', '--x64', '--publish=never'])).not.toThrow();
      });

      it('should allow paths with forward slashes', () => {
        expect(() => validateArgs(['../config/file.txt'])).not.toThrow();
      });

      it('should allow paths with backslashes', () => {
        // Use path.win32.join to construct a Windows-style path without hardcoding system locations
        const windowsPath = path.win32.join('C:', 'Apps', 'App', 'config.txt');
        expect(() => validateArgs([windowsPath])).not.toThrow();
      });

      it('should allow dots and hyphens', () => {
        expect(() => validateArgs(['--config.file', 'my-config.json'])).not.toThrow();
      });

      it('should allow underscores', () => {
        expect(() => validateArgs(['my_config_file', '--output_dir'])).not.toThrow();
      });

      it('should allow @ symbol', () => {
        expect(() => validateArgs(['@lydell/node-pty'])).not.toThrow();
      });

      it('should allow equals sign', () => {
        expect(() => validateArgs(['--publish=never'])).not.toThrow();
      });

      it('should allow common electron-builder arguments', () => {
        expect(() => validateArgs([
          '--win',
          '--x64',
          '--publish',
          'never',
          '--config',
          'config.yml'
        ])).not.toThrow();
      });
    });
  });

  describe('on non-Windows platforms', () => {
    it('should return immediately on macOS without throwing', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      // Even with metacharacters, should not throw on non-Windows
      expect(() => validateArgs(['command & malicious'])).not.toThrow();
    });

    it('should return immediately on Linux without throwing', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      // Even with metacharacters, should not throw on non-Windows
      expect(() => validateArgs(['command & malicious'])).not.toThrow();
    });

    it('should allow empty array on macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      expect(() => validateArgs([])).not.toThrow();
    });
  });
});

describe('SHELL_METACHARACTERS constant', () => {
  it('should contain all expected dangerous characters', () => {
    const expectedChars = [
      '&', '|', '>', '<', '^', '%', ';', '$',
      '(', ')', '[', ']', '{', '}',
      '!', '"', '`', '\n', '\r'
    ];
    expect(SHELL_METACHARACTERS).toEqual(expect.arrayContaining(expectedChars));
  });
});
