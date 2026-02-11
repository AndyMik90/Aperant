import * as React from 'react';
import { Badge } from '../primitives/badge';
import { UpgradePrompt } from './UpgradePrompt';
import { cn } from '../utils';

export interface UsageLimitGateProps {
  resource: string;
  currentUsage: number;
  limit: number;
  children: React.ReactNode;
  onUpgrade?: () => void;
  warningThreshold?: number;
  fallback?: React.ReactNode;
}

function UsageLimitGate({
  resource,
  currentUsage,
  limit,
  children,
  onUpgrade,
  warningThreshold = 0.8,
  fallback,
}: UsageLimitGateProps) {
  const ratio = limit > 0 ? currentUsage / limit : 1;
  const isAtLimit = currentUsage >= limit;
  const isApproachingLimit = ratio >= warningThreshold && !isAtLimit;

  if (isAtLimit) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }

    return (
      <UpgradePrompt
        feature={resource}
        requiredTier="pro"
        currentTier="free"
        onUpgrade={onUpgrade}
        compact
      />
    );
  }

  return (
    <>
      {children}
      {isApproachingLimit && (
        <div
          className={cn(
            'mt-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm'
          )}
        >
          <Badge variant="warning">
            {currentUsage}/{limit}
          </Badge>
          <span className="text-muted-foreground">
            You&apos;re approaching the {resource} limit.
          </span>
          {onUpgrade && (
            <button
              onClick={onUpgrade}
              className="ml-auto text-sm font-medium text-primary hover:underline"
            >
              Upgrade
            </button>
          )}
        </div>
      )}
    </>
  );
}

export { UsageLimitGate };
