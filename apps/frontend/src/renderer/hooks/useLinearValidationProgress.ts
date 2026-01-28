import { useEffect } from "react";
import { IPC_CHANNELS } from "../../shared/constants";
import { useLinearStore } from "../stores/linear-store";
import { debugLog, debugWarn } from "@shared/utils/debug-logger";

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
		const electronAPI = (window as any).electronAPI;
		if (!electronAPI) {
			debugWarn("[useLinearValidationProgress] electronAPI not available");
			return;
		}

		// Check if the IPC channel methods are available
		if (!electronAPI.on || !electronAPI.removeListener) {
			debugWarn("[useLinearValidationProgress] IPC methods not available on electronAPI");
			return;
		}

		// Handler for progress events
		const handleProgress = (_event: unknown, data: {
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
					`[useLinearValidationProgress] Progress update for ${progressTicketId}:`,
					progress
				);
				updateValidationProgress(progressTicketId, progress);
			}
		};

		// Register listener
		electronAPI.on(IPC_CHANNELS.LINEAR_VALIDATE_PROGRESS, handleProgress);

		// Cleanup listener on unmount
		return () => {
			electronAPI.removeListener(
				IPC_CHANNELS.LINEAR_VALIDATE_PROGRESS,
				handleProgress
			);
		};
	}, [ticketId, updateValidationProgress]);
}
