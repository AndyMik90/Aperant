import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as pty from '@lydell/node-pty';
import type { TerminalProcess } from '../types';
import { buildCdCommand, escapeShellArg } from '../../../shared/utils/shell-escape';

// Mock the platform module (main/platform/index.ts)
vi.mock('../../platform', () => ({
  isWindows: vi.fn(() => false),
  isMacOS: vi.fn(() => false),
  isLinux: vi.fn(() => false),
  isUnix: vi.fn(() => false),
  getCurrentOS: vi.fn(() => 'linux'),
}));

import { isWindows } from '../../platform';

/** Escape special regex characters in a string for safe use in RegExp constructor */
const escapeForRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mockGetClaudeCliInvocation = vi.fn();
const mockGetClaudeCliInvocationAsync = vi.fn();
const mockGetClaudeProfileManager = vi.fn();
const mockInitializeClaudeProfileManager = vi.fn();
const mockPersistSession = vi.fn();
const mockReleaseSessionId = vi.fn();

const createMockDisposable = (): pty.IDisposable => ({ dispose: vi.fn() });

const createMockPty = (): pty.IPty => ({
  pid: 123,
  cols: 80,
  rows: 24,
  process: 'bash',
  handleFlowControl: false,
  onData: vi.fn(() => createMockDisposable()),
  onExit: vi.fn(() => createMockDisposable()),
  write: vi.fn(),
  resize: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  kill: vi.fn(),
  clear: vi.fn(),
});

const createMockTerminal = (overrides: Partial<TerminalProcess> = {}): TerminalProcess => ({
  id: 'term-1',
  pty: createMockPty(),
  outputBuffer: '',
  isClaudeMode: false,
  claudeSessionId: undefined,
  claudeProfileId: undefined,
  title: 'Terminal 1',  // Use default terminal name pattern to match production behavior
  cwd: '/tmp/project',
  projectPath: '/tmp/project',
  ...overrides,
});

vi.mock('../../claude-cli-utils', () => ({
  getClaudeCliInvocation: mockGetClaudeCliInvocation,
  getClaudeCliInvocationAsync: mockGetClaudeCliInvocationAsync,
}));

vi.mock('../../claude-profile-manager', () => ({
  getClaudeProfileManager: mockGetClaudeProfileManager,
  initializeClaudeProfileManager: mockInitializeClaudeProfileManager,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
    },
  };
});

vi.mock('../session-handler', () => ({
  persistSession: mockPersistSession,
  releaseSessionId: mockReleaseSessionId,
}));

// Mock PtyManager.writeToPty - the implementation now uses this instead of terminal.pty.write
const mockWriteToPty = vi.fn();
vi.mock('../pty-manager', () => ({
  writeToPty: mockWriteToPty,
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    tmpdir: vi.fn(() => '/tmp'),
  };
});

/**
 * Helper to set the current platform for testing
 */
function mockPlatform(platform: 'win32' | 'darwin' | 'linux') {
  const mockIsWindows = vi.mocked(isWindows);
  mockIsWindows.mockReturnValue(platform === 'win32');
}

/**
 * Helper to get platform-specific expectations for PATH prefix
 */
function getPathPrefixExpectation(
  platform: 'win32' | 'darwin' | 'linux',
  pathValue: string,
  command: string
): string {
  // Absolute executable commands no longer need PATH prefix injection.
  if (path.isAbsolute(command)) {
    return '';
  }

  if (platform === 'win32') {
    // Windows: set "PATH=value" &&
    return `set "PATH=${pathValue}" && `;
  }
  // Unix/macOS: PATH='value' '
  return `PATH='${pathValue}' `;
}

function expectPathPrefix(
  written: string,
  platform: 'win32' | 'darwin' | 'linux',
  pathValue: string,
  command: string
): void {
  const expectedPrefix = getPathPrefixExpectation(platform, pathValue, command);
  if (expectedPrefix) {
    expect(written).toContain(expectedPrefix);
  } else {
    expect(written).not.toContain('PATH=');
  }
}

/**
 * Helper to get platform-specific expectations for command quoting
 */
