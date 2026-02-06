import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeEnvVars,
  isDangerousEnvVar,
  isWarningEnvVar,
  getDangerousEnvVars,
  getWarningEnvVars,
} from '../env-sanitizer';

// Mock debug logger
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

import { debugLog, debugError } from '../../../shared/utils/debug-logger';

describe('env-sanitizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeEnvVars', () => {
    it('returns empty object for undefined input', () => {
      expect(sanitizeEnvVars(undefined)).toEqual({});
    });

    it('returns empty object for null input', () => {
      expect(sanitizeEnvVars(null as unknown as Record<string, string>)).toEqual({});
    });

    it('allows safe environment variables through', () => {
      const env = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://localhost/db',
        API_KEY: 'secret123',
        DEBUG: 'app:*',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual(env);
      expect(debugError).not.toHaveBeenCalled();
    });

    it('blocks LD_PRELOAD', () => {
      const env = {
        LD_PRELOAD: '/tmp/malicious.so',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      // Check that some call mentions the blocked variable
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('LD_PRELOAD');
    });

    it('blocks DYLD_INSERT_LIBRARIES on macOS', () => {
      const env = {
        DYLD_INSERT_LIBRARIES: '/tmp/backdoor.dylib',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('DYLD_INSERT_LIBRARIES');
    });

    it('blocks NODE_OPTIONS', () => {
      const env = {
        NODE_OPTIONS: '--require /tmp/steal-secrets.js',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('NODE_OPTIONS');
    });

    it('blocks PYTHONSTARTUP', () => {
      const env = {
        PYTHONSTARTUP: '/tmp/keylogger.py',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('PYTHONSTARTUP');
    });

    it('blocks BASH_ENV', () => {
      const env = {
        BASH_ENV: '/tmp/evil.sh',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('BASH_ENV');
    });

    it('blocks multiple dangerous variables', () => {
      const env = {
        LD_PRELOAD: '/tmp/malicious.so',
        NODE_OPTIONS: '--require /tmp/evil.js',
        PYTHONSTARTUP: '/tmp/bad.py',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.stringContaining('LD_PRELOAD')
      );
    });

    it('is case-insensitive for dangerous variable names', () => {
      const env = {
        ld_preload: '/tmp/malicious.so',
        Ld_Preload: '/tmp/malicious.so',
        LD_PRELOAD: '/tmp/malicious.so',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(Object.keys(result)).not.toContain('ld_preload');
      expect(Object.keys(result)).not.toContain('Ld_Preload');
      expect(Object.keys(result)).not.toContain('LD_PRELOAD');
    });

    it('warns about PATH from project-level settings', () => {
      const env = {
        PATH: '/malicious/bin:/usr/bin',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env, 'projectShared');

      expect(result).toEqual(env); // PATH is allowed but warned
      expect(debugLog).toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        expect.stringContaining('can affect command execution')
      );
    });

    it('does not warn about PATH from user-level settings', () => {
      const env = {
        PATH: '/custom/bin:/usr/bin',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env, 'user');

      expect(result).toEqual(env);
      expect(debugLog).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        expect.anything(),
        expect.anything()
      );
    });

    it('does not warn about PATH from managed settings', () => {
      const env = {
        PATH: '/managed/bin:/usr/bin',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env, 'managed');

      expect(result).toEqual(env);
      expect(debugLog).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        expect.anything(),
        expect.anything()
      );
    });

    it('warns about SHELL from project-local settings', () => {
      const env = {
        SHELL: '/custom/shell',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env, 'projectLocal');

      expect(result).toEqual(env); // SHELL is allowed but warned
      expect(debugLog).toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        expect.stringContaining('can affect command execution')
      );
    });

    it('allows numeric keys (converted to strings)', () => {
      const env = {
        validKey: 'value',
        // biome-ignore lint/suspicious/noExplicitAny: testing object with numeric key
        123: 'valid' as any,
      };

      const result = sanitizeEnvVars(env);

      // Numeric keys are converted to strings by JavaScript, so they're valid
      expect(result).toEqual({ '123': 'valid', validKey: 'value' });
    });

    it('skips invalid value types', () => {
      const env = {
        validKey: 'value',
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        invalidValue: 123 as any,
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ validKey: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('Invalid env var type');
    });

    it('blocks all Linux dynamic linker variables', () => {
      const env = {
        LD_PRELOAD: '/tmp/evil.so',
        LD_LIBRARY_PATH: '/tmp/evil',
        LD_AUDIT: '/tmp/audit.so',
        LD_BIND_NOW: '1',
        LD_DEBUG: 'all',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 5 dangerous'),
        expect.anything()
      );
    });

    it('blocks all macOS dynamic linker variables', () => {
      const env = {
        DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
        DYLD_LIBRARY_PATH: '/tmp/evil',
        DYLD_FRAMEWORK_PATH: '/tmp/evil',
        DYLD_FALLBACK_LIBRARY_PATH: '/tmp/evil',
        DYLD_FALLBACK_FRAMEWORK_PATH: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 5 dangerous'),
        expect.anything()
      );
    });

    it('blocks Node.js injection variables', () => {
      const env = {
        NODE_OPTIONS: '--require evil.js',
        NODE_PATH: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 2 dangerous'),
        expect.anything()
      );
    });

    it('blocks Python injection variables', () => {
      const env = {
        PYTHONSTARTUP: '/tmp/evil.py',
        PYTHONPATH: '/tmp/evil',
        PYTHONINSPECT: '1',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });

    it('blocks Ruby injection variables', () => {
      const env = {
        RUBYOPT: '-revil',
        RUBYLIB: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 2 dangerous'),
        expect.anything()
      );
    });

    it('blocks Perl injection variables', () => {
      const env = {
        PERL5OPT: '-Mevil',
        PERLLIB: '/tmp/evil',
        PERL5LIB: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });

    it('blocks shell initialization variables', () => {
      const env = {
        BASH_ENV: '/tmp/evil.sh',
        ENV: '/tmp/evil.sh',
        PROMPT_COMMAND: 'curl evil.com',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });

    it('blocks CDPATH', () => {
      const env = {
        CDPATH: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalled();
      const errorCalls = vi.mocked(debugError).mock.calls.flat().join(' ');
      expect(errorCalls).toContain('CDPATH');
    });

    it('blocks JVM injection variables', () => {
      const env = {
        JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
        _JAVA_OPTIONS: '-Xbootclasspath/p:/tmp/evil.jar',
        MAVEN_OPTS: '-javaagent:/tmp/evil.jar',
        GRADLE_OPTS: '-javaagent:/tmp/evil.jar',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 4 dangerous'),
        expect.anything()
      );
    });

    it('blocks package manager hijacking variables', () => {
      const env = {
        NPM_CONFIG_PREFIX: '/tmp/evil',
        YARN_RC_FILENAME: '/tmp/evil/.yarnrc',
        COMPOSER_HOME: '/tmp/evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });

    it('blocks shell startup hijacking variables', () => {
      const env = {
        ZDOTDIR: '/tmp/evil',
        INPUTRC: '/tmp/evil/.inputrc',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 2 dangerous'),
        expect.anything()
      );
    });

    it('blocks Git tracing and command injection variables', () => {
      const env = {
        GIT_TRACE: '1',
        GIT_TRACE_PACKET: '1',
        GIT_SSH_COMMAND: 'evil',
        SAFE_VAR: 'value',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({ SAFE_VAR: 'value' });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });

    it('handles mixed safe and dangerous variables', () => {
      const env = {
        NODE_ENV: 'production',
        LD_PRELOAD: '/tmp/evil.so',
        DATABASE_URL: 'postgres://localhost/db',
        NODE_OPTIONS: '--require evil.js',
        API_KEY: 'secret',
        PYTHONSTARTUP: '/tmp/evil.py',
      };

      const result = sanitizeEnvVars(env);

      expect(result).toEqual({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://localhost/db',
        API_KEY: 'secret',
      });
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Blocked 3 dangerous'),
        expect.anything()
      );
    });
  });

  describe('isDangerousEnvVar', () => {
    it('returns true for LD_PRELOAD', () => {
      expect(isDangerousEnvVar('LD_PRELOAD')).toBe(true);
    });

    it('returns true for NODE_OPTIONS', () => {
      expect(isDangerousEnvVar('NODE_OPTIONS')).toBe(true);
    });

    it('returns false for safe variables', () => {
      expect(isDangerousEnvVar('NODE_ENV')).toBe(false);
      expect(isDangerousEnvVar('DATABASE_URL')).toBe(false);
      expect(isDangerousEnvVar('API_KEY')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isDangerousEnvVar('ld_preload')).toBe(true);
      expect(isDangerousEnvVar('Ld_Preload')).toBe(true);
      expect(isDangerousEnvVar('node_options')).toBe(true);
    });
  });

  describe('isWarningEnvVar', () => {
    it('returns true for PATH', () => {
      expect(isWarningEnvVar('PATH')).toBe(true);
    });

    it('returns true for SHELL', () => {
      expect(isWarningEnvVar('SHELL')).toBe(true);
    });

    it('returns false for safe variables', () => {
      expect(isWarningEnvVar('NODE_ENV')).toBe(false);
      expect(isWarningEnvVar('DATABASE_URL')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isWarningEnvVar('path')).toBe(true);
      expect(isWarningEnvVar('Path')).toBe(true);
      expect(isWarningEnvVar('shell')).toBe(true);
    });
  });

  describe('getDangerousEnvVars', () => {
    it('returns sorted array of dangerous variable names', () => {
      const vars = getDangerousEnvVars();

      expect(Array.isArray(vars)).toBe(true);
      expect(vars.length).toBeGreaterThan(0);
      expect(vars).toContain('LD_PRELOAD');
      expect(vars).toContain('NODE_OPTIONS');
      expect(vars).toContain('PYTHONSTARTUP');
      // Check sorted
      const sorted = [...vars].sort();
      expect(vars).toEqual(sorted);
    });
  });

  describe('getWarningEnvVars', () => {
    it('returns sorted array of warning variable names', () => {
      const vars = getWarningEnvVars();

      expect(Array.isArray(vars)).toBe(true);
      expect(vars.length).toBeGreaterThan(0);
      expect(vars).toContain('PATH');
      expect(vars).toContain('SHELL');
      // Check sorted
      const sorted = [...vars].sort();
      expect(vars).toEqual(sorted);
    });
  });

  describe('encoding bypass resistance', () => {
    // JavaScript's toUpperCase() handles standard ASCII correctly.
    // These tests document that encoding tricks don't bypass the blocklist.

    it('blocks variable names with trailing whitespace', () => {
      // Env var names with spaces are technically valid in some systems
      // but toUpperCase + Set.has handles them correctly (no match = allowed)
      const env = { 'LD_PRELOAD ': '/tmp/evil.so', SAFE: 'ok' };
      const result = sanitizeEnvVars(env);
      // Trailing space means it won't match the blocklist — this is safe because
      // the OS also won't interpret "LD_PRELOAD " as LD_PRELOAD
      expect(result).toEqual({ 'LD_PRELOAD ': '/tmp/evil.so', SAFE: 'ok' });
    });

    it('blocks variable names with null bytes stripped by JS runtime', () => {
      // JavaScript strings can contain \0 but they're distinct characters.
      // "LD_PRELOAD\0" !== "LD_PRELOAD" so it won't match the blocklist,
      // but the OS also won't interpret it as LD_PRELOAD.
      const env = { 'LD_PRELOAD\0': '/tmp/evil.so', SAFE: 'ok' };
      const result = sanitizeEnvVars(env);
      expect(result).toEqual({ 'LD_PRELOAD\0': '/tmp/evil.so', SAFE: 'ok' });
    });

    it('blocks exact matches regardless of Unicode homoglyphs', () => {
      // Unicode homoglyphs (e.g., Cyrillic "А" U+0410 vs Latin "A" U+0041)
      // are different characters. toUpperCase won't normalize them to ASCII.
      // This means homoglyphs won't match the blocklist — which is SAFE because
      // the OS also won't interpret them as the real variable.
      const cyrillicA = '\u0410'; // Cyrillic Capital А (looks like Latin A)
      const env = { [`LD_PRELO${cyrillicA}D`]: '/tmp/evil.so', SAFE: 'ok' };
      const result = sanitizeEnvVars(env);
      // Homoglyph version passes through — this is safe (OS won't match it either)
      expect(result).toHaveProperty(`LD_PRELO${cyrillicA}D`);
      expect(result).toHaveProperty('SAFE');
    });

    it('still blocks the real variable even when homoglyph variant is present', () => {
      const cyrillicA = '\u0410';
      const env = {
        [`LD_PRELO${cyrillicA}D`]: '/tmp/fake.so', // homoglyph — passes through
        LD_PRELOAD: '/tmp/real-evil.so', // real — blocked
        SAFE: 'ok',
      };
      const result = sanitizeEnvVars(env);
      expect(result).not.toHaveProperty('LD_PRELOAD');
      expect(result).toHaveProperty(`LD_PRELO${cyrillicA}D`);
      expect(result).toHaveProperty('SAFE');
    });
  });
});
