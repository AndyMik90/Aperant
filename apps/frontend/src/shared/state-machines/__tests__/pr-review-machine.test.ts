import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { prReviewMachine, type PRReviewEvent } from '../pr-review-machine';

/**
 * Helper to run a sequence of events and get the final state
 */
function runEvents(events: PRReviewEvent[]) {
  const actor = createActor(prReviewMachine);
  actor.start();

  for (const event of events) {
    actor.send(event);
  }

  const snapshot = actor.getSnapshot();
  actor.stop();
  return snapshot;
}

const mockResult = {
  prNumber: 42,
  repo: 'test/repo',
  success: true,
  findings: [],
  summary: 'Test review',
  overallStatus: 'approve' as const,
  reviewedAt: new Date().toISOString(),
};

const mockProgress = {
  phase: 'analyzing' as const,
  prNumber: 42,
  progress: 50,
  message: 'Analyzing files...',
};

describe('prReviewMachine', () => {
  describe('initial state', () => {
    it('should start in idle state', () => {
      const actor = createActor(prReviewMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      actor.stop();
    });

    it('should have null context initially', () => {
      const actor = createActor(prReviewMachine);
      actor.start();
      const ctx = actor.getSnapshot().context;
      expect(ctx.prNumber).toBeNull();
      expect(ctx.projectId).toBeNull();
      expect(ctx.progress).toBeNull();
      expect(ctx.result).toBeNull();
      expect(ctx.previousResult).toBeNull();
      expect(ctx.error).toBeNull();
      expect(ctx.isFollowup).toBe(false);
      expect(ctx.isExternalReview).toBe(false);
      actor.stop();
    });
  });

  describe('happy path: idle -> reviewing -> completed', () => {
    it('should transition through the standard review flow', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.result).toEqual(mockResult);
      expect(snapshot.context.prNumber).toBe(42);
      expect(snapshot.context.projectId).toBe('proj-1');
    });
  });

  describe('follow-up review: completed -> reviewing (with previousResult)', () => {
    it('should preserve previousResult when starting follow-up from completed', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'START_FOLLOWUP_REVIEW', prNumber: 42, projectId: 'proj-1', previousResult: mockResult },
      ]);

      expect(snapshot.value).toBe('reviewing');
      expect(snapshot.context.isFollowup).toBe(true);
      expect(snapshot.context.previousResult).toEqual(mockResult);
      expect(snapshot.context.result).toBeNull();
    });
  });

  describe('error handling: reviewing -> error', () => {
    it('should transition to error on REVIEW_ERROR', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'API failure' },
      ]);

      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('API failure');
      expect(snapshot.context.progress).toBeNull();
    });
  });

  describe('cancel flow: reviewing -> error', () => {
    it('should set cancelled error message on CANCEL_REVIEW', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'CANCEL_REVIEW' },
      ]);

      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('Review cancelled by user');
    });
  });

  describe('external review: reviewing -> externalReview -> completed', () => {
    it('should transition through external review flow', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'DETECT_EXTERNAL_REVIEW' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.isExternalReview).toBe(true);
      expect(snapshot.context.result).toEqual(mockResult);
    });

    it('should transition to error from externalReview', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'DETECT_EXTERNAL_REVIEW' },
        { type: 'REVIEW_ERROR', error: 'External review failed' },
      ]);

      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('External review failed');
    });
  });

  describe('retry after error: error -> reviewing -> completed', () => {
    it('should allow starting a new review from error state', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'Failed' },
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.error).toBeNull();
      expect(snapshot.context.result).toEqual(mockResult);
    });

    it('should allow starting a follow-up review from error state with previousResult preserved', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'START_FOLLOWUP_REVIEW', prNumber: 42, projectId: 'proj-1', previousResult: mockResult },
        { type: 'REVIEW_ERROR', error: 'Follow-up failed' },
        { type: 'START_FOLLOWUP_REVIEW', prNumber: 42, projectId: 'proj-1', previousResult: mockResult },
      ]);

      expect(snapshot.value).toBe('reviewing');
      expect(snapshot.context.previousResult).toEqual(mockResult);
      expect(snapshot.context.isFollowup).toBe(true);
    });
  });

  describe('clear review', () => {
    it('should clear from completed to idle', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'CLEAR_REVIEW' },
      ]);

      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.prNumber).toBeNull();
      expect(snapshot.context.result).toBeNull();
    });

    it('should clear from error to idle', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'Failed' },
        { type: 'CLEAR_REVIEW' },
      ]);

      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.error).toBeNull();
    });

    it('should clear from reviewing to idle', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'CLEAR_REVIEW' },
      ]);

      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.prNumber).toBeNull();
      expect(snapshot.context.projectId).toBeNull();
    });

    it('should clear from externalReview to idle', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'DETECT_EXTERNAL_REVIEW' },
        { type: 'CLEAR_REVIEW' },
      ]);

      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.prNumber).toBeNull();
      expect(snapshot.context.isExternalReview).toBe(false);
    });
  });

  describe('reject START_REVIEW when already reviewing', () => {
    it('should stay in reviewing when START_REVIEW is sent again', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'START_REVIEW', prNumber: 99, projectId: 'proj-2' },
      ]);

      expect(snapshot.value).toBe('reviewing');
      expect(snapshot.context.prNumber).toBe(42);
    });
  });

  describe('guard: reject SET_PROGRESS when not in reviewing state', () => {
    it('should ignore SET_PROGRESS in idle state', () => {
      const snapshot = runEvents([
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.progress).toBeNull();
    });

    it('should ignore SET_PROGRESS in completed state', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.progress).toBeNull();
    });

    it('should ignore SET_PROGRESS in error state', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'Failed' },
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.value).toBe('error');
      expect(snapshot.context.progress).toBeNull();
    });
  });

  describe('context updates', () => {
    it('should store progress during review', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.context.progress).toEqual(mockProgress);
    });

    it('should store result on completion', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
      ]);

      expect(snapshot.context.result).toEqual(mockResult);
      expect(snapshot.context.progress).toBeNull();
    });

    it('should store error on failure', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'Something broke' },
      ]);

      expect(snapshot.context.error).toBe('Something broke');
      expect(snapshot.context.progress).toBeNull();
    });

    it('should set startedAt on review start', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
      ]);

      expect(snapshot.context.startedAt).toBeTruthy();
    });
  });

  describe('follow-up context', () => {
    it('should preserve previousResult in follow-up review', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'START_FOLLOWUP_REVIEW', prNumber: 42, projectId: 'proj-1', previousResult: mockResult },
        { type: 'REVIEW_COMPLETE', result: { ...mockResult, summary: 'Follow-up review' } },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.previousResult).toEqual(mockResult);
      expect(snapshot.context.result?.summary).toBe('Follow-up review');
    });

    it('should clear previousResult on normal START_REVIEW from completed', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'START_REVIEW', prNumber: 43, projectId: 'proj-1' },
      ]);

      expect(snapshot.context.previousResult).toBeNull();
      expect(snapshot.context.isFollowup).toBe(false);
    });
  });

  describe('stale events', () => {
    it('should reject SET_PROGRESS in completed state', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_COMPLETE', result: mockResult },
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.value).toBe('completed');
      expect(snapshot.context.progress).toBeNull();
    });

    it('should reject SET_PROGRESS in error state', () => {
      const snapshot = runEvents([
        { type: 'START_REVIEW', prNumber: 42, projectId: 'proj-1' },
        { type: 'REVIEW_ERROR', error: 'Failed' },
        { type: 'SET_PROGRESS', progress: mockProgress },
      ]);

      expect(snapshot.value).toBe('error');
      expect(snapshot.context.progress).toBeNull();
    });
  });
});
