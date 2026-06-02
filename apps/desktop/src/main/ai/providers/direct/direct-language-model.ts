/**
 * DirectLanguageModel
 * ===================
 *
 * A `LanguageModelV2` (Vercel AI SDK v6 provider interface) implementation that
 * wraps the prompt→text web transports from `ai-providers-direct` (DeepSeek /
 * ChatGPT). It makes the free, no-API-key transports usable everywhere the app
 * already calls `streamText()` / `generateText()`.
 *
 * Two responsibilities beyond plumbing:
 *  - Flatten the AI SDK's structured prompt into the single string the
 *    transport accepts (see prompt-flatten.ts).
 *  - Emulate function calling in plain text (see tool-protocol.ts), so the
 *    tool-driven agent loop can run on a protocol that has no native tools.
 *
 * The actual network transport is injected (`DirectTransport`) so this class
 * stays pure and unit-testable — it never imports the library, WASM, or
 * Playwright. The real library bridge lives in transport.ts.
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider';

import { flattenPrompt } from './prompt-flatten';
import { buildToolInstructions, parseToolCalls, type ParsedToolCall } from './tool-protocol';

// =============================================================================
// Transport contract
// =============================================================================

/** Options handed to a transport for a single generation. */
export interface DirectGenerateOptions {
  /** The fully-assembled prompt string (system + tools + transcript). */
  prompt: string;
  /** Enable the provider's reasoning/thinking tokens when supported. */
  thinking?: boolean;
  /** Cancellation signal from the AI SDK call. */
  signal?: AbortSignal;
  /** Streamed for every text piece as it arrives (streaming path only). */
  onText?: (delta: string) => void;
  /** Streamed for every reasoning piece as it arrives (streaming path only). */
  onReasoning?: (delta: string) => void;
}

/** Result of a transport generation. */
export interface DirectGenerateResult {
  /** Full final answer text. */
  text: string;
  /** Reasoning text, if the provider produced any. */
  reasoning?: string;
}

/** Pluggable network transport (DeepSeek, ChatGPT, or a test double). */
export interface DirectTransport {
  generate(options: DirectGenerateOptions): Promise<DirectGenerateResult>;
}

// =============================================================================
// Construction
// =============================================================================

