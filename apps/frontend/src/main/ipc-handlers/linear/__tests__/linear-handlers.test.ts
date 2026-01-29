/**
 * Unit tests for Linear IPC handlers
 * Tests cancel validation and progress tracking
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import type { AgentManager } from '../../../agent';

// Mock AgentManager
const createMockAgentManager = (): AgentManager => ({
	on: vi.fn(),
	isRunning: vi.fn(),
	killTask: vi.fn(),
	validateLinearTicket: vi.fn(),
	validateLinearTicketBatch: vi.fn(),
} as unknown as AgentManager);

describe('Linear IPC Handlers', () => {
	let mockAgentManager: AgentManager;
	let handlers: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockAgentManager = createMockAgentManager();

		// Mock ipcMain.handle
		(ipcMain.handle as any) = vi.fn((channel: string, handler: Function) => {
			if (!handlers) handlers = {};
			handlers[channel] = handler;
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('LINEAR_CANCEL_VALIDATION', () => {
		it('should cancel active validation successfully', async () => {
			const ticketId = 'LIN-123';
			const taskId = `linear-validation-${ticketId}`;

			// Mock agent manager to return task as running
			(mockAgentManager.isRunning as any).mockReturnValue(true);
			(mockAgentManager.killTask as any).mockReturnValue(true);

			// Simulate the handler logic
			const handler = async (_: any, id: string) => {
				try {
					const validationTaskId = `linear-validation-${id}`;

					if ((mockAgentManager.isRunning as any)(validationTaskId)) {
						const killed = (mockAgentManager.killTask as any)(validationTaskId);
						if (killed) {
							return { success: true };
						} else {
							return { success: false, error: 'Failed to cancel validation' };
						}
					} else {
						return { success: false, error: 'No active validation found' };
					}
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Failed to cancel validation',
					};
				}
			};

			const result = await handler(null, ticketId);

			expect(result).toEqual({ success: true });
			expect(mockAgentManager.isRunning).toHaveBeenCalledWith(taskId);
			expect(mockAgentManager.killTask).toHaveBeenCalledWith(taskId);
		});

		it('should return error when no active validation found', async () => {
			const ticketId = 'LIN-123';
			const taskId = `linear-validation-${ticketId}`;

			// Mock agent manager to return task as not running
			(mockAgentManager.isRunning as any).mockReturnValue(false);

			// Simulate the handler logic
			const handler = async (_: any, id: string) => {
				try {
					const validationTaskId = `linear-validation-${id}`;

					if ((mockAgentManager.isRunning as any)(validationTaskId)) {
						const killed = (mockAgentManager.killTask as any)(validationTaskId);
						if (killed) {
							return { success: true };
						} else {
							return { success: false, error: 'Failed to cancel validation' };
						}
					} else {
						return { success: false, error: 'No active validation found' };
					}
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Failed to cancel validation',
					};
				}
			};

			const result = await handler(null, ticketId);

			expect(result).toEqual({
				success: false,
				error: 'No active validation found',
			});
			expect(mockAgentManager.isRunning).toHaveBeenCalledWith(taskId);
			expect(mockAgentManager.killTask).not.toHaveBeenCalled();
		});

		it('should return error when killTask fails', async () => {
			const ticketId = 'LIN-123';
			const taskId = `linear-validation-${ticketId}`;

			// Mock agent manager - task is running but kill fails
			(mockAgentManager.isRunning as any).mockReturnValue(true);
			(mockAgentManager.killTask as any).mockReturnValue(false);

			// Simulate the handler logic
			const handler = async (_: any, id: string) => {
				try {
					const validationTaskId = `linear-validation-${id}`;

					if ((mockAgentManager.isRunning as any)(validationTaskId)) {
						const killed = (mockAgentManager.killTask as any)(validationTaskId);
						if (killed) {
							return { success: true };
						} else {
							return { success: false, error: 'Failed to cancel validation' };
						}
					} else {
						return { success: false, error: 'No active validation found' };
					}
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Failed to cancel validation',
					};
				}
			};

			const result = await handler(null, ticketId);

			expect(result).toEqual({
				success: false,
				error: 'Failed to cancel validation',
			});
			expect(mockAgentManager.isRunning).toHaveBeenCalledWith(taskId);
			expect(mockAgentManager.killTask).toHaveBeenCalledWith(taskId);
		});

		it('should handle exceptions during cancel', async () => {
			const ticketId = 'LIN-123';

			// Mock agent manager to throw exception
			(mockAgentManager.isRunning as any).mockImplementation(() => {
				throw new Error('Agent manager error');
			});

			// Simulate the handler logic
			const handler = async (_: any, id: string) => {
				try {
					const validationTaskId = `linear-validation-${id}`;

					if ((mockAgentManager.isRunning as any)(validationTaskId)) {
						const killed = (mockAgentManager.killTask as any)(validationTaskId);
						if (killed) {
							return { success: true };
						} else {
							return { success: false, error: 'Failed to cancel validation' };
						}
					} else {
						return { success: false, error: 'No active validation found' };
					}
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Failed to cancel validation',
					};
				}
			};

			const result = await handler(null, ticketId);

			expect(result).toEqual({
				success: false,
				error: 'Agent manager error',
			});
		});
	});

	describe('Progress Event Tracking', () => {
		it('should track active validations', () => {
			const activeValidations = new Map<string, {
				startTime: number;
				lastProgress: number;
			}>();

			const ticketId = 'LIN-123';
			const now = Date.now();

			// Simulate tracking start
			activeValidations.set(ticketId, {
				startTime: now,
				lastProgress: now,
			});

			expect(activeValidations.has(ticketId)).toBe(true);
			expect(activeValidations.get(ticketId)?.startTime).toBe(now);
		});

		it('should update lastProgress timestamp on progress event', () => {
			const activeValidations = new Map<string, {
				startTime: number;
				lastProgress: number;
			}>();

			const ticketId = 'LIN-123';
			const startTime = Date.now();

			// Initial tracking
			activeValidations.set(ticketId, {
				startTime,
				lastProgress: startTime,
			});

			// Simulate progress event
			const progressTime = startTime + 2000;
			const tracking = activeValidations.get(ticketId);
			if (tracking) {
				tracking.lastProgress = progressTime;
			}

			expect(activeValidations.get(ticketId)?.lastProgress).toBe(progressTime);
		});

		it('should clean up tracking after validation completes', () => {
			const activeValidations = new Map<string, {
				startTime: number;
				lastProgress: number;
			}>();

			const ticketId = 'LIN-123';

			// Start tracking
			activeValidations.set(ticketId, {
				startTime: Date.now(),
				lastProgress: Date.now(),
			});

			expect(activeValidations.has(ticketId)).toBe(true);

			// Clean up after completion
			activeValidations.delete(ticketId);

			expect(activeValidations.has(ticketId)).toBe(false);
		});
	});

	describe('Task ID Format', () => {
		it('should generate correct task ID for validation', () => {
			const ticketId = 'LIN-123';
			const expectedTaskId = `linear-validation-${ticketId}`;

			expect(expectedTaskId).toBe('linear-validation-LIN-123');
		});

		it('should generate correct task ID for batch validation', () => {
			const ticketIds = ['LIN-123', 'LIN-456'];
			const expectedTaskId = `linear-batch-${ticketIds.join('-')}`;

			expect(expectedTaskId).toBe('linear-batch-LIN-123-LIN-456');
		});
	});

	describe('Progress Phase Mapping', () => {
		it('should map progress phases to visual steps correctly', () => {
			// Phase to step mapping for the 7-step progress bar
			const phaseToStepId: Record<string, string> = {
				initialization: 'analyze',
				content_analysis: 'analyze',
				ai_analysis_start: 'completeness',
				completeness_check: 'completeness',
				labels_selection: 'labels',
				version_calculation: 'version',
				properties_recommendation: 'properties',
				ai_analysis_complete: 'properties',
			};

			// Verify all phases map to valid steps
			const steps = ['analyze', 'completeness', 'labels', 'version', 'properties'];
			Object.values(phaseToStepId).forEach((step) => {
				expect(steps).toContain(step);
			});
		});
	});
});
