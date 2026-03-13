import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ type: 'object', schema }),
  },
}));

const mockCreateSimpleClient = vi.fn();

vi.mock('../../client/factory', () => ({
  createSimpleClient: (...args: unknown[]) => mockCreateSimpleClient(...args),
}));

// Mock schema/structured-output so we don't need the actual implementation
vi.mock('../../schema/structured-output', () => ({
  parseLLMJson: vi.fn().mockReturnValue(null),
}));

// Mock the Zod schemas used by the runner
vi.mock('../../schema/insight-extractor', () => ({
  ExtractedInsightsSchema: {},
}));

vi.mock('../../schema/output', () => ({
  ExtractedInsightsOutputSchema: {},
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { extractSessionInsights } from '../insight-extractor';
import type { InsightExtractionConfig } from '../insight-extractor';
import { parseLLMJson } from '../../schema/structured-output';

// =============================================================================
// Helpers
// =============================================================================

const fakeModel = { modelId: 'claude-haiku-test' };

function makeMockClient() {
  return { model: fakeModel, systemPrompt: 'You are an expert code analyst.' };
}

function makeValidOutput() {
  return {
    file_insights: [{ file: 'src/app.ts', insight: 'Uses singleton pattern', category: 'pattern' }],
    patterns_discovered: ['Singleton pattern used'],
    gotchas_discovered: ['Must call init() before use'],
    approach_outcome: {
      success: true,
      approach_used: 'Direct refactor',
      why_it_worked: 'Simplified the module',
      why_it_failed: null,
      alternatives_tried: [],
    },
    recommendations: ['Add unit tests for singleton'],
  };
}

function baseConfig(overrides: Partial<InsightExtractionConfig> = {}): InsightExtractionConfig {
  return {
    subtaskId: 'sub-001',
    subtaskDescription: 'Refactor authentication module',
    sessionNum: 1,
    success: true,
    diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  return token;',
    changedFiles: ['src/auth.ts'],
    commitMessages: 'refactor: simplify auth module',
    attemptHistory: [],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('extractSessionInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSimpleClient.mockResolvedValue(makeMockClient());
    // By default, result.output contains the structured data (constrained decoding path)
    mockGenerateText.mockResolvedValue({
      output: makeValidOutput(),
      text: '',
    });
  });

  // ---------------------------------------------------------------------------
  // Successful extraction via result.output (constrained decoding)
  // ---------------------------------------------------------------------------

  it('returns extracted insights from result.output when available', async () => {
    const result = await extractSessionInsights(baseConfig());

    expect(result.subtask_id).toBe('sub-001');
    expect(result.session_num).toBe(1);
    expect(result.success).toBe(true);
    expect(result.changed_files).toEqual(['src/auth.ts']);
    expect(result.file_insights).toHaveLength(1);
    expect(result.file_insights[0].file).toBe('src/app.ts');
    expect(result.patterns_discovered).toContain('Singleton pattern used');
    expect(result.gotchas_discovered).toContain('Must call init() before use');
    expect(result.recommendations).toContain('Add unit tests for singleton');
  });

  it('populates approach_outcome from result.output', async () => {
    const result = await extractSessionInsights(baseConfig());

    expect(result.approach_outcome.success).toBe(true);
    expect(result.approach_outcome.approach_used).toBe('Direct refactor');
    expect(result.approach_outcome.why_it_worked).toBe('Simplified the module');
    expect(result.approach_outcome.why_it_failed).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Fallback to parseLLMJson when result.output is absent
  // ---------------------------------------------------------------------------

  it('falls back to parseLLMJson when result.output is null/undefined', async () => {
    mockGenerateText.mockResolvedValue({
      output: null,
      text: JSON.stringify({
        file_insights: [{ file: 'src/login.ts', insight: 'Heavy coupling' }],
        patterns_discovered: ['MVC'],
        gotchas_discovered: [],
        approach_outcome: {
          success: false,
          approach_used: 'monkey-patch',
          why_it_worked: null,
          why_it_failed: 'Too hacky',
          alternatives_tried: [],
        },
        recommendations: [],
      }),
    });

    const parsedData = {
      file_insights: [{ file: 'src/login.ts', insight: 'Heavy coupling' }],
      patterns_discovered: ['MVC'],
      gotchas_discovered: [],
      approach_outcome: {
        success: false,
        approach_used: 'monkey-patch',
        why_it_worked: null,
        why_it_failed: 'Too hacky',
        alternatives_tried: [],
      },
      recommendations: [],
    };

    vi.mocked(parseLLMJson).mockReturnValueOnce(parsedData as unknown as ReturnType<typeof parseLLMJson>);

    const result = await extractSessionInsights(baseConfig({ success: false }));

    expect(result.file_insights[0].file).toBe('src/login.ts');
    expect(result.patterns_discovered).toContain('MVC');
    expect(result.approach_outcome.why_it_failed).toBe('Too hacky');
  });

  // ---------------------------------------------------------------------------
  // Generic fallback when both paths fail
  // ---------------------------------------------------------------------------

  it('returns generic insights when result.output is null and parseLLMJson returns null', async () => {
    mockGenerateText.mockResolvedValue({ output: null, text: 'not valid json' });
    vi.mocked(parseLLMJson).mockReturnValueOnce(null);

    const result = await extractSessionInsights(baseConfig({ subtaskId: 'sub-fallback', success: false }));

    expect(result.subtask_id).toBe('sub-fallback');
    expect(result.success).toBe(false);
    expect(result.file_insights).toEqual([]);
    expect(result.patterns_discovered).toEqual([]);
    expect(result.gotchas_discovered).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.approach_outcome.approach_used).toContain('sub-fallback');
  });

  it('returns generic insights when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('API unavailable'));

    const result = await extractSessionInsights(baseConfig({ subtaskId: 'sub-error', success: true }));

    expect(result.subtask_id).toBe('sub-error');
    expect(result.success).toBe(true);
    expect(result.file_insights).toEqual([]);
  });

  it('returns generic insights when createSimpleClient throws', async () => {
    mockCreateSimpleClient.mockRejectedValue(new Error('No credentials'));

    const result = await extractSessionInsights(baseConfig());

    expect(result.subtask_id).toBe('sub-001');
    expect(result.file_insights).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Never throws
  // ---------------------------------------------------------------------------

  it('never throws — always returns a valid InsightResult', async () => {
    mockGenerateText.mockRejectedValue(new Error('catastrophic failure'));

    await expect(extractSessionInsights(baseConfig())).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Client configuration
  // ---------------------------------------------------------------------------

  it('uses haiku model and low thinking level by default', async () => {
    await extractSessionInsights(baseConfig());

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('haiku');
    expect(clientArgs.thinkingLevel).toBe('low');
  });

  it('accepts custom modelShorthand and thinkingLevel', async () => {
    await extractSessionInsights(
      baseConfig({ modelShorthand: 'sonnet', thinkingLevel: 'medium' }),
    );

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('sonnet');
    expect(clientArgs.thinkingLevel).toBe('medium');
  });

  // ---------------------------------------------------------------------------
  // Prompt content validation
  // ---------------------------------------------------------------------------

  it('includes subtaskId and description in the prompt', async () => {
    await extractSessionInsights(
      baseConfig({
        subtaskId: 'my-task-42',
        subtaskDescription: 'Fix login regression',
      }),
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.prompt).toContain('my-task-42');
    expect(callArgs.prompt).toContain('Fix login regression');
  });

  it('truncates diff when it exceeds 15000 chars', async () => {
    const longDiff = '+' + 'a'.repeat(20_000);

    await extractSessionInsights(baseConfig({ diff: longDiff }));

    const callArgs = mockGenerateText.mock.calls[0][0];
    const prompt = callArgs.prompt as string;
    // The prompt must mention truncation and not contain all 20k chars of diff
    expect(prompt).toContain('truncated');
  });

  it('includes changed files in the prompt', async () => {
    await extractSessionInsights(
      baseConfig({ changedFiles: ['src/login.ts', 'src/session.ts'] }),
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.prompt).toContain('src/login.ts');
  });

  it('includes attempt history in the prompt when provided', async () => {
    await extractSessionInsights(
      baseConfig({
        attemptHistory: [
          { success: false, approach: 'patch method', error: 'type mismatch' },
          { success: true, approach: 'full rewrite' },
        ],
      }),
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.prompt).toContain('patch method');
    expect(callArgs.prompt).toContain('full rewrite');
  });

  it('passes output schema configuration to generateText', async () => {
    await extractSessionInsights(baseConfig());

    const callArgs = mockGenerateText.mock.calls[0][0];
    // The output key should be set (from Output.object())
    expect(callArgs).toHaveProperty('output');
  });
});
