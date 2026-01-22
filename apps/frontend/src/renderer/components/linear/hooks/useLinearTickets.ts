import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	LinearFilters,
	LinearProject,
	LinearTeam,
	LinearTicket,
	ValidationResult,
} from "../../../../shared/types/integrations";
import {
	fetchLinearProjects,
	fetchLinearTeams,
	fetchLinearTicket,
	fetchLinearTickets,
	useLinearStore,
	validateLinearTicket,
	validateLinearTicketBatch,
} from "../../../stores/linear-store";

// Re-export types for consumers
export type {
	LinearTicket,
	LinearFilters,
	ValidationResult,
	LinearTeam,
	LinearProject,
};

interface UseLinearTicketsOptions {
	/** Whether the component is currently active/visible */
	isActive?: boolean;
	/** Project ID for the Linear integration */
	projectId?: string;
}

interface UseLinearTicketsResult {
	// Data
	tickets: LinearTicket[];
	filteredTickets: LinearTicket[];
	teams: LinearTeam[];
	projects: LinearProject[];
	selectedTicket: LinearTicket | null;
	selectedTicketId: string | null;

	// Validation
	validationResults: Map<string, ValidationResult>;
	selectedValidationResult: ValidationResult | null;

	// Loading states
	isLoading: boolean;
	isLoadingMore: boolean;
	isLoadingTicket: boolean;
	isValidating: boolean;

	// Error states
	error: string | null;

	// Connection status
	isConnected: boolean;

	// Pagination
	hasMore: boolean;

	// Actions
	selectTicket: (ticketId: string | null) => void;
	refresh: () => Promise<void>;
	loadMore: () => Promise<void>;
	validateTicket: (
		ticketId: string,
		skipCache?: boolean,
	) => Promise<ValidationResult | null>;
	validateBatch: (
		ticketIds: string[],
	) => Promise<Map<string, ValidationResult>>;
	clearValidationResults: () => void;
	fetchTeams: () => Promise<void>;
	fetchProjects: (teamId?: string) => Promise<void>;
}

