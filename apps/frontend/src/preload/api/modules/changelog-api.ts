import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  ChangelogTask,
  TaskSpecContent,
  ChangelogGenerationRequest,
  ChangelogGenerationResult,
  ChangelogSaveRequest,
  ChangelogSaveResult,
  ChangelogGenerationProgress,
  ExistingChangelog,
  GitBranchInfo,
  GitTagInfo,
  GitCommit,
  GitHistoryOptions,
  BranchDiffOptions,
  Task,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Changelog API operations
 */
export interface ChangelogAPI {
  // Operations
  getChangelogDoneTasks: (projectId: string, tasks?: Task[]) => Promise<IPCResult<ChangelogTask[]>>;
  loadTaskSpecs: (projectId: string, taskIds: string[]) => Promise<IPCResult<TaskSpecContent[]>>;
  generateChangelog: (request: ChangelogGenerationRequest) => Promise<IPCResult<void>>;
  saveChangelog: (request: ChangelogSaveRequest) => Promise<IPCResult<ChangelogSaveResult>>;
  readExistingChangelog: (projectId: string) => Promise<IPCResult<ExistingChangelog>>;
  suggestChangelogVersion: (
    projectId: string,
    taskIds: string[]
  ) => Promise<IPCResult<{ version: string; reason: string }>>;
  suggestChangelogVersionFromCommits: (
    projectId: string,
    commits: GitCommit[]
  ) => Promise<IPCResult<{ version: string; reason: string }>>;
  getChangelogBranches: (projectId: string) => Promise<IPCResult<GitBranchInfo[]>>;
  getChangelogTags: (projectId: string) => Promise<IPCResult<GitTagInfo[]>>;
  getChangelogCommitsPreview: (
    projectId: string,
    options: GitHistoryOptions | BranchDiffOptions,
    mode: 'git-history' | 'branch-diff'
  ) => Promise<IPCResult<GitCommit[]>>;
  saveChangelogImage: (
    projectId: string,
    imageData: string,
    filename: string
  ) => Promise<IPCResult<{ relativePath: string; url: string }>>;
  readLocalImage: (
    projectPath: string,
    relativePath: string
  ) => Promise<IPCResult<string>>;

  // Event Listeners
  onChangelogGenerationProgress: (
    callback: (projectId: string, progress: ChangelogGenerationProgress) => void
  ) => IpcListenerCleanup;
  onChangelogGenerationComplete: (
    callback: (projectId: string, result: ChangelogGenerationResult) => void
  ) => IpcListenerCleanup;
  onChangelogGenerationError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Changelog API implementation
 */
export const createChangelogAPI = (): ChangelogAPI => ({
  // Operations
  getChangelogDoneTasks: (projectId: string, tasks?: Task[]): Promise<IPCResult<ChangelogTask[]>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_GET_DONE_TASKS, projectId, tasks),

  loadTaskSpecs: (projectId: string, taskIds: string[]): Promise<IPCResult<TaskSpecContent[]>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_LOAD_TASK_SPECS, projectId, taskIds),

  generateChangelog: (request: ChangelogGenerationRequest): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_GENERATE, request),

  saveChangelog: (request: ChangelogSaveRequest): Promise<IPCResult<ChangelogSaveResult>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_SAVE, request),

  readExistingChangelog: (projectId: string): Promise<IPCResult<ExistingChangelog>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_READ_EXISTING, projectId),

  suggestChangelogVersion: (
    projectId: string,
    taskIds: string[]
  ): Promise<IPCResult<{ version: string; reason: string }>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_SUGGEST_VERSION, projectId, taskIds),

  suggestChangelogVersionFromCommits: (
    projectId: string,
    commits: GitCommit[]
  ): Promise<IPCResult<{ version: string; reason: string }>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_SUGGEST_VERSION_FROM_COMMITS, projectId, commits),

  getChangelogBranches: (projectId: string): Promise<IPCResult<GitBranchInfo[]>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_GET_BRANCHES, projectId),

  getChangelogTags: (projectId: string): Promise<IPCResult<GitTagInfo[]>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_GET_TAGS, projectId),

  getChangelogCommitsPreview: (
    projectId: string,
    options: GitHistoryOptions | BranchDiffOptions,
    mode: 'git-history' | 'branch-diff'
  ): Promise<IPCResult<GitCommit[]>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_GET_COMMITS_PREVIEW, projectId, options, mode),

  saveChangelogImage: (
    projectId: string,
    imageData: string,
    filename: string
  ): Promise<IPCResult<{ relativePath: string; url: string }>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_SAVE_IMAGE, projectId, imageData, filename),

  readLocalImage: (
    projectPath: string,
    relativePath: string
  ): Promise<IPCResult<string>> =>
    invokeIpc(IPC_CHANNELS.CHANGELOG_READ_LOCAL_IMAGE, projectPath, relativePath),

  // Event Listeners
  onChangelogGenerationProgress: (
    callback: (projectId: string, progress: ChangelogGenerationProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.CHANGELOG_GENERATION_PROGRESS, callback),

  onChangelogGenerationComplete: (
    callback: (projectId: string, result: ChangelogGenerationResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.CHANGELOG_GENERATION_COMPLETE, callback),

  onChangelogGenerationError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.CHANGELOG_GENERATION_ERROR, callback)
});
