import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SessionConfig, SessionResult, StreamEvent } from '../types';

// =============================================================================
// Mock AI SDK
// =============================================================================

// Create controllable mock for streamText
const mockStreamText = vi.fn();
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}));

// Import after mocking
import { runAgentSession } from '../runner';
import type { RunnerOptions } from '../runner';

// =============================================================================
// Helpers
// =============================================================================

function createMockConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    agentType: 'coder',
    model: {} as SessionConfig['model'],
    systemPrompt: 'You are a helpful assistant.',
    initialMessages: [{ role: 'user', content: 'Hello' }],
    toolContext: {} as SessionConfig['toolContext'],
    maxSteps: 10,
    specDir: '/specs/001',
    projectDir: '/project',
    ...overrides,
  };
}

/**
 * Create a mock streamText result that yields the given parts.
 */
function createMockStreamResult(
  parts: Array<Record<string, unknown>>,
  options?: { text?: string; totalUsage?: { inputTokens: number; outputTokens: number } },
) {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
    text: Promise.resolve(options?.text ?? ''),
    totalUsage: Promise.resolve(
      options?.totalUsage ?? { inputTokens: 100, outputTokens: 50 },
    ),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('runAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Basic completion
  // ===========================================================================

  it('should return completed result for simple session', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult(
        [
          { type: 'text-delta', id: 'text-1', delta: 'Hello world' },
          {
            type: 'finish-step',
            usage: { inputTokens: 50, outputTokens: 25 },
          },
        ],
        { text: 'Hello world', totalUsage: { inputTokens: 50, outputTokens: 25 } },
      ),
    );

    const result = await runAgentSession(createMockConfig());

    expect(result.outcome).toBe('completed');
    expect(result.stepsExecuted).toBe(1);
    expect(result.usage.promptTokens).toBe(50);
    expect(result.usage.completionTokens).toBe(25);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.messages).toHaveLength(2); // initial + assistant response
  });

  // ===========================================================================
  // Max steps outcome
  // ===========================================================================

  it('should return max_steps when steps reach maxSteps', async () => {
    const steps = Array.from({ length: 10 }, (_) => ({
      type: 'finish-step',
      usage: { inputTokens: 10, outputTokens: 5 },
    }));

    mockStreamText.mockReturnValue(
      createMockStreamResult(steps, {
        text: 'done',
        totalUsage: { inputTokens: 100, outputTokens: 50 },
      }),
    );

    const result = await runAgentSession(createMockConfig({ maxSteps: 10 }));
    expect(result.outcome).toBe('max_steps');
    expect(result.stepsExecuted).toBe(10);
  });

  // ===========================================================================
  // Multi-step with tool calls
  // ===========================================================================

  it('should track tool calls across multiple steps', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult(
        [
          { type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', input: { command: 'ls' } },
          { type: 'tool-result', toolCallId: 'c1', toolName: 'Bash', input: { command: 'ls' }, output: 'file.ts' },
          {
            type: 'finish-step',
            usage: { promptTokens: 50, completionTokens: 25 },
          },
          { type: 'tool-call', toolName: 'Read', toolCallId: 'c2', input: { file_path: 'file.ts' } },
          { type: 'tool-result', toolCallId: 'c2', toolName: 'Read', input: { file_path: 'file.ts' }, output: 'content' },
          {
            type: 'finish-step',
            usage: { promptTokens: 50, completionTokens: 25 },
          },
        ],
        { text: 'Done', totalUsage: { inputTokens: 100, outputTokens: 50 } },
      ),
    );

    const result = await runAgentSession(createMockConfig());

    expect(result.outcome).toBe('completed');
    expect(result.stepsExecuted).toBe(2);
    expect(result.toolCallCount).toBe(2);
  });

  // ===========================================================================
  // Event callback
  // ===========================================================================

  it('should forward events to onEvent callback', async () => {
    const events: StreamEvent[] = [];

    mockStreamText.mockReturnValue(
      createMockStreamResult(
        [
          { type: 'text-delta', id: 'text-1', delta: 'hi' },
          {
            type: 'finish-step',
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
        { text: 'hi', totalUsage: { inputTokens: 10, outputTokens: 5 } },
      ),
    );

    await runAgentSession(createMockConfig(), {
      onEvent: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    expect(events.some((e) => e.type === 'step-finish')).toBe(true);
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  it('should classify rate limit errors', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('429 Too Many Requests');
    });

    const result = await runAgentSession(createMockConfig());

    expect(result.outcome).toBe('rate_limited');
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('rate_limited');
    expect(result.stepsExecuted).toBe(0);
  });

  it('should classify generic errors', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await runAgentSession(createMockConfig());

    expect(result.outcome).toBe('error');
    expect(result.error!.code).toBe('generic_error');
  });

  // ===========================================================================
  // Auth retry
  // ===========================================================================

  it('should retry on auth failure when onAuthRefresh succeeds', async () => {
    let callCount = 0;
    mockStreamText.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('401 Unauthorized');
      }
      return createMockStreamResult(
        [
          { type: 'text-delta', id: 'text-1', delta: 'ok' },
          {
            type: 'finish-step',
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
        { text: 'ok', totalUsage: { inputTokens: 10, outputTokens: 5 } },
      );
    });

    const onAuthRefresh = vi.fn().mockResolvedValue('new-token');

    const result = await runAgentSession(createMockConfig(), { onAuthRefresh });

    expect(onAuthRefresh).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('completed');
  });

  it('should return auth_failure when onAuthRefresh returns null', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('401 Unauthorized');
    });

    const result = await runAgentSession(createMockConfig(), {
      onAuthRefresh: vi.fn().mockResolvedValue(null),
    });

    expect(result.outcome).toBe('auth_failure');
  });

  it('should return auth_failure when no onAuthRefresh provided', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('401 Unauthorized');
    });

    const result = await runAgentSession(createMockConfig());

    expect(result.outcome).toBe('auth_failure');
  });

  // ===========================================================================
  // Cancellation
  // ===========================================================================

  it('should return cancelled when abortSignal fires during stream', async () => {
    const controller = new AbortController();

    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: 'text-1', delta: 'start' };
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      })(),
      text: Promise.resolve(''),
      totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
    });

    const result = await runAgentSession(
      createMockConfig({ abortSignal: controller.signal }),
    );

    expect(result.outcome).toBe('cancelled');
  });

  // ===========================================================================
  // streamText configuration
  // ===========================================================================

  it('should pass tools and system prompt to streamText', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    const tools = { Bash: {} as any };
    await runAgentSession(createMockConfig({ systemPrompt: 'Be helpful' }), { tools });

    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamText.mock.calls[0][0];
    expect(callArgs.system).toBe('Be helpful');
    expect(callArgs.tools).toBe(tools);
  });

  it('should use default maxSteps of 500 when not specified', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    const config = createMockConfig();
    // @ts-expect-error - testing undefined maxSteps behavior
    delete config.maxSteps;

    await runAgentSession(config);

    const callArgs = mockStreamText.mock.calls[0][0];
    expect(callArgs.stopWhen).toEqual({ type: 'stepCount', count: 500 });
  });

  // ===========================================================================
  // Reasoning / thinking_blocks sanitization (#1988)
  // ===========================================================================

  it('should strip reasoning parts from messages when provider is not Claude', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    const messagesWithReasoning = [
      { role: 'user' as const, content: 'Hello' },
      // Simulate an assistant message that contains reasoning parts (e.g. from a prior Claude session)
      {
        role: 'assistant' as const,
        content: [
          { type: 'reasoning', text: 'Let me think…' },
          { type: 'text', text: 'The answer is 42.' },
        ] as unknown as string,
      },
    ];

    // Non-Claude model — reasoning parts must be stripped
    await runAgentSession(
      createMockConfig({
        model: 'gpt-4o' as any,
        initialMessages: messagesWithReasoning,
      }),
    );

    const { messages } = mockStreamText.mock.calls[0][0];
    const assistantMsg = messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    // Content should be an array with only the text part
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const parts = assistantMsg.content as Array<{ type: string }>;
    expect(parts.every((p) => p.type !== 'reasoning')).toBe(true);
    expect(parts.some((p) => p.type === 'text')).toBe(true);
  });

  it('should preserve reasoning parts when provider is Claude', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    const messagesWithReasoning = [
      { role: 'user' as const, content: 'Hello' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'reasoning', text: 'Let me think…' },
          { type: 'text', text: 'The answer is 42.' },
        ] as unknown as string,
      },
    ];

    // Claude model — reasoning parts must be passed through unchanged
    await runAgentSession(
      createMockConfig({
        model: 'claude-sonnet-4-5' as any,
        initialMessages: messagesWithReasoning,
      }),
    );

    const { messages } = mockStreamText.mock.calls[0][0];
    const assistantMsg = messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const parts = assistantMsg.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === 'reasoning')).toBe(true);
  });

  it('should handle redacted-reasoning parts the same as reasoning for non-Claude providers', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    const messagesWithRedacted = [
      { role: 'user' as const, content: 'Hello' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'redacted-reasoning', data: 'encrypted…' },
          { type: 'text', text: 'Done.' },
        ] as unknown as string,
      },
    ];

    await runAgentSession(
      createMockConfig({
        model: 'gpt-4o' as any,
        initialMessages: messagesWithRedacted,
      }),
    );

    const { messages } = mockStreamText.mock.calls[0][0];
    const assistantMsg = messages.find((m: { role: string }) => m.role === 'assistant');
    const parts = assistantMsg.content as Array<{ type: string }>;
    expect(parts.every((p) => p.type !== 'redacted-reasoning')).toBe(true);
  });

  it('should not modify string content messages regardless of provider', async () => {
    mockStreamText.mockReturnValue(
      createMockStreamResult([], { text: '', totalUsage: { inputTokens: 0, outputTokens: 0 } }),
    );

    await runAgentSession(
      createMockConfig({
        model: 'gpt-4o' as any,
        initialMessages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there.' },
        ],
      }),
    );

    const { messages } = mockStreamText.mock.calls[0][0];
    const assistantMsg = messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg.content).toBe('Hi there.');
  });
});
