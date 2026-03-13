/**
 * Unit tests for PRDetail clean review functionality
 * Tests the "Post Clean Review" button visibility and behavior
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types for PR review data
interface PRReviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  file: string;
  line: number;
  description: string;
  suggestedFix?: string;
}

interface PRReviewResult {
  success: boolean;
  overallStatus: 'approve' | 'request_changes' | 'comment';
  summary: string;
  findings: PRReviewFinding[];
  reviewedCommitSha: string | null;
  postedAt?: string;
  postedFindingIds?: string[];
  hasPostedFindings?: boolean;
  isFollowupReview?: boolean;
  resolvedFindings?: PRReviewFinding[];
  unresolvedFindings?: PRReviewFinding[];
  newFindingsSinceLastReview?: PRReviewFinding[];
}

// Helper to create test review results
function createReviewResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    success: true,
    overallStatus: 'approve',
    summary: 'Code review completed successfully. No issues found.',
    findings: [],
    reviewedCommitSha: 'abc123',
    ...overrides
  };
}

function createTestFinding(severity: PRReviewFinding['severity'], id: string = 'finding-1'): PRReviewFinding {
  return {
    id,
    severity,
    category: 'quality',
    file: 'src/test.ts',
    line: 10,
    description: `Test ${severity} severity issue`
  };
}

describe('PRDetail Clean Review Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * NOTE: These tests verify the core ALGORITHM (isCleanReview logic, button visibility conditions).
   *
   * The actual React component behavior (rendering, user interactions, useEffect hooks) is tested
   * in PRDetail.integration.test.tsx. These algorithm tests provide rapid feedback on logic
   * changes but duplicate the implementation expressions. If the component logic changes,
   * these tests must be updated to match.
   *
   * Alternative: Export isCleanReview as a pure function for direct testing.
   */
  describe('isCleanReview Logic', () => {
    it('should return true for review with no findings', () => {
      const reviewResult = createReviewResult({
        findings: []
      });

      // isCleanReview logic: success && no critical/high/medium findings
      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(true);
      expect(reviewResult.findings).toHaveLength(0);
    });

    it('should return true for review with only LOW severity findings', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('low', 'low-1'),
          createTestFinding('low', 'low-2'),
          createTestFinding('low', 'low-3')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(true);
      expect(reviewResult.findings).toHaveLength(3);
    });

    it('should return false for review with MEDIUM severity findings', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('low', 'low-1'),
          createTestFinding('medium', 'medium-1')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(false);
    });

    it('should return false for review with HIGH severity findings', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('low', 'low-1'),
          createTestFinding('high', 'high-1')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(false);
    });

    it('should return false for review with CRITICAL severity findings', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('critical', 'critical-1')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(false);
    });

    it('should return false for failed review', () => {
      const reviewResult = createReviewResult({
        success: false,
        findings: []
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(false);
    });
  });

  describe('Post Clean Review Button Visibility', () => {
    it('should show button when: review success, no findings selected, clean review, not posted, not request_changes', () => {
      const reviewResult = createReviewResult({
        findings: []
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      // Button visibility conditions
      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(true);
    });

    it('should NOT show button when findings are selected', () => {
      const reviewResult = createReviewResult({
        findings: [createTestFinding('low')]
      });

      const selectedCount: number = 1; // Finding selected
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should NOT show button when review has MEDIUM severity findings', () => {
      const reviewResult = createReviewResult({
        findings: [createTestFinding('medium')]
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should NOT show button when findings have already been posted', () => {
      const reviewResult = createReviewResult({
        findings: []
      });

      const selectedCount = 0;
      const hasPostedFindings = true; // Already posted
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should NOT show button when clean review has been posted', () => {
      const reviewResult = createReviewResult({
        findings: []
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = true; // Already posted clean review

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should NOT show button when overallStatus is request_changes', () => {
      const reviewResult = createReviewResult({
        findings: [],
        overallStatus: 'request_changes'
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should NOT show button when review failed', () => {
      const reviewResult = createReviewResult({
        success: false,
        findings: []
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });
  });

  describe('Post Clean Review vs Post Findings Button Mutual Exclusivity', () => {
    it('should show "Post Findings" button when findings are selected', () => {
      const reviewResult = createReviewResult({
        findings: [createTestFinding('low')]
      });

      const selectedCount: number = 1;

      // Post Findings button: selectedCount > 0
      const showPostFindings = selectedCount > 0;

      // Post Clean Review button: selectedCount === 0 && other conditions
      const showPostCleanReview =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(showPostFindings).toBe(true);
      expect(showPostCleanReview).toBe(false);
    });

    it('should show "Post Clean Review" button when no findings are selected and review is clean', () => {
      const reviewResult = createReviewResult({
        findings: []
      });

      const selectedCount = 0;

      const showPostFindings = selectedCount > 0;

      const showPostCleanReview =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(showPostFindings).toBe(false);
      expect(showPostCleanReview).toBe(true);
    });

    it('should show neither button when no findings exist and none selected but review is not clean', () => {
      const reviewResult = createReviewResult({
        findings: [createTestFinding('high')]
      });

      const selectedCount = 0;

      const showPostFindings = selectedCount > 0;

      const showPostCleanReview =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(showPostFindings).toBe(false);
      expect(showPostCleanReview).toBe(false);
    });
  });

  describe('Clean Review Comment Format', () => {
    it('should format clean review comment correctly', () => {
      const reviewResult = createReviewResult({
        summary: 'All code passes review. No issues found.'
      });

      const cleanReviewMessage = `## ✅ Aperant PR Review - PASSED

**Status:** All code is good

${reviewResult.summary}

---

*This automated review found no issues. Generated by Aperant.*`;

      expect(cleanReviewMessage).toContain('## ✅ Aperant PR Review - PASSED');
      expect(cleanReviewMessage).toContain('**Status:** All code is good');
      expect(cleanReviewMessage).toContain(reviewResult.summary);
      expect(cleanReviewMessage).toContain('*This automated review found no issues. Generated by Aperant.*');
    });

    it('should include custom summary in clean review comment', () => {
      const customSummary = 'Review completed: 5 files checked, 0 issues found. Code follows best practices.';
      const reviewResult = createReviewResult({
        summary: customSummary
      });

      const cleanReviewMessage = `## ✅ Aperant PR Review - PASSED

**Status:** All code is good

${reviewResult.summary}

---

*This automated review found no issues. Generated by Aperant.*`;

      expect(cleanReviewMessage).toContain(customSummary);
    });

    it('should handle empty summary gracefully', () => {
      const reviewResult = createReviewResult({
        summary: ''
      });

      const cleanReviewMessage = `## ✅ Aperant PR Review - PASSED

**Status:** All code is good

${reviewResult.summary}

---

*This automated review found no issues. Generated by Aperant.*`;

      expect(cleanReviewMessage).toBeDefined();
      expect(cleanReviewMessage).toContain('All code is good');
    });
  });

  describe('Follow-up Review Scenarios', () => {
    it('should show clean review button for follow-up with all issues resolved', () => {
      const reviewResult = createReviewResult({
        isFollowupReview: true,
        findings: [], // No new issues from follow-up
        resolvedFindings: [createTestFinding('high', 'resolved-1')],
        unresolvedFindings: [],
        newFindingsSinceLastReview: []
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(true);
    });

    it('should not show clean review button for follow-up with unresolved HIGH issues', () => {
      const reviewResult = createReviewResult({
        isFollowupReview: true,
        findings: [createTestFinding('high', 'unresolved-1')],
        unresolvedFindings: [createTestFinding('high', 'unresolved-1')],
        newFindingsSinceLastReview: []
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });

    it('should not show clean review button for follow-up with new issues found', () => {
      const reviewResult = createReviewResult({
        isFollowupReview: true,
        findings: [createTestFinding('high', 'new-1')],
        newFindingsSinceLastReview: [createTestFinding('high', 'new-1')]
      });

      const selectedCount = 0;
      const hasPostedFindings = false;
      const cleanReviewPosted = false;

      const shouldShowButton =
        selectedCount === 0 &&
        reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        ) &&
        !hasPostedFindings &&
        !cleanReviewPosted &&
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(false);
    });
  });

  /**
   * NOTE: These tests verify the STATE RESET ALGORITHM with plain JavaScript if-statements.
   *
   * The actual React useEffect hook behavior is tested in PRDetail.integration.test.tsx
   * via component rerendering. These algorithm tests provide rapid feedback on the
   * reset logic but don't verify the hook triggers correctly on PR changes.
   */
  describe('State Reset on PR Change', () => {
    it('should reset cleanReviewPosted state when pr.number changes', () => {
      // Simplified logic test - actual useEffect behavior tested in integration tests
      let prNumber = 123;
      let cleanReviewPosted = true;

      // Simulate the useEffect reset when pr.number changes
      const currentPrNumber = prNumber;
      const newPrNumber = 456;

      if (currentPrNumber !== newPrNumber) {
        cleanReviewPosted = false;
        prNumber = newPrNumber;
      }

      expect(cleanReviewPosted).toBe(false);
      expect(prNumber).toBe(456);
    });

    it('should not reset cleanReviewPosted state when pr.number stays the same', () => {
      let prNumber = 123;
      let cleanReviewPosted = true;

      // Simulate no change in pr.number
      const currentPrNumber = prNumber;
      const newPrNumber = 123;

      if (currentPrNumber !== newPrNumber) {
        cleanReviewPosted = false;
        prNumber = newPrNumber;
      }

      expect(cleanReviewPosted).toBe(true);
      expect(prNumber).toBe(123);
    });
  });

  describe('Success Message Display', () => {
    it('should show clean review posted message when cleanReviewPosted is true', () => {
      const postSuccess = null;
      const cleanReviewPosted = true;

      // From implementation: {cleanReviewPosted && !postSuccess && (...)}
      const showCleanReviewMessage = cleanReviewPosted && !postSuccess;
      // From implementation: {postSuccess && (...)}
      const showPostFindingsMessage = !!postSuccess;

      expect(showCleanReviewMessage).toBe(true);
      expect(showPostFindingsMessage).toBe(false);
    });

    it('should show posted findings message when postSuccess is set', () => {
      const postSuccess = { count: 3, timestamp: Date.now() };
      const cleanReviewPosted = false;

      const showCleanReviewMessage = cleanReviewPosted && !postSuccess;
      const showPostFindingsMessage = !!postSuccess;

      expect(showCleanReviewMessage).toBe(false);
      expect(showPostFindingsMessage).toBe(true);
    });

    it('should prioritize posted findings message when both are set', () => {
      const postSuccess = { count: 2, timestamp: Date.now() };
      const cleanReviewPosted = true;

      // Implementation: postSuccess takes priority (first condition checked)
      const showCleanReviewMessage = cleanReviewPosted && !postSuccess;
      const showPostFindingsMessage = !!postSuccess;

      expect(showCleanReviewMessage).toBe(false);
      expect(showPostFindingsMessage).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle review with only LOW findings as clean', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('low', 'low-1'),
          createTestFinding('low', 'low-2')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(true);
      expect(reviewResult.findings.length).toBe(2);
    });

    it('should handle mixed severity with LOW and MEDIUM as not clean', () => {
      const reviewResult = createReviewResult({
        findings: [
          createTestFinding('low', 'low-1'),
          createTestFinding('medium', 'medium-1')
        ]
      });

      const isCleanReview = reviewResult.success &&
        !reviewResult.findings.some(f =>
          f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
        );

      expect(isCleanReview).toBe(false);
    });

    it('should handle overallStatus comment correctly', () => {
      const reviewResult = createReviewResult({
        overallStatus: 'comment',
        findings: []
      });

      const shouldShowButton =
        reviewResult.overallStatus !== 'request_changes';

      expect(shouldShowButton).toBe(true);
    });
  });
});
