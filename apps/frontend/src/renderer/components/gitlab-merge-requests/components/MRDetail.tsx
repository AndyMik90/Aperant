import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  User,
  Users,
  Clock,
  GitBranch,
  FileDiff,
  Sparkles,
  Send,
  XCircle,
  Loader2,
  GitMerge,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  AlertTriangle,
  CheckCheck,
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { Progress } from '../../ui/progress';
import { ErrorBoundary } from '../../ui/error-boundary';
import { ReviewFindings } from './ReviewFindings';
import type {
  GitLabMergeRequest,
  GitLabMRReviewResult,
  GitLabMRReviewProgress,
} from '../hooks/useGitLabMRs';
import type { GitLabNewCommitsCheck } from '../../../../shared/types';

interface MRDetailProps {
  mr: GitLabMergeRequest;
  reviewResult: GitLabMRReviewResult | null;
  reviewProgress: GitLabMRReviewProgress | null;
  isReviewing: boolean;
  onRunReview: () => void;
  onRunFollowupReview: () => void;
  onCheckNewCommits: () => Promise<GitLabNewCommitsCheck>;
  onCancelReview: () => void;
  onPostReview: (selectedFindingIds?: string[]) => Promise<boolean>;
  onPostNote: (body: string) => Promise<boolean>;
  onMergeMR: (mergeMethod?: 'merge' | 'squash' | 'rebase') => Promise<boolean>;
  onAssignMR: (userIds: number[]) => Promise<boolean>;
  onApproveMR: () => Promise<boolean>;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusColor(status: GitLabMRReviewResult['overallStatus']): string {
  switch (status) {
    case 'approve':
      return 'bg-success/20 text-success border-success/50';
    case 'request_changes':
      return 'bg-destructive/20 text-destructive border-destructive/50';
    default:
      return 'bg-muted';
  }
}

function getMRStateColor(state: string): string {
  switch (state) {
    case 'opened':
      return 'bg-success/20 text-success border-success/50';
    case 'merged':
      return 'bg-purple-500/20 text-purple-500 border-purple-500/50';
    case 'closed':
      return 'bg-destructive/20 text-destructive border-destructive/50';
    default:
      return 'bg-muted';
  }
}

export function MRDetail({
  mr,
  reviewResult,
  reviewProgress,
  isReviewing,
  onRunReview,
  onRunFollowupReview,
  onCheckNewCommits,
  onCancelReview,
  onPostReview,
  onPostNote,
  onMergeMR,
  onApproveMR,
}: MRDetailProps) {
  const { t } = useTranslation('common');
  // Selection state for findings
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());
  const [postedFindingIds, setPostedFindingIds] = useState<Set<string>>(new Set());
  const [isPostingFindings, setIsPostingFindings] = useState(false);
  const [postSuccess, setPostSuccess] = useState<{ count: number; timestamp: number } | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [newCommitsCheck, setNewCommitsCheck] = useState<GitLabNewCommitsCheck | null>(null);

  // Auto-select critical and high findings when review completes (excluding already posted)
  useEffect(() => {
    if (reviewResult?.success && reviewResult.findings.length > 0) {
      const importantFindings = reviewResult.findings
        .filter(f => (f.severity === 'critical' || f.severity === 'high') && !postedFindingIds.has(f.id))
        .map(f => f.id);
      setSelectedFindingIds(new Set(importantFindings));
    }
  }, [reviewResult, postedFindingIds]);

  // Check for new commits only when findings have been posted to GitLab
  // Follow-up review only makes sense after initial findings are shared with the contributor
  const hasPostedFindings = postedFindingIds.size > 0 || reviewResult?.hasPostedFindings;

  const checkForNewCommits = useCallback(async () => {
    // Only check for new commits if we have a review AND findings have been posted
    if (reviewResult?.success && reviewResult.reviewedCommitSha && hasPostedFindings) {
      try {
        const result = await onCheckNewCommits();
        setNewCommitsCheck(result);
      } finally {
        // No additional state to clean up
      }
    } else {
      // Clear any existing new commits check if we haven't posted yet
      setNewCommitsCheck(null);
    }
  }, [reviewResult, onCheckNewCommits, hasPostedFindings]);

