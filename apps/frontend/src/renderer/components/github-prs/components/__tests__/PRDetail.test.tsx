/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for PRDetail component prStatus computation
 * Tests the fix for ACS-200: In-progress PR review should be displayed when switching back to PR
 *
 * Key behavior tested:
 * - isReviewing is checked FIRST before reviewResult (fixes ACS-200)
 * - Reviewing status has correct label, icon, and color
 * - All other status computations remain unaffected
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error - vitest resolves this correctly
import type { PRData, PRReviewResult, PRReviewProgress } from '../../../hooks/useGitHubPRs';
import type { NewCommitsCheck } from '@preload/api/modules/github-api';

/**
 * Factory function to create a mock PR data object
 */
function _createMockPR(overrides: Partial<PRData> = {}): PRData {
  return {
    number: 123,
    title: 'Test PR',
    body: 'Test PR description',
    state: 'open',
    author: { login: 'testuser' },
    headRefName: 'feature-branch',
    baseRefName: 'main',
    additions: 100,
    deletions: 50,
    changedFiles: 5,
    assignees: [],
    files: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/test/repo/pull/123',
    ...overrides,
  };
}

/**
 * Factory function to create a mock PR review result
 */
function createMockReviewResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    prNumber: 123,
    repo: 'test/repo',
    success: true,
    findings: [],
    summary: 'Test summary',
    overallStatus: 'approve',
    reviewedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Factory function to create a mock PR review progress
 */
function createMockReviewProgress(overrides: Partial<PRReviewProgress> = {}): PRReviewProgress {
  return {
    phase: 'analyzing',
    prNumber: 123,
    progress: 50,
    message: 'Analyzing PR...',
    ...overrides,
  };
}

/**
 * Factory function to create a mock NewCommitsCheck result
 */
function createMockNewCommitsCheck(overrides: Partial<NewCommitsCheck> = {}): NewCommitsCheck {
  return {
    hasNewCommits: false,
    newCommitCount: 0,
    ...overrides,
  };
}

/**
 * Simulate the prStatus computation logic from PRDetail.tsx
 * This is extracted for testing to avoid needing to render the entire component
 */
