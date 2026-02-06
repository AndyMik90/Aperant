/**
 * Platform Module Tests
 *
 * Tests platform abstraction layer using mocks to simulate
 * different operating systems.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as path from 'path';
import {
  getCurrentOS,
  isWindows,
  isMacOS,
  isLinux,
  isUnix,
  getPathConfig,
  getPathDelimiter,
  getExecutableExtension,
  withExecutableExtension,
  getBinaryDirectories,
  getHomebrewPath,
  getShellConfig,
  requiresShell,
  getNpmCommand,
  getNpxCommand,
  isSecurePath,
  normalizePath,
  joinPaths,
  getPlatformDescription
} from '../index.js';

// Mock process.platform
const originalPlatform = process.platform;

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true
  });
}

describe('Platform Module', () => {
  afterEach(() => {
    mockPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  describe('getCurrentOS', () => {
    it('returns win32 on Windows', () => {
      mockPlatform('win32');
      expect(getCurrentOS()).toBe('win32');
    });

    it('returns darwin on macOS', () => {
      mockPlatform('darwin');
      expect(getCurrentOS()).toBe('darwin');
    });

    it('returns linux on Linux', () => {
      mockPlatform('linux');
      expect(getCurrentOS()).toBe('linux');
    });
  });

  describe('OS Detection', () => {
    it('detects Windows correctly', () => {
      mockPlatform('win32');
      expect(isWindows()).toBe(true);
      expect(isMacOS()).toBe(false);
      expect(isLinux()).toBe(false);
      expect(isUnix()).toBe(false);
    });

    it('detects macOS correctly', () => {
      mockPlatform('darwin');
      expect(isWindows()).toBe(false);
      expect(isMacOS()).toBe(true);
      expect(isLinux()).toBe(false);
      expect(isUnix()).toBe(true);
    });

    it('detects Linux correctly', () => {
      mockPlatform('linux');
      expect(isWindows()).toBe(false);
      expect(isMacOS()).toBe(false);
      expect(isLinux()).toBe(true);
      expect(isUnix()).toBe(true);
    });
  });

  describe('Path Configuration', () => {
    it('returns Windows path config on Windows', () => {
      mockPlatform('win32');
      const config = getPathConfig();

      expect(config.separator).toBe(path.sep);
      expect(config.delimiter).toBe(';');
      expect(config.executableExtensions).toContain('.exe');
      expect(config.executableExtensions).toContain('.cmd');
      expect(config.executableExtensions).toContain('.bat');
    });

    it('returns Unix path config on macOS', () => {
      mockPlatform('darwin');
      const config = getPathConfig();

      expect(config.delimiter).toBe(':');
      expect(config.executableExtensions).toEqual(['']);
    });

    it('returns Unix path config on Linux', () => {
      mockPlatform('linux');
      const config = getPathConfig();

      expect(config.delimiter).toBe(':');
      expect(config.executableExtensions).toEqual(['']);
    });
  });

  describe('Path Delimiter', () => {
    it('returns semicolon on Windows', () => {
      mockPlatform('win32');
      expect(getPathDelimiter()).toBe(';');
    });

    it('returns colon on Unix', () => {
      mockPlatform('darwin');
      expect(getPathDelimiter()).toBe(':');
    });
  });

  describe('Executable Extension', () => {
    it('returns .exe on Windows', () => {
      mockPlatform('win32');
      expect(getExecutableExtension()).toBe('.exe');
    });

    it('returns empty string on Unix', () => {
      mockPlatform('darwin');
      expect(getExecutableExtension()).toBe('');
    });
  });

  describe('withExecutableExtension', () => {
    it('adds .exe on Windows when no extension present', () => {
      mockPlatform('win32');
      expect(withExecutableExtension('claude')).toBe('claude.exe');
    });

    it('does not add extension if already present on Windows', () => {
      mockPlatform('win32');
      expect(withExecutableExtension('claude.exe')).toBe('claude.exe');
      expect(withExecutableExtension('npm.cmd')).toBe('npm.cmd');
    });

    it('returns original name on Unix', () => {
      mockPlatform('darwin');
      expect(withExecutableExtension('claude')).toBe('claude');
    });
  });

  describe('Binary Directories', () => {
    it('returns Windows-specific directories on Windows', () => {
      mockPlatform('win32');
      const dirs = getBinaryDirectories();

      expect(dirs.user).toContainEqual(
        expect.stringContaining('AppData')
      );
      expect(dirs.system).toContainEqual(
        expect.stringContaining('Program Files')
      );
    });

    it('returns macOS-specific directories on macOS', () => {
      mockPlatform('darwin');
      const dirs = getBinaryDirectories();

      expect(dirs.system).toContain('/opt/homebrew/bin');
      expect(dirs.system).toContain('/usr/local/bin');
    });

    it('returns Linux-specific directories on Linux', () => {
      mockPlatform('linux');
      const dirs = getBinaryDirectories();

      expect(dirs.system).toContain('/usr/bin');
      expect(dirs.system).toContain('/snap/bin');
    });

    it('has user and system arrays on all platforms', () => {
      // Test Windows
      mockPlatform('win32');
      let dirs = getBinaryDirectories();
      expect(Array.isArray(dirs.user)).toBe(true);
      expect(Array.isArray(dirs.system)).toBe(true);
      expect(dirs.user.length).toBeGreaterThan(0);
      expect(dirs.system.length).toBeGreaterThan(0);

      // Test macOS
      mockPlatform('darwin');
      dirs = getBinaryDirectories();
      expect(Array.isArray(dirs.user)).toBe(true);
      expect(Array.isArray(dirs.system)).toBe(true);
      expect(dirs.user.length).toBeGreaterThan(0);
      expect(dirs.system.length).toBeGreaterThan(0);

      // Test Linux
      mockPlatform('linux');
      dirs = getBinaryDirectories();
      expect(Array.isArray(dirs.user)).toBe(true);
      expect(Array.isArray(dirs.system)).toBe(true);
      expect(dirs.user.length).toBeGreaterThan(0);
      expect(dirs.system.length).toBeGreaterThan(0);
    });

    it('includes user-specific directories with home paths', () => {
      // macOS user dirs
      mockPlatform('darwin');
      let dirs = getBinaryDirectories();
      const hasMacUserDir = dirs.user.some(dir =>
        dir.includes('.local/bin') || dir.includes('bin')
      );
      expect(hasMacUserDir).toBe(true);

      // Linux user dirs
      mockPlatform('linux');
      dirs = getBinaryDirectories();
      const hasLinuxUserDir = dirs.user.some(dir =>
        dir.includes('.local/bin') || dir.includes('bin')
      );
      expect(hasLinuxUserDir).toBe(true);

      // Windows user dirs
      mockPlatform('win32');
      dirs = getBinaryDirectories();
      const hasWindowsUserDir = dirs.user.some(dir =>
        dir.includes('AppData') || dir.includes('.local')
      );
      expect(hasWindowsUserDir).toBe(true);
    });

    it('Windows includes npm global directory', () => {
      mockPlatform('win32');
      const dirs = getBinaryDirectories();

      const hasNpmDir = dirs.user.some(dir =>
        dir.includes('Roaming') && dir.includes('npm')
      );
      expect(hasNpmDir).toBe(true);
    });

    it('Windows includes System32 directory', () => {
      mockPlatform('win32');
      const dirs = getBinaryDirectories();

      const hasSystem32 = dirs.system.some(dir =>
        dir.includes('System32')
      );
      expect(hasSystem32).toBe(true);
    });

    it('Linux includes /usr/local/bin', () => {
      mockPlatform('linux');
      const dirs = getBinaryDirectories();

      expect(dirs.system).toContain('/usr/local/bin');
    });

    it('all directory paths are strings', () => {
      for (const platform of ['win32', 'darwin', 'linux'] as NodeJS.Platform[]) {
        mockPlatform(platform);
        const dirs = getBinaryDirectories();

        for (const dir of [...dirs.user, ...dirs.system]) {
          expect(typeof dir).toBe('string');
          expect(dir.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Homebrew Path', () => {
    it('returns null on non-macOS platforms', () => {
      mockPlatform('win32');
      expect(getHomebrewPath()).toBe(null);

      mockPlatform('linux');
      expect(getHomebrewPath()).toBe(null);
    });

    it('returns path on macOS', () => {
      mockPlatform('darwin');
      const result = getHomebrewPath();

      // Should be one of the Homebrew paths
      expect(['/opt/homebrew/bin', '/usr/local/bin']).toContain(result);
    });
  });

  describe('Shell Configuration', () => {
    it('returns PowerShell config on Windows by default', () => {
      mockPlatform('win32');
      const config = getShellConfig();

      // Accept either PowerShell Core (pwsh.exe), Windows PowerShell (powershell.exe),
      // or cmd.exe fallback (when PowerShell paths don't exist, e.g., in test environments)
      const isValidShell = config.executable.includes('pwsh.exe') ||
                           config.executable.includes('powershell.exe') ||
                           config.executable.includes('cmd.exe');
      expect(isValidShell).toBe(true);
    });

    it('returns shell config on macOS', () => {
      mockPlatform('darwin');
      const config = getShellConfig();

      expect(config.args).toEqual(['-l']);
      expect(config.env).toEqual({});
      expect(typeof config.executable).toBe('string');
    });

    it('returns shell config on Linux', () => {
      mockPlatform('linux');
      const config = getShellConfig();

      expect(config.args).toEqual(['-l']);
      expect(config.env).toEqual({});
      expect(typeof config.executable).toBe('string');
    });

    it('shell config has required properties on all platforms', () => {
      // Test Windows
      mockPlatform('win32');
      let config = getShellConfig();
      expect(config).toHaveProperty('executable');
      expect(config).toHaveProperty('args');
      expect(config).toHaveProperty('env');
      expect(Array.isArray(config.args)).toBe(true);
      expect(typeof config.env).toBe('object');

      // Test macOS
      mockPlatform('darwin');
      config = getShellConfig();
      expect(config).toHaveProperty('executable');
      expect(config).toHaveProperty('args');
      expect(config).toHaveProperty('env');
      expect(Array.isArray(config.args)).toBe(true);
      expect(typeof config.env).toBe('object');

      // Test Linux
      mockPlatform('linux');
      config = getShellConfig();
      expect(config).toHaveProperty('executable');
      expect(config).toHaveProperty('args');
      expect(config).toHaveProperty('env');
      expect(Array.isArray(config.args)).toBe(true);
      expect(typeof config.env).toBe('object');
    });

    it('Unix shell uses login shell flag', () => {
      mockPlatform('darwin');
      const config = getShellConfig();
      expect(config.args).toContain('-l');
    });
  });

  describe('requiresShell', () => {
    it('returns true for .cmd files on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('npm.cmd')).toBe(true);
      expect(requiresShell('script.cmd')).toBe(true);
    });

    it('returns true for .bat files on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('script.bat')).toBe(true);
      expect(requiresShell('run.bat')).toBe(true);
    });

    it('returns true for .ps1 files on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('script.ps1')).toBe(true);
      expect(requiresShell('setup.ps1')).toBe(true);
    });

    it('returns false for .exe files on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('node.exe')).toBe(false);
      expect(requiresShell('claude.exe')).toBe(false);
    });

    it('returns false for executables without extension on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('node')).toBe(false);
    });

    it('returns false on macOS regardless of extension', () => {
      mockPlatform('darwin');
      expect(requiresShell('npm')).toBe(false);
      expect(requiresShell('script.sh')).toBe(false);
      expect(requiresShell('node')).toBe(false);
    });

    it('returns false on Linux regardless of extension', () => {
      mockPlatform('linux');
      expect(requiresShell('npm')).toBe(false);
      expect(requiresShell('script.sh')).toBe(false);
      expect(requiresShell('node')).toBe(false);
    });

    it('handles case-insensitive extensions on Windows', () => {
      mockPlatform('win32');
      expect(requiresShell('script.CMD')).toBe(true);
      expect(requiresShell('script.Cmd')).toBe(true);
      expect(requiresShell('script.BAT')).toBe(true);
      expect(requiresShell('script.PS1')).toBe(true);
    });
  });

  describe('npm Commands', () => {
    it('returns npm.cmd on Windows', () => {
      mockPlatform('win32');
      expect(getNpmCommand()).toBe('npm.cmd');
      expect(getNpxCommand()).toBe('npx.cmd');
    });

    it('returns npm on macOS', () => {
      mockPlatform('darwin');
      expect(getNpmCommand()).toBe('npm');
      expect(getNpxCommand()).toBe('npx');
    });

    it('returns npm on Linux', () => {
      mockPlatform('linux');
      expect(getNpmCommand()).toBe('npm');
      expect(getNpxCommand()).toBe('npx');
    });

    it('returns consistent commands across multiple calls', () => {
      mockPlatform('win32');
      const npm1 = getNpmCommand();
      const npm2 = getNpmCommand();
      const npx1 = getNpxCommand();
      const npx2 = getNpxCommand();
      expect(npm1).toBe(npm2);
      expect(npx1).toBe(npx2);
    });
  });

  describe('isSecurePath', () => {
    it('rejects empty and whitespace-only strings', () => {
      mockPlatform('darwin');
      expect(isSecurePath('')).toBe(false);
      expect(isSecurePath('   ')).toBe(false);
      expect(isSecurePath('\t')).toBe(false);
      expect(isSecurePath('\n')).toBe(false);
    });

    it('rejects paths with .. on all platforms', () => {
      mockPlatform('win32');
      expect(isSecurePath('../etc/passwd')).toBe(false);
      expect(isSecurePath('../../Windows')).toBe(false);

      mockPlatform('darwin');
      expect(isSecurePath('../etc/passwd')).toBe(false);
    });

    it('rejects shell metacharacters (command injection prevention)', () => {
      mockPlatform('darwin');
      expect(isSecurePath('cmd;rm -rf /')).toBe(false);
      expect(isSecurePath('cmd|cat /etc/passwd')).toBe(false);
      expect(isSecurePath('cmd`whoami`')).toBe(false);
      expect(isSecurePath('cmd$(whoami)')).toBe(false);
      expect(isSecurePath('cmd{test}')).toBe(false);
      expect(isSecurePath('cmd<input')).toBe(false);
      expect(isSecurePath('cmd>output')).toBe(false);
    });

    it('rejects Windows environment variable expansion', () => {
      mockPlatform('win32');
      expect(isSecurePath('%PROGRAMFILES%\\cmd.exe')).toBe(false);
      expect(isSecurePath('%SystemRoot%\\System32\\cmd.exe')).toBe(false);
    });

    it('rejects newline injection', () => {
      mockPlatform('darwin');
      expect(isSecurePath('cmd\n/bin/sh')).toBe(false);
      expect(isSecurePath('cmd\r\n/bin/sh')).toBe(false);
    });

    it('rejects null byte injection', () => {
      mockPlatform('darwin');
      expect(isSecurePath('cmd\x00.txt')).toBe(false);
      expect(isSecurePath('file\x00evil')).toBe(false);
    });

    it('validates Windows executable names', () => {
      mockPlatform('win32');
      expect(isSecurePath('claude.exe')).toBe(true);
      expect(isSecurePath('my-script.cmd')).toBe(true);
      expect(isSecurePath('valid_name-123.exe')).toBe(true);
      expect(isSecurePath('dangerous;command.exe')).toBe(false);
      expect(isSecurePath('bad&name.exe')).toBe(false);
    });

    it('accepts valid paths on Unix', () => {
      mockPlatform('darwin');
      expect(isSecurePath('/usr/bin/node')).toBe(true);
      expect(isSecurePath('/opt/homebrew/bin/python3')).toBe(true);
    });
  });

  describe('normalizePath', () => {
    it('normalizes paths correctly', () => {
      const result = normalizePath('some/path/./to/../file');
      expect(result).toContain('file');
    });
  });

  describe('joinPaths', () => {
    it('joins paths with platform separator', () => {
      const result = joinPaths('home', 'user', 'project');
      expect(result).toContain('project');
    });
  });

  describe('getPlatformDescription', () => {
    it('returns platform description', () => {
      const desc = getPlatformDescription();
      expect(desc).toMatch(/(Windows|macOS|Linux)/);
      expect(desc).toMatch(/\(.*\)/); // Architecture in parentheses
    });
  });
});
