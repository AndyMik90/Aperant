import type { Tier } from "@auto-claude/types";
import * as React from "react";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "../primitives/card";
import { cn } from "../utils";

const DEFAULT_TIER_LABELS: Record<Tier, string> = {
	free: "Free",
	pro: "Pro",
	team: "Team",
	enterprise: "Enterprise",
};

export interface UpgradePromptLabels {
	title?: string;
	upgradeButton?: string;
	upgradeToPrefix?: string;
	currentPlanPrefix?: string;
	requiresSuffix?: string;
	/** Override tier display names for i18n */
	tierLabels?: Record<Tier, string>;
}

export interface UpgradePromptProps {
	feature: string;
	requiredTier: Tier;
	currentTier: Tier;
	onUpgrade?: () => void;
	compact?: boolean;
	className?: string;
	/** Override default English labels for i18n */
	labels?: UpgradePromptLabels;
}

const UpgradePrompt = React.forwardRef<HTMLDivElement, UpgradePromptProps>(
	(
		{
			feature,
			requiredTier,
			currentTier,
			onUpgrade,
			compact = false,
			className,
			labels,
		},
		ref,
	) => {
		const tierLabels = labels?.tierLabels ?? DEFAULT_TIER_LABELS;

		if (compact) {
			return (
				<div
					ref={ref}
					className={cn(
						"flex items-center gap-3 rounded-lg border border-border bg-card p-3",
						className,
					)}
				>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium truncate">
							{feature} {labels?.requiresSuffix ?? "requires"}{" "}
							<Badge variant="info">{tierLabels[requiredTier]}</Badge>
						</p>
					</div>
					{onUpgrade && (
						<Button size="sm" onClick={onUpgrade}>
							{labels?.upgradeButton ?? "Upgrade"}
						</Button>
					)}
				</div>
			);
		}

		return (
			<Card ref={ref} className={cn("max-w-md", className)}>
				<CardHeader>
					<CardTitle className="text-lg">
						{labels?.title ?? "Upgrade Required"}
					</CardTitle>
					<CardDescription>
						<span className="font-medium">{feature}</span>{" "}
						{labels?.requiresSuffix ?? "is available on the"}{" "}
						<Badge variant="info">{tierLabels[requiredTier]}</Badge> plan and
						above.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{labels?.currentPlanPrefix ?? "You are currently on the"}{" "}
						<Badge variant="outline">{tierLabels[currentTier]}</Badge> plan.
					</p>
				</CardContent>
				{onUpgrade && (
					<CardFooter>
						<Button onClick={onUpgrade} className="w-full">
							{labels?.upgradeToPrefix ?? "Upgrade to"}{" "}
							{tierLabels[requiredTier]}
						</Button>
					</CardFooter>
				)}
			</Card>
		);
	},
);
UpgradePrompt.displayName = "UpgradePrompt";

export { UpgradePrompt };
