/**
 * Session Runner
 * ==============
 *
 * Core agent session runtime. Replaces Python's `run_agent_session()`.
 *
 * Uses Vercel AI SDK v6:
 * - `streamText()` with `stopWhen: stepCountIs(N)` for agentic looping
 * - `prepareStep` callback for between-step memory injection (optional)
 * - `onStepFinish` callbacks for progress tracking
 * - `fullStream` for text-delta, tool-call, tool-result, reasoning events
 *
 * Handles:
 * - Token refresh mid-session (catch 401 → reactive refresh → retry)
 * - Cancellation via AbortSignal
 * - Structured SessionResult with usage, outcome, messages
 * - Memory-aware step limits via calibration factor
 */

import { streamText, stepCountIs, Output } from 'ai';
import type { Tool as AITool } from 'ai';
import type { WorkerObserverProxy } from '../memory/ipc/worker-observer-proxy';
import { StepMemoryState } from '../memory/injection/step-memory-state';
import { buildMemoryAwareStopCondition } from '../memory/injection/memory-stop-condition';

import { buildThinkingProviderOptions } from '../config/types';
import { createStreamHandler } from './stream-handler';
import type { FullStreamPart } from './stream-handler';
import { classifyError, isAuthenticationError, isRateLimitError } from './error-classifier';
import { ProgressTracker } from './progress-tracker';
import type {
  SessionConfig,
  SessionResult,
  SessionOutcome,
  SessionError,
  SessionEventCallback,
  TokenUsage,
  SessionMessage,
} from './types';
import type { QueueResolvedAuth } from '../auth/types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of auth refresh retries before giving up */
const MAX_AUTH_RETRIES = 1;

/** Default max steps if not specified in config — safety backstop for spinning agents */
const DEFAULT_MAX_STEPS = 500;

/** Context window usage threshold (85%) for reactive compaction warning */
const CONTEXT_WINDOW_THRESHOLD = 0.85;

/** Context window usage threshold (90%) for hard abort — triggers continuation */
const CONTEXT_WINDOW_ABORT_THRESHOLD = 0.90;

/** Unique reason string for context-window aborts (used in catch to distinguish from user cancel) */
const CONTEXT_WINDOW_ABORT_REASON = '__context_window_exhausted__';

/** Agent types that should receive a convergence nudge when 75% of steps are used.
 *  These are agents that must write file-based output (verdict/report) to be useful. */
const CONVERGENCE_NUDGE_AGENT_TYPES = new Set<string>([
  'qa_reviewer', 'qa_fixer',
  'spec_critic', 'spec_validation',
  'pr_reviewer', 'pr_finding_validator',
]);

/** Timeout for post-stream result promises (result.text, result.totalUsage).
 *  Some providers (e.g., OpenAI Codex) may not properly resolve these promises
 *  after the stream closes. 10 seconds is generous — these should resolve instantly
 *  since the stream has already been fully consumed. */
const POST_STREAM_TIMEOUT_MS = 10_000;

/** Inactivity timeout for the stream consumption loop.
 *  If no stream parts arrive within this period, the stream is aborted.
 *  Protects against providers that accept the request but never send data
 *  (observed with OpenAI Codex via chatgpt.com/backend-api/codex/responses). */
const STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

// =============================================================================
// Runner Options
// =============================================================================

/**
 * Memory context for active injection into the agent loop.
 * When provided, `runAgentSession()` uses `prepareStep` to inject
 * memory-derived context between agent steps.
 */
export interface MemorySessionContext {
  /** Worker-side proxy for main-thread memory operations */
  proxy: WorkerObserverProxy;
  /** Pre-computed calibration factor for step limit adjustment (from getCalibrationFactor()) */
  calibrationFactor?: number;
}

/**
 * Options for `runAgentSession()` beyond the core SessionConfig.
 */
