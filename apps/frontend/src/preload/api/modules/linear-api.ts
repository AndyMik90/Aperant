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
	/** Current tool being executed (e.g., "Grep", "Read", "Glob") */
	currentTool?: string;
	/** Status of the current tool (e.g., "running", "complete") */
	toolStatus?: 'running' | 'complete' | 'error';
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
	cancelLinearValidation: (
		ticketId: string,
	) => Promise<IPCResult<void>>;
	updateLinearTicketWithValidation: (
		projectId: string,
		ticketId: string,
		validation: ValidationResult,
	) => Promise<IPCResult<any>>;
	clearLinearCache: () => Promise<IPCResult<void>>;
	postLinearComment: (
		projectId: string | null,
		ticketId: string,
		comment: string,
		parentId?: string | null,
	) => Promise<IPCResult<void>>;
	getLinearComments: (
		projectId: string | null,
		ticketId: string,
	) => Promise<IPCResult<Array<{ id: string; body: string; parentId: string | null; user: { name: string } }>>>;
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

	cancelLinearValidation: (ticketId: string): Promise<IPCResult<void>> =>
		invokeIpc(IPC_CHANNELS.LINEAR_CANCEL_VALIDATION, ticketId),

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

	postLinearComment: (
		projectId: string | null,
		ticketId: string,
		comment: string,
		parentId?: string | null,
	): Promise<IPCResult<void>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_POST_COMMENT,
			projectId,
			ticketId,
			comment,
			parentId,
		),

	getLinearComments: (
		projectId: string | null,
		ticketId: string,
	): Promise<IPCResult<Array<{ id: string; body: string; parentId: string | null; user: { name: string } }>>> =>
		invokeIpc(
			IPC_CHANNELS.LINEAR_GET_COMMENTS,
			projectId ?? null,
			ticketId,
		),
});