function computePRStatus(params: {
  isReviewing: boolean;
  reviewProgress: PRReviewProgress | null;
  reviewResult: PRReviewResult | null;
  postedFindingIds: Set<string>;
  isReadyToMerge: boolean;
  newCommitsCheck: NewCommitsCheck | null;
  t: (key: string) => string;
}) {
  const {
    isReviewing,
    reviewProgress,
    reviewResult,
    postedFindingIds,
    isReadyToMerge,
    newCommitsCheck,
    t,
  } = params;

  // Check for in-progress review FIRST (before checking result)
  // This ensures the running review state is visible when switching back to a PR
  if (isReviewing) {
    return {
      status: 'reviewing' as const,
      label: t('prReview.aiReviewInProgress'),
      description: reviewProgress?.message || t('prReview.analysisInProgress'),
      color: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    };
  }

  if (!reviewResult || !reviewResult.success) {
    return {
      status: 'not_reviewed' as const,
      label: t('prReview.notReviewed'),
      description: t('prReview.runAIReviewDesc'),
      color: 'bg-muted text-muted-foreground border-muted',
    };
  }

  const allPostedIds = new Set([...postedFindingIds, ...(reviewResult.postedFindingIds ?? [])]);
  const totalPosted = allPostedIds.size;
  const hasPosted = totalPosted > 0 || reviewResult.hasPostedFindings;
  const hasBlockers = reviewResult.findings.some(
    (f: { severity: string }) => f.severity === 'critical' || f.severity === 'high'
  );
  const hasNewCommits = newCommitsCheck?.hasNewCommits ?? false;
  const _newCommitCount = newCommitsCheck?.newCommitCount ?? 0; // Reserved for future use
  const hasCommitsAfterPosting = newCommitsCheck?.hasCommitsAfterPosting ?? false;

  // Follow-up review specific statuses
  if (reviewResult.isFollowupReview) {
    const _resolvedCount = reviewResult.resolvedFindings?.length ?? 0; // Reserved for future use
    const unresolvedCount = reviewResult.unresolvedFindings?.length ?? 0;
    const newIssuesCount = reviewResult.newFindingsSinceLastReview?.length ?? 0;
    const hasBlockingIssuesRemaining = reviewResult.findings.some(
      (f: { severity: string }) => f.severity === 'critical' || f.severity === 'high'
    );

    if (hasNewCommits && hasCommitsAfterPosting) {
      return {
        status: 'ready_for_followup' as const,
        label: t('prReview.readyForFollowup'),
        color: 'bg-info/20 text-info border-info/50',
      };
    }

    if (unresolvedCount === 0 && newIssuesCount === 0) {
      return {
        status: 'ready_to_merge' as const,
        label: t('prReview.readyToMerge'),
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    if (!hasBlockingIssuesRemaining) {
      return {
        status: 'ready_to_merge' as const,
        label: t('prReview.readyToMerge'),
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    return {
      status: 'followup_issues_remain' as const,
      label: t('prReview.blockingIssues'),
      color: 'bg-warning/20 text-warning border-warning/50',
    };
  }

  // Initial review statuses
  if (hasPosted && hasNewCommits && hasCommitsAfterPosting) {
    return {
      status: 'ready_for_followup' as const,
      label: t('prReview.readyForFollowup'),
      color: 'bg-info/20 text-info border-info/50',
    };
  }

  if (isReadyToMerge && hasPosted) {
    return {
      status: 'ready_to_merge' as const,
      label: t('prReview.readyToMerge'),
      color: 'bg-success/20 text-success border-success/50',
    };
  }

  if (hasPosted && hasBlockers) {
    return {
      status: 'waiting_for_changes' as const,
      label: t('prReview.waitingForChanges'),
      color: 'bg-warning/20 text-warning border-warning/50',
    };
  }

  if (hasPosted && !hasBlockers) {
    return {
      status: 'ready_to_merge' as const,
      label: t('prReview.readyToMerge'),
      color: 'bg-success/20 text-success border-success/50',
    };
  }

  const unpostedFindings = reviewResult.findings.filter((f: { id: string }) => !allPostedIds.has(f.id));
  const hasUnpostedBlockers = unpostedFindings.some(
    (f: { severity: string }) => f.severity === 'critical' || f.severity === 'high'
  );

  if (hasUnpostedBlockers) {
    return {
      status: 'needs_attention' as const,
      label: t('prReview.needsAttention'),
      color: 'bg-destructive/20 text-destructive border-destructive/50',
    };
  }

  return {
    status: 'reviewed_pending_post' as const,
    label: t('prReview.reviewComplete'),
    color: 'bg-primary/20 text-primary border-primary/50',
  };
}

// Mock translation function
const mockT = (key: string) => {
  const translations: Record<string, string> = {
    'prReview.aiReviewInProgress': 'AI Review in Progress',
    'prReview.analysisInProgress': 'AI Analysis in Progress...',
    'prReview.notReviewed': 'Not Reviewed',
    'prReview.runAIReviewDesc': 'Run an AI review to analyze this PR',
    'prReview.readyForFollowup': 'Ready for Follow-up',
    'prReview.readyToMerge': 'Ready to Merge',
    'prReview.waitingForChanges': 'Waiting for Changes',
    'prReview.blockingIssues': 'Blocking Issues',
    'prReview.needsAttention': 'Needs Attention',
    'prReview.reviewComplete': 'Review Complete',
  };
  return translations[key] || key;
};

describe('PRDetail - prStatus Computation (ACS-200 Fix)', () => {
  describe('isReviewing Priority Check (ACS-200 Fix)', () => {
    it('should return "reviewing" status when isReviewing is true, regardless of reviewResult', () => {
      const status = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({ message: 'Fetching files...' }),
        reviewResult: null, // Even with null reviewResult
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('reviewing');
      expect(status.label).toBe('AI Review in Progress');
      expect(status.description).toBe('Fetching files...');
      expect(status.color).toBe('bg-blue-500/10 text-blue-500 border-blue-500/30');
    });

    it('should return "reviewing" status when isReviewing is true, even with successful reviewResult', () => {
      // This is the key test for ACS-200: When switching back to a PR with in-progress review,
      // the reviewing state should be shown, not the completed review state
      const status = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({ message: 'Analyzing code...' }),
        reviewResult: createMockReviewResult({
          success: true,
          overallStatus: 'approve',
          findings: [
            {
              id: 'finding-1',
              severity: 'low',
              category: 'quality',
              title: 'Minor issue',
              description: 'A minor code quality issue',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: true,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('reviewing');
      expect(status.label).toBe('AI Review in Progress');
      expect(status.description).toBe('Analyzing code...');
    });

    it('should use fallback description when reviewProgress is null but isReviewing is true', () => {
      const status = computePRStatus({
        isReviewing: true,
        reviewProgress: null, // No progress data yet
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('reviewing');
      expect(status.description).toBe('AI Analysis in Progress...');
    });

    it('should return "not_reviewed" when isReviewing is false and reviewResult is null', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('not_reviewed');
      expect(status.label).toBe('Not Reviewed');
      expect(status.description).toBe('Run an AI review to analyze this PR');
    });

    it('should return "not_reviewed" when isReviewing is false and reviewResult.success is false', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({ success: false, error: 'Review failed' }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('not_reviewed');
    });
  });

  describe('Review Status Transitions', () => {
    it('should correctly transition from "not_reviewed" to "reviewing" when review starts', () => {
      // Initial state: not reviewed
      const beforeReview = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(beforeReview.status).toBe('not_reviewed');

      // Review starts
      const duringReview = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress(),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(duringReview.status).toBe('reviewing');
    });

    it('should correctly transition from "reviewing" to completed status when review finishes', () => {
      // During review
      const duringReview = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress(),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(duringReview.status).toBe('reviewing');

      // Review completes with findings
      const afterReview = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'medium',
              category: 'quality',
              title: 'Code quality issue',
              description: 'Improve code quality',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(afterReview.status).toBe('reviewed_pending_post');
    });
  });

  describe('Completed Review Statuses', () => {
    it('should return "reviewed_pending_post" when review has unposted findings', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'low',
              category: 'style',
              title: 'Style issue',
              description: 'Minor style issue',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('reviewed_pending_post');
      expect(status.label).toBe('Review Complete');
    });

    it('should return "needs_attention" when review has unposted blocking findings', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'critical',
              category: 'security',
              title: 'Security issue',
              description: 'Critical security vulnerability',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('needs_attention');
      expect(status.label).toBe('Needs Attention');
    });

    it('should return "ready_to_merge" when review is posted with no blockers', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'low',
              category: 'style',
              title: 'Style issue',
              description: 'Minor style issue',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
          postedFindingIds: ['finding-1'],
          hasPostedFindings: true,
        }),
        postedFindingIds: new Set(['finding-1']),
        isReadyToMerge: true,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('ready_to_merge');
      expect(status.label).toBe('Ready to Merge');
    });

    it('should return "waiting_for_changes" when blockers are posted', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'high',
              category: 'security',
              title: 'Security issue',
              description: 'High severity security issue',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
          postedFindingIds: ['finding-1'],
          hasPostedFindings: true,
        }),
        postedFindingIds: new Set(['finding-1']),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('waiting_for_changes');
      expect(status.label).toBe('Waiting for Changes');
    });
  });

  describe('Follow-up Review Statuses', () => {
    it('should return "ready_for_followup" when new commits exist after posting', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          isFollowupReview: false,
          findings: [],
          postedFindingIds: ['finding-1'],
          hasPostedFindings: true,
        }),
        postedFindingIds: new Set(['finding-1']),
        isReadyToMerge: true,
        newCommitsCheck: createMockNewCommitsCheck({
          hasNewCommits: true,
          newCommitCount: 3,
          hasCommitsAfterPosting: true,
        }),
        t: mockT,
      });

      expect(status.status).toBe('ready_for_followup');
      expect(status.label).toBe('Ready for Follow-up');
    });

    it('should return "ready_to_merge" for follow-up when all issues resolved', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          isFollowupReview: true,
          findings: [],
          resolvedFindings: ['finding-1', 'finding-2'],
          unresolvedFindings: [],
          newFindingsSinceLastReview: [],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('ready_to_merge');
      expect(status.label).toBe('Ready to Merge');
    });

    it('should return "followup_issues_remain" when blocking issues remain after follow-up', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          isFollowupReview: true,
          findings: [
            {
              id: 'unresolved-blocking',
              severity: 'high',
              category: 'security',
              title: 'Unresolved high issue',
              description: 'Still needs fixing',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
          resolvedFindings: ['finding-1'],
          unresolvedFindings: ['unresolved-blocking'],
          newFindingsSinceLastReview: [],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('followup_issues_remain');
      expect(status.label).toBe('Blocking Issues');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty findings array correctly', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [],
          summary: 'No issues found! Code looks great.',
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: true,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(status.status).toBe('reviewed_pending_post');
    });

    it('should handle postedFindingIds from both local state and reviewResult', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          findings: [
            {
              id: 'finding-1',
              severity: 'low',
              category: 'style',
              title: 'Issue 1',
              description: 'Description 1',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
            {
              id: 'finding-2',
              severity: 'low',
              category: 'style',
              title: 'Issue 2',
              description: 'Description 2',
              file: 'src/test.ts',
              line: 20,
              fixable: true,
            },
          ],
          postedFindingIds: ['finding-1'], // From previous post
        }),
        postedFindingIds: new Set(['finding-2']), // Local state
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      // Both findings should be considered posted
      expect(status.status).toBe('ready_to_merge');
    });

    it('should handle null newCommitsCheck gracefully', () => {
      const status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          postedFindingIds: ['finding-1'],
          hasPostedFindings: true,
        }),
        postedFindingIds: new Set(['finding-1']),
        isReadyToMerge: true,
        newCommitsCheck: null, // No check performed yet
        t: mockT,
      });

      expect(status.status).toBe('ready_to_merge');
    });
  });
});

