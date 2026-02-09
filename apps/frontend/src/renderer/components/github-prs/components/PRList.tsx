import { GitPullRequest, User, Clock, FileDiff, Loader2 } from 'lucide-react';
import { ScrollArea } from '../../ui/scroll-area';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { PRData, PRReviewProgress, PRReviewResult } from '../hooks/useGitHubPRs';
import type { NewCommitsCheck } from '../../../../preload/api/modules/github-api';
import type { ChecksStatus, ReviewsStatus, MergeableState } from '../../../../shared/types/pr-status';
import { useTranslation } from 'react-i18next';
import { CompactStatusIndicator } from './StatusIndicator';

/**
 * Status Flow Dots Component
 * Shows 3-dot progression with status label: ● ● ● Ready to Merge
 *
 * States:
 * - Not started: ○ ○ ○ (gray, no label)
 * - Reviewing: ● ○ ○ Reviewing (amber, animated)
 * - Reviewed (pending post): ● ● ○ Pending Post (blue)
 * - Posted: ● ● ● [Status] (final status color + label)
 */
interface PRStatusFlowProps {
  isReviewing: boolean;
  hasResult: boolean;
  hasPosted: boolean;
  hasBlockingFindings: boolean;
  hasNewCommits: boolean;
  /** Whether commits happened AFTER findings were posted - for "Ready for Follow-up" status */
  hasCommitsAfterPosting: boolean;
  t: (key: string) => string;
}

type FlowState = 'not_started' | 'reviewing' | 'reviewed' | 'posted';
type FinalStatus = 'success' | 'warning' | 'followup';

function PRStatusFlow({
  isReviewing,
  hasResult,
  hasPosted,
  hasBlockingFindings,
  hasNewCommits,
  hasCommitsAfterPosting,
  t,
}: PRStatusFlowProps) {
  // Determine flow state - prioritize more advanced states first
  let flowState: FlowState = 'not_started';
  if (hasPosted) {
    // Posted is the most advanced state
    flowState = 'posted';
  } else if (hasResult) {
    // Has result but not posted yet
    flowState = 'reviewed';
  } else if (isReviewing) {
    // Currently reviewing (only if no result yet)
    flowState = 'reviewing';
  }

  // Determine final status color for posted state
  let finalStatus: FinalStatus = 'success';
  // Only show "Ready for Follow-up" if there are commits AFTER findings were posted
  // This prevents showing follow-up status for commits that happened during/before the review
  // hasNewCommits tells us the commits are different, hasCommitsAfterPosting tells us if they're newer
  if (hasNewCommits && hasCommitsAfterPosting) {
    finalStatus = 'followup';
  } else if (hasBlockingFindings) {
    finalStatus = 'warning';
  }

  // Dot styles based on state
  const getDotStyle = (dotIndex: 0 | 1 | 2) => {
    const baseClasses = 'h-2 w-2 rounded-full transition-all duration-300';

    // Not started - all gray
    if (flowState === 'not_started') {
      return cn(baseClasses, 'bg-muted-foreground/30');
    }

    // Reviewing - first dot amber and animated
    if (flowState === 'reviewing') {
      if (dotIndex === 0) {
        return cn(baseClasses, 'bg-amber-400 animate-pulse');
      }
      return cn(baseClasses, 'bg-muted-foreground/30');
    }

    // Reviewed - first two dots filled
    if (flowState === 'reviewed') {
      if (dotIndex === 0) {
        return cn(baseClasses, 'bg-amber-400');
      }
      if (dotIndex === 1) {
        return cn(baseClasses, 'bg-blue-400');
      }
      return cn(baseClasses, 'bg-muted-foreground/30');
    }

    // Posted - all dots filled with final status color
    if (flowState === 'posted') {
      const statusColors = {
        success: 'bg-emerald-400',
        warning: 'bg-red-400',
        followup: 'bg-cyan-400',
      };
      // First two dots stay with their process colors
      if (dotIndex === 0) {
        return cn(baseClasses, 'bg-amber-400');
      }
      if (dotIndex === 1) {
        return cn(baseClasses, 'bg-blue-400');
      }
      // Third dot shows final status
      return cn(baseClasses, statusColors[finalStatus]);
    }

    return cn(baseClasses, 'bg-muted-foreground/30');
  };

  // Get status label and styling
  const getStatusDisplay = (): { label: string; textColor: string } | null => {
    if (flowState === 'not_started') {
      return null; // No label for not started
    }
    if (flowState === 'reviewing') {
      return { label: t('prReview.reviewing'), textColor: 'text-amber-400' };
    }
    if (flowState === 'reviewed') {
      return { label: t('prReview.pendingPost'), textColor: 'text-blue-400' };
    }
    if (flowState === 'posted') {
      const statusConfig = {
        success: { label: t('prReview.readyToMerge'), textColor: 'text-emerald-400' },
        warning: { label: t('prReview.changesRequested'), textColor: 'text-red-400' },
        followup: { label: t('prReview.readyForFollowup'), textColor: 'text-cyan-400' },
      };
      return statusConfig[finalStatus];
    }
    return null;
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="flex items-center gap-1.5">
      {/* Dots */}
      <div className="flex items-center gap-1">
        <div className={getDotStyle(0)} />
        <div className={getDotStyle(1)} />
        <div className={getDotStyle(2)} />
      </div>
      {/* Label */}
      {statusDisplay && (
        <span className={cn('text-xs font-medium', statusDisplay.textColor)}>
          {statusDisplay.label}
        </span>
      )}
    </div>
  );
}

