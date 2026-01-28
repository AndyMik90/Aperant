/**
 * Badge component for displaying ticket relationship status
 * Shows duplicate/related ticket counts with visual indicators
 */

import { Link2, Merge } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../../ui/tooltip";

export interface TicketRelationships {
	duplicates: number;
	related: number;
}

interface TicketLinkingBadgeProps {
	relationships: TicketRelationships;
	onClick?: () => void;
	ticketId: string;
}

export function TicketLinkingBadge({
	relationships,
	onClick,
	ticketId,
}: TicketLinkingBadgeProps) {
	const { t } = useTranslation(["common", "linear"]);

	const totalLinks = useMemo(
		() => relationships.duplicates + relationships.related,
		[relationships.duplicates, relationships.related],
	);

	if (totalLinks === 0) {
		return null;
	}

	// Determine badge style based on relationship types
	const getBadgeStyle = () => {
		if (relationships.duplicates > 0) {
			return "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/30";
		}
		if (relationships.related > 0) {
			return "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/30";
		}
		return "";
	};

	const getIcon = () => {
		if (relationships.duplicates > 0) {
			return <Merge className="h-3 w-3" />;
		}
		return <Link2 className="h-3 w-3" />;
	};

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					{onClick ? (
						<Button
							variant="outline"
							size="sm"
							onClick={onClick}
							className={`h-6 px-2 gap-1 ${getBadgeStyle()}`}
						>
							{getIcon()}
							<span className="text-xs">{totalLinks}</span>
						</Button>
					) : (
						<Badge
							variant="outline"
							className={`h-6 px-2 gap-1 ${getBadgeStyle()}`}
						>
							{getIcon()}
							<span className="text-xs">{totalLinks}</span>
						</Badge>
					)}
				</TooltipTrigger>
				<TooltipContent>
					<div className="space-y-1">
						<p className="font-medium">{ticketId}</p>
						{relationships.duplicates > 0 && (
							<p className="text-xs flex items-center gap-1">
								<Merge className="h-3 w-3" />
								{relationships.duplicates}{" "}
								{t("linear:duplicate", { count: relationships.duplicates })}
							</p>
						)}
						{relationships.related > 0 && (
							<p className="text-xs flex items-center gap-1">
								<Link2 className="h-3 w-3" />
								{relationships.related}{" "}
								{t("linear:related", { count: relationships.related })}
							</p>
						)}
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
