import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Send,
  XCircle,
  Loader2,
  GitBranch,
  GitMerge,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  MessageSquare,
  FileText,
  ExternalLink,
  Play,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { Progress } from '../../ui/progress';

// Local components
import { CollapsibleCard } from './CollapsibleCard';
import { ReviewStatusTree } from './ReviewStatusTree';
import { PRHeader } from './PRHeader';
import { ReviewFindings } from './ReviewFindings';
import { PRLogs } from './PRLogs';

import type { PRData, PRReviewResult, PRReviewProgress } from '../hooks/useGitHubPRs';
import type { NewCommitsCheck, MergeReadiness, PRLogs as PRLogsType, WorkflowsAwaitingApprovalResult } from '../../../../preload/api/modules/github-api';
import { usePRReviewStore } from '../../../stores/github';

interface PRDetailProps {
  pr: PRData;
  projectId: string;
  reviewResult: PRReviewResult | null;
  previousReviewResult: PRReviewResult | null;
  reviewProgress: PRReviewProgress | null;
  startedAt: string | null;
  isReviewing: boolean;
  isExternalReview?: boolean;
  reviewError?: string | null;
  initialNewCommitsCheck?: NewCommitsCheck | null;
  isActive?: boolean;
  isLoadingFiles?: boolean;
  onRunReview: () => void;
  onRunFollowupReview: () => void;
  onCheckNewCommits: () => Promise<NewCommitsCheck>;
  onCancelReview: () => void;
  onPostReview: (selectedFindingIds?: string[], options?: { forceApprove?: boolean }) => Promise<boolean>;
  onPostComment: (body: string) => Promise<boolean>;
  onMergePR: (mergeMethod?: 'merge' | 'squash' | 'rebase') => void;
  onAssignPR: (username: string) => void;
  onGetLogs: () => Promise<PRLogsType | null>;
  onMarkReviewPosted?: (prNumber: number) => Promise<void>;
}

function getStatusColor(status: PRReviewResult['overallStatus']): string {
  switch (status) {
    case 'approve':
      return 'bg-success/20 text-success border-success/50';
    case 'request_changes':
      return 'bg-destructive/20 text-destructive border-destructive/50';
    default:
      return 'bg-muted';
  }
}

