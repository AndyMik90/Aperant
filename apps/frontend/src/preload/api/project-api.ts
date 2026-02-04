import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  Project,
  ProjectSettings,
  IPCResult,
  InitializationResult,
  AutoBuildVersionInfo,
  ProjectEnvConfig,
  ClaudeAuthResult,
  InfrastructureStatus,
  GraphitiValidationResult,
  GraphitiConnectionTestResult,
  GitStatus,
  KanbanPreferences,
  GitBranchDetail
} from '../../shared/types';

// Tab state interface (persisted in main process)
export interface TabState {
  openProjectIds: string[];
  activeProjectId: string | null;
  tabOrder: string[];
}

export interface ProjectAPI {
  // Project Management
  addProject: (projectPath: string) => Promise<IPCResult<Project>>;
  removeProject: (projectId: string) => Promise<IPCResult>;
  getProjects: () => Promise<IPCResult<Project[]>>;
  updateProjectSettings: (
    projectId: string,
    settings: Partial<ProjectSettings>
  ) => Promise<IPCResult>;
  initializeProject: (projectId: string) => Promise<IPCResult<InitializationResult>>;
  checkProjectVersion: (projectId: string) => Promise<IPCResult<AutoBuildVersionInfo>>;

  // Tab State (persisted in main process for reliability)
  getTabState: () => Promise<IPCResult<TabState>>;
  saveTabState: (tabState: TabState) => Promise<IPCResult>;

  // Kanban Preferences (persisted in main process per project)
  getKanbanPreferences: (projectId: string) => Promise<IPCResult<KanbanPreferences | null>>;
  saveKanbanPreferences: (projectId: string, preferences: KanbanPreferences) => Promise<IPCResult>;

  // Context Operations
  getProjectContext: (projectId: string) => Promise<IPCResult<unknown>>;
  refreshProjectIndex: (projectId: string) => Promise<IPCResult<unknown>>;
  getMemoryStatus: (projectId: string) => Promise<IPCResult<unknown>>;
  searchMemories: (projectId: string, query: string) => Promise<IPCResult<unknown>>;
  getRecentMemories: (projectId: string, limit?: number) => Promise<IPCResult<unknown>>;

  // Environment Configuration
  getProjectEnv: (projectId: string) => Promise<IPCResult<ProjectEnvConfig>>;
  updateProjectEnv: (projectId: string, config: Partial<ProjectEnvConfig>) => Promise<IPCResult>;
  checkClaudeAuth: (projectId: string) => Promise<IPCResult<ClaudeAuthResult>>;
  invokeClaudeSetup: (projectId: string) => Promise<IPCResult<ClaudeAuthResult>>;

  // Dialog Operations
  selectDirectory: () => Promise<string | null>;
  createProjectFolder: (
    location: string,
    name: string,
    initGit: boolean
  ) => Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>>;
  getDefaultProjectLocation: () => Promise<string | null>;

  // Memory Infrastructure Operations (LadybugDB - no Docker required)
  getMemoryInfrastructureStatus: (dbPath?: string) => Promise<IPCResult<InfrastructureStatus>>;
  listMemoryDatabases: (dbPath?: string) => Promise<IPCResult<string[]>>;
  testMemoryConnection: (dbPath?: string, database?: string) => Promise<IPCResult<GraphitiValidationResult>>;

  // Graphiti Validation Operations
  validateLLMApiKey: (provider: string, apiKey: string) => Promise<IPCResult<GraphitiValidationResult>>;
   testGraphitiConnection: (config: {
     dbPath?: string;
     database?: string;
     llmProvider: string;
     apiKey: string;
   }) => Promise<IPCResult<GraphitiConnectionTestResult>>;

   // Ollama Model Management
   scanOllamaModels: (baseUrl: string) => Promise<IPCResult<{
     models: Array<{
       name: string;
       size: number;
       modified_at: string;
       digest: string;
     }>;
   }>>;
   downloadOllamaModel: (baseUrl: string, modelName: string) => Promise<IPCResult<{ message: string }>>;
   onDownloadProgress: (callback: (data: {
     modelName: string;
     status: string;
     completed: number;
     total: number;
     percentage: number;
   }) => void) => () => void;

   // Git Operations
  /** @deprecated Use getGitBranchesWithInfo for structured branch data with type indicators */
  getGitBranches: (projectPath: string) => Promise<IPCResult<string[]>>;
  /** Get branches with structured type information (local vs remote) */
  getGitBranchesWithInfo: (projectPath: string) => Promise<IPCResult<GitBranchDetail[]>>;
  getCurrentGitBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  detectMainBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  checkGitStatus: (projectPath: string) => Promise<IPCResult<GitStatus>>;
  initializeGit: (projectPath: string) => Promise<IPCResult<InitializationResult>>;

  // Ollama Model Detection
  checkOllamaStatus: (baseUrl?: string) => Promise<IPCResult<{
    running: boolean;
    url: string;
    version?: string;
    message?: string;
  }>>;
  checkOllamaInstalled: () => Promise<IPCResult<{
    installed: boolean;
    path?: string;
    version?: string;
  }>>;
  installOllama: () => Promise<IPCResult<{ command: string }>>;
  listOllamaModels: (baseUrl?: string) => Promise<IPCResult<{
    models: Array<{
      name: string;
      size_bytes: number;
      size_gb: number;
      modified_at: string;
      is_embedding: boolean;
      embedding_dim?: number | null;
      description?: string;
    }>;
    count: number;
  }>>;
  listOllamaEmbeddingModels: (baseUrl?: string) => Promise<IPCResult<{
    embedding_models: Array<{
      name: string;
      embedding_dim: number | null;
      description: string;
      size_bytes: number;
      size_gb: number;
    }>;
    count: number;
  }>>;
  pullOllamaModel: (modelName: string, baseUrl?: string) => Promise<IPCResult<{
    model: string;
    status: 'completed' | 'failed';
    output: string[];
  }>>;
}

