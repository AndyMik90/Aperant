/**
 * Structured Output Types
 *
 * Types for pre-parsed SDK output blocks used by the rich terminal UI.
 * These types are shared between main process (parser) and renderer (UI).
 *
 * Based on Claude SDK message types - see docs/TASK_MONITOR_ARCHITECTURE.md
 */

export type StructuredBlockType =
  | 'text'
  | 'thinking'
  | 'tool_use'      // Was: tool_start
  | 'tool_result'   // Was: tool_end
  | 'phase_start'
  | 'phase_end'
  | 'error'
  // Legacy aliases for backwards compatibility
  | 'tool_start'
  | 'tool_end'
  | 'subphase_start';

export interface TextBlock {
  type: 'text';
  content: string;
  phase?: string;
  subtaskId?: string;
  timestamp?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content: string;
  signature?: string;
  timestamp?: string;
}

/**
 * Tool use block - Claude is invoking a tool
 * Contains full input parameters for rich display (diffs, etc.)
 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;           // Tool use ID for matching with result
  name: string;         // Tool name (Read, Edit, Bash, etc.)
  input: Record<string, unknown>;  // FULL input - includes old_string/new_string for Edit
}

/**
 * Tool result block - Result of tool execution
 * Contains full output content
 */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;  // Matches the tool_use id
  name: string;         // Tool name for display
  content: string;      // FULL result content
  is_error: boolean;    // Whether the tool failed
}

// Legacy interfaces for backwards compatibility with old parsers
export interface ToolStartBlock {
  type: 'tool_start';
  toolName: string;
  input?: Record<string, unknown>;
  displayInput?: string;
  phase?: string;
}

export interface ToolEndBlock {
  type: 'tool_end';
  toolName: string;
  success: boolean;
  hasDetail?: boolean;
  result?: string;
  phase?: string;
}

export interface PhaseStartBlock {
  type: 'phase_start';
  phase: string;
  timestamp?: string;
}

export interface PhaseEndBlock {
  type: 'phase_end';
  phase: string;
  success: boolean;
  timestamp?: string;
}

export interface SubphaseStartBlock {
  type: 'subphase_start';
  subphase: string;
  phase?: string;
  timestamp?: string;
}

export interface ErrorBlock {
  type: 'error';
  content: string;
  phase?: string;
}

export type StructuredBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | PhaseStartBlock
  | PhaseEndBlock
  | ErrorBlock
  // Legacy block types for backwards compatibility
  | ToolStartBlock
  | ToolEndBlock
  | SubphaseStartBlock;
