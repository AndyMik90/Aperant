import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Project } from '../../../../shared/types';
import { IPC_CHANNELS } from '../../../../shared/constants';
import type { BrowserWindow } from 'electron';
import type { AgentManager } from '../../../agent/agent-manager';
import type { createIPCCommunicators as createIPCCommunicatorsType } from '../utils/ipc-communicator';

const mockIpcMain = vi.hoisted(() => {
  class HoistedMockIpcMain {
    handlers = new Map<string, Function>();
    listeners = new Map<string, Function>();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    on(channel: string, listener: Function): void {
      this.listeners.set(channel, listener);
    }

    async invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler for channel: ${channel}`);
      }
      return handler({}, ...args);
    }

    async emit(channel: string, ...args: unknown[]): Promise<void> {
      const listener = this.listeners.get(channel);
      if (!listener) {
        throw new Error(`No listener for channel: ${channel}`);
      }
      await listener({}, ...args);
    }

    reset(): void {
      this.handlers.clear();
      this.listeners.clear();
    }
  }

  return new HoistedMockIpcMain();
});

const mockRunPythonSubprocess = vi.fn();
const mockValidateGitHubModule = vi.fn();
const mockGetRunnerEnv = vi.fn();
type CreateIPCCommunicators = typeof createIPCCommunicatorsType;

const mockCreateIPCCommunicators = vi.fn(
  (..._args: Parameters<CreateIPCCommunicators>) => ({
    sendProgress: vi.fn(),
    sendComplete: vi.fn(),
    sendError: vi.fn(),
  })
) as unknown as CreateIPCCommunicators;

const projectRef: { current: Project | null } = { current: null };
const tempDirs: string[] = [];

class MockBrowserWindow {}
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
  app: {
    getPath: vi.fn(() => '/tmp'),
    on: vi.fn(),
  },
}));

class MockAgentManager {
  startSpecCreation = vi.fn();
}
vi.mock('../../../agent/agent-manager', () => ({
  AgentManager: MockAgentManager,
}));

vi.mock('../utils/ipc-communicator', () => ({
  createIPCCommunicators: (...args: Parameters<CreateIPCCommunicators>) =>
    mockCreateIPCCommunicators(...args),
}));

vi.mock('../utils/project-middleware', () => ({
  withProjectOrNull: async (_projectId: string, handler: (project: Project) => Promise<unknown>) => {
    if (!projectRef.current) {
      return null;
    }
    return handler(projectRef.current);
  },
}));

vi.mock('../utils/subprocess-runner', () => ({
  runPythonSubprocess: (...args: unknown[]) => mockRunPythonSubprocess(...args),
  validateGitHubModule: (...args: unknown[]) => mockValidateGitHubModule(...args),
  getPythonPath: () => '/tmp/python',
  getRunnerPath: () => '/tmp/runner.py',
  buildRunnerArgs: (_runnerPath: string, _projectPath: string, command: string, args: string[] = []) => [
    'runner.py',
    command,
    ...args,
  ],
}));

vi.mock('../utils/runner-env', () => ({
  getRunnerEnv: (...args: unknown[]) => mockGetRunnerEnv(...args),
}));

vi.mock('../utils', () => ({
  getGitHubConfig: vi.fn(() => null),
  githubFetch: vi.fn(),
}));

vi.mock('../../../settings-utils', () => ({
  readSettingsFile: vi.fn(() => ({})),
}));

function createMockWindow(): BrowserWindow {
  return { webContents: { send: vi.fn() }, isDestroyed: () => false } as unknown as BrowserWindow;
}

function createProject(): Project {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'github-env-test-'));
  tempDirs.push(projectPath);
  return {
    id: 'project-1',
    name: 'Test Project',
    path: projectPath,
    autoBuildPath: '.auto-claude',
    settings: {
      model: 'default',
      memoryBackend: 'file',
      linearSync: false,
      notifications: {
        onTaskComplete: false,
        onTaskFailed: false,
        onReviewNeeded: false,
        sound: false,
      },
      graphitiMcpEnabled: false,
      useClaudeMd: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('GitHub runner env usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain.reset();
    projectRef.current = createProject();
    mockValidateGitHubModule.mockResolvedValue({ valid: true, backendPath: '/tmp/backend' });
    mockGetRunnerEnv.mockResolvedValue({ ANTHROPIC_AUTH_TOKEN: 'token' });
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors for already-removed temp dirs.
      }
    }
    tempDirs.length = 0;
  });

  it('passes runner env to PR review subprocess', async () => {
    const { registerPRHandlers } = await import('../pr-handlers');

    mockRunPythonSubprocess.mockReturnValue({
      process: { pid: 123 },
      promise: Promise.resolve({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        data: {
          prNumber: 123,
          repo: 'test/repo',
          success: true,
          findings: [],
          summary: '',
          overallStatus: 'comment',
          reviewedAt: new Date().toISOString(),
        },
      }),
    });

    registerPRHandlers(() => createMockWindow());
    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_PR_REVIEW, projectRef.current?.id, 123);

    expect(mockGetRunnerEnv).toHaveBeenCalledWith({ USE_CLAUDE_MD: 'true' });
    expect(mockRunPythonSubprocess).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { ANTHROPIC_AUTH_TOKEN: 'token' },
      })
    );
  });

  it('passes runner env to triage subprocess', async () => {
    const { registerTriageHandlers } = await import('../triage-handlers');

    mockRunPythonSubprocess.mockReturnValue({
      process: { pid: 124 },
      promise: Promise.resolve({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        data: [],
      }),
    });

    registerTriageHandlers(() => createMockWindow());
    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_TRIAGE_RUN, projectRef.current?.id);

    expect(mockGetRunnerEnv).toHaveBeenCalledWith();
    expect(mockRunPythonSubprocess).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { ANTHROPIC_AUTH_TOKEN: 'token' },
      })
    );
  });

  it('passes runner env to autofix analyze preview subprocess', async () => {
    const { registerAutoFixHandlers } = await import('../autofix-handlers');
    const { AgentManager: MockedAgentManager } = await import('../../../agent/agent-manager');

    mockRunPythonSubprocess.mockReturnValue({
      process: { pid: 125 },
      promise: Promise.resolve({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        data: {
          totalIssues: 0,
          primaryIssue: null,
          proposedBatches: [],
          singleIssues: [],
        },
      }),
    });

    const agentManager: AgentManager = new MockedAgentManager();
    const getMainWindow: () => BrowserWindow | null = () => createMockWindow();

    registerAutoFixHandlers(agentManager, getMainWindow);
    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW, projectRef.current?.id);

    expect(mockGetRunnerEnv).toHaveBeenCalledWith();
    expect(mockRunPythonSubprocess).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { ANTHROPIC_AUTH_TOKEN: 'token' },
      })
    );
  });
});
