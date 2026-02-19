import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGithubFetch = vi.fn();
const mockGetGitHubConfig = vi.fn();
const mockNormalizeRepoReference = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

const mockProject = { id: 'test-project', path: '/fake/project', name: 'Test' };
vi.mock('../utils/project-middleware', () => ({
  withProject: vi.fn((_id: string, handler: (p: typeof mockProject) => Promise<unknown>) =>
    handler(mockProject),
  ),
}));

vi.mock('../utils/logger', () => ({
  createContextLogger: () => ({ debug: vi.fn() }),
}));

vi.mock('../utils', () => ({
  getGitHubConfig: (...args: unknown[]) => mockGetGitHubConfig(...args),
  githubFetch: (...args: unknown[]) => mockGithubFetch(...args),
  normalizeRepoReference: (...args: unknown[]) => mockNormalizeRepoReference(...args),
}));

import { ipcMain } from 'electron';
import { registerDependencyHandlers } from '../dependency-handlers';

type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers: Record<string, HandlerFn> = {};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetGitHubConfig.mockReturnValue({
    token: 'test-token',
    repo: 'owner/repo',
  });
  mockNormalizeRepoReference.mockReturnValue('owner/repo');

  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, handler: HandlerFn) => {
    handlers[channel] = handler;
  });

  registerDependencyHandlers(() => null);
});

describe('fetchDependencies handler', () => {
  it('returns tracks and trackedBy arrays', async () => {
    mockGithubFetch.mockResolvedValue({
      data: {
        repository: {
          issue: {
            trackedIssues: {
              nodes: [{ number: 10, title: 'Sub-task A', state: 'OPEN' }],
            },
            trackedInIssues: {
              nodes: [{ number: 5, title: 'Parent', state: 'CLOSED' }],
            },
          },
        },
      },
    });

    const result = await handlers['github:deps:fetch']({}, 'test-project', 42) as {
      tracks: unknown[];
      trackedBy: unknown[];
    };

    expect(result.tracks).toHaveLength(1);
    expect(result.trackedBy).toHaveLength(1);
    expect(mockGithubFetch).toHaveBeenCalledTimes(1);
  });

  it('handles GraphQL field error (unavailable API)', async () => {
    mockGithubFetch.mockResolvedValue({
      errors: [{ message: 'GraphQL: Field trackedIssues does not exist' }],
    });

    const result = await handlers['github:deps:fetch']({}, 'test-project', 42) as {
      error: string;
      unavailable: boolean;
    };

    expect(result.error).toContain('does not exist');
    expect(result.unavailable).toBe(true);
  });

  it('handles empty dependencies', async () => {
    mockGithubFetch.mockResolvedValue({
      data: {
        repository: {
          issue: {
            trackedIssues: { nodes: [] },
            trackedInIssues: { nodes: [] },
          },
        },
      },
    });

    const result = await handlers['github:deps:fetch']({}, 'test-project', 42) as {
      tracks: unknown[];
      trackedBy: unknown[];
    };

    expect(result.tracks).toHaveLength(0);
    expect(result.trackedBy).toHaveLength(0);
  });

  it('validates issue number', async () => {
    const result = await handlers['github:deps:fetch']({}, 'test-project', -1) as { error: string };
    expect(result.error).toBeTruthy();
    expect(mockGithubFetch).not.toHaveBeenCalled();
  });

  it('handles auth error', async () => {
    mockGithubFetch.mockRejectedValue(new Error('HTTP 401: Bad credentials'));

    const result = await handlers['github:deps:fetch']({}, 'test-project', 42) as { error: string };
    expect(result.error).toContain('401');
  });

  it('handles cross-repo dependencies', async () => {
    mockGithubFetch.mockResolvedValue({
      data: {
        repository: {
          issue: {
            trackedIssues: {
              nodes: [
                {
                  number: 10,
                  title: 'Sub-task',
                  state: 'OPEN',
                  repository: { nameWithOwner: 'org/other-repo' },
                },
              ],
            },
            trackedInIssues: { nodes: [] },
          },
        },
      },
    });

    const result = await handlers['github:deps:fetch']({}, 'test-project', 42) as {
      tracks: Array<{ repo?: string }>;
    };

    expect(result.tracks[0].repo).toBe('org/other-repo');
  });
});
