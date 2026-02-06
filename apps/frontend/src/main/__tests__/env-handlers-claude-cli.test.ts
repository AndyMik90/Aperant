import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/constants';
const {
  mockGetClaudeCliInvocation,
  mockGetClaudeCliInvocationAsync,
  mockGetProject,
  spawnMock,
  mockIpcMain,
} = vi.hoisted(() => {
  const ipcMain = new (class {
    handlers = new Map<string, Function>();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }
  })();

  return {
    mockGetClaudeCliInvocation: vi.fn(),
    mockGetClaudeCliInvocationAsync: vi.fn(),
    mockGetProject: vi.fn(),
    spawnMock: vi.fn(),
    mockIpcMain: ipcMain,
  };
});

vi.mock('../claude-cli-utils', () => ({
  getClaudeCliInvocation: mockGetClaudeCliInvocation,
  getClaudeCliInvocationAsync: mockGetClaudeCliInvocationAsync,
}));

vi.mock('../project-store', () => ({
  projectStore: {
    getProject: mockGetProject,
  },
}));

vi.mock('child_process', () => {
  const mockExecFile = vi.fn(
    (
      _cmd: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback?: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      // Return a minimal ChildProcess-like object
      const childProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn()
      };

      // If callback is provided, call it asynchronously
      if (typeof callback === 'function') {
        setImmediate(() => callback(null, '', ''));
      }

      return childProcess as unknown;
    }
  );

  return {
    spawn: spawnMock,
    execFileSync: vi.fn(),
    execFile: mockExecFile
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join('/tmp', 'userData');
      return '/tmp';
    }),
  },
  ipcMain: mockIpcMain,
}));

import { registerEnvHandlers } from '../ipc-handlers/env-handlers';

function createProc(): EventEmitter & { stdout?: EventEmitter; stderr?: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & {
    stdout?: EventEmitter;
    stderr?: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

// Helper to flush all pending promises (needed for async mock resolution)
function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('env-handlers Claude CLI usage', () => {
  beforeEach(() => {
    mockGetClaudeCliInvocation.mockReset();
    mockGetClaudeCliInvocationAsync.mockReset();
    mockGetProject.mockReset();
    spawnMock.mockReset();
  });

  it('uses resolved Claude CLI path/env for auth checks', async () => {
    const claudeEnv = { PATH: '/opt/claude/bin:/usr/bin' };
    const command = '/opt/claude/bin/claude';
    mockGetClaudeCliInvocationAsync.mockResolvedValue({
      command,
      env: claudeEnv,
    });
    mockGetProject.mockReturnValue({ id: 'p1', path: '/tmp/project' });

    const procs: ReturnType<typeof createProc>[] = [];
    spawnMock.mockImplementation(() => {
      const proc = createProc();
      procs.push(proc);
      return proc;
    });

    registerEnvHandlers(() => null);
    const handler = mockIpcMain.getHandler(IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH);
    if (!handler) {
      throw new Error('ENV_CHECK_CLAUDE_AUTH handler not registered');
    }

    const resultPromise = handler({}, 'p1');
    // Wait for async CLI resolution before checking spawn
    await flushPromises();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      command,
      ['--version'],
      expect.objectContaining({ cwd: '/tmp/project', env: claudeEnv, shell: false })
    );

    procs[0].emit('close', 0);
    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenCalledWith(
      command,
      ['api', '--help'],
      expect.objectContaining({ cwd: '/tmp/project', env: claudeEnv, shell: false })
    );

    procs[1].emit('close', 0);

    const result = await resultPromise;
    expect(result).toEqual({ success: true, data: { success: true, authenticated: true } });
  });

  it('uses resolved Claude CLI path/env for setup-token', async () => {
    const claudeEnv = { PATH: '/opt/claude/bin:/usr/bin' };
    const command = '/opt/claude/bin/claude';
    mockGetClaudeCliInvocationAsync.mockResolvedValue({
      command,
      env: claudeEnv,
    });
    mockGetProject.mockReturnValue({ id: 'p2', path: '/tmp/project' });

    const proc = createProc();
    spawnMock.mockReturnValue(proc);

    registerEnvHandlers(() => null);
    const handler = mockIpcMain.getHandler(IPC_CHANNELS.ENV_INVOKE_CLAUDE_SETUP);
    if (!handler) {
      throw new Error('ENV_INVOKE_CLAUDE_SETUP handler not registered');
    }

    const resultPromise = handler({}, 'p2');
    // Wait for async CLI resolution before checking spawn
    await flushPromises();
    expect(spawnMock).toHaveBeenCalledWith(
      command,
      ['setup-token'],
      expect.objectContaining({
        cwd: '/tmp/project',
        env: claudeEnv,
        shell: false,
        stdio: 'inherit'
      })
    );

    proc.emit('close', 0);
    const result = await resultPromise;
    expect(result).toEqual({ success: true, data: { success: true, authenticated: true } });
  });

  it('returns an error when Claude CLI resolution throws', async () => {
    mockGetClaudeCliInvocationAsync.mockRejectedValue(new Error('Claude CLI exploded'));
    mockGetProject.mockReturnValue({ id: 'p3', path: '/tmp/project' });

    registerEnvHandlers(() => null);
    const handler = mockIpcMain.getHandler(IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH);
    if (!handler) {
      throw new Error('ENV_CHECK_CLAUDE_AUTH handler not registered');
    }

    const result = await handler({}, 'p3');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Claude CLI exploded');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns an error when Claude CLI command is missing', async () => {
    mockGetClaudeCliInvocationAsync.mockResolvedValue({ command: '', env: {} });
    mockGetProject.mockReturnValue({ id: 'p4', path: '/tmp/project' });

    registerEnvHandlers(() => null);
    const handler = mockIpcMain.getHandler(IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH);
    if (!handler) {
      throw new Error('ENV_CHECK_CLAUDE_AUTH handler not registered');
    }

    const result = await handler({}, 'p4');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Claude CLI path not resolved');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns an error when Claude CLI exits with a non-zero code', async () => {
    const claudeEnv = { PATH: '/opt/claude/bin:/usr/bin' };
    const command = '/opt/claude/bin/claude';
    mockGetClaudeCliInvocationAsync.mockResolvedValue({
      command,
      env: claudeEnv,
    });
    mockGetProject.mockReturnValue({ id: 'p5', path: '/tmp/project' });

    const proc = createProc();
    spawnMock.mockReturnValue(proc);

    registerEnvHandlers(() => null);
    const handler = mockIpcMain.getHandler(IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH);
    if (!handler) {
      throw new Error('ENV_CHECK_CLAUDE_AUTH handler not registered');
    }

    const resultPromise = handler({}, 'p5');
    // Wait for async CLI resolution before checking spawn
    await flushPromises();
    expect(spawnMock).toHaveBeenCalledWith(
      command,
      ['--version'],
      expect.objectContaining({ cwd: '/tmp/project', env: claudeEnv, shell: false })
    );
    proc.emit('close', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Claude CLI not found');
  });
});
