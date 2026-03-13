import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

const mockCreateSimpleClient = vi.fn();

vi.mock('../../client/factory', () => ({
  createSimpleClient: (...args: unknown[]) => mockCreateSimpleClient(...args),
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { resolveMergeConflict, createMergeResolverFn } from '../merge-resolver';
import type { MergeResolverConfig } from '../merge-resolver';

// =============================================================================
// Helpers
// =============================================================================

const fakeModel = { modelId: 'claude-haiku-test' };

function makeMockClient(systemPrompt = 'Resolve merge conflicts.') {
  return { model: fakeModel, systemPrompt };
}

function baseConfig(overrides: Partial<MergeResolverConfig> = {}): MergeResolverConfig {
  return {
    systemPrompt: 'You are a merge conflict resolver.',
    userPrompt: '<<<\nHEAD version\n===\nIncoming version\n>>>',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('resolveMergeConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSimpleClient.mockResolvedValue(makeMockClient());
  });

  // ---------------------------------------------------------------------------
  // Successful resolution
  // ---------------------------------------------------------------------------

  it('returns success with trimmed resolved text', async () => {
    mockGenerateText.mockResolvedValue({ text: '  Resolved: use incoming version.  ' });

    const result = await resolveMergeConflict(baseConfig());

    expect(result.success).toBe(true);
    expect(result.text).toBe('Resolved: use incoming version.');
    expect(result.error).toBeUndefined();
  });

  it('passes model and systemPrompt from client to generateText', async () => {
    mockGenerateText.mockResolvedValue({ text: 'merged code here' });

    await resolveMergeConflict(baseConfig());

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.model).toBe(fakeModel);
    expect(callArgs.system).toBe('Resolve merge conflicts.');
  });

  it('passes userPrompt as the prompt parameter to generateText', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    const conflict = '<<<\nmy change\n===\ntheir change\n>>>';
    await resolveMergeConflict(baseConfig({ userPrompt: conflict }));

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.prompt).toBe(conflict);
  });

  it('passes systemPrompt config to createSimpleClient', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    const customSystem = 'Custom system prompt.';
    await resolveMergeConflict(baseConfig({ systemPrompt: customSystem }));

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.systemPrompt).toBe(customSystem);
  });

  // ---------------------------------------------------------------------------
  // Default model / thinking level
  // ---------------------------------------------------------------------------

  it('uses haiku model and low thinking level by default', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    await resolveMergeConflict(baseConfig());

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('haiku');
    expect(clientArgs.thinkingLevel).toBe('low');
  });

  it('accepts custom modelShorthand and thinkingLevel', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    await resolveMergeConflict(
      baseConfig({ modelShorthand: 'sonnet', thinkingLevel: 'medium' }),
    );

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('sonnet');
    expect(clientArgs.thinkingLevel).toBe('medium');
  });

  // ---------------------------------------------------------------------------
  // Empty response handling
  // ---------------------------------------------------------------------------

  it('returns failure when LLM returns empty text', async () => {
    mockGenerateText.mockResolvedValue({ text: '   ' });

    const result = await resolveMergeConflict(baseConfig());

    expect(result.success).toBe(false);
    expect(result.text).toBe('');
    expect(result.error).toBe('Empty response from AI');
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('returns failure with error message when generateText throws Error', async () => {
    mockGenerateText.mockRejectedValue(new Error('API rate limit'));

    const result = await resolveMergeConflict(baseConfig());

    expect(result.success).toBe(false);
    expect(result.text).toBe('');
    expect(result.error).toBe('API rate limit');
  });

  it('returns failure with string coercion when non-Error is thrown', async () => {
    mockGenerateText.mockRejectedValue('connection refused');

    const result = await resolveMergeConflict(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBe('connection refused');
  });

  it('returns failure when createSimpleClient throws', async () => {
    mockCreateSimpleClient.mockRejectedValue(new Error('No auth token'));

    const result = await resolveMergeConflict(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBe('No auth token');
  });
});

// =============================================================================
// createMergeResolverFn
// =============================================================================

describe('createMergeResolverFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSimpleClient.mockResolvedValue(makeMockClient());
  });

  it('returns an async function', () => {
    const fn = createMergeResolverFn();
    expect(typeof fn).toBe('function');
  });

  it('returned function resolves to the resolved text on success', async () => {
    mockGenerateText.mockResolvedValue({ text: 'merged content' });

    const fn = createMergeResolverFn();
    const result = await fn('system context', 'conflict block');

    expect(result).toBe('merged content');
  });

  it('returned function resolves to empty string when LLM returns empty', async () => {
    mockGenerateText.mockResolvedValue({ text: '   ' });

    const fn = createMergeResolverFn();
    const result = await fn('system', 'conflict');

    expect(result).toBe('');
  });

  it('returned function resolves to empty string on error (does not throw)', async () => {
    mockGenerateText.mockRejectedValue(new Error('timeout'));

    const fn = createMergeResolverFn();
    const result = await fn('system', 'conflict');

    expect(result).toBe('');
  });

  it('uses provided modelShorthand and thinkingLevel', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    const fn = createMergeResolverFn('sonnet', 'medium');
    await fn('sys', 'user');

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('sonnet');
    expect(clientArgs.thinkingLevel).toBe('medium');
  });

  it('defaults to haiku and low when no arguments given', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    const fn = createMergeResolverFn();
    await fn('sys', 'user');

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.modelShorthand).toBe('haiku');
    expect(clientArgs.thinkingLevel).toBe('low');
  });

  it('passes system and user arguments as systemPrompt and userPrompt', async () => {
    mockGenerateText.mockResolvedValue({ text: 'resolved' });

    const fn = createMergeResolverFn();
    await fn('the system prompt', 'the conflict text');

    const clientArgs = mockCreateSimpleClient.mock.calls[0][0];
    expect(clientArgs.systemPrompt).toBe('the system prompt');
    const generateArgs = mockGenerateText.mock.calls[0][0];
    expect(generateArgs.prompt).toBe('the conflict text');
  });
});
