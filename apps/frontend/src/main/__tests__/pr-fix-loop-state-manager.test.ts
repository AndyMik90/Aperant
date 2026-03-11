import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRFixLoopStateManager } from '../pr-fix-loop-state-manager';
import type {
  PRFixLoopProgress,
  PRFixLoopResult
} from '../../preload/api/modules/github-api';

const mockSafeSendToRenderer = vi.fn();
vi.mock('../ipc-handlers/utils', () => ({
  safeSendToRenderer: (...args: unknown[]) => mockSafeSendToRenderer(...args)
}));

function createMockGetMainWindow() {
  return vi.fn(() => ({ id: 1 }) as unknown as Electron.BrowserWindow);
}

function createMockProgress(overrides: Partial<PRFixLoopProgress> = {}): PRFixLoopProgress {
  return {
    phase: 'fixing',
    prNumber: 42,
    iteration: 1,
    maxIterations: 3,
    progress: 50,
    message: 'Applying fixes...',
    ...overrides
  };
}

function createMockResult(overrides: Partial<PRFixLoopResult> = {}): PRFixLoopResult {
  return {
    state: 'done',
    prNumber: 42,
    projectId: 'project-1',
    iteration: 1,
    maxIterations: 3,
    completedAt: new Date().toISOString(),
    reason: 'Converged',
    ...overrides
  };
}

describe('PRFixLoopStateManager', () => {
  let manager: PRFixLoopStateManager;
  const projectId = 'project-1';
  const prNumber = 42;

  beforeEach(() => {
    manager = new PRFixLoopStateManager(createMockGetMainWindow());
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.clearAll();
  });

  it('creates an actor on handleStartLoop', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    const snapshot = manager.getState(projectId, prNumber);
    expect(snapshot).not.toBeNull();
    expect(String(snapshot!.value)).toBe('validating');
  });

  it('emits progress updates and preserves metadata', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    manager.handleProgress(projectId, prNumber, createMockProgress(), {
      iteration: 1,
      maxIterations: 3,
      lastCommitSha: 'abc123',
      lastAttemptSignature: 'sig-1'
    });

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('fixing');
    expect(snapshot!.context.lastCommitSha).toBe('abc123');
    expect(snapshot!.context.lastAttemptSignature).toBe('sig-1');
    expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
      expect.any(Function),
      'github:pr:fixProgress',
      projectId,
      expect.objectContaining({ phase: 'fixing' })
    );
  });

  it('emits state change payloads via fix state change channel', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
      expect.any(Function),
      'github:pr:fixStateChange',
      `${projectId}:${prNumber}`,
      expect.objectContaining({ state: 'validating', isRunning: true })
    );
  });

  it('transitions to done on handleComplete', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    const result = createMockResult();
    manager.handleComplete(projectId, prNumber, result);

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('done');
    expect(snapshot!.context.result).toEqual(result);
  });

  it('transitions to handoff_required on handleHandoff', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    const result = createMockResult({ state: 'handoff_required', reason: 'Needs human review' });
    manager.handleHandoff(projectId, prNumber, result);

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('handoff_required');
    expect(snapshot!.context.result?.state).toBe('handoff_required');
  });

  it('transitions to failed on handleFailureResult', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    const result = createMockResult({
      state: 'failed',
      reason: 'No convergence',
      error: 'push failed'
    });
    manager.handleFailureResult(projectId, prNumber, result);

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('failed');
    expect(snapshot!.context.result?.state).toBe('failed');
    expect(snapshot!.context.error).toBe('push failed');
  });

  it('transitions to failed on handleError', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    manager.handleError(projectId, prNumber, 'Boom');

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('failed');
    expect(snapshot!.context.error).toBe('Boom');
  });

  it('transitions to cancelled on handleCancel', () => {
    manager.handleStartLoop(projectId, prNumber, { maxIterations: 3 });
    manager.handleCancel(projectId, prNumber, createMockResult({ state: 'cancelled' }));

    const snapshot = manager.getState(projectId, prNumber);
    expect(String(snapshot!.value)).toBe('cancelled');
  });
});