function getQuotedCommand(platform: 'win32' | 'darwin' | 'linux', command: string): string {
  if (platform === 'win32') {
    // Windows: double quotes, use escapeForWindowsDoubleQuote logic
    // Inside double quotes, only " needs escaping (as "")
    const escaped = command.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  // Unix/macOS: use escapeShellArg which properly handles embedded single quotes
  return escapeShellArg(command);
}

/**
 * Helper to get platform-specific clear command
 */
function getClearCommand(platform: 'win32' | 'darwin' | 'linux'): string {
  return platform === 'win32' ? 'cls' : 'clear';
}

/**
 * Helper to get platform-specific history prefix
 */
function getHistoryPrefix(platform: 'win32' | 'darwin' | 'linux'): string {
  return platform === 'win32' ? '' : 'HISTFILE= HISTCONTROL=ignorespace ';
}

/**
 * Helper to get platform-specific temp file extension
 */
function getTempFileExtension(platform: 'win32' | 'darwin' | 'linux'): string {
  return platform === 'win32' ? '.bat' : '';
}

/**
 * Helper to get platform-specific token file content
 */
function getTokenFileContent(platform: 'win32' | 'darwin' | 'linux', token: string): string {
  if (platform === 'win32') {
    return `@echo off\r\nset "CLAUDE_CODE_OAUTH_TOKEN=${token}"\r\n`;
  }
  return `export CLAUDE_CODE_OAUTH_TOKEN='${token}'\n`;
}

/**
 * Helper to get platform-specific temp file invocation
 */
function getTempFileInvocation(platform: 'win32' | 'darwin' | 'linux', tokenPath: string): string {
  if (platform === 'win32') {
    return `call "${tokenPath}"`;
  }
  return `source '${tokenPath}'`;
}

/**
 * Helper to get platform-specific temp file cleanup
 *
 * Note: Windows now deletes BEFORE the command runs (synchronous)
 * for security - environment variables persist in memory after deletion.
 */
function getTempFileCleanup(platform: 'win32' | 'darwin' | 'linux', tokenPath: string): string {
  if (platform === 'win32') {
    return `&& del "${tokenPath}" &&`;
  }
  return `&& rm -f '${tokenPath}' &&`;
}

/**
 * Helper to get platform-specific exec command
 */
function getExecCommand(platform: 'win32' | 'darwin' | 'linux', command: string): string {
  if (platform === 'win32') {
    return command; // Windows doesn't use exec
  }
  return `exec ${command}`;
}

/**
 * Helper to get platform-specific config dir command
 */
function getConfigDirCommand(platform: 'win32' | 'darwin' | 'linux', configDir: string): string {
  if (platform === 'win32') {
    return `set "CLAUDE_CONFIG_DIR=${configDir}"`;
  }
  return `CLAUDE_CONFIG_DIR='${configDir}'`;
}

describe('claude-integration-handler', () => {
  beforeEach(() => {
    mockGetClaudeCliInvocation.mockClear();
    mockGetClaudeProfileManager.mockClear();
    mockPersistSession.mockClear();
    mockReleaseSessionId.mockClear();
    mockWriteToPty.mockClear();
    vi.mocked(writeFileSync).mockClear();
  });

  describe.each(['win32', 'darwin', 'linux'] as const)('on %s', (platform) => {
    beforeEach(() => {
      mockPlatform(platform);
    });

    it('uses the resolved CLI path and PATH prefix when invoking Claude', async () => {
      mockGetClaudeCliInvocation.mockReturnValue({
        command: "/opt/claude bin/claude's",
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockGetClaudeProfileManager.mockReturnValue(profileManager);

      const terminal = createMockTerminal();

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', undefined, () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      expect(written).toContain(buildCdCommand('/tmp/project'));
      expectPathPrefix(written, platform, '/opt/claude/bin:/usr/bin', "/opt/claude bin/claude's");
      expect(written).toContain(getQuotedCommand(platform, "/opt/claude bin/claude's"));
      expect(mockReleaseSessionId).toHaveBeenCalledWith('term-1');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
      expect(profileManager.getActiveProfile).toHaveBeenCalled();
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('default');
    });

    it('uses the temp token flow when the active profile has an oauth token', async () => {
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => ({
          id: 'prof-1',
          name: 'Work',
          isDefault: false,
          oauthToken: 'token-value',
        })),
        getProfileToken: vi.fn(() => 'token-value'),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocation.mockReturnValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockGetClaudeProfileManager.mockReturnValue(profileManager);
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234);

      const terminal = createMockTerminal({ id: 'term-3' });

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', 'prof-1', () => null, vi.fn());

      const tokenPath = vi.mocked(writeFileSync).mock.calls[0]?.[0] as string;
      const tokenContents = vi.mocked(writeFileSync).mock.calls[0]?.[1] as string;
      const tokenPrefix = path.join(tmpdir(), '.claude-token-1234-');
      const tokenExt = getTempFileExtension(platform);
      expect(tokenPath).toMatch(new RegExp(`^${escapeForRegex(tokenPrefix)}[0-9a-f]{16}${escapeForRegex(tokenExt)}$`));
      expect(tokenContents).toBe(getTokenFileContent(platform, 'token-value'));

      const written = mockWriteToPty.mock.calls[0][1] as string;
      const clearCmd = getClearCommand(platform);
      const histPrefix = getHistoryPrefix(platform);
      const cmdQuote = platform === 'win32' ? '"' : "'";

      expect(written).toContain(histPrefix);
      expect(written).toContain(clearCmd);
      expect(written).toContain(getTempFileInvocation(platform, tokenPath));
      expect(written).toContain(getTempFileCleanup(platform, tokenPath));
      expect(written).toContain(`${cmdQuote}${command}${cmdQuote}`);
      expect(profileManager.getProfile).toHaveBeenCalledWith('prof-1');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);

      nowSpy.mockRestore();
    });

    it('prefers the config dir flow when profile has both oauth token and config dir', async () => {
      // The configDir method is preferred over temp-file because CLAUDE_CONFIG_DIR lets
      // Claude Code read full Keychain credentials including subscriptionType ("max") and
      // rateLimitTier. Using CLAUDE_CODE_OAUTH_TOKEN alone lacks tier info.
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => ({
          id: 'prof-both',
          name: 'Work',
          isDefault: false,
          oauthToken: 'token-value',
          configDir: '/tmp/claude-config',
        })),
        getProfileToken: vi.fn(() => 'token-value'),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocation.mockReturnValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockGetClaudeProfileManager.mockReturnValue(profileManager);

      const terminal = createMockTerminal({ id: 'term-both' });

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', 'prof-both', () => null, vi.fn());

      // Should NOT write a temp file - configDir is used instead
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();

      const written = mockWriteToPty.mock.calls[0][1] as string;
      const clearCmd = getClearCommand(platform);
      const histPrefix = getHistoryPrefix(platform);
      const configDir = getConfigDirCommand(platform, '/tmp/claude-config');

      expect(written).toContain(histPrefix);
      expect(written).toContain(configDir);
      expect(written).toContain(clearCmd);
      expect(written).toContain(getQuotedCommand(platform, command));
      expect(profileManager.getProfile).toHaveBeenCalledWith('prof-both');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('prof-both');
    });

    it('handles missing profiles by falling back to the default command', async () => {
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => undefined),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocation.mockReturnValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockGetClaudeProfileManager.mockReturnValue(profileManager);

      const terminal = createMockTerminal({ id: 'term-6' });

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', 'missing', () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      expect(written).toContain(getQuotedCommand(platform, command));
      expect(profileManager.getProfile).toHaveBeenCalledWith('missing');
      expect(profileManager.markProfileUsed).not.toHaveBeenCalled();
    });

    it('uses the config dir flow when the active profile has a config dir', async () => {
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => ({
          id: 'prof-2',
          name: 'Work',
          isDefault: false,
          configDir: '/tmp/claude-config',
        })),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocation.mockReturnValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockGetClaudeProfileManager.mockReturnValue(profileManager);

      const terminal = createMockTerminal({ id: 'term-4' });

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', 'prof-2', () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      const clearCmd = getClearCommand(platform);
      const histPrefix = getHistoryPrefix(platform);
      const configDir = getConfigDirCommand(platform, '/tmp/claude-config');

      expect(written).toContain(histPrefix);
      expect(written).toContain(configDir);
      expectPathPrefix(written, platform, '/opt/claude/bin:/usr/bin', command);
      expect(written).toContain(getQuotedCommand(platform, command));
      expect(written).toContain(clearCmd);
      expect(profileManager.getProfile).toHaveBeenCalledWith('prof-2');
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('prof-2');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
    });

    it('uses profile switching when a non-default profile is requested', async () => {
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => ({
          id: 'prof-3',
          name: 'Team',
          isDefault: false,
        })),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocation.mockReturnValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockGetClaudeProfileManager.mockReturnValue(profileManager);

      const terminal = createMockTerminal({ id: 'term-5' });

      const { invokeClaude } = await import('../claude-integration-handler');
      invokeClaude(terminal, '/tmp/project', 'prof-3', () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      expect(written).toContain(getQuotedCommand(platform, command));
      expectPathPrefix(written, platform, '/opt/claude/bin:/usr/bin', command);
      expect(profileManager.getProfile).toHaveBeenCalledWith('prof-3');
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('prof-3');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
    });

    it('uses --continue regardless of sessionId (sessionId is deprecated)', async () => {
      mockGetClaudeCliInvocation.mockReturnValue({
        command: '/opt/claude/bin/claude',
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });

      const terminal = createMockTerminal({
        id: 'term-2',
        cwd: undefined,
        projectPath: '/tmp/project',
      });

      const { resumeClaude } = await import('../claude-integration-handler');

      // Even when sessionId is passed, it should be ignored and --continue used
      resumeClaude(terminal, 'abc123', () => null);

      const resumeCall = mockWriteToPty.mock.calls[0][1] as string;
      expectPathPrefix(resumeCall, platform, '/opt/claude/bin:/usr/bin', '/opt/claude/bin/claude');
      expect(resumeCall).toContain(getQuotedCommand(platform, '/opt/claude/bin/claude') + ' --continue');
      expect(resumeCall).not.toContain('--resume');
      // sessionId is cleared because --continue doesn't track specific sessions
      expect(terminal.claudeSessionId).toBeUndefined();
      expect(terminal.isClaudeMode).toBe(true);
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);

      mockWriteToPty.mockClear();
      mockPersistSession.mockClear();
      terminal.projectPath = undefined;
      terminal.isClaudeMode = false;
      resumeClaude(terminal, undefined, () => null);
      const continueCall = mockWriteToPty.mock.calls[0][1] as string;
      expect(continueCall).toContain(getQuotedCommand(platform, '/opt/claude/bin/claude') + ' --continue');
      expect(terminal.isClaudeMode).toBe(true);
      expect(terminal.claudeSessionId).toBeUndefined();
      expect(mockPersistSession).not.toHaveBeenCalled();
    });
  });

  it('throws when invokeClaude cannot resolve the CLI invocation', async () => {
    mockGetClaudeCliInvocation.mockImplementation(() => {
      throw new Error('boom');
    });
    const profileManager = {
      getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
      getProfile: vi.fn(),
      getProfileToken: vi.fn(() => null),
      markProfileUsed: vi.fn(),
    };
    mockGetClaudeProfileManager.mockReturnValue(profileManager);

    const terminal = createMockTerminal({ id: 'term-err' });

    const { invokeClaude } = await import('../claude-integration-handler');
    expect(() => invokeClaude(terminal, '/tmp/project', undefined, () => null, vi.fn())).toThrow('boom');
    expect(mockReleaseSessionId).toHaveBeenCalledWith('term-err');
    expect(mockWriteToPty).not.toHaveBeenCalled();
  });

  it('throws when resumeClaude cannot resolve the CLI invocation', async () => {
    mockGetClaudeCliInvocation.mockImplementation(() => {
      throw new Error('boom');
    });

    const terminal = createMockTerminal({
      id: 'term-err-2',
      cwd: undefined,
      projectPath: '/tmp/project',
    });

    const { resumeClaude } = await import('../claude-integration-handler');
    expect(() => resumeClaude(terminal, 'abc123', () => null)).toThrow('boom');
    expect(mockWriteToPty).not.toHaveBeenCalled();
  });

  it('throws when writing the OAuth token temp file fails', async () => {
    mockGetClaudeCliInvocation.mockReturnValue({
      command: '/opt/claude/bin/claude',
      env: { PATH: '/opt/claude/bin:/usr/bin' },
    });
    const profileManager = {
      getActiveProfile: vi.fn(),
      getProfile: vi.fn(() => ({
        id: 'prof-err',
        name: 'Work',
        isDefault: false,
        oauthToken: 'token-value',
      })),
      getProfileToken: vi.fn(() => 'token-value'),
      markProfileUsed: vi.fn(),
    };
    mockGetClaudeProfileManager.mockReturnValue(profileManager);
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const terminal = createMockTerminal({ id: 'term-err-3' });

    const { invokeClaude } = await import('../claude-integration-handler');
    expect(() => invokeClaude(terminal, '/tmp/project', 'prof-err', () => null, vi.fn())).toThrow('disk full');
    expect(mockWriteToPty).not.toHaveBeenCalled();
  });

  it('includes YOLO mode flag when dangerouslySkipPermissions is true', async () => {
    mockGetClaudeCliInvocation.mockReturnValue({
      command: '/opt/claude/bin/claude',
      env: { PATH: '/opt/claude/bin:/usr/bin' },
    });
    const profileManager = {
      getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
      getProfile: vi.fn(),
      getProfileToken: vi.fn(() => null),
      markProfileUsed: vi.fn(),
    };
    mockGetClaudeProfileManager.mockReturnValue(profileManager);

    const terminal = createMockTerminal();

    const { invokeClaude } = await import('../claude-integration-handler');
    invokeClaude(terminal, '/tmp/project', undefined, () => null, vi.fn(), true);

    const written = mockWriteToPty.mock.calls[0][1] as string;
    expect(written).toContain('--dangerously-skip-permissions');
    expect(terminal.dangerouslySkipPermissions).toBe(true);
  });

  it('does not include YOLO mode flag when dangerouslySkipPermissions is false', async () => {
    mockGetClaudeCliInvocation.mockReturnValue({
      command: '/opt/claude/bin/claude',
      env: { PATH: '/opt/claude/bin:/usr/bin' },
    });
    const profileManager = {
      getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
      getProfile: vi.fn(),
      getProfileToken: vi.fn(() => null),
      markProfileUsed: vi.fn(),
    };
    mockGetClaudeProfileManager.mockReturnValue(profileManager);

    const terminal = createMockTerminal();

    const { invokeClaude } = await import('../claude-integration-handler');
    invokeClaude(terminal, '/tmp/project', undefined, () => null, vi.fn(), false);

    const written = mockWriteToPty.mock.calls[0][1] as string;
    expect(written).not.toContain('--dangerously-skip-permissions');
    expect(terminal.dangerouslySkipPermissions).toBe(false);
  });

  it('resets terminal state on error', async () => {
    mockGetClaudeCliInvocation.mockImplementation(() => {
      throw new Error('CLI error');
    });
    const profileManager = {
      getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
      getProfile: vi.fn(),
      getProfileToken: vi.fn(() => null),
      markProfileUsed: vi.fn(),
    };
    mockGetClaudeProfileManager.mockReturnValue(profileManager);

    const terminal = createMockTerminal({
      isClaudeMode: false,
      claudeProfileId: 'old-profile',
    });

    const { invokeClaude } = await import('../claude-integration-handler');
    expect(() => invokeClaude(terminal, '/tmp/project', 'new-profile', () => null, vi.fn())).toThrow('CLI error');

    // Terminal state should be rolled back
    expect(terminal.isClaudeMode).toBe(false);
    expect(terminal.claudeProfileId).toBe('old-profile');
    expect(terminal.claudeSessionId).toBeUndefined();
  });
});