export interface RunnerOptions {
  /** Callback for streaming events (text, tool calls, progress) */
  onEvent?: SessionEventCallback;
  /** Callback to refresh auth token on 401; returns new API key or null */
  onAuthRefresh?: () => Promise<string | null>;
  /**
   * Optional factory to recreate the model with a fresh token after auth refresh.
   * If provided, called after a successful onAuthRefresh to replace the stale model.
   * Without this, the retry uses the old model instance (which carries the revoked token).
   */
  onModelRefresh?: (newToken: string) => import('ai').LanguageModel;
  /** Tools resolved for this session (from client factory) */
  tools?: Record<string, AITool>;
  /**
   * Optional memory context. When provided, enables active injection via
   * `prepareStep` (between-step gotcha injection, scratchpad reflection,
   * search short-circuit) and calibrated step limits.
   */
  memoryContext?: MemorySessionContext;
  /**
   * Called when an account switch is needed (429 rate limit or 401 auth failure).
   * Returns new resolved auth from the next account in the global priority queue, or null.
   * The caller (orchestration layer) provides this by calling resolveAuthFromQueue()
   * with the failed account excluded.
   */
  onAccountSwitch?: (failedAccountId: string, error: SessionError) => Promise<QueueResolvedAuth | null>;
  /** Current account ID from the priority queue (needed for account-switch retry) */
  currentAccountId?: string;
}

// =============================================================================
// runAgentSession
// =============================================================================

/**
 * Run an agent session using AI SDK v6 `streamText()`.
 *
 * This is the main entry point for executing an agent. It:
 * 1. Configures `streamText()` with tools, system prompt, and stop conditions
 * 2. Processes the full stream for events (text, tool calls, reasoning)
 * 3. Tracks progress via `ProgressTracker`
 * 4. Handles auth failures with token refresh + retry
 * 5. Returns a structured `SessionResult`
 *
 * @param config - Session configuration (model, prompts, tools, limits)
 * @param options - Runner options (event callback, auth refresh)
 * @returns SessionResult with outcome, usage, messages, and error info
 */
export async function runAgentSession(
  config: SessionConfig,
  options: RunnerOptions = {},
): Promise<SessionResult> {
  const { onEvent, onAuthRefresh, onModelRefresh, tools, memoryContext, onAccountSwitch, currentAccountId } = options;
  const startTime = Date.now();

  let authRetries = 0;
  let activeConfig = config;
  let activeAccountId = currentAccountId;

  // Retry loop for auth refresh and account switching
  while (authRetries <= MAX_AUTH_RETRIES) {
    try {
      const result = await executeStream(activeConfig, tools, onEvent, memoryContext);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const { sessionError, outcome } = classifyError(error);

      // Account-switch on rate limit (429) or auth failure (401)
      // This enables cross-provider fallback via the global priority queue
      if (
        (isRateLimitError(error) || isAuthenticationError(error)) &&
        onAccountSwitch &&
        activeAccountId &&
        authRetries < MAX_AUTH_RETRIES
      ) {
        authRetries++;
        const newAuth = await onAccountSwitch(activeAccountId, sessionError);
        if (newAuth) {
          // Switch to new account — dynamic import to avoid circular deps
          const { createProvider } = await import('../providers/factory');
          activeConfig = {
            ...activeConfig,
            model: createProvider({
              config: {
                provider: newAuth.resolvedProvider,
                apiKey: newAuth.apiKey,
                baseURL: newAuth.baseURL,
                headers: newAuth.headers,
                oauthTokenFilePath: newAuth.oauthTokenFilePath,
              },
              modelId: newAuth.resolvedModelId,
            }),
          };
          activeAccountId = newAuth.accountId;
          continue;
        }
        // No more accounts available — fall through to legacy retry
      }

      // Legacy auth refresh (single-provider token refresh)
      if (
        isAuthenticationError(error) &&
        authRetries < MAX_AUTH_RETRIES &&
        onAuthRefresh
      ) {
        authRetries++;
        const newToken = await onAuthRefresh();
        if (!newToken) {
          return buildErrorResult(
            'auth_failure',
            sessionError,
            startTime,
          );
        }
        if (onModelRefresh) {
          activeConfig = { ...activeConfig, model: onModelRefresh(newToken) };
        }
        continue;
      }

      // Non-retryable error or retries exhausted
      return buildErrorResult(outcome, sessionError, startTime);
    }
  }

  // Should not reach here, but guard against it
  return buildErrorResult(
    'auth_failure',
    {
      code: 'auth_failure',
      message: 'Authentication failed after retries',
      retryable: false,
    },
    startTime,
  );
}

