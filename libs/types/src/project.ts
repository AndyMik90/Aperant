/**
 * Project-related types
 */

export interface Project {
  id: string;
  name: string;
  path: string;
  autoBuildPath: string;
  settings: ProjectSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  model: string;
  memoryBackend: 'graphiti' | 'file';
  linearSync: boolean;
  linearTeamId?: string;
  notifications: NotificationSettings;
  /** Enable Graphiti MCP server for agent-accessible knowledge graph */
  graphitiMcpEnabled: boolean;
  /** Graphiti MCP server URL (default: http://localhost:8000/mcp/) */
  graphitiMcpUrl?: string;
  /** Main branch name for worktree creation (default: auto-detected or 'main') */
  mainBranch?: string;
  /** Include CLAUDE.md instructions in agent system prompt (default: true) */
  useClaudeMd?: boolean;
  /** Maximum parallel tasks allowed (default: 3) */
  maxParallelTasks?: number;
}

export interface NotificationSettings {
  onTaskComplete: boolean;
  onTaskFailed: boolean;
  onReviewNeeded: boolean;
  sound: boolean;
}

// ============================================
// Context Types (Project Index & Memories)
// ============================================

export interface ProjectIndex {
  project_root: string;
  project_type: 'single' | 'monorepo';
  services: Record<string, ServiceInfo>;
  infrastructure: InfrastructureInfo;
  conventions: ConventionsInfo;
}

export interface ServiceInfo {
  name: string;
  path: string;
  language?: string;
  framework?: string;
  type?: 'backend' | 'frontend' | 'worker' | 'scraper' | 'library' | 'proxy' | 'mobile' | 'desktop' | 'unknown';
  package_manager?: string;
  default_port?: number;
  entry_point?: string;
  key_directories?: Record<string, { path: string; purpose: string }>;
  dependencies?: string[];
  dev_dependencies?: string[];
  testing?: string;
  e2e_testing?: string;
  test_directory?: string;
  orm?: string;
  task_queue?: string;
  styling?: string;
  state_management?: string;
  build_tool?: string;
  // iOS/Swift specific
  apple_frameworks?: string[];
  spm_dependencies?: string[];
  dockerfile?: string;
  consumes?: string[];
  environment?: {
    detected_count: number;
    variables: Record<string, {
      type: string;
      sensitive: boolean;
      required: boolean;
    }>;
  };
  api?: {
    total_routes: number;
    routes: Array<{
      path: string;
      methods: string[];
      requires_auth?: boolean;
    }>;
  };
  database?: {
    total_models: number;
    model_names: string[];
    models: Record<string, {
      orm: string;
      fields: Record<string, unknown>;
    }>;
  };
  services?: {
    databases?: Array<{
      type?: string;
      client?: string;
    }>;
    email?: Array<{
      provider?: string;
      client?: string;
    }>;
    payments?: Array<{
      provider?: string;
      client?: string;
    }>;
    cache?: Array<{
      type?: string;
      client?: string;
    }>;
  };
  monitoring?: {
    metrics_endpoint?: string;
    metrics_type?: string;
    health_checks?: string[];
  };
}

export interface InfrastructureInfo {
  docker_compose?: string;
  docker_services?: string[];
  dockerfile?: string;
  docker_directory?: string;
  dockerfiles?: string[];
  ci?: string;
  ci_workflows?: string[];
  deployment?: string;
}

export interface ConventionsInfo {
  python_linting?: string;
  python_formatting?: string;
  js_linting?: string;
  formatting?: string;
  typescript?: boolean;
  git_hooks?: string;
}

export interface GraphitiMemoryStatus {
  enabled: boolean;
  available: boolean;
  database?: string;
  dbPath?: string;
  reason?: string;
}

// Memory Infrastructure Types
export interface MemoryDatabaseStatus {
  kuzuInstalled: boolean;
  databasePath: string;
  databaseExists: boolean;
  databases: string[];
  error?: string;
}

export interface InfrastructureStatus {
  memory: MemoryDatabaseStatus;
  ready: boolean; // True if memory database is available
}

// Graphiti Validation Types
export interface GraphitiValidationResult {
  success: boolean;
  message: string;
  details?: {
    provider?: string;
    model?: string;
    latencyMs?: number;
  };
}

export interface GraphitiConnectionTestResult {
  database: GraphitiValidationResult;
  llmProvider: GraphitiValidationResult;
  ready: boolean;
}

