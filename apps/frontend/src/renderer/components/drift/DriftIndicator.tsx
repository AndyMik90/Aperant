/**
 * DriftIndicator Component
 *
 * Displays a small visual indicator of drift status.
 * Used in TaskCard badges and TaskDetails header.
 */

import * as React from 'react';
import { cn } from '../../lib/utils';
import { useDriftAlertLevel } from '../../stores/drift-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';

interface DriftIndicatorProps {
  taskId: string;
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Small drift status indicator (dot or badge)
 */
export function DriftIndicator({
  taskId,
  className,
  showLabel = false,
  size = 'sm',
}: DriftIndicatorProps) {
  const alertLevel = useDriftAlertLevel(taskId);

  // Don't render if no alert level
  if (!alertLevel) {
    return null;
  }

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const colorClasses = {
    normal: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
  };

  const pulseClasses = {
    normal: '',
    warning: 'animate-pulse',
    critical: 'animate-pulse',
  };

  const labelText = {
    normal: 'Normal',
    warning: 'Drift Warning',
    critical: 'Drift Alert',
  };

  const tooltipText = {
    normal: 'Agent behavior is within normal range',
    warning: 'Agent behavior shows some deviation from baseline',
    critical: 'Significant behavioral drift detected - review recommended',
  };

  const indicator = (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div
        className={cn(
          'rounded-full',
          sizeClasses[size],
          colorClasses[alertLevel],
          pulseClasses[alertLevel]
        )}
      />
      {showLabel && (
        <span
          className={cn(
            'text-xs font-medium',
            alertLevel === 'normal' && 'text-emerald-500',
            alertLevel === 'warning' && 'text-amber-500',
            alertLevel === 'critical' && 'text-red-500'
          )}
        >
          {labelText[alertLevel]}
        </span>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{indicator}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-sm">{tooltipText[alertLevel]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Drift badge for task cards
 */
interface DriftBadgeProps {
  taskId: string;
  score?: number;
  className?: string;
}

export function DriftBadge({ taskId, score, className }: DriftBadgeProps) {
  const alertLevel = useDriftAlertLevel(taskId);

  // Don't render if normal or no data
  if (!alertLevel || alertLevel === 'normal') {
    return null;
  }

  const badgeClasses = {
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    critical: 'bg-red-500/10 text-red-500 border-red-500/20',
  };

  const iconClasses = {
    warning: 'text-amber-500',
    critical: 'text-red-500',
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border',
              badgeClasses[alertLevel],
              className
            )}
          >
            <svg
              className={cn('w-3 h-3', iconClasses[alertLevel])}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            {score !== undefined && <span>{(score * 100).toFixed(0)}%</span>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-sm font-medium">
            {alertLevel === 'warning'
              ? 'Behavioral drift warning'
              : 'Critical behavioral drift'}
          </p>
          {score !== undefined && (
            <p className="text-xs text-muted-foreground">
              Drift score: {(score * 100).toFixed(1)}%
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact drift score display
 */
interface DriftScoreProps {
  score: number;
  alertLevel: 'normal' | 'warning' | 'critical';
  className?: string;
}

export function DriftScore({ score, alertLevel, className }: DriftScoreProps) {
  const colorClasses = {
    normal: 'text-emerald-500',
    warning: 'text-amber-500',
    critical: 'text-red-500',
  };

  return (
    <span
      className={cn(
        'font-mono text-sm font-medium',
        colorClasses[alertLevel],
        className
      )}
    >
      {(score * 100).toFixed(1)}%
    </span>
  );
}

export default DriftIndicator;
