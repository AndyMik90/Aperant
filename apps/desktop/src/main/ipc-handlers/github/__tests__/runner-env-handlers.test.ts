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

// =============================================================================
// Mock TypeScript runners (replacing old Python subprocess mocks)
// =============================================================================

const mockRunMultiPassReview = vi.fn();
const mockTriageBatchIssues = vi.fn();
const mockBatchProcessorGroupIssues = vi.fn();

type CreateIPCCommunicators = typeof createIPCCommunicatorsType;

const mockSendError = vi.fn();
const mockCreateIPCCommunicators = vi.fn(
  (..._args: Parameters<CreateIPCCommunicators>) => ({
    sendProgress: vi.fn(),
    sendComplete: vi.fn(),
    sendError: mockSendError,
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

// Mock the TypeScript PR review engine
vi.mock('../../../ai/runners/github/pr-review-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ai/runners/github/pr-review-engine')>();
  return {
    ...actual,
    runMultiPassReview: (...args: unknown[]) => mockRunMultiPassReview(...args),
  };
});

// Mock the parallel orchestrator reviewer (current PR review flow)
const mockOrchestratorReview = vi.fn();
vi.mock('../../../ai/runners/github/parallel-orchestrator', () => {
  class MockParallelOrchestratorReviewer {
    review(...args: unknown[]) {
      return mockOrchestratorReview(...args);
    }
  }
  return { ParallelOrchestratorReviewer: MockParallelOrchestratorReviewer };
});

// Mock the TypeScript triage engine
vi.mock('../../../ai/runners/github/triage-engine', () => ({
  triageBatchIssues: (...args: unknown[]) => mockTriageBatchIssues(...args),
}));

// Mock the TypeScript BatchProcessor — must use class syntax for vi.mock
vi.mock('../../../ai/runners/github/batch-processor', () => {
  class MockBatchProcessorClass {
    groupIssues(...args: unknown[]) {
      return mockBatchProcessorGroupIssues(...args);
    }
    analyzeBatch(...args: unknown[]) {
      return Promise.resolve([]);
    }
  }
  return {
    BatchProcessor: MockBatchProcessorClass,
  };
});

// Mock duplicate-detector (imported by autofix-handlers)
vi.mock('../../../ai/runners/github/duplicate-detector', () => ({
  DuplicateDetector: vi.fn().mockImplementation(() => ({
    findDuplicates: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../utils', () => ({
  getGitHubConfig: vi.fn(() => ({
    token: 'mock-github-token',
    repo: 'owner/repo',
  })),
  githubFetch: vi.fn(),
  normalizeRepoReference: vi.fn((r: string) => r),
}));

vi.mock('../../../settings-utils', () => ({
  readSettingsFile: vi.fn(() => ({})),
}));

vi.mock('../../../env-utils', () => ({
  getAugmentedEnv: vi.fn(() => ({})),
}));

vi.mock('../../../sentry', () => ({
  safeBreadcrumb: vi.fn(),
  safeCaptureException: vi.fn(),
}));

vi.mock('../../../../shared/utils/sentry-privacy', () => ({
  sanitizeForSentry: vi.fn((data: unknown) => data),
}));

vi.mock('../../../pr-review-state-manager', () => {
  class MockPRReviewStateManager {
    handleStartReview = vi.fn();
    handleProgress = vi.fn();
    handleComplete = vi.fn();
    handleError = vi.fn();
    getState = vi.fn(() => null);
  }
  return { PRReviewStateManager: MockPRReviewStateManager };
});

vi.mock('../utils/logger', () => ({
  createContextLogger: vi.fn(() => ({
    debug: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../ai/runners/github/parallel-followup', () => ({
  ParallelFollowupReviewer: vi.fn().mockImplementation(() => ({
    review: vi.fn().mockResolvedValue({ findings: [], verdict: 'approve' }),
  })),
}));

vi.mock('../../context/memory-service-factory', () => ({
  getMemoryService: vi.fn(() => Promise.resolve({ store: vi.fn() })),
  getEmbeddingProvider: vi.fn(() => null),
  resetMemoryService: vi.fn(),
}));

// Mock child_process (used by fetchPRContext to call gh pr diff)
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(() => 'mock diff output'),
  };
});

vi.mock('../../../services/pr-status-poller', () => ({
  getPRStatusPoller: vi.fn(() => ({
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    setMainWindowGetter: vi.fn(),
    getStatus: vi.fn(() => null),
    stopAll: vi.fn(),
  })),
}));

vi.mock('../spec-utils', () => ({
  createSpecForIssue: vi.fn().mockResolvedValue('spec-001'),
  buildIssueContext: vi.fn(() => 'context'),
  buildInvestigationTask: vi.fn(() => 'task'),
  updateImplementationPlanStatus: vi.fn(),
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
      
      useClaudeMd: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('GitHub TypeScript runner usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain.reset();
    projectRef.current = createProject();
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

  it('calls ParallelOrchestratorReviewer for PR review', async () => {
    const { githubFetch } = await import('../utils');
    const githubFetchMock = vi.mocked(githubFetch);

    // Mock GitHub API calls made by the PR review handler
    // Note: order matters — more specific patterns must come before general ones
    githubFetchMock.mockImplementation(async (_token: string, endpoint: string) => {
      if (endpoint === '/user') return { login: 'testuser' };
      if (endpoint.includes('/assignees')) return {};
      if (endpoint.includes('/check-runs')) return { check_runs: [], total_count: 0 };
      if (endpoint.includes('/files')) return [];
      if (endpoint.includes('/commits')) return [];
      if (endpoint.includes('/comments')) return [];
      if (endpoint.includes('/reviews')) return [];
      // Generic PR metadata (must be after more specific patterns)
      if (endpoint.includes('/pulls/')) return {
        number: 123,
        title: 'Test PR',
        body: '',
        state: 'open',
        user: { login: 'author' },
        head: { ref: 'feature', sha: 'abc123', repo: { full_name: 'owner/repo' } },
        base: { ref: 'main' },
        additions: 10,
        deletions: 5,
        changed_files: 3,
        diff_url: '',
        html_url: 'https://github.com/owner/repo/pull/123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [],
      };
      return {};
    });

    // Return the shape that ParallelOrchestratorReviewer.review() produces
    mockOrchestratorReview.mockResolvedValue({
      findings: [],
      structuralIssues: [],
      verdict: 'ready_to_merge',
      summary: 'LGTM',
      agentsInvoked: ['security', 'logic'],
    });

    const { registerPRHandlers } = await import('../pr-handlers');
    registerPRHandlers(() => createMockWindow());

    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_PR_REVIEW, projectRef.current?.id, 123);

    // The handler should have called ParallelOrchestratorReviewer.review()
    expect(mockOrchestratorReview).toHaveBeenCalled();
  });

  it('calls TypeScript triageBatchIssues for triage', async () => {
    const { githubFetch } = await import('../utils');
    const githubFetchMock = vi.mocked(githubFetch);

    // Mock GitHub API calls for triage
    githubFetchMock.mockResolvedValue([
      {
        number: 1,
        title: 'Bug: crash on startup',
        body: 'App crashes immediately',
        user: { login: 'reporter' },
        created_at: new Date().toISOString(),
        labels: [],
        pull_request: undefined,
      },
    ] as unknown);

    mockTriageBatchIssues.mockResolvedValue([
      {
        issueNumber: 1,
        category: 'bug',
        confidence: 0.9,
        labelsToAdd: ['bug'],
        labelsToRemove: [],
        isDuplicate: false,
        isSpam: false,
        isFeatureCreep: false,
        suggestedBreakdown: [],
        priority: 'high',
        triagedAt: new Date().toISOString(),
      },
    ]);

    const { registerTriageHandlers } = await import('../triage-handlers');
    registerTriageHandlers(() => createMockWindow());

    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_TRIAGE_RUN, projectRef.current?.id);

    // The handler should have called triageBatchIssues (TypeScript runner)
    expect(mockTriageBatchIssues).toHaveBeenCalled();
  });

  it('calls TypeScript BatchProcessor for autofix analyze preview', async () => {
    const { githubFetch } = await import('../utils');
    const githubFetchMock = vi.mocked(githubFetch);

    // Mock GitHub API calls for autofix
    githubFetchMock.mockResolvedValue([
      {
        number: 1,
        title: 'Feature request: dark mode',
        body: 'Please add dark mode',
        user: { login: 'requester' },
        created_at: new Date().toISOString(),
        labels: [],
        pull_request: undefined,
      },
    ] as unknown);

    mockBatchProcessorGroupIssues.mockResolvedValue([
      {
        batchId: 'batch-1',
        primaryIssue: 1,
        issues: [{ issueNumber: 1, title: 'Feature request: dark mode', similarityToPrimary: 1.0 }],
        commonThemes: ['dark mode'],
      },
    ]);

    const { AgentManager: MockedAgentManager } = await import('../../../agent/agent-manager');
    const { registerAutoFixHandlers } = await import('../autofix-handlers');

    const agentManager: AgentManager = new MockedAgentManager();
    const getMainWindow: () => BrowserWindow | null = () => createMockWindow();

    registerAutoFixHandlers(agentManager, getMainWindow);
    await mockIpcMain.emit(IPC_CHANNELS.GITHUB_AUTOFIX_ANALYZE_PREVIEW, projectRef.current?.id);

    // The handler should have called BatchProcessor.groupIssues (TypeScript runner)
    expect(mockBatchProcessorGroupIssues).toHaveBeenCalled();
  });
});
