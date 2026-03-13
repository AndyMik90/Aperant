import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: (n: number) => ({ type: 'stepCount', count: n }),
}));

const mockCreateSimpleClient = vi.fn();

vi.mock('../../client/factory', () => ({
  createSimpleClient: (...args: unknown[]) => mockCreateSimpleClient(...args),
}));

// Filesystem mocks — project context files are absent by default
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn();
const mockReaddirSync = vi.fn().mockReturnValue([]);

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// Mock tool registry
vi.mock('../../tools/build-registry', () => ({
  buildToolRegistry: () => ({
    getToolsForAgent: vi.fn().mockReturnValue({}),
  }),
}));

// json-repair is used for safeParseJson in the insights runner
vi.mock('../../../utils/json-repair', () => ({
  safeParseJson: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

// parseLLMJson is used for task suggestion extraction
vi.mock('../../schema/structured-output', () => ({
  parseLLMJson: vi.fn().mockReturnValue(null),
}));

vi.mock('../../schema/insight-extractor', () => ({
  TaskSuggestionSchema: {},
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { runInsightsQuery } from '../insights';
import type { InsightsConfig, InsightsStreamEvent } from '../insights';
import { parseLLMJson } from '../../schema/structured-output';

// =============================================================================
// Helpers
// =============================================================================

const fakeModel = { modelId: 'claude-sonnet-test' };

function makeMockClient(systemPrompt = 'You are an AI assistant.') {
  return {
    model: fakeModel,
    systemPrompt,
    tools: {},
    maxSteps: 30,
  };
}

function makeStream(parts: Array<Record<string, unknown>>) {
  return {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
  };
}

function baseConfig(overrides: Partial<InsightsConfig> = {}): InsightsConfig {
  return {
    projectDir: '/project',
    message: 'How does authentication work?',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('runInsightsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSimpleClient.mockResolvedValue(makeMockClient());
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    vi.mocked(parseLLMJson).mockReturnValue(null);
  });

  // ---------------------------------------------------------------------------
  // Successful run — no streaming events needed from caller
  // ---------------------------------------------------------------------------

  it('returns response text accumulated from stream', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        { type: 'text-delta', text: 'Authentication uses JWT tokens.' },
        { type: 'text-delta', text: ' Tokens expire after 1 hour.' },
      ]),
    );

    const result = await runInsightsQuery(baseConfig());

    expect(result.text).toBe('Authentication uses JWT tokens. Tokens expire after 1 hour.');
    expect(result.taskSuggestion).toBeNull();
    expect(result.toolCalls).toEqual([]);
  });

  it('returns empty text and no task suggestion when stream is empty', async () => {
    mockStreamText.mockReturnValue(makeStream([]));

    const result = await runInsightsQuery(baseConfig());

    expect(result.text).toBe('');
    expect(result.taskSuggestion).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Task suggestion extraction
  // ---------------------------------------------------------------------------

  it('extracts task suggestion from response text when marker present', async () => {
    const suggestion = {
      title: 'Add rate limiting',
      description: 'Implement per-user rate limiting on auth endpoints',
      metadata: { category: 'security', complexity: 'medium', impact: 'high' },
    };

    mockStreamText.mockReturnValue(
      makeStream([
        {
          type: 'text-delta',
          text: `Here is my suggestion.\n__TASK_SUGGESTION__:${JSON.stringify(suggestion)}\n`,
        },
      ]),
    );

    vi.mocked(parseLLMJson).mockReturnValueOnce(suggestion as unknown as ReturnType<typeof parseLLMJson>);

    const result = await runInsightsQuery(baseConfig());

    expect(result.taskSuggestion).not.toBeNull();
    expect(result.taskSuggestion?.title).toBe('Add rate limiting');
    expect(result.taskSuggestion?.metadata.category).toBe('security');
  });

  it('returns null taskSuggestion when no marker in response', async () => {
    mockStreamText.mockReturnValue(
      makeStream([{ type: 'text-delta', text: 'No suggestions here.' }]),
    );

    const result = await runInsightsQuery(baseConfig());

    expect(result.taskSuggestion).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Tool call tracking
  // ---------------------------------------------------------------------------

  it('tracks tool calls in result.toolCalls', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        { type: 'tool-call', toolName: 'Read', toolCallId: 'c1', input: { file_path: 'src/auth.ts' } },
        { type: 'tool-result', toolCallId: 'c1', toolName: 'Read', output: 'file content' },
        { type: 'tool-call', toolName: 'Glob', toolCallId: 'c2', input: { pattern: '**/*.ts' } },
        { type: 'tool-result', toolCallId: 'c2', toolName: 'Glob', output: 'src/auth.ts' },
      ]),
    );

    const result = await runInsightsQuery(baseConfig());

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('Read');
    expect(result.toolCalls[1].name).toBe('Glob');
  });

  it('extracts file_path from Read tool call input', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        {
          type: 'tool-call',
          toolName: 'Read',
          toolCallId: 'c1',
          input: { file_path: 'src/auth.ts' },
        },
      ]),
    );

    const result = await runInsightsQuery(baseConfig());

    expect(result.toolCalls[0].input).toBe('src/auth.ts');
  });

  it('extracts pattern from Grep/Glob tool call input', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        {
          type: 'tool-call',
          toolName: 'Grep',
          toolCallId: 'c1',
          input: { pattern: 'useAuth' },
        },
      ]),
    );

    const result = await runInsightsQuery(baseConfig());

    expect(result.toolCalls[0].input).toBe('pattern: useAuth');
  });

  // ---------------------------------------------------------------------------
  // Stream callbacks
  // ---------------------------------------------------------------------------

  it('forwards text-delta events to onStream callback', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        { type: 'text-delta', text: 'chunk1' },
        { type: 'text-delta', text: 'chunk2' },
      ]),
    );

    const events: InsightsStreamEvent[] = [];
    await runInsightsQuery(baseConfig(), (e) => events.push(e));

    const textEvents = events.filter((e) => e.type === 'text-delta');
    expect(textEvents).toHaveLength(2);
  });

  it('forwards tool-start events for tool-call stream parts', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        { type: 'tool-call', toolName: 'Grep', toolCallId: 'c1', input: { pattern: 'login' } },
      ]),
    );

    const events: InsightsStreamEvent[] = [];
    await runInsightsQuery(baseConfig(), (e) => events.push(e));

    const toolStartEvents = events.filter((e) => e.type === 'tool-start');
    expect(toolStartEvents).toHaveLength(1);
    expect((toolStartEvents[0] as { type: 'tool-start'; name: string }).name).toBe('Grep');
  });

  it('forwards tool-end events for tool-result stream parts', async () => {
    mockStreamText.mockReturnValue(
      makeStream([
        { type: 'tool-result', toolCallId: 'c1', toolName: 'Read', output: 'content' },
      ]),
    );

    const events: InsightsStreamEvent[] = [];
    await runInsightsQuery(baseConfig(), (e) => events.push(e));

    const toolEndEvents = events.filter((e) => e.type === 'tool-end');
    expect(toolEndEvents).toHaveLength(1);
  });

  it('forwards error events for error stream parts', async () => {
    mockStreamText.mockReturnValue(
      makeStream([{ type: 'error', error: new Error('tool failed') }]),
    );

    const events: InsightsStreamEvent[] = [];
    await runInsightsQuery(baseConfig(), (e) => events.push(e));

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as { type: 'error'; error: string }).error).toBe('tool failed');
  });

  // ---------------------------------------------------------------------------
  // Error propagation
  // ---------------------------------------------------------------------------

  it('rethrows when streamText iteration throws', async () => {
    mockStreamText.mockReturnValue({
      // biome-ignore lint/correctness/useYield: intentionally throwing before yield to test error path
      fullStream: (async function* () {
        throw new Error('API timeout');
      })(),
    });

    await expect(runInsightsQuery(baseConfig())).rejects.toThrow('API timeout');
  });

  it('emits error event to callback before rethrowing', async () => {
    mockStreamText.mockReturnValue({
      // biome-ignore lint/correctness/useYield: intentionally throwing before yield to test error path
      fullStream: (async function* () {
        throw new Error('rate limited');
      })(),
    });

    const events: InsightsStreamEvent[] = [];
    await expect(runInsightsQuery(baseConfig(), (e) => events.push(e))).rejects.toThrow(
      'rate limited',
    );

    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Client configuration
  // ---------------------------------------------------------------------------

  it('uses sonnet model and medium thinking level by default', async () => {
    mockStreamText.mockReturnValue(makeStream([]));

    await runInsightsQuery(baseConfig());

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('sonnet');
    expect(clientArgs.thinkingLevel).toBe('medium');
  });

  it('accepts custom modelShorthand and thinkingLevel', async () => {
    mockStreamText.mockReturnValue(makeStream([]));

    await runInsightsQuery(baseConfig({ modelShorthand: 'haiku', thinkingLevel: 'low' }));

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('haiku');
    expect(clientArgs.thinkingLevel).toBe('low');
  });

  // ---------------------------------------------------------------------------
  // History handling
  // ---------------------------------------------------------------------------

  it('includes conversation history in the prompt when provided', async () => {
    mockStreamText.mockReturnValue(makeStream([]));

    await runInsightsQuery(
      baseConfig({
        message: 'What about refresh tokens?',
        history: [
          { role: 'user', content: 'How does auth work?' },
          { role: 'assistant', content: 'It uses JWT.' },
        ],
      }),
    );

    const callArgs = mockStreamText.mock.calls[0][0];
    const prompt = callArgs.prompt as string;
    expect(prompt).toContain('How does auth work?');
    expect(prompt).toContain('It uses JWT.');
    expect(prompt).toContain('What about refresh tokens?');
  });

  it('uses message directly as prompt when history is empty', async () => {
    mockStreamText.mockReturnValue(makeStream([]));

    await runInsightsQuery(baseConfig({ message: 'What is the entry point?' }));

    const callArgs = mockStreamText.mock.calls[0][0];
    expect(callArgs.prompt).toBe('What is the entry point?');
  });
});