interface PRReviewInfo {
  isReviewing: boolean;
  progress: PRReviewProgress | null;
  result: PRReviewResult | null;
  error: string | null;
  newCommitsCheck?: NewCommitsCheck | null;
  /** CI checks status from polling */
  checksStatus?: ChecksStatus | null;
  /** Review status from polling */
  reviewsStatus?: ReviewsStatus | null;
  /** Mergeable state from polling */
  mergeableState?: MergeableState | null;
}

interface PRListProps {
  prs: PRData[];
  selectedPRNumber: number | null;
  isLoading: boolean;
  hasMore: boolean; // True when 100 PRs returned (GitHub limit) - more may exist
  error: string | null;
  getReviewStateForPR: (prNumber: number) => PRReviewInfo | null;
  onSelectPR: (prNumber: number) => void;
  /** Callback to load more PRs when hasMore is true */
  onLoadMore?: () => void;
  /** Whether additional PRs are currently being loaded */
  isLoadingMore?: boolean;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

export function PRList({
  prs,
  selectedPRNumber,
  isLoading,
  hasMore,
  error,
  getReviewStateForPR,
  onSelectPR,
  onLoadMore,
  isLoadingMore,
}: PRListProps) {
  const { t } = useTranslation('common');

  if (isLoading && prs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <GitPullRequest className="h-8 w-8 mx-auto mb-2 animate-pulse" />
          <p>{t('prReview.loadingPRs')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center text-destructive">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <GitPullRequest className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>{t('prReview.noOpenPRs')}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="divide-y divide-border">
        {prs.map((pr) => {
          const reviewState = getReviewStateForPR(pr.number);
          const isReviewingPR = reviewState?.isReviewing ?? false;
          const hasReviewResult = reviewState?.result !== null && reviewState?.result !== undefined;

          return (
            <button
              key={pr.number}
              onClick={() => onSelectPR(pr.number)}
              className={cn(
                'w-full p-4 text-left transition-colors hover:bg-accent/50',
                selectedPRNumber === pr.number && 'bg-accent'
              )}
            >
              <div className="flex items-start gap-3">
                <GitPullRequest className="h-5 w-5 mt-0.5 text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm text-muted-foreground">#{pr.number}</span>
                    <Badge variant="outline" className="text-xs">
                      {pr.headRefName}
                    </Badge>
                    {/* Review status flow dots + label */}
                    <PRStatusFlow
                      isReviewing={isReviewingPR}
                      hasResult={hasReviewResult}
                      hasPosted={
                        Boolean(reviewState?.result?.reviewId) ||
                        Boolean(reviewState?.result?.hasPostedFindings) ||
                        Boolean(reviewState?.result?.postedFindingIds?.length) ||
                        // Follow-up review with no new findings to post is effectively "posted"
                        (Boolean(reviewState?.result?.isFollowupReview) && reviewState?.result?.findings?.length === 0)
                      }
                      hasBlockingFindings={
                        // Use overallStatus from review result as source of truth
                        reviewState?.result?.overallStatus === 'request_changes' ||
                        // Fallback to checking findings severity
                        Boolean(reviewState?.result?.findings?.some(
                          f => f.severity === 'critical' || f.severity === 'high'
                        ))
                      }
                      hasNewCommits={Boolean(reviewState?.newCommitsCheck?.hasNewCommits)}
                      hasCommitsAfterPosting={reviewState?.newCommitsCheck?.hasCommitsAfterPosting ?? false}
                      t={t}
                    />
                  </div>
                  <h3 className="font-medium text-sm truncate">{pr.title}</h3>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {pr.author.login}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(pr.updatedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileDiff className="h-3 w-3" />
                      <span className="text-success">+{pr.additions}</span>
                      <span className="text-destructive">-{pr.deletions}</span>
                    </span>
                    {/* GitHub status indicators (CI, reviews, merge status) */}
                    <CompactStatusIndicator
                      checksStatus={reviewState?.checksStatus}
                      reviewsStatus={reviewState?.reviewsStatus}
                      mergeableState={reviewState?.mergeableState}
                      showMergeStatus={false}
                    />
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {/* Status indicator / Load More button */}
        {prs.length > 0 && (
          <div className="py-4 flex justify-center">
            {hasMore && onLoadMore ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('prReview.loadingMore')}
                  </>
                ) : (
                  t('prReview.loadMore')
                )}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground opacity-50">
                {t('prReview.allPRsLoaded')}
              </span>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