export const createProjectAPI = (): ProjectAPI => ({
  // Project Management
  addProject: (projectPath: string): Promise<IPCResult<Project>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_ADD, projectPath),

  removeProject: (projectId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMOVE, projectId),

  getProjects: (): Promise<IPCResult<Project[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),

  updateProjectSettings: (
    projectId: string,
    settings: Partial<ProjectSettings>
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_UPDATE_SETTINGS, projectId, settings),

  initializeProject: (projectId: string): Promise<IPCResult<InitializationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_INITIALIZE, projectId),

  checkProjectVersion: (projectId: string): Promise<IPCResult<AutoBuildVersionInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CHECK_VERSION, projectId),

  // Tab State (persisted in main process for reliability)
  getTabState: (): Promise<IPCResult<TabState>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_STATE_GET),

  saveTabState: (tabState: TabState): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_STATE_SAVE, tabState),

  // Kanban Preferences (persisted in main process per project)
  getKanbanPreferences: (projectId: string): Promise<IPCResult<KanbanPreferences | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.KANBAN_PREFS_GET, projectId),

  saveKanbanPreferences: (projectId: string, preferences: KanbanPreferences): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.KANBAN_PREFS_SAVE, projectId, preferences),

  // Context Operations
  getProjectContext: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_GET, projectId),

  refreshProjectIndex: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_REFRESH_INDEX, projectId),

  getMemoryStatus: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_STATUS, projectId),

  searchMemories: (projectId: string, query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_SEARCH_MEMORIES, projectId, query),

  getRecentMemories: (projectId: string, limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_GET_MEMORIES, projectId, limit),

  // Environment Configuration
  getProjectEnv: (projectId: string): Promise<IPCResult<ProjectEnvConfig>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_GET, projectId),

  updateProjectEnv: (projectId: string, config: Partial<ProjectEnvConfig>): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_UPDATE, projectId, config),

  checkClaudeAuth: (projectId: string): Promise<IPCResult<ClaudeAuthResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_CHECK_CLAUDE_AUTH, projectId),

  invokeClaudeSetup: (projectId: string): Promise<IPCResult<ClaudeAuthResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_INVOKE_CLAUDE_SETUP, projectId),

  // Dialog Operations
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY),

  createProjectFolder: (
    location: string,
    name: string,
    initGit: boolean
  ): Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_CREATE_PROJECT_FOLDER, location, name, initGit),

  getDefaultProjectLocation: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_GET_DEFAULT_PROJECT_LOCATION),

  // Memory Infrastructure Operations (LadybugDB - no Docker required)
  getMemoryInfrastructureStatus: (dbPath?: string): Promise<IPCResult<InfrastructureStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_STATUS, dbPath),

  listMemoryDatabases: (dbPath?: string): Promise<IPCResult<string[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_LIST_DATABASES, dbPath),

  testMemoryConnection: (dbPath?: string, database?: string): Promise<IPCResult<GraphitiValidationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_TEST_CONNECTION, dbPath, database),

  // Graphiti Validation Operations
  validateLLMApiKey: (provider: string, apiKey: string): Promise<IPCResult<GraphitiValidationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GRAPHITI_VALIDATE_LLM, provider, apiKey),

  testGraphitiConnection: (config: {
    dbPath?: string;
    database?: string;
    llmProvider: string;
    apiKey: string;
  }): Promise<IPCResult<GraphitiConnectionTestResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GRAPHITI_TEST_CONNECTION, config),

  // Ollama Model Management
  scanOllamaModels: (baseUrl: string): Promise<IPCResult<{
    models: Array<{
      name: string;
      size: number;
      modified_at: string;
      digest: string;
    }>;
  }>> =>
    ipcRenderer.invoke('scan-ollama-models', baseUrl),

  downloadOllamaModel: (baseUrl: string, modelName: string): Promise<IPCResult<{ message: string }>> =>
    ipcRenderer.invoke('download-ollama-model', baseUrl, modelName),

  onDownloadProgress: (callback: (data: {
    modelName: string;
    status: string;
    completed: number;
    total: number;
    percentage: number;
  }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, listener);
  },

  // Git Operations
  getGitBranches: (projectPath: string): Promise<IPCResult<string[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES, projectPath),

  getGitBranchesWithInfo: (projectPath: string): Promise<IPCResult<GitBranchDetail[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES_WITH_INFO, projectPath),

  getCurrentGitBranch: (projectPath: string): Promise<IPCResult<string | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_CURRENT_BRANCH, projectPath),

  detectMainBranch: (projectPath: string): Promise<IPCResult<string | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH, projectPath),

  checkGitStatus: (projectPath: string): Promise<IPCResult<GitStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECK_STATUS, projectPath),

  initializeGit: (projectPath: string): Promise<IPCResult<InitializationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_INITIALIZE, projectPath),

  // Ollama Model Detection
  checkOllamaStatus: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CHECK_STATUS, baseUrl),

  checkOllamaInstalled: () =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CHECK_INSTALLED),

  installOllama: () =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_INSTALL),

  listOllamaModels: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_LIST_MODELS, baseUrl),

  listOllamaEmbeddingModels: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_LIST_EMBEDDING_MODELS, baseUrl),

  pullOllamaModel: (modelName: string, baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_PULL_MODEL, modelName, baseUrl)
});
