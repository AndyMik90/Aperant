/**
 * Tests for useLinearValidationProgress hook
 * Tests that the hook correctly listens to Linear validation progress events
 *
 * @vitest-environment jsdom
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLinearValidationProgress } from "../useLinearValidationProgress";
import type { ElectronAPI } from "../../../shared/types";

// Mock the linear-store - must be inline for vi.mock hoisting
const mockUpdateValidationProgress = vi.fn();
vi.mock("../../stores/linear-store", () => ({
	useLinearStore: vi.fn((selector) => {
		const state = {
			updateValidationProgress: mockUpdateValidationProgress,
			getValidationProgress: vi.fn(() => undefined),
			progressUpdateCounter: 0,
			clearValidationProgress: vi.fn(),
			updateValidationResult: vi.fn(),
			setError: vi.fn(),
		};
		return selector(state);
	}),
}));

describe("useLinearValidationProgress", () => {
	let mockCleanup: () => void;
	const mockOnLinearValidationProgress = vi.fn((callback) => {
		mockCleanup = vi.fn();
		return mockCleanup;
	});

	beforeEach(() => {
		vi.clearAllMocks();

		// Setup mock electronAPI with Linear API at top level
		const mockElectronAPI: Partial<ElectronAPI> = {
			onLinearValidationProgress: mockOnLinearValidationProgress,
		};

		Object.defineProperty(window, "electronAPI", {
			value: mockElectronAPI,
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		if (mockCleanup) {
			mockCleanup();
		}
	});

	describe("Hook Registration", () => {
		it("should register progress listener on mount", () => {
			renderHook(() => useLinearValidationProgress("LIN-123"));

			expect(mockOnLinearValidationProgress).toHaveBeenCalledWith(
				expect.any(Function)
			);
		});

		it("should pass ticketId to listener for filtering", () => {
			renderHook(() => useLinearValidationProgress("LIN-456"));

			expect(mockOnLinearValidationProgress).toHaveBeenCalledWith(
				expect.any(Function)
			);
		});

		it("should listen to all tickets when no ticketId provided", () => {
			renderHook(() => useLinearValidationProgress());

			expect(mockOnLinearValidationProgress).toHaveBeenCalledWith(
				expect.any(Function)
			);
		});
	});

	describe("Progress Event Handling", () => {
		it("should update store when progress event received", () => {
			renderHook(() => useLinearValidationProgress("LIN-123"));

			// Get the callback that was registered
			const callback = mockOnLinearValidationProgress.mock.calls[0][0];

			// Simulate receiving a progress event
			act(() => {
				callback({
					ticketId: "LIN-123",
					phase: "content_analysis",
					step: 1,
					total: 7,
					message: "Analyzing content...",
				});
			});

			// Verify the store was updated
			expect(mockUpdateValidationProgress).toHaveBeenCalledWith("LIN-123", {
				phase: "content_analysis",
				step: 1,
				total: 7,
				message: "Analyzing content...",
			});
		});

		it("should filter events by ticketId when provided", () => {
			renderHook(() => useLinearValidationProgress("LIN-123"));

			const callback = mockOnLinearValidationProgress.mock.calls[0][0];

			// Send event for different ticket
			act(() => {
				callback({
					ticketId: "LIN-456",
					phase: "content_analysis",
					step: 1,
					total: 7,
					message: "Analyzing...",
				});
			});

			// Should not update store for different ticket
			expect(mockUpdateValidationProgress).not.toHaveBeenCalled();
		});

		it("should accept events for all tickets when no ticketId specified", () => {
			renderHook(() => useLinearValidationProgress());

			const callback = mockOnLinearValidationProgress.mock.calls[0][0];

			// Send events for different tickets
			act(() => {
				callback({
					ticketId: "LIN-123",
					phase: "content_analysis",
					step: 1,
					total: 7,
					message: "Analyzing LIN-123...",
				});
				callback({
					ticketId: "LIN-456",
					phase: "completeness",
					step: 2,
					total: 7,
					message: "Checking LIN-456...",
				});
			});

			// Should update store for both tickets
			expect(mockUpdateValidationProgress).toHaveBeenCalledWith("LIN-123", expect.any(Object));
			expect(mockUpdateValidationProgress).toHaveBeenCalledWith("LIN-456", expect.any(Object));
		});
	});

	describe("Cleanup", () => {
		it("should cleanup listener on unmount", () => {
			const { unmount } = renderHook(() =>
				useLinearValidationProgress("LIN-123")
			);

			unmount();

			expect(mockCleanup).toHaveBeenCalled();
		});

		it("should return cleanup function from onLinearValidationProgress", () => {
			let cleanupReturned: (() => void) | undefined;

			mockOnLinearValidationProgress.mockImplementation(() => {
				cleanupReturned = vi.fn();
				return cleanupReturned;
			});

			const { unmount } = renderHook(() =>
				useLinearValidationProgress("LIN-123")
			);

			unmount();

			expect(cleanupReturned).toHaveBeenCalled();
		});
	});

	describe("Re-render Behavior", () => {
		it("should re-register listener when ticketId changes", () => {
			const { rerender } = renderHook(
				({ ticketId }) => useLinearValidationProgress(ticketId),
				{ initialProps: { ticketId: "LIN-123" } }
			);

			expect(mockOnLinearValidationProgress).toHaveBeenCalledTimes(1);

			act(() => {
				rerender({ ticketId: "LIN-456" });
			});

			expect(mockOnLinearValidationProgress).toHaveBeenCalledTimes(2);
		});

		it("should cleanup previous listener when ticketId changes", () => {
			let firstCleanup: (() => void) | undefined;
			let secondCleanup: (() => void) | undefined;

			mockOnLinearValidationProgress.mockImplementation(() => {
				const cleanup = vi.fn();
				if (!firstCleanup) {
					firstCleanup = cleanup;
				} else {
					secondCleanup = cleanup;
				}
				return cleanup;
			});

			const { rerender } = renderHook(
				({ ticketId }) => useLinearValidationProgress(ticketId),
				{ initialProps: { ticketId: "LIN-123" } }
			);

			act(() => {
				rerender({ ticketId: "LIN-456" });
			});

			expect(firstCleanup).toHaveBeenCalled();
			expect(secondCleanup).toBeDefined();
		});
	});
});