  useEffect(() => {
    checkForNewCommits();
  }, [checkForNewCommits]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (postSuccess) {
      const timer = setTimeout(() => setPostSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [postSuccess]);

  // Count selected findings by type for the button label
  const selectedCount = selectedFindingIds.size;

  // Check if MR is ready to merge based on review
  const isReadyToMerge = useMemo(() => {
    if (!reviewResult || !reviewResult.success) return false;
    // Check if the summary contains "READY TO MERGE"
    return reviewResult.summary?.includes('READY TO MERGE') || reviewResult.overallStatus === 'approve';
  }, [reviewResult]);

  // Compute the overall MR review status for visual display
  type MRStatus = 'not_reviewed' | 'reviewed_pending_post' | 'waiting_for_changes' | 'ready_to_merge' | 'needs_attention' | 'ready_for_followup' | 'followup_issues_remain';
  const mrStatus: { status: MRStatus; label: string; description: string; icon: React.ReactNode; color: string } = useMemo(() => {
    if (!reviewResult || !reviewResult.success) {
      return {
        status: 'not_reviewed',
        label: 'Not Reviewed',
        description: 'Run an AI review to analyze this MR',
        icon: <Sparkles className="h-5 w-5" />,
        color: 'bg-muted text-muted-foreground border-muted',
      };
    }

    const totalPosted = postedFindingIds.size + (reviewResult.postedFindingIds?.length ?? 0);
    const hasPosted = totalPosted > 0 || reviewResult.hasPostedFindings;
    const hasBlockers = reviewResult.findings.some(f => f.severity === 'critical' || f.severity === 'high');
    const unpostedFindings = reviewResult.findings.filter(f => !postedFindingIds.has(f.id) && !reviewResult.postedFindingIds?.includes(f.id));
    const hasUnpostedBlockers = unpostedFindings.some(f => f.severity === 'critical' || f.severity === 'high');
    const hasNewCommits = newCommitsCheck?.hasNewCommits ?? false;
    const newCommitCount = newCommitsCheck?.newCommitCount ?? 0;

    // Follow-up review specific statuses
    if (reviewResult.isFollowupReview) {
      const resolvedCount = reviewResult.resolvedFindings?.length ?? 0;
      const unresolvedCount = reviewResult.unresolvedFindings?.length ?? 0;
      const newIssuesCount = reviewResult.newFindingsSinceLastReview?.length ?? 0;

      // Check if any remaining issues are blockers (HIGH/CRITICAL)
      const hasBlockingIssuesRemaining = reviewResult.findings.some(
        f => (f.severity === 'critical' || f.severity === 'high')
      );

      // Check if ready for another follow-up (new commits after this follow-up)
      if (hasNewCommits) {
        return {
          status: 'ready_for_followup',
          label: 'Ready for Follow-up',
          description: `${newCommitCount} new commit${newCommitCount !== 1 ? 's' : ''} since follow-up. Run another follow-up review.`,
          icon: <RefreshCw className="h-5 w-5" />,
          color: 'bg-info/20 text-info border-info/50',
        };
      }

      // All issues resolved - ready to merge
      if (unresolvedCount === 0 && newIssuesCount === 0) {
        return {
          status: 'ready_to_merge',
          label: 'Ready to Merge',
          description: `All ${resolvedCount} issue${resolvedCount !== 1 ? 's' : ''} resolved. This MR can be merged.`,
          icon: <CheckCheck className="h-5 w-5" />,
          color: 'bg-success/20 text-success border-success/50',
        };
      }

      // No blocking issues (only MEDIUM/LOW) - can merge with suggestions
      if (!hasBlockingIssuesRemaining) {
        const suggestionsCount = unresolvedCount + newIssuesCount;
        return {
          status: 'ready_to_merge',
          label: 'Ready to Merge',
          description: `${resolvedCount} resolved. ${suggestionsCount} non-blocking suggestion${suggestionsCount !== 1 ? 's' : ''} remain.`,
          icon: <CheckCheck className="h-5 w-5" />,
          color: 'bg-success/20 text-success border-success/50',
        };
      }

      // Blocking issues still remain after follow-up
      return {
        status: 'followup_issues_remain',
        label: 'Blocking Issues',
        description: `${resolvedCount} resolved, ${unresolvedCount} blocking issue${unresolvedCount !== 1 ? 's' : ''} still open.`,
        icon: <AlertTriangle className="h-5 w-5" />,
        color: 'bg-warning/20 text-warning border-warning/50',
      };
    }

    // Initial review statuses (non-follow-up)

    // Priority 1: Ready for follow-up review (posted findings + new commits)
    if (hasPosted && hasNewCommits) {
      return {
        status: 'ready_for_followup',
        label: 'Ready for Follow-up',
        description: `${newCommitCount} new commit${newCommitCount !== 1 ? 's' : ''} since review. Run follow-up to check if issues are resolved.`,
        icon: <RefreshCw className="h-5 w-5" />,
        color: 'bg-info/20 text-info border-info/50',
      };
    }

    // Priority 2: Ready to merge (no blockers)
    if (isReadyToMerge && hasPosted) {
      return {
        status: 'ready_to_merge',
        label: 'Ready to Merge',
        description: 'No blocking issues found. This MR can be merged.',
        icon: <CheckCheck className="h-5 w-5" />,
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    // Priority 3: Waiting for changes (posted but has blockers, no new commits yet)
    if (hasPosted && hasBlockers) {
      return {
        status: 'waiting_for_changes',
        label: 'Waiting for Changes',
        description: `${totalPosted} finding${totalPosted !== 1 ? 's' : ''} posted. Waiting for contributor to address issues.`,
        icon: <AlertTriangle className="h-5 w-5" />,
        color: 'bg-warning/20 text-warning border-warning/50',
      };
    }

    // Priority 4: Ready to merge (posted, no blockers)
    if (hasPosted && !hasBlockers) {
      return {
        status: 'ready_to_merge',
        label: 'Ready to Merge',
        description: `${totalPosted} finding${totalPosted !== 1 ? 's' : ''} posted. No blocking issues remain.`,
        icon: <CheckCheck className="h-5 w-5" />,
        color: 'bg-success/20 text-success border-success/50',
      };
    }

    // Priority 5: Needs attention (unposted blockers)
    if (hasUnpostedBlockers) {
      return {
        status: 'needs_attention',
        label: 'Needs Attention',
        description: `${unpostedFindings.length} finding${unpostedFindings.length !== 1 ? 's' : ''} need to be posted to GitLab.`,
        icon: <AlertCircle className="h-5 w-5" />,
        color: 'bg-destructive/20 text-destructive border-destructive/50',
      };
    }

    // Default: Review complete, pending post
    return {
      status: 'reviewed_pending_post',
      label: 'Review Complete',
      description: `${reviewResult.findings.length} finding${reviewResult.findings.length !== 1 ? 's' : ''} found. Select and post to GitLab.`,
      icon: <MessageSquare className="h-5 w-5" />,
      color: 'bg-primary/20 text-primary border-primary/50',
    };
  }, [reviewResult, postedFindingIds, isReadyToMerge, newCommitsCheck]);

  const handlePostReview = async () => {
    const idsToPost = Array.from(selectedFindingIds);
    if (idsToPost.length === 0) return;

    setIsPostingFindings(true);
    try {
      const success = await onPostReview(idsToPost);
      if (success) {
        // Mark these findings as posted
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
      setIsPostingFindings(false);
    }
  };

  const handleApprove = async () => {
    if (!reviewResult) return;

    setIsApproving(true);
    try {
      await onApproveMR();
    } finally {
      setIsApproving(false);
    }
  };

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      await onMergeMR('squash'); // Default to squash merge
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <ErrorBoundary>
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={getMRStateColor(mr.state)}>
                {mr.state.charAt(0).toUpperCase() + mr.state.slice(1)}
              </Badge>
              <span className="text-sm text-muted-foreground">!{mr.iid}</span>
            </div>
            <Button variant="ghost" size="icon" asChild aria-label={t('accessibility.openOnGitLabAriaLabel')}>
              <a href={mr.webUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <h2 className="text-lg font-semibold text-foreground">{mr.title}</h2>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <User className="h-4 w-4" />
            {mr.author.username}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDate(mr.createdAt)}
          </div>
          <div className="flex items-center gap-1">
            <GitBranch className="h-4 w-4" />
            {mr.sourceBranch} → {mr.targetBranch}
          </div>
          {mr.assignees && mr.assignees.length > 0 && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {mr.assignees.map(a => a.username).join(', ')}
            </div>
          )}
        </div>

        {/* Merge Status */}
        {mr.mergeStatus && (
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="flex items-center gap-1">
              <FileDiff className="h-3 w-3" />
              {mr.mergeStatus}
            </Badge>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* Show Follow-up Review button if there are new commits since last review */}
            {newCommitsCheck?.hasNewCommits && !isReviewing ? (
              <Button
                onClick={onRunFollowupReview}
                disabled={isReviewing}
                className="flex-1"
                variant="secondary"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Follow-up Review ({newCommitsCheck.newCommitCount} new commit{newCommitsCheck.newCommitCount !== 1 ? 's' : ''})
              </Button>
            ) : (
              <Button
                onClick={onRunReview}
                disabled={isReviewing}
                className="flex-1"
              >
                {isReviewing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Reviewing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Run AI Review
                  </>
                )}
              </Button>
            )}
            {isReviewing && (
              <Button onClick={onCancelReview} variant="destructive">
                <XCircle className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            )}
            {reviewResult?.success && selectedCount > 0 && !isReviewing && (
              <Button onClick={handlePostReview} variant="secondary" disabled={isPostingFindings}>
                {isPostingFindings ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Posting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Post {selectedCount} Finding{selectedCount !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            )}
            {/* Success message */}
            {postSuccess && (
              <div className="flex items-center gap-2 text-success text-sm">
                <CheckCircle className="h-4 w-4" />
                Posted {postSuccess.count} finding{postSuccess.count !== 1 ? 's' : ''} to GitLab
              </div>
            )}
          </div>

          {/* Approval and Merge buttons */}
          {reviewResult?.success && isReadyToMerge && mr.state === 'opened' && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleApprove}
                disabled={isApproving}
                variant="default"
                className="flex-1 bg-success hover:bg-success/90"
              >
                {isApproving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve
                  </>
                )}
              </Button>
              <Button
                onClick={handleMerge}
                disabled={isMerging}
                variant="outline"
                className="flex-1"
              >
                {isMerging ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Merging...
                  </>
                ) : (
                  <>
                    <GitMerge className="h-4 w-4 mr-2" />
                    Merge MR
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* MR Review Status Banner */}
        <Card className={`border-2 ${mrStatus.color} ${mrStatus.status === 'ready_for_followup' ? 'animate-pulse-subtle' : ''}`}>
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${mrStatus.color}`}>
                {mrStatus.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{mrStatus.label}</div>
                <div className="text-sm text-muted-foreground truncate">{mrStatus.description}</div>
              </div>
              {mrStatus.status === 'ready_for_followup' && (
                <Button
                  onClick={onRunFollowupReview}
                  disabled={isReviewing}
                  className="bg-info hover:bg-info/90 text-info-foreground shrink-0"
                >
                  {isReviewing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Reviewing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Run Follow-up Review
                    </>
                  )}
                </Button>
              )}
              {mrStatus.status === 'waiting_for_changes' && newCommitsCheck?.hasNewCommits && (
                <Badge variant="outline" className="bg-primary/20 text-primary border-primary/50 shrink-0">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {newCommitsCheck.newCommitCount} new commit{newCommitsCheck.newCommitCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Review Progress */}
        {reviewProgress && (
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{reviewProgress.message}</span>
                  <span className="text-muted-foreground">{reviewProgress.progress}%</span>
                </div>
                <Progress value={reviewProgress.progress} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Review Result */}
        {reviewResult?.success && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {reviewResult.isFollowupReview ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {reviewResult.isFollowupReview ? 'Follow-up Review' : 'AI Review Result'}
                </span>
                <Badge variant="outline" className={getStatusColor(reviewResult.overallStatus)}>
                  {reviewResult.overallStatus === 'approve' && 'Approve'}
                  {reviewResult.overallStatus === 'request_changes' && 'Changes Requested'}
                  {reviewResult.overallStatus === 'comment' && 'Comment'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 overflow-hidden">
              {/* Follow-up Review Resolution Status */}
              {reviewResult.isFollowupReview && (
                <div className="flex flex-wrap gap-2 pb-2 border-b border-border">
                  {(reviewResult.resolvedFindings?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-success/20 text-success border-success/50">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {reviewResult.resolvedFindings?.length} resolved
                    </Badge>
                  )}
                  {(reviewResult.unresolvedFindings?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-warning/20 text-warning border-warning/50">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {reviewResult.unresolvedFindings?.length} still open
                    </Badge>
                  )}
                  {(reviewResult.newFindingsSinceLastReview?.length ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/50">
                      <XCircle className="h-3 w-3 mr-1" />
                      {reviewResult.newFindingsSinceLastReview?.length} new issue{reviewResult.newFindingsSinceLastReview?.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              )}

              <p className="text-sm text-muted-foreground break-words">{reviewResult.summary}</p>

              {/* Interactive Findings with Selection */}
              <ReviewFindings
                findings={reviewResult.findings}
                selectedIds={selectedFindingIds}
                postedIds={postedFindingIds}
                onSelectionChange={setSelectedFindingIds}
              />

              {reviewResult.reviewedAt && (
                <p className="text-xs text-muted-foreground">
                  Reviewed: {formatDate(reviewResult.reviewedAt)}
                  {reviewResult.reviewedCommitSha && (
                    <> at commit {reviewResult.reviewedCommitSha.substring(0, 7)}</>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Review Error */}
        {reviewResult && !reviewResult.success && (
          <Card className="border-destructive">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                <span className="text-sm">Review failed</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Description */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent className="overflow-hidden">
            {mr.description ? (
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-sans break-words max-w-full overflow-hidden">
                {mr.description}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description provided.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Labels */}
        {mr.labels && mr.labels.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Labels</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {mr.labels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
    </ErrorBoundary>
  );
}
