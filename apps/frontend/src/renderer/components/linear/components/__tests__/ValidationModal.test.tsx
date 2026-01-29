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
});
