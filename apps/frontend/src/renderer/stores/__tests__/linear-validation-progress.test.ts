/**
 * Tests for Linear validation progress functionality
 * Tests both store actions and progress event handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLinearStore } from "../linear-store";

// Define window globally for tests (node environment)
(global as any).window = (global as any).window || {};

// Mock electronAPI
const mockElectronAPI = {
	on: vi.fn(),
	removeListener: vi.fn(),
};

Object.defineProperty((global as any).window, "electronAPI", {
	value: mockElectronAPI,
	writable: true,
	configurable: true,
});

describe("Linear Validation Progress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset store state
		useLinearStore.getState().clearValidationResults();
		useLinearStore.getState().clearValidationProgress("LIN-123");
		useLinearStore.getState().clearValidationProgress("LIN-456");
		// Reset window.electronAPI mock
		(global as any).window.electronAPI = mockElectronAPI;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Store Progress Actions", () => {
		it("should add progress for ticket", () => {
			const progress = {
				phase: "content_analysis",
				step: 1,
				total: 7,
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
				total: 7,
				message: "Analyzing...",
			};

			const updatedProgress = {
				phase: "completeness",
				step: 2,
				total: 7,
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
				total: 7,
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

		it("should clear progress for specific ticket", () => {
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "content_analysis",
				step: 1,
				total: 7,
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

		it("should not affect progress for other tickets when clearing", () => {
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing...",
			});
			useLinearStore.getState().updateValidationProgress("LIN-456", {
				phase: "completeness",
				step: 2,
				total: 7,
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

		it("should return progress without timestamp from selector", () => {
			const progress = {
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing...",
			};

			useLinearStore.getState().updateValidationProgress("LIN-123", progress);

			const retrieved = useLinearStore.getState().getValidationProgress("LIN-123");

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

	describe("Progress Event Flow", () => {
		it("should simulate progress event handling", () => {
			// Simulate receiving a progress event from the main process
			const progressData = {
				ticketId: "LIN-123",
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing ticket content...",
			};

			// Simulate the handler receiving the event
			// (normally done by useLinearValidationProgress hook)
			const { ticketId, ...progress } = progressData;
			useLinearStore.getState().updateValidationProgress(ticketId, progress);

			// Verify the store was updated correctly
			const storedProgress = useLinearStore
				.getState()
				.getValidationProgress("LIN-123");
			expect(storedProgress).toEqual({
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing ticket content...",
			});
		});

		it("should handle multiple progress updates for same ticket", () => {
			const progressUpdates = [
				{ phase: "initialization", step: 0, total: 7, message: "Starting..." },
				{ phase: "content_analysis", step: 1, total: 7, message: "Analyzing..." },
				{ phase: "ai_analysis_start", step: 2, total: 7, message: "AI analysis..." },
				{ phase: "completeness_check", step: 3, total: 7, message: "Checking..." },
				{ phase: "labels_selection", step: 4, total: 7, message: "Selecting..." },
				{ phase: "version_calculation", step: 5, total: 7, message: "Calculating..." },
				{ phase: "properties_recommendation", step: 6, total: 7, message: "Recommending..." },
			];

			progressUpdates.forEach((update) => {
				useLinearStore.getState().updateValidationProgress("LIN-123", update);
			});

			// Should have the final progress state
			const finalProgress = useLinearStore
				.getState()
				.getValidationProgress("LIN-123");
			expect(finalProgress).toEqual({
				phase: "properties_recommendation",
				step: 6,
				total: 7,
				message: "Recommending...",
			});
		});

		it("should track progress for multiple tickets independently", () => {
			// Update progress for two different tickets
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing LIN-123...",
			});

			useLinearStore.getState().updateValidationProgress("LIN-456", {
				phase: "completeness",
				step: 2,
				total: 7,
				message: "Checking LIN-456...",
			});

			// Both should be tracked independently
			const progress123 = useLinearStore.getState().getValidationProgress("LIN-123");
			const progress456 = useLinearStore.getState().getValidationProgress("LIN-456");

			expect(progress123?.phase).toBe("content_analysis");
			expect(progress456?.phase).toBe("completeness");
		});
	});

	describe("Cancelled Status", () => {
		it("should update validation result to cancelled status", () => {
			const initialResult = {
				ticketId: "LIN-123",
				ticketIdentifier: "LIN-123",
				validationTimestamp: new Date().toISOString(),
				cached: false,
				status: "validating" as const,
				contentAnalysis: {
					title: "Test",
					descriptionSummary: "Test",
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
					recommendedVersion: "1.0.0",
					versionType: "patch" as const,
					reasoning: "",
				},
				taskProperties: {
					category: "feature" as const,
					complexity: "medium" as const,
					impact: "medium" as const,
					priority: "medium" as const,
					rationale: "",
				},
			};

			useLinearStore.getState().updateValidationResult("LIN-123", initialResult);

			// Get current result and update it (following the pattern used in the store)
			const currentResult = useLinearStore.getState().getValidationResult("LIN-123");
			useLinearStore.getState().updateValidationResult("LIN-123", {
				...currentResult!,
				status: "cancelled" as const,
				error: "Validation was cancelled",
			});

			const result = useLinearStore.getState().getValidationResult("LIN-123");
			expect(result?.status).toBe("cancelled");
			expect(result?.error).toBe("Validation was cancelled");
		});

		it("should clear progress when validation is cancelled", () => {
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "ai_analysis_start",
				step: 2,
				total: 7,
				message: "AI analysis in progress...",
			});

			expect(
				useLinearStore.getState().getValidationProgress("LIN-123")
			).toBeDefined();

			// Simulate cancel - set validation result to cancelled
			const initialResult = {
				ticketId: "LIN-123",
				ticketIdentifier: "LIN-123",
				validationTimestamp: new Date().toISOString(),
				cached: false,
				status: "validating" as const,
				contentAnalysis: {
					title: "Test",
					descriptionSummary: "Test",
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
					recommendedVersion: "1.0.0",
					versionType: "patch" as const,
					reasoning: "",
				},
				taskProperties: {
					category: "feature" as const,
					complexity: "medium" as const,
					impact: "medium" as const,
					priority: "medium" as const,
					rationale: "",
				},
			};

			useLinearStore.getState().updateValidationResult("LIN-123", initialResult);
			const currentResult = useLinearStore.getState().getValidationResult("LIN-123");
			useLinearStore.getState().updateValidationResult("LIN-123", {
				...currentResult!,
				status: "cancelled" as const,
				error: "Validation was cancelled",
			});
			useLinearStore.getState().clearValidationProgress("LIN-123");

			expect(
				useLinearStore.getState().getValidationProgress("LIN-123")
			).toBeUndefined();
			const result = useLinearStore.getState().getValidationResult("LIN-123");
			expect(result?.status).toBe("cancelled");
		});
	});

	describe("Progress Phase Mapping", () => {
		it("should track all 7 validation phases", () => {
			const phases = [
				"initialization",
				"content_analysis",
				"ai_analysis_start",
				"completeness_check",
				"labels_selection",
				"version_calculation",
				"properties_recommendation",
				"ai_analysis_complete",
			];

			phases.forEach((phase, index) => {
				useLinearStore.getState().updateValidationProgress("LIN-123", {
					phase,
					step: index,
					total: 7,
					message: `Phase ${phase}`,
				});
			});

			// Should track the final phase
			const finalProgress = useLinearStore
				.getState()
				.getValidationProgress("LIN-123");
			expect(finalProgress?.phase).toBe("ai_analysis_complete");
		});

		it("should handle ai_analysis_complete phase (step 7/7)", () => {
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "ai_analysis_complete",
				step: 7,
				total: 7,
				message: "AI analysis complete, parsing results...",
			});

			const progress = useLinearStore.getState().getValidationProgress("LIN-123");
			expect(progress?.step).toBe(7);
			expect(progress?.total).toBe(7);
			expect(progress?.phase).toBe("ai_analysis_complete");
		});
	});
});
