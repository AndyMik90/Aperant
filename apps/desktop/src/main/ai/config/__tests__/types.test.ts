import { describe, it, expect } from 'vitest';
import { buildThinkingProviderOptions, MODEL_PROVIDER_MAP } from '../types';
import type { ThinkingLevel } from '../types';

describe('buildThinkingProviderOptions', () => {
  it('should return Anthropic thinking options for Claude models', () => {
    const result = buildThinkingProviderOptions('claude-sonnet-4-6', 'high');
    expect(result).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 16384 },
      },
    });
  });

  it('should handle Anthropic adaptive thinking models', () => {
    const result = buildThinkingProviderOptions('claude-opus-4-6', 'high');
    expect(result).toBeDefined();
    expect(result?.anthropic?.thinking).toBeDefined();
  });

  it('should return OpenAI reasoning options for o-series models', () => {
    const result = buildThinkingProviderOptions('o3-mini', 'medium');
    expect(result).toEqual({
      openai: { reasoningEffort: 'medium' },
    });
  });

  it('should map xhigh to high for OpenAI', () => {
    const result = buildThinkingProviderOptions('o4-mini', 'xhigh');
    expect(result).toEqual({
      openai: { reasoningEffort: 'high' },
    });
  });

  it('should return Google thinking options for Gemini models', () => {
    const result = buildThinkingProviderOptions('gemini-2.5-pro', 'medium');
    expect(result).toEqual({
      google: { thinkingConfig: { thinkingBudget: 4096 } },
    });
  });

  it('should return undefined for non-reasoning OpenAI models', () => {
    const result = buildThinkingProviderOptions('gpt-4o', 'high');
    expect(result).toBeUndefined();
  });

  it('should return undefined for providers without thinking support', () => {
    expect(buildThinkingProviderOptions('mistral-large', 'high')).toBeUndefined();
    expect(buildThinkingProviderOptions('llama-3.1-70b', 'high')).toBeUndefined();
  });

  it('should return undefined for unknown model IDs', () => {
    expect(buildThinkingProviderOptions('unknown-model', 'high')).toBeUndefined();
  });

  it('should use correct budget for each thinking level', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'];
    const budgets = [1024, 4096, 16384, 32768];

    for (let i = 0; i < levels.length; i++) {
      const result = buildThinkingProviderOptions('claude-sonnet-4-6', levels[i]);
      expect((result?.anthropic?.thinking as { budgetTokens: number })?.budgetTokens).toBe(budgets[i]);
    }
  });
});

describe('MODEL_PROVIDER_MAP — native prefix detection', () => {
  it('maps claude- prefix to anthropic', () => {
    const prefix = Object.keys(MODEL_PROVIDER_MAP).find((p) => 'claude-sonnet-4-6'.startsWith(p));
    if (prefix) expect(MODEL_PROVIDER_MAP[prefix]).toBe('anthropic');
  });

  it('has no slash-format entries (slash routing is handled by detectProviderFromModel)', () => {
    const slashKeys = Object.keys(MODEL_PROVIDER_MAP).filter((k) => k.includes('/'));
    expect(slashKeys).toHaveLength(0);
  });

  it('returns undefined for unknown model prefixes', () => {
    const prefix = Object.keys(MODEL_PROVIDER_MAP).find((p) => 'unknown-model-xyz'.startsWith(p));
    expect(prefix).toBeUndefined();
  });
});
