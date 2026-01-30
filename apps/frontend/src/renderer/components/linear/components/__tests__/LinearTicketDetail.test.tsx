/**
 * Tests for LinearTicketDetail component
 *
 * Tests the component that displays ticket details and triggers validation.
 * Key test: Progress modal opens immediately when validation starts.
 *
 * @vitest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LinearTicketDetail } from "../LinearTicketDetail";
import type { ValidationResult } from "@shared/types/integrations";

// Mock useLinearValidationProgress hook
vi.mock("../../../hooks/useLinearValidationProgress", () => ({
	useLinearValidationProgress: vi.fn(),
}));

// Mock LinearValidationProgress component - tracks open state
vi.mock("../LinearValidationProgress", () => ({
	LinearValidationProgress: ({ onStop }: { onStop?: () => void }) => (
		<div data-testid="validation-progress-modal">
			<div>Validation Progress Content</div>
			{onStop && <button onClick={onStop}>Stop</button>}
		</div>
	),
}));

// Mock ValidationResults component - tracks open state
vi.mock("../ValidationResults", () => ({
	ValidationResults: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
		<div data-testid="validation-results-modal" data-open={open} style={{ display: open ? "block" : "none" }}>
			<div>Validation Results Content</div>
			<button onClick={() => onOpenChange(false)}>Close</button>
		</div>
	),
}));

// Mock i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

// Mock linear store
vi.mock("../../../stores/linear-store", () => ({
	useLinearStore: () => vi.fn((selector) => {
		// Mock store implementation that returns undefined for most selectors
		const mockState = {
			validationProgress: new Map(),
		};
		return selector(mockState);
	}),
}));

describe("LinearTicketDetail - Immediate Modal Opening", () => {
	const mockTicket = {
		id: "uuid-123",
		identifier: "LIN-123",
		title: "Test Ticket Title",
		url: "https://linear.app/test/LIN-123",
		description: "Test ticket description",
		state: { id: "state-1", name: "Todo", type: "todo", color: "#gray" },
		priority: 2,
		priorityLabel: "Medium",
		labels: [],
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * CRITICAL TEST: Verifies that the validation progress modal opens IMMEDIATELY
	 * when validation starts, not after it completes.
	 *
	 * This tests the fix for the bug where the modal opened only after
	 * validation completed, causing the progress bar to never be visible.
	 */
	it("should open validation progress modal immediately when validation starts", async () => {
		// Mock validation that resolves after a delay
		let validationResolve: () => void = () => {};
		const validationPromise = new Promise<void>((resolve) => {
			validationResolve = resolve;
		});

		const mockOnRunValidation = vi.fn(() => validationPromise);

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Progress modal should not be visible initially
		const progressModalBefore = screen.queryByTestId("validation-progress-modal");
		expect(progressModalBefore).toBeNull();

		// Click the "Run Validation" button
		const validateButton = screen.getByRole("button");
		fireEvent.click(validateButton);

		// First check that validation was triggered
		await waitFor(() => {
			expect(mockOnRunValidation).toHaveBeenCalled();
		});

		// Then check that the progress modal appeared (use getByTestId since it's in DOM)
		// The modal is rendered with fixed positioning so it should be in the document
		const progressModal = screen.getByTestId("validation-progress-modal");
		expect(progressModal).toBeDefined();

		// Complete validation
		validationResolve();

		// Wait for promise to resolve
		await new Promise(resolve => setTimeout(resolve, 10));
	});

	/**
	 * Test that validation button is disabled while validating
	 */
	it("should disable validation button while validating", () => {
		const mockOnRunValidation = vi.fn(() => Promise.resolve());

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={true}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Button should be disabled while validating
		const validateButton = screen.getByRole("button");
		expect(validateButton.getAttribute("disabled")).not.toBeNull();
	});

	/**
	 * Test that results modal opens when validation completes
	 */
	it("should open results modal when validation completes", async () => {
		const mockValidationResult: ValidationResult = {
			ticketId: "LIN-123",
			ticketIdentifier: "LIN-123",
			validationTimestamp: "2024-01-01T00:00:00.000Z",
			cached: false,
			projectId: null,
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
		};

		const mockOnRunValidation = vi.fn(() => Promise.resolve());

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={mockValidationResult}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Results modal should be open when validation is complete
		await waitFor(() => {
			const resultsModal = screen.getByTestId("validation-results-modal");
			expect(resultsModal.getAttribute("data-open")).toBe("true");
		});
	});
});

