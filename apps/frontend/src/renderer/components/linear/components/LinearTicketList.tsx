import { Loader2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LinearTicket } from "../../../../shared/types/integrations";
import { ScrollArea } from "../../ui/scroll-area";
import { LinearTicketItem } from "./LinearTicketItem";

/**
 * Skeleton loader for ticket items during initial load
 */
function TicketItemSkeleton() {
	return (
		<div className="w-full p-3 border-b border-border/40 animate-pulse">
			<div className="flex items-start gap-3">
				{/* Checkbox placeholder */}
				<div className="h-4 w-4 rounded border border-border/30 bg-muted" />

				{/* Icon placeholder */}
				<div className="h-5 w-5 mt-0.5 shrink-0 bg-muted rounded" />

				{/* Content */}
				<div className="flex-1 min-w-0 space-y-2">
					{/* Header row */}
					<div className="flex items-center gap-2">
						<div className="h-4 w-20 bg-muted rounded" />
						<div className="h-5 w-16 bg-muted rounded" />
					</div>

					{/* Title */}
					<div className="h-4 w-3/4 bg-muted rounded" />

					{/* Footer */}
					<div className="flex items-center gap-3">
						<div className="h-3 w-24 bg-muted rounded" />
						<div className="h-3 w-16 bg-muted rounded" />
					</div>
				</div>
			</div>
		</div>
	);
}

interface ValidationStatusInfo {
	isValidating: boolean;
	hasResult: boolean;
	hasBlockingFindings: boolean;
	hasNewChanges: boolean;
	hasChangesAfterPosting: boolean;
}

interface LinearTicketListProps {
	tickets: LinearTicket[];
	selectedTicketId: string | null;
	isLoading: boolean;
	isLoadingMore: boolean;
	hasMore: boolean;
	error: string | null;
	getValidationStateForTicket: (
		ticketId: string,
	) => ValidationStatusInfo | null;
	onSelectTicket: (ticketId: string) => void;
	onLoadMore: () => void;
}

export function LinearTicketList({
	tickets,
	selectedTicketId,
	isLoading,
	isLoadingMore,
	hasMore,
	error,
	getValidationStateForTicket,
	onSelectTicket,
	onLoadMore,
}: LinearTicketListProps) {
	const { t } = useTranslation("common");
	const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
	const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
		null,
	);

	// Intersection Observer for infinite scroll
	const handleIntersection = useCallback(
		(entries: IntersectionObserverEntry[]) => {
			const [entry] = entries;
			if (entry.isIntersecting && hasMore && !isLoadingMore && !isLoading) {
				onLoadMore();
			}
		},
		[hasMore, isLoadingMore, isLoading, onLoadMore],
	);

	useEffect(() => {
		const trigger = loadMoreTriggerRef.current;
		if (!trigger || !viewportElement) return;

		const observer = new IntersectionObserver(handleIntersection, {
			root: viewportElement,
			rootMargin: "100px",
			threshold: 0,
		});

		observer.observe(trigger);

		return () => {
			observer.disconnect();
		};
	}, [handleIntersection, onLoadMore, viewportElement]);

	// Loading state (initial load) - show skeleton loaders
	if (isLoading && tickets.length === 0) {
		return (
			<div
				className="flex-1 overflow-y-auto"
				role="status"
				aria-live="polite"
				aria-busy="true"
				aria-label="Loading tickets"
			>
				<div className="divide-y divide-border/40">
					{/* Show 3 skeleton items as loading indicators */}
					{Array.from({ length: 3 }).map((_, index) => (
						<TicketItemSkeleton key={index} />
					))}
				</div>
			</div>
		);
	}

	// Loading more state - show spinner at bottom
	if (isLoadingMore) {
		return (
			<div className="flex-1 flex flex-col">
				<ScrollArea className="flex-1">
					<div className="divide-y divide-border">
						{tickets.map((ticket) => {
							const validationInfo = getValidationStateForTicket(ticket.id);

							return (
								<LinearTicketItem
									key={ticket.id}
									ticket={ticket}
									isSelected={selectedTicketId === ticket.id}
									validationInfo={validationInfo}
									onClick={() => onSelectTicket(ticket.id)}
								/>
							);
						})}
					</div>
				</ScrollArea>
				<div
					className="py-4 flex justify-center border-t border-border"
					role="status"
					aria-live="polite"
					aria-busy="true"
				>
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						<span className="text-sm">{t("linear.loadingMore")}</span>
					</div>
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div
				className="flex-1 flex items-center justify-center p-4"
				role="alert"
				aria-live="assertive"
			>
				<div className="text-center text-destructive">
					<p className="text-sm">{error}</p>
				</div>
			</div>
		);
	}

	// Empty state
	if (tickets.length === 0) {
		return (
			<div
				className="flex-1 flex items-center justify-center"
				role="status"
				aria-live="polite"
			>
				<div className="text-center text-muted-foreground">
					<Square
						className="h-8 w-8 mx-auto mb-2 opacity-50"
						aria-hidden="true"
					/>
					<p>{t("linear.noOpenTickets")}</p>
				</div>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1" onViewportRef={setViewportElement}>
			<div
				className="divide-y divide-border"
				role="list"
				aria-label="Linear tickets list"
			>
				{tickets.map((ticket) => {
					const validationInfo = getValidationStateForTicket(ticket.id);

					return (
						<LinearTicketItem
							key={ticket.id}
							ticket={ticket}
							isSelected={selectedTicketId === ticket.id}
							validationInfo={validationInfo}
							onClick={() => onSelectTicket(ticket.id)}
						/>
					);
				})}

				{/* Load more trigger / Loading indicator */}
				<div
					ref={loadMoreTriggerRef}
					className="py-4 flex justify-center"
					role="status"
					aria-live="polite"
				>
					{isLoadingMore ? (
						<div className="flex items-center gap-2 text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							<span className="text-sm">{t("linear:loadingMore")}</span>
						</div>
					) : hasMore ? (
						<span
							className="text-xs text-muted-foreground opacity-50"
							aria-live="polite"
						>
							{t("linear:scrollForMore")}
						</span>
					) : tickets.length > 0 ? (
						<span
							className="text-xs text-muted-foreground opacity-50"
							aria-live="polite"
						>
							{t("linear:allLoaded")}
						</span>
					) : null}
				</div>
			</div>
		</ScrollArea>
	);
}