export interface DirectLanguageModelOptions {
  /** Provider label for logging/telemetry (e.g. 'direct'). */
  provider: string;
  /** Model ID (e.g. 'deepseek', 'deepseek-thinking', 'chatgpt'). */
  modelId: string;
  /** Network transport bridging to ai-providers-direct. */
  transport: DirectTransport;
  /** Force reasoning tokens on (otherwise inferred from the modelId). */
  thinking?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Cheap token estimate (~4 chars/token) — the web protocols report no usage. */
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function buildUsage(promptText: string, outputText: string): LanguageModelV2Usage {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateTokens(outputText);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/** Keep only the function tools; provider-defined tools cannot be emulated. */
function functionToolsOnly(
  options: LanguageModelV2CallOptions,
): LanguageModelV2FunctionTool[] {
  return (options.tools ?? []).filter(
    (t): t is LanguageModelV2FunctionTool => t.type === 'function',
  );
}

/** Assemble the single prompt string the transport consumes. */
function assemblePrompt(
  options: LanguageModelV2CallOptions,
  tools: LanguageModelV2FunctionTool[],
): string {
  const { system, transcript } = flattenPrompt(options.prompt);
  const toolInstructions = buildToolInstructions(tools);

  // When the caller asked for JSON output (responseFormat), nudge the model.
  const jsonHint =
    options.responseFormat?.type === 'json'
      ? 'Respond with a single valid JSON value only. Do not wrap it in markdown fences.'
      : '';

  const sections = [system, toolInstructions, jsonHint, transcript].filter(
    (s) => s && s.trim().length > 0,
  );
  // Trailing cue so the model continues as the assistant.
  return `${sections.join('\n\n')}\n\nAssistant:`;
}

/** Convert parsed ReAct calls into AI SDK tool-call content. */
function toToolCallContent(calls: ParsedToolCall[]): LanguageModelV2Content[] {
  return calls.map((call) => ({
    type: 'tool-call' as const,
    toolCallId: crypto.randomUUID(),
    toolName: call.toolName,
    // AI SDK expects the arguments as a stringified JSON object.
    input: JSON.stringify(call.args ?? {}),
  }));
}

// =============================================================================
// Model
// =============================================================================

export class DirectLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider: string;
  readonly modelId: string;

  // The web transports fetch and inline any URLs themselves; advertise none as
  // natively-supported so the AI SDK downloads + inlines attachments for us.
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly transport: DirectTransport;
  private readonly thinking: boolean;

  constructor(options: DirectLanguageModelOptions) {
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.transport = options.transport;
    // `*-thinking` model IDs default reasoning on; explicit flag wins.
    this.thinking = options.thinking ?? /thinking|reasoner/i.test(options.modelId);
  }

  async doGenerate(
    options: LanguageModelV2CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const tools = functionToolsOnly(options);
    const prompt = assemblePrompt(options, tools);

    const result = await this.transport.generate({
      prompt,
      thinking: this.thinking,
      signal: options.abortSignal,
    });

    const { text, toolCalls } = parseToolCalls(result.text);
    const content: LanguageModelV2Content[] = [];

    if (result.reasoning && result.reasoning.trim().length > 0) {
      content.push({ type: 'reasoning', text: result.reasoning });
    }
    if (text.length > 0) {
      content.push({ type: 'text', text });
    }
    content.push(...toToolCallContent(toolCalls));

    const finishReason: LanguageModelV2FinishReason =
      toolCalls.length > 0 ? 'tool-calls' : 'stop';

    return {
      content,
      finishReason,
      usage: buildUsage(prompt, result.text),
      warnings: [],
    };
  }

  async doStream(
    options: LanguageModelV2CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const tools = functionToolsOnly(options);
    const prompt = assemblePrompt(options, tools);
    const thinking = this.thinking;
    const transport = this.transport;

    // When tools are exposed we must inspect the FULL reply before deciding what
    // is prose vs. a tool-call block, so we cannot forward raw deltas (they would
    // leak `<tool_call>` markup to the UI). Stream live only when toolless.
    const streamLive = tools.length === 0;

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });

        const textId = crypto.randomUUID();
        let textStarted = false;
        const ensureTextStarted = () => {
          if (!textStarted) {
            controller.enqueue({ type: 'text-start', id: textId });
            textStarted = true;
          }
        };

        try {
          const result = await transport.generate({
            prompt,
            thinking,
            signal: options.abortSignal,
            onText: streamLive
              ? (delta) => {
                  ensureTextStarted();
                  controller.enqueue({ type: 'text-delta', id: textId, delta });
                }
              : undefined,
          });

          const { text, toolCalls } = parseToolCalls(result.text);

          if (streamLive) {
            // Deltas already emitted; just close the text block.
            if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
          } else if (text.length > 0) {
            // Buffered path: emit the cleaned prose as one block.
            ensureTextStarted();
            controller.enqueue({ type: 'text-delta', id: textId, delta: text });
            controller.enqueue({ type: 'text-end', id: textId });
          }

          for (const call of toolCalls) {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: crypto.randomUUID(),
              toolName: call.toolName,
              input: JSON.stringify(call.args ?? {}),
            });
          }

          controller.enqueue({
            type: 'finish',
            finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
            usage: buildUsage(prompt, result.text),
          });
          controller.close();
        } catch (error) {
          if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
          controller.enqueue({ type: 'error', error });
          controller.enqueue({
            type: 'finish',
            finishReason: 'error',
            usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
          });
          controller.close();
        }
      },
    });

    return { stream };
  }
}
