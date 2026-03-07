import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRReviewStateManager } from '../pr-review-state-manager';
import type { PRReviewResult, PRReviewProgress } from '../../preload/api/modules/github-api';

// Mock dependencies
const mockSafeSendToRenderer = vi.fn();
vi.mock('../ipc-handlers/utils', () => ({
  safeSendToRenderer: (...args: unknown[]) => mockSafeSendToRenderer(...args)
}));

function createMockGetMainWindow() {
  return vi.fn(() => ({ id: 1 }) as unknown as Electron.BrowserWindow);
}

function createMockProgress(overrides: Partial<PRReviewProgress> = {}): PRReviewProgress {
  return {
    phase: 'analyzing',
    progress: 50,
    message: 'Analyzing files...',
    ...overrides
  } as PRReviewProgress;
}

function createMockResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    overallStatus: 'approved',
    summary: 'Looks good',
    ...overrides
  } as PRReviewResult;
}

describe('PRReviewStateManager', () => {
  let manager: PRReviewStateManager;
  const projectId = 'project-1';
  const prNumber = 42;

  beforeEach(() => {
    manager = new PRReviewStateManager(createMockGetMainWindow());
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('actor lifecycle', () => {
    it('should create actor on first handleStartReview call', () => {
      manager.handleStartReview(projectId, prNumber);
      const snapshot = manager.getState(projectId, prNumber);
      expect(snapshot).not.toBeNull();
    });

    it('should reuse existing actor for same PR key', () => {
      manager.handleStartReview(projectId, prNumber);
      const snapshot1 = manager.getState(projectId, prNumber);
      // Calling again should not create a new actor
      manager.handleStartReview(projectId, prNumber);
      const snapshot2 = manager.getState(projectId, prNumber);
      expect(snapshot1).not.toBeNull();
      expect(snapshot2).not.toBeNull();
    });

    it('should create separate actors for different PRs', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);
      const snapshot1 = manager.getState(projectId, 1);
      const snapshot2 = manager.getState(projectId, 2);
      expect(snapshot1).not.toBeNull();
      expect(snapshot2).not.toBeNull();
    });

    it('should start actor before events are sent', () => {
      manager.handleStartReview(projectId, prNumber);
      const snapshot = manager.getState(projectId, prNumber);
      // If actor wasn't started, getSnapshot would fail or return unexpected state
      expect(snapshot).not.toBeNull();
      expect(String(snapshot!.value)).toBe('reviewing');
    });
  });

  describe('event routing', () => {
    it('should transition to reviewing on handleStartReview', () => {
      manager.handleStartReview(projectId, prNumber);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('reviewing');
    });

    it('should send START_FOLLOWUP_REVIEW with previousResult', () => {
      const previousResult = createMockResult();
      manager.handleStartFollowupReview(projectId, prNumber, previousResult);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('reviewing');
      expect(snapshot!.context.isFollowup).toBe(true);
      expect(snapshot!.context.previousResult).toBe(previousResult);
    });

    it('should send START_REVIEW when handleStartFollowupReview has no previousResult', () => {
      manager.handleStartFollowupReview(projectId, prNumber);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('reviewing');
      expect(snapshot!.context.isFollowup).toBe(false);
    });

    it('should update context on handleProgress', () => {
      manager.handleStartReview(projectId, prNumber);
      const progress = createMockProgress();
      manager.handleProgress(projectId, prNumber, progress);
      const snapshot = manager.getState(projectId, prNumber);
      expect(snapshot!.context.progress).toEqual(progress);
    });

    it('should ignore handleProgress for unknown PR', () => {
      // Should not throw
      manager.handleProgress(projectId, 999, createMockProgress());
      expect(manager.getState(projectId, 999)).toBeNull();
    });

    it('should transition to completed on handleComplete', () => {
      manager.handleStartReview(projectId, prNumber);
      const result = createMockResult();
      manager.handleComplete(projectId, prNumber, result);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('completed');
      expect(snapshot!.context.result).toEqual(result);
    });

    it('should create actor for handleComplete on unknown PR (late-arriving result)', () => {
      const result = createMockResult();
      // No handleStartReview called — handleComplete should create the actor
      manager.handleComplete(projectId, prNumber, result);
      const snapshot = manager.getState(projectId, prNumber);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.context.result).toEqual(result);
    });

    it('should send DETECT_EXTERNAL_REVIEW when overallStatus is in_progress', () => {
      manager.handleStartReview(projectId, prNumber);
      const result = createMockResult({ overallStatus: 'in_progress' });
      manager.handleComplete(projectId, prNumber, result);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('externalReview');
    });

    it('should transition to error on handleError', () => {
      manager.handleStartReview(projectId, prNumber);
      manager.handleError(projectId, prNumber, 'Something went wrong');
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('error');
      expect(snapshot!.context.error).toBe('Something went wrong');
    });

    it('should transition to error on handleCancel', () => {
      manager.handleStartReview(projectId, prNumber);
      manager.handleCancel(projectId, prNumber);
      const snapshot = manager.getState(projectId, prNumber);
      expect(String(snapshot!.value)).toBe('error');
    });
  });

  describe('state emission', () => {
    it('should emit state changes to renderer via safeSendToRenderer', () => {
      manager.handleStartReview(projectId, prNumber);
      expect(mockSafeSendToRenderer).toHaveBeenCalled();
    });

    it('should use GITHUB_PR_REVIEW_STATE_CHANGE IPC channel', () => {
      manager.handleStartReview(projectId, prNumber);
      expect(mockSafeSendToRenderer).toHaveBeenCalledWith(
        expect.any(Function),
        'github:pr:reviewStateChange',
        expect.any(String),
        expect.objectContaining({ state: expect.any(String) })
      );
    });

    it('should emit PRReviewStatePayload with correct shape', () => {
      manager.handleStartReview(projectId, prNumber);
      // Find the call that emits 'reviewing' state
      const reviewingCall = mockSafeSendToRenderer.mock.calls.find(
        (call: unknown[]) => {
          const payload = call[3] as Record<string, unknown> | undefined;
          return payload && typeof payload === 'object' && payload.state === 'reviewing';
        }
      );
      expect(reviewingCall).toBeDefined();
      expect(reviewingCall![2]).toBe(`${projectId}:${prNumber}`);
      const payload = reviewingCall![3] as Record<string, unknown>;
      expect(payload).toEqual(expect.objectContaining({
        state: 'reviewing',
        prNumber,
        projectId,
        isReviewing: true,
        startedAt: expect.any(String),
        progress: null,
        result: null,
        previousResult: null,
        error: null,
        isExternalReview: false,
        isFollowup: false,
      }));
    });

    it('should use projectId:prNumber as key format', () => {
      manager.handleStartReview(projectId, prNumber);
      const calls = mockSafeSendToRenderer.mock.calls;
      const prCall = calls.find((call: unknown[]) => call[2] === `${projectId}:${prNumber}`);
      expect(prCall).toBeDefined();
    });
  });

  describe('deduplication', () => {
    it('should NOT emit duplicate IPC for same state + same context', () => {
      manager.handleStartReview(projectId, prNumber);
      const callCountAfterStart = mockSafeSendToRenderer.mock.calls.length;

      // Sending START_REVIEW again won't transition (guard prevents it), so no new emission
      manager.handleStartReview(projectId, prNumber);
      expect(mockSafeSendToRenderer.mock.calls.length).toBe(callCountAfterStart);
    });

    it('should emit for same state but different context (progress update)', () => {
      manager.handleStartReview(projectId, prNumber);
      const callCountAfterStart = mockSafeSendToRenderer.mock.calls.length;

      manager.handleProgress(projectId, prNumber, createMockProgress({ progress: 25, message: 'Step 1' }));
      expect(mockSafeSendToRenderer.mock.calls.length).toBeGreaterThan(callCountAfterStart);

      const callCountAfterProgress1 = mockSafeSendToRenderer.mock.calls.length;
      manager.handleProgress(projectId, prNumber, createMockProgress({ progress: 75, message: 'Step 2' }));
      expect(mockSafeSendToRenderer.mock.calls.length).toBeGreaterThan(callCountAfterProgress1);
    });

    it('should always emit for different state transitions', () => {
      manager.handleStartReview(projectId, prNumber);
      const callCountAfterStart = mockSafeSendToRenderer.mock.calls.length;

      manager.handleComplete(projectId, prNumber, createMockResult());
      expect(mockSafeSendToRenderer.mock.calls.length).toBeGreaterThan(callCountAfterStart);
    });
  });

  describe('cleanup', () => {
    it('should stop actor and remove from map on handleClearReview', () => {
      manager.handleStartReview(projectId, prNumber);
      expect(manager.getState(projectId, prNumber)).not.toBeNull();

      manager.handleClearReview(projectId, prNumber);
      expect(manager.getState(projectId, prNumber)).toBeNull();
    });

    it('should emit exactly one cleared state IPC on handleClearReview (no double emission)', () => {
      manager.handleStartReview(projectId, prNumber);
      mockSafeSendToRenderer.mockClear();

      manager.handleClearReview(projectId, prNumber);

      // Should emit exactly 1 cleared state, not 2 (no double emission from
      // sending CLEAR_REVIEW to actor subscription + manual emitClearedState)
      expect(mockSafeSendToRenderer).toHaveBeenCalledTimes(1);
      const payload = mockSafeSendToRenderer.mock.calls[0][3] as Record<string, unknown>;
      expect(payload).toEqual(expect.objectContaining({ state: 'idle' }));
    });

    it('should stop ALL actors and clear maps on handleAuthChange', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);

      manager.handleAuthChange();

      expect(manager.getState(projectId, 1)).toBeNull();
      expect(manager.getState(projectId, 2)).toBeNull();
    });

    it('should emit cleared state to renderer on handleAuthChange', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);
      mockSafeSendToRenderer.mockClear();

      manager.handleAuthChange();

      // Should emit idle/null state for each PR
      expect(mockSafeSendToRenderer).toHaveBeenCalledTimes(2);
      for (const call of mockSafeSendToRenderer.mock.calls) {
        const payload = call[3] as Record<string, unknown>;
        expect(payload).toEqual(expect.objectContaining({ state: 'idle' }));
      }
    });

    it('should stop all actors on clearAll', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);

      manager.clearAll();

      expect(manager.getState(projectId, 1)).toBeNull();
      expect(manager.getState(projectId, 2)).toBeNull();
    });
  });

  describe('concurrent PRs', () => {
    it('should support multiple PRs with independent actors', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);

      manager.handleComplete(projectId, 1, createMockResult());

      expect(String(manager.getState(projectId, 1)!.value)).toBe('completed');
      expect(String(manager.getState(projectId, 2)!.value)).toBe('reviewing');
    });

    it('should route events to correct actor by key', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);

      manager.handleError(projectId, 2, 'Error on PR 2');

      expect(String(manager.getState(projectId, 1)!.value)).toBe('reviewing');
      expect(String(manager.getState(projectId, 2)!.value)).toBe('error');
      expect(manager.getState(projectId, 2)!.context.error).toBe('Error on PR 2');
    });

    it('should not affect other PRs when clearing one', () => {
      manager.handleStartReview(projectId, 1);
      manager.handleStartReview(projectId, 2);

      manager.handleClearReview(projectId, 1);

      expect(manager.getState(projectId, 1)).toBeNull();
      expect(manager.getState(projectId, 2)).not.toBeNull();
      expect(String(manager.getState(projectId, 2)!.value)).toBe('reviewing');
    });
  });
});
