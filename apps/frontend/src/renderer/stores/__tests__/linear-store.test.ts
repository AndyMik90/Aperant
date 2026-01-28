/**
 * Unit tests for Linear Store
 * Tests Zustand store for Linear ticket state management
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	LinearFilters,
	LinearProject,
	LinearTeam,
	LinearTicket,
	ValidationResult,
} from "../../../shared/types";
import { useLinearStore } from "../linear-store";

// Helper to create test tickets
function createTestTicket(overrides: Partial<LinearTicket> = {}): LinearTicket {
	return {
		id: `ticket-${Date.now()}-${Math.random().toString(36).substring(7)}`,
		identifier: "LIN-123",
		title: "Test Ticket",
		description: "Test description",
		state: {
			id: "state-1",
			name: "In Progress",
			type: "started",
		},
		priority: 2,
		priorityLabel: "High",
		labels: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		url: "https://linear.app/issue/LIN-123",
		...overrides,
	};
}

// Helper to create test validation result
function createTestValidationResult(
	overrides: Partial<ValidationResult> = {},
): ValidationResult {
	return {
		ticketId: "LIN-123",
		ticketIdentifier: "LIN-123",
		validationTimestamp: new Date().toISOString(),
		cached: false,
		status: "complete",
		contentAnalysis: {
			title: "Test Analysis",
			descriptionSummary: "Test description analysis",
			requirements: ["Req 1", "Req 2"],
		},
		completenessValidation: {
			isComplete: true,
			missingFields: [],
			feasibilityScore: 90,
			feasibilityReasoning: "All required fields present",
		},
		suggestedLabels: [
			{ name: "bug", confidence: 0.95, reason: "Bug detected" },
			{ name: "high-priority", confidence: 0.9, reason: "High impact" },
		],
		versionRecommendation: {
			currentVersion: "2.7.4",
			recommendedVersion: "2.7.5",
			versionType: "patch",
			reasoning: "Critical bug fix",
		},
		taskProperties: {
			category: "bug_fix",
			complexity: "medium",
			impact: "high",
			priority: "high",
			rationale: "High priority bug fix",
		},
		...overrides,
	};
}

// Helper to create test filters
function createTestFilters(
	overrides: Partial<LinearFilters> = {},
): LinearFilters {
	return {
		teamId: undefined,
		projectId: undefined,
		status: undefined,
		labels: [],
		assigneeId: undefined,
		priority: undefined,
		...overrides,
	};
}

describe("Linear Store", () => {
	beforeEach(() => {
		// Reset store to initial state before each test
		useLinearStore.setState({
			tickets: [],
			filters: createTestFilters(),
			validationResults: new Map(),
			validationProgress: new Map(),
			selectedTicketId: null,
			teams: [],
			projects: [],
			isLoading: false,
			error: null,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Ticket State", () => {
		describe("setTickets", () => {
			it("should set tickets array", () => {
				const tickets = [
					createTestTicket({ id: "ticket-1", identifier: "LIN-1" }),
					createTestTicket({ id: "ticket-2", identifier: "LIN-2" }),
				];

				useLinearStore.getState().setTickets(tickets);

				expect(useLinearStore.getState().tickets).toHaveLength(2);
				expect(useLinearStore.getState().tickets[0].id).toBe("ticket-1");
			});

			it("should replace existing tickets", () => {
				const initialTickets = [createTestTicket({ id: "old-ticket" })];
				const newTickets = [createTestTicket({ id: "new-ticket" })];

				useLinearStore.getState().setTickets(initialTickets);
				expect(useLinearStore.getState().tickets).toHaveLength(1);

				useLinearStore.getState().setTickets(newTickets);
				expect(useLinearStore.getState().tickets).toHaveLength(1);
				expect(useLinearStore.getState().tickets[0].id).toBe("new-ticket");
			});
		});

		describe("addTicket", () => {
			it("should add ticket to empty array", () => {
				const ticket = createTestTicket({ id: "ticket-1" });

				useLinearStore.getState().addTicket(ticket);

				expect(useLinearStore.getState().tickets).toHaveLength(1);
				expect(useLinearStore.getState().tickets[0].id).toBe("ticket-1");
			});

			it("should add ticket to existing array", () => {
				const existingTicket = createTestTicket({ id: "ticket-1" });
				const newTicket = createTestTicket({ id: "ticket-2" });

				useLinearStore.getState().setTickets([existingTicket]);
				useLinearStore.getState().addTicket(newTicket);

				expect(useLinearStore.getState().tickets).toHaveLength(2);
				expect(useLinearStore.getState().tickets[1].id).toBe("ticket-2");
			});
		});

		describe("updateTicket", () => {
			it("should update existing ticket by id", () => {
				const ticket = createTestTicket({
					id: "ticket-1",
					title: "Original Title",
				});

				useLinearStore.getState().setTickets([ticket]);
				useLinearStore
					.getState()
					.updateTicket("ticket-1", { title: "Updated Title" });

				expect(useLinearStore.getState().tickets[0].title).toBe(
					"Updated Title",
				);
			});

			it("should update existing ticket by identifier", () => {
				const ticket = createTestTicket({
					id: "ticket-1",
					identifier: "LIN-123",
					title: "Original Title",
				});

				useLinearStore.getState().setTickets([ticket]);
				useLinearStore
					.getState()
					.updateTicket("LIN-123", { title: "Updated Title" });

				expect(useLinearStore.getState().tickets[0].title).toBe(
					"Updated Title",
				);
			});

			it("should not update if ticket not found", () => {
				const ticket = createTestTicket({ id: "ticket-1" });

				useLinearStore.getState().setTickets([ticket]);
				useLinearStore
					.getState()
					.updateTicket("non-existent", { title: "Updated Title" });

				expect(useLinearStore.getState().tickets[0].title).toBe("Test Ticket");
			});
		});

		describe("removeTicket", () => {
			it("should remove ticket by id", () => {
				const ticket1 = createTestTicket({ id: "ticket-1" });
				const ticket2 = createTestTicket({ id: "ticket-2" });

				useLinearStore.getState().setTickets([ticket1, ticket2]);
				useLinearStore.getState().removeTicket("ticket-1");

				expect(useLinearStore.getState().tickets).toHaveLength(1);
				expect(useLinearStore.getState().tickets[0].id).toBe("ticket-2");
			});

			it("should not error when removing non-existent ticket", () => {
				const ticket = createTestTicket({ id: "ticket-1" });

				useLinearStore.getState().setTickets([ticket]);
				expect(() => {
					useLinearStore.getState().removeTicket("non-existent");
				}).not.toThrow();

				expect(useLinearStore.getState().tickets).toHaveLength(1);
			});
		});

		describe("clearTickets", () => {
			it("should clear all tickets", () => {
				const tickets = [
					createTestTicket({ id: "ticket-1" }),
					createTestTicket({ id: "ticket-2" }),
				];

				useLinearStore.getState().setTickets(tickets);
				expect(useLinearStore.getState().tickets).toHaveLength(2);

				useLinearStore.getState().clearTickets();

				expect(useLinearStore.getState().tickets).toHaveLength(0);
			});
		});
	});

	describe("Filter State", () => {
		describe("setFilters", () => {
			it("should set all filters", () => {
				const filters: LinearFilters = {
					teamId: "team-1",
					projectId: "project-1",
					status: "In Progress",
					labels: ["bug", "urgent"],
					assigneeId: "user-1",
					priority: 2,
				};

				useLinearStore.getState().setFilters(filters);

				expect(useLinearStore.getState().filters).toEqual(filters);
			});

			it("should replace existing filters", () => {
				const initialFilters = createTestFilters({ status: "Backlog" });
				const newFilters = createTestFilters({ status: "In Progress" });

				useLinearStore.getState().setFilters(initialFilters);
				useLinearStore.getState().setFilters(newFilters);

				expect(useLinearStore.getState().filters.status).toBe("In Progress");
			});
		});

		describe("updateFilter", () => {
			it("should update single filter", () => {
				useLinearStore.getState().updateFilter("status", "In Progress");

				expect(useLinearStore.getState().filters.status).toBe("In Progress");
			});

			it("should update multiple filters sequentially", () => {
				useLinearStore.getState().updateFilter("status", "In Progress");
				useLinearStore.getState().updateFilter("priority", 1);

				expect(useLinearStore.getState().filters.status).toBe("In Progress");
				expect(useLinearStore.getState().filters.priority).toBe(1);
			});
		});

		describe("clearFilters", () => {
			it("should reset all filters to null/empty", () => {
				const filters: LinearFilters = {
					teamId: "team-1",
					projectId: "project-1",
					status: "In Progress",
					labels: ["bug"],
					assigneeId: "user-1",
					priority: 2,
				};

				useLinearStore.getState().setFilters(filters);
				useLinearStore.getState().clearFilters();

				expect(useLinearStore.getState().filters).toEqual(createTestFilters());
			});
		});
	});

	describe("Validation Results State", () => {
		describe("setValidationResults", () => {
			it("should set validation results map", () => {
				const results = new Map([
					["LIN-123", createTestValidationResult()],
					["LIN-456", createTestValidationResult()],
				]);

				useLinearStore.getState().setValidationResults(results);

				expect(useLinearStore.getState().validationResults.size).toBe(2);
				expect(useLinearStore.getState().validationResults.has("LIN-123")).toBe(
					true,
				);
			});
		});

		describe("updateValidationResult", () => {
			it("should add validation result for ticket", () => {
				const result = createTestValidationResult();

				useLinearStore.getState().updateValidationResult("LIN-123", result);

				expect(useLinearStore.getState().validationResults.has("LIN-123")).toBe(
					true,
				);
				expect(
					useLinearStore.getState().validationResults.get("LIN-123"),
				).toEqual(result);
			});

			it("should update existing validation result", () => {
				const initialResult = createTestValidationResult({
					status: "pending" as const,
				});
				const updatedResult = createTestValidationResult({
					status: "complete" as const,
				});

				useLinearStore
					.getState()
					.updateValidationResult("LIN-123", initialResult);
				expect(
					useLinearStore.getState().validationResults.get("LIN-123")
						?.status,
				).toBe("pending");

				useLinearStore
					.getState()
					.updateValidationResult("LIN-123", updatedResult);
				expect(
					useLinearStore.getState().validationResults.get("LIN-123")
						?.status,
				).toBe("complete");
			});
		});

		describe("removeValidationResult", () => {
			it("should remove validation result for ticket", () => {
				const result = createTestValidationResult();

				useLinearStore.getState().updateValidationResult("LIN-123", result);
				expect(useLinearStore.getState().validationResults.has("LIN-123")).toBe(
					true,
				);

				useLinearStore.getState().removeValidationResult("LIN-123");

				expect(useLinearStore.getState().validationResults.has("LIN-123")).toBe(
					false,
				);
			});
		});

		describe("clearValidationResults", () => {
			it("should clear all validation results", () => {
				useLinearStore
					.getState()
					.updateValidationResult("LIN-123", createTestValidationResult());
				useLinearStore
					.getState()
					.updateValidationResult("LIN-456", createTestValidationResult());

				expect(useLinearStore.getState().validationResults.size).toBe(2);

				useLinearStore.getState().clearValidationResults();

				expect(useLinearStore.getState().validationResults.size).toBe(0);
			});
		});
	});

	describe("Validation Progress State", () => {
		describe("updateValidationProgress", () => {
			it("should add progress for ticket", () => {
				const progress = {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing content...",
				};

				useLinearStore.getState().updateValidationProgress("LIN-123", progress);

				const storedProgress = useLinearStore
					.getState()
					.getValidationProgress("LIN-123");
				expect(storedProgress).toEqual(progress);
			});

			it("should update existing progress for ticket", () => {
				const initialProgress = {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing...",
				};

				const updatedProgress = {
					phase: "completeness",
					step: 2,
					total: 5,
					message: "Checking completeness...",
				};

				useLinearStore.getState().updateValidationProgress("LIN-123", initialProgress);
				useLinearStore.getState().updateValidationProgress("LIN-123", updatedProgress);

				const storedProgress = useLinearStore
					.getState()
					.getValidationProgress("LIN-123");
				expect(storedProgress).toEqual(updatedProgress);
			});

			it("should add timestamp to progress", () => {
				const progress = {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing...",
				};

				const beforeTimestamp = Date.now();
				useLinearStore.getState().updateValidationProgress("LIN-123", progress);
				const afterTimestamp = Date.now();

				// Get raw progress from map (with timestamp)
				const rawProgress = useLinearStore.getState().validationProgress.get("LIN-123");
				expect(rawProgress?.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
				expect(rawProgress?.timestamp).toBeLessThanOrEqual(afterTimestamp);
			});
		});

		describe("clearValidationProgress", () => {
			it("should clear progress for specific ticket", () => {
				useLinearStore.getState().updateValidationProgress("LIN-123", {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing...",
				});

				expect(
					useLinearStore.getState().getValidationProgress("LIN-123")
				).toBeDefined();

				useLinearStore.getState().clearValidationProgress("LIN-123");

				expect(
					useLinearStore.getState().getValidationProgress("LIN-123")
				).toBeUndefined();
			});

			it("should not affect progress for other tickets", () => {
				useLinearStore.getState().updateValidationProgress("LIN-123", {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing...",
				});
				useLinearStore.getState().updateValidationProgress("LIN-456", {
					phase: "completeness",
					step: 2,
					total: 5,
					message: "Checking...",
				});

				useLinearStore.getState().clearValidationProgress("LIN-123");

				expect(
					useLinearStore.getState().getValidationProgress("LIN-123")
				).toBeUndefined();
				expect(
					useLinearStore.getState().getValidationProgress("LIN-456")
				).toBeDefined();
			});
		});

		describe("getValidationProgress", () => {
			it("should return progress without timestamp", () => {
				const progress = {
					phase: "content_analysis",
					step: 1,
					total: 5,
					message: "Analyzing...",
				};

				useLinearStore.getState().updateValidationProgress("LIN-123", progress);

				const retrieved = useLinearStore
					.getState()
					.getValidationProgress("LIN-123");

				// Should not include timestamp
				expect(retrieved).toEqual(progress);
				expect(retrieved).not.toHaveProperty("timestamp");
			});

			it("should return undefined for non-existent ticket", () => {
				const progress = useLinearStore
					.getState()
					.getValidationProgress("non-existent");
				expect(progress).toBeUndefined();
			});
		});
	});

	describe("Selectors", () => {
		describe("getSelectedTicket", () => {
			it("should return selected ticket", () => {
				const ticket = createTestTicket({ id: "ticket-1" });

				useLinearStore.getState().setTickets([ticket]);
				useLinearStore.getState().selectTicket("ticket-1");

				const selected = useLinearStore.getState().getSelectedTicket();
				expect(selected?.id).toBe("ticket-1");
			});

			it("should return null when no ticket selected", () => {
				const selected = useLinearStore.getState().getSelectedTicket();
				expect(selected).toBeNull();
			});
		});

		describe("getValidationResult", () => {
			it("should return validation result for ticket", () => {
				const result = createTestValidationResult();

				useLinearStore.getState().updateValidationResult("LIN-123", result);

				const retrieved = useLinearStore
					.getState()
					.getValidationResult("LIN-123");
				expect(retrieved).toEqual(result);
			});

			it("should return undefined for non-existent ticket", () => {
				const retrieved = useLinearStore
					.getState()
					.getValidationResult("non-existent");
				expect(retrieved).toBeUndefined();
			});
		});

		describe("getFilteredTickets", () => {
			it("should return all tickets when no filters active", () => {
				const tickets = [
					createTestTicket({ id: "ticket-1", identifier: "LIN-1" }),
					createTestTicket({ id: "ticket-2", identifier: "LIN-2" }),
				];

				useLinearStore.getState().setTickets(tickets);

				const filtered = useLinearStore.getState().getFilteredTickets();
				expect(filtered).toHaveLength(2);
			});

			it("should filter by status when status filter set", () => {
				const tickets = [
					createTestTicket({
						id: "ticket-1",
						state: { id: "s1", name: "Backlog", type: "backlog" },
					}),
					createTestTicket({
						id: "ticket-2",
						state: { id: "s2", name: "In Progress", type: "started" },
					}),
				];

				useLinearStore.getState().setTickets(tickets);
				useLinearStore.getState().updateFilter("status", "In Progress");

				const filtered = useLinearStore.getState().getFilteredTickets();
				expect(filtered).toHaveLength(1);
				expect(filtered[0].id).toBe("ticket-2");
			});

			it("should filter by priority when priority filter set", () => {
				const tickets = [
					createTestTicket({ id: "ticket-1", priority: 1 }),
					createTestTicket({ id: "ticket-2", priority: 2 }),
					createTestTicket({ id: "ticket-3", priority: 2 }),
				];

				useLinearStore.getState().setTickets(tickets);
				useLinearStore.getState().updateFilter("priority", 2);

				const filtered = useLinearStore.getState().getFilteredTickets();
				expect(filtered).toHaveLength(2);
			});
		});

		describe("getTicketsByStatus", () => {
			it("should return tickets with matching status", () => {
				const tickets = [
					createTestTicket({
						id: "ticket-1",
						state: { id: "s1", name: "Backlog", type: "backlog" },
					}),
					createTestTicket({
						id: "ticket-2",
						state: { id: "s2", name: "In Progress", type: "started" },
					}),
					createTestTicket({
						id: "ticket-3",
						state: { id: "s3", name: "Backlog", type: "backlog" },
					}),
				];

				useLinearStore.getState().setTickets(tickets);

				const backlogTickets = useLinearStore
					.getState()
					.getTicketsByStatus("Backlog");
				expect(backlogTickets).toHaveLength(2);

				const inProgressTickets = useLinearStore
					.getState()
					.getTicketsByStatus("In Progress");
				expect(inProgressTickets).toHaveLength(1);
			});
		});

		describe("getTicketsByPriority", () => {
			it("should return tickets with matching priority", () => {
				const tickets = [
					createTestTicket({ id: "ticket-1", priority: 1 }),
					createTestTicket({ id: "ticket-2", priority: 2 }),
					createTestTicket({ id: "ticket-3", priority: 2 }),
					createTestTicket({ id: "ticket-4", priority: 3 }),
				];

				useLinearStore.getState().setTickets(tickets);

				const priority2Tickets = useLinearStore
					.getState()
					.getTicketsByPriority(2);
				expect(priority2Tickets).toHaveLength(2);

				const priority1Tickets = useLinearStore
					.getState()
					.getTicketsByPriority(1);
				expect(priority1Tickets).toHaveLength(1);
			});
		});
	});

	describe("UI State", () => {
		describe("selectTicket", () => {
			it("should set selected ticket ID", () => {
				useLinearStore.getState().selectTicket("ticket-1");

				expect(useLinearStore.getState().selectedTicketId).toBe("ticket-1");
			});

			it("should clear selection when null passed", () => {
				useLinearStore.getState().selectTicket("ticket-1");
				expect(useLinearStore.getState().selectedTicketId).toBe("ticket-1");

				useLinearStore.getState().selectTicket(null);

				expect(useLinearStore.getState().selectedTicketId).toBeNull();
			});
		});

		describe("setLoading", () => {
			it("should set loading state", () => {
				useLinearStore.getState().setLoading(true);

				expect(useLinearStore.getState().isLoading).toBe(true);

				useLinearStore.getState().setLoading(false);

				expect(useLinearStore.getState().isLoading).toBe(false);
			});
		});

		describe("setError", () => {
			it("should set error message", () => {
				const errorMsg = "Failed to fetch tickets";

				useLinearStore.getState().setError(errorMsg);

				expect(useLinearStore.getState().error).toBe(errorMsg);
			});

			it("should clear error when null passed", () => {
				useLinearStore.getState().setError("Some error");
				expect(useLinearStore.getState().error).toBe("Some error");

				useLinearStore.getState().setError(null);

				expect(useLinearStore.getState().error).toBeNull();
			});
		});
	});

	describe("Team and Project State", () => {
		describe("setTeams", () => {
			it("should set teams array", () => {
				const teams: LinearTeam[] = [
					{ id: "team-1", name: "Engineering", key: "ENG" },
					{ id: "team-2", name: "Design", key: "DES" },
				];

				useLinearStore.getState().setTeams(teams);

				expect(useLinearStore.getState().teams).toHaveLength(2);
				expect(useLinearStore.getState().teams[0].name).toBe("Engineering");
			});
		});

		describe("setProjects", () => {
			it("should set projects array", () => {
				const projects: LinearProject[] = [
					{ id: "project-1", name: "Mobile App", state: "started" },
					{ id: "project-2", name: "Web App", state: "backlog" },
				];

				useLinearStore.getState().setProjects(projects);

				expect(useLinearStore.getState().projects).toHaveLength(2);
				expect(useLinearStore.getState().projects[0].name).toBe("Mobile App");
			});
		});
	});
});
