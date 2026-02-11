import * as React from 'react';
import type { Tier } from '@auto-claude/types';
import { UpgradePrompt } from './UpgradePrompt';

const TIER_HIERARCHY: Record<Tier, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

export interface FeatureGateProps {
  requiredTier: Tier;
  currentTier: Tier;
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onUpgrade?: () => void;
}

function FeatureGate({
  requiredTier,
  currentTier,
  feature,
  children,
  fallback,
  onUpgrade,
}: FeatureGateProps) {
  if (TIER_HIERARCHY[currentTier] >= TIER_HIERARCHY[requiredTier]) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <UpgradePrompt
      feature={feature}
      requiredTier={requiredTier}
      currentTier={currentTier}
      onUpgrade={onUpgrade}
    />
  );
}

export { FeatureGate, TIER_HIERARCHY };
