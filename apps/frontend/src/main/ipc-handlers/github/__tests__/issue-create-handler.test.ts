import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process - must be at top level due to hoisting
const mockSpawnCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
let mockSpawnOutput = 'https://github.com/owner/repo/issues/42\n';
let mockSpawnShouldFail = false;

vi.mock('child_process', async () => {
  return {
    spawn: vi.fn((command: string, args: string[], options: unknown) => {
      mockSpawnCalls.push({ command, args, options });

      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, callback: (data: unknown) => void) => {
            if (event === 'data') {
              process.nextTick(() => callback(mockSpawnOutput));
            }
          }),
        },
        stderr: {
          on: vi.fn().mockReturnThis(),
        },
        on: vi.fn((event: string, callback: (code: unknown) => void) => {
          if (event === 'close') {
            process.nextTick(() => {
              if (mockSpawnShouldFail) {
                callback(1);
              } else {
                callback(0);
              }
            });
          } else if (event === 'error') {
            if (mockSpawnShouldFail) {
              process.nextTick(() => callback(new Error('gh: authentication required')));
            }
          }
        }),
        unref: vi.fn(),
      };

      return mockProcess;
    }),
  };
});

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock project-middleware
const mockProject = { id: 'test-project', path: '/fake/project', name: 'Test' };
vi.mock('../utils/project-middleware', () => ({
  withProject: vi.fn((_id: string, handler: (p: typeof mockProject) => Promise<unknown>) =>
    handler(mockProject),
  ),
}));

// Mock env-utils
vi.mock('../../../env-utils', () => ({
  getAugmentedEnv: vi.fn(() => ({ PATH: '/usr/bin', GH_TOKEN: 'test-token' })),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createContextLogger: () => ({ debug: vi.fn() }),
}));

// Mock constants
vi.mock('../../../../shared/constants', () => ({
  IPC_CHANNELS: {
    GITHUB_ISSUE_CREATE: 'github:issue:create',
  },
}));

// Mock cli-tool-manager
vi.mock('../../../cli-tool-manager', () => ({
  getToolPath: (tool: string) => tool,
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    mkdtempSync: vi.fn((prefix: string) => `${prefix}abc123`),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
  mkdtempSync: vi.fn((prefix: string) => `${prefix}abc123`),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
}));

// Mock os
vi.mock('os', () => ({
  default: { tmpdir: () => '/tmp' },
  tmpdir: () => '/tmp',
}));

// Mock path
vi.mock('path', () => ({
  default: { join: (...args: string[]) => args.join('/') },
  join: (...args: string[]) => args.join('/'),
}));

import { ipcMain } from 'electron';
import { registerIssueCreateHandler } from '../issue-create-handler';
import fs from 'fs';

// Collect registered handlers
type HandleHandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers: Record<string, HandleHandlerFn> = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawnCalls.length = 0;
  mockSpawnOutput = 'https://github.com/owner/repo/issues/42\n';
  mockSpawnShouldFail = false;

  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
    (channel: string, handler: HandleHandlerFn) => {
      handlers[channel] = handler;
    },
  );

  registerIssueCreateHandler(() => null);
});

const call = (projectId: string, params: { title: string; body: string; labels?: string[]; assignees?: string[] }) =>
  handlers['github:issue:create']({}, projectId, params);

describe('createIssue handler', () => {
  it('creates issue with title and body via temp file', async () => {
    const result = await call('test-project', {
      title: 'New Bug',
      body: 'Bug description',
    }) as { number: number; url: string };

    expect(result.number).toBe(42);
    expect(result.url).toContain('/issues/42');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('creates issue with labels', async () => {
    await call('test-project', {
      title: 'Feature',
      body: 'Feature description',
      labels: ['enhancement', 'priority:high'],
    });

    const spawnCall = mockSpawnCalls.find(c => c.args.includes('--label'));
    expect(spawnCall).toBeDefined();
    expect(spawnCall?.args).toContain('--label');
    expect(spawnCall?.args).toContain('enhancement,priority:high');
  });

  it('creates issue with assignees', async () => {
    await call('test-project', {
      title: 'Task',
      body: 'Task body',
      assignees: ['user1', 'user2'],
    });

    const spawnCall = mockSpawnCalls.find(c => c.args.includes('--assignee'));
    expect(spawnCall).toBeDefined();
    expect(spawnCall?.args).toContain('--assignee');
    expect(spawnCall?.args).toContain('user1,user2');
  });

  it('returns issue number and URL from gh CLI output', async () => {
    mockSpawnOutput = 'https://github.com/myorg/myrepo/issues/99\n';

    const result = await call('test-project', {
      title: 'Test',
      body: 'Body',
    }) as { number: number; url: string };

    expect(result.number).toBe(99);
    expect(result.url).toBe('https://github.com/myorg/myrepo/issues/99');
  });

  it('validates title — rejects empty', async () => {
    await expect(call('test-project', {
      title: '',
      body: 'Body',
    })).rejects.toThrow('Title is required');
  });

  it('validates title — rejects too long', async () => {
    await expect(call('test-project', {
      title: 'A'.repeat(257),
      body: 'Body',
    })).rejects.toThrow('Title too long');
  });

  it('handles gh CLI error', async () => {
    mockSpawnShouldFail = true;

    await expect(call('test-project', {
      title: 'Test',
      body: 'Body',
    })).rejects.toThrow();
  });

  it('cleans up temp file on success', async () => {
    await call('test-project', { title: 'Test', body: 'Body' });

    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('cleans up temp file on failure', async () => {
    mockSpawnShouldFail = true;

    try {
      await call('test-project', { title: 'Test', body: 'Body' });
    } catch {
      // Expected
    }

    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});
