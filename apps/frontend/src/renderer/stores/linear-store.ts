import { create } from "zustand";
import type {
	LinearFilters,
	LinearProject,
	LinearTeam,
	LinearTicket,
	ValidationResult,
} from "../../shared/types";
import { debugLog, debugWarn } from "@shared/utils/debug-logger";

interface LinearState {
	// State
	tickets: LinearTicket[];
	filters: LinearFilters;
	validationResults: Map<string, ValidationResult>;
	selectedTicketId: string | null;
	selectedProjectId: string | null;
	teams: LinearTeam[];
	projects: LinearProject[];
	isLoading: boolean;
	error: string | null;

	// Ticket actions
	setTickets: (tickets: LinearTicket[]) => void;
	addTicket: (ticket: LinearTicket) => void;
	updateTicket: (ticketId: string, updates: Partial<LinearTicket>) => void;
	removeTicket: (ticketId: string) => void;
	clearTickets: () => void;

	// Filter actions
	setFilters: (filters: LinearFilters) => void;
	updateFilter: <K extends keyof LinearFilters>(
		key: K,
		value: LinearFilters[K],
	) => void;
	clearFilters: () => void;

	// Validation actions
	setValidationResults: (results: Map<string, ValidationResult>) => void;
	updateValidationResult: (ticketId: string, result: ValidationResult) => void;
	removeValidationResult: (ticketId: string) => void;
	clearValidationResults: () => void;

	// Team/Project actions
	setTeams: (teams: LinearTeam[]) => void;
	setProjects: (projects: LinearProject[]) => void;
	setSelectedProjectId: (projectId: string | null) => void;

	// UI state actions
	selectTicket: (ticketId: string | null) => void;
	setLoading: (loading: boolean) => void;
	setError: (error: string | null) => void;

	// Selectors
	getSelectedTicket: () => LinearTicket | null;
	getFilteredTickets: () => LinearTicket[];
	getValidationResult: (ticketId: string) => ValidationResult | undefined;
	getTicketsByStatus: (status: string) => LinearTicket[];
	getTicketsByPriority: (priority: number) => LinearTicket[];
}

/**
 * Helper to find ticket index by id or identifier.
 * Returns -1 if not found.
 */
function findTicketIndex(tickets: LinearTicket[], ticketId: string): number {
	return tickets.findIndex(
		(t) => t.id === ticketId || t.identifier === ticketId,
	);
}

/**
 * Helper to update a single ticket efficiently.
 * Uses slice instead of map to avoid iterating all tickets.
 */
function updateTicketAtIndex(
	tickets: LinearTicket[],
	index: number,
	updater: (ticket: LinearTicket) => LinearTicket,
): LinearTicket[] {
	if (index < 0 || index >= tickets.length) return tickets;

	const updatedTicket = updater(tickets[index]);

	// If the ticket reference didn't change, return original array
	if (updatedTicket === tickets[index]) {
		return tickets;
	}

	// Create new array with only the changed ticket replaced
	const newTickets = [...tickets];
	newTickets[index] = updatedTicket;

	return newTickets;
}

/**
 * Apply filters to tickets based on current filter state
 */
export function applyFilters(
	tickets: LinearTicket[],
	filters: LinearFilters,
): LinearTicket[] {
	return tickets.filter((ticket) => {
		// Filter by team
		if (filters.teamId) {
			// Note: Linear API doesn't return team info in issue response
			// This filter would need to be applied server-side or via additional data
			// For now, we'll include this as a placeholder
		}

		// Filter by project
		if (filters.projectId && ticket.project?.id !== filters.projectId) {
			return false;
		}

		// Filter by status (by name)
		if (filters.status && ticket.state.name !== filters.status) {
			return false;
		}

		// Filter by labels
		if (filters.labels && filters.labels.length > 0) {
			const ticketLabelNames = ticket.labels.map((l) => l.name);
			const hasMatchingLabel = filters.labels.some((filterLabel) =>
				ticketLabelNames.includes(filterLabel),
			);
			if (!hasMatchingLabel) {
				return false;
			}
		}

		// Filter by assignee
		if (filters.assigneeId && ticket.assignee?.id !== filters.assigneeId) {
			return false;
		}

		// Filter by priority
		if (filters.priority != null && ticket.priority !== filters.priority) {
			return false;
		}

		return true;
	});
}

