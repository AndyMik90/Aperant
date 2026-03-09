import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetToolPath = vi.fn<() => string>();
const mockGetAugmentedEnv = vi.fn<() => Record<string, string>>();

vi.mock('../cli-tool-manager', () => ({
  getToolPath: mockGetToolPath,
}));

vi.mock('../env-utils', () => ({
  getAugmentedEnv: mockGetAugmentedEnv,
}));

describe('claude-cli-utils', () => {
  beforeEach(() => {
    mockGetToolPath.mockReset();
    mockGetAugmentedEnv.mockReset();
    vi.resetModules();
  });

  it('prepends the CLI directory to PATH when the command is absolute', async () => {
    const command = process.platform === 'win32'
      ? 'C:\\Tools\\claude\\claude.exe'
      : '/opt/claude/bin/claude';
    const env = {
      PATH: process.platform === 'win32'
        ? 'C:\\Windows\\System32'
        : '/usr/bin',
      HOME: '/tmp',
    };
    mockGetToolPath.mockReturnValue(command);
    mockGetAugmentedEnv.mockReturnValue(env);

    const { getClaudeCliInvocation } = await import('../cli-utils');
    const result = getClaudeCliInvocation();

    const separator = process.platform === 'win32' ? ';' : ':';
    expect(result.command).toBe(command);
    expect(result.env.PATH.split(separator)[0]).toBe(path.dirname(command));
    expect(result.env.HOME).toBe(env.HOME);
  });

  it('sets PATH to the command directory when PATH is empty', async () => {
    const command = process.platform === 'win32'
      ? 'C:\\Tools\\claude\\claude.exe'
      : '/opt/claude/bin/claude';
    const env = { PATH: '' };
    mockGetToolPath.mockReturnValue(command);
    mockGetAugmentedEnv.mockReturnValue(env);

    const { getClaudeCliInvocation } = await import('../cli-utils');
    const result = getClaudeCliInvocation();

    expect(result.env.PATH).toBe(path.dirname(command));
  });

  it('sets PATH to the command directory when PATH is missing', async () => {
    const command = process.platform === 'win32'
      ? 'C:\\Tools\\claude\\claude.exe'
      : '/opt/claude/bin/claude';
    const env = {};
    mockGetToolPath.mockReturnValue(command);
    mockGetAugmentedEnv.mockReturnValue(env);

    const { getClaudeCliInvocation } = await import('../cli-utils');
    const result = getClaudeCliInvocation();

    expect(result.env.PATH).toBe(path.dirname(command));
  });

  it('keeps PATH unchanged when the command is not absolute', async () => {
    const env = {
      PATH: process.platform === 'win32'
        ? 'C:\\Windows;C:\\Windows\\System32'
        : '/usr/bin:/bin',
    };
    mockGetToolPath.mockReturnValue('claude');
    mockGetAugmentedEnv.mockReturnValue(env);

    const { getClaudeCliInvocation } = await import('../cli-utils');
    const result = getClaudeCliInvocation();

    expect(result.command).toBe('claude');
    expect(result.env.PATH).toBe(env.PATH);
  });

  it('does not duplicate the command directory in PATH', async () => {
    const command = process.platform === 'win32'
      ? 'C:\\Tools\\claude\\claude.exe'
      : '/opt/claude/bin/claude';
    const commandDir = path.dirname(command);
    const separator = process.platform === 'win32' ? ';' : ':';
    const env = { PATH: `${commandDir}${separator}/usr/bin` };

    mockGetToolPath.mockReturnValue(command);
    mockGetAugmentedEnv.mockReturnValue(env);

    const { getClaudeCliInvocation } = await import('../cli-utils');
    const result = getClaudeCliInvocation();

    expect(result.env.PATH).toBe(env.PATH);
  });

  it('treats PATH entries case-insensitively on Windows', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      const command = 'C:\\Tools\\claude\\claude.exe';
      const env = { PATH: 'c:\\tools\\claude;C:\\Windows' };

      mockGetToolPath.mockReturnValue(command);
      mockGetAugmentedEnv.mockReturnValue(env);

      const { getClaudeCliInvocation } = await import('../cli-utils');
      const result = getClaudeCliInvocation();

      expect(result.env.PATH).toBe(env.PATH);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    }
  });
});