describe("LinearTicketDetail - Display States", () => {
	const mockTicket = {
		id: "uuid-123",
		identifier: "LIN-123",
		title: "Test Ticket Title",
		url: "https://linear.app/test/LIN-123",
		description: "Test ticket description",
		state: { id: "state-1", name: "Todo", type: "todo", color: "#gray" },
		priority: 2,
		priorityLabel: "Medium",
		labels: [],
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
	};

	/**
	 * Test empty state when no ticket is selected
	 */
	it("should show empty state when no ticket selected", () => {
		render(
			<LinearTicketDetail
				ticket={null}
				validationResult={null}
				isValidating={false}
				onRunValidation={vi.fn()}
			/>,
		);

		expect(screen.getByText(/linear:selectTicket/i)).toBeDefined();
	});

	/**
	 * Test ticket details display
	 */
	it("should display ticket details when ticket is selected", () => {
		const mockOnRunValidation = vi.fn();

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Should show ticket title
		expect(screen.getByText("Test Ticket Title")).toBeDefined();

		// Should show ticket identifier
		expect(screen.getByText("LIN-123")).toBeDefined();

		// Should show run validation button
		const button = screen.getByRole("button");
		expect(button).toBeDefined();
	});

	/**
	 * Test validation status badge - validating state
	 */
	it("should show validating status badge when isValidating is true", () => {
		const mockOnRunValidation = vi.fn();

		const { container } = render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={true}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Should show validating badge (in the validation status area, not button)
		// Look for the specific badge container with role="status"
		const badge = container.querySelector('[role="status"]');
		expect(badge?.textContent).toContain("linear:validatingTicket");
	});

	/**
	 * Test validation status badge - complete state
	 */
	it("should show validated status badge when validation is complete", () => {
		const mockValidationResult: ValidationResult = {
			ticketId: "LIN-123",
			ticketIdentifier: "LIN-123",
			validationTimestamp: "2024-01-01T00:00:00.000Z",
			cached: false,
			projectId: null,
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
		};

		const mockOnRunValidation = vi.fn();

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={mockValidationResult}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Should show validated badge
		expect(screen.getByText(/linear:validated/i)).toBeDefined();

		// Should show validation summary
		expect(screen.getByText(/linear:validationComplete/i)).toBeDefined();
	});

	/**
	 * Test validation status badge - error state
	 */
	it("should show validation failed status badge when validation has error", () => {
		const mockValidationResult: ValidationResult = {
			ticketId: "LIN-123",
			ticketIdentifier: "LIN-123",
			validationTimestamp: "2024-01-01T00:00:00.000Z",
			cached: false,
			projectId: null,
			status: "error",
			error: "Validation failed",
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
		};

		const mockOnRunValidation = vi.fn();

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={mockValidationResult}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Should show validation failed badge
		expect(screen.getByText(/linear:validationFailed/i)).toBeDefined();
	});

	/**
	 * Test validation status badge - not validated state
	 */
	it("should show not validated status badge when no validation result", () => {
		const mockOnRunValidation = vi.fn();

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		// Should show not validated badge
		expect(screen.getByText(/linear:notValidated/i)).toBeDefined();
	});
});

describe("LinearTicketDetail - Validation Trigger", () => {
	const mockTicket = {
		id: "uuid-123",
		identifier: "LIN-123",
		title: "Test Ticket",
		url: "https://linear.app/test/LIN-123",
		description: "Test description",
		state: { id: "state-1", name: "Todo", type: "todo", color: "#gray" },
		priority: 2,
		priorityLabel: "Medium",
		labels: [],
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
	};

	/**
	 * Test that validation button calls onRunValidation when clicked
	 */
	it("should call onRunValidation when validation button is clicked", async () => {
		const mockOnRunValidation = vi.fn(async () => {});

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={false}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		const validateButton = screen.getByRole("button");
		fireEvent.click(validateButton);

		// Wait for the validation promise to resolve
		await waitFor(() => {
			expect(mockOnRunValidation).toHaveBeenCalledTimes(1);
		});
	});

	/**
	 * Test that validation button shows loading spinner while validating
	 */
	it("should show loading spinner in button while validating", () => {
		const mockOnRunValidation = vi.fn();

		render(
			<LinearTicketDetail
				ticket={mockTicket}
				validationResult={null}
				isValidating={true}
				onRunValidation={mockOnRunValidation}
			/>,
		);

		const button = screen.getByRole("button");
		// Button should contain spinner
		expect(button.innerHTML).toContain("animate-spin");
	});
});