export const useLinearStore = create<LinearState>((set, get) => ({
	// Initial state
	tickets: [],
	filters: {},
	validationResults: new Map(),
	selectedTicketId: null,
	selectedProjectId: null,
	teams: [],
	projects: [],
	isLoading: false,
	error: null,

	// Ticket actions
	setTickets: (tickets) => set({ tickets }),

	addTicket: (ticket) =>
		set((state) => ({
			tickets: [...state.tickets, ticket],
		})),

	updateTicket: (ticketId, updates) =>
		set((state) => {
			const index = findTicketIndex(state.tickets, ticketId);
			if (index === -1) return state;

			return {
				tickets: updateTicketAtIndex(state.tickets, index, (t) => ({
					...t,
					...updates,
				})),
			};
		}),

	removeTicket: (ticketId) =>
		set((state) => ({
			tickets: state.tickets.filter(
				(t) => t.id !== ticketId && t.identifier !== ticketId,
			),
		})),

	clearTickets: () => set({ tickets: [] }),

	// Filter actions
	setFilters: (filters) => set({ filters }),

	updateFilter: (key, value) =>
		set((state) => ({
			filters: { ...state.filters, [key]: value },
		})),

	clearFilters: () =>
		set({
			filters: {
				teamId: undefined,
				projectId: undefined,
				status: undefined,
				labels: [],
				assigneeId: undefined,
				priority: undefined,
			},
		}),

	// Validation actions
	setValidationResults: (results) => set({ validationResults: results }),

	updateValidationResult: (ticketId, result) =>
		set((state) => {
			const newResults = new Map(state.validationResults);
			newResults.set(ticketId, result);
			return { validationResults: newResults };
		}),

	removeValidationResult: (ticketId) =>
		set((state) => {
			const newResults = new Map(state.validationResults);
			newResults.delete(ticketId);
			return { validationResults: newResults };
		}),

	clearValidationResults: () => set({ validationResults: new Map() }),

	// Team/Project actions
	setTeams: (teams) => set({ teams }),

	setProjects: (projects) => set({ projects }),

	setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),

	// UI state actions
	selectTicket: (ticketId) => set({ selectedTicketId: ticketId }),

	setLoading: (isLoading) => set({ isLoading }),

	setError: (error) => set({ error }),

	// Selectors
	getSelectedTicket: () => {
		const state = get();
		return state.tickets.find((t) => t.id === state.selectedTicketId) || null;
	},

	getFilteredTickets: () => {
		const state = get();
		return applyFilters(state.tickets, state.filters);
	},

	getValidationResult: (ticketId) => {
		const state = get();
		return state.validationResults.get(ticketId);
	},

	getTicketsByStatus: (status) => {
		const state = get();
		return state.tickets.filter((t) => t.state.name === status);
	},

	getTicketsByPriority: (priority) => {
		const state = get();
		return state.tickets.filter((t) => t.priority === priority);
	},
}));

// ============================================
// Async Actions (use window.electronAPI)
// ============================================

/**
 * Fetch Linear tickets with optional filters
 */
export async function fetchLinearTickets(
	projectId: string,
	filters?: LinearFilters,
): Promise<void> {
	const store = useLinearStore.getState();
	store.setLoading(true);
	store.setError(null);

	try {
		if (!window.electronAPI?.getLinearIssues) {
			console.warn("[fetchLinearTickets] Linear API not available");
			return;
		}

		const result = await window.electronAPI.getLinearIssues(
			projectId,
			filters?.teamId,
			filters?.projectId || undefined,
		);

		if (result.success && result.data) {
			store.setTickets(result.data);
		} else {
			store.setError(result.error || "Failed to fetch Linear tickets");
		}
	} catch (error) {
		store.setError(error instanceof Error ? error.message : "Unknown error");
	} finally {
		store.setLoading(false);
	}
}

/**
 * Fetch a single Linear ticket by ID
 */
export async function fetchLinearTicket(
	ticketId: string,
): Promise<LinearTicket | null> {
	const store = useLinearStore.getState();

	try {
		// TODO: Implement IPC handler in main process
		// const result = await window.electronAPI.getLinearTicket(ticketId);
		// if (result.success && result.data) {
		//   store.updateTicket(ticketId, result.data);
		//   return result.data;
		// } else {
		//   store.setError(result.error || 'Failed to fetch Linear ticket');
		//   return null;
		// }

		// Placeholder for now
		console.warn("[fetchLinearTicket] IPC handler not yet implemented");
		return null;
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.setError(errorMessage);
		return null;
	}
}

/**
 * Validate a single Linear ticket using AI
 */
