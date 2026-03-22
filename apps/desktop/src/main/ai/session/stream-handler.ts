/**
 * Stream Handler
 * ==============
 *
 * Processes AI SDK v6 fullStream events and emits structured StreamEvent objects.
 * Bridges the raw AI SDK stream into the session event system.
 *
 * AI SDK v6 fullStream parts handled:
 * - text-delta: Incremental text output (field: `text`)
 * - reasoning-delta: Extended thinking / reasoning output (field: `delta`)
 * - tool-call: Model has assembled a complete tool call (fields: `toolCallId`, `toolName`, `input`)
 * - tool-result: Tool execution completed (fields: `toolCallId`, `toolName`, `output`)
 * - tool-error: Tool execution failed (fields: `toolCallId`, `toolName`, `error`)
 * - finish-step: An agentic step completed (field: `usage` with `promptTokens`/`completionTokens`)
 * - error: Stream-level error (field: `error`)
 */

import type {
  SessionEventCallback,
  StreamEvent,
  TokenUsage,
} from './types';
import { classifyError, classifyToolError } from './error-classifier';

// =============================================================================
// Types
// =============================================================================

/**
 * AI SDK v6 fullStream part types we handle.
 * These match the actual shape emitted by `streamText().fullStream` in AI SDK v6.
 *
 * Verified against AI SDK v6 docs:
 * - text-delta uses `text` field
 * - reasoning-delta uses `delta` field
 * - tool-call has `toolCallId`, `toolName`, `input`
 * - tool-result has `toolCallId`, `toolName`, `input`, `output`
 * - tool-error has `toolCallId`, `toolName`, `error`
 * - finish-step usage uses `promptTokens`/`completionTokens`
 * - error uses `error` field (not `errorText`)
 */
export interface TextDeltaPart {
  type: 'text-delta';
  text: string;
}

export interface ReasoningDeltaPart {
  type: 'reasoning-delta';
  delta: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}

export interface ToolErrorPart {
  type: 'tool-error';
  toolCallId: string;
  toolName: string;
  error: unknown;
}

