import {
	Info,
	Loader2,
	RefreshCw,
	Settings,
	Ticket,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../hooks/use-toast";
import { useLinearStore } from "../../stores/linear-store";
import { useProjectStore } from "../../stores/project-store";
import { Button } from "../ui/button";
import { ResizablePanels } from "../ui/resizable-panels";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../ui/tooltip";
import {
	LinearFilterBar,
	LinearTicketDetail,
	LinearTicketList,
} from "./components";
import { useLinearFiltering, useLinearTickets } from "./hooks";

interface LinearDashboardProps {
	onOpenSettings?: () => void;
	isActive?: boolean;
}

function NotConnectedState({
	error,
	onOpenSettings,
	t,
}: {
	error: string | null;
	onOpenSettings?: () => void;
	t: (key: string) => string;
}) {
	return (
		<div className="flex-1 flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<Ticket className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
				<h3 className="text-lg font-medium mb-2">{t("linear.notConnected")}</h3>
				<p className="text-sm text-muted-foreground mb-4">
					{error || t("linear.connectPrompt")}
				</p>
				{onOpenSettings && (
					<Button onClick={onOpenSettings} variant="outline">
						<Settings className="h-4 w-4 mr-2" />
						{t("linear.openSettings")}
					</Button>
				)}
			</div>
		</div>
	);
}

function EmptyState({
	message,
	hasFilters,
	t,
}: {
	message: string;
	hasFilters?: boolean;
	t: (key: string) => string;
}) {
	return (
		<div className="flex-1 flex items-center justify-center">
			<div className="text-center text-muted-foreground max-w-md px-4">
				<Ticket className="h-12 w-12 mx-auto mb-4 opacity-30" />
				<p className="mb-4">{message}</p>
				{hasFilters && (
					<div className="flex items-center justify-center gap-2 text-sm bg-muted/50 rounded-lg p-3">
						<Info className="h-4 w-4" />
						<span>{t("linear:adjustFiltersHint")}</span>
					</div>
				)}
			</div>
		</div>
	);
}

export function LinearDashboard({
	onOpenSettings,
	isActive = false,
}: LinearDashboardProps) {
	const { t } = useTranslation(["common", "linear"]);
	const { toast } = useToast();
	const projects = useProjectStore((state) => state.projects);
	const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
	const selectedProject = projects.find((p) => p.id === selectedProjectId);
	const [isClearingCache, setIsClearingCache] = useState(false);

	// Get clear cache function from store
	const clearValidationResults = useLinearStore(
		(state) => state.clearValidationResults,
	);

	const {
		tickets,
		isLoading,
		isLoadingMore,
		error,
		selectedTicketId,
		selectedValidationResult: validationResult,
		isValidating,
		hasMore,
		selectTicket,
		validateTicket: runValidation,
		refresh,
		loadMore,
		isConnected,
		selectedTicket,
		validationResults,
	} = useLinearTickets({ isActive, projectId: selectedProject?.id });

	const getValidationStateForTicket = useCallback(
		(ticketId: string) => {
			const result = validationResults.get(ticketId);
			if (!result) {
				return {
					isValidating: false,
					hasResult: false,
				};
			}
			return {
				isValidating: result.status === "validating",
				hasResult: result.status === "complete",
			};
		},
		[validationResults],
	);

	// Ticket filtering
	const {
		filteredTickets,
		filters,
		searchQuery,
		setSearchQuery,
		setTeamFilter,
		setProjectFilter,
		setStatusFilter,
		setLabelsFilter,
		setAssigneeFilter,
		setPriorityFilter,
		clearFilters,
		hasActiveFilters,
	} = useLinearFiltering(tickets);

	const handleRunValidation = useCallback(async () => {
		if (selectedTicketId) {
			await runValidation(selectedTicketId);
		}
	}, [selectedTicketId, runValidation]);

	const handleClearCache = useCallback(async () => {
		setIsClearingCache(true);
		try {
			// Clear local validation results
			clearValidationResults();

			// Call IPC to clear disk cache
			if (window.electronAPI?.clearLinearCache) {
				await window.electronAPI.clearLinearCache();
			}

			toast({
				title: t("linear.cacheCleared"),
				description: t("linear.validationCacheClearedDesc"),
				variant: "default",
			});
		} catch (err) {
			toast({
				title: t("linear.cacheClearFailed"),
				description:
					err instanceof Error ? err.message : t("linear.cacheClearFailedDesc"),
				variant: "destructive",
			});
		} finally {
			setIsClearingCache(false);
		}
	}, [clearValidationResults, toast, t]);

	// Keyboard shortcuts
	useEffect(() => {
		// Only handle shortcuts when this dashboard is active
		if (!isActive) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			// Ignore shortcuts when user is typing in an input
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable
			) {
				return;
			}

			// Ctrl/Cmd + R: Refresh tickets
			if ((e.ctrlKey || e.metaKey) && e.key === "r") {
				e.preventDefault();
				if (!isLoading) {
					refresh();
				}
				return;
			}

			// Escape: Clear selection
			if (e.key === "Escape" && selectedTicketId) {
				e.preventDefault();
				selectTicket(null);
				return;
			}

			// Arrow keys: Navigate ticket list (only if we have filtered tickets)
			if (filteredTickets.length > 0) {
				const currentIndex = selectedTicketId
					? filteredTickets.findIndex((ticket) => ticket.id === selectedTicketId)
					: -1;

				// Down arrow: Select next ticket
				if (e.key === "ArrowDown") {
					e.preventDefault();
					const nextIndex = currentIndex + 1;
					if (nextIndex < filteredTickets.length) {
						selectTicket(filteredTickets[nextIndex].id);
					} else if (currentIndex === -1) {
						// Select first ticket if none selected
						selectTicket(filteredTickets[0].id);
					}
					return;
				}

				// Up arrow: Select previous ticket
				if (e.key === "ArrowUp") {
					e.preventDefault();
					if (currentIndex > 0) {
						selectTicket(filteredTickets[currentIndex - 1].id);
					}
					return;
				}
			}

			// Enter or Ctrl/Cmd + Enter: Validate selected ticket
			if (
				(e.key === "Enter" ||
					((e.ctrlKey || e.metaKey) && e.key === "Enter")) &&
				selectedTicketId
			) {
				e.preventDefault();
				if (!isValidating) {
					handleRunValidation();
				}
				return;
			}

			// Ctrl/Cmd + Shift + X: Clear cache (changed from C to avoid browser conflicts)
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") {
				e.preventDefault();
				if (!isClearingCache) {
					handleClearCache();
				}
				return;
			}

			// Ctrl/Cmd + Alt + F: Clear filters (changed from Shift+F to avoid editor conflicts)
			if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "f") {
				e.preventDefault();
				if (hasActiveFilters) {
					clearFilters();
				}
				return;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		isActive,
		isLoading,
		isValidating,
		isClearingCache,
		selectedTicketId,
		filteredTickets,
		hasActiveFilters,
		refresh,
		selectTicket,
		handleRunValidation,
		handleClearCache,
		clearFilters,
	]);

	// Not connected state
	if (!isConnected) {
		return (
			<NotConnectedState error={error} onOpenSettings={onOpenSettings} t={t} />
		);
	}

	return (
		<div className="flex-1 flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-border">
				<div className="flex items-center gap-3">
					<h2 className="text-sm font-medium flex items-center gap-2">
						<Ticket className="h-4 w-4" />
						{t("linear.tickets")}
					</h2>
					<span className="text-xs text-muted-foreground">
						{tickets.length} {t("linear.tickets")}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									onClick={handleClearCache}
									disabled={isClearingCache}
								>
									{isClearingCache ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Trash2 className="h-4 w-4" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>{t("linear.clearCache")}</p>
								<p className="text-xs text-muted-foreground mt-1">
									{t("linear.shortcutHints.clearCache")}
								</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>

					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									onClick={refresh}
									disabled={isLoading}
								>
									<RefreshCw
										className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>
									{isLoading ? t("common:loading") : t("linear:shortcutHints.refresh")}
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									{t("linear.shortcuts.refresh")}
								</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>
			</div>

			{/* Content - Resizable split panels */}
			<ResizablePanels
				defaultLeftWidth={50}
				minLeftWidth={30}
				maxLeftWidth={70}
				storageKey="linear-dashboard-panel-width"
				leftPanel={
					<div className="flex flex-col h-full">
						<LinearFilterBar
							filters={filters}
							searchQuery={searchQuery}
							hasActiveFilters={hasActiveFilters}
							onSearchChange={setSearchQuery}
							onTeamChange={setTeamFilter}
							onProjectChange={setProjectFilter}
							onStatusChange={setStatusFilter}
							onLabelsChange={setLabelsFilter}
							onAssigneeChange={setAssigneeFilter}
							onPriorityChange={setPriorityFilter}
							onClearFilters={clearFilters}
						/>
						<LinearTicketList
							tickets={filteredTickets}
							selectedTicketId={selectedTicketId}
							isLoading={isLoading}
							isLoadingMore={isLoadingMore}
							hasMore={hasMore}
							error={error}
							getValidationStateForTicket={getValidationStateForTicket}
							onSelectTicket={selectTicket}
							onLoadMore={loadMore}
						/>
					</div>
				}
				rightPanel={
					selectedTicket ? (
						<LinearTicketDetail
							ticket={selectedTicket}
							validationResult={validationResult}
							isValidating={isValidating}
							onRunValidation={handleRunValidation}
						/>
					) : (
						<EmptyState
							message={t("linear:selectTicketToView")}
							hasFilters={hasActiveFilters}
							t={t}
						/>
					)
				}
			/>
		</div>
	);
}
