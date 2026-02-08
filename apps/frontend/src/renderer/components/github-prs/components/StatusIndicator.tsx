import { CheckCircle2, Circle, XCircle, Loader2, AlertTriangle, GitMerge, Ban, HelpCircle } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { ChecksStatus, ReviewsStatus, MergeableState } from '../../../../shared/types/pr-status';
import { useTranslation } from 'react-i18next';

/**
 * CI Status Icon Component
 * Displays an icon representing the CI checks status
 */
interface CIStatusIconProps {
  status: ChecksStatus;
  className?: string;
}

function CIStatusIcon({ status, className }: CIStatusIconProps) {
  const baseClasses = 'h-4 w-4';

  switch (status) {
    case 'success':
      return <CheckCircle2 className={cn(baseClasses, 'text-emerald-400', className)} />;
    case 'pending':
      return <Loader2 className={cn(baseClasses, 'text-amber-400 animate-spin', className)} />;
    case 'failure':
      return <XCircle className={cn(baseClasses, 'text-red-400', className)} />;
    case 'none':
    default:
      return <Circle className={cn(baseClasses, 'text-muted-foreground/50', className)} />;
  }
}

/**
 * Review Status Badge Component
 * Displays a badge representing the review status
 */
interface ReviewStatusBadgeProps {
  status: ReviewsStatus;
  className?: string;
}

function ReviewStatusBadge({ status, className }: ReviewStatusBadgeProps) {
  const { t } = useTranslation('common');

  switch (status) {
    case 'approved':
      return (
        <Badge variant="success" className={cn('gap-1', className)}>
          <CheckCircle2 className="h-3 w-3" />
          {t('prStatus.review.approved')}
        </Badge>
      );
    case 'changes_requested':
      return (
        <Badge variant="destructive" className={cn('gap-1', className)}>
          <AlertTriangle className="h-3 w-3" />
          {t('prStatus.review.changesRequested')}
        </Badge>
      );
    case 'pending':
      return (
        <Badge variant="warning" className={cn('gap-1', className)}>
          <Circle className="h-3 w-3" />
          {t('prStatus.review.pending')}
        </Badge>
      );
    case 'none':
    default:
      return null;
  }
}

/**
 * Merge Readiness Icon Component
 * Displays an icon representing the merge readiness state
 */
interface MergeReadinessIconProps {
  state: MergeableState;
  className?: string;
}

function MergeReadinessIcon({ state, className }: MergeReadinessIconProps) {
  const baseClasses = 'h-4 w-4';

  switch (state) {
    case 'clean':
      return <GitMerge className={cn(baseClasses, 'text-emerald-400', className)} />;
    case 'dirty':
      return <AlertTriangle className={cn(baseClasses, 'text-amber-400', className)} />;
    case 'blocked':
      return <Ban className={cn(baseClasses, 'text-red-400', className)} />;
    case 'unknown':
    default:
      return <HelpCircle className={cn(baseClasses, 'text-muted-foreground/50', className)} />;
  }
}

/**
 * StatusIndicator Props
 */
export interface StatusIndicatorProps {
  /** CI checks status */
  checksStatus?: ChecksStatus | null;
  /** Review status */
  reviewsStatus?: ReviewsStatus | null;
  /** Mergeable state */
  mergeableState?: MergeableState | null;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show a compact version (icons only) */
  compact?: boolean;
  /** Whether to show the merge readiness indicator */
  showMergeStatus?: boolean;
}

/**
 * StatusIndicator Component
 *
 * Displays CI status (success/pending/failure icons), review status
 * (approved/changes_requested/pending badges), and merge readiness
 * for GitHub PRs in the PR list view.
 *
 * Used alongside the existing PRStatusFlow dots component to provide
 * real-time PR status from GitHub's API polling.
 */
const mergeKeyMap: Record<string, string> = {
  clean: 'ready',
  dirty: 'conflict',
  blocked: 'blocked',
};

export function StatusIndicator({
  checksStatus,
  reviewsStatus,
  mergeableState,
  className,
  compact = false,
  showMergeStatus = true,
}: StatusIndicatorProps) {
  const { t } = useTranslation('common');

  // Don't render if no status data is available
  if (!checksStatus && !reviewsStatus && !mergeableState) {
    return null;
  }

  const mergeKey = mergeableState ? mergeKeyMap[mergeableState] : null;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* CI Status */}
      {checksStatus && checksStatus !== 'none' && (
        <div className="flex items-center gap-1" title={t(`prStatus.ci.${checksStatus}`)}>
          <CIStatusIcon status={checksStatus} />
          {!compact && (
            <span className="text-xs text-muted-foreground">
              {t(`prStatus.ci.${checksStatus}`)}
            </span>
          )}
        </div>
      )}

      {/* Review Status */}
      {reviewsStatus && reviewsStatus !== 'none' && (
        compact ? (
          <ReviewStatusBadge status={reviewsStatus} className="px-1.5 py-0" />
        ) : (
          <ReviewStatusBadge status={reviewsStatus} />
        )
      )}

      {/* Merge Readiness */}
      {showMergeStatus && mergeKey && (
        <div className="flex items-center gap-1" title={t(`prStatus.merge.${mergeKey}`)}>
          <MergeReadinessIcon state={mergeableState!} />
          {!compact && (
            <span className="text-xs text-muted-foreground">
              {t(`prStatus.merge.${mergeKey}`)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact Status Indicator
 *
 * A minimal version showing just icons with tooltips.
 * Useful for tight spaces in the PR list.
 */
export function CompactStatusIndicator(props: Omit<StatusIndicatorProps, 'compact'>) {
  return <StatusIndicator {...props} compact />;
}

// Re-export sub-components for flexibility
export { CIStatusIcon, ReviewStatusBadge, MergeReadinessIcon };
