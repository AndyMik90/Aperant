import { useState } from 'react';
import { AlertCircle, CheckCircle, Circle, CircleDot, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { CollapsibleCard } from './CollapsibleCard';
import type { PRReviewResult } from '../hooks/useGitHubPRs';
import type { NewCommitsCheck } from '../../../../preload/api/modules/github-api';
import { formatDate } from '../utils/formatDate';

export type ReviewStatus =
  | 'not_reviewed'
  | 'reviewed_pending_post'
  | 'waiting_for_changes'
  | 'ready_to_merge'
  | 'needs_attention'
  | 'ready_for_followup'
  | 'followup_issues_remain'
  | 'reviewing';

export interface ReviewStatusTreeProps {
  status: ReviewStatus;
  isReviewing: boolean;
  isExternalReview?: boolean;
  startedAt: string | null;
  reviewResult: PRReviewResult | null;
  previousReviewResult: PRReviewResult | null;
  postedCount: number;
  reviewError?: string | null;
  onRunReview: () => void;
  onRunFollowupReview: () => void;
  onCancelReview: () => void;
  newCommitsCheck: NewCommitsCheck | null;
  lastPostedAt?: number | null;
}

/**
 * Compact Tree View for Review Process
 * Shows the current status and history of a PR review
 */
export function ReviewStatusTree({
  status,
  isReviewing,
  isExternalReview = false,
  startedAt,
  reviewResult,
  previousReviewResult,
  postedCount,
  reviewError,
  onRunReview,
  onRunFollowupReview,
  onCancelReview,
  newCommitsCheck,
  lastPostedAt
}: ReviewStatusTreeProps) {
  const { t, i18n } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(true);

  // Determine if this is a follow-up review in progress (for edge case handling)
  const isFollowupInProgress = isReviewing && (previousReviewResult !== null || reviewResult?.isFollowupReview);

  // If not reviewed, show simple status (with error if present)
  if (status === 'not_reviewed' && !isReviewing) {
    if (reviewError) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-y-3 p-4 border rounded-lg bg-card shadow-sm border-destructive/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />
            <div className="min-w-0">
              <span className="font-medium text-destructive truncate block">{t('prReview.reviewFailed')}</span>
              <span className="text-xs text-muted-foreground truncate block mt-0.5">{reviewError}</span>
            </div>
          </div>
          <Button onClick={onRunReview} size="sm" variant="outline" className="gap-2 shrink-0 ml-auto sm:ml-0">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('prReview.retryReview')}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-between gap-y-3 p-4 border rounded-lg bg-card shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/30" />
          <span className="font-medium text-muted-foreground truncate">{t('prReview.notReviewed')}</span>
        </div>
        <Button onClick={onRunReview} size="sm" className="gap-2 shrink-0 ml-auto sm:ml-0">
          <Play className="h-3.5 w-3.5" />
          {t('prReview.runAIReview')}
        </Button>
      </div>
    );
  }

  // Determine steps for the tree
  const steps: { id: string; label: string; status: string; date?: string | null; action?: React.ReactNode }[] = [];

  // When follow-up is in progress, show continuation (handle edge case where previousReviewResult may be null)
  if (isFollowupInProgress) {
    // Show previous review as completed context (if available)
    if (previousReviewResult) {
      steps.push({
        id: 'prev_review',
        label: t('prReview.previousReview', { count: previousReviewResult.findings.length }),
        status: 'completed',
        date: previousReviewResult.reviewedAt
      });

      // Show posted findings from previous review
      const prevPostedCount = previousReviewResult.postedFindingIds?.length ?? 0;
      if (previousReviewResult.hasPostedFindings || prevPostedCount > 0) {
        steps.push({
          id: 'prev_posted',
          label: t('prReview.findingsPosted', { count: prevPostedCount }),
          status: 'completed',
          date: previousReviewResult.postedAt
        });
      }
    } else {
      // Edge case: Follow-up review starting but previous result hasn't loaded yet
      steps.push({
        id: 'prev_review',
        label: t('prReview.reviewStatus'),
        status: 'completed',
        date: null
      });
    }

    // Show new commits that triggered follow-up
    if (newCommitsCheck?.hasNewCommits) {
      steps.push({
        id: 'new_commits',
        label: t('prReview.newCommits', { count: newCommitsCheck.newCommitCount }),
        status: 'completed',
        date: null
      });
    }

    // Show follow-up in progress
    steps.push({
      id: 'followup_analysis',
      label: t('prReview.followupInProgress'),
      status: 'current',
      date: null
    });
  } else {
    // Original logic for initial review or completed follow-up

    // Step 1: Start
    steps.push({
      id: 'start',
      label: t('prReview.reviewStarted'),
      status: 'completed',
      date: startedAt || reviewResult?.reviewedAt || new Date().toISOString()
    });

    // Step 2: AI Analysis
    if (isReviewing) {
      steps.push({
        id: 'analysis',
        label: isExternalReview
          ? t('prReview.reviewStartedExternally')
          : t('prReview.analysisInProgress'),
        status: 'current',
        date: null
      });
    } else if (reviewResult) {
      steps.push({
        id: 'analysis',
        label: t('prReview.analysisComplete', { count: reviewResult.findings.length }),
        status: 'completed',
        date: reviewResult.reviewedAt,
        action: (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRunReview}
            className="ml-2 h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
            title={t('prReview.rerunReview')}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )
      });
    }

    // Step 3: Posting
    if (postedCount > 0 || reviewResult?.hasPostedFindings) {
      steps.push({
        id: 'posted',
        label: t('prReview.findingsPostedToGitHub'),
        status: 'completed',
        date: reviewResult?.postedAt || (lastPostedAt ? new Date(lastPostedAt).toISOString() : null)
      });
    } else if (reviewResult && reviewResult.findings.length > 0) {
      steps.push({
        id: 'posted',
        label: t('prReview.pendingPost'),
        status: 'pending',
        date: null
      });
    }

    // Step 4: Follow-up (only show when findings were POSTED and new commits happened after posting)
    // This prevents showing follow-up prompts when initial review was never posted to GitHub
    const hasPostedFindings = postedCount > 0 || reviewResult?.hasPostedFindings;
    if (!isReviewing && hasPostedFindings && newCommitsCheck?.hasNewCommits && newCommitsCheck?.hasCommitsAfterPosting) {
      // Check if new commits overlap with files that had findings
      const hasOverlap = newCommitsCheck.hasOverlapWithFindings ?? true; // Default to true for safety

      if (hasOverlap) {
        // Files with findings were modified - need verification
        steps.push({
          id: 'new_commits',
          label: t('prReview.newCommitsOverlap', {
            count: newCommitsCheck.newCommitCount,
            files: newCommitsCheck.overlappingFiles?.length ?? 0
          }),
          status: 'alert',
          date: null
        });
        steps.push({
          id: 'followup',
          label: t('prReview.verifyChanges'),
          status: 'pending',
          action: (
            <Button size="sm" variant="outline" onClick={onRunFollowupReview} className="ml-2 h-6 text-xs px-2">
              {t('prReview.runFollowup')}
            </Button>
          )
        });
      } else {
        // No overlap - branch synced, previous review still valid
        steps.push({
          id: 'branch_synced',
          label: newCommitsCheck.isMergeFromBase
            ? t('prReview.branchSynced', { count: newCommitsCheck.newCommitCount })
            : t('prReview.newCommitsNoOverlap', { count: newCommitsCheck.newCommitCount }),
          status: 'completed',
          date: null,
          action: (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRunFollowupReview}
              className="ml-2 h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
              title={t('prReview.runFollowupAnyway')}
            >
              {t('prReview.verifyAnyway')}
            </Button>
          )
        });
      }
    }
  }

  // Status dot color - explicitly handle all statuses
  const getStatusDotColor = (): string => {
    if (isReviewing) return "bg-blue-500 animate-pulse";
    switch (status) {
      case 'ready_to_merge':
        return "bg-success";
      case 'waiting_for_changes':
        return "bg-warning";
      case 'reviewed_pending_post':
        return "bg-primary";
      case 'ready_for_followup':
        return "bg-info";
      case 'needs_attention':
        return "bg-destructive";
      case 'followup_issues_remain':
        return "bg-warning";
      default:
        return "bg-muted-foreground";
    }
  };
  const statusDotColor = cn("h-2.5 w-2.5 shrink-0 rounded-full", getStatusDotColor());

  // Status label - explicitly handle all statuses
  const getStatusLabel = (): string => {
    if (isReviewing) return isExternalReview ? t('prReview.externalReviewDetected') : t('prReview.aiReviewInProgress');
    switch (status) {
      case 'ready_to_merge':
        return t('prReview.readyToMerge');
      case 'waiting_for_changes':
        return t('prReview.waitingForChanges');
      case 'reviewed_pending_post':
        return t('prReview.reviewComplete');
      case 'ready_for_followup':
        return t('prReview.readyForFollowup');
      case 'needs_attention':
        return t('prReview.needsAttention');
      case 'followup_issues_remain':
        return t('prReview.blockingIssues');
      default:
        return t('prReview.reviewStatus');
    }
  };
  const statusLabel = getStatusLabel();

  return (
    <CollapsibleCard
      title={statusLabel}
      icon={<div className={statusDotColor} />}
      headerAction={isReviewing && !isExternalReview ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onCancelReview(); }}
          className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {t('prReview.cancel')}
        </Button>
      ) : undefined}
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <div className="p-4 pt-0">
        <div className="relative pl-2 ml-2 border-l border-border/50 space-y-4 pt-4">
          {steps.map((step) => (
            <div key={step.id} className="relative flex items-start gap-3 pl-4">
              {/* Node Dot */}
              <div className={cn("absolute -left-[13px] top-1 bg-background rounded-full p-0.5 border",
                step.status === 'completed' ? "border-success text-success" :
                step.status === 'current' ? "border-primary text-primary animate-pulse" :
                step.status === 'alert' ? "border-warning text-warning" :
                "border-muted-foreground text-muted-foreground"
              )}>
                {step.status === 'completed' ? <CheckCircle className="h-3 w-3" /> :
                  step.status === 'current' ? <CircleDot className="h-3 w-3" /> :
                  <Circle className="h-3 w-3" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("text-sm font-medium truncate max-w-full",
                    step.status === 'completed' ? "text-foreground" :
                    step.status === 'current' ? "text-primary" :
                    "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                  {step.action}
                </div>
                {step.date && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(step.date, i18n.language)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleCard>
  );
}
