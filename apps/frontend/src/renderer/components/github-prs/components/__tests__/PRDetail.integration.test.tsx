/**
 * Integration tests for PRDetail clean review state reset on PR change
 * Tests that cleanReviewPosted state resets when pr.number changes
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../../../shared/i18n';
import { PRDetail } from '../PRDetail';
import type { PRData, PRReviewResult } from '../../hooks/useGitHubPRs';
import type { NewCommitsCheck } from '../../../../../preload/api/modules/github-api';

// Mock window.electronAPI
type PostCommentFn = (body: string) => Promise<boolean>;
const mockOnPostComment = vi.fn<PostCommentFn>().mockResolvedValue(true);
const mockOnPostReview = vi.fn();
const mockOnRunReview = vi.fn();
const mockOnRunFollowupReview = vi.fn();
const mockOnCheckNewCommits = vi.fn();
const mockOnCancelReview = vi.fn();
const mockOnMergePR = vi.fn();
const mockOnAssignPR = vi.fn();
const mockOnGetLogs = vi.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    github: {
      getWorkflowsAwaitingApproval: vi.fn().mockResolvedValue({
        awaiting_approval: 0,
        workflow_runs: []
      }),
      checkMergeReadiness: vi.fn().mockResolvedValue({
        blockers: []
      }),
      onPRLogsUpdated: vi.fn().mockReturnValue(() => {})
    }
  }
});

// Create a mock PR data
function createMockPR(overrides: Partial<PRData> = {}): PRData {
  return {
    number: 123,
    title: 'Test PR',
    body: 'Test PR body',
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
    ...overrides
  };
}

// Create a mock clean review result
function createMockCleanReviewResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    prNumber: 123,
    repo: 'test/repo',
    success: true,
    overallStatus: 'approve',
    summary: 'All code passes review. No issues found.',
    findings: [],
    reviewedAt: '2024-01-01T00:00:00Z',
    reviewedCommitSha: 'abc123',
    ...overrides
  };
}

// Wrapper component for i18n
function I18nWrapper({ children }: { children: React.ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe('PRDetail - Clean Review State Reset Integration', () => {
  const mockProjectId = 'test-project-id';

  // Helper function to render PRDetail with common default props
  function renderPRDetail(overrides: {
    pr?: PRData;
    reviewResult?: PRReviewResult;
    onPostComment?: PostCommentFn;
  } = {}) {
    const defaultPR = createMockPR({ number: 123 });
    const defaultReviewResult = createMockCleanReviewResult();

    return render(
      <I18nWrapper>
        <PRDetail
          pr={overrides.pr ?? defaultPR}
          projectId={mockProjectId}
          reviewResult={overrides.reviewResult ?? defaultReviewResult}
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={false}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={mockOnRunFollowupReview}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={overrides.onPostComment ?? mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock return values
    mockOnGetLogs.mockResolvedValue(null);
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: false,
      hasCommitsAfterPosting: false,
      newCommitCount: 0
    });
    // Resolve successfully by default
    mockOnPostComment.mockResolvedValue(true);
  });

  it('should reset cleanReviewPosted state when pr.number changes', async () => {
    const initialPR = createMockPR({ number: 123 });
    const cleanReviewResult = createMockCleanReviewResult();

    const { rerender, unmount } = renderPRDetail({
      pr: initialPR,
      reviewResult: cleanReviewResult
    });

    // The "Post Clean Review" button should be visible initially
    const postCleanReviewButton = screen.getByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButton).toBeInTheDocument();

    // Click the button to post clean review
    fireEvent.click(postCleanReviewButton);

    // Wait for success message to appear (confirms cleanReviewPosted is true)
    await waitFor(() => {
      expect(screen.getByText(/clean review posted/i)).toBeInTheDocument();
    });

    // Button should be hidden after posting
    expect(screen.queryByRole('button', { name: /post clean review/i })).not.toBeInTheDocument();

    // Rerender with a different PR (number 456)
    const differentPR = createMockPR({ number: 456 });
    rerender(
      <I18nWrapper>
        <PRDetail
          pr={differentPR}
          projectId={mockProjectId}
          reviewResult={cleanReviewResult}
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={false}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={mockOnRunFollowupReview}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );

    // After PR change, the "Post Clean Review" button should be visible again
    // because cleanReviewPosted state was reset by useEffect when pr.number changed
    const postCleanReviewButtonAfterChange = screen.queryByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButtonAfterChange).toBeInTheDocument();
    unmount();
  }, 15000); // Increased timeout for slower CI environments (Windows)

  it('should show clean review success message after posting clean review', async () => {
    const { unmount } = renderPRDetail();

    // Initially, the success message should not be present
    const successMessage = screen.queryByText(/clean review posted/i);
    expect(successMessage).not.toBeInTheDocument();

    // The "Post Clean Review" button should be visible
    const postCleanReviewButton = screen.getByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButton).toBeInTheDocument();

    // Click the button to post clean review
    fireEvent.click(postCleanReviewButton);

    // Wait for success message to appear
    await waitFor(() => {
      expect(screen.getByText(/clean review posted/i)).toBeInTheDocument();
    });

    // Button should be hidden after posting
    expect(screen.queryByRole('button', { name: /post clean review/i })).not.toBeInTheDocument();

    unmount();
  });

  it('should not show Post Clean Review button when review has HIGH severity findings', async () => {
    const reviewWithHighFindings: PRReviewResult = {
      prNumber: 123,
      repo: 'test/repo',
      success: true,
      overallStatus: 'request_changes',
      summary: 'Found high severity issues.',
      reviewedAt: '2024-01-01T00:00:00Z',
      findings: [
        {
          id: 'finding-1',
          severity: 'high',
          category: 'security',
          title: 'Security Issue',
          file: 'src/test.ts',
          line: 10,
          description: 'High severity issue',
          fixable: true
        }
      ],
      reviewedCommitSha: 'abc123'
    };

    const { unmount } = renderPRDetail({ reviewResult: reviewWithHighFindings });

    // The "Post Clean Review" button should NOT be visible for dirty reviews
    const postCleanReviewButton = screen.queryByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButton).not.toBeInTheDocument();

    unmount();
  });

  it('should show correct button state based on review cleanliness', async () => {
    const cleanReviewResult = createMockCleanReviewResult();
    const initialPR = createMockPR({ number: 123 });

    // Test 1: Clean review (no findings)
    const { rerender, unmount } = renderPRDetail({
      pr: initialPR,
      reviewResult: cleanReviewResult
    });

    // Clean review: Post Clean Review button should be visible
    const postCleanReviewButton = screen.queryByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButton).toBeInTheDocument();

    // Test 2: Dirty review (HIGH findings)
    const dirtyReviewResult: PRReviewResult = {
      prNumber: 123,
      repo: 'test/repo',
      success: true,
      overallStatus: 'request_changes',
      summary: 'Found issues.',
      reviewedAt: '2024-01-01T00:00:00Z',
      findings: [
        {
          id: 'finding-1',
          severity: 'high',
          category: 'security',
          title: 'Security Issue',
          file: 'src/test.ts',
          line: 10,
          description: 'High severity issue',
          fixable: true
        }
      ],
      reviewedCommitSha: 'abc123'
    };

    rerender(
      <I18nWrapper>
        <PRDetail
          pr={initialPR}
          projectId={mockProjectId}
          reviewResult={dirtyReviewResult}
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={false}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={mockOnRunFollowupReview}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );

    // Dirty review: Post Clean Review button should NOT be visible
    const postCleanReviewButtonDirty = screen.queryByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButtonDirty).not.toBeInTheDocument();

    unmount();
  });

  it('should show error message when posting clean review fails', async () => {
    // Mock onPostComment to reject
    const testError = new Error('Failed to post comment: Rate limit exceeded');
    mockOnPostComment.mockRejectedValue(testError);

    const { unmount } = renderPRDetail({
      onPostComment: mockOnPostComment
    });

    // The "Post Clean Review" button should be visible initially
    const postCleanReviewButton = screen.getByRole('button', { name: /post clean review/i });
    expect(postCleanReviewButton).toBeInTheDocument();

    // Click the button to attempt posting clean review
    fireEvent.click(postCleanReviewButton);

    // Wait for normalized error message to appear (shows friendly message, not raw error)
    await waitFor(() => {
      expect(screen.getByText(/Failed to post clean review/i)).toBeInTheDocument();
    });

    // "View details" button should be available
    await waitFor(() => {
      expect(screen.getByText(/View details/i)).toBeInTheDocument();
    });

    // Button should still be visible for retry after error
    expect(screen.queryByRole('button', { name: /post clean review/i })).toBeInTheDocument();

    // Success message should NOT be shown
    expect(screen.queryByText(/clean review posted/i)).not.toBeInTheDocument();

    unmount();
  });
});

/**
 * Integration tests for PRDetail follow-up review trigger
 * Tests that follow-up review is correctly triggered when new commits are detected
 * after findings have been posted to GitHub
 */
