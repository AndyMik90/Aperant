/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for useGitHubPRs hook - selectPR triggering checkNewCommits
 *
 * Key behavior tested:
 * - selectPR calls checkNewCommits when review exists in store
 * - selectPR calls checkNewCommits after loading review from disk
 * - checkNewCommits is NOT called when review is in progress
 * - checkNewCommits is NOT called when no reviewedCommitSha exists
 * - Race condition prevention with AbortController
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PRReviewResult, NewCommitsCheck } from '../../../../../preload/api/modules/github-api';

// Mock factory functions
function createMockReviewResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    prNumber: 123,
    repo: 'test/repo',
    success: true,
    findings: [],
    summary: 'Test summary',
    overallStatus: 'approve',
    reviewedAt: '2024-01-01T00:00:00Z',
    reviewedCommitSha: 'abc123def456',
    ...overrides,
  };
}

function createMockNewCommitsCheck(overrides: Partial<NewCommitsCheck> = {}): NewCommitsCheck {
  return {
    hasNewCommits: false,
    newCommitCount: 0,
    ...overrides,
  };
}

/**
 * Simulate the selectPR logic flow for testing checkNewCommits behavior.
 * This is extracted from useGitHubPRs.ts for unit testing without needing
 * to render the full hook in a React environment.
 */
interface SelectPRTestParams {
  prNumber: number | null;
  projectId: string | null;
  existingState: {
    result: PRReviewResult | null;
    isReviewing: boolean;
    newCommitsCheck: NewCommitsCheck | null;
  } | null;
  diskReviewResult: PRReviewResult | null;
  mockCheckNewCommits: (projectId: string, prNumber: number) => Promise<NewCommitsCheck>;
  mockGetPRReview: (projectId: string, prNumber: number) => Promise<PRReviewResult | null>;
  mockSetNewCommitsCheck: (projectId: string, prNumber: number, check: NewCommitsCheck) => void;
  mockSetPRReviewResult: (projectId: string, result: PRReviewResult) => void;
  abortSignal?: AbortSignal;
}

interface SelectPRTestResult {
  checkNewCommitsCalled: boolean;
  checkNewCommitsCallArgs: { projectId: string; prNumber: number } | null;
  getPRReviewCalled: boolean;
  setNewCommitsCheckCalled: boolean;
  setPRReviewResultCalled: boolean;
}

async function simulateSelectPR(params: SelectPRTestParams): Promise<SelectPRTestResult> {
  const {
    prNumber,
    projectId,
    existingState,
    diskReviewResult: _diskReviewResult,  // Passed for test documentation but not used directly
    mockCheckNewCommits,
    mockGetPRReview,
    mockSetNewCommitsCheck,
    mockSetPRReviewResult,
    abortSignal,
  } = params;

  const result: SelectPRTestResult = {
    checkNewCommitsCalled: false,
    checkNewCommitsCallArgs: null,
    getPRReviewCalled: false,
    setNewCommitsCheckCalled: false,
    setPRReviewResultCalled: false,
  };

  // Early return if no prNumber or deselecting
  if (prNumber === null || !projectId) {
    return result;
  }

  // Helper function to check for new commits (matches useGitHubPRs logic)
  const checkNewCommitsForPR = async (reviewedCommitSha: string | undefined) => {
    // Skip if no commit SHA to compare against
    if (!reviewedCommitSha) {
      return;
    }

    // Skip if aborted
    if (abortSignal?.aborted) {
      return;
    }

    result.checkNewCommitsCalled = true;
    result.checkNewCommitsCallArgs = { projectId, prNumber };

    try {
      const newCommitsResult = await mockCheckNewCommits(projectId, prNumber);

      // Check abort signal after async call
      if (abortSignal?.aborted) {
        return;
      }

      mockSetNewCommitsCheck(projectId, prNumber, newCommitsResult);
      result.setNewCommitsCheckCalled = true;
    } catch {
      // Ignore errors in tests
    }
  };

  // Case 1: No existing state or no result, and not reviewing - load from disk
  if (!existingState?.result && !existingState?.isReviewing) {
    result.getPRReviewCalled = true;
    const reviewFromDisk = await mockGetPRReview(projectId, prNumber);

    if (reviewFromDisk) {
      mockSetPRReviewResult(projectId, reviewFromDisk);
      result.setPRReviewResultCalled = true;

      // CRITICAL: Check for new commits AFTER loading review
      await checkNewCommitsForPR(reviewFromDisk.reviewedCommitSha);
    }
  }
  // Case 2: Review already in store - check for new commits immediately
  else if (existingState?.result) {
    await checkNewCommitsForPR(existingState.result.reviewedCommitSha);
  }
  // Case 3: Review in progress - do NOT check for new commits
  // (no action needed, we just don't call checkNewCommits)

  return result;
}

