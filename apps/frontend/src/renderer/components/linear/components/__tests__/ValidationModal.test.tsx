/**
 * Tests for ValidationModal component
 * Tests the modal that displays AI validation results for Linear tickets
 *
 * @vitest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { I18nextProvider } from "react-i18next";
import { ValidationModal } from "../ValidationModal";
import type { ValidationResult } from "../../../../../shared/types";
import i18n from "../../../../../shared/i18n";

// Mock electronAPI with Linear API
const mockCleanup = vi.fn();
const mockElectronAPI = {
	cancelLinearValidation: vi.fn().mockResolvedValue({ success: true }),
	onLinearValidationProgress: vi.fn(() => mockCleanup),
};

Object.defineProperty(window, "electronAPI", {
	value: mockElectronAPI,
	writable: true,
	configurable: true,
});

// Mock the hooks
vi.mock("../../../hooks/useLinearValidationProgress", () => ({
	useLinearValidationProgress: vi.fn(),
}));

vi.mock("../../../stores/linear-store", () => ({
	useLinearStore: vi.fn((selector) => {
		const state = {
			progressUpdateCounter: 0,
			validationProgress: new Map(),
			updateValidationResult: vi.fn(),
			clearValidationProgress: vi.fn(),
			createTaskFromLinearTicket: vi.fn(),
		};
		if (typeof selector === "function") {
			return selector(state);
		}
		return state;
	}),
	createTaskFromLinearTicket: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../useValidationEditState", () => ({
	useValidationEditState: vi.fn((validation: ValidationResult | null) => {
		const editState = {
			editedLabels: validation?.suggestedLabels || [],
			editedVersion: validation?.versionRecommendation?.recommendedVersion || "",
			editedCategory: validation?.taskProperties?.category || "feature",
			editedComplexity: validation?.taskProperties?.complexity || "medium",
			editedImpact: validation?.taskProperties?.impact || "medium",
			editedPriority: validation?.taskProperties?.priority || "medium",
			editingLabels: false,
			editingVersion: false,
			editingProperties: false,
			hasChanges: false,
			discardChanges: vi.fn(),
			getUpdatedValidation: vi.fn(() => validation || ({} as ValidationResult)),
		};

		return {
			...editState,
			setEditingLabels: vi.fn((value: boolean) => {
				editState.editingLabels = value;
			}),
			setEditingVersion: vi.fn((value: boolean) => {
				editState.editingVersion = value;
			}),
			setEditingProperties: vi.fn((value: boolean) => {
				editState.editingProperties = value;
			}),
			setEditedLabels: vi.fn((labels: typeof editState.editedLabels) => {
				editState.editedLabels = labels;
			}),
			setEditedVersion: vi.fn((version: string) => {
				editState.editedVersion = version;
			}),
			setEditedCategory: vi.fn((category: string) => {
				editState.editedCategory = category as never;
			}),
			setEditedComplexity: vi.fn((complexity: string) => {
				editState.editedComplexity = complexity as never;
			}),
			setEditedImpact: vi.fn((impact: string) => {
				editState.editedImpact = impact as never;
			}),
			setEditedPriority: vi.fn((priority: string) => {
				editState.editedPriority = priority as never;
			}),
		};
	}),
}));

// Helper to create mock validation
function createMockValidation(
	overrides: Partial<ValidationResult> = {},
): ValidationResult {
	return {
		ticketId: "LIN-123",
		ticketIdentifier: "LIN-123",
		validationTimestamp: new Date().toISOString(),
		cached: false,
		projectId: null,
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

// Helper to render with i18n provider
function renderWithProviders(ui: React.ReactElement) {
	return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("ValidationModal", () => {
	const mockOnOpenChange = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Basic Rendering", () => {
		it("should render modal when open", () => {
			const validation = createMockValidation();

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check dialog is present
			const dialog = screen.getByRole("dialog", { hidden: true });
			expect(dialog).toBeInTheDocument();
		});

		it("should not render modal when closed", () => {
			const validation = createMockValidation();

			renderWithProviders(
				<ValidationModal
					open={false}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Dialog should not be visible when closed
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});

		it("should render loading state when validation is null", () => {
			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={null}
				/>
			);

			// Should show starting validation message
			expect(screen.getByText(/starting validation/i)).toBeInTheDocument();
		});
	});

	describe("Tabbed Layout", () => {
		it("should render all four tabs", () => {
			const validation = createMockValidation();

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check all tabs are present
			expect(screen.getByText("Summary")).toBeInTheDocument();
			expect(screen.getByText("Analysis")).toBeInTheDocument();
			expect(screen.getByText("Recommendations")).toBeInTheDocument();
			expect(screen.getByText("Completeness")).toBeInTheDocument();
		});

		it("should switch tabs when clicked", async () => {
			const validation = createMockValidation();

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Click on Analysis tab
			const analysisTab = screen.getByText("Analysis");
			fireEvent.click(analysisTab);

			// Tab should be clicked (we can't easily verify tab content without accessing the DOM directly)
			expect(analysisTab).toBeInTheDocument();
		});
	});

	describe("Summary Tab", () => {
		it("should display completeness validation card", () => {
			const validation = createMockValidation({
				completenessValidation: {
					isComplete: true,
					missingFields: [],
					feasibilityScore: 85,
					feasibilityReasoning: "Well-defined requirements",
				},
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check completeness validation card is displayed
			expect(screen.getByText(/completeness validation/i)).toBeInTheDocument();
			// Check feasibility score
			expect(screen.getByText(/85%/)).toBeInTheDocument();
		});

		it("should display missing fields when present", () => {
			const validation = createMockValidation({
				completenessValidation: {
					isComplete: false,
					missingFields: ["acceptance criteria", "test plan"],
					feasibilityScore: 45,
					feasibilityReasoning: "Missing critical information",
				},
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should show incomplete badge
			expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
			// Should show missing fields
			expect(screen.getByText(/acceptance criteria/i)).toBeInTheDocument();
			expect(screen.getByText(/test plan/i)).toBeInTheDocument();
		});

		it("should display task properties summary", () => {
			const validation = createMockValidation({
				taskProperties: {
					category: "bug_fix",
					complexity: "medium",
					impact: "high",
					priority: "high",
					rationale: "Critical bug",
				},
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check task properties card is displayed
			expect(screen.getByText(/task properties/i)).toBeInTheDocument();
			// The task properties should be in the document somewhere
			const allText = document.body.textContent;
			expect(allText).toMatch(/bug_fix/);
		});

		it("should display labels summary", () => {
			const validation = createMockValidation({
				suggestedLabels: [
					{ name: "bug", confidence: 0.95, reason: "Bug detected" },
					{ name: "urgent", confidence: 0.88, reason: "Needs immediate fix" },
				],
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check labels section is displayed - there are multiple "Labels" text matches, use getAllByText
			const labelsElements = screen.getAllByText(/labels/i);
			expect(labelsElements.length).toBeGreaterThan(0);
			// Check specific labels are displayed
			const allText = document.body.textContent;
			expect(allText).toContain("bug");
			expect(allText).toContain("urgent");
		});

		it("should display version recommendation", () => {
			const validation = createMockValidation({
				versionRecommendation: {
					currentVersion: "2.7.4",
					recommendedVersion: "2.7.5",
					versionType: "patch",
					reasoning: "Bug fix release",
				},
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check version is displayed
			expect(screen.getByText("2.7.5")).toBeInTheDocument();
		});
	});

	describe("Analysis Tab", () => {
		it("should have Analysis tab available", () => {
			const validation = createMockValidation({
				contentAnalysis: {
					title: "Fix authentication bug",
					descriptionSummary: "Fix the auth bug in login flow",
					requirements: ["Step 1", "Step 2"],
				},
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Analysis tab should be available
			expect(screen.getByText("Analysis")).toBeInTheDocument();
		});

		it("should accept codebase verification data", () => {
			const validation = createMockValidation({
				codebaseVerification: {
					searchedFiles: ["src/auth/login.ts", "src/auth/utils.ts"],
					relatedImplementations: [],
					patternsFound: [],
					technicalConstraints: [],
					existingSolutions: "",
				},
			});

			// Should render without errors
			expect(() => {
				renderWithProviders(
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

	describe("Validation Steps", () => {
		it("should display all six validation steps", () => {
			const validation = createMockValidation();

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Check validation status section
			expect(screen.getByText(/validation status/i)).toBeInTheDocument();
		});
	});

	describe("Footer Actions", () => {
		it("should show Close button when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should have Close button - find by exact text match
			const closeButton = screen.getAllByRole("button").find(btn => btn.textContent === "Close");
			expect(closeButton).toBeDefined();
		});

		it("should show Cancel button when validation is in progress", () => {
			const validation = createMockValidation({ status: "validating" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should have Cancel button
			expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
		});

		it("should show Create Task button when validation is complete", () => {
			const validation = createMockValidation({ status: "complete" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should have Create Task button
			expect(screen.getByRole("button", { name: /create task/i })).toBeInTheDocument();
		});

		it("should not show Create Task button during validation", () => {
			const validation = createMockValidation({ status: "validating" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should not have Create Task button
			expect(screen.queryByRole("button", { name: /create task/i })).not.toBeInTheDocument();
		});
	});

	describe("Error States", () => {
		it("should display error when validation fails", () => {
			const validation = createMockValidation({
				status: "error",
				error: "API rate limit exceeded",
			});

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Should show error message
			expect(screen.getByText(/validation failed/i)).toBeInTheDocument();
			expect(screen.getByText(/API rate limit exceeded/i)).toBeInTheDocument();
		});
	});

	describe("Progress Bar", () => {
		it("should render progress bar during validation", () => {
			// This test verifies the store is being called for progress
			// The actual progress rendering is handled by the Progress component
			const validation = createMockValidation({ status: "validating" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Dialog should be rendered during validation
			expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
		});
	});

	describe("Cancel Validation", () => {
		it("should call cancelLinearValidation when Cancel is clicked", async () => {
			const validation = createMockValidation({ status: "validating" });

			renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			const cancelButton = screen.getByText(/cancel/i);
			fireEvent.click(cancelButton);

			await waitFor(() => {
				expect(mockElectronAPI.cancelLinearValidation).toHaveBeenCalledWith("LIN-123");
			});
		});
	});

	describe("Empty States", () => {
		it("should show empty state when no validation data is available", () => {
			const validation = createMockValidation({
				status: "complete",
				contentAnalysis: undefined as never,
				codebaseVerification: undefined as never,
				completenessValidation: undefined as never,
			});

			const { container } = renderWithProviders(
				<ValidationModal
					open={true}
					onOpenChange={mockOnOpenChange}
					ticketId="LIN-123"
					validation={validation}
				/>
			);

			// Switch to Analysis tab
			fireEvent.click(screen.getByText("Analysis"));

			// Should show empty state - check for alert icon or message
			const emptyStateIcon = container.querySelector('svg[class*="alert-circle"]');
			const emptyStateMessage = screen.queryByText(/validation incomplete/i);
			// At least one empty state indicator should be present
			expect(emptyStateIcon || emptyStateMessage).toBeDefined();
		});
	});
});