describe('PRDetail - Follow-up Review Trigger Integration', () => {
  const mockProjectId = 'test-project-id';

  // Helper function to create a mock review result with posted findings
  function createMockPostedReviewResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
    return {
      prNumber: 123,
      repo: 'test/repo',
      success: true,
      overallStatus: 'request_changes',
      summary: 'Found issues that need attention.',
      findings: [
        {
          id: 'finding-1',
          severity: 'high',
          category: 'security',
          title: 'Security Issue',
          file: 'src/test.ts',
          line: 10,
          description: 'High severity security issue',
          fixable: true
        }
      ],
      reviewedAt: '2024-01-01T00:00:00Z',
      reviewedCommitSha: 'abc123',
      postedFindingIds: ['finding-1'],
      hasPostedFindings: true,
      postedAt: '2024-01-01T01:00:00Z',
      ...overrides
    };
  }

  // Helper function to render PRDetail with all props for follow-up review tests
  function renderPRDetailForFollowup(overrides: {
    pr?: PRData;
    reviewResult?: PRReviewResult;
    initialNewCommitsCheck?: NewCommitsCheck | null;
    isReviewing?: boolean;
    onRunFollowupReview?: () => void;
  } = {}) {
    const defaultPR = createMockPR({ number: 123 });
    const defaultReviewResult = createMockPostedReviewResult();
    const defaultNewCommitsCheck = overrides.initialNewCommitsCheck ?? null;
    const onRunFollowupReviewMock = overrides.onRunFollowupReview ?? mockOnRunFollowupReview;

    return render(
      <I18nWrapper>
        <PRDetail
          pr={overrides.pr ?? defaultPR}
          projectId={mockProjectId}
          reviewResult={overrides.reviewResult ?? defaultReviewResult}
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={overrides.isReviewing ?? false}
          initialNewCommitsCheck={defaultNewCommitsCheck}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={onRunFollowupReviewMock}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock return values
    mockOnGetLogs.mockResolvedValue(null);
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: false,
      hasCommitsAfterPosting: false,
      newCommitCount: 0
    });
    mockOnPostComment.mockResolvedValue(true);
  });

  it('should display "Ready for Follow-up" status when new commits exist after posting', async () => {
    const reviewResult = createMockPostedReviewResult();

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: true
      }
    });

    // Wait for the status tree to render with "Ready for Follow-up" status
    await waitFor(() => {
      expect(screen.getByText(/ready for follow-up/i)).toBeInTheDocument();
    });

    unmount();
  });

  it('should show "Run Follow-up" button when new commits overlap with findings', async () => {
    const reviewResult = createMockPostedReviewResult();

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 3,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: true
      }
    });

    // Wait for the "Run Follow-up" button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run follow-up/i })).toBeInTheDocument();
    });

    unmount();
  });

  it('should call onRunFollowupReview when "Run Follow-up" button is clicked', async () => {
    const reviewResult = createMockPostedReviewResult();

    // Mock checkNewCommits to return consistent result
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: true,
      newCommitCount: 2,
      hasCommitsAfterPosting: true,
      hasOverlapWithFindings: true,
      lastReviewedCommit: 'abc123' // Match reviewedCommitSha to prevent additional API call
    });

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: true,
        lastReviewedCommit: 'abc123' // Prevents redundant checkNewCommits call
      }
    });

    // Wait for the "Run Follow-up" button to appear
    const followupButton = await screen.findByRole('button', { name: /run follow-up/i });
    expect(followupButton).toBeInTheDocument();

    // Click the button
    fireEvent.click(followupButton);

    // Verify the callback was called
    expect(mockOnRunFollowupReview).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should NOT show follow-up prompt when hasCommitsAfterPosting is false', async () => {
    const reviewResult = createMockPostedReviewResult();

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: false // New commits exist but before posting
      }
    });

    // The "Run Follow-up" button should NOT be visible
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /run follow-up/i })).not.toBeInTheDocument();
    });

    // Should show "Waiting for Changes" instead since blockers are posted but no new commits after posting
    await waitFor(() => {
      expect(screen.getByText(/waiting for changes/i)).toBeInTheDocument();
    });

    unmount();
  });

  it('should NOT show follow-up prompt when findings have not been posted', async () => {
    // Review with findings but NOT posted
    const reviewResult: PRReviewResult = {
      prNumber: 123,
      repo: 'test/repo',
      success: true,
      overallStatus: 'request_changes',
      summary: 'Found issues.',
      findings: [
        {
          id: 'finding-1',
          severity: 'high',
          category: 'security',
          title: 'Security Issue',
          file: 'src/test.ts',
          line: 10,
          description: 'High severity issue',
          fixable: true
        }
      ],
      reviewedAt: '2024-01-01T00:00:00Z',
      reviewedCommitSha: 'abc123',
      hasPostedFindings: false, // NOT posted
      postedFindingIds: []
    };

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true
      }
    });

    // The "Run Follow-up" button should NOT be visible since findings weren't posted
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /run follow-up/i })).not.toBeInTheDocument();
    });

    // Should show "Needs Attention" since there are unposted blockers
    await waitFor(() => {
      expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
    });

    unmount();
  });

  it('should update follow-up status when newCommitsCheck changes via props', async () => {
    const reviewResult = createMockPostedReviewResult();

    // Mock checkNewCommits to return no new commits initially
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: false,
      newCommitCount: 0,
      hasCommitsAfterPosting: false,
      lastReviewedCommit: 'abc123'
    });

    // Start without new commits
    const { rerender, unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: false,
        newCommitCount: 0,
        hasCommitsAfterPosting: false,
        lastReviewedCommit: 'abc123'
      }
    });

    // Should show "Waiting for Changes" initially
    await waitFor(() => {
      expect(screen.getByText(/waiting for changes/i)).toBeInTheDocument();
    });

    // No follow-up button initially
    expect(screen.queryByRole('button', { name: /run follow-up/i })).not.toBeInTheDocument();

    // Update mock before rerender
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: true,
      newCommitCount: 3,
      hasCommitsAfterPosting: true,
      hasOverlapWithFindings: true,
      lastReviewedCommit: 'abc123'
    });

    // Rerender with new commits detected
    rerender(
      <I18nWrapper>
        <PRDetail
          pr={createMockPR({ number: 123 })}
          projectId={mockProjectId}
          reviewResult={reviewResult}
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={false}
          initialNewCommitsCheck={{
            hasNewCommits: true,
            newCommitCount: 3,
            hasCommitsAfterPosting: true,
            hasOverlapWithFindings: true,
            lastReviewedCommit: 'abc123'
          }}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={mockOnRunFollowupReview}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );

    // Now should show "Ready for Follow-up" status
    await waitFor(() => {
      expect(screen.getByText(/ready for follow-up/i)).toBeInTheDocument();
    });

    // Follow-up button should now be visible
    const followupButton = await screen.findByRole('button', { name: /run follow-up/i });
    expect(followupButton).toBeInTheDocument();

    unmount();
  });

  it('should show "Verify" option when new commits have no overlap with findings', async () => {
    const reviewResult = createMockPostedReviewResult();

    // Mock checkNewCommits to return result with no overlap
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: true,
      newCommitCount: 2,
      hasCommitsAfterPosting: true,
      hasOverlapWithFindings: false,
      lastReviewedCommit: 'abc123'
    });

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: false, // No overlap - safe commits
        lastReviewedCommit: 'abc123'
      }
    });

    // Should show "Verify" button for optional follow-up (translation key: verifyAnyway)
    const verifyButton = await screen.findByRole('button', { name: /^verify$/i });
    expect(verifyButton).toBeInTheDocument();

    unmount();
  });

  it('should call onRunFollowupReview when "Verify" button is clicked', async () => {
    const reviewResult = createMockPostedReviewResult();

    // Mock checkNewCommits to return result with no overlap
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: true,
      newCommitCount: 2,
      hasCommitsAfterPosting: true,
      hasOverlapWithFindings: false,
      lastReviewedCommit: 'abc123'
    });

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: false,
        lastReviewedCommit: 'abc123'
      }
    });

    // Wait for the "Verify" button and click it
    const verifyButton = await screen.findByRole('button', { name: /^verify$/i });
    fireEvent.click(verifyButton);

    // Verify the callback was called
    expect(mockOnRunFollowupReview).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should NOT show follow-up prompt during active review', async () => {
    const reviewResult = createMockPostedReviewResult();

    // Mock checkNewCommits - won't be called during active review anyway
    mockOnCheckNewCommits.mockResolvedValue({
      hasNewCommits: true,
      newCommitCount: 2,
      hasCommitsAfterPosting: true,
      hasOverlapWithFindings: true,
      lastReviewedCommit: 'abc123'
    });

    const { unmount } = renderPRDetailForFollowup({
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: true,
        lastReviewedCommit: 'abc123'
      },
      isReviewing: true // Review in progress
    });

    // Should show "AI Review in Progress" status - may appear multiple times (title + badge)
    // Use getAllByText to handle multiple occurrences
    await waitFor(() => {
      const reviewingElements = screen.getAllByText(/ai review in progress/i);
      expect(reviewingElements.length).toBeGreaterThan(0);
    });

    // Follow-up button should NOT be visible during active review
    expect(screen.queryByRole('button', { name: /run follow-up/i })).not.toBeInTheDocument();

    unmount();
  });

  it('should reset follow-up state when PR changes', async () => {
    const reviewResult = createMockPostedReviewResult();

    const { rerender, unmount } = renderPRDetailForFollowup({
      pr: createMockPR({ number: 123 }),
      reviewResult,
      initialNewCommitsCheck: {
        hasNewCommits: true,
        newCommitCount: 2,
        hasCommitsAfterPosting: true,
        hasOverlapWithFindings: true
      }
    });

    // Should show follow-up status for PR 123
    await waitFor(() => {
      expect(screen.getByText(/ready for follow-up/i)).toBeInTheDocument();
    });

    // Switch to a different PR that hasn't been reviewed
    const newPR = createMockPR({ number: 456 });
    rerender(
      <I18nWrapper>
        <PRDetail
          pr={newPR}
          projectId={mockProjectId}
          reviewResult={null} // No review for new PR
          previousReviewResult={null}
          reviewProgress={null}
          startedAt={null}
          isReviewing={false}
          initialNewCommitsCheck={null}
          onRunReview={mockOnRunReview}
          onRunFollowupReview={mockOnRunFollowupReview}
          onCheckNewCommits={mockOnCheckNewCommits}
          onCancelReview={mockOnCancelReview}
          onPostReview={mockOnPostReview}
          onPostComment={mockOnPostComment}
          onMergePR={mockOnMergePR}
          onAssignPR={mockOnAssignPR}
          onGetLogs={mockOnGetLogs}
        />
      </I18nWrapper>
    );

    // Should now show "Not Reviewed" for the new PR
    await waitFor(() => {
      expect(screen.getByText(/not reviewed/i)).toBeInTheDocument();
    });

    // Follow-up button should not be visible for unreviewed PR
    expect(screen.queryByRole('button', { name: /run follow-up/i })).not.toBeInTheDocument();

    unmount();
  });
});