export interface FinishStepPart {
  type: 'finish-step';
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ErrorPart {
  type: 'error';
  error: unknown;
}

export type FullStreamPart =
  | TextDeltaPart
  | ReasoningDeltaPart
  | ToolCallPart
  | ToolResultPart
  | ToolErrorPart
  | FinishStepPart
  | ErrorPart
  | { type: string; [key: string]: unknown };

// =============================================================================
// Stream Handler State
// =============================================================================

interface StreamHandlerState {
  stepNumber: number;
  toolCallCount: number;
  cumulativeUsage: TokenUsage;
  /** Track tool call start times for duration calculation */
  toolCallTimestamps: Map<string, number>;
  /** Track tool names by toolCallId (needed to emit tool-result with name from tool-output-available) */
  toolCallNames: Map<string, string>;
}

function createInitialState(): StreamHandlerState {
  return {
    stepNumber: 0,
    toolCallCount: 0,
    cumulativeUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    toolCallTimestamps: new Map(),
    toolCallNames: new Map(),
  };
}

// =============================================================================
// Stream Handler
// =============================================================================

/**
 * Creates a stream handler that processes AI SDK v6 fullStream parts
 * and emits structured StreamEvents via the callback.
 *
 * Usage:
 * ```ts
 * const handler = createStreamHandler(onEvent);
 * for await (const part of result.fullStream) {
 *   handler.processPart(part);
 * }
 * const summary = handler.getSummary();
 * ```
 */
export function createStreamHandler(onEvent: SessionEventCallback) {
  const state = createInitialState();

  function emit(event: StreamEvent): void {
    onEvent(event);
  }

  function processPart(part: FullStreamPart): void {
    switch (part.type) {
      case 'text-delta':
        handleTextDelta(part as TextDeltaPart);
        break;
      case 'reasoning-delta':
        handleReasoningDelta(part as ReasoningDeltaPart);
        break;
      case 'tool-call':
        handleToolCall(part as ToolCallPart);
        break;
      case 'tool-result':
        handleToolResult(part as ToolResultPart);
        break;
      case 'tool-error':
        handleToolError(part as ToolErrorPart);
        break;
      case 'finish-step':
        handleFinishStep(part as FinishStepPart);
        break;
      case 'error':
        handleError(part as ErrorPart);
        break;
      // Ignore other part types (text-start, text-end, tool-input-start,
      // tool-input-delta, start-step, start, finish, reasoning-start,
      // reasoning-end, source, file, raw, etc.)
    }
  }

  function handleTextDelta(part: TextDeltaPart): void {
    emit({ type: 'text-delta', text: part.text ?? '' });
  }

  function handleReasoningDelta(part: ReasoningDeltaPart): void {
    emit({ type: 'thinking-delta', text: part.delta });
  }

  function handleToolCall(part: ToolCallPart): void {
    state.toolCallCount++;
    state.toolCallTimestamps.set(part.toolCallId, Date.now());
    // Store the tool name so we can include it in tool-result/tool-error events
    state.toolCallNames.set(part.toolCallId, part.toolName);
    emit({
      type: 'tool-call',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      args: (part.input as Record<string, unknown>) ?? {},
    });
  }

  function handleToolResult(part: ToolResultPart): void {
    const startTime = state.toolCallTimestamps.get(part.toolCallId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    state.toolCallTimestamps.delete(part.toolCallId);
    state.toolCallNames.delete(part.toolCallId);

    emit({
      type: 'tool-result',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      result: part.output,
      durationMs,
      isError: false,
    });
  }

  function handleToolError(part: ToolErrorPart): void {
    const startTime = state.toolCallTimestamps.get(part.toolCallId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    state.toolCallTimestamps.delete(part.toolCallId);
    state.toolCallNames.delete(part.toolCallId);

    const errorMessage = part.error instanceof Error ? part.error.message : String(part.error ?? 'Tool execution failed');

    emit({
      type: 'tool-result',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      result: errorMessage,
      durationMs,
      isError: true,
    });

    const toolError = classifyToolError(part.toolName, part.toolCallId, errorMessage);
    emit({ type: 'error', error: toolError });
  }

  function handleFinishStep(part: FinishStepPart): void {
    state.stepNumber++;

    // AI SDK v6 finish-step usage: promptTokens/completionTokens
    const promptTokens = part.usage?.promptTokens ?? 0;
    const completionTokens = part.usage?.completionTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;

    // Accumulate usage
    state.cumulativeUsage.promptTokens += promptTokens;
    state.cumulativeUsage.completionTokens += completionTokens;
    state.cumulativeUsage.totalTokens += totalTokens;

    const stepUsage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
    };

    emit({
      type: 'step-finish',
      stepNumber: state.stepNumber,
      usage: stepUsage,
    });

    emit({
      type: 'usage-update',
      usage: { ...state.cumulativeUsage },
    });
  }

  function handleError(part: ErrorPart): void {
    // DEBUG: Dump the raw error to console for diagnosis
    console.warn('[StreamHandler] RAW ERROR:', JSON.stringify(part.error, Object.getOwnPropertyNames(part.error instanceof Error ? part.error : {}), 2).slice(0, 1000));
    console.warn('[StreamHandler] ERROR TYPE:', typeof part.error, part.error?.constructor?.name);
    if (part.error instanceof Error) {
      console.warn('[StreamHandler] ERROR CAUSE:', (part.error as { cause?: unknown }).cause);
      console.warn('[StreamHandler] ERROR STACK:', part.error.stack?.slice(0, 500));
    }

    // Extract meaningful error message - AI SDK error objects may have nested cause
    let errorMessage: string;
    if (part.error instanceof Error) {
      errorMessage = part.error.message;
      // If message is just 'error', try cause
      if (errorMessage === 'error' && (part.error as { cause?: unknown }).cause) {
        const cause = (part.error as { cause?: unknown }).cause;
        errorMessage = cause instanceof Error ? cause.message : String(cause);
      }
      // Also check stack for more context if message is unhelpful
      if (errorMessage === 'error' && part.error.stack) {
        errorMessage = part.error.stack.split('\n')[0] || 'Stream error';
      }
    } else if (typeof part.error === 'object' && part.error !== null) {
      const errObj = part.error as Record<string, unknown>;
      errorMessage = (errObj.message as string) || (errObj.text as string) || JSON.stringify(part.error).slice(0, 500);
    } else {
      errorMessage = String(part.error ?? 'Stream error');
    }
    const { sessionError } = classifyError(errorMessage);
    emit({ type: 'error', error: sessionError });
  }

  /**
   * Returns a summary of the stream processing state.
   * Call after the stream is fully consumed.
   */
  function getSummary() {
    return {
      stepsExecuted: state.stepNumber,
      toolCallCount: state.toolCallCount,
      usage: { ...state.cumulativeUsage },
    };
  }

  return {
    processPart,
    getSummary,
  };
}

export type StreamHandler = ReturnType<typeof createStreamHandler>;
