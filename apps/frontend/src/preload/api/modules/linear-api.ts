import { IPC_CHANNELS } from "../../../shared/constants";
import type {
	IPCResult,
	LinearImportResult,
	LinearIssue,
	LinearProject,
	LinearSyncStatus,
	LinearTeam,
	ValidationResult,
} from "../../../shared/types";
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from "./ipc-utils";

/**
 * Validation progress event data
 */
export interface LinearValidationProgress {
	ticketId: string;
	phase: string;
	step: number;
	total: number;
	message: string;
}

/**
 * Linear Integration API operations
 */
export interface LinearAPI {
	/** Listen for validation progress events */
	onLinearValidationProgress: (
		callback: (progress: LinearValidationProgress) => void
	) => IpcListenerCleanup;

	getLinearTeams: (projectId: string) => Promise<IPCResult<LinearTeam[]>>;
	getLinearProjects: (
		projectId: string,
		teamId: string,
	) => Promise<IPCResult<LinearProject[]>>;
	getLinearIssues: (
		projectId: string,
		teamId?: string,
		linearProjectId?: string,
	) => Promise<IPCResult<LinearIssue[]>>;
	importLinearIssues: (
		projectId: string,
		issueIds: string[],
	) => Promise<IPCResult<LinearImportResult>>;
	checkLinearConnection: (
		projectId: string,
	) => Promise<IPCResult<LinearSyncStatus>>;
	validateLinearTicket: (
		projectId: string,
		ticketId: string,
		skipCache?: boolean,
	) => Promise<IPCResult<ValidationResult>>;
	validateLinearTicketBatch: (
		projectId: string,
		ticketIds: string[],
		skipCache?: boolean,
	) => Promise<IPCResult<any>>;
	updateLinearTicketWithValidation: (
		projectId: string,
		ticketId: string,
		validation: ValidationResult,
	) => Promise<IPCResult<any>>;
	clearLinearCache: () => Promise<IPCResult<void>>;
}

/**
 * Creates the Linear Integration API implementation
 */
export const createLinearAPI = (): LinearAPI => ({
	// Progress event listener
	onLinearValidationProgress: (
		callback: (progress: LinearValidationProgress) => void
	): IpcListenerCleanup =>
		createIpcListener(IPC_CHANNELS.LINEAR_VALIDATE_PROGRESS, callback),
	getLinearTeams: (projectId: string): Promise<IPCResult<LinearTeam[]>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_GET_TEAMS, projectId),

	getLinearProjects: (
		projectId: string,
		teamId: string,
	): Promise<IPCResult<LinearProject[]>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_GET_PROJECTS, projectId, teamId),

	getLinearIssues: (
		projectId: string,
		teamId?: string,
		linearProjectId?: string,
	): Promise<IPCResult<LinearIssue[]>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_GET_ISSUES,
			projectId,
			teamId,
			linearProjectId,
		),

	importLinearIssues: (
		projectId: string,
		issueIds: string[],
	): Promise<IPCResult<LinearImportResult>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_IMPORT_ISSUES, projectId, issueIds),

	checkLinearConnection: (
		projectId: string,
	): Promise<IPCResult<LinearSyncStatus>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_CHECK_CONNECTION, projectId),

	validateLinearTicket: (
		projectId: string,
		ticketId: string,
		skipCache = false,
	): Promise<IPCResult<ValidationResult>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_VALIDATE_TICKET,
			projectId,
			ticketId,
			skipCache,
		),

	validateLinearTicketBatch: (
		projectId: string,
		ticketIds: string[],
		skipCache = false,
	): Promise<IPCResult<any>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_VALIDATE_BATCH,
			projectId,
			ticketIds,
			skipCache,
		),

	updateLinearTicketWithValidation: (
		projectId: string,
		ticketId: string,
		validation: ValidationResult,
	): Promise<IPCResult<any>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_UPDATE_TICKET_WITH_VALIDATION,
			projectId,
			ticketId,
			validation,
		),

	clearLinearCache: (): Promise<IPCResult<void>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_CLEAR_CACHE),
});
