import { Clock, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LinearTicket } from "../../../../shared/types/integrations";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";

/**
 * Screen reader-only text utility
 */
function SrOnly({ children }: { children: React.ReactNode }) {
	return (
		<span className="sr-only absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0">
			{children}
		</span>
	);
}

interface ValidationStatusInfo {
	isValidating: boolean;
	hasResult: boolean;
}

interface LinearTicketItemProps {
	ticket: LinearTicket;
	isSelected: boolean;
	validationInfo: ValidationStatusInfo | null;
	onClick: () => void;
	onToggleSelect?: () => void;
}

/**
 * Priority badge colors based on Linear priority levels (0-4, where 1 is urgent)
 */
function getPriorityColor(priority: number): string {
	const colors = {
		1: "bg-red-400/10 text-red-400 border-red-400/20", // Urgent
		2: "bg-orange-400/10 text-orange-400 border-orange-400/20", // High
		3: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20", // Medium
		4: "bg-blue-400/10 text-blue-400 border-blue-400/20", // Low
		0: "bg-gray-400/10 text-gray-400 border-gray-400/20", // No priority
	};
	return colors[priority as keyof typeof colors] || colors[0];
}

/**
 * Status badge colors based on Linear state type
 */
function getStateColor(stateType: string): string {
	const colors = {
		backlog: "bg-gray-400/10 text-gray-400 border-gray-400/20",
		unstarted: "bg-slate-400/10 text-slate-400 border-slate-400/20",
		started: "bg-blue-400/10 text-blue-400 border-blue-400/20",
		completed: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
		canceled: "bg-red-400/10 text-red-400 border-red-400/20",
	};
	return colors[stateType as keyof typeof colors] || colors.backlog;
}

/**
 * Validation Status Flow Component
 * Shows 3-dot progression with status label: ● ● ● Validation Complete
 *
 * States:
 * - Not started: ○ ○ ○ (gray, no label)
 * - Validating: ● ○ ○ Validating (amber, animated)
 * - Validated (pending update): ● ● ○ Pending Update (blue)
 * - Updated: ● ● ● [Status] (final status color + label)
 */
interface ValidationStatusFlowProps {
	validationInfo: ValidationStatusInfo | null;
	t: (key: string) => string;
}

type FlowState = "not_started" | "validating" | "validated" | "updated";
type FinalStatus = "success" | "warning" | "followup";

function ValidationStatusFlow({
	validationInfo,
	t,
}: ValidationStatusFlowProps) {
	// If no validation info, show not started
	if (!validationInfo) {
		return (
			<div className="flex items-center gap-1.5">
				<div className="flex items-center gap-1">
					<div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
					<div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
					<div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
				</div>
			</div>
		);
	}

	const { isValidating, hasResult } = validationInfo;

	// Determine flow state - prioritize more advanced states first
	let flowState: FlowState = "not_started";
	if (hasResult && !isValidating) {
		flowState = "validated";
	} else if (isValidating) {
		flowState = "validating";
	} else if (hasResult) {
		flowState = "validated";
	}

	// Linear doesn't track changes after posting or blocking findings
	const finalStatus: FinalStatus = "success";

	// Dot styles based on state
	const getDotStyle = (dotIndex: 0 | 1 | 2) => {
		const baseClasses = "h-2 w-2 rounded-full transition-all duration-300";

		// Not started - all gray
		if (flowState === "not_started") {
			return cn(baseClasses, "bg-muted-foreground/30");
		}

		// Validating - first dot amber and animated
		if (flowState === "validating") {
			if (dotIndex === 0) {
				return cn(baseClasses, "bg-amber-400 animate-pulse");
			}
			return cn(baseClasses, "bg-muted-foreground/30");
		}

		// Validated - first two dots filled
		if (flowState === "validated") {
			if (dotIndex === 0) {
				return cn(baseClasses, "bg-amber-400");
			}
			if (dotIndex === 1) {
				return cn(baseClasses, "bg-blue-400");
			}
			return cn(baseClasses, "bg-muted-foreground/30");
		}

		// Updated - all dots filled with final status color
		if (flowState === "updated") {
			const statusColors = {
				success: "bg-emerald-400",
				warning: "bg-red-400",
				followup: "bg-cyan-400",
			};
			// First two dots stay with their process colors
			if (dotIndex === 0) {
				return cn(baseClasses, "bg-amber-400");
			}
			if (dotIndex === 1) {
				return cn(baseClasses, "bg-blue-400");
			}
			// Third dot shows final status
			return cn(baseClasses, statusColors[finalStatus]);
		}

		return cn(baseClasses, "bg-muted-foreground/30");
	};

	// Get status label and styling
	const getStatusDisplay = (): { label: string; textColor: string } | null => {
		if (flowState === "not_started") {
			return null; // No label for not started
		}
		if (flowState === "validating") {
			return {
				label: t("linear:validationInProgress"),
				textColor: "text-amber-400",
			};
		}
		if (flowState === "validated") {
			return {
				label: t("linear:validationComplete"),
				textColor: "text-blue-400",
			};
		}
		if (flowState === "updated") {
			const statusConfig = {
				success: {
					label: t("linear:analysisComplete"),
					textColor: "text-emerald-400",
				},
				warning: {
					label: t("linear:analysisComplete"),
					textColor: "text-red-400",
				},
				followup: {
					label: t("linear:oneNewChange"),
					textColor: "text-cyan-400",
				},
			};
			return statusConfig[finalStatus];
		}
		return null;
	};

	const statusDisplay = getStatusDisplay();

	// Get screen reader text for validation status
	const getValidationSrText = (): string => {
		if (flowState === "not_started") return t("linear:selectTicket");
		if (flowState === "validating") return t("linear:validationInProgress");
		if (flowState === "validated") return t("linear:validationComplete");
		if (flowState === "updated") {
			const statusConfig = {
				success: t("linear:analysisComplete"),
				warning: t("linear:analysisComplete"),
				followup: t("linear:oneNewChange"),
			};
			return statusConfig[finalStatus];
		}
		return "";
	};

	return (
		<div
			className="flex items-center gap-1.5"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{/* Dots */}
			<div className="flex items-center gap-1">
				<div className={getDotStyle(0)} />
				<div className={getDotStyle(1)} />
				<div className={getDotStyle(2)} />
			</div>
			{/* Label */}
			{statusDisplay && (
				<>
					<span className={cn("text-xs font-medium", statusDisplay.textColor)}>
						{statusDisplay.label}
					</span>
					<SrOnly>{getValidationSrText()}</SrOnly>
				</>
			)}
		</div>
	);
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
	if (diffDays === 1) return "yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
	return date.toLocaleDateString();
}

