/**
 * SpecCard — Displays a single spec/task with status, metadata, and action buttons.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */

import type { Task, TaskPriority, TaskStatus } from "@auto-claude/types";
import { cn } from "../utils";

// ---------- Status badge color mapping ----------
const STATUS_COLORS: Record<TaskStatus, string> = {
	backlog: "bg-muted text-muted-foreground",
	queue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
	in_progress:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
	ai_review:
		"bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
	human_review:
		"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	done: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
	pr_created:
		"bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
	error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
	backlog: "Backlog",
	queue: "Queue",
	in_progress: "In Progress",
	ai_review: "AI Review",
	human_review: "Human Review",
	done: "Done",
	pr_created: "PR Created",
	error: "Error",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
	low: "text-muted-foreground",
	medium: "text-blue-600 dark:text-blue-400",
	high: "text-orange-600 dark:text-orange-400",
	urgent: "text-red-600 dark:text-red-400",
};

export interface SpecCardProps {
	spec: Task;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
	onView?: (id: string) => void;
	onStatusChange?: (id: string, status: TaskStatus) => void;
	compact?: boolean;
}

function SpecCard({
	spec,
	onEdit,
	onDelete,
	onView,
	onStatusChange,
	compact = false,
}: SpecCardProps) {
	const { metadata } = spec;
	const descriptionPreview = spec.description
		? spec.description.length > 120
			? `${spec.description.slice(0, 120)}…`
			: spec.description
		: null;

	return (
		<div
			className={cn(
				"rounded-lg border border-border bg-card text-card-foreground shadow-sm transition-colors",
				onView && "cursor-pointer hover:border-primary/50",
				compact ? "p-3" : "p-4",
			)}
			onClick={() => onView?.(spec.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onView?.(spec.id);
				}
			}}
			role={onView ? "button" : undefined}
			tabIndex={onView ? 0 : undefined}
		>
			{/* Header: title + status badge */}
			<div className="flex items-start justify-between gap-2">
				<h3
					className={cn(
						"font-medium leading-tight",
						compact ? "text-sm" : "text-base",
					)}
				>
					{spec.title}
				</h3>
				<span
					className={cn(
						"inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
						STATUS_COLORS[spec.status],
					)}
				>
					{STATUS_LABELS[spec.status]}
				</span>
			</div>

			{/* Description preview */}
			{descriptionPreview && !compact && (
				<p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
					{descriptionPreview}
				</p>
			)}

			{/* Metadata row */}
			{metadata && (
				<div
					className={cn(
						"flex flex-wrap items-center gap-2",
						compact ? "mt-2" : "mt-3",
					)}
				>
					{metadata.category && (
						<span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
							{metadata.category.replace(/_/g, " ")}
						</span>
					)}
					{metadata.priority && (
						<span
							className={cn(
								"text-xs font-medium",
								PRIORITY_COLORS[metadata.priority],
							)}
						>
							{metadata.priority}
						</span>
					)}
					{metadata.complexity && (
						<span className="text-xs text-muted-foreground">
							{metadata.complexity}
						</span>
					)}
				</div>
			)}

			{/* Timestamps */}
			{!compact && (
				<div className="mt-2 text-xs text-muted-foreground">
					Updated {new Date(spec.updatedAt).toLocaleDateString()}
				</div>
			)}

			{/* Actions */}
			{(onEdit || onDelete) && (
				<div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
					{onEdit && (
						<button
							type="button"
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
							onClick={(e) => {
								e.stopPropagation();
								onEdit(spec.id);
							}}
						>
							Edit
						</button>
					)}
					{onDelete && (
						<button
							type="button"
							className="text-xs text-destructive hover:text-destructive/80 transition-colors"
							onClick={(e) => {
								e.stopPropagation();
								onDelete(spec.id);
							}}
						>
							Delete
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export { SpecCard };
