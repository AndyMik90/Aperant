/**
 * Tests for useLinearTickets hook
 *
 * Tests the custom hook that manages Linear ticket state, validation,
 * and the critical fix for ticket.identifier vs ticket.id key mapping.
 *
 * @vitest-environment jsdom
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LinearTicket, ValidationResult } from "@shared/types/integrations";

// Mock the linear-store - must be inline for vi.mock hoisting
vi.mock("../../../../stores/linear-store", async () => {
	const actual = await vi.importActual("../../../../stores/linear-store");
	return {
		...actual,
	};
});

import { useLinearTickets } from "../useLinearTickets";
import { useLinearStore } from "../../../../stores/linear-store";

// Mock electronAPI functions
const mockCheckLinearConnection = vi.fn();
const mockGetLinearIssues = vi.fn();
const mockGetLinearTeams = vi.fn();
const mockGetLinearProjects = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();

	// Mock electronAPI
	Object.defineProperty(global.window, "electronAPI", {
		value: {
			checkLinearConnection: mockCheckLinearConnection,
			getLinearIssues: mockGetLinearIssues,
			getLinearTeams: mockGetLinearTeams,
			getLinearProjects: mockGetLinearProjects,
		},
		writable: true,
		configurable: true,
	});

	// Reset store state
	useLinearStore.getState().clearTickets();
	useLinearStore.getState().clearValidationResults();
	useLinearStore.getState().selectTicket(null);
});

describe("useLinearTickets - Validation Result Key Mapping", () => {
	/**
	 * CRITICAL TEST: Verifies that validation results are stored and retrieved
	 * using ticket.identifier (e.g., "LIN-123") NOT ticket.id (UUID).
	 *
	 * This tests the fix for the bug where validation completed but results
	 * never displayed because of key mismatch.
	 */
	it("should retrieve validation result using ticket.identifier, not ticket.id", async () => {
		const mockTicket: LinearTicket = {
			id: "uuid-1234-5678-abcd",
			identifier: "LIN-123",
			title: "Test Ticket",
			url: "https://linear.app/test/LIN-123",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const mockValidationResult: ValidationResult = {
			ticketId: "LIN-123",
			ticketIdentifier: "LIN-123",
			validationTimestamp: "2024-01-01T00:00:00.000Z",
			cached: false,
			status: "complete",
			contentAnalysis: {
				title: "Test Ticket",
				descriptionSummary: "A test ticket",
				requirements: ["req1", "req2"],
			},
			completenessValidation: {
				isComplete: true,
				missingFields: [],
				feasibilityScore: 85,
				feasibilityReasoning: "Well-defined",
			},
			suggestedLabels: [],
			versionRecommendation: {
				recommendedVersion: "1.0.0",
				versionType: "patch",
				reasoning: "Initial version",
			},
			taskProperties: {
				category: "feature",
				complexity: "medium",
				impact: "medium",
				priority: "medium",
				rationale: "Test rationale",
			},
		};

		// Mock connection check
		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		// Mock getLinearIssues to return our test ticket
		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [mockTicket],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		// Wait for tickets to load
		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(1);
		});

		// Select the ticket (this uses ticket.id / UUID)
		act(() => {
			result.current.selectTicket(mockTicket.id);
		});

		expect(result.current.selectedTicketId).toBe(mockTicket.id);
		expect(result.current.selectedTicket?.identifier).toBe("LIN-123");

		// Store validation result using ticket.identifier as key (this is what validateLinearTicket does)
		act(() => {
			useLinearStore
				.getState()
				.updateValidationResult("LIN-123", mockValidationResult);
		});

		// CRITICAL ASSERTION: selectedValidationResult should be found
		// This was broken before the fix - it tried to look up by UUID instead of identifier
		expect(result.current.selectedValidationResult).toEqual(
			mockValidationResult,
		);
	});

	/**
	 * Test that multiple tickets can have validation results
	 * and each is correctly retrieved by its identifier
	 */
	it("should retrieve correct validation result for each ticket by identifier", async () => {
		const ticket1: LinearTicket = {
			id: "uuid-1",
			identifier: "LIN-1",
			title: "Ticket 1",
			url: "https://linear.app/test/LIN-1",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 1,
			priorityLabel: "Low",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const ticket2: LinearTicket = {
			id: "uuid-2",
			identifier: "LIN-2",
			title: "Ticket 2",
			url: "https://linear.app/test/LIN-2",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const result1: ValidationResult = {
			ticketId: "LIN-1",
			ticketIdentifier: "LIN-1",
			validationTimestamp: "2024-01-01T00:00:00.000Z",
			cached: false,
			status: "complete",
			contentAnalysis: {
				title: "Ticket 1",
				descriptionSummary: "First ticket",
				requirements: [],
			},
			completenessValidation: {
				isComplete: true,
				missingFields: [],
				feasibilityScore: 90,
				feasibilityReasoning: "Good",
			},
			suggestedLabels: [],
			versionRecommendation: {
				recommendedVersion: "1.0.0",
				versionType: "patch",
				reasoning: "Initial",
			},
			taskProperties: {
				category: "feature",
				complexity: "small",
				impact: "low",
				priority: "low",
				rationale: "",
			},
		};

		const result2: ValidationResult = {
			...result1,
			ticketId: "LIN-2",
			ticketIdentifier: "LIN-2",
			contentAnalysis: {
				title: "Ticket 2",
				descriptionSummary: "Second ticket",
				requirements: [],
			},
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [ticket1, ticket2],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(2);
		});

		// Store both validation results using identifiers
		act(() => {
			useLinearStore.getState().updateValidationResult("LIN-1", result1);
			useLinearStore.getState().updateValidationResult("LIN-2", result2);
		});

		// Select ticket 1
		act(() => {
			result.current.selectTicket(ticket1.id);
		});

		expect(result.current.selectedValidationResult).toEqual(result1);

		// Select ticket 2
		act(() => {
			result.current.selectTicket(ticket2.id);
		});

		expect(result.current.selectedValidationResult).toEqual(result2);
	});

	/**
	 * Test that selectedValidationResult is null when no ticket is selected
	 */
	it("should return null for selectedValidationResult when no ticket selected", () => {
		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		expect(result.current.selectedValidationResult).toBeNull();
	});

	/**
	 * Test that selectedValidationResult is null when selected ticket has no validation
	 */
	it("should return null for selectedValidationResult when ticket has no validation result", async () => {
		const mockTicket: LinearTicket = {
			id: "uuid-123",
			identifier: "LIN-999",
			title: "Unvalidated Ticket",
			url: "https://linear.app/test/LIN-999",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [mockTicket],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(1);
		});

		act(() => {
			result.current.selectTicket(mockTicket.id);
		});

		// No validation result stored
		expect(result.current.selectedValidationResult).toBeNull();
	});
});

