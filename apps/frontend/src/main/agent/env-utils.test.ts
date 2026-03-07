/**
 * Unit tests for env-utils
 * Tests OAuth mode environment variable clearing functionality
 */

import { describe, it, expect } from 'vitest';
import { getOAuthModeClearVars, normalizeEnvPathKey, mergePythonEnvPath } from './env-utils';

describe('getOAuthModeClearVars', () => {
  describe('OAuth mode (no active API profile)', () => {
    it('should return clearing vars when apiProfileEnv is empty', () => {
      const result = getOAuthModeClearVars({});

      expect(result).toEqual({
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_BASE_URL: '',
        ANTHROPIC_MODEL: '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: ''
      });
    });

    it('should clear all ANTHROPIC_* environment variables', () => {
      const result = getOAuthModeClearVars({});

      // Verify all known ANTHROPIC_* vars are cleared
      expect(result.ANTHROPIC_API_KEY).toBe('');
      expect(result.ANTHROPIC_AUTH_TOKEN).toBe('');
      expect(result.ANTHROPIC_BASE_URL).toBe('');
      expect(result.ANTHROPIC_MODEL).toBe('');
      expect(result.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('');
      expect(result.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('');
      expect(result.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('');
    });
  });

  describe('API Profile mode (active profile)', () => {
    it('should return empty object when apiProfileEnv has values', () => {
      const apiProfileEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-active-profile',
        ANTHROPIC_BASE_URL: 'https://custom.api.com'
      };

      const result = getOAuthModeClearVars(apiProfileEnv);

      expect(result).toEqual({});
    });

    it('should NOT clear vars when API profile is active', () => {
      const apiProfileEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-test',
        ANTHROPIC_BASE_URL: 'https://test.com',
        ANTHROPIC_MODEL: 'claude-3-opus'
      };

      const result = getOAuthModeClearVars(apiProfileEnv);

      // Should not return any clearing vars
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should detect non-empty profile even with single property', () => {
      const apiProfileEnv = {
        ANTHROPIC_AUTH_TOKEN: 'sk-minimal'
      };

      const result = getOAuthModeClearVars(apiProfileEnv);

      expect(result).toEqual({});
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined gracefully (treat as empty)', () => {
      // TypeScript should prevent this, but runtime safety
      const result = getOAuthModeClearVars(undefined as any);

      // Should treat undefined as empty object -> OAuth mode
      expect(result).toBeDefined();
    });

    it('should handle null gracefully (treat as empty)', () => {
      // Runtime safety for null values
      const result = getOAuthModeClearVars(null as any);

      // Should treat null as OAuth mode and return clearing vars
      expect(result).toEqual({
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_BASE_URL: '',
        ANTHROPIC_MODEL: '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: ''
      });
    });

    it('should return consistent object shape for OAuth mode', () => {
      const result1 = getOAuthModeClearVars({});
      const result2 = getOAuthModeClearVars({});

      expect(result1).toEqual(result2);
      // Use specific expected keys instead of magic number
      const expectedKeys = [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL'
      ];
      expect(Object.keys(result1).sort()).toEqual(expectedKeys.sort());
    });

    it('should NOT clear if apiProfileEnv has non-ANTHROPIC keys only', () => {
      // Edge case: service returns metadata but no ANTHROPIC_* vars
      const result = getOAuthModeClearVars({ SOME_OTHER_VAR: 'value' });

      // Should treat as OAuth mode since no ANTHROPIC_* keys present
      expect(result).toEqual({
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_BASE_URL: '',
        ANTHROPIC_MODEL: '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: ''
      });
    });
  });
});

describe('normalizeEnvPathKey', () => {
  it('should leave an already-uppercase PATH key untouched', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin:/bin', HOME: '/home/user' };
    normalizeEnvPathKey(env);
    expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/home/user' });
  });

  it('should rename a lowercase-variant "Path" key to "PATH"', () => {
    const env: Record<string, string | undefined> = { Path: 'C:\\Windows\\system32', HOME: '/home/user' };
    normalizeEnvPathKey(env);
    expect(env['PATH']).toBe('C:\\Windows\\system32');
    expect('Path' in env).toBe(false);
  });

  it('should prefer existing "PATH" and remove "Path" when both keys coexist', () => {
    // Simulates process.env spread ('Path') after getAugmentedEnv writes ('PATH')
    const env: Record<string, string | undefined> = {
      Path: 'C:\\old',
      PATH: 'C:\\Windows\\system32;C:\\augmented',
      HOME: '/home/user'
    };
    normalizeEnvPathKey(env);
    expect(env.PATH).toBe('C:\\Windows\\system32;C:\\augmented');
    expect('Path' in env).toBe(false);
  });

  it('should remove all case-variant PATH duplicates when PATH is already present', () => {
    const env: Record<string, string | undefined> = {
      PATH: '/correct',
      Path: '/old1',
      path: '/old2'
    };
    normalizeEnvPathKey(env);
    expect(env.PATH).toBe('/correct');
    expect('Path' in env).toBe(false);
    expect('path' in env).toBe(false);
  });

  it('should handle env with no PATH-like key gracefully', () => {
    const env: Record<string, string | undefined> = { HOME: '/home/user', SHELL: '/bin/zsh' };
    normalizeEnvPathKey(env);
    expect(env).toEqual({ HOME: '/home/user', SHELL: '/bin/zsh' });
  });

  it('should return the same env object reference (mutates in place)', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' };
    const result = normalizeEnvPathKey(env);
    expect(result).toBe(env);
  });
});

