/**
 * Auto-Claude MCP Server Types
 *
 * Type definitions for MCP tool parameters and responses.
 * These types mirror the TaskMetadata interface from the frontend
 * but are tailored for external MCP clients.
 */

// Model types matching the frontend
export type ModelType = 'haiku' | 'sonnet' | 'opus';

// Task categories
export type TaskCategory =
  | 'feature'
  | 'bug_fix'
  | 'refactoring'
  | 'documentation'
  | 'security'
  | 'performance'
  | 'ui_ux'
  | 'infrastructure'
  | 'testing';

// Task complexity levels
export type TaskComplexity = 'trivial' | 'small' | 'medium' | 'large' | 'complex';

// Task priority levels
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

// Task status (from Kanban board)
export type TaskStatus =
  | 'backlog'
  | 'in_progress'
  | 'ai_review'
  | 'human_review'
  | 'pr_created'
  | 'done'
  | 'error';

/**
 * Per-phase model configuration
 */
export interface PhaseModels {
  specCreation?: ModelType;
  planning?: ModelType;
  coding?: ModelType;
  qaReview?: ModelType;
}

/**
 * Per-phase thinking token configuration
 */
export interface PhaseThinking {
  specCreation?: number;
  planning?: number;
  coding?: number;
  qaReview?: number;
}

/**
 * Task creation options
 */
export interface TaskOptions {
  // Provider selection
  provider?: string;  // Provider name (e.g., 'MiniMax', 'Primary') — resolved to providerId

  // Model configuration
  model?: ModelType;
  phaseModels?: PhaseModels;
  phaseThinking?: PhaseThinking;

  // Review settings
  requireReviewBeforeCoding?: boolean;

  // Git options
  baseBranch?: string;

  // Reference files (relative paths from project root)
  referencedFiles?: string[];

  // Classification (optional)
  category?: TaskCategory;
  complexity?: TaskComplexity;
  priority?: TaskPriority;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Parameter Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for create_task tool
 */
export interface CreateTaskParams {
  projectId: string;
  description: string;
  title?: string;
  options?: TaskOptions;
}

/**
 * Parameters for list_tasks tool
 */
export interface ListTasksParams {
  projectId: string;
  status?: TaskStatus;
}

/**
 * Parameters for start_task tool
 */
export interface StartTaskParams {
  projectId: string;
  taskId: string;
  options?: {
    model?: ModelType;
    baseBranch?: string;
  };
}

/**
 * Parameters for get_task_status tool
 */
export interface GetTaskStatusParams {
  projectId: string;
  taskId: string;
}

/**
 * Task definition for batch operations
 */
export interface BatchTaskDefinition {
  description: string;
  title?: string;
  options?: TaskOptions;
}

/**
 * Parameters for start_batch tool
 */
export interface StartBatchParams {
  projectId: string;
  tasks: BatchTaskDefinition[];
  options?: TaskOptions; // Default options applied to all tasks
  startImmediately?: boolean; // Default: true
}

/**
 * On-complete callback configuration
 */
export interface OnCompleteConfig {
  command: string;
  args?: string[];
  delaySeconds?: number; // Grace period before executing (default: 60)
}

/**
 * Parameters for wait_for_human_review tool
 */
export interface WaitForHumanReviewParams {
  projectId: string;
  taskIds: string[];
  onComplete?: OnCompleteConfig;
  pollIntervalMs?: number; // How often to check (default: 30000)
  timeoutMs?: number; // Max time to wait (default: no timeout)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Response Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard result wrapper
 */
export interface MCPResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Created task info
 */
export interface CreatedTask {
  taskId: string;
  specPath: string;
  title: string;
  status: TaskStatus;
}

/**
 * Task summary for listing
 */
export interface TaskSummary {
  taskId: string;
  projectPath: string; // Path to project directory - needed by MCP tools to write fix files
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Detailed task status
 */
export interface TaskStatusDetail {
  taskId: string;
  title: string;
  status: TaskStatus;
  phase?: string;
  progress?: number;
  subtaskCount?: number;
  completedSubtasks?: number;
  error?: string;
  reviewReason?: string;
}

/**
 * Batch operation result
 */
export interface BatchResult {
  taskIds: string[];
  created: number;
  started: number;
  errors: Array<{ description: string; error: string }>;
}

/**
 * Wait completion result
 */
export interface WaitResult {
  completed: boolean;
  taskStatuses: Record<string, TaskStatus>;
  commandExecuted?: boolean;
  commandOutput?: string;
  timedOut?: boolean;
  /** Whether shutdown was blocked due to rate-limit-crashed tasks */
  shutdownBlocked?: boolean;
  /** Task IDs that crashed due to rate limit (not genuinely complete) */
  rateLimitCrashes?: string[];
  /** Human-readable message about the wait result */
  message?: string;
}