export function PRDetail({
  pr,
  projectId,
  reviewResult,
  previousReviewResult,
  reviewProgress,
  startedAt,
  isReviewing,
  isExternalReview = false,
  reviewError: reviewErrorProp,
  initialNewCommitsCheck,
  isActive: _isActive = false,
  isLoadingFiles = false,
  onRunReview,
  onRunFollowupReview,
  onCheckNewCommits,
  onCancelReview,
  onPostReview,
  onPostComment,
  onMergePR,
  onAssignPR: _onAssignPR,
  onGetLogs,
  onMarkReviewPosted,
}: PRDetailProps) {
  const { t } = useTranslation('common');
  // Selection state for findings
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());
  const [postedFindingIds, setPostedFindingIds] = useState<Set<string>>(new Set());
  const [isPostingFindings, setIsPostingFindings] = useState(false);
  const [postSuccess, setPostSuccess] = useState<{ count: number; timestamp: number } | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [isPostingCleanReview, setIsPostingCleanReview] = useState(false);
  const [cleanReviewPosted, setCleanReviewPosted] = useState(false);
  const [cleanReviewError, setCleanReviewError] = useState<string | null>(null);
  const [showCleanReviewErrorDetails, setShowCleanReviewErrorDetails] = useState(false);
  // Blocked status posting state (for BLOCKED/NEEDS_REVISION verdicts with no findings)
  const [isPostingBlockedStatus, setIsPostingBlockedStatus] = useState(false);
  const [blockedStatusPosted, setBlockedStatusPosted] = useState(false);
  const [blockedStatusError, setBlockedStatusError] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  // Initialize with store value, then sync and update via local checks
  const [newCommitsCheck, setNewCommitsCheck] = useState<NewCommitsCheck | null>(initialNewCommitsCheck ?? null);
  const [analysisExpanded, setAnalysisExpanded] = useState(true);
  const checkNewCommitsAbortRef = useRef<AbortController | null>(null);
  // Ref to track checking state without causing callback recreation
  const isCheckingNewCommitsRef = useRef(false);
  // ========================================================================
  // PR Review Logs State
  // ========================================================================
  // Logs provide real-time visibility into the AI review process through
  // a hybrid push/pull architecture:
  //
  // Backend (PRLogCollector in pr-handlers.ts):
  //   - Writes logs to disk every 3 entries: .auto-claude/github/pr/logs_${prNumber}.json
  //   - Emits GITHUB_PR_LOGS_UPDATED IPC events after each save
  //   - Tracks phase status: pending → active → completed/failed
  //
  // Frontend (this component):
  //   - Subscribes to GITHUB_PR_LOGS_UPDATED push events for instant updates
  //   - Falls back to polling via onGetLogs() every 1.5s while isReviewing
  //   - Displays logs in collapsible PRLogs component with phase indicators
  //
  // Data Flow:
  //   1. Backend: PRLogCollector.processLine() → PRLogCollector.save()
  //   2. Backend: savePRLogs() writes JSON to disk
  //   3. Backend: Emits GITHUB_PR_LOGS_UPDATED IPC event → triggers immediate refresh
  //   4. Fallback: Polling interval calls onGetLogs() every 1.5s during review
  //   5. Frontend: setPrLogs() triggers UI update with new log content
  //
  // ========================================================================
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [prLogs, setPrLogs] = useState<PRLogsType | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const logsLoadedRef = useRef(false);

  // Merge readiness state (real-time validation of AI verdict freshness)
  const [mergeReadiness, setMergeReadiness] = useState<MergeReadiness | null>(null);
  const mergeReadinessAbortRef = useRef<AbortController | null>(null);

  // Branch update state (for updating PR branch when behind base)
  const [isUpdatingBranch, setIsUpdatingBranch] = useState(false);
  const [branchUpdateError, setBranchUpdateError] = useState<string | null>(null);
  const [branchUpdateSuccess, setBranchUpdateSuccess] = useState(false);
  const [mergeReadinessRefreshKey, setMergeReadinessRefreshKey] = useState(0);

  // Workflows awaiting approval state (for fork PRs)
  const [workflowsAwaiting, setWorkflowsAwaiting] = useState<WorkflowsAwaitingApprovalResult | null>(null);
  const [isApprovingWorkflow, setIsApprovingWorkflow] = useState<number | null>(null);
  const [workflowsExpanded, setWorkflowsExpanded] = useState(true);

  // Generate stable IDs for accessibility
  const cleanReviewErrorDetailsId = useId();

  // Sync with store's newCommitsCheck when it changes (e.g., when switching PRs or after refresh)
  // Always sync to keep local state in sync with store, including null values
  useEffect(() => {
    setNewCommitsCheck(initialNewCommitsCheck ?? null);
  }, [initialNewCommitsCheck]);

  // Sync local postedFindingIds with reviewResult.postedFindingIds when it changes
  useEffect(() => {
    if (reviewResult?.postedFindingIds) {
      setPostedFindingIds(new Set(reviewResult.postedFindingIds));
    } else {
      setPostedFindingIds(new Set());
    }
  }, [reviewResult?.postedFindingIds, pr.number]);

  // Auto-select ALL findings when review completes (excluding already posted)
  // All findings should reach the contributor - even LOW suggestions are valuable feedback
  useEffect(() => {
    if (reviewResult?.success && reviewResult.findings.length > 0) {
      const allFindings = reviewResult.findings
        .filter(f => !postedFindingIds.has(f.id))
        .map(f => f.id);
      setSelectedFindingIds(new Set(allFindings));
    }
  }, [reviewResult, postedFindingIds]);

  // Check for new commits after any review has been completed
  // This allows detecting new work pushed after ANY review (initial or follow-up)
  const hasPostedFindings = postedFindingIds.size > 0 || reviewResult?.hasPostedFindings;

  const checkForNewCommits = useCallback(async () => {
    // Prevent duplicate concurrent calls using ref (avoids callback recreation)
    if (isCheckingNewCommitsRef.current) {
      return;
    }

    // Check for new commits if we have ANY successful review with a commit SHA
    // This includes follow-up reviews that resolved all issues (no new findings)
    // New commits = new code that needs to be reviewed, regardless of posting status
    if (!reviewResult?.success || !reviewResult.reviewedCommitSha) {
      return;
    }

    // Skip if we already have a fresh newCommitsCheck from initialNewCommitsCheck (store)
    // that matches the current review's commit SHA. This prevents redundant API calls
    // when the useGitHubPRs hook has already checked for new commits on PR selection.
    // The `lastReviewedCommit` field indicates which commit SHA the check was performed against.
    if (newCommitsCheck?.lastReviewedCommit === reviewResult.reviewedCommitSha) {
      return;
    }

    // Additional guard: if we have any newCommitsCheck result but it lacks lastReviewedCommit,
    // skip to prevent infinite loops. This handles edge cases where the API returns
    // a result without the tracking field.
    if (newCommitsCheck && !newCommitsCheck.lastReviewedCommit) {
      return;
    }

    // Cancel any pending check
    if (checkNewCommitsAbortRef.current) {
      checkNewCommitsAbortRef.current.abort();
    }
    checkNewCommitsAbortRef.current = new AbortController();

    isCheckingNewCommitsRef.current = true;
    try {
      const result = await onCheckNewCommits();
      // Only update state if not aborted
      if (!checkNewCommitsAbortRef.current?.signal.aborted) {
        setNewCommitsCheck(result);
      }
    } finally {
      // Always reset the checking ref to allow future checks.
      // The abort only determines whether to update STATE, not whether
      // the operation tracking should be reset.
      isCheckingNewCommitsRef.current = false;
    }
  }, [reviewResult, onCheckNewCommits, newCommitsCheck]);

  useEffect(() => {
    checkForNewCommits();
    return () => {
      // Cleanup abort controller on unmount
      if (checkNewCommitsAbortRef.current) {
        checkNewCommitsAbortRef.current.abort();
      }
    };
  }, [checkForNewCommits]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (postSuccess) {
      const timer = setTimeout(() => setPostSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [postSuccess]);

  // Clear branch update success message after 3 seconds
  useEffect(() => {
    if (branchUpdateSuccess) {
      const timer = setTimeout(() => setBranchUpdateSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [branchUpdateSuccess]);

  // Auto-expand logs section when review starts
  useEffect(() => {
    if (isReviewing) {
      setLogsExpanded(true);
    }
  }, [isReviewing]);

  // Auto-expand both logs and analysis sections when review completes successfully
  // This ensures users can see both logs AND findings/summary together after completion
  useEffect(() => {
    if (reviewResult?.success && !isReviewing) {
      setLogsExpanded(true);
      setAnalysisExpanded(true);
    }
  }, [reviewResult?.success, isReviewing]);

  // Subscribe to push-based log updates from backend for instant refresh
  useEffect(() => {
    if (!isReviewing) return;

    const cleanup = window.electronAPI.github.onPRLogsUpdated(
      (_projectId: string, data: { prNumber: number; entryCount: number }) => {
        if (data.prNumber !== pr.number) return;
        onGetLogs()
          .then(logs => setPrLogs(logs))
          .catch(() => {});
      }
    );

    return cleanup;
  }, [isReviewing, pr.number, onGetLogs]);

  /**
   * Initial log load when user expands the logs section
   *
   * This effect handles the first-time load of logs when the user clicks
   * to expand the logs collapsible card. It's a one-time operation per PR
   * tracked by logsLoadedRef to prevent redundant loads.
   *
   * After this initial load, the periodic polling (below) takes over to
   * keep the logs up-to-date during active reviews.
   */
  useEffect(() => {
    if (logsExpanded && !logsLoadedRef.current && !isLoadingLogs) {
      logsLoadedRef.current = true;
      setIsLoadingLogs(true);
      onGetLogs()
        .then(logs => {
          setPrLogs(logs);
        })
        .catch((err) => {
          console.error('Failed to load initial PR review logs:', err);
          setPrLogs(null);
        })
        .finally(() => setIsLoadingLogs(false));
    }
  }, [logsExpanded, onGetLogs, isLoadingLogs]);

  // Track previous reviewing state to detect transitions
  const wasReviewingRef = useRef(false);

  /**
   * Active polling mechanism for real-time log streaming during PR review
   *
   * This is the CORE of the log polling system. It handles three scenarios:
   *
   * 1. Review Start (wasReviewing=false → isReviewing=true):
   *    - Clears stale logs from previous reviews
   *    - Prepares for new log stream
   *
   * 2. Active Review (isReviewing=true):
   *    - Polls onGetLogs() every 1.5 seconds
   *    - Immediate initial poll, then setInterval for subsequent polls
   *    - Backend writes logs every 3 entries, so 1.5s polling ensures
   *      near-real-time updates without overwhelming the file system
   *
   * 3. Review End (wasReviewing=true → isReviewing=false):
   *    - One final poll to capture the last phase status
   *    - Ensures "completed" status is displayed even if polling interval
   *      missed the final write
   *
   * Why 1.5 seconds?
   * ----------------
   * - Backend saves every 3 log entries (PRLogCollector.saveInterval)
   * - Typical review generates 2-5 entries/second during active phases
   * - 1.5s interval balances responsiveness vs. file I/O overhead
   * - Faster than 1.5s risks reading incomplete writes on slow disks
   * - Slower than 1.5s makes progress feel laggy to users
   *
   * Error Handling:
   * ---------------
   * - Errors during polling are logged but don't stop the interval
   * - This ensures transient file read errors don't break the UI
   * - If logs file doesn't exist yet, backend returns null gracefully
   */
  useEffect(() => {
    const wasReviewing = wasReviewingRef.current;
    wasReviewingRef.current = isReviewing;

    // Do one final refresh when review just completed to get final phase status
    if (wasReviewing && !isReviewing) {
      onGetLogs()
        .then(logs => setPrLogs(logs))
        .catch(err => console.error('Failed to fetch final logs:', err));
      return;
    }

    // Clear old logs when a new review starts to avoid showing stale status
    if (!wasReviewing && isReviewing) {
      setPrLogs(null);
    }

    if (!isReviewing) return;

    const refreshLogs = async () => {
      try {
        const logs = await onGetLogs();
        setPrLogs(logs);
      } catch (err) {
        console.error('Failed to refresh PR review logs during polling:', err);
        // Ignore errors during refresh - don't stop polling
      }
    };

    // Refresh immediately, then every 1.5 seconds while reviewing for smoother streaming
    refreshLogs();
    const interval = setInterval(refreshLogs, 1500);
    return () => {
      clearInterval(interval);
    };
  }, [isReviewing, onGetLogs]);

  /**
   * Completion detection for external (in-progress) reviews
   *
   * When the backend reports overallStatus === 'in_progress', the store sets
   * isExternalReview = true and isReviewing = true. This effect polls the
   * review result file every 3 seconds to detect when the external review
   * finishes. Once a completed result is found (overallStatus !== 'in_progress'),
   * we update the store which will set isReviewing = false and display the result.
   */
  useEffect(() => {
    if (!isReviewing || !isExternalReview) return;

    const POLL_INTERVAL_MS = 3000;
    const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    const pollStart = Date.now();

    let notified = false;

    const pollForCompletion = async () => {
      // Skip if we already notified (prevents duplicate notifications before React cleanup)
      if (notified) return;

      // Timeout: stop polling after 30 minutes to avoid indefinite polling
      if (Date.now() - pollStart > MAX_POLL_DURATION_MS) {
        console.warn('[PRDetail] External review polling timed out after 30 minutes');
        notified = true;
        try {
          // Notify main process so the XState actor transitions to error state
          await window.electronAPI.github.notifyExternalReviewComplete(projectId, pr.number, null);
        } catch {
          // Non-critical — state manager timeout is a best-effort notification
        }
        return;
      }

      try {
        const result = await window.electronAPI.github.getPRReview(projectId, pr.number);
        if (result && result.overallStatus !== 'in_progress') {
          // Only accept results that were produced AFTER we detected the external review.
          // Otherwise this is a stale result from a previous review still on disk
          // (in-progress results are intentionally NOT saved to disk).
          if (startedAt && result.reviewedAt && new Date(result.reviewedAt) > new Date(startedAt)) {
            notified = true;
            // Notify main process so the XState actor transitions to completed state
            await window.electronAPI.github.notifyExternalReviewComplete(projectId, pr.number, result);
          }
        }
      } catch {
        // Ignore errors — transient file read failures shouldn't stop polling
      }
    };

    // Poll immediately, then every 3 seconds
    pollForCompletion();
    const interval = setInterval(pollForCompletion, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isReviewing, isExternalReview, projectId, pr.number, startedAt]);

  /**
   * Fallback mechanism: Load logs after review completes if not already loaded
   *
   * Why is this needed?
   * ===================
   * This effect handles edge cases where the active polling (above) might
   * miss the final logs, such as:
   *
   * 1. Race Condition: Review completes between polling intervals
   *    - Polling runs at t=0s, t=1.5s, t=3s, etc.
   *    - If review completes at t=1.3s, final poll (on completion) might
   *      run before backend finishes writing the completion status
   *    - 500ms delay ensures backend has time to write final state
   *
   * 2. Follow-up Review Mismatch: User runs follow-up after initial review
   *    - prLogs.is_followup !== reviewResult.isFollowupReview
   *    - Need to reload logs to show correct review type
   *
   * 3. Component Remount: User switches away and back to the PR
   *    - prLogs might be null after remount
   *    - Fallback ensures logs are reloaded from disk
   *
   * Timing:
   * -------
   * - 500ms delay balances reliability vs. responsiveness
   * - Backend typically writes logs in <100ms, but network drives,
   *   virus scanners, or disk contention can delay writes
   * - Delay is user-imperceptible since review is already complete
   *
   * This ensures 100% reliability: even if all other load mechanisms fail,
   * logs will eventually appear via this fallback.
   */
  useEffect(() => {
    // Only trigger when a review has completed successfully
    if (!reviewResult?.success || isReviewing) {
      return;
    }

    // Check if we need to load logs:
    // 1. No logs loaded yet, OR
    // 2. Logs are from a different review (followup status mismatch)
    const needsLogsLoad = !prLogs || (prLogs.is_followup !== reviewResult.isFollowupReview);

    if (!needsLogsLoad) {
      return;
    }

    // Add a small delay to ensure backend has written the logs file
    const timer = setTimeout(() => {
      setIsLoadingLogs(true);
      onGetLogs()
        .then(logs => {
          setPrLogs(logs);
        })
        .catch(err => {
          console.error('Failed to load fallback PR review logs:', err);
        })
        .finally(() => {
          setIsLoadingLogs(false);
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [reviewResult, isReviewing, prLogs, onGetLogs]);

  /**
   * Reset logs state when PR changes
   *
   * When the user switches to a different PR (pr.number changes), we need
   * to clear all state to prevent showing logs from the previous PR.
   *
   * State cleared:
   * - logsLoadedRef: Allows initial load to trigger for new PR
   * - prLogs: Clears displayed log content
   * - logsExpanded: Collapses logs section (user must explicitly expand)
   * - Review posting state: Clears any success/error messages
   *
   * This ensures a clean slate for each PR's review lifecycle.
   */
  useEffect(() => {
    logsLoadedRef.current = false;
    setPrLogs(null);
    setLogsExpanded(false);
    setCleanReviewPosted(false);
    setCleanReviewError(null);
    setIsPostingCleanReview(false);
    setShowCleanReviewErrorDetails(false);
    // Reset blocked status state as well
    setBlockedStatusPosted(false);
    setBlockedStatusError(null);
    setIsPostingBlockedStatus(false);
    // Reset branch update state as well
    setBranchUpdateError(null);
    setBranchUpdateSuccess(false);
    setIsUpdatingBranch(false);
  }, [pr.number]);

  // Check for workflows awaiting approval (fork PRs) when PR changes or review completes
  useEffect(() => {
    const checkWorkflows = async () => {
      try {
        const result = await window.electronAPI.github.getWorkflowsAwaitingApproval(
          '', // projectId will be resolved from active project
          pr.number
        );
        setWorkflowsAwaiting(result);
      } catch {
        setWorkflowsAwaiting(null);
      }
    };

    checkWorkflows();
    // Re-check when a review is completed (CI status might have changed)
  }, [pr.number, reviewResult]);

  // Check merge readiness (real-time validation) when PR is selected
  // This runs on every PR selection to catch stale verdicts
  useEffect(() => {
    // Cancel any pending check
    if (mergeReadinessAbortRef.current) {
      mergeReadinessAbortRef.current.abort();
    }
    mergeReadinessAbortRef.current = new AbortController();

    const checkMergeReadiness = async () => {
      if (!projectId) {
        setMergeReadiness(null);
        return;
      }

      try {
        const result = await window.electronAPI.github.checkMergeReadiness(projectId, pr.number);
        // Only update if not aborted
        if (!mergeReadinessAbortRef.current?.signal.aborted) {
          setMergeReadiness(result);
        }
      } catch {
        if (!mergeReadinessAbortRef.current?.signal.aborted) {
          setMergeReadiness(null);
        }
      }
    };

    checkMergeReadiness();

    return () => {
      if (mergeReadinessAbortRef.current) {
        mergeReadinessAbortRef.current.abort();
      }
    };
  }, [pr.number, projectId, mergeReadinessRefreshKey]);

  // Handler to approve a workflow
  const handleApproveWorkflow = useCallback(async (runId: number) => {
    setIsApprovingWorkflow(runId);
    try {
      const success = await window.electronAPI.github.approveWorkflow('', runId);
      if (success) {
        // Refresh the workflows list after approval
        const result = await window.electronAPI.github.getWorkflowsAwaitingApproval('', pr.number);
        setWorkflowsAwaiting(result);
      }
    } finally {
      setIsApprovingWorkflow(null);
    }
  }, [pr.number]);

  // Handler to approve all workflows at once
  const handleApproveAllWorkflows = useCallback(async () => {
    if (!workflowsAwaiting?.workflow_runs.length) return;

    for (const workflow of workflowsAwaiting.workflow_runs) {
      setIsApprovingWorkflow(workflow.id);
      try {
        await window.electronAPI.github.approveWorkflow('', workflow.id);
      } catch {
        // Continue with other workflows even if one fails
      }
    }
    setIsApprovingWorkflow(null);

    // Refresh the workflows list
    const result = await window.electronAPI.github.getWorkflowsAwaitingApproval('', pr.number);
    setWorkflowsAwaiting(result);
  }, [pr.number, workflowsAwaiting]);

  // Handler to update PR branch when behind base
  const handleUpdateBranch = useCallback(async () => {
    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsUpdatingBranch(true);
    setBranchUpdateError(null);
    setBranchUpdateSuccess(false);

    try {
      const result = await window.electronAPI.github.updatePRBranch(projectId, pr.number);

      // Only update state if PR hasn't changed
      if (pr.number === currentPr) {
        if (result.success) {
          setBranchUpdateSuccess(true);
          // Trigger merge readiness refresh to update the UI
          setMergeReadinessRefreshKey(prev => prev + 1);
        } else {
          setBranchUpdateError(result.error || t('prReview.branchUpdateFailed'));
        }
      }
    } catch (err) {
      if (pr.number === currentPr) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setBranchUpdateError(errorMessage);
      }
    } finally {
      if (pr.number === currentPr) {
        setIsUpdatingBranch(false);
      }
    }
  }, [pr.number, projectId, t]);

  // Count selected findings by type for the button label
  const selectedCount = selectedFindingIds.size;

  // Check if PR is ready to merge based on review
  const isReadyToMerge = useMemo(() => {
    if (!reviewResult || !reviewResult.success) return false;
    // Check if the summary contains "READY TO MERGE"
    return reviewResult.summary?.includes('READY TO MERGE') || reviewResult.overallStatus === 'approve';
  }, [reviewResult]);

  // Check if review is "clean" - only LOW severity findings (no MEDIUM, HIGH, or CRITICAL)
  // Requires at least having a successful review to be considered clean
  const isCleanReview = useMemo(() => {
    if (!reviewResult || !reviewResult.success) return false;
    // Only LOW findings allowed - no medium, high, or critical
    // A review with zero findings is also considered clean
    return !reviewResult.findings.some(f =>
      f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium'
    );
  }, [reviewResult]);

  // Check if there are any findings at all (for auto-approve button label)
  const hasFindings = useMemo(() => {
    return reviewResult?.findings && reviewResult.findings.length > 0;
  }, [reviewResult]);

  // Get LOW severity findings for auto-posting
  const lowSeverityFindings = useMemo(() => {
    if (!reviewResult?.findings) return [];
    return reviewResult.findings.filter(f => f.severity === 'low');
  }, [reviewResult]);

  // Compute the overall PR review status for visual display
  type PRStatus = 'not_reviewed' | 'reviewed_pending_post' | 'waiting_for_changes' | 'ready_to_merge' | 'needs_attention' | 'ready_for_followup' | 'followup_issues_remain' | 'reviewing';
  const prStatus: { status: PRStatus; label: string; description: string; icon: React.ReactNode; color: string } = useMemo(() => {
    // Check for in-progress review FIRST (before checking result)
    // This ensures the running review state is visible when switching back to a PR
    if (isReviewing) {
      return {
        status: 'reviewing',
        label: t('prReview.aiReviewInProgress'),
        description: reviewProgress?.message || t('prReview.analysisInProgress'),
        icon: <Bot className="h-5 w-5 animate-pulse" />,
        color: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
      };
    }

    if (reviewErrorProp && !reviewResult?.success) {
      return {
        status: 'not_reviewed',
        label: t('prReview.reviewFailed'),
        description: reviewErrorProp,
        icon: <AlertCircle className="h-5 w-5" />,
        color: 'bg-destructive/20 text-destructive border-destructive/50',
      };
    }

    if (!reviewResult || !reviewResult.success) {
      return {
        status: 'not_reviewed',
        label: t('prReview.notReviewed'),
        description: t('prReview.runAIReviewDesc'),
        icon: <Bot className="h-5 w-5" />,
        color: 'bg-muted text-muted-foreground border-muted',
      };
    }

    // Use a merged Set to avoid double-counting (local state may overlap with backend state)
    const allPostedIds = new Set([...postedFindingIds, ...(reviewResult.postedFindingIds ?? [])]);
    const totalPosted = allPostedIds.size;
    const hasPosted = totalPosted > 0 || reviewResult.hasPostedFindings;
    const hasBlockers = reviewResult.findings.some(f => f.severity === 'critical' || f.severity === 'high');
    const unpostedFindings = reviewResult.findings.filter(f => !allPostedIds.has(f.id));
    const hasUnpostedBlockers = unpostedFindings.some(f => f.severity === 'critical' || f.severity === 'high');
    const hasNewCommits = newCommitsCheck?.hasNewCommits ?? false;
    const newCommitCount = newCommitsCheck?.newCommitCount ?? 0;
    // Only consider commits that happened AFTER findings were posted for "Ready for Follow-up"
    const hasCommitsAfterPosting = newCommitsCheck?.hasCommitsAfterPosting ?? false;

    // Follow-up review specific statuses
    if (reviewResult.isFollowupReview) {
      const resolvedCount = reviewResult.resolvedFindings?.length ?? 0;
      const unresolvedCount = reviewResult.unresolvedFindings?.length ?? 0;
      const newIssuesCount = reviewResult.newFindingsSinceLastReview?.length ?? 0;

      // Check if any remaining issues are blockers (HIGH/CRITICAL)
      const hasBlockingIssuesRemaining = reviewResult.findings.some(
        f => (f.severity === 'critical' || f.severity === 'high')
      );

      // Check if ready for another follow-up (new commits AFTER this follow-up was posted)
      if (hasNewCommits && hasCommitsAfterPosting) {
        return {
          status: 'ready_for_followup',
          label: t('prReview.readyForFollowup'),
          description: t('prReview.newCommitsSinceFollowup', { count: newCommitCount }),
          icon: <RefreshCw className="h-5 w-5" />,
          color: 'bg-info/20 text-info border-info/50',
        };
      }

      // All issues resolved - ready to merge
      if (unresolvedCount === 0 && newIssuesCount === 0) {
        return {
          status: 'ready_to_merge',
          label: t('prReview.readyToMerge'),
          description: t('prReview.allIssuesResolved', { count: resolvedCount }),
          icon: <CheckCheck className="h-5 w-5" />,
          color: 'bg-success/20 text-success border-success/50',
        };
      }

      // No blocking issues (only MEDIUM/LOW) - can merge with suggestions
      if (!hasBlockingIssuesRemaining) {
        const suggestionsCount = unresolvedCount + newIssuesCount;
        return {
          status: 'ready_to_merge',
          label: t('prReview.readyToMerge'),
          description: t('prReview.nonBlockingSuggestions', { resolved: resolvedCount, suggestions: suggestionsCount }),
          icon: <CheckCheck className="h-5 w-5" />,
          color: 'bg-success/20 text-success border-success/50',
        };
      }

      // Blocking issues still remain after follow-up
      return {
        status: 'followup_issues_remain',
        label: t('prReview.blockingIssues'),
        description: t('prReview.blockingIssuesDesc', { resolved: resolvedCount, unresolved: unresolvedCount }),
        icon: <AlertTriangle className="h-5 w-5" />,
        color: 'bg-warning/20 text-warning border-warning/50',
      };
    }

    // Initial review statuses (non-follow-up)

    // Priority 1: Ready for follow-up review (posted findings + new commits AFTER posting)
    if (hasPosted && hasNewCommits && hasCommitsAfterPosting) {
      return {
        status: 'ready_for_followup',
        label: t('prReview.readyForFollowup'),
        description: t('prReview.newCommitsSinceReview', { count: newCommitCount }),
        icon: <RefreshCw className="h-5 w-5" />,
        color: 'bg-info/20 text-info border-info/50',
      };
    }

    // Priority 2: Ready to merge (no blockers)
    if (isReadyToMerge && hasPosted) {
      return {
        status: 'ready_to_merge',
        label: t('prReview.readyToMerge'),
        description: t('prReview.noBlockingIssues'),
        icon: <CheckCheck className="h-5 w-5" />,
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    // Priority 3: Waiting for changes (posted but has blockers, no new commits yet)
    if (hasPosted && hasBlockers) {
      return {
        status: 'waiting_for_changes',
        label: t('prReview.waitingForChanges'),
        description: t('prReview.findingsPostedWaiting', { count: totalPosted }),
        icon: <AlertTriangle className="h-5 w-5" />,
        color: 'bg-warning/20 text-warning border-warning/50',
      };
    }

    // Priority 4: Ready to merge (posted, no blockers)
    if (hasPosted && !hasBlockers) {
      return {
        status: 'ready_to_merge',
        label: t('prReview.readyToMerge'),
        description: t('prReview.findingsPostedNoBlockers', { count: totalPosted }),
        icon: <CheckCheck className="h-5 w-5" />,
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    // Priority 5: Needs attention (unposted blockers)
    if (hasUnpostedBlockers) {
      return {
        status: 'needs_attention',
        label: t('prReview.needsAttention'),
        description: t('prReview.findingsNeedPosting', { count: unpostedFindings.length }),
        icon: <AlertCircle className="h-5 w-5" />,
        color: 'bg-destructive/20 text-destructive border-destructive/50',
      };
    }

    // Default: Review complete, pending post
    return {
      status: 'reviewed_pending_post',
      label: t('prReview.reviewComplete'),
      description: t('prReview.findingsFoundSelectPost', { count: reviewResult.findings.length }),
      icon: <MessageSquare className="h-5 w-5" />,
      color: 'bg-primary/20 text-primary border-primary/50',
    };
  }, [isReviewing, reviewProgress, reviewResult, reviewErrorProp, postedFindingIds, isReadyToMerge, newCommitsCheck, t]);

  const handlePostReview = async () => {
    const idsToPost = Array.from(selectedFindingIds);
    if (idsToPost.length === 0) return;

    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsPostingFindings(true);
    try {
      const success = await onPostReview(idsToPost);
      if (success && pr.number === currentPr) {
        // Mark these findings as posted only if PR hasn't changed
        setPostedFindingIds(prev => new Set([...prev, ...idsToPost]));
        // Clear selection
        setSelectedFindingIds(new Set());
        // Show success message
        setPostSuccess({ count: idsToPost.length, timestamp: Date.now() });
        // After posting, check for new commits (follow-up review now available)
        // Use a small delay to allow the backend to save the posted state
        setTimeout(() => checkForNewCommits(), 500);
      }
    } finally {
      // Clear loading state if PR hasn't changed
      if (pr.number === currentPr) {
        setIsPostingFindings(false);
      }
    }
  };

  const handleApprove = async () => {
    if (!reviewResult) return;

    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsPosting(true);
    try {
      // Auto-assign current user (you can get from GitHub config)
      // For now, we'll just post the comment
      const approvalMessage = `## ✅ Auto Claude PR Review - APPROVED\n\n${reviewResult.summary}\n\n---\n*This approval was generated by Auto Claude.*`;
      await Promise.resolve(onPostComment(approvalMessage));
    } finally {
      // Clear loading state if PR hasn't changed
      if (pr.number === currentPr) {
        setIsPosting(false);
      }
    }
  };

  // Auto-approval for clean PRs - posts approval with LOW findings as suggestions in a SINGLE comment
  // NOTE: GitHub PR comments are intentionally in English as it's the lingua franca
  // for code reviews and GitHub's international developer community. The comment
  // content is meant to be read by contributors who may have different locales.
  const handleAutoApprove = async () => {
    if (!reviewResult) return;

    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsPosting(true);
    try {
      // Post approval with suggestions in a single review comment
      // This uses forceApprove to set APPROVE status even with LOW findings
      const lowFindingIds = lowSeverityFindings.map(f => f.id);

      const success = await onPostReview(lowFindingIds, { forceApprove: true });
      if (success && lowFindingIds.length > 0 && pr.number === currentPr) {
        // Mark findings as posted locally only if PR hasn't changed
        setPostedFindingIds(prev => new Set([...prev, ...lowFindingIds]));
      }
    } finally {
      // Clear loading state if PR hasn't changed
      if (pr.number === currentPr) {
        setIsPosting(false);
      }
    }
  };

  // Post clean review as a comment (does not change PR review status)
  // This is for when a review has no findings or only LOW severity findings
  // NOTE: GitHub PR comments are intentionally in English as it's the lingua franca
  // for code reviews and GitHub's international developer community.
  const handlePostCleanReview = async () => {
    if (!reviewResult) return;

    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsPostingCleanReview(true);
    setCleanReviewError(null); // Clear previous error
    setShowCleanReviewErrorDetails(false); // Reset error details visibility
    try {
      // Format the clean review comment using i18n translations
      const cleanReviewMessage = `${t('prReview.cleanReviewMessageTitle')}

${t('prReview.cleanReviewMessageStatus')}

${reviewResult.summary}

---

${t('prReview.cleanReviewMessageFooter')}`;

      // Use Promise.resolve to handle both Promise and non-Promise implementations
      await Promise.resolve(onPostComment(cleanReviewMessage));

      // Only mark as posted on success if PR hasn't changed
      if (pr.number === currentPr) {
        setCleanReviewPosted(true);
        setCleanReviewError(null);
      }
    } catch (err) {
      // Log full error to console for debugging before rendering
      console.error('Failed to post clean review comment:', err);

      // Set user-friendly error message using translation key
      const fullError = err instanceof Error ? err.message : String(err);
      if (pr.number === currentPr) {
        setCleanReviewError(fullError);
      }
      // Do NOT set cleanReviewPosted on failure
    } finally {
      // Clear loading state if PR hasn't changed
      if (pr.number === currentPr) {
        setIsPostingCleanReview(false);
      }
    }
  };

  // Post blocked status comment when verdict is BLOCKED/NEEDS_REVISION but no findings
  // This handles the edge case where structured output parsing fails but we still have a verdict
  const handlePostBlockedStatus = async () => {
    if (!reviewResult) return;

    // Capture current PR number to prevent state leaks across PR switches
    const currentPr = pr.number;

    setIsPostingBlockedStatus(true);
    setBlockedStatusError(null);
    try {
      // Format the blocked status comment - post the summary which contains blockers
      const blockedStatusMessage = `${t('prReview.blockedStatusMessageTitle')}

${reviewResult.summary}

---

${t('prReview.blockedStatusMessageFooter')}`;

      const success = await onPostComment(blockedStatusMessage);

      // Only mark as posted on success if PR hasn't changed AND comment was posted successfully
      if (success && pr.number === currentPr) {
        setBlockedStatusPosted(true);
        setBlockedStatusError(null);
        // Update the store to mark review as posted so PR list reflects the change
        // Pass prNumber explicitly to avoid race conditions with PR selection changes
        await onMarkReviewPosted?.(currentPr);
      } else if (!success && pr.number === currentPr) {
        setBlockedStatusError('Failed to post comment');
      }
    } catch (err) {
      console.error('Failed to post blocked status comment:', err);
      const fullError = err instanceof Error ? err.message : String(err);
      if (pr.number === currentPr) {
        setBlockedStatusError(fullError);
      }
    } finally {
      if (pr.number === currentPr) {
        setIsPostingBlockedStatus(false);
      }
    }
  };

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      await onMergePR('squash'); // Default to squash merge
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* Refactored Header */}
        <PRHeader pr={pr} isLoadingFiles={isLoadingFiles} />

        {/* Merge Readiness Warning Banner - shows when real-time status contradicts AI verdict */}
        {mergeReadiness && mergeReadiness.blockers.length > 0 && reviewResult?.success && (
          prStatus.status === 'ready_to_merge' || prStatus.status === 'reviewed_pending_post'
        ) && (
          <Card className="border-warning/50 bg-warning/10 animate-in fade-in slide-in-from-top-2 duration-300">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="font-semibold text-warning">
                    {t('prReview.verdictOutdated', 'AI verdict may be outdated')}
                  </p>
                  <ul className="text-sm text-warning/90 space-y-1">
                    {mergeReadiness.blockers.map((blocker, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning/70" />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                  {mergeReadiness.isBehind && (
                    <div className="flex items-center gap-3 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-warning/50 text-warning hover:bg-warning/20"
                        onClick={handleUpdateBranch}
                        disabled={isUpdatingBranch}
                      >
                        {isUpdatingBranch ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {t('prReview.updatingBranch')}
                          </>
                        ) : (
                          <>
                            <GitBranch className="h-4 w-4 mr-2" />
                            {t('prReview.updateBranch')}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-warning/70 mt-2">
                    {t('prReview.rerunReviewSuggestion', 'Consider re-running the review after resolving these issues.')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {branchUpdateSuccess && (
          <div className="flex items-center gap-2 text-xs text-success animate-in fade-in duration-200">
            <CheckCircle className="h-3 w-3" />
            {t('prReview.branchUpdated')}
          </div>
        )}
        {branchUpdateError && (
          <div className="text-xs text-destructive animate-in fade-in duration-200">
            {branchUpdateError}
          </div>
        )}

        {/* Review Status & Actions */}
        <ReviewStatusTree
          status={prStatus.status}
          isReviewing={isReviewing}
          isExternalReview={isExternalReview}
          startedAt={startedAt}
          reviewResult={reviewResult}
          previousReviewResult={previousReviewResult}
          postedCount={new Set([...postedFindingIds, ...(reviewResult?.postedFindingIds ?? [])]).size}
          reviewError={reviewErrorProp}
          onRunReview={onRunReview}
          onRunFollowupReview={onRunFollowupReview}
          onCancelReview={onCancelReview}
          newCommitsCheck={newCommitsCheck}
          lastPostedAt={postSuccess?.timestamp || (reviewResult?.postedAt ? new Date(reviewResult.postedAt).getTime() : null)}
        />

        {/* Action Bar (Legacy Actions that fit under the tree context) */}
        {reviewResult && reviewResult.success && !isReviewing && (
          <div className="flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
             {selectedCount > 0 && (
                <Button onClick={handlePostReview} variant="secondary" disabled={isPostingFindings} className="flex-1 sm:flex-none">
                  {isPostingFindings ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('prReview.posting')}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      {t('prReview.postFindings', { count: selectedCount })}
                    </>
                  )}
                </Button>
             )}

             {/* Post Clean Review button - shows when review is clean and no findings are selected */}
             {selectedCount === 0 && isCleanReview && !hasPostedFindings && !cleanReviewPosted && reviewResult?.overallStatus !== 'request_changes' && (
                <Button
                  onClick={handlePostCleanReview}
                  disabled={isPostingCleanReview || isPosting}
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                >
                  {isPostingCleanReview ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('prReview.postingCleanReview')}
                    </>
                  ) : (
                    <>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      {t('prReview.postCleanReview')}
                    </>
                  )}
                </Button>
             )}

             {/* Post Blocked Status button - shows when verdict is BLOCKED/NEEDS_REVISION but no findings */}
             {/* This handles the edge case where structured output parsing fails but we still have a verdict */}
             {selectedCount === 0 && !hasPostedFindings && !blockedStatusPosted && reviewResult?.overallStatus === 'request_changes' && (
                <Button
                  onClick={handlePostBlockedStatus}
                  disabled={isPostingBlockedStatus || isPosting}
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                >
                  {isPostingBlockedStatus ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('prReview.postingBlockedStatus')}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      {t('prReview.postBlockedStatus')}
                    </>
                  )}
                </Button>
             )}

             {/* Approve button - consolidated logic to avoid duplicate buttons */}
             {/* Don't show when overallStatus is 'request_changes' (e.g., workflows blocked, or other issues) */}
             {isCleanReview && !hasPostedFindings && reviewResult?.overallStatus !== 'request_changes' && (
                <Button
                  onClick={handleAutoApprove}
                  disabled={isPosting || isPostingCleanReview}
                  variant="default"
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isPosting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('prReview.postingApproval')}
                    </>
                  ) : (
                    <>
                      <CheckCheck className="h-4 w-4 mr-2" />
                      {t('prReview.autoApprovePR')}
                      {hasFindings && lowSeverityFindings.length > 0 && (
                        <span className="ml-1 text-xs opacity-80">
                          {t('prReview.suggestions', { count: lowSeverityFindings.length })}
                        </span>
                      )}
                    </>
                  )}
                </Button>
             )}

             {/* Manual approve button - only show for non-clean reviews that are ready to merge */}
             {/* isReadyToMerge already checks for 'approve' status, so no need for additional check */}
             {isReadyToMerge && !isCleanReview && !hasPostedFindings && (
                <Button
                  onClick={handleApprove}
                  disabled={isPosting}
                  variant="default"
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  {t('prReview.approve')}
                </Button>
             )}

             {/* Merge button - only show after approval has been posted */}
             {hasPostedFindings && (
                <Button
                  onClick={handleMerge}
                  disabled={isMerging}
                  variant="outline"
                  className="flex-1 sm:flex-none gap-1.5 text-muted-foreground hover:text-foreground"
                  title={t('prReview.mergeViaGitHub')}
                >
                  {isMerging ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <GitMerge className="h-4 w-4" />
                      <span>{t('prReview.merge')}</span>
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </>
                  )}
                </Button>
             )}

             {postSuccess && (
               <div className="ml-auto flex items-center gap-2 text-emerald-600 text-sm font-medium animate-pulse">
                 <CheckCircle className="h-4 w-4" />
                 {t('prReview.postedFindings', { count: postSuccess.count })}
               </div>
             )}

             {cleanReviewPosted && !postSuccess && (
               <div className="ml-auto flex items-center gap-2 text-emerald-600 text-sm font-medium animate-pulse">
                 <CheckCircle className="h-4 w-4" />
                 {t('prReview.cleanReviewPosted')}
               </div>
             )}

             {/* Clean review error display - inline pattern for action bar context */}
             {/* Note: Uses inline layout (not Card) to match other action bar status messages.
                 Separate Card-based error at line 972 handles review result errors. */}
             {cleanReviewError && (
               <div className="ml-auto flex items-center gap-2">
                 <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                   <XCircle className="h-4 w-4" />
                   {t('prReview.failedPostCleanReview')}
                 </div>
                 <button
                   onClick={() => setShowCleanReviewErrorDetails(!showCleanReviewErrorDetails)}
                   aria-expanded={showCleanReviewErrorDetails}
                   aria-controls={cleanReviewErrorDetailsId}
                   className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                 >
                   {showCleanReviewErrorDetails ? (
                     <>
                       {t('prReview.hideErrorDetails')}
                       <ChevronUp className="h-3 w-3" />
                     </>
                   ) : (
                     <>
                       {t('prReview.viewErrorDetails')}
                       <ChevronDown className="h-3 w-3" />
                     </>
                   )}
                 </button>
               </div>
             )}
             {cleanReviewError && showCleanReviewErrorDetails && (
               <div
                 id={cleanReviewErrorDetailsId}
                 className="ml-auto text-xs text-muted-foreground max-w-md truncate"
                 title={cleanReviewError}
               >
                 {cleanReviewError}
               </div>
             )}

             {/* Blocked status posted success message */}
             {blockedStatusPosted && !postSuccess && !cleanReviewPosted && (
               <div className="ml-auto flex items-center gap-2 text-amber-600 text-sm font-medium animate-pulse">
                 <CheckCircle className="h-4 w-4" />
                 {t('prReview.blockedStatusPosted')}
               </div>
             )}

             {/* Blocked status error display */}
             {blockedStatusError && (
               <div className="ml-auto flex items-center gap-2 text-destructive text-sm font-medium">
                 <XCircle className="h-4 w-4" />
                 {t('prReview.failedPostBlockedStatus')}
               </div>
             )}
          </div>
        )}

        {/* Review Progress */}
        {reviewProgress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{reviewProgress.message}</span>
              <span className="text-muted-foreground">{reviewProgress.progress}%</span>
            </div>
            <Progress value={reviewProgress.progress} className="h-2" />
          </div>
        )}

        {/* Review Result / Findings */}
        {reviewResult && reviewResult.success && (
          <CollapsibleCard
            title={reviewResult.isFollowupReview ? t('prReview.followupReviewDetails') : t('prReview.aiAnalysisResults')}
            icon={reviewResult.isFollowupReview ? (
              <RefreshCw className="h-4 w-4 text-blue-500" />
            ) : (
              <Bot className="h-4 w-4 text-purple-500" />
            )}
            badge={
              <Badge variant="outline" className={getStatusColor(reviewResult.overallStatus)}>
                {reviewResult.overallStatus === 'approve' && t('prReview.approve')}
                {reviewResult.overallStatus === 'request_changes' && t('prReview.changesRequested')}
                {reviewResult.overallStatus === 'comment' && t('prReview.commented')}
              </Badge>
            }
            open={analysisExpanded}
            onOpenChange={setAnalysisExpanded}
          >
            <div className="p-4 space-y-6">
              {/* Follow-up Review Resolution Status */}
              {reviewResult.isFollowupReview && (
                <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-border/50">
                  {(reviewResult.resolvedFindings?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-success/10 text-success border-success/30 px-3 py-1">
                      <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                      {t('prReview.resolved', { count: reviewResult.resolvedFindings?.length ?? 0 })}
                    </Badge>
                  )}
                  {(reviewResult.unresolvedFindings?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 px-3 py-1">
                      <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                      {t('prReview.stillOpen', { count: reviewResult.unresolvedFindings?.length ?? 0 })}
                    </Badge>
                  )}
                  {(reviewResult.newFindingsSinceLastReview?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 px-3 py-1">
                      <XCircle className="h-3.5 w-3.5 mr-1.5" />
                      {t('prReview.newIssue', { count: reviewResult.newFindingsSinceLastReview?.length ?? 0 })}
                    </Badge>
                  )}
                  {/* Re-run follow-up review button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 ml-auto text-muted-foreground hover:text-foreground"
                    onClick={onRunFollowupReview}
                    disabled={isReviewing}
                    title={t('prReview.rerunFollowup')}
                  >
                    {isReviewing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              <div className="bg-muted/30 p-4 rounded-lg text-sm text-muted-foreground leading-relaxed">
                {reviewResult.summary}
              </div>

              {/* Interactive Findings with Selection */}
              <ReviewFindings
                findings={reviewResult.findings}
                selectedIds={selectedFindingIds}
                postedIds={postedFindingIds}
                onSelectionChange={setSelectedFindingIds}
              />
            </div>
          </CollapsibleCard>
        )}

        {/* Review Error */}
        {reviewResult && !reviewResult.success && reviewResult.error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3 text-destructive">
                <XCircle className="h-5 w-5 mt-0.5" />
                <div className="space-y-1">
                   <p className="font-semibold">{t('prReview.reviewFailed')}</p>
                   <p className="text-sm opacity-90">{reviewResult.error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Workflows Awaiting Approval - for fork PRs */}
        {workflowsAwaiting && workflowsAwaiting.awaiting_approval > 0 && (
          <CollapsibleCard
            title={t('prReview.workflowsAwaitingApproval', { count: workflowsAwaiting.awaiting_approval })}
            icon={<Clock className="h-4 w-4 text-warning" />}
            badge={
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {t('prReview.blockedByWorkflows')}
              </Badge>
            }
            open={workflowsExpanded}
            onOpenChange={setWorkflowsExpanded}
          >
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('prReview.workflowsAwaitingDescription')}
              </p>

              <div className="space-y-2">
                {workflowsAwaiting.workflow_runs.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-4 w-4 text-warning shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium truncate block">
                          {workflow.workflow_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {workflow.name}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => window.open(workflow.html_url, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        {t('prReview.viewOnGitHub')}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => handleApproveWorkflow(workflow.id)}
                        disabled={isApprovingWorkflow !== null}
                      >
                        {isApprovingWorkflow === workflow.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Play className="h-3 w-3 mr-1" />
                            {t('prReview.approveWorkflow')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {workflowsAwaiting.workflow_runs.length > 1 && (
                <div className="flex justify-end pt-2 border-t border-border/50">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleApproveAllWorkflows}
                    disabled={isApprovingWorkflow !== null}
                  >
                    {isApprovingWorkflow !== null ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    {t('prReview.approveAllWorkflows')}
                  </Button>
                </div>
              )}
            </div>
          </CollapsibleCard>
        )}

        {/* Review Logs - show during review or after completion */}
        {(reviewResult || isReviewing) && (
          <CollapsibleCard
            title={t('prReview.reviewLogs')}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            badge={
              isReviewing ? (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {t('prReview.aiReviewInProgress')}
                </Badge>
              ) : prLogs ? (
                <Badge variant="outline" className="text-xs">
                  {prLogs.is_followup ? t('prReview.followup') : t('prReview.initial')}
                </Badge>
              ) : null
            }
            open={logsExpanded}
            onOpenChange={setLogsExpanded}
          >
            <PRLogs
              prNumber={pr.number}
              logs={prLogs}
              isLoading={isLoadingLogs}
              isStreaming={isReviewing}
            />
          </CollapsibleCard>
        )}

        {/* Description */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('prReview.description')}</h3>
             <ScrollArea className="h-[400px] w-full rounded-md border p-4 bg-muted/10">
              {pr.body ? (
                <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-sans break-words">
                  {pr.body}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">{t('prReview.noDescription')}</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
