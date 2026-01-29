import { useEffect } from "react";
import { useLinearStore } from "@/stores/linear-store";
import { debugLog, debugWarn } from "@shared/utils/debug-logger";
import type { ElectronAPI } from "@shared/types";

/**
 * Hook to listen for Linear validation progress events from the main process.
 * Updates the linear store with progress information as validation proceeds.
 *
 * Progress events contain:
 * - phase: Current validation phase (e.g., "content_analysis", "completeness")
 * - step: Current step number (1-indexed)
 * - total: Total number of steps
 * - message: Human-readable progress message
 *
 * @param ticketId - The Linear ticket ID to listen for progress events (optional, listens to all if not provided)
 */
export function useLinearValidationProgress(ticketId?: string): void {
	const updateValidationProgress = useLinearStore(
		(state) => state.updateValidationProgress
	);

	useEffect(() => {
		// Get the electronAPI from window
		const electronAPI = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
		if (!electronAPI) {
			debugWarn("[useLinearValidationProgress] electronAPI not available");
			return;
		}

		// Check if the Linear API is available
		if (!electronAPI.linear) {
			debugWarn("[useLinearValidationProgress] Linear API not available on electronAPI");
			return;
		}

		// Check if the Linear API progress listener is available
		if (!electronAPI.linear.onLinearValidationProgress) {
			debugWarn("[useLinearValidationProgress] onLinearValidationProgress method not available on electronAPI.linear");
			return;
		}

		// Handler for progress events
		const handleProgress = (data: {
			ticketId: string;
			phase: string;
			step: number;
			total: number;
			message: string;
		}) => {
			const { ticketId: progressTicketId, ...progress } = data;

			// Only update if this is the ticket we're tracking, or if we're tracking all tickets
			if (!ticketId || progressTicketId === ticketId) {
				debugLog(
					`[useLinearValidationProgress] Progress update for ${progressTicketId}: phase=${progress.phase}, step=${progress.step}/${progress.total}, message="${progress.message}"`
				);
				updateValidationProgress(progressTicketId, progress);
			}
		};

		// Register listener - returns cleanup function
		const cleanup = electronAPI.linear.onLinearValidationProgress(handleProgress);

		// Cleanup listener on unmount
		return () => {
			cleanup?.();
		};
	}, [ticketId, updateValidationProgress]);
}
