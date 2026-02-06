import { describe, it, expect } from 'vitest';
import { mergeClaudeCodeSettings } from '../merger';
import type { ClaudeCodeSettingsHierarchy } from '../types';

describe('mergeClaudeCodeSettings', () => {
  it('returns empty object when hierarchy has all levels undefined', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: undefined,
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result).toEqual({});
  });

  it('returns user settings when only user level is defined', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        model: 'claude-haiku-3-5-20250107',
        alwaysThinkingEnabled: true,
        env: { USER_VAR: 'user-value' },
      },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result).toEqual({
      model: 'claude-haiku-3-5-20250107',
      alwaysThinkingEnabled: true,
      env: { USER_VAR: 'user-value' },
    });
  });

  it('returns managed settings when only managed level is defined', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: undefined,
      projectShared: undefined,
      projectLocal: undefined,
      managed: {
        model: 'claude-sonnet-4-5-20250929',
        permissions: {
          deny: ['rm', 'rmdir'],
        },
      },
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result).toEqual({
      model: 'claude-sonnet-4-5-20250929',
      permissions: {
        deny: ['rm', 'rmdir'],
      },
    });
  });

  it('overrides scalar model: user haiku, project sonnet → sonnet', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { model: 'claude-haiku-3-5-20250107' },
      projectShared: { model: 'claude-sonnet-4-5-20250929' },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('overrides alwaysThinkingEnabled: user true, project false → false', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { alwaysThinkingEnabled: true },
      projectShared: { alwaysThinkingEnabled: false },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.alwaysThinkingEnabled).toBe(false);
  });

  it('deep merges env: user {A:1, B:2}, project {B:3, C:4} → {A:1, B:3, C:4}', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: { A: '1', B: '2' } },
      projectShared: { env: { B: '3', C: '4' } },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.env).toEqual({ A: '1', B: '3', C: '4' });
  });

  it('preserves env when only at one level', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: undefined,
      projectShared: { env: { PROJECT_VAR: 'value' } },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.env).toEqual({ PROJECT_VAR: 'value' });
  });

  it('concatenates permission arrays: user allow=[a], project allow=[b] → [a,b]', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          allow: ['git'],
        },
      },
      projectShared: {
        permissions: {
          allow: ['npm'],
        },
      },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions?.allow).toEqual(['git', 'npm']);
  });

  it('deduplicates permission arrays: user allow=[a,b], project allow=[b,c] → [a,b,c]', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          allow: ['git', 'npm'],
        },
      },
      projectShared: {
        permissions: {
          allow: ['npm', 'docker'],
        },
      },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions?.allow).toEqual(['git', 'npm', 'docker']);
  });

  it('overrides defaultMode: user "ask", local "plan" → "plan"', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          defaultMode: 'ask',
        },
      },
      projectShared: undefined,
      projectLocal: {
        permissions: {
          defaultMode: 'plan',
        },
      },
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions?.defaultMode).toBe('plan');
  });

  it('respects full precedence chain: user < projectShared < projectLocal < managed', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        model: 'user-model',
        env: { A: 'user' },
        permissions: { allow: ['user-tool'] },
      },
      projectShared: {
        model: 'shared-model',
        env: { B: 'shared' },
        permissions: { allow: ['shared-tool'] },
      },
      projectLocal: {
        model: 'local-model',
        env: { C: 'local' },
        permissions: { allow: ['local-tool'] },
      },
      managed: {
        model: 'managed-model',
        env: { D: 'managed' },
        permissions: { deny: ['dangerous-tool'] },
      },
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.model).toBe('managed-model');
    expect(result.env).toEqual({ A: 'user', B: 'shared', C: 'local', D: 'managed' });
    expect(result.permissions?.allow).toEqual(['user-tool', 'shared-tool', 'local-tool']);
    expect(result.permissions?.deny).toEqual(['dangerous-tool']);
  });

  it('handles mixed levels with some undefined', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { model: 'user-model', env: { USER: 'val' } },
      projectShared: undefined,
      projectLocal: { alwaysThinkingEnabled: true },
      managed: { env: { MANAGED: 'val' } },
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.model).toBe('user-model');
    expect(result.alwaysThinkingEnabled).toBe(true);
    expect(result.env).toEqual({ USER: 'val', MANAGED: 'val' });
  });

  it('preserves permissions from lower level when higher level has no permissions', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          allow: ['git', 'npm'],
          deny: ['rm'],
          ask: ['docker'],
          defaultMode: 'ask',
          additionalDirectories: ['/tmp'],
        },
      },
      projectShared: { model: 'some-model' },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions).toEqual({
      allow: ['git', 'npm'],
      deny: ['rm'],
      ask: ['docker'],
      defaultMode: 'ask',
      additionalDirectories: ['/tmp'],
    });
  });

  it('concatenates additionalDirectories and deduplicates', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          additionalDirectories: ['/home/user', '/tmp'],
        },
      },
      projectShared: {
        permissions: {
          additionalDirectories: ['/tmp', '/var/log'],
        },
      },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions?.additionalDirectories).toEqual(['/home/user', '/tmp', '/var/log']);
  });

  it('handles empty permission arrays', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          allow: [],
        },
      },
      projectShared: {
        permissions: {
          deny: [],
        },
      },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    // Empty arrays from lower levels are preserved by mergeArrays
    // When lower=[] and higher=undefined, mergeArrays returns [...lower] = []
    expect(result.permissions?.allow).toEqual([]);
    expect(result.permissions?.deny).toEqual([]);
  });

  it('merges all permission fields correctly', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        permissions: {
          allow: ['git'],
          deny: ['rm'],
        },
      },
      projectShared: {
        permissions: {
          allow: ['npm'],
          ask: ['docker'],
          defaultMode: 'acceptEdits',
        },
      },
      projectLocal: {
        permissions: {
          additionalDirectories: ['/project/data'],
        },
      },
      managed: {
        permissions: {
          deny: ['format'],
        },
      },
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.permissions).toEqual({
      allow: ['git', 'npm'],
      deny: ['rm', 'format'],
      ask: ['docker'],
      defaultMode: 'acceptEdits',
      additionalDirectories: ['/project/data'],
    });
  });

  it('clears env field when result is empty object', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { model: 'some-model' },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result).toEqual({ model: 'some-model' });
    expect(result.env).toBeUndefined();
  });

  it('handles complex multi-level env merge with overrides', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        env: {
          VAR1: 'user1',
          VAR2: 'user2',
          VAR3: 'user3',
        },
      },
      projectShared: {
        env: {
          VAR2: 'shared2',
          VAR4: 'shared4',
        },
      },
      projectLocal: {
        env: {
          VAR3: 'local3',
          VAR5: 'local5',
        },
      },
      managed: {
        env: {
          VAR1: 'managed1',
          VAR6: 'managed6',
        },
      },
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.env).toEqual({
      VAR1: 'managed1', // managed wins
      VAR2: 'shared2', // shared wins (local didn't override)
      VAR3: 'local3', // local wins
      VAR4: 'shared4', // only in shared
      VAR5: 'local5', // only in local
      VAR6: 'managed6', // only in managed
    });
  });

  it('preserves alwaysThinkingEnabled=false from higher precedence level', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { alwaysThinkingEnabled: true },
      projectShared: { alwaysThinkingEnabled: false },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result.alwaysThinkingEnabled).toBe(false);
  });

  it('does not carry over undefined fields', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { model: 'user-model' },
      projectShared: { alwaysThinkingEnabled: true },
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    const result = mergeClaudeCodeSettings(hierarchy);

    expect(result).toEqual({
      model: 'user-model',
      alwaysThinkingEnabled: true,
    });
    expect(result.env).toBeUndefined();
    expect(result.permissions).toBeUndefined();
  });

  // Security: Env var sanitization tests
  describe('environment variable sanitization', () => {
    it('blocks dangerous env vars from projectShared level', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: undefined,
        projectShared: {
          env: {
            LD_PRELOAD: '/tmp/malicious.so',
            NODE_OPTIONS: '--require evil.js',
            SAFE_VAR: 'safe-value',
          },
        },
        projectLocal: undefined,
        managed: undefined,
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      // Dangerous vars should be filtered out, safe var should remain
      expect(result.env).toEqual({ SAFE_VAR: 'safe-value' });
      expect(result.env).not.toHaveProperty('LD_PRELOAD');
      expect(result.env).not.toHaveProperty('NODE_OPTIONS');
    });

    it('blocks dangerous env vars from projectLocal level', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: undefined,
        projectShared: undefined,
        projectLocal: {
          env: {
            DYLD_INSERT_LIBRARIES: '/tmp/backdoor.dylib',
            PYTHONSTARTUP: '/tmp/evil.py',
            SAFE_VAR: 'safe-value',
          },
        },
        managed: undefined,
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      expect(result.env).toEqual({ SAFE_VAR: 'safe-value' });
      expect(result.env).not.toHaveProperty('DYLD_INSERT_LIBRARIES');
      expect(result.env).not.toHaveProperty('PYTHONSTARTUP');
    });

    it('allows user-level env vars (trusted)', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: {
          env: {
            NODE_ENV: 'development',
            CUSTOM_PATH: '/custom/bin',
          },
        },
        projectShared: undefined,
        projectLocal: undefined,
        managed: undefined,
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      expect(result.env).toEqual({
        NODE_ENV: 'development',
        CUSTOM_PATH: '/custom/bin',
      });
    });

    it('blocks dangerous vars even when mixed with safe vars across levels', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: {
          env: {
            USER_VAR: 'user-value',
          },
        },
        projectShared: {
          env: {
            LD_PRELOAD: '/tmp/evil.so',
            SHARED_VAR: 'shared-value',
          },
        },
        projectLocal: {
          env: {
            NODE_OPTIONS: '--require evil.js',
            LOCAL_VAR: 'local-value',
          },
        },
        managed: {
          env: {
            MANAGED_VAR: 'managed-value',
          },
        },
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      // Safe vars from all levels should be present
      expect(result.env).toEqual({
        USER_VAR: 'user-value',
        SHARED_VAR: 'shared-value',
        LOCAL_VAR: 'local-value',
        MANAGED_VAR: 'managed-value',
      });
      // Dangerous vars should be filtered
      expect(result.env).not.toHaveProperty('LD_PRELOAD');
      expect(result.env).not.toHaveProperty('NODE_OPTIONS');
    });

    it('removes env object entirely if all vars are dangerous', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: undefined,
        projectShared: {
          env: {
            LD_PRELOAD: '/tmp/evil.so',
            NODE_OPTIONS: '--require evil.js',
            PYTHONSTARTUP: '/tmp/evil.py',
          },
        },
        projectLocal: undefined,
        managed: undefined,
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      // All vars are dangerous, so env should be removed entirely
      expect(result.env).toBeUndefined();
    });

    it('allows PATH and SHELL (warning vars) from all levels', () => {
      const hierarchy: ClaudeCodeSettingsHierarchy = {
        user: {
          env: { PATH: '/user/bin:/usr/bin' },
        },
        projectShared: {
          env: { SHELL: '/bin/zsh' },
        },
        projectLocal: undefined,
        managed: undefined,
        merged: {},
      };

      const result = mergeClaudeCodeSettings(hierarchy);

      // PATH and SHELL should be allowed (they only trigger warnings)
      expect(result.env).toEqual({
        PATH: '/user/bin:/usr/bin',
        SHELL: '/bin/zsh',
      });
    });
  });
});
