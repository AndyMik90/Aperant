/**
 * Tests for Linear validation progress functionality
 * Tests both store actions and progress event handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLinearStore } from "../linear-store";
import { IPC_CHANNELS } from "../../../shared/constants";

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

		it("should not affect progress for other tickets when clearing", () => {
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

		it("should return progress without timestamp from selector", () => {
			const progress = {
				phase: "content_analysis",
				step: 1,
				total: 5,
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
				total: 5,
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
				total: 5,
				message: "Analyzing ticket content...",
			});
		});

		it("should handle multiple progress updates for same ticket", () => {
			const progressUpdates = [
				{ phase: "initialization", step: 0, total: 5, message: "Starting..." },
				{ phase: "content_analysis", step: 1, total: 5, message: "Analyzing..." },
				{ phase: "completeness", step: 2, total: 5, message: "Checking..." },
				{ phase: "labels", step: 3, total: 5, message: "Suggesting..." },
				{ phase: "version", step: 4, total: 5, message: "Determining..." },
				{ phase: "properties", step: 5, total: 5, message: "Recommending..." },
			];

			progressUpdates.forEach((update) => {
				useLinearStore.getState().updateValidationProgress("LIN-123", update);
			});

			// Should have the final progress state
			const finalProgress = useLinearStore
				.getState()
				.getValidationProgress("LIN-123");
			expect(finalProgress).toEqual({
				phase: "properties",
				step: 5,
				total: 5,
				message: "Recommending...",
			});
		});

		it("should track progress for multiple tickets independently", () => {
			// Update progress for two different tickets
			useLinearStore.getState().updateValidationProgress("LIN-123", {
				phase: "content_analysis",
				step: 1,
				total: 5,
				message: "Analyzing LIN-123...",
			});

			useLinearStore.getState().updateValidationProgress("LIN-456", {
				phase: "completeness",
				step: 2,
				total: 5,
				message: "Checking LIN-456...",
			});

			// Both should be tracked independently
			const progress123 = useLinearStore.getState().getValidationProgress("LIN-123");
			const progress456 = useLinearStore.getState().getValidationProgress("LIN-456");

			expect(progress123?.phase).toBe("content_analysis");
			expect(progress456?.phase).toBe("completeness");
		});
	});
});