export async function validateLinearTicket(
	projectId: string,
	ticketId: string,
	skipCache: boolean = false,
): Promise<ValidationResult | null> {
	const store = useLinearStore.getState();

	// Update validation status to validating
	const currentResult = store.getValidationResult(ticketId);
	store.updateValidationResult(ticketId, {
		...(currentResult || {
			ticketId,
			ticketIdentifier: "",
			validationTimestamp: new Date().toISOString(),
			cached: false,
			contentAnalysis: {
				title: "",
				descriptionSummary: "",
				requirements: [],
			},
			completenessValidation: {
				isComplete: false,
				missingFields: [],
				feasibilityScore: 0,
				feasibilityReasoning: "",
			},
			suggestedLabels: [],
			versionRecommendation: {
				recommendedVersion: "",
				versionType: "patch",
				reasoning: "",
			},
			taskProperties: {
				category: "feature",
				complexity: "medium",
				impact: "medium",
				priority: "medium",
				rationale: "",
			},
		}),
		status: "validating",
		error: undefined,
	});

	try {
		debugLog("[validateLinearTicket] Starting validation for ticket:", ticketId, "projectId:", projectId);
		if (!window.electronAPI?.validateLinearTicket) {
			debugWarn("[validateLinearTicket] Linear API not available");
			return null;
		}

		if (!projectId) {
			const errorMessage = "No project selected";
			store.updateValidationResult(ticketId, {
				...(currentResult || {
					ticketId,
					ticketIdentifier: "",
					validationTimestamp: new Date().toISOString(),
					cached: false,
					contentAnalysis: {
						title: "",
						descriptionSummary: "",
						requirements: [],
					},
					completenessValidation: {
						isComplete: false,
						missingFields: [],
						feasibilityScore: 0,
						feasibilityReasoning: "",
					},
					suggestedLabels: [],
					versionRecommendation: {
						recommendedVersion: "",
						versionType: "patch",
						reasoning: "",
					},
					taskProperties: {
						category: "feature",
						complexity: "medium",
						impact: "medium",
						priority: "medium",
						rationale: "",
					},
				}),
				status: "error",
				error: errorMessage,
			});
			store.setError(errorMessage);
			return null;
		}

		const result = await window.electronAPI.validateLinearTicket(
			projectId,
			ticketId,
			skipCache,
		);

		if (result.success && result.data) {
			store.updateValidationResult(ticketId, {
				...result.data,
				status: "complete",
				cached: result.data.cached || false,
			});
			return result.data;
		} else {
			store.updateValidationResult(ticketId, {
				...(currentResult || {
					ticketId,
					ticketIdentifier: "",
					validationTimestamp: new Date().toISOString(),
					cached: false,
					contentAnalysis: {
						title: "",
						descriptionSummary: "",
						requirements: [],
					},
					completenessValidation: {
						isComplete: false,
						missingFields: [],
						feasibilityScore: 0,
						feasibilityReasoning: "",
					},
					suggestedLabels: [],
					versionRecommendation: {
						recommendedVersion: "",
						versionType: "patch",
						reasoning: "",
					},
					taskProperties: {
						category: "feature",
						complexity: "medium",
						impact: "medium",
						priority: "medium",
						rationale: "",
					},
				}),
				status: "error",
				error: result.error || "Validation failed",
			});
			return null;
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.updateValidationResult(ticketId, {
			...(currentResult || {
				ticketId,
				ticketIdentifier: "",
				validationTimestamp: new Date().toISOString(),
				cached: false,
				contentAnalysis: {
					title: "",
					descriptionSummary: "",
					requirements: [],
				},
				completenessValidation: {
					isComplete: false,
					missingFields: [],
					feasibilityScore: 0,
					feasibilityReasoning: "",
				},
				suggestedLabels: [],
				versionRecommendation: {
					recommendedVersion: "",
					versionType: "patch",
					reasoning: "",
				},
				taskProperties: {
					category: "feature",
					complexity: "medium",
					impact: "medium",
					priority: "medium",
					rationale: "",
				},
			}),
			status: "error",
			error: errorMessage,
		});
		store.setError(errorMessage);
		return null;
	}
}

/**
 * Validate multiple Linear tickets in batch (max 5)
 */
export async function validateLinearTicketBatch(
	projectId: string,
	ticketIds: string[],
): Promise<Map<string, ValidationResult>> {
	const store = useLinearStore.getState();
	const results = new Map<string, ValidationResult>();

	// Validate batch size limit
	if (ticketIds.length > 5) {
		store.setError("Maximum 5 tickets allowed per batch");
		return results;
	}

	store.setLoading(true);
	store.setError(null);

	try {
		if (!window.electronAPI?.validateLinearTicketBatch) {
			console.warn("[validateLinearTicketBatch] Linear API not available");
			return results;
		}

		if (!projectId) {
			store.setError("No project selected");
			return results;
		}

		const result = await window.electronAPI.validateLinearTicketBatch(
			projectId,
			ticketIds,
			false,
		);

		if (result.success && result.data) {
			const { successful = [], failed = [] } = result.data;

			// Store successful results
			for (const validationResult of successful) {
				const { ticketId, result: validationData } = validationResult;
				store.updateValidationResult(ticketId, {
					...validationData,
					status: "complete",
					cached: validationData.cached || false,
				});
				results.set(ticketId, validationData);
			}

			// Handle failures
			if (failed.length > 0) {
				for (const failedResult of failed) {
					const { ticketId, error } = failedResult;
					const currentResult = store.getValidationResult(ticketId);
					store.updateValidationResult(ticketId, {
						...(currentResult || {
							ticketId,
							ticketIdentifier: "",
							validationTimestamp: new Date().toISOString(),
							cached: false,
							contentAnalysis: {
								title: "",
								descriptionSummary: "",
								requirements: [],
							},
							completenessValidation: {
								isComplete: false,
								missingFields: [],
								feasibilityScore: 0,
								feasibilityReasoning: "",
							},
							suggestedLabels: [],
							versionRecommendation: {
								recommendedVersion: "",
								versionType: "patch",
								reasoning: "",
							},
							taskProperties: {
								category: "feature",
								complexity: "medium",
								impact: "medium",
								priority: "medium",
								rationale: "",
							},
						}),
						status: "error",
						error: error || "Validation failed",
					});
					results.set(ticketId, store.getValidationResult(ticketId)!);
				}

				store.setError(
					`${successful.length} succeeded, ${failed.length} failed`,
				);
			}
		} else {
			store.setError(result.error || "Batch validation failed");
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.setError(errorMessage);
	} finally {
		store.setLoading(false);
	}

	return results;
}

/**
 * Fetch available Linear teams
 */
export async function fetchLinearTeams(projectId: string): Promise<void> {
	const store = useLinearStore.getState();
	store.setLoading(true);
	store.setError(null);

	try {
		if (!window.electronAPI?.getLinearTeams) {
			console.warn("[fetchLinearTeams] Linear API not available");
			return;
		}

		const result = await window.electronAPI.getLinearTeams(projectId);

		if (result.success && result.data) {
			store.setTeams(result.data);
		} else {
			store.setError(result.error || "Failed to fetch Linear teams");
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.setError(errorMessage);
	} finally {
		store.setLoading(false);
	}
}

/**
 * Fetch available Linear projects
 */
export async function fetchLinearProjects(projectId: string, teamId?: string): Promise<void> {
	const store = useLinearStore.getState();
	store.setLoading(true);
	store.setError(null);

	try {
		if (!window.electronAPI?.getLinearProjects) {
			console.warn("[fetchLinearProjects] Linear API not available");
			return;
		}

		if (!teamId) {
			store.setProjects([]);
			return;
		}

		const result = await window.electronAPI.getLinearProjects(projectId, teamId);

		if (result.success && result.data) {
			store.setProjects(result.data);
		} else {
			store.setError(result.error || "Failed to fetch Linear projects");
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.setError(errorMessage);
	} finally {
		store.setLoading(false);
	}
}

/**
 * Update a Linear ticket with validation results
 */
export async function updateLinearTicketWithValidation(
	projectId: string,
	ticketId: string,
	validationResult: ValidationResult,
): Promise<boolean> {
	const store = useLinearStore.getState();

	try {
		if (!window.electronAPI?.updateLinearTicketWithValidation) {
			console.warn(
				"[updateLinearTicketWithValidation] Linear API not available",
			);
			return false;
		}

		if (!projectId) {
			const errorMessage = "No project selected";
			store.setError(errorMessage);
			return false;
		}

		const result =
			await window.electronAPI.updateLinearTicketWithValidation(
				projectId,
				ticketId,
				validationResult,
			);

		if (result.success) {
			store.updateValidationResult(ticketId, validationResult);
			return true;
		} else {
			store.setError(result.error || "Failed to update Linear ticket");
			return false;
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		store.setError(errorMessage);
		return false;
	}
}

/**
 * Create a task from validated Linear ticket
 * Integrates with the existing task creation flow in task-store
 */
export async function createTaskFromLinearTicket(
	ticketId: string,
	validationResult: ValidationResult,
): Promise<string | null> {
	const linearStore = useLinearStore.getState();

	try {
		// Import task-store dynamically to avoid circular dependency
		const { createTask } = await import("./task-store");
		const { useProjectStore } = await import("./project-store");

		// Get the selected project
		const projectStore = useProjectStore.getState();
		const selectedProject = projectStore.getSelectedProject();

		if (!selectedProject) {
			const error = "No project selected. Please select a project first.";
			linearStore.setError(error);
			return null;
		}

		// Get the Linear ticket from the store
		const ticketIndex = findTicketIndex(linearStore.tickets, ticketId);
		if (ticketIndex === -1) {
			const error = `Linear ticket not found: ${ticketId}`;
			linearStore.setError(error);
			return null;
		}

		const ticket = linearStore.tickets[ticketIndex];

		// Build task description from validation result
		const description = buildTaskDescriptionFromValidation(
			ticket,
			validationResult,
		);

		// Build metadata with Linear-specific fields and validated properties
		const metadata = {
			sourceType: "linear" as const,
			linearIssueId: ticket.id,
			linearIdentifier: ticket.identifier,
			linearUrl: ticket.url,
			category: validationResult.taskProperties.category,
			complexity: validationResult.taskProperties.complexity,
			impact: validationResult.taskProperties.impact,
			priority: validationResult.taskProperties.priority,
			rationale: validationResult.taskProperties.rationale,
			acceptanceCriteria: validationResult.contentAnalysis.requirements,
		};

		// Create the task using the task-store's createTask function
		const task = await createTask(
			selectedProject.id,
			validationResult.contentAnalysis.title || ticket.title,
			description,
			metadata,
		);

		if (task) {
			return task.id;
		} else {
			const error = "Failed to create task from Linear ticket";
			linearStore.setError(error);
			return null;
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		linearStore.setError(errorMessage);
		console.error("[createTaskFromLinearTicket] Error:", error);
		return null;
	}
}

/**
 * Build a comprehensive task description from Linear ticket and validation result
 */
function buildTaskDescriptionFromValidation(
	ticket: LinearTicket,
	validation: ValidationResult,
): string {
	const parts: string[] = [];

	// Add original description if available
	if (ticket.description) {
		parts.push(`**Original Description:**\n${ticket.description}\n`);
	}

	// Add validation summary
	parts.push("**AI Validation Summary:**");

	// Content analysis
	if (validation.contentAnalysis.descriptionSummary) {
		parts.push(`\n*Summary:* ${validation.contentAnalysis.descriptionSummary}`);
	}

	// Requirements
	if (validation.contentAnalysis.requirements.length > 0) {
		parts.push("\n*Requirements:*");
		validation.contentAnalysis.requirements.forEach((req, i) => {
			parts.push(`  ${i + 1}. ${req}`);
		});
	}

	// Completeness validation
	parts.push(
		`\n*Completeness:* ${validation.completenessValidation.isComplete ? "✅ Complete" : "⚠️ Incomplete"}`,
	);
	if (validation.completenessValidation.missingFields.length > 0) {
		parts.push(
			`  *Missing:* ${validation.completenessValidation.missingFields.join(", ")}`,
		);
	}
	parts.push(
		`  *Feasibility Score:* ${validation.completenessValidation.feasibilityScore}/100`,
	);

	// Suggested labels
	if (validation.suggestedLabels.length > 0) {
		parts.push("\n*Suggested Labels:*");
		validation.suggestedLabels.forEach((label) => {
			parts.push(
				`  - ${label.name} (${label.confidence}% confidence): ${label.reason}`,
			);
		});
	}

	// Version recommendation
	if (validation.versionRecommendation.recommendedVersion) {
		parts.push(
			`\n*Version Recommendation:* ${validation.versionRecommendation.recommendedVersion}`,
		);
		parts.push(`  *Type:* ${validation.versionRecommendation.versionType}`);
		parts.push(`  *Reasoning:* ${validation.versionRecommendation.reasoning}`);
	}

	// Task properties
	parts.push("\n*Task Properties:*");
	parts.push(`  *Category:* ${validation.taskProperties.category}`);
	parts.push(`  *Complexity:* ${validation.taskProperties.complexity}`);
	parts.push(`  *Impact:* ${validation.taskProperties.impact}`);
	parts.push(`  *Priority:* ${validation.taskProperties.priority}`);
	parts.push(`  *Rationale:* ${validation.taskProperties.rationale}`);

	// Add Linear ticket reference
	parts.push(`\n---\n**Source:** [${ticket.identifier}](${ticket.url})`);

	return parts.join("\n");
}