describe("useLinearTickets - Validation State", () => {
	/**
	 * Test that isValidating correctly reflects validation status
	 */
	it("should return true for isValidating when any ticket has status 'validating'", async () => {
		const mockTicket: LinearTicket = {
			id: "uuid-123",
			identifier: "LIN-123",
			title: "Test Ticket",
			url: "https://linear.app/test/LIN-123",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [mockTicket],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(1);
		});

		// Initially not validating
		expect(result.current.isValidating).toBe(false);

		// Set validation status to 'validating'
		act(() => {
			useLinearStore.getState().updateValidationResult("LIN-123", {
				ticketId: "LIN-123",
				ticketIdentifier: "LIN-123",
				validationTimestamp: new Date().toISOString(),
				cached: false,
				status: "validating",
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
			});
		});

		expect(result.current.isValidating).toBe(true);

		// Set validation status to 'complete'
		act(() => {
			useLinearStore.getState().updateValidationResult("LIN-123", {
				ticketId: "LIN-123",
				ticketIdentifier: "LIN-123",
				validationTimestamp: new Date().toISOString(),
				cached: false,
				status: "complete",
				contentAnalysis: {
					title: "Test",
					descriptionSummary: "Test",
					requirements: [],
				},
				completenessValidation: {
					isComplete: true,
					missingFields: [],
					feasibilityScore: 100,
					feasibilityReasoning: "",
				},
				suggestedLabels: [],
				versionRecommendation: {
					recommendedVersion: "1.0.0",
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
			});
		});

		expect(result.current.isValidating).toBe(false);
	});

	/**
	 * Test that validationResults map contains all validation results
	 */
	it("should return validationResults map containing all stored validations", async () => {
		const ticket1: LinearTicket = {
			id: "uuid-1",
			identifier: "LIN-1",
			title: "Ticket 1",
			url: "https://linear.app/test/LIN-1",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 1,
			priorityLabel: "Low",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const ticket2: LinearTicket = {
			id: "uuid-2",
			identifier: "LIN-2",
			title: "Ticket 2",
			url: "https://linear.app/test/LIN-2",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [ticket1, ticket2],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(2);
		});

		// Store validation results
		act(() => {
			useLinearStore.getState().updateValidationResult("LIN-1", {
				ticketId: "LIN-1",
				ticketIdentifier: "LIN-1",
				validationTimestamp: "2024-01-01T00:00:00.000Z",
				cached: false,
				status: "complete",
				contentAnalysis: {
					title: "Ticket 1",
					descriptionSummary: "",
					requirements: [],
				},
				completenessValidation: {
					isComplete: true,
					missingFields: [],
					feasibilityScore: 100,
					feasibilityReasoning: "",
				},
				suggestedLabels: [],
				versionRecommendation: {
					recommendedVersion: "1.0.0",
					versionType: "patch",
					reasoning: "",
				},
				taskProperties: {
					category: "feature",
					complexity: "small",
					impact: "low",
					priority: "low",
					rationale: "",
				},
			});
			useLinearStore.getState().updateValidationResult("LIN-2", {
				ticketId: "LIN-2",
				ticketIdentifier: "LIN-2",
				validationTimestamp: "2024-01-01T00:00:00.000Z",
				cached: false,
				status: "complete",
				contentAnalysis: {
					title: "Ticket 2",
					descriptionSummary: "",
					requirements: [],
				},
				completenessValidation: {
					isComplete: true,
					missingFields: [],
					feasibilityScore: 100,
					feasibilityReasoning: "",
				},
				suggestedLabels: [],
				versionRecommendation: {
					recommendedVersion: "1.0.0",
					versionType: "patch",
					reasoning: "",
				},
				taskProperties: {
					category: "feature",
					complexity: "small",
					impact: "low",
					priority: "low",
					rationale: "",
				},
			});
		});

		// Check that validationResults map contains both
		expect(result.current.validationResults.size).toBe(2);
		expect(result.current.validationResults.get("LIN-1")).toBeDefined();
		expect(result.current.validationResults.get("LIN-2")).toBeDefined();
	});
});