describe('useGitHubPRs - selectPR triggering checkNewCommits', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCheckNewCommits: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGetPRReview: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSetNewCommitsCheck: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSetPRReviewResult: any;

  beforeEach(() => {
    mockCheckNewCommits = vi.fn().mockResolvedValue(createMockNewCommitsCheck());
    mockGetPRReview = vi.fn().mockResolvedValue(null);
    mockSetNewCommitsCheck = vi.fn();
    mockSetPRReviewResult = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkNewCommits triggered when review exists in store', () => {
    it('should call checkNewCommits when selecting PR with existing review in store', async () => {
      const existingReview = createMockReviewResult({
        prNumber: 123,
        reviewedCommitSha: 'abc123',
      });

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: existingReview,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(result.checkNewCommitsCalled).toBe(true);
      expect(result.checkNewCommitsCallArgs).toEqual({
        projectId: 'test-project',
        prNumber: 123,
      });
      expect(mockCheckNewCommits).toHaveBeenCalledWith('test-project', 123);
    });

    it('should update store with new commits check result', async () => {
      const newCommitsResult = createMockNewCommitsCheck({
        hasNewCommits: true,
        newCommitCount: 3,
        hasCommitsAfterPosting: true,
      });
      mockCheckNewCommits.mockResolvedValue(newCommitsResult);

      const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

      await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: existingReview,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(mockSetNewCommitsCheck).toHaveBeenCalledWith(
        'test-project',
        123,
        newCommitsResult
      );
    });
  });

  describe('checkNewCommits triggered after loading review from disk', () => {
    it('should call checkNewCommits after loading review from disk', async () => {
      const diskReview = createMockReviewResult({
        prNumber: 456,
        reviewedCommitSha: 'def789',
      });
      mockGetPRReview.mockResolvedValue(diskReview);

      const result = await simulateSelectPR({
        prNumber: 456,
        projectId: 'test-project',
        existingState: null, // No existing state
        diskReviewResult: diskReview,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      // Should load from disk first
      expect(result.getPRReviewCalled).toBe(true);
      expect(result.setPRReviewResultCalled).toBe(true);
      expect(mockSetPRReviewResult).toHaveBeenCalledWith('test-project', diskReview);

      // Then check for new commits
      expect(result.checkNewCommitsCalled).toBe(true);
      expect(mockCheckNewCommits).toHaveBeenCalledWith('test-project', 456);
    });

    it('should NOT call checkNewCommits if disk review has no reviewedCommitSha', async () => {
      const diskReviewWithoutSha = createMockReviewResult({
        prNumber: 789,
        reviewedCommitSha: undefined, // No SHA
      });
      mockGetPRReview.mockResolvedValue(diskReviewWithoutSha);

      const result = await simulateSelectPR({
        prNumber: 789,
        projectId: 'test-project',
        existingState: null,
        diskReviewResult: diskReviewWithoutSha,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      // Should still load from disk
      expect(result.getPRReviewCalled).toBe(true);
      expect(result.setPRReviewResultCalled).toBe(true);

      // But NOT check for new commits
      expect(result.checkNewCommitsCalled).toBe(false);
      expect(mockCheckNewCommits).not.toHaveBeenCalled();
    });
  });

  describe('checkNewCommits NOT triggered during active review', () => {
    it('should NOT call checkNewCommits when review is in progress', async () => {
      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: null, // No result yet
          isReviewing: true, // Review in progress
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      // Should NOT check for new commits during active review
      expect(result.checkNewCommitsCalled).toBe(false);
      expect(mockCheckNewCommits).not.toHaveBeenCalled();

      // Should also NOT load from disk (review is managed by IPC)
      expect(result.getPRReviewCalled).toBe(false);
    });

    it('should still call checkNewCommits when previous result exists during active review', async () => {
      const previousReview = createMockReviewResult({ reviewedCommitSha: 'old123' });

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: previousReview,
          isReviewing: true,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(result.checkNewCommitsCalled).toBe(true);
    });
  });

  describe('checkNewCommits NOT triggered without reviewedCommitSha', () => {
    it('should NOT call checkNewCommits if store review has no reviewedCommitSha', async () => {
      const reviewWithoutSha = createMockReviewResult({
        reviewedCommitSha: undefined,
      });

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: reviewWithoutSha,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(result.checkNewCommitsCalled).toBe(false);
      expect(mockCheckNewCommits).not.toHaveBeenCalled();
    });
  });

  describe('Race condition prevention', () => {
    it('should abort checkNewCommits when signal is aborted', async () => {
      const abortController = new AbortController();
      const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

      // Abort before the call
      abortController.abort();

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: existingReview,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
        abortSignal: abortController.signal,
      });

      expect(result.checkNewCommitsCalled).toBe(false);
      expect(mockSetNewCommitsCheck).not.toHaveBeenCalled();
    });

    it('should NOT update store if aborted during async operation', async () => {
      const abortController = new AbortController();
      const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

      // Make checkNewCommits delay and abort during the delay
      mockCheckNewCommits.mockImplementation(async () => {
        // Simulate abort happening during the async call
        abortController.abort();
        return createMockNewCommitsCheck({ hasNewCommits: true });
      });

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: existingReview,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
        abortSignal: abortController.signal,
      });

      // checkNewCommits was called
      expect(result.checkNewCommitsCalled).toBe(true);
      // But store was NOT updated because abort happened
      expect(result.setNewCommitsCheckCalled).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should NOT trigger anything when prNumber is null (deselecting)', async () => {
      const result = await simulateSelectPR({
        prNumber: null,
        projectId: 'test-project',
        existingState: null,
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(result.checkNewCommitsCalled).toBe(false);
      expect(result.getPRReviewCalled).toBe(false);
      expect(mockCheckNewCommits).not.toHaveBeenCalled();
      expect(mockGetPRReview).not.toHaveBeenCalled();
    });

    it('should NOT trigger anything when projectId is null', async () => {
      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: null,
        existingState: null,
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      expect(result.checkNewCommitsCalled).toBe(false);
      expect(result.getPRReviewCalled).toBe(false);
    });

    it('should NOT call getPRReview if review already exists in store (not reviewing)', async () => {
      const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: {
          result: existingReview,
          isReviewing: false,
          newCommitsCheck: null,
        },
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      // Should NOT load from disk (already in store)
      expect(result.getPRReviewCalled).toBe(false);
      expect(mockGetPRReview).not.toHaveBeenCalled();

      // But SHOULD check for new commits
      expect(result.checkNewCommitsCalled).toBe(true);
    });

    it('should NOT load from disk if no review exists on disk', async () => {
      mockGetPRReview.mockResolvedValue(null); // No review on disk

      const result = await simulateSelectPR({
        prNumber: 123,
        projectId: 'test-project',
        existingState: null, // No existing state
        diskReviewResult: null,
        mockCheckNewCommits,
        mockGetPRReview,
        mockSetNewCommitsCheck,
        mockSetPRReviewResult,
      });

      // Should try to load from disk
      expect(result.getPRReviewCalled).toBe(true);
      // But no result to set
      expect(result.setPRReviewResultCalled).toBe(false);
      // And no new commits check (no reviewedCommitSha)
      expect(result.checkNewCommitsCalled).toBe(false);
    });
  });
});

describe('useGitHubPRs - checkNewCommits result handling', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSetNewCommitsCheck: any;

  beforeEach(() => {
    mockSetNewCommitsCheck = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle hasNewCommits: true correctly', async () => {
    const mockCheckNewCommits = vi.fn().mockResolvedValue(
      createMockNewCommitsCheck({
        hasNewCommits: true,
        newCommitCount: 5,
        hasCommitsAfterPosting: true,
      })
    );

    const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

    await simulateSelectPR({
      prNumber: 123,
      projectId: 'test-project',
      existingState: {
        result: existingReview,
        isReviewing: false,
        newCommitsCheck: null,
      },
      diskReviewResult: null,
      mockCheckNewCommits,
      mockGetPRReview: vi.fn(),
      mockSetNewCommitsCheck,
      mockSetPRReviewResult: vi.fn(),
    });

    expect(mockSetNewCommitsCheck).toHaveBeenCalledWith('test-project', 123, {
      hasNewCommits: true,
      newCommitCount: 5,
      hasCommitsAfterPosting: true,
    });
  });

  it('should handle hasNewCommits: false correctly', async () => {
    const mockCheckNewCommits = vi.fn().mockResolvedValue(
      createMockNewCommitsCheck({
        hasNewCommits: false,
        newCommitCount: 0,
        hasCommitsAfterPosting: false,
      })
    );

    const existingReview = createMockReviewResult({ reviewedCommitSha: 'abc123' });

    await simulateSelectPR({
      prNumber: 123,
      projectId: 'test-project',
      existingState: {
        result: existingReview,
        isReviewing: false,
        newCommitsCheck: null,
      },
      diskReviewResult: null,
      mockCheckNewCommits,
      mockGetPRReview: vi.fn(),
      mockSetNewCommitsCheck,
      mockSetPRReviewResult: vi.fn(),
    });

    expect(mockSetNewCommitsCheck).toHaveBeenCalledWith('test-project', 123, {
      hasNewCommits: false,
      newCommitCount: 0,
      hasCommitsAfterPosting: false,
    });
  });
});