export function useLinearTickets(
	options: UseLinearTicketsOptions = {},
): UseLinearTicketsResult {
	const { isActive = true, projectId } = options;

	// Local state for component-specific loading states
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [isLoadingTicket, setIsLoadingTicket] = useState(false);
	const [isConnected, setIsConnected] = useState(false);
	const [hasMore, setHasMore] = useState(true);

	// Track previous isActive state to detect tab navigation
	const wasActiveRef = useRef(isActive);
	// Track if initial load has happened
	const hasLoadedRef = useRef(false);
	// Track the current ticket being fetched (for race condition prevention)
	const currentFetchTicketIdRef = useRef<string | null>(null);

	// Get state from the global Linear store
	const tickets = useLinearStore((state) => state.tickets);
	const filteredTickets = useLinearStore((state) => state.getFilteredTickets());
	const teams = useLinearStore((state) => state.teams);
	const projects = useLinearStore((state) => state.projects);
	const selectedTicketId = useLinearStore((state) => state.selectedTicketId);
	const validationResults = useLinearStore((state) => state.validationResults);
	const isLoading = useLinearStore((state) => state.isLoading);
	const error = useLinearStore((state) => state.error);

	// Get selected ticket from store
	const selectedTicket = useLinearStore((state) => state.getSelectedTicket());

	// Get validation result for selected ticket
	const selectedValidationResult = useMemo(() => {
		if (!selectedTicketId) return null;
		return validationResults.get(selectedTicketId) || null;
	}, [selectedTicketId, validationResults]);

	// Check if any validation is in progress
	const isValidating = useMemo(() => {
		return Array.from(validationResults.values()).some(
			(result) => result.status === "validating",
		);
	}, [validationResults]);

	// Fetch tickets with connection check
	const fetchTicketsData = useCallback(
		async (append: boolean = false) => {
			if (!projectId) return;

			if (append) {
				setIsLoadingMore(true);
			}

			try {
				// Check connection first
				const connectionResult =
					await window.electronAPI.linear.checkLinearConnection(projectId);
				if (connectionResult.success && connectionResult.data) {
					setIsConnected(connectionResult.data.connected);

					if (connectionResult.data.connected) {
						// Fetch tickets via store
						await fetchLinearTickets(projectId);
					} else {
						useLinearStore
							.getState()
							.setError(
								connectionResult.data.error || "Not connected to Linear",
							);
					}
				} else {
					setIsConnected(false);
					useLinearStore
						.getState()
						.setError(
							connectionResult.error || "Failed to check Linear connection",
						);
				}
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : "Failed to fetch tickets";
				useLinearStore.getState().setError(errorMessage);
				setIsConnected(false);
			} finally {
				setIsLoadingMore(false);
			}
		},
		[projectId],
	);

	// Initial load
	useEffect(() => {
		if (projectId && !hasLoadedRef.current) {
			hasLoadedRef.current = true;
			fetchTicketsData(false);
		}
	}, [projectId, fetchTicketsData]);

	// Auto-refresh when tab becomes active
	useEffect(() => {
		if (isActive && !wasActiveRef.current && hasLoadedRef.current) {
			fetchTicketsData(false);
		}
		wasActiveRef.current = isActive;
	}, [isActive, fetchTicketsData]);

	// Reset state when project changes
	useEffect(() => {
		hasLoadedRef.current = false;
		setHasMore(true);
		useLinearStore.getState().clearTickets();
		useLinearStore.getState().clearValidationResults();
		useLinearStore.getState().selectTicket(null);
		currentFetchTicketIdRef.current = null;
	}, [projectId]);

	// Select a ticket
	const selectTicket = useCallback(
		async (ticketId: string | null) => {
			// Update store
			useLinearStore.getState().selectTicket(ticketId);

			// Clear previous fetch ref
			if (ticketId === null) {
				currentFetchTicketIdRef.current = null;
				return;
			}

			if (ticketId && projectId) {
				// Track the current ticket being fetched (for race condition prevention)
				currentFetchTicketIdRef.current = ticketId;

				// Fetch full ticket details if not already loaded
				const existingTicket = tickets.find((t) => t.id === ticketId);
				if (!existingTicket) {
					setIsLoadingTicket(true);
					try {
						const ticketDetails = await fetchLinearTicket(ticketId);
						// Only update if this response is still for the current ticket
						if (ticketDetails && ticketId === currentFetchTicketIdRef.current) {
							// Ticket is already updated in store by fetchLinearTicket
						}
					} catch (err) {
						console.warn(
							`Failed to fetch ticket details for ${ticketId}:`,
							err,
						);
					} finally {
						// Only clear loading state if this was the last fetch
						if (ticketId === currentFetchTicketIdRef.current) {
							setIsLoadingTicket(false);
						}
					}
				}
			}
		},
		[projectId, tickets],
	);

	// Refresh tickets
	const refresh = useCallback(async () => {
		setHasMore(true);
		await fetchTicketsData(false);
	}, [fetchTicketsData]);

	// Load more tickets (pagination)
	const loadMore = useCallback(async () => {
		if (!hasMore || isLoadingMore || isLoading) return;
		await fetchTicketsData(true);
	}, [fetchTicketsData, hasMore, isLoadingMore, isLoading]);

	// Validate a single ticket
	const validateTicket = useCallback(
		async (
			ticketId: string,
			skipCache: boolean = false,
		): Promise<ValidationResult | null> => {
			if (!projectId) return null;

			try {
				const result = await validateLinearTicket(ticketId, skipCache);
				return result;
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : "Validation failed";
				useLinearStore.getState().setError(errorMessage);
				return null;
			}
		},
		[projectId],
	);

	// Validate multiple tickets in batch
	const validateBatch = useCallback(
		async (ticketIds: string[]): Promise<Map<string, ValidationResult>> => {
			if (!projectId) return new Map();

			try {
				const results = await validateLinearTicketBatch(ticketIds);
				return results;
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : "Batch validation failed";
				useLinearStore.getState().setError(errorMessage);
				return new Map();
			}
		},
		[projectId],
	);

	// Clear all validation results
	const clearValidationResults = useCallback(() => {
		useLinearStore.getState().clearValidationResults();
	}, []);

	// Fetch teams
	const fetchTeams = useCallback(async () => {
		if (!projectId) return;

		try {
			await fetchLinearTeams(projectId);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Failed to fetch teams";
			useLinearStore.getState().setError(errorMessage);
		}
	}, [projectId]);

	// Fetch projects
	const fetchProjects = useCallback(
		async (teamId?: string) => {
			if (!projectId) return;

			try {
				await fetchLinearProjects(projectId, teamId);
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : "Failed to fetch projects";
				useLinearStore.getState().setError(errorMessage);
			}
		},
		[projectId],
	);

	return {
		// Data
		tickets,
		filteredTickets,
		teams,
		projects,
		selectedTicket,
		selectedTicketId,

		// Validation
		validationResults,
		selectedValidationResult,

		// Loading states
		isLoading,
		isLoadingMore,
		isLoadingTicket,
		isValidating,

		// Error states
		error,

		// Connection status
		isConnected,

		// Pagination
		hasMore,

		// Actions
		selectTicket,
		refresh,
		loadMore,
		validateTicket,
		validateBatch,
		clearValidationResults,
		fetchTeams,
		fetchProjects,
	};
}
