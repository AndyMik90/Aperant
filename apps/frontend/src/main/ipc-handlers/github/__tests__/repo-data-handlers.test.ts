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
import { registerRepoDataHandlers } from '../repo-data-handlers';

type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers: Record<string, HandlerFn> = {};

beforeEach(() => {
  vi.clearAllMocks();

  mockGetGitHubConfig.mockReturnValue({
    token: 'test-token',
    repo: 'owner/repo',
  });
  mockNormalizeRepoReference.mockReturnValue('owner/repo');

  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation(
    (channel: string, handler: HandlerFn) => {
      handlers[channel] = handler;
    },
  );

  registerRepoDataHandlers(() => null);
});

describe('getLabels handler', () => {
  const call = (projectId: string) =>
    handlers['github:repo:getLabels']({}, projectId);

  it('returns mapped labels', async () => {
    mockGithubFetch.mockResolvedValue([
      { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      { name: 'feature', color: 'a2eeef', description: null },
    ]);

    const result = await call('test-project');
    expect(result).toEqual({
      success: true,
      data: [
        { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
        { name: 'feature', color: 'a2eeef', description: '' },
      ],
    });
    expect(mockGithubFetch).toHaveBeenCalledWith(
      'test-token',
      '/repos/owner/repo/labels?per_page=100',
    );
  });

  it('returns empty array for empty response', async () => {
    mockGithubFetch.mockResolvedValue([]);
    const result = await call('test-project');
    expect(result).toEqual({ success: true, data: [] });
  });

  it('returns error when API call fails', async () => {
    mockGithubFetch.mockRejectedValue(new Error('HTTP 404: Not Found'));
    const result = await call('test-project');
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('HTTP 404'),
      }),
    );
  });
});

describe('getCollaborators handler', () => {
  const call = (projectId: string) =>
    handlers['github:repo:getCollaborators']({}, projectId);

  it('returns collaborator logins', async () => {
    mockGithubFetch.mockResolvedValue([
      { login: 'octocat' },
      { login: 'user1' },
      { login: 'user2' },
    ]);

    const result = await call('test-project');
    expect(result).toEqual({
      success: true,
      data: ['octocat', 'user1', 'user2'],
    });
    expect(mockGithubFetch).toHaveBeenCalledWith(
      'test-token',
      '/repos/owner/repo/collaborators?per_page=100',
    );
  });

  it('returns empty list when there are no collaborators', async () => {
    mockGithubFetch.mockResolvedValue([]);
    const result = await call('test-project');
    expect(result).toEqual({ success: true, data: [] });
  });

  it('returns error on API failure', async () => {
    mockGithubFetch.mockRejectedValue(new Error('HTTP 404: Not Found'));
    const result = await call('test-project');
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('HTTP 404'),
      }),
    );
  });
});