describe('mergePythonEnvPath - Windows PATH merge logic (#1661)', () => {
  const SEP = ';'; // Use Windows separator for these tests

  it('should prepend pythonEnv-only entries to the augmented PATH', () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew'
    };
    const mergedPythonEnv: Record<string, string | undefined> = {
      PATH: 'C:\\pywin32_system32;C:\\npm;C:\\homebrew'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    // pywin32_system32 is unique to pythonEnv, so it should be prepended
    expect(mergedPythonEnv.PATH).toBe('C:\\pywin32_system32;C:\\npm;C:\\homebrew');
  });

  it('should deduplicate entries that already exist in augmented PATH', () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew;C:\\pywin32_system32'
    };
    const mergedPythonEnv: Record<string, string | undefined> = {
      PATH: 'C:\\pywin32_system32;C:\\npm'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    // All pythonEnv entries are already in env.PATH, so mergedPythonEnv.PATH should equal env.PATH
    expect(mergedPythonEnv.PATH).toBe('C:\\npm;C:\\homebrew;C:\\pywin32_system32');
  });

  it('should normalize Windows-style "Path" key in pythonEnv to "PATH"', () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew'
    };
    // pythonEnv uses 'Path' (Windows native casing)
    const mergedPythonEnv: Record<string, string | undefined> = {
      Path: 'C:\\pywin32_system32;C:\\npm'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    // 'Path' should be normalized to 'PATH' and pythonEnv-specific entry prepended
    expect('Path' in mergedPythonEnv).toBe(false);
    expect(mergedPythonEnv.PATH).toBe('C:\\pywin32_system32;C:\\npm;C:\\homebrew');
  });

  it('should normalize Windows-style "Path" in env and deduplicate duplicates', () => {
    // Simulates process.env spread ('Path') + getAugmentedEnv write ('PATH') leaving both
    const env: Record<string, string | undefined> = {
      Path: 'C:\\old',
      PATH: 'C:\\npm;C:\\homebrew'
    };
    const mergedPythonEnv: Record<string, string | undefined> = {
      PATH: 'C:\\pywin32_system32;C:\\npm'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    // env 'Path' should be removed; augmented 'PATH' value preserved
    expect('Path' in env).toBe(false);
    expect(env.PATH).toBe('C:\\npm;C:\\homebrew');
    // Only the unique pywin32_system32 entry prepended
    expect(mergedPythonEnv.PATH).toBe('C:\\pywin32_system32;C:\\npm;C:\\homebrew');
  });

  it('should use env.PATH unchanged when pythonEnv has no unique entries', () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew'
    };
    const mergedPythonEnv: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    expect(mergedPythonEnv.PATH).toBe('C:\\npm;C:\\homebrew');
  });

  it('should work correctly with Unix colon separator', () => {
    const unixSep = ':';
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin'
    };
    const mergedPythonEnv: Record<string, string | undefined> = {
      PATH: '/opt/pyenv/shims:/usr/bin:/bin'
    };

    mergePythonEnvPath(env, mergedPythonEnv, unixSep);

    // /opt/pyenv/shims is unique and should be prepended
    expect(mergedPythonEnv.PATH).toBe('/opt/pyenv/shims:/usr/bin:/bin');
  });

  it('should handle missing PATH in pythonEnv gracefully (no-op)', () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\npm;C:\\homebrew'
    };
    // pythonEnv has no PATH at all
    const mergedPythonEnv: Record<string, string | undefined> = {
      PYTHONPATH: '/site-packages'
    };

    mergePythonEnvPath(env, mergedPythonEnv, SEP);

    // Nothing should change
    expect(mergedPythonEnv.PATH).toBeUndefined();
    expect(mergedPythonEnv.PYTHONPATH).toBe('/site-packages');
    expect(env.PATH).toBe('C:\\npm;C:\\homebrew');
  });
});