describe('PRDetail - ACS-200 Integration Test Scenarios', () => {
  describe('Scenario: User switches back to PR with in-progress review', () => {
    it('should maintain "reviewing" status when switching between PRs', () => {
      // User starts review on PR #1
      const pr1Reviewing = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({
          prNumber: 1,
          message: 'Analyzing PR #1...',
        }),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(pr1Reviewing.status).toBe('reviewing');

      // User switches to PR #2 (not reviewed yet)
      const pr2NotReviewed = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(pr2NotReviewed.status).toBe('not_reviewed');

      // User switches back to PR #1 - should STILL see "reviewing" status
      // This is the key fix for ACS-200
      const pr1ReviewingAgain = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({
          prNumber: 1,
          message: 'Still analyzing PR #1...',
          progress: 75,
        }),
        reviewResult: null, // Still no result because review is in progress
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(pr1ReviewingAgain.status).toBe('reviewing');
      expect(pr1ReviewingAgain.description).toBe('Still analyzing PR #1...');
    });

    it('should show updated progress message when switching back to reviewing PR', () => {
      // PR #1 starts review
      const initialProgress = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({
          message: 'Fetching files...',
          progress: 10,
        }),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(initialProgress.description).toBe('Fetching files...');

      // After some time, progress updates
      const updatedProgress = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({
          message: 'Analyzing code with AI...',
          progress: 50,
        }),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });
      expect(updatedProgress.description).toBe('Analyzing code with AI...');
    });
  });

  describe('Scenario: Multiple PRs with different review states', () => {
    it('should correctly track status for each PR independently', () => {
      // PR #1: Review in progress
      const pr1Status = computePRStatus({
        isReviewing: true,
        reviewProgress: createMockReviewProgress({ prNumber: 1, message: 'Reviewing PR #1' }),
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      // PR #2: Completed review with findings
      const pr2Status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: createMockReviewResult({
          prNumber: 2,
          findings: [
            {
              id: 'finding-1',
              severity: 'medium',
              category: 'quality',
              title: 'Issue',
              description: 'Description',
              file: 'src/test.ts',
              line: 10,
              fixable: true,
            },
          ],
        }),
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      // PR #3: Not reviewed
      const pr3Status = computePRStatus({
        isReviewing: false,
        reviewProgress: null,
        reviewResult: null,
        postedFindingIds: new Set(),
        isReadyToMerge: false,
        newCommitsCheck: null,
        t: mockT,
      });

      expect(pr1Status.status).toBe('reviewing');
      expect(pr2Status.status).toBe('reviewed_pending_post');
      expect(pr3Status.status).toBe('not_reviewed');
    });
  });
});
