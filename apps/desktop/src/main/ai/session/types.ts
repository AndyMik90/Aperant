/**
 * Session Types
 * =============
 *
 * Core type definitions for the agent session runtime.
 * Ported from apps/desktop/src/main/ai/session/types.ts (originally from Python agents/session).
 *
 * - SessionConfig: Everything needed to start an agent session
 * - SessionResult: Outcome of a completed session
 * - StreamEvent: Structured events emitted during streaming
 * - ProgressState: Tracks subtask progress within a session
 */

import type { LanguageModel } from 'ai';
import type { ZodSchema } from 'zod';

import type { AgentType } from '../config/agent-configs';
import type { ModelShorthand, Phase, ThinkingLevel } from '../config/types';
import type { McpClientResult } from '../mcp/types';
import type { ToolContext } from '../tools/types';

// =============================================================================
// Session Configuration
// =============================================================================

/**
 * Full configuration for running an agent session.
 * Passed to `runAgentSession()` to start streaming.
 */
export interface SessionConfig {
  /** The agent type determines tools, MCP servers, and thinking defaults */
  agentType: AgentType;
  /** Resolved language model instance from the provider layer */
  model: LanguageModel;
  /** System prompt for the session */
  systemPrompt: string;
  /** Initial user message(s) to start the conversation */
  initialMessages: SessionMessage[];
  /** Tool context (cwd, projectDir, specDir, securityProfile) */
  toolContext: ToolContext;
  /** Maximum number of agentic steps (maps to AI SDK `stopWhen: stepCountIs(N)`) */
  maxSteps: number;
  /** Thinking level override (defaults to agent config) */
  thinkingLevel?: ThinkingLevel;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Pre-initialized MCP client results (tools from MCP servers) */
  mcpClients?: McpClientResult[];
  /** Spec directory for the current task */
  specDir: string;
  /** Project directory root */
  projectDir: string;
  /** Current phase for model/thinking resolution */
  phase?: Phase;
  /** Model shorthand used (for logging/diagnostics) */
  modelShorthand?: ModelShorthand;
  /** Session number within the current subtask run */
  sessionNumber?: number;
  /** Subtask ID being worked on (if applicable) */
  subtaskId?: string;
  /** Context window limit in tokens for reactive compaction guard */
  contextWindowLimit?: number;
  /**
   * Optional Zod schema for structured output.
   *
   * Behavior depends on whether the session has tools:
   *
   * - **Without tools**: Uses AI SDK `Output.object()` for provider-level
   *   constrained decoding (OpenAI, Anthropic enforce server-side).
   *
   * - **With tools**: `Output.object()` is intentionally SKIPPED to avoid
   *   a known AI SDK conflict where structured output suppresses tool calling
   *   (GitHub #8354, #8984, #12016). Instead, the runner attempts to parse
   *   the model's response text as JSON and validate against the schema
   *   after the stream completes. Callers should still use file-based
   *   validation (validateAndNormalizeJsonFile) as the primary path.
   */
  outputSchema?: ZodSchema;
}

// =============================================================================
// Session Messages
// =============================================================================

/** Role for session messages */
export type MessageRole = 'user' | 'assistant';

/** A message in the session conversation */
export interface SessionMessage {
  role: MessageRole;
  content: string;
}

// =============================================================================
// Session Result
// =============================================================================

/** Possible outcomes of a session */
export type SessionOutcome =
  | 'completed'        // Session finished normally (all steps used or model stopped)
  | 'error'            // Session ended with an unrecoverable error
  | 'rate_limited'     // Hit provider rate limit (429)
  | 'auth_failure'     // Authentication error (401)
  | 'cancelled'        // Aborted via AbortSignal
  | 'max_steps'        // Reached maxSteps limit
  | 'context_window';  // Approaching context window limit (90%), eligible for continuation

/**
 * Result returned when a session finishes (success or failure).
 */
export interface SessionResult {
  /** How the session ended */
  outcome: SessionOutcome;
  /** Total agentic steps executed */
  stepsExecuted: number;
  /** Total tokens consumed */
  usage: TokenUsage;
  /** Error details (when outcome is 'error', 'rate_limited', or 'auth_failure') */
  error?: SessionError;
  /** The full message history at session end */
  messages: SessionMessage[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Tool calls made during the session */
  toolCallCount: number;
  /**
   * Validated structured output when outputSchema was provided in config.
   * Null if no schema was provided or if structured output extraction failed.
   */
  structuredOutput?: Record<string, unknown>;
}

/** Token usage breakdown */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Thinking/reasoning tokens (provider-specific) */
  thinkingTokens?: number;
  /** Cache read tokens (Anthropic prompt caching) */
  cacheReadTokens?: number;
  /** Cache creation tokens (Anthropic prompt caching) */
  cacheCreationTokens?: number;
}

/** Structured error from a session */
export interface SessionError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Original error (for logging) */
  cause?: unknown;
}

// =============================================================================
// Stream Events
// =============================================================================

/**
 * Structured events emitted during session streaming.
 * Consumed by the main process to update UI and track progress.
 */
export type StreamEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | StepFinishEvent
  | ErrorEvent
  | UsageUpdateEvent;

/** Incremental text output from the model */
export interface TextDeltaEvent {
  type: 'text-delta';
  text: string;
}

/** Incremental thinking/reasoning output (extended thinking) */
export interface ThinkingDeltaEvent {
  type: 'thinking-delta';
  text: string;
}

/** Model initiated a tool call */
export interface ToolCallEvent {
  type: 'tool-call';
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

/** Tool execution completed */
export interface ToolResultEvent {
  type: 'tool-result';
  toolName: string;
  toolCallId: string;
  result: unknown;
  durationMs: number;
  isError: boolean;
}

/** An agentic step completed (model turn + tool calls) */
export interface StepFinishEvent {
  type: 'step-finish';
  stepNumber: number;
  usage: TokenUsage;
}

/** An error occurred during the session */
export interface ErrorEvent {
  type: 'error';
  error: SessionError;
}

/** Cumulative usage update */
export interface UsageUpdateEvent {
  type: 'usage-update';
  usage: TokenUsage;
}

// =============================================================================
// Progress State
// =============================================================================

/**
 * Tracks subtask progress within a session.
 * Used by the orchestrator to determine next actions.
 */
export interface ProgressState {
  /** Current subtask ID being worked on */
  currentSubtaskId: string | null;
  /** Total subtasks in the plan */
  totalSubtasks: number;
  /** Number of completed subtasks */
  completedSubtasks: number;
  /** Number of in-progress subtasks */
  inProgressSubtasks: number;
  /** Whether the build is fully complete */
  isBuildComplete: boolean;
  /** Subtask IDs that are stuck/blocked */
  stuckSubtasks: string[];
}

// =============================================================================
// Session Event Callback
// =============================================================================

/**
 * Callback type for receiving stream events during a session.
 * Used by the worker thread to communicate with the main process.
 */
export type SessionEventCallback = (event: StreamEvent) => void;
