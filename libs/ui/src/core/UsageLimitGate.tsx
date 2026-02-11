import type { Tier } from "@auto-claude/types";
import type * as React from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../utils";
import { UpgradePrompt } from "./UpgradePrompt";

export interface UsageLimitGateProps {
	resource: string;
	currentUsage: number;
	limit: number;
	children: React.ReactNode;
	onUpgrade?: () => void;
	warningThreshold?: number;
	fallback?: React.ReactNode;
	/** The user's current tier (shown when at limit). Defaults to 'free'. */
	currentTier?: Tier;
	/** The tier required to unlock more usage (shown when at limit). Defaults to 'pro'. */
	upgradeTier?: Tier;
	/** Override the warning message shown when approaching the limit */
	warningMessage?: string;
	/** Override the upgrade button label */
	upgradeLabel?: string;
}

function UsageLimitGate({
	resource,
	currentUsage,
	limit,
	children,
	onUpgrade,
	warningThreshold = 0.8,
	fallback,
	currentTier = "free",
	upgradeTier = "pro",
	warningMessage,
	upgradeLabel = "Upgrade",
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
				requiredTier={upgradeTier}
				currentTier={currentTier}
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
						"mt-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm",
					)}
				>
					<Badge variant="warning">
						{currentUsage}/{limit}
					</Badge>
					<span className="text-muted-foreground">
						{warningMessage ?? `You're approaching the ${resource} limit.`}
					</span>
					{onUpgrade && (
						<button
							onClick={onUpgrade}
							className="ml-auto text-sm font-medium text-primary hover:underline"
						>
							{upgradeLabel}
						</button>
					)}
				</div>
			)}
		</>
	);
}

export { UsageLimitGate };
