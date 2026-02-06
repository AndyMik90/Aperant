/**
 * Tests for git-isolation module - environment isolation for git operations.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  GIT_ENV_VARS_TO_CLEAR,
  getIsolatedGitEnv,
  getIsolatedGitSpawnOptions,
} from '../git-isolation';

describe('GIT_ENV_VARS_TO_CLEAR', () => {
  it('should contain GIT_DIR', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_DIR');
  });

  it('should contain GIT_WORK_TREE', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_WORK_TREE');
  });

  it('should contain GIT_INDEX_FILE', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_INDEX_FILE');
  });

  it('should contain GIT_OBJECT_DIRECTORY', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_OBJECT_DIRECTORY');
  });

  it('should contain GIT_ALTERNATE_OBJECT_DIRECTORIES', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_ALTERNATE_OBJECT_DIRECTORIES');
  });

  it('should contain author identity variables', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_AUTHOR_NAME');
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_AUTHOR_EMAIL');
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_AUTHOR_DATE');
  });

  it('should contain committer identity variables', () => {
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_COMMITTER_NAME');
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_COMMITTER_EMAIL');
    expect(GIT_ENV_VARS_TO_CLEAR).toContain('GIT_COMMITTER_DATE');
  });
});

describe('getIsolatedGitEnv', () => {
  describe('clears git environment variables', () => {
    it('should remove GIT_DIR from the environment', () => {
      const baseEnv = { GIT_DIR: '/some/path', PATH: '/usr/bin' };
      const env = getIsolatedGitEnv(baseEnv);
      expect(env.GIT_DIR).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin');
    });

    it('should remove GIT_WORK_TREE from the environment', () => {
      const baseEnv = { GIT_WORK_TREE: '/some/worktree', HOME: '/home/user' };
      const env = getIsolatedGitEnv(baseEnv);
      expect(env.GIT_WORK_TREE).toBeUndefined();
      expect(env.HOME).toBe('/home/user');
    });

    it('should remove all git env vars from the clear list', () => {
      const baseEnv: Record<string, string> = {
        PATH: '/usr/bin',
        HOME: '/home/user',
      };
      for (const varName of GIT_ENV_VARS_TO_CLEAR) {
        baseEnv[varName] = `value_${varName}`;
      }

      const env = getIsolatedGitEnv(baseEnv);

      for (const varName of GIT_ENV_VARS_TO_CLEAR) {
        expect(env[varName]).toBeUndefined();
      }
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/user');
    });
  });

  describe('sets HUSKY=0', () => {
    it('should set HUSKY to 0 to disable user hooks', () => {
      const env = getIsolatedGitEnv({ PATH: '/usr/bin' });
      expect(env.HUSKY).toBe('0');
    });

    it('should override any existing HUSKY value', () => {
      const baseEnv = { HUSKY: '1', PATH: '/usr/bin' };
      const env = getIsolatedGitEnv(baseEnv);
      expect(env.HUSKY).toBe('0');
    });
  });

  describe('preserves other environment variables', () => {
    it('should preserve unrelated environment variables', () => {
      const baseEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        LANG: 'en_US.UTF-8',
        CUSTOM_VAR: 'custom_value',
        GIT_DIR: '/should/be/cleared',
      };

      const env = getIsolatedGitEnv(baseEnv);

      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/user');
      expect(env.LANG).toBe('en_US.UTF-8');
      expect(env.CUSTOM_VAR).toBe('custom_value');
    });
  });

  describe('does not modify original environment', () => {
    it('should not mutate the input base environment', () => {
      const baseEnv = { GIT_DIR: '/some/path', PATH: '/usr/bin' };
      const originalGitDir = baseEnv.GIT_DIR;

      getIsolatedGitEnv(baseEnv);

      expect(baseEnv.GIT_DIR).toBe(originalGitDir);
    });
  });

  describe('uses process.env by default', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, GIT_DIR: '/test/path', PATH: '/usr/bin' };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use process.env when no base env is provided', () => {
      const env = getIsolatedGitEnv();
      expect(env.GIT_DIR).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin');
    });
  });
});

describe('getIsolatedGitSpawnOptions', () => {
  it('should return options with cwd and isolated env', () => {
    const opts = getIsolatedGitSpawnOptions('/project/path');

    expect(opts.cwd).toBe('/project/path');
    expect(opts.env).toBeDefined();
    expect((opts.env as Record<string, string>).HUSKY).toBe('0');
    expect(opts.encoding).toBe('utf-8');
  });

  it('should merge additional options', () => {
    const opts = getIsolatedGitSpawnOptions('/project/path', {
      timeout: 5000,
      windowsHide: true,
    });

    expect(opts.cwd).toBe('/project/path');
    expect(opts.timeout).toBe(5000);
    expect(opts.windowsHide).toBe(true);
  });

  it('should allow additional options to override defaults', () => {
    const opts = getIsolatedGitSpawnOptions('/project/path', {
      encoding: 'ascii',
    });

    expect(opts.encoding).toBe('ascii');
  });

  it('should not include git env vars in the returned env', () => {
    const opts = getIsolatedGitSpawnOptions('/project/path');
    const env = opts.env as Record<string, string | undefined>;

    for (const varName of GIT_ENV_VARS_TO_CLEAR) {
      expect(env[varName]).toBeUndefined();
    }
  });
});