describe("useLinearTickets - Ticket Selection", () => {
	/**
	 * Test that selectTicket updates selectedTicketId and selectedTicket
	 */
	it("should update selectedTicketId and selectedTicket when selectTicket is called", async () => {
		const mockTicket: LinearTicket = {
			id: "uuid-123",
			identifier: "LIN-123",
			title: "Test Ticket",
			url: "https://linear.app/test/LIN-123",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [mockTicket],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(1);
		});

		expect(result.current.selectedTicketId).toBeNull();
		expect(result.current.selectedTicket).toBeNull();

		act(() => {
			result.current.selectTicket(mockTicket.id);
		});

		expect(result.current.selectedTicketId).toBe(mockTicket.id);
		expect(result.current.selectedTicket).toEqual(mockTicket);
	});

	/**
	 * Test that selectTicket(null) clears the selection
	 */
	it("should clear selection when selectTicket(null) is called", async () => {
		const mockTicket: LinearTicket = {
			id: "uuid-123",
			identifier: "LIN-123",
			title: "Test Ticket",
			url: "https://linear.app/test/LIN-123",
			state: { id: "state-1", name: "Todo", type: "todo" },
			priority: 2,
			priorityLabel: "Medium",
			labels: [],
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		mockCheckLinearConnection.mockResolvedValue({
			success: true,
			data: { connected: true },
		});

		mockGetLinearIssues.mockResolvedValue({
			success: true,
			data: [mockTicket],
		});

		const { result } = renderHook(() =>
			useLinearTickets({
				isActive: true,
				projectId: "test-project",
			}),
		);

		await waitFor(() => {
			expect(result.current.tickets).toHaveLength(1);
		});

		act(() => {
			result.current.selectTicket(mockTicket.id);
		});

		expect(result.current.selectedTicketId).toBe(mockTicket.id);

		act(() => {
			result.current.selectTicket(null);
		});

		expect(result.current.selectedTicketId).toBeNull();
		expect(result.current.selectedTicket).toBeNull();
	});
});
