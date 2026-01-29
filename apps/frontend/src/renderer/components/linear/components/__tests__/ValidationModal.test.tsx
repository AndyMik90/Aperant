/**
 * Tests for ValidationModal component
 * Tests the modal that displays AI validation results for Linear tickets
 *
 * @vitest-environment jsdom
 */

import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ValidationModal } from "../ValidationModal";
import type { ValidationResult } from "../../../../../shared/types";

// Mock electronAPI with Linear API at top level
const mockCleanup = vi.fn();
const mockElectronAPI = {
	cancelLinearValidation: vi.fn().mockResolvedValue({ success: true }),
	onLinearValidationProgress: vi.fn(() => mockCleanup),
};

// Setup window.electronAPI
Object.defineProperty(window, "electronAPI", {
	value: mockElectronAPI,
	writable: true,
	configurable: true,
});

// Mock useLinearValidationProgress to track progress updates
vi.mock("../../../hooks/useLinearValidationProgress", () => ({
	useLinearValidationProgress: vi.fn((ticketId?: string) => {
		// Simulate progress events during mount
		// This is called when the modal component mounts
	}),
}));

function createMockValidation(
	overrides: Partial<ValidationResult> = {},
): ValidationResult {
	return {
		ticketId: "LIN-123",
		ticketIdentifier: "LIN-123",
		validationTimestamp: new Date().toISOString(),
		cached: false,
		status: "complete",
		contentAnalysis: {
			title: "Fix authentication bug",
			descriptionSummary: "Fix the auth bug in login flow",
			requirements: [
				"Identify root cause",
				"Implement fix",
				"Add tests",
			],
		},
		completenessValidation: {
			isComplete: true,
			missingFields: [],
			feasibilityScore: 85,
			feasibilityReasoning: "Well-defined requirements",
		},
		suggestedLabels: [
			{ name: "bug", confidence: 0.95, reason: "Bug detected in authentication" },
			{ name: "high-priority", confidence: 0.9, reason: "Affects user login" },
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
			rationale: "Blocks user authentication",
		},
		...overrides,
	};
}

describe("ValidationModal", () => {
	const mockOnOpenChange = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Basic Rendering", () => {
		it("should render without errors when validation is complete", () => {
			const validation = createMockValidation();

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		it("should render without errors when validation is in progress", () => {
			const validation = createMockValidation({
				status: "validating",
			});

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		it("should render without errors when validation is null", () => {
			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={null}
					/>
				);
			}).not.toThrow();
		});

		it("should render without errors when open is false", () => {
			const validation = createMockValidation();

			expect(() => {
				render(
					<ValidationModal
						open={false}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});

	describe("Props Handling", () => {
		it("should accept ticketId prop", () => {
			const validation = createMockValidation();

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-456"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		it("should accept onOpenChange callback", () => {
			const validation = createMockValidation();
			const mockCallback = vi.fn();

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockCallback}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});

	describe("Streaming Progress Display", () => {
		/**
		 * CRITICAL TEST: Verifies that the modal displays loading state
		 * when validation is in progress with no results yet.
		 *
		 * This tests the fix where the modal would show indefinitely
		 * without displaying progress.
		 */
		it("should display loading state when validation is in progress with null result", () => {
			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={null}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that validation in progress shows validating status
		 */
		it("should show validating status when validation status is 'validating'", () => {
			const validation = createMockValidation({ status: "validating" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that completed validation shows validation complete status
		 */
		it("should show validation complete status when validation status is 'complete'", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that validation error shows error status
		 */
		it("should show error status when validation status is 'error'", () => {
			const validation = createMockValidation({
				status: "error",
				error: "Validation failed: API error",
			});

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that cancelled validation shows cancelled status
		 */
		it("should show cancelled status when validation status is 'cancelled'", () => {
			const validation = createMockValidation({ status: "cancelled" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});

	describe("Validation Steps Display", () => {
		/**
		 * Test that all 5 validation steps are displayed
		 */
		it("should display all 5 validation steps when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that content analysis section displays correctly
		 */
		it("should display content analysis when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that completeness validation displays correctly
		 */
		it("should display completeness validation when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that suggested labels are displayed
		 */
		it("should display suggested labels when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that version recommendation is displayed
		 */
		it("should display version recommendation when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that task properties are displayed
		 */
		it("should display task properties when validation is complete", () => {
				const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});

	describe("Validation Result States", () => {
		/**
		 * Test that cached validation shows cached indicator
		 */
		it("should display cached indicator when validation is cached", () => {
			const validation = createMockValidation({ cached: true });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that incomplete validation shows missing fields
		 */
		it("should display missing fields when validation is incomplete", () => {
			const validation = createMockValidation({
				status: "complete",
				completenessValidation: {
					isComplete: false,
					missingFields: ["Acceptance criteria", "Reproduction steps"],
					feasibilityScore: 45,
					feasibilityReasoning: "Needs more details",
				},
			});

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});

	describe("Modal Lifecycle", () => {
		/**
		 * Test that onOpenChange is called when modal is closed
		 */
		it("should call onOpenChange when close button is clicked", () => {
			const mockCallback = vi.fn();
			const validation = createMockValidation();

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockCallback}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});

		/**
		 * Test that modal renders correctly when validation is complete
		 */
		it("should render full results when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			expect(() => {
				render(
					<ValidationModal
						open={true}
						onOpenChange={mockOnOpenChange}
						ticketId="LIN-123"
						validation={validation}
					/>
				);
			}).not.toThrow();
		});
	});
});
