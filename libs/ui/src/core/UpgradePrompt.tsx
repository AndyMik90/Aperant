import * as React from 'react';
import type { Tier } from '@auto-claude/types';
import { Button } from '../primitives/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '../primitives/card';
import { Badge } from '../primitives/badge';
import { cn } from '../utils';

const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export interface UpgradePromptProps {
  feature: string;
  requiredTier: Tier;
  currentTier: Tier;
  onUpgrade?: () => void;
  compact?: boolean;
  className?: string;
}

const UpgradePrompt = React.forwardRef<HTMLDivElement, UpgradePromptProps>(
  ({ feature, requiredTier, currentTier, onUpgrade, compact = false, className }, ref) => {
    if (compact) {
      return (
        <div
          ref={ref}
          className={cn(
            'flex items-center gap-3 rounded-lg border border-border bg-card p-3',
            className
          )}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {feature} requires <Badge variant="info">{TIER_LABELS[requiredTier]}</Badge>
            </p>
          </div>
          {onUpgrade && (
            <Button size="sm" onClick={onUpgrade}>
              Upgrade
            </Button>
          )}
        </div>
      );
    }

    return (
      <Card ref={ref} className={cn('max-w-md', className)}>
        <CardHeader>
          <CardTitle className="text-lg">Upgrade Required</CardTitle>
          <CardDescription>
            <span className="font-medium">{feature}</span> is available on the{' '}
            <Badge variant="info">{TIER_LABELS[requiredTier]}</Badge> plan and above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You are currently on the{' '}
            <Badge variant="outline">{TIER_LABELS[currentTier]}</Badge> plan.
          </p>
        </CardContent>
        {onUpgrade && (
          <CardFooter>
            <Button onClick={onUpgrade} className="w-full">
              Upgrade to {TIER_LABELS[requiredTier]}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }
);
UpgradePrompt.displayName = 'UpgradePrompt';

export { UpgradePrompt };