export function LinearTicketItem({
	ticket,
	isSelected,
	validationInfo,
	onClick,
	onToggleSelect,
}: LinearTicketItemProps) {
	const { t } = useTranslation(["common", "linear"]);

	// Generate unique IDs for accessibility
	const titleId = `ticket-title-${ticket.id}`;
	const metaId = `ticket-meta-${ticket.id}`;

	const handleClick = (e: React.MouseEvent) => {
		// If clicking the checkbox directly, don't trigger onClick
		if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
			onToggleSelect?.();
			return;
		}
		onClick();
	};

	return (
		<div
			className={cn(
				"w-full p-3 text-left transition-colors hover:bg-accent/50 border-b cursor-pointer",
				isSelected && "bg-accent",
			)}
			onClick={handleClick}
			role="listitem"
			aria-selected={isSelected}
			aria-labelledby={titleId}
			aria-describedby={metaId}
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					if (e.key === " " && onToggleSelect) {
						onToggleSelect();
					} else {
						onClick();
					}
				}
			}}
		>
			<div className="flex items-start gap-3">
				{/* Checkbox for batch selection */}
				{onToggleSelect && (
					<input
						type="checkbox"
						checked={isSelected}
						onChange={(e) => {
							e.stopPropagation();
							onToggleSelect();
						}}
						className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
						aria-label={`Select ${ticket.identifier}`}
						onClick={(e) => e.stopPropagation()}
					/>
				)}

				{/* Icon - using a simple square icon for tickets */}
				<div
					className="h-5 w-5 mt-0.5 shrink-0 flex items-center justify-center"
					aria-hidden="true"
				>
					<div className="h-4 w-4 rounded bg-primary/20" />
				</div>

				<div className="flex-1 min-w-0">
					{/* Header row: Identifier, Status, Priority, Validation Flow */}
					<div className="flex items-center gap-2 mb-1 flex-wrap">
						<span className="text-sm font-medium text-primary">
							{ticket.identifier}
						</span>

						{/* Status badge */}
						<Badge
							variant="outline"
							className={cn("text-xs", getStateColor(ticket.state.type))}
							aria-label={`Status: ${ticket.state.name}`}
						>
							{ticket.state.name}
						</Badge>

						{/* Priority badge */}
						{ticket.priority > 0 && (
							<Badge
								variant="outline"
								className={cn("text-xs", getPriorityColor(ticket.priority))}
								aria-label={`Priority: ${ticket.priorityLabel}`}
							>
								{ticket.priorityLabel}
							</Badge>
						)}

						{/* Validation status flow */}
						<ValidationStatusFlow validationInfo={validationInfo} t={t} />
					</div>

					{/* Title */}
					<h3 id={titleId} className="font-medium text-sm truncate mb-2">
						{ticket.title}
					</h3>

					{/* Footer: Assignee, Updated time */}
					<div
						id={metaId}
						className="flex items-center gap-3 text-xs text-muted-foreground"
					>
						{ticket.assignee && (
							<span className="flex items-center gap-1">
								<User className="h-3 w-3" aria-hidden="true" />
								<SrOnly>Assigned to </SrOnly>
								{ticket.assignee.name}
							</span>
						)}
						<span className="flex items-center gap-1">
							<Clock className="h-3 w-3" aria-hidden="true" />
							<SrOnly>Last updated </SrOnly>
							{formatDate(ticket.updatedAt)}
						</span>
					</div>

					{/* Labels (if any) */}
					{ticket.labels.length > 0 && (
						<div className="flex items-center gap-1 mt-2 flex-wrap">
							{ticket.labels.slice(0, 3).map((label) => (
								<Badge
									key={label.id}
									variant="outline"
									className="text-xs px-1.5 py-0"
									style={{
										borderColor: label.color,
										color: label.color,
									}}
								>
									{label.name}
								</Badge>
							))}
							{ticket.labels.length > 3 && (
								<span className="text-xs text-muted-foreground">
									+{ticket.labels.length - 3}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
