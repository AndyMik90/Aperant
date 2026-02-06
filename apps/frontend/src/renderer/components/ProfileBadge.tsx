/**
 * ProfileBadge Component
 *
 * Displays the assigned profile for a task with visual indicators
 * for the assignment reason (proactive, reactive, manual).
 *
 * Part of the intelligent rate limit recovery system.
 */

import { User } from 'lucide-react';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { ProfileAssignmentReason } from '@shared/types';
import { useTranslation } from 'react-i18next';

interface ProfileBadgeProps {
  /** Display name of the assigned profile */
  profileName: string;
  /** Reason the profile was assigned */
  assignmentReason?: ProfileAssignmentReason;
  /** Whether the task is currently running */
  isRunning?: boolean;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get badge variant based on assignment reason
 */
function getBadgeVariant(reason?: ProfileAssignmentReason, isRunning?: boolean): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (!isRunning) return 'secondary';

  switch (reason) {
    case 'proactive':
      return 'default';  // Green - proactively assigned
    case 'reactive':
      return 'outline';  // Yellow/outline - assigned after rate limit
    case 'manual':
      return 'secondary';  // Blue - manually selected
    default:
      return 'secondary';
  }
}

/**
 * Get badge color class based on assignment reason
 */
function getBadgeColorClass(reason?: ProfileAssignmentReason, isRunning?: boolean): string {
  if (!isRunning) return '';

  switch (reason) {
    case 'proactive':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-300 dark:border-green-700';
    case 'reactive':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700';
    case 'manual':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-700';
    default:
      return '';
  }
}

/**
 * ProfileBadge - Shows which Claude profile is assigned to a task
 *
 * Visual indicators:
 * - Green: Proactively assigned (best available profile at task start)
 * - Yellow: Reactively assigned (swapped after rate limit)
 * - Blue: Manually assigned (user selected)
 */
export function ProfileBadge({
  profileName,
  assignmentReason,
  isRunning = false,
  compact = false,
  className = ''
}: ProfileBadgeProps) {
  const { t } = useTranslation(['tasks']);

  // Truncate long profile names
  const displayName = profileName.length > 15
    ? `${profileName.slice(0, 12)}...`
    : profileName;

  const tooltipContent = (
    <div className="text-sm">
      <div className="font-medium">{profileName}</div>
      {assignmentReason && (
        <div className="text-muted-foreground">
          {t(`tasks:profileBadge.reason.${assignmentReason}`)}
        </div>
      )}
    </div>
  );

  const badge = (
    <Badge
      variant={getBadgeVariant(assignmentReason, isRunning)}
      className={`
        ${getBadgeColorClass(assignmentReason, isRunning)}
        ${compact ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}
        ${className}
      `}
    >
      <User className={compact ? 'h-3 w-3 mr-0.5' : 'h-3 w-3 mr-1'} />
      {displayName}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent>
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * ProfileSwapIndicator - Shows when a task's profile was swapped
 * Used in task history to show profile swap events
 */
export function ProfileSwapIndicator({
  fromProfile,
  toProfile,
  reason
}: {
  fromProfile: string;
  toProfile: string;
  reason: 'capacity' | 'rate_limit' | 'manual' | 'recovery';
}) {
  const { t } = useTranslation(['tasks']);

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="line-through">{fromProfile}</span>
      <span>-&gt;</span>
      <span className="font-medium">{toProfile}</span>
      <span className="text-xs">({t(`tasks:profileBadge.swapReason.${reason}`)})</span>
    </div>
  );
}