// Memory Provider Types
// Embedding Providers: OpenAI, Voyage AI, Azure OpenAI, Ollama (local), Google, OpenRouter
// Note: LLM provider removed - Claude SDK handles RAG queries
export type GraphitiEmbeddingProvider = 'openai' | 'voyage' | 'azure_openai' | 'ollama' | 'google' | 'openrouter';

// Legacy type aliases for backward compatibility
export type GraphitiLLMProvider = 'openai' | 'anthropic' | 'azure_openai' | 'ollama' | 'google' | 'groq' | 'openrouter';
export type GraphitiProviderType = GraphitiLLMProvider;

export interface GraphitiProviderConfig {
  // Embedding Provider (LLM provider removed - Claude SDK handles RAG)
  embeddingProvider: GraphitiEmbeddingProvider;
  embeddingModel?: string;  // Embedding model, uses provider default if not specified

  // OpenAI Embeddings
  openaiApiKey?: string;
  openaiEmbeddingModel?: string;

  // Azure OpenAI Embeddings
  azureOpenaiApiKey?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiEmbeddingDeployment?: string;

  // Voyage AI Embeddings
  voyageApiKey?: string;
  voyageEmbeddingModel?: string;

  // Google AI Embeddings
  googleApiKey?: string;
  googleEmbeddingModel?: string;

  // OpenRouter (multi-provider aggregator)
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;  // Default: https://openrouter.ai/api/v1
  openrouterLlmModel?: string;  // LLM model selection (e.g., 'anthropic/claude-sonnet-4')
  openrouterEmbeddingModel?: string;

  // Ollama Embeddings (local, no API key required)
  ollamaBaseUrl?: string;  // Default: http://localhost:11434
  ollamaEmbeddingModel?: string;
  ollamaEmbeddingDim?: number;

  // LadybugDB settings (embedded database - no Docker required)
  database?: string;  // Database name (default: auto_claude_memory)
  dbPath?: string;    // Database storage path (default: ~/.auto-claude/memories)
}

export interface GraphitiProviderInfo {
  id: GraphitiProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultModel: string;
  supportedModels: string[];
}

export interface GraphitiMemoryState {
  initialized: boolean;
  database?: string;
  indices_built: boolean;
  created_at?: string;
  last_session?: number;
  episode_count: number;
  error_log: Array<{ timestamp: string; error: string }>;
}

export type MemoryType =
  | 'session_insight'
  | 'codebase_discovery'
  | 'codebase_map'
  | 'pattern'
  | 'gotcha'
  | 'task_outcome'
  | 'pr_review'
  | 'pr_finding'
  | 'pr_pattern'
  | 'pr_gotcha';

export interface MemoryEpisode {
  id: string;
  type: MemoryType;
  timestamp: string;
  content: string;
  session_number?: number;
  score?: number;
  // For PR reviews - extracted from content for quick access
  prNumber?: number;
  repo?: string;
  verdict?: 'approve' | 'request_changes' | 'comment';
}

export interface ContextSearchResult {
  content: string;
  score: number;
  type: string;
}

export interface ProjectContextData {
  projectIndex: ProjectIndex | null;
  memoryStatus: GraphitiMemoryStatus | null;
  memoryState: GraphitiMemoryState | null;
  recentMemories: MemoryEpisode[];
  isLoading: boolean;
  error?: string;
}

// Environment Configuration for project .env files
export interface ProjectEnvConfig {
  // Claude Authentication
  claudeOAuthToken?: string;
  claudeAuthStatus: 'authenticated' | 'token_set' | 'not_configured';
  // Indicates if the Claude token is from global settings (not project-specific)
  claudeTokenIsGlobal?: boolean;

  // Model Override
  autoBuildModel?: string;

  // Linear Integration
  linearEnabled: boolean;
  linearApiKey?: string;
  linearTeamId?: string;
  linearProjectId?: string;
  linearRealtimeSync?: boolean; // Enable real-time sync of new Linear tasks

  // GitHub Integration
  githubEnabled: boolean;
  githubToken?: string;
  githubRepo?: string; // Format: owner/repo
  githubAutoSync?: boolean; // Auto-sync issues on project load
  githubAuthMethod?: 'oauth' | 'pat'; // How the token was obtained

  // GitLab Integration
  gitlabEnabled: boolean;
  gitlabInstanceUrl?: string; // Default: https://gitlab.com, or self-hosted URL
  gitlabToken?: string;
  gitlabProject?: string; // Format: group/project or numeric ID
  gitlabAutoSync?: boolean; // Auto-sync issues on project load

