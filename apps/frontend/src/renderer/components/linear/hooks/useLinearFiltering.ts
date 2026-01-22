import { useCallback, useMemo, useState } from "react";
import type {
	LinearFilters,
	LinearTicket,
} from "../../../../shared/types/integrations";
import { useLinearStore } from "../../../stores/linear-store";

interface UseLinearFilteringOptions {
	/** Whether to sync filters with the global store */
	useStore?: boolean;
}

interface UseLinearFilteringResult {
	/** Currently filtered tickets based on active filters */
	filteredTickets: LinearTicket[];
	/** Current filter state */
	filters: LinearFilters;
	/** Search query string */
	searchQuery: string;
	/** Whether any filters are currently active */
	hasActiveFilters: boolean;
	/** Set search query */
	setSearchQuery: (query: string) => void;
	/** Set team filter */
	setTeamFilter: (teamId: string | undefined) => void;
	/** Set project filter */
	setProjectFilter: (projectId: string | undefined) => void;
	/** Set status filter */
	setStatusFilter: (status: string | undefined) => void;
	/** Set labels filter */
	setLabelsFilter: (labels: string[] | undefined) => void;
	/** Set assignee filter */
	setAssigneeFilter: (assigneeId: string | undefined) => void;
	/** Set priority filter */
	setPriorityFilter: (priority: number | undefined) => void;
	/** Clear all filters */
	clearFilters: () => void;
	/** Update a single filter by key */
	updateFilter: <K extends keyof LinearFilters>(
		key: K,
		value: LinearFilters[K],
	) => void;
}

export function useLinearFiltering(
	tickets: LinearTicket[] = [],
	options: UseLinearFilteringOptions = {},
): UseLinearFilteringResult {
	const { useStore = true } = options;

	// Local state for filters (if not using store)
	const [localFilters, setLocalFilters] = useState<LinearFilters>({});
	const [searchQuery, setSearchQuery] = useState("");

	// Get filters from store if using store
	const storeFilters = useLinearStore((state) => state.filters);
	const storeUpdateFilter = useLinearStore((state) => state.updateFilter);
	const storeClearFilters = useLinearStore((state) => state.clearFilters);

	// Use store or local filters based on option
	const filters = useStore ? storeFilters : localFilters;

	// Helper function to apply search query and filters
	const applyFiltering = useCallback(
		(
			ticketsToFilter: LinearTicket[],
			currentFilters: LinearFilters,
			query: string,
		): LinearTicket[] => {
			let filtered = ticketsToFilter;

			// Apply search query (searches title and description)
			if (query.trim()) {
				const lowerQuery = query.toLowerCase().trim();
				filtered = filtered.filter((ticket) => {
					const titleMatch = ticket.title.toLowerCase().includes(lowerQuery);
					const descriptionMatch = ticket.description
						? ticket.description.toLowerCase().includes(lowerQuery)
						: false;
					const identifierMatch = ticket.identifier
						.toLowerCase()
						.includes(lowerQuery);
					return titleMatch || descriptionMatch || identifierMatch;
				});
			}

			// Apply team filter
			if (currentFilters.teamId) {
				// Note: Linear API doesn't return team info in issue response
				// This filter would need to be applied server-side or via additional data
				// For now, we'll include this as a placeholder for future implementation
			}

			// Apply project filter
			if (currentFilters.projectId) {
				filtered = filtered.filter(
					(ticket) => ticket.project?.id === currentFilters.projectId,
				);
			}

			// Apply status filter
			if (currentFilters.status) {
				filtered = filtered.filter(
					(ticket) => ticket.state.name === currentFilters.status,
				);
			}

			// Apply labels filter (tickets must have at least one matching label)
			if (currentFilters.labels && currentFilters.labels.length > 0) {
				filtered = filtered.filter((ticket) => {
					const ticketLabelNames = ticket.labels.map((l) => l.name);
					return currentFilters.labels!.some((filterLabel) =>
						ticketLabelNames.includes(filterLabel),
					);
				});
			}

			// Apply assignee filter
			if (currentFilters.assigneeId) {
				filtered = filtered.filter(
					(ticket) => ticket.assignee?.id === currentFilters.assigneeId,
				);
			}

			// Apply priority filter
			if (currentFilters.priority !== undefined) {
				filtered = filtered.filter(
					(ticket) => ticket.priority === currentFilters.priority,
				);
			}

			return filtered;
		},
		[],
	);

	// Compute filtered tickets
	const filteredTickets = useMemo(() => {
		return applyFiltering(tickets, filters, searchQuery);
	}, [tickets, filters, searchQuery, applyFiltering]);

	// Check if any filters are active
	const hasActiveFilters = useMemo(() => {
		return (
			searchQuery.trim().length > 0 ||
			Object.keys(filters).some((key) => {
				const value = filters[key as keyof LinearFilters];
				if (Array.isArray(value)) {
					return value.length > 0;
				}
				return value !== undefined && value !== null && value !== "";
			})
		);
	}, [filters, searchQuery]);

	// Update a single filter
	const updateFilter = useCallback(
		<K extends keyof LinearFilters>(key: K, value: LinearFilters[K]) => {
			if (useStore) {
				storeUpdateFilter(key, value);
			} else {
				setLocalFilters((prev) => ({ ...prev, [key]: value }));
			}
		},
		[useStore, storeUpdateFilter],
	);

	// Set team filter
	const setTeamFilter = useCallback(
		(teamId: string | undefined) => {
			updateFilter("teamId", teamId);
		},
		[updateFilter],
	);

	// Set project filter
	const setProjectFilter = useCallback(
		(projectId: string | undefined) => {
			updateFilter("projectId", projectId);
		},
		[updateFilter],
	);

	// Set status filter
	const setStatusFilter = useCallback(
		(status: string | undefined) => {
			updateFilter("status", status);
		},
		[updateFilter],
	);

	// Set labels filter
	const setLabelsFilter = useCallback(
		(labels: string[] | undefined) => {
			updateFilter("labels", labels);
		},
		[updateFilter],
	);

	// Set assignee filter
	const setAssigneeFilter = useCallback(
		(assigneeId: string | undefined) => {
			updateFilter("assigneeId", assigneeId);
		},
		[updateFilter],
	);

	// Set priority filter
	const setPriorityFilter = useCallback(
		(priority: number | undefined) => {
			updateFilter("priority", priority);
		},
		[updateFilter],
	);

	// Clear all filters
	const clearFilters = useCallback(() => {
		setSearchQuery("");
		if (useStore) {
			storeClearFilters();
		} else {
			setLocalFilters({});
		}
	}, [useStore, storeClearFilters]);

	return {
		filteredTickets,
		filters,
		searchQuery,
		hasActiveFilters,
		setSearchQuery,
		setTeamFilter,
		setProjectFilter,
		setStatusFilter,
		setLabelsFilter,
		setAssigneeFilter,
		setPriorityFilter,
		clearFilters,
		updateFilter,
	};
}
