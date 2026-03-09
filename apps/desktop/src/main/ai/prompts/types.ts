/**
 * Prompt System Types
 * ===================
 *
 * Type definitions for the prompt loading and generation system.
 * Mirrors the Python prompts_pkg interfaces.
 */

// =============================================================================
// Prompt Context
// =============================================================================

/** Context injected into prompt templates */
export interface PromptContext {
  /** Absolute path to the spec directory */
  specDir: string;
  /** Absolute path to the project root */
  projectDir: string;
  /** Project instructions from AGENTS.md (preferred) or CLAUDE.md (fallback) */
  projectInstructions?: string | null;
  /** Base branch name for git comparisons (e.g., "main", "develop") */
  baseBranch?: string;
  /** Human input from HUMAN_INPUT.md (for coder prompts) */
  humanInput?: string | null;
  /** Recovery context from attempt_history.json (for coder prompts) */
  recoveryContext?: string | null;
  /** Subtask info for targeted coder prompts */
  subtask?: SubtaskPromptInfo;
  /** Retry attempt count (0 = first try) */
  attemptCount?: number;
  /** Recovery hints from previous failed attempts */
  recoveryHints?: string[];
  /** Phase-specific planning retry context */
  planningRetryContext?: string;
}

// =============================================================================
// Project Capabilities
// =============================================================================

/** Project capabilities detected from project_index.json */
export interface ProjectCapabilities {
  /** True if project uses Electron */
  is_electron: boolean;
  /** True if project uses Tauri */
  is_tauri: boolean;
  /** True if project uses Expo */
  is_expo: boolean;
  /** True if project uses React Native */
  is_react_native: boolean;
  /** True if project has a web frontend (React, Vue, etc.) */
  is_web_frontend: boolean;
  /** True if project uses Next.js */
  is_nextjs: boolean;
  /** True if project uses Nuxt */
  is_nuxt: boolean;
  /** True if project has API endpoints */
  has_api: boolean;
  /** True if project has a database */
  has_database: boolean;
}

// =============================================================================
// Subtask Prompt Info
// =============================================================================

/** Minimal subtask info for prompt generation */
export interface SubtaskPromptInfo {
  /** Subtask identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Phase this subtask belongs to */
  phaseName?: string;
  /** Service/area this subtask targets */
  service?: string;
  /** Files to create */
  filesToCreate?: string[];
  /** Files to modify */
  filesToModify?: string[];
  /** Reference/pattern files to study */
  patternsFrom?: string[];
  /** Verification configuration */
  verification?: SubtaskVerification;
  /** Current status */
  status?: string;
}

/** Verification configuration for a subtask */
export interface SubtaskVerification {
  type?: 'command' | 'api' | 'browser' | 'e2e' | 'manual';
  command?: string;
  expected?: string;
  method?: string;
  url?: string;
  body?: Record<string, unknown>;
  expected_status?: number;
  checks?: string[];
  steps?: string[];
  instructions?: string;
}

// =============================================================================
// Planner Prompt Config
// =============================================================================

/** Configuration for generating the planner prompt */
export interface PlannerPromptConfig {
  /** Spec directory path */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Project instructions from AGENTS.md or CLAUDE.md */
  projectInstructions?: string | null;
  /** Planning retry context if replanning after validation failure */
  planningRetryContext?: string;
  /** Attempt number (0 = first try) */
  attemptCount?: number;
}

// =============================================================================
// Subtask Prompt Config
// =============================================================================

/** Configuration for generating a subtask (coder) prompt */
export interface SubtaskPromptConfig {
  /** Spec directory path */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** The subtask to implement */
  subtask: SubtaskPromptInfo;
  /** Phase data from implementation_plan.json */
  phase?: { id?: string; name?: string };
  /** Attempt count for retry context */
  attemptCount?: number;
  /** Hints from previous failed attempts */
  recoveryHints?: string[];
  /** Project instructions from AGENTS.md or CLAUDE.md */
  projectInstructions?: string | null;
}

// =============================================================================
// Subtask Context
// =============================================================================

/** Loaded file context for a subtask */
export interface SubtaskContext {
  /** Pattern file contents keyed by relative path */
  patterns: Record<string, string>;
  /** Files to modify keyed by relative path */
  filesToModify: Record<string, string>;
  /** Relevant spec excerpt (if any) */
  specExcerpt?: string | null;
}

// =============================================================================
// QA Prompt Config
// =============================================================================

/** Configuration for generating QA reviewer/fixer prompts */
export interface QAPromptConfig {
  /** Spec directory path */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Project instructions from AGENTS.md or CLAUDE.md */
  projectInstructions?: string | null;
  /** Base branch for git comparisons */
  baseBranch?: string;
  /** Project capabilities for injecting MCP tool docs */
  capabilities?: ProjectCapabilities;
  /** Project index for service details */
  projectIndex?: Record<string, unknown>;
}

// =============================================================================
// Prompt Loader Result
// =============================================================================

/** Result of loading and validating prompt files */
export interface PromptValidationResult {
  /** Whether all expected prompt files exist */
  valid: boolean;
  /** List of missing prompt file names */
  missingFiles: string[];
  /** The resolved prompts directory path */
  promptsDir: string;
}