/**
 * Tests for invokeClaudeAsync() - async version with timeout protection
 */
describe('invokeClaudeAsync', () => {
  beforeEach(() => {
    mockGetClaudeCliInvocationAsync.mockClear();
    mockInitializeClaudeProfileManager.mockClear();
    mockPersistSession.mockClear();
    mockReleaseSessionId.mockClear();
    mockWriteToPty.mockClear();
    vi.mocked(writeFileSync).mockClear();
  });

  describe.each(['win32', 'darwin', 'linux'] as const)('on %s', (platform) => {
    beforeEach(() => {
      mockPlatform(platform);
    });

    it('should invoke Claude asynchronously with default profile', async () => {
      mockGetClaudeCliInvocationAsync.mockResolvedValue({
        command: '/opt/claude/bin/claude',
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal();

      const { invokeClaudeAsync } = await import('../claude-integration-handler');
      await invokeClaudeAsync(terminal, '/tmp/project', undefined, () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      expect(written).toContain(buildCdCommand('/tmp/project'));
      expectPathPrefix(written, platform, '/opt/claude/bin:/usr/bin', '/opt/claude/bin/claude');
      expect(mockReleaseSessionId).toHaveBeenCalledWith('term-1');
      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('default');
    });

    it('should handle profile with configDir', async () => {
      const command = '/opt/claude/bin/claude';
      const profileManager = {
        getActiveProfile: vi.fn(),
        getProfile: vi.fn(() => ({
          id: 'prof-config',
          name: 'Work',
          isDefault: false,
          configDir: '/tmp/claude-config',
        })),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };

      mockGetClaudeCliInvocationAsync.mockResolvedValue({
        command,
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal();

      const { invokeClaudeAsync } = await import('../claude-integration-handler');
      await invokeClaudeAsync(terminal, '/tmp/project', 'prof-config', () => null, vi.fn());

      const written = mockWriteToPty.mock.calls[0][1] as string;
      const clearCmd = getClearCommand(platform);
      const histPrefix = getHistoryPrefix(platform);
      const configDir = getConfigDirCommand(platform, '/tmp/claude-config');

      expect(written).toContain(histPrefix);
      expect(written).toContain(configDir);
      expect(written).toContain(clearCmd);
      expect(profileManager.markProfileUsed).toHaveBeenCalledWith('prof-config');
    });

    it('should timeout after 10 seconds if CLI invocation hangs', async () => {
      mockGetClaudeCliInvocationAsync.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          command: '/opt/claude/bin/claude',
          env: { PATH: '/opt/claude/bin:/usr/bin' },
        }), 15000))
      );
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal();

      const { invokeClaudeAsync } = await import('../claude-integration-handler');

      await expect(invokeClaudeAsync(terminal, '/tmp/project', undefined, () => null, vi.fn()))
        .rejects.toThrow('CLI invocation timeout after 10s');

      // Terminal state should be rolled back
      expect(terminal.isClaudeMode).toBe(false);
    }, 12000); // Allow 12 seconds for test (10s timeout + 2s buffer)

    it('should reset terminal state on async error', async () => {
      mockGetClaudeCliInvocationAsync.mockRejectedValue(new Error('Async CLI error'));
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal({
        isClaudeMode: false,
        claudeProfileId: 'old-profile',
      });

      const { invokeClaudeAsync } = await import('../claude-integration-handler');
      await expect(invokeClaudeAsync(terminal, '/tmp/project', 'new-profile', () => null, vi.fn()))
        .rejects.toThrow('Async CLI error');

      // Terminal state should be rolled back
      expect(terminal.isClaudeMode).toBe(false);
      expect(terminal.claudeProfileId).toBe('old-profile');
      expect(terminal.claudeSessionId).toBeUndefined();
    });

    it('should include YOLO mode flag when dangerouslySkipPermissions is true', async () => {
      mockGetClaudeCliInvocationAsync.mockResolvedValue({
        command: '/opt/claude/bin/claude',
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal();

      const { invokeClaudeAsync } = await import('../claude-integration-handler');
      await invokeClaudeAsync(terminal, '/tmp/project', undefined, () => null, vi.fn(), true);

      const written = mockWriteToPty.mock.calls[0][1] as string;
      expect(written).toContain('--dangerously-skip-permissions');
      expect(terminal.dangerouslySkipPermissions).toBe(true);
    });

    it('should call onSessionCapture callback with correct parameters', async () => {
      mockGetClaudeCliInvocationAsync.mockResolvedValue({
        command: '/opt/claude/bin/claude',
        env: { PATH: '/opt/claude/bin:/usr/bin' },
      });
      const profileManager = {
        getActiveProfile: vi.fn(() => ({ id: 'default', name: 'Default', isDefault: true })),
        getProfile: vi.fn(),
        getProfileToken: vi.fn(() => null),
        markProfileUsed: vi.fn(),
      };
      mockInitializeClaudeProfileManager.mockResolvedValue(profileManager);

      const terminal = createMockTerminal();
      const mockOnSessionCapture = vi.fn();
      const startTime = Date.now();

      const { invokeClaudeAsync } = await import('../claude-integration-handler');
      await invokeClaudeAsync(terminal, '/tmp/project', undefined, () => null, mockOnSessionCapture);

      expect(mockOnSessionCapture).toHaveBeenCalledWith(
        terminal.id,
        '/tmp/project',
        expect.any(Number)
      );

      const capturedTime = mockOnSessionCapture.mock.calls[0][2];
      expect(capturedTime).toBeGreaterThanOrEqual(startTime);
    });
  });
});

/**
 * Unit tests for helper functions
 */
describe('claude-integration-handler - Helper Functions', () => {
  describe('buildClaudeShellCommand', () => {
    describe.each(['win32', 'darwin', 'linux'] as const)('on %s', (platform) => {
      beforeEach(() => {
        mockPlatform(platform);
      });

      it('should build default command without cwd or PATH prefix', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand('', '', "'/opt/bin/claude'", { method: 'default' });

        expect(result).toBe("'/opt/bin/claude'\r");
      });

      it('should build command with cwd', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand("cd '/tmp/project' && ", '', "'/opt/bin/claude'", { method: 'default' });

        expect(result).toBe("cd '/tmp/project' && '/opt/bin/claude'\r");
      });

      it('should build command with PATH prefix', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand('', "PATH='/custom/path' ", "'/opt/bin/claude'", { method: 'default' });

        expect(result).toBe("PATH='/custom/path' '/opt/bin/claude'\r");
      });

      it('should build temp-file method command with history-safe prefixes', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand(
          "cd '/tmp/project' && ",
          "PATH='/opt/bin' ",
          "'/opt/bin/claude'",
          { method: 'temp-file', tempFile: '/tmp/.token-123' }
        );

        const clearCmd = getClearCommand(platform);
        const histPrefix = getHistoryPrefix(platform);
        const tempCmd = getTempFileInvocation(platform, '/tmp/.token-123');
        const cleanupCmd = getTempFileCleanup(platform, '/tmp/.token-123');
        const execCmd = getExecCommand(platform, "'/opt/bin/claude'");

        expect(result).toContain(`${clearCmd} && `);
        expect(result).toContain("cd '/tmp/project' && ");
        if (platform !== 'win32') {
          expect(result).toContain(histPrefix);
        }
        expect(result).toContain("PATH='/opt/bin' ");
        expect(result).toContain(tempCmd);
        expect(result).toContain(cleanupCmd);
        expect(result).toContain(execCmd);
      });

      it('should build config-dir method command with CLAUDE_CONFIG_DIR', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand(
          "cd '/tmp/project' && ",
          "PATH='/opt/bin' ",
          "'/opt/bin/claude'",
          { method: 'config-dir', configDir: '/home/user/.claude-work' }
        );

        const clearCmd = getClearCommand(platform);
        const histPrefix = getHistoryPrefix(platform);
        const configDirVar = getConfigDirCommand(platform, '/home/user/.claude-work');
        const execCmd = getExecCommand(platform, "'/opt/bin/claude'");

        expect(result).toContain(`${clearCmd} && `);
        expect(result).toContain("cd '/tmp/project' && ");
        if (platform !== 'win32') {
          expect(result).toContain(histPrefix);
        }
        expect(result).toContain(configDirVar);
        expect(result).toContain("PATH='/opt/bin' ");
        expect(result).toContain(execCmd);
      });

      it('should handle empty cwdCommand for temp-file method', async () => {
        const { buildClaudeShellCommand } = await import('../claude-integration-handler');
        const result = buildClaudeShellCommand(
          '',
          '',
          "'/opt/bin/claude'",
          { method: 'temp-file', tempFile: '/tmp/.token' }
        );

        const clearCmd = getClearCommand(platform);
        const histPrefix = getHistoryPrefix(platform);
        const tempCmd = getTempFileInvocation(platform, '/tmp/.token');

        expect(result).toContain(`${clearCmd} && `);
        if (platform !== 'win32') {
          expect(result).toContain(histPrefix);
        }
        expect(result).not.toContain('cd ');
        expect(result).toContain(tempCmd);
      });
    });
  });

  describe('finalizeClaudeInvoke', () => {
    it('should set terminal title to "Claude" for default profile when terminal has default name', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      // Use a default terminal name pattern so renaming logic kicks in
      const terminal = createMockTerminal({ title: 'Terminal 1' });
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: vi.fn(), isDestroyed: () => false }
      };

      finalizeClaudeInvoke(
        terminal,
        { name: 'Default', isDefault: true },
        '/tmp/project',
        Date.now(),
        () => mockWindow as any,
        vi.fn()
      );

      expect(terminal.title).toBe('Claude');
    });

    it('should set terminal title to "Claude (ProfileName)" for non-default profile', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      // Use a default terminal name pattern so renaming logic kicks in
      const terminal = createMockTerminal({ title: 'Terminal 2' });
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: vi.fn(), isDestroyed: () => false }
      };

      finalizeClaudeInvoke(
        terminal,
        { name: 'Work Profile', isDefault: false },
        '/tmp/project',
        Date.now(),
        () => mockWindow as any,
        vi.fn()
      );

      expect(terminal.title).toBe('Claude (Work Profile)');
    });

    it('should send IPC message to renderer when terminal has default name', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      // Use a default terminal name pattern so renaming logic kicks in
      const terminal = createMockTerminal({ title: 'Terminal 3' });
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend, isDestroyed: () => false }
      };

      finalizeClaudeInvoke(
        terminal,
        undefined,
        '/tmp/project',
        Date.now(),
        () => mockWindow as any,
        vi.fn()
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('title'),
        terminal.id,
        'Claude'
      );
    });

    it('should NOT rename terminal when already named Claude', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      // Terminal already has Claude title - should NOT be renamed
      const terminal = createMockTerminal({ title: 'Claude' });
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend, isDestroyed: () => false }
      };

      finalizeClaudeInvoke(
        terminal,
        { name: 'Work Profile', isDefault: false },
        '/tmp/project',
        Date.now(),
        () => mockWindow as any,
        vi.fn()
      );

      // Title should remain unchanged
      expect(terminal.title).toBe('Claude');
      // No IPC message should be sent for title change
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should NOT rename terminal with user-customized name', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      // User has customized the terminal name - should NOT be renamed
      const terminal = createMockTerminal({ title: 'My Custom Terminal' });
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend, isDestroyed: () => false }
      };

      finalizeClaudeInvoke(
        terminal,
        undefined,
        '/tmp/project',
        Date.now(),
        () => mockWindow as any,
        vi.fn()
      );

      // Title should remain unchanged
      expect(terminal.title).toBe('My Custom Terminal');
      // No IPC message should be sent for title change
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should persist session when terminal has projectPath', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      const terminal = createMockTerminal({ projectPath: '/tmp/project' });

      finalizeClaudeInvoke(
        terminal,
        undefined,
        '/tmp/project',
        Date.now(),
        () => null,
        vi.fn()
      );

      expect(mockPersistSession).toHaveBeenCalledWith(terminal);
    });

    it('should call onSessionCapture when projectPath is provided', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      const terminal = createMockTerminal();
      const mockOnSessionCapture = vi.fn();
      const startTime = Date.now();

      finalizeClaudeInvoke(
        terminal,
        undefined,
        '/tmp/project',
        startTime,
        () => null,
        mockOnSessionCapture
      );

      expect(mockOnSessionCapture).toHaveBeenCalledWith(terminal.id, '/tmp/project', startTime);
    });

    it('should not crash when getWindow returns null', async () => {
      const { finalizeClaudeInvoke } = await import('../claude-integration-handler');
      const terminal = createMockTerminal();

      expect(() => {
        finalizeClaudeInvoke(
          terminal,
          undefined,
          '/tmp/project',
          Date.now(),
          () => null,
          vi.fn()
        );
      }).not.toThrow();
    });
  });

  describe('shouldAutoRenameTerminal', () => {
    it('should return true for default terminal names', async () => {
      const { shouldAutoRenameTerminal } = await import('../claude-integration-handler');

      expect(shouldAutoRenameTerminal('Terminal 1')).toBe(true);
      expect(shouldAutoRenameTerminal('Terminal 2')).toBe(true);
      expect(shouldAutoRenameTerminal('Terminal 99')).toBe(true);
      expect(shouldAutoRenameTerminal('Terminal 123')).toBe(true);
    });

    it('should return false for terminals already named Claude', async () => {
      const { shouldAutoRenameTerminal } = await import('../claude-integration-handler');

      expect(shouldAutoRenameTerminal('Claude')).toBe(false);
      expect(shouldAutoRenameTerminal('Claude (Work)')).toBe(false);
      expect(shouldAutoRenameTerminal('Claude (Profile Name)')).toBe(false);
    });

    it('should return false for user-customized terminal names', async () => {
      const { shouldAutoRenameTerminal } = await import('../claude-integration-handler');

      expect(shouldAutoRenameTerminal('My Custom Terminal')).toBe(false);
      expect(shouldAutoRenameTerminal('Dev Server')).toBe(false);
      expect(shouldAutoRenameTerminal('Backend')).toBe(false);
    });

    it('should return false for edge cases that do not match the pattern', async () => {
      const { shouldAutoRenameTerminal } = await import('../claude-integration-handler');

      // Terminal 0 is not a valid default (terminals start at 1)
      expect(shouldAutoRenameTerminal('Terminal 0')).toBe(true);  // Pattern matches \d+, so this is valid

      // Lowercase doesn't match
      expect(shouldAutoRenameTerminal('terminal 1')).toBe(false);

      // Extra whitespace doesn't match
      expect(shouldAutoRenameTerminal('Terminal  1')).toBe(false);
      expect(shouldAutoRenameTerminal(' Terminal 1')).toBe(false);
      expect(shouldAutoRenameTerminal('Terminal 1 ')).toBe(false);

      // Tab instead of space doesn't match
      expect(shouldAutoRenameTerminal('Terminal\t1')).toBe(false);
    });
  });
});
