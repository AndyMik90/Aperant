/**
 * Unit tests for config-path-validator.ts
 *
 * SECURITY-CRITICAL: These tests validate the isValidConfigDir() function
 * which prevents path traversal attacks and unauthorized filesystem access.
 *
 * Security Model:
 * ----------------
 * The validator allows ANY path within the user's home directory, including:
 * - Direct home directory paths (~/ or $HOME)
 * - Any subdirectory within home (~/Documents, ~/.local, etc.)
 * - The .claude and .claude-profiles directories
 *
 * The validator rejects:
 * - Paths outside home directory (/etc, /var, C:\Windows, etc.)
 * - Path traversal that escapes home (~/.., ~/../../etc/passwd)
 * - Paths in other users' home directories (/home/other, C:\Users\Other)
 * - Attempts to access similar-named paths outside home (/home/alice-malicious when home is /home/alice)
 *
 * Implementation Details:
 * -----------------------
 * 1. All paths are normalized using path.resolve() to handle . and .. components
 * 2. Tilde (~) is expanded to the actual home directory path
 * 3. The normalized path must start with one of the allowed prefixes + path separator
 * 4. Boundary checks prevent attacks like /home/alice-malicious bypassing /home/alice validation
 *
 * Cross-Platform Testing Strategy:
 * ---------------------------------
 * IMPORTANT: Node.js path.resolve() is platform-aware and behaves differently on each OS:
 *
 * - Unix systems: Paths like "C:\Windows" are treated as RELATIVE paths because backslash
 *   is a valid filename character. They resolve to something like "/home/user/project/C:\Windows"
 *
 * - Windows systems: Paths like "C:\Windows" are recognized as ABSOLUTE paths with drive letters
 *
 * This means we CANNOT simply mock process.platform to test all path types on all platforms.
 * The underlying path.resolve() behavior is baked into Node.js's platform-specific implementation.
 *
 * Our approach:
 * 1. Platform-agnostic tests (Unix absolute paths starting with /) run on ALL platforms
 * 2. Platform-specific tests (Windows paths with drive letters) run ONLY on their native OS
 * 3. CI tests on Windows, macOS, AND Linux ensure comprehensive coverage across actual platforms
 * 4. Each platform's CI run validates the security model works correctly for that OS
 *
 * This ensures:
 * - Unix builds verify Unix paths are rejected correctly
 * - Windows builds verify Windows paths are rejected correctly
 * - All builds verify cross-platform logic (tilde expansion, boundary checks, etc.)
 *
 * Testing Considerations:
 * -----------------------
 * - Relative paths (., .., ./config) resolve based on process.cwd()
 * - If tests run from within home directory, relative paths may be valid
 * - Empty string resolves to cwd, which may be within home
 * - Platform-specific paths (Windows C:\, Unix /etc) are tested conditionally
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { isValidConfigDir } from '../utils/config-path-validator';

describe('isValidConfigDir - Security Validation', () => {
  let _originalHomedir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Store original homedir for restoration
    _originalHomedir = os.homedir();

    // Spy on console.warn to suppress warning output during tests
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* intentionally empty - suppress console output during tests */
    });
  });

  afterEach(() => {
    // Restore console.warn
    consoleWarnSpy.mockRestore();
  });

  describe('Valid paths - Should ACCEPT', () => {
    test('accepts paths within home directory', () => {
      const homeDir = os.homedir();

      expect(isValidConfigDir(homeDir)).toBe(true);
      expect(isValidConfigDir(path.join(homeDir, 'Documents'))).toBe(true);
      expect(isValidConfigDir(path.join(homeDir, 'Documents', 'configs'))).toBe(true);
      expect(isValidConfigDir(path.join(homeDir, 'any', 'nested', 'path'))).toBe(true);
    });

    test('accepts tilde paths within home directory', () => {
      expect(isValidConfigDir('~')).toBe(true);
      expect(isValidConfigDir('~/')).toBe(true);
      expect(isValidConfigDir('~/Documents')).toBe(true);
      expect(isValidConfigDir('~/Documents/configs')).toBe(true);
      expect(isValidConfigDir('~/any/nested/path')).toBe(true);
    });

    test('accepts ~/.claude directory', () => {
      const homeDir = os.homedir();

      expect(isValidConfigDir(path.join(homeDir, '.claude'))).toBe(true);
      expect(isValidConfigDir('~/.claude')).toBe(true);
    });

    test('accepts paths within ~/.claude', () => {
      const homeDir = os.homedir();

      expect(isValidConfigDir(path.join(homeDir, '.claude', 'config'))).toBe(true);
      expect(isValidConfigDir(path.join(homeDir, '.claude', 'deep', 'nested', 'path'))).toBe(true);
      expect(isValidConfigDir('~/.claude/config')).toBe(true);
      expect(isValidConfigDir('~/.claude/deep/nested/path')).toBe(true);
    });

    test('accepts ~/.claude-profiles directory', () => {
      const homeDir = os.homedir();

      expect(isValidConfigDir(path.join(homeDir, '.claude-profiles'))).toBe(true);
      expect(isValidConfigDir('~/.claude-profiles')).toBe(true);
    });

    test('accepts paths within ~/.claude-profiles', () => {
      const homeDir = os.homedir();

      expect(isValidConfigDir(path.join(homeDir, '.claude-profiles', 'profile1'))).toBe(true);
      expect(isValidConfigDir(path.join(homeDir, '.claude-profiles', 'profile2', 'config'))).toBe(true);
      expect(isValidConfigDir('~/.claude-profiles/profile1')).toBe(true);
      expect(isValidConfigDir('~/.claude-profiles/profile2/config')).toBe(true);
    });

    test('accepts paths with . and .. that resolve within boundaries', () => {
      const homeDir = os.homedir();

      // These paths use .. but still resolve within home directory
      expect(isValidConfigDir(path.join(homeDir, '.claude', 'foo', '..', 'bar'))).toBe(true);
      expect(isValidConfigDir('~/.claude/foo/../bar')).toBe(true);

      // Path that navigates but stays within bounds
      expect(isValidConfigDir(path.join(homeDir, 'Documents', '..', 'Downloads'))).toBe(true);
    });
  });

  describe('Path traversal attacks - Should REJECT', () => {
    test('rejects path traversal to parent of home directory', () => {
      const homeDir = os.homedir();
      const parentDir = path.dirname(homeDir);

      expect(isValidConfigDir(path.join(homeDir, '..'))).toBe(false);
      expect(isValidConfigDir('~/..')).toBe(false);
      expect(isValidConfigDir(parentDir)).toBe(false);
    });

    test('rejects multiple parent directory traversal attempts', () => {
      expect(isValidConfigDir('~/../..')).toBe(false);
      expect(isValidConfigDir('~/../../..')).toBe(false);
      expect(isValidConfigDir('~/.claude/../..')).toBe(false);
      expect(isValidConfigDir('~/.claude-profiles/../..')).toBe(false);
    });

    test('rejects classic path traversal attack patterns', () => {
      // Note: Relative paths like '../../etc/passwd' will resolve based on cwd.
      // If cwd is within home, they might be valid. Test with absolute paths instead.

      // These definitely escape home directory
      expect(isValidConfigDir('~/../../etc/passwd')).toBe(false);
      expect(isValidConfigDir('~/.claude/../../etc/passwd')).toBe(false);
      expect(isValidConfigDir('~/.claude/../../../etc/passwd')).toBe(false);
    });

    test('rejects paths that traverse beyond home directory boundaries', () => {
      const homeDir = os.homedir();
      const parentOfHome = path.dirname(homeDir);

      // Try to escape using nested paths
      expect(isValidConfigDir(path.join(homeDir, 'Documents', '..', '..', 'etc'))).toBe(false);
      expect(isValidConfigDir(path.join(homeDir, '.claude', '..', '..', 'usr'))).toBe(false);

      // Direct parent paths
      expect(isValidConfigDir(path.join(parentOfHome, 'etc'))).toBe(false);
      expect(isValidConfigDir(path.join(parentOfHome, 'var'))).toBe(false);
    });
  });

  describe('Absolute paths outside home - Should REJECT', () => {
    test('rejects common system directories on Unix-like systems', () => {
      // These absolute Unix paths work correctly on all platforms
      // because they start with / and are universally recognized as absolute
      expect(isValidConfigDir('/etc')).toBe(false);
      expect(isValidConfigDir('/etc/passwd')).toBe(false);
      expect(isValidConfigDir('/var')).toBe(false);
      expect(isValidConfigDir('/var/log')).toBe(false);
      expect(isValidConfigDir('/usr')).toBe(false);
      expect(isValidConfigDir('/usr/local')).toBe(false);
      expect(isValidConfigDir('/tmp')).toBe(false);
      expect(isValidConfigDir('/root')).toBe(false);
      expect(isValidConfigDir('/opt')).toBe(false);
      expect(isValidConfigDir('/bin')).toBe(false);
      expect(isValidConfigDir('/sbin')).toBe(false);
    });

    test('rejects common system directories on Windows', () => {
      // NOTE: Windows-style paths only work correctly when running on Windows
      // On Unix, backslashes are valid filename characters, so these become
      // relative paths like ./C:\Windows (which may be within home if cwd is in home)
      if (process.platform === 'win32') {
        expect(isValidConfigDir('C:\\Windows')).toBe(false);
        expect(isValidConfigDir('C:\\Windows\\System32')).toBe(false);
        expect(isValidConfigDir('C:\\Program Files')).toBe(false);
        expect(isValidConfigDir('C:\\Program Files (x86)')).toBe(false);
        expect(isValidConfigDir('C:\\ProgramData')).toBe(false);
        expect(isValidConfigDir('D:\\Windows')).toBe(false);
      }
    });

    test('rejects paths in other users home directories on Unix', () => {
      // These absolute Unix paths work correctly on all platforms
      expect(isValidConfigDir('/home/otheruser')).toBe(false);
      expect(isValidConfigDir('/home/otheruser/.claude')).toBe(false);
      expect(isValidConfigDir('/root/.claude')).toBe(false);
    });

    test('rejects paths in other users home directories on Windows', () => {
      // NOTE: Windows-style paths only work correctly when running on Windows
      if (process.platform === 'win32') {
        expect(isValidConfigDir('C:\\Users\\OtherUser')).toBe(false);
        expect(isValidConfigDir('C:\\Users\\OtherUser\\.claude')).toBe(false);
      }
    });
  });

  describe('Boundary attack vectors - Should REJECT', () => {
    test('rejects paths with similar prefix but wrong boundary', () => {
      const homeDir = os.homedir();

      // If homeDir is /home/alice, reject /home/alice-malicious
      const similarPath = homeDir + '-malicious';
      expect(isValidConfigDir(similarPath)).toBe(false);

      // Try with subdirectory
      expect(isValidConfigDir(path.join(similarPath, 'configs'))).toBe(false);
    });

    test('accepts directories with .claude prefix but validates boundaries', () => {
      const homeDir = os.homedir();

      // Note: .claude-malicious is still within home directory, so it's accepted.
      // The validator allows ANY path within home, not just .claude and .claude-profiles.
      // The important check is that paths like /home/alice-malicious are rejected.
      const claudeLikePath = path.join(homeDir, '.claude-malicious');
      expect(isValidConfigDir(claudeLikePath)).toBe(true);

      // But paths that try to escape home boundaries are rejected
      const homeDirMaliciousSuffix = homeDir + '-malicious';
      expect(isValidConfigDir(homeDirMaliciousSuffix)).toBe(false);
    });

    test('enforces path separator boundary checks', () => {
      const homeDir = os.homedir();

      // These paths have correct prefix but no separator
      // The validator should only allow exact match or prefix + separator
      const exactMatch = homeDir;
      expect(isValidConfigDir(exactMatch)).toBe(true);

      const withSeparator = path.join(homeDir, 'subdir');
      expect(isValidConfigDir(withSeparator)).toBe(true);

      // Path that looks like home but isn't (if such path could exist)
      // Example: if home is /home/user, test /home/username
      const homeDirParent = path.dirname(homeDir);
      const homeBasename = path.basename(homeDir);
      const similarName = path.join(homeDirParent, homeBasename + 'name');

      // Only reject if this isn't actually within our home (which it shouldn't be)
      if (!similarName.startsWith(homeDir + path.sep) && similarName !== homeDir) {
        expect(isValidConfigDir(similarName)).toBe(false);
      }
    });
  });

  describe('Edge cases and special inputs', () => {
    test('handles empty string based on cwd resolution', () => {
      // Empty string resolves to cwd via path.resolve()
      // If cwd is within home, it will be accepted
      const result = isValidConfigDir('');
      const resolvedPath = path.resolve('');
      const homeDir = os.homedir();
      const shouldBeValid = resolvedPath === homeDir || resolvedPath.startsWith(homeDir + path.sep);

      expect(result).toBe(shouldBeValid);
    });

    test('handles paths with null bytes based on path normalization', () => {
      // Node.js path module handles null bytes - test actual behavior
      // These typically get stripped or cause the path to resolve to cwd

      const result1 = isValidConfigDir('~/.claude\0/../../etc/passwd');
      const result2 = isValidConfigDir('\0/etc/passwd');

      // Just verify function doesn't crash - acceptance depends on path.resolve behavior
      expect(typeof result1).toBe('boolean');
      expect(typeof result2).toBe('boolean');
    });

    test('handles relative paths based on cwd resolution', () => {
      // Relative paths resolve based on cwd
      // If cwd is within home, they will be accepted
      const homeDir = os.homedir();
      const cwd = process.cwd();
      const cwdInHome = cwd === homeDir || cwd.startsWith(homeDir + path.sep);

      if (cwdInHome) {
        // If running from within home, these resolve to valid paths
        expect(isValidConfigDir('.')).toBe(true);
        expect(isValidConfigDir('./config')).toBe(true);

        // .. might escape home depending on cwd depth
        const parentDir = path.resolve('..');
        const parentShouldBeValid = parentDir === homeDir || parentDir.startsWith(homeDir + path.sep);
        expect(isValidConfigDir('..')).toBe(parentShouldBeValid);
      } else {
        // If running from outside home, these should be rejected
        expect(isValidConfigDir('.')).toBe(false);
        expect(isValidConfigDir('..')).toBe(false);
        expect(isValidConfigDir('./config')).toBe(false);
      }
    });

    test('rejects paths with excessive slashes', () => {
      expect(isValidConfigDir('////etc/passwd')).toBe(false);
      expect(isValidConfigDir('~/////..//..//etc')).toBe(false);
    });

    test('rejects UNC paths on Windows', () => {
      // NOTE: UNC paths (\\server\share) only work correctly on Windows
      // On Unix, backslashes are filename characters, making these relative paths
      if (process.platform === 'win32') {
        expect(isValidConfigDir('\\\\server\\share')).toBe(false);
        expect(isValidConfigDir('\\\\server\\share\\config')).toBe(false);
      }
    });

    test('rejects paths with mixed separators on Windows', () => {
      // NOTE: Mixed separator detection only works correctly on Windows
      if (process.platform === 'win32') {
        expect(isValidConfigDir('C:/Windows\\System32')).toBe(false);
        expect(isValidConfigDir('~\\..\\/etc')).toBe(false);
      }
    });
  });

  describe('Console warning output', () => {
    test('logs warning for rejected paths', () => {
      isValidConfigDir('/etc/passwd');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Config Path Validator] Rejected unsafe configDir path:',
        '/etc/passwd',
        '(normalized:',
        expect.any(String),
        ')'
      );
    });

    test('does not log warning for accepted paths', () => {
      consoleWarnSpy.mockClear();

      isValidConfigDir('~/.claude');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Cross-platform compatibility', () => {
    test('handles platform-specific path separators correctly', () => {
      const homeDir = os.homedir();

      // Use platform-appropriate path construction
      const validPath = path.join(homeDir, '.claude', 'config');
      expect(isValidConfigDir(validPath)).toBe(true);

      // Tilde expansion should work on all platforms
      expect(isValidConfigDir('~/.claude/config')).toBe(true);
    });

    test('normalizes paths consistently across platforms', () => {
      const homeDir = os.homedir();

      // Test that normalization works correctly
      const pathWithDots = path.join(homeDir, '.claude', 'foo', '.', 'bar');
      const normalizedPath = path.join(homeDir, '.claude', 'foo', 'bar');

      // Both should be valid if they resolve within boundaries
      expect(isValidConfigDir(pathWithDots)).toBe(true);
      expect(isValidConfigDir(normalizedPath)).toBe(true);
    });
  });

  describe('Real-world attack scenarios', () => {
    test('prevents symbolic link style attacks via path traversal', () => {
      // Attacker tries to use .. to reach /etc after appearing to be in home
      expect(isValidConfigDir('~/.claude/../../../../../etc/passwd')).toBe(false);
    });

    test('prevents encoded path traversal attempts', () => {
      // Some systems might decode %2e%2e to ..
      // The validator should work with the already-decoded path
      expect(isValidConfigDir('~/../etc/passwd')).toBe(false);
    });

    test('prevents Windows drive letter hopping', () => {
      // NOTE: Windows drive letters only work correctly on Windows
      if (process.platform === 'win32') {
        expect(isValidConfigDir('D:\\sensitive-data')).toBe(false);
        expect(isValidConfigDir('E:\\other-drive')).toBe(false);
      }
    });

    test('prevents access to sensitive config directories', () => {
      // Unix absolute paths work correctly on all platforms
      expect(isValidConfigDir('/etc/ssh')).toBe(false);
      expect(isValidConfigDir('/etc/ssl')).toBe(false);
      expect(isValidConfigDir('/etc/security')).toBe(false);

      // Windows paths only work correctly on Windows
      if (process.platform === 'win32') {
        expect(isValidConfigDir('C:\\Windows\\System32\\config')).toBe(false);
      }
    });
  });

  describe('Tilde expansion behavior', () => {
    test('expands tilde to home directory before validation', () => {
      const homeDir = os.homedir();

      // These should be equivalent
      expect(isValidConfigDir('~/.claude')).toBe(isValidConfigDir(path.join(homeDir, '.claude')));
      expect(isValidConfigDir('~/Documents')).toBe(isValidConfigDir(path.join(homeDir, 'Documents')));
    });

    test('handles tilde at start of path only', () => {
      // Tilde in middle should not expand
      const weirdPath = '/some/path/~/config';
      expect(isValidConfigDir(weirdPath)).toBe(false);
    });

    test('handles tilde with following slash correctly', () => {
      expect(isValidConfigDir('~/')).toBe(true);
      expect(isValidConfigDir('~/.')).toBe(true);
      expect(isValidConfigDir('~/.claude')).toBe(true);
    });
  });
});
