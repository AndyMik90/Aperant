import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClaudeCodeSettingsHierarchy } from '../types';

// Mock the reader module
vi.mock('../reader', () => ({
  readAllSettings: vi.fn(),
  readUserGlobalSettings: vi.fn(),
  readProjectSharedSettings: vi.fn(),
  readProjectLocalSettings: vi.fn(),
  readManagedSettings: vi.fn(),
}));

// Import after mocking
import { readAllSettings } from '../reader';
import { getClaudeCodeEnv } from '../index';

const mockReadAllSettings = vi.mocked(readAllSettings);

describe('getClaudeCodeEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when no settings exist', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: undefined,
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv();

    expect(result).toEqual({});
    expect(mockReadAllSettings).toHaveBeenCalledWith(undefined);
  });

  it('returns empty object when merged settings have no env', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { model: 'claude-sonnet-4-5-20250929' },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: { model: 'claude-sonnet-4-5-20250929' },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv('/project/path');

    expect(result).toEqual({});
    expect(mockReadAllSettings).toHaveBeenCalledWith('/project/path');
  });

  it('returns merged env from user level only', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: { USER_VAR: 'user-value' } },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: { env: { USER_VAR: 'user-value' } },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv();

    expect(result).toEqual({ USER_VAR: 'user-value' });
  });

  it('returns merged env from multiple levels', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: { A: 'user', B: 'user' } },
      projectShared: { env: { B: 'shared', C: 'shared' } },
      projectLocal: { env: { C: 'local', D: 'local' } },
      managed: { env: { D: 'managed', E: 'managed' } },
      merged: {
        env: {
          A: 'user',
          B: 'shared',
          C: 'local',
          D: 'managed',
          E: 'managed',
        },
      },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv('/project/path');

    expect(result).toEqual({
      A: 'user',
      B: 'shared',
      C: 'local',
      D: 'managed',
      E: 'managed',
    });
    expect(mockReadAllSettings).toHaveBeenCalledWith('/project/path');
  });

  it('respects precedence when merging env vars', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: { PATH: '/user/bin', HOME: '/home/user' } },
      projectShared: { env: { PATH: '/project/bin' } },
      projectLocal: undefined,
      managed: { env: { PATH: '/managed/bin', SHELL: '/bin/zsh' } },
      merged: {
        env: {
          PATH: '/managed/bin',
          HOME: '/home/user',
          SHELL: '/bin/zsh',
        },
      },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv('/project/path');

    // PATH should come from managed (highest precedence)
    expect(result.PATH).toBe('/managed/bin');
    // HOME should come from user (only level with it)
    expect(result.HOME).toBe('/home/user');
    // SHELL should come from managed (only level with it)
    expect(result.SHELL).toBe('/bin/zsh');
  });

  it('can be called without project path', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: { VAR: 'value' } },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: { env: { VAR: 'value' } },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv();

    expect(result).toEqual({ VAR: 'value' });
    expect(mockReadAllSettings).toHaveBeenCalledWith(undefined);
  });

  it('handles complex environment variable merging', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        env: {
          NODE_ENV: 'development',
          DEBUG: 'app:*',
          PORT: '3000',
        },
      },
      projectShared: {
        env: {
          DEBUG: 'app:server',
          DATABASE_URL: 'postgres://localhost/db',
        },
      },
      projectLocal: {
        env: {
          PORT: '8080',
          SECRET_KEY: 'local-secret',
        },
      },
      managed: {
        env: {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
        },
      },
      merged: {
        env: {
          NODE_ENV: 'production', // managed wins
          DEBUG: 'app:server', // projectShared wins
          PORT: '8080', // projectLocal wins
          DATABASE_URL: 'postgres://localhost/db', // only in projectShared
          SECRET_KEY: 'local-secret', // only in projectLocal
          LOG_LEVEL: 'info', // only in managed
        },
      },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv('/project/path');

    expect(result).toEqual({
      NODE_ENV: 'production',
      DEBUG: 'app:server',
      PORT: '8080',
      DATABASE_URL: 'postgres://localhost/db',
      SECRET_KEY: 'local-secret',
      LOG_LEVEL: 'info',
    });
  });

  it('returns empty object for all undefined levels with no env', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: undefined,
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {},
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv('/project/path');

    expect(result).toEqual({});
  });

  it('ignores non-env settings and only returns env vars', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: {
        model: 'claude-opus-4-6',
        alwaysThinkingEnabled: true,
        env: { USER_VAR: 'value' },
        permissions: {
          allow: ['git'],
        },
      },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: {
        model: 'claude-opus-4-6',
        alwaysThinkingEnabled: true,
        env: { USER_VAR: 'value' },
        permissions: {
          allow: ['git'],
        },
      },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv();

    // Should only return env vars, not model or permissions
    expect(result).toEqual({ USER_VAR: 'value' });
  });

  it('handles empty env object', () => {
    const hierarchy: ClaudeCodeSettingsHierarchy = {
      user: { env: {} },
      projectShared: undefined,
      projectLocal: undefined,
      managed: undefined,
      merged: { env: {} },
    };

    mockReadAllSettings.mockReturnValue(hierarchy);

    const result = getClaudeCodeEnv();

    expect(result).toEqual({});
  });
});