// =============================================================================
// Stream Execution
// =============================================================================

// =============================================================================
// Memory Injection Helpers
// =============================================================================

/**
 * Number of initial steps to skip before starting memory injection.
 * The agent needs time to process the initial context before injections are useful.
 */
const MEMORY_INJECTION_WARMUP_STEPS = 5;

// =============================================================================
// Stream Execution
// =============================================================================

/**
 * Execute the AI SDK streamText call and process the full stream.
 *
 * @returns Partial SessionResult (without durationMs, added by caller)
 */
async function executeStream(
  config: SessionConfig,
  tools: Record<string, AITool> | undefined,
  onEvent: SessionEventCallback | undefined,
  memoryContext: MemorySessionContext | undefined,
): Promise<Omit<SessionResult, 'durationMs'>> {
  const baseMaxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  // Apply calibration-adjusted step limit if memory context is available
  const stopCondition = memoryContext
    ? buildMemoryAwareStopCondition(baseMaxSteps, memoryContext.calibrationFactor)
    : stepCountIs(baseMaxSteps);

  const maxSteps = baseMaxSteps; // Keep for outcome detection
  const progressTracker = new ProgressTracker();
  const messages: SessionMessage[] = [...config.initialMessages];

  // Context window guard: track prompt tokens per step
  const contextWindowLimit = config.contextWindowLimit ?? 0;
  let lastPromptTokens = 0;
  let contextWindowWarningInjected = false;

  // Dedicated abort controller for context window exhaustion.
  // Merged with user's abort signal so either can stop the stream.
  const contextWindowAbortController = new AbortController();

  // Stream inactivity abort: fires if the stream produces no data for too long.
  // Protects against providers (e.g., OpenAI Codex) that accept the request but
  // never send stream chunks, which would hang the worker thread indefinitely.
  const streamInactivityController = new AbortController();
  const STREAM_INACTIVITY_REASON = '__stream_inactivity_timeout__';

  const signals: AbortSignal[] = [
    contextWindowAbortController.signal,
    streamInactivityController.signal,
  ];
  if (config.abortSignal) signals.push(config.abortSignal);
  const mergedAbortSignal = AbortSignal.any(signals);

  // Per-step state for memory injection (only allocated when memory is active)
  const stepMemoryState = memoryContext ? new StepMemoryState() : null;

  // Convergence nudge: track whether we've already nudged the agent to wrap up
  let convergenceNudgeInjected = false;

  // Build the event callback that also feeds the progress tracker
  const emitEvent: SessionEventCallback = (event) => {
    // Feed progress tracker
    progressTracker.processEvent(event);
    // Track tool calls in memory state for injection decisions
    if (stepMemoryState && event.type === 'tool-call') {
      stepMemoryState.recordToolCall(event.toolName, event.args);
      // Also notify the observer proxy fire-and-forget
      memoryContext?.proxy.onToolCall(event.toolName, event.args, 0);
    }
    if (stepMemoryState && event.type === 'tool-result') {
      memoryContext?.proxy.onToolResult(event.toolName, event.result, 0);
    }
    // Track prompt tokens for context window guard
    if (event.type === 'step-finish') {
      lastPromptTokens = event.usage.promptTokens;
    }
    // Forward to external listener
    onEvent?.(event);
  };

  const streamHandler = createStreamHandler(emitEvent);

  // Build messages array for AI SDK (system prompt is separate)
  const aiMessages = config.initialMessages.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Codex models (via chatgpt.com/backend-api/codex/responses) require
  // `instructions` in the request body instead of system messages in `input`.
  // Pass system prompt via providerOptions and enable store for proper Codex API behavior.
  const modelId = typeof config.model === 'string' ? config.model : config.model.modelId;
  const isCodex = modelId?.includes('codex') ?? false;
  const isAnthropicModel = modelId?.startsWith('claude-') ?? false;

  // Compute thinking/reasoning provider options from session config
  const thinkingOptions = config.thinkingLevel
    ? buildThinkingProviderOptions(modelId, config.thinkingLevel)
    : undefined;

  // Execute streamText — prepareStep is only added when memory context exists
  //
  // IMPORTANT: Output.object() must NOT be combined with tools in the same streamText()
  // call. This is a known AI SDK limitation (GitHub #8354, #8984, #12016):
  // - Anthropic: tools are silently ignored when output schema is present
  // - Bedrock: tools are ignored with a runtime warning
  // - OpenAI: NoOutputGeneratedError if tool calls are the last step
  //
  // When both tools and outputSchema are requested, we run the tool loop first
  // (without output schema), then extract structured output from the response text
  // after the stream completes. The orchestrators' file-based validation
  // (validateAndNormalizeJsonFile + repairJsonWithLLM) handle the rest.
  const hasTools = tools != null && Object.keys(tools).length > 0;
  const useOutputSchema = config.outputSchema != null && !hasTools;

  const result = streamText({
    model: config.model,
    system: isCodex ? undefined : config.systemPrompt,
    messages: aiMessages,
    tools: tools ?? {},
    ...(useOutputSchema ? { output: Output.object({ schema: config.outputSchema! }) } : {}),
    stopWhen: stopCondition,
    abortSignal: mergedAbortSignal,
    ...((thinkingOptions || isCodex || (useOutputSchema && isAnthropicModel)) ? {
      providerOptions: {
        ...(thinkingOptions ?? {}),
        ...(isCodex ? {
          openai: {
            ...(thinkingOptions?.openai ?? {}),
            ...(config.systemPrompt ? { instructions: config.systemPrompt } : {}),
            store: false,
          },
        } : {}),
        ...(useOutputSchema && isAnthropicModel ? {
          anthropic: { structuredOutputMode: 'outputFormat' },
        } : {}),
      },
    } : {}),
    prepareStep: async ({ stepNumber }) => {
      // Hard abort: if we're at 90%+ of context window, stop the session
      // so the continuation wrapper can checkpoint and resume.
      if (
        contextWindowLimit > 0 &&
        lastPromptTokens > 0 &&
        lastPromptTokens > contextWindowLimit * CONTEXT_WINDOW_ABORT_THRESHOLD
      ) {
        contextWindowAbortController.abort(CONTEXT_WINDOW_ABORT_REASON);
        return {};
      }

      // Collect system messages to inject between steps
      const systemParts: string[] = [];

      // Context window guard: inject compaction warning when approaching limit
      if (
        contextWindowLimit > 0 &&
        lastPromptTokens > 0 &&
        !contextWindowWarningInjected &&
        lastPromptTokens > contextWindowLimit * CONTEXT_WINDOW_THRESHOLD
      ) {
        contextWindowWarningInjected = true;
        const usagePct = Math.round((lastPromptTokens / contextWindowLimit) * 100);
        systemParts.push(
          `WARNING: You are approaching the context window limit (${usagePct}% used, ${lastPromptTokens.toLocaleString()} of ${contextWindowLimit.toLocaleString()} tokens). ` +
          `Complete your current task and commit progress immediately. Do not start new subtasks.`,
        );
      }

      // Convergence nudge: when 75%+ of step budget is used, remind agents
      // that produce file-based output (like QA reviewers) to write their verdict.
      // This doesn't cap the agent — it redirects spinning agents back on task.
      if (
        !convergenceNudgeInjected &&
        maxSteps > 0 &&
        stepNumber >= maxSteps * 0.75 &&
        CONVERGENCE_NUDGE_AGENT_TYPES.has(config.agentType)
      ) {
        convergenceNudgeInjected = true;
        const remaining = maxSteps - stepNumber;
        systemParts.push(
          `IMPORTANT: You have used ${stepNumber} of ${maxSteps} steps (${remaining} remaining). ` +
          `You must finalize your output now. Write your verdict/result to the appropriate file immediately. ` +
          `Do not start new investigations — wrap up with the evidence you have.`,
        );
      }

      const systemMessage = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

      // Memory injection (only when memory context is active)
      if (memoryContext && stepMemoryState) {
        if (stepNumber < MEMORY_INJECTION_WARMUP_STEPS) {
          memoryContext.proxy.onStepComplete(stepNumber);
          return systemMessage ? { system: systemMessage } : {};
        }

        const recentContext = stepMemoryState.getRecentContext(5);
        const injection = await memoryContext.proxy.requestStepInjection(
          stepNumber,
          recentContext,
        );

        memoryContext.proxy.onStepComplete(stepNumber);

        if (!injection) {
          return systemMessage ? { system: systemMessage } : {};
        }

        stepMemoryState.markInjected(injection.memoryIds);

        const combinedSystem = systemMessage
          ? `${systemMessage}\n\n${injection.content}`
          : injection.content;

        return { system: combinedSystem };
      }

      // No memory context — just return system message if applicable
      return systemMessage ? { system: systemMessage } : {};
    },
    onStepFinish: (_stepResult) => {
      // onStepFinish is called after each agentic step.
      // Step results (tool calls, usage) are handled via the fullStream handler.
    },
  });

  // Consume the full stream with inactivity timeout protection.
  // The timer fires if no stream parts arrive within STREAM_INACTIVITY_TIMEOUT_MS,
  // aborting the stream and preventing indefinite worker hangs.
  let streamInactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStreamInactivityTimer = () => {
    if (streamInactivityTimer) clearTimeout(streamInactivityTimer);
    streamInactivityTimer = setTimeout(() => {
      streamInactivityController.abort(STREAM_INACTIVITY_REASON);
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  resetStreamInactivityTimer(); // Arm for initial response
  try {
    for await (const part of result.fullStream) {
      resetStreamInactivityTimer(); // Reset on each part
      streamHandler.processPart(part as FullStreamPart);
    }
  } catch (error: unknown) {
    // Stream-level errors (network, abort, etc.)
    const summary = streamHandler.getSummary();

    // Check if this was a stream inactivity timeout
    if (
      streamInactivityController.signal.aborted &&
      streamInactivityController.signal.reason === STREAM_INACTIVITY_REASON
    ) {
      return {
        outcome: 'error',
        stepsExecuted: summary.stepsExecuted,
        usage: summary.usage,
        error: {
          code: 'stream_timeout',
          message: `Stream inactivity timeout — no data received from provider for ${STREAM_INACTIVITY_TIMEOUT_MS / 1000}s`,
          retryable: true,
        },
        messages,
        toolCallCount: summary.toolCallCount,
      };
    }

    // Check if this was a context-window abort (eligible for continuation)
    if (
      contextWindowAbortController.signal.aborted &&
      contextWindowAbortController.signal.reason === CONTEXT_WINDOW_ABORT_REASON
    ) {
      return {
        outcome: 'context_window',
        stepsExecuted: summary.stepsExecuted,
        usage: summary.usage,
        messages,
        toolCallCount: summary.toolCallCount,
      };
    }

    // Check if it's a user-initiated abort
    if (config.abortSignal?.aborted) {
      return {
        outcome: 'cancelled',
        stepsExecuted: summary.stepsExecuted,
        usage: summary.usage,
        error: {
          code: 'aborted',
          message: 'Session was cancelled',
          retryable: false,
        },
        messages,
        toolCallCount: summary.toolCallCount,
      };
    }
    // Re-throw for classification in the outer try/catch
    throw error;
  } finally {
    if (streamInactivityTimer) clearTimeout(streamInactivityTimer);
  }

  // Gather final summary from stream handler
  const summary = streamHandler.getSummary();

  // Determine outcome
  let outcome: SessionOutcome = 'completed';
  if (summary.stepsExecuted >= maxSteps) {
    outcome = 'max_steps';
  }

  // Collect response text from the stream result.
  // These AI SDK result promises can hang if the provider's stream closed
  // without properly signaling completion (observed with OpenAI Codex).
  // Use a timeout to prevent the worker from hanging indefinitely.
  let responseText = '';
  try {
    responseText = await withTimeout(result.text, POST_STREAM_TIMEOUT_MS, 'result.text');
  } catch {
    // Fall through — use empty text. The stream handler already captured
    // all text deltas, so this is just the final concatenated text.
  }

  // Extract structured output if schema was provided.
  // When Output.object() was used (no tools), extract from the AI SDK result.
  // When tools were present (Output.object() skipped), try to parse response text
  // as JSON and validate against the schema as a best-effort fallback.
  let structuredOutput: Record<string, unknown> | undefined;
  if (config.outputSchema) {
    if (useOutputSchema) {
      // Output.object() was active — extract from AI SDK result
      try {
        const output = await withTimeout(result.output, POST_STREAM_TIMEOUT_MS, 'result.output');
        if (output) {
          structuredOutput = output as Record<string, unknown>;
        }
      } catch {
        // Structured output extraction failed — non-fatal.
      }
    } else if (responseText) {
      // Tools were present so Output.object() was skipped.
      // Try to parse the response text as JSON and validate against the schema.
      // This catches models that output the structured data as their final text.
      try {
        // Extract JSON from response text (may be wrapped in markdown code fences)
        const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ?? [null, responseText];
        const jsonStr = jsonMatch[1]?.trim();
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          const validated = config.outputSchema.safeParse(parsed);
          if (validated.success) {
            structuredOutput = validated.data as Record<string, unknown>;
          }
        }
      } catch {
        // JSON parsing failed — non-fatal. Caller uses file-based validation.
      }
    }
  }

  // Add assistant response to messages
  if (responseText) {
    messages.push({ role: 'assistant', content: responseText });
  }

  // Get total usage from AI SDK result
  // AI SDK v6 uses inputTokens/outputTokens naming
  let totalUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    totalUsage = await withTimeout(result.totalUsage, POST_STREAM_TIMEOUT_MS, 'result.totalUsage');
  } catch {
    // Fall through — use summary usage collected during stream iteration.
  }
  const usage: TokenUsage = {
    promptTokens: totalUsage?.inputTokens ?? summary.usage.promptTokens,
    completionTokens: totalUsage?.outputTokens ?? summary.usage.completionTokens,
    totalTokens:
      (totalUsage?.inputTokens ?? 0) + (totalUsage?.outputTokens ?? 0) ||
      summary.usage.totalTokens,
  };

  return {
    outcome,
    stepsExecuted: summary.stepsExecuted,
    usage,
    messages,
    toolCallCount: summary.toolCallCount,
    ...(structuredOutput ? { structuredOutput } : {}),
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build an error SessionResult.
 */
function buildErrorResult(
  outcome: SessionOutcome,
  error: SessionError,
  startTime: number,
): SessionResult {
  return {
    outcome,
    stepsExecuted: 0,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    error,
    messages: [],
    toolCallCount: 0,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error if the
 * promise doesn't settle within `ms` milliseconds.
 *
 * Used for AI SDK result promises (result.text, result.totalUsage) which can
 * hang indefinitely if the provider stream closes without signaling completion.
 */
function withTimeout<T>(thenable: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${label} (${ms}ms)`));
    }, ms);
    thenable.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error as Error); },
    );
  });
}