  // Git/Worktree Settings
  defaultBranch?: string; // Base branch for worktree creation (e.g., 'main', 'develop')

  // Graphiti Memory Integration (V2 - Multi-provider support)
  // Uses LadybugDB embedded database (no Docker required, Python 3.12+)
  graphitiEnabled: boolean;
  graphitiProviderConfig?: GraphitiProviderConfig;  // Provider configuration
  // Legacy fields (still supported for backward compatibility)
  openaiApiKey?: string;
  // Indicates if the OpenAI key is from global settings (not project-specific)
  openaiKeyIsGlobal?: boolean;
  graphitiDatabase?: string;
  graphitiDbPath?: string;

  // UI Settings
  enableFancyUi: boolean;

  // MCP Server Configuration (per-project overrides)
  mcpServers?: {
    /** Context7 documentation lookup - default: true */
    context7Enabled?: boolean;
    /** Graphiti knowledge graph - default: true (if graphitiProviderConfig set) */
    graphitiEnabled?: boolean;
    /** Linear MCP integration - default: follows linearEnabled */
    linearMcpEnabled?: boolean;
    /** Electron desktop automation (QA only) - default: false */
    electronEnabled?: boolean;
    /** Puppeteer browser automation (QA only) - default: false */
    puppeteerEnabled?: boolean;
  };

  // Per-agent MCP overrides (add/remove MCPs from specific agents)
  agentMcpOverrides?: AgentMcpOverrides;

  // Custom MCP servers defined by the user
  customMcpServers?: CustomMcpServer[];
}

/**
 * Per-agent MCP override configuration.
 * Stored in .auto-claude/.env as AGENT_MCP_<agent>_ADD and AGENT_MCP_<agent>_REMOVE
 */
export interface AgentMcpOverride {
  /** MCP servers to add beyond the agent's defaults */
  add?: string[];
  /** MCP servers to remove from the agent's defaults */
  remove?: string[];
}

/**
 * Map of agent type to their MCP overrides.
 * Agent types match backend AGENT_CONFIGS keys (e.g., 'planner', 'coder', 'qa_reviewer')
 */
export interface AgentMcpOverrides {
  [agentType: string]: AgentMcpOverride;
}

/**
 * Custom MCP server configuration.
 * Users can add command-based (npx/npm) or HTTP-based servers.
 */
export interface CustomMcpServer {
  /** Unique identifier (used for agent overrides: AGENT_MCP_<agent>_ADD=myserver) */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Server type */
  type: 'command' | 'http';
  /** Command to execute (for type: 'command'). e.g., 'npx', 'npm', 'node' */
  command?: string;
  /** Arguments for the command (for type: 'command'). e.g., ['-y', 'my-mcp-server'] */
  args?: string[];
  /** HTTP URL (for type: 'http'). e.g., 'https://mcp.example.com/mcp' */
  url?: string;
  /** HTTP headers (for type: 'http'). e.g., { "Authorization": "Bearer ..." } */
  headers?: Record<string, string>;
  /** Optional description shown in UI */
  description?: string;
}

/**
 * MCP server health check status.
 */
export type McpHealthStatus = 'healthy' | 'unhealthy' | 'needs_auth' | 'unknown' | 'checking';

/**
 * Result of a quick health check for a custom MCP server.
 */
export interface McpHealthCheckResult {
  /** Server ID */
  serverId: string;
  /** Health status */
  status: McpHealthStatus;
  /** HTTP status code (for HTTP servers) */
  statusCode?: number;
  /** Human-readable message */
  message?: string;
  /** Response time in milliseconds */
  responseTime?: number;
  /** Timestamp of the check */
  checkedAt: string;
}

/**
 * Result of a full MCP connection test.
 */
export interface McpTestConnectionResult {
  /** Server ID */
  serverId: string;
  /** Whether the connection was successful */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Detailed error if any */
  error?: string;
  /** List of tools discovered (for successful connections) */
  tools?: string[];
  /** Response time in milliseconds */
  responseTime?: number;
}

// Auto Claude Initialization Types
export interface AutoBuildVersionInfo {
  isInitialized: boolean;
  updateAvailable: boolean; // Always false - .auto-claude only contains data, no code to update
}

export interface InitializationResult {
  success: boolean;
  error?: string;
}

export interface GitStatus {
  isGitRepo: boolean;
  hasCommits: boolean;
  currentBranch: string | null;
  error?: string;
}

export interface CreateProjectFolderResult {
  path: string;
  name: string;
  gitInitialized: boolean;
}

// File Explorer Types
export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
}
