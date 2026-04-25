/**
 * Tests for Provider Factory
 *
 * Validates provider instantiation, detection, and error handling.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../settings-utils', () => ({
  readSettingsFile: vi.fn(),
}));

// Mock all @ai-sdk/* providers
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'openai' }));
    (provider as any).chat = vi.fn((modelId: string) => ({ modelId, provider: 'openai-chat' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'google' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'bedrock' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'azure' }));
    (provider as any).chat = vi.fn((modelId: string) => ({ modelId, provider: 'azure-chat' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/mistral', () => ({
  createMistral: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'mistral' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/groq', () => ({
  createGroq: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'groq' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'xai' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'ollama' }));
    return provider;
  }),
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'openrouter' }));
    return provider;
  }),
}));

import { createAnthropic } from '@ai-sdk/anthropic';
import { createProvider, detectProviderFromModel, createProviderFromModelId, resetFallbackProviderCache } from '../factory';
import { SupportedProvider } from '../types';
import { readSettingsFile } from '../../../settings-utils';

const mockReadSettingsFile = vi.mocked(readSettingsFile);

describe('createProvider', () => {
  const allProviders = Object.values(SupportedProvider);

  it.each(allProviders)('creates a model instance for provider: %s', (provider) => {
    const result = createProvider({
      config: { provider, apiKey: 'test-key' },
      modelId: 'test-model',
    });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('modelId');
  });

  it('uses .chat() for OpenAI provider', () => {
    const result = createProvider({
      config: { provider: SupportedProvider.OpenAI, apiKey: 'test-key' },
      modelId: 'gpt-4o',
    }) as any;
    expect(result.provider).toBe('openai-chat');
  });

  it('uses .chat() with deploymentName for Azure provider', () => {
    const result = createProvider({
      config: { provider: SupportedProvider.Azure, apiKey: 'test-key', deploymentName: 'my-deploy' },
      modelId: 'gpt-4o',
    }) as any;
    expect(result.provider).toBe('azure-chat');
    expect(result.modelId).toBe('my-deploy');
  });

  it('Azure falls back to modelId when no deploymentName', () => {
    const result = createProvider({
      config: { provider: SupportedProvider.Azure, apiKey: 'test-key' },
      modelId: 'gpt-4o',
    }) as any;
    expect(result.modelId).toBe('gpt-4o');
  });

  it('passes custom baseURL and headers to provider', () => {
    createProvider({
      config: {
        provider: SupportedProvider.Anthropic,
        apiKey: 'sk-test',
        baseURL: 'https://custom.api.com',
        headers: { 'X-Custom': 'value' },
      },
      modelId: 'claude-sonnet-4-5-20250929',
    });
    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://custom.api.com',
      headers: { 'X-Custom': 'value' },
    });
  });
});

describe('getConfiguredFallbackProvider (via detectProviderFromModel without explicit fallback)', () => {
  beforeEach(() => {
    resetFallbackProviderCache();
    mockReadSettingsFile.mockReset();
  });

  it('returns configured fallback when fallbackProviderId is a valid provider', () => {
    mockReadSettingsFile.mockReturnValue({ fallbackProviderId: SupportedProvider.OpenAI });
    expect(detectProviderFromModel('any/model')).toBe(SupportedProvider.OpenAI);
  });

  it('defaults to openrouter when fallbackProviderId is invalid', () => {
    mockReadSettingsFile.mockReturnValue({ fallbackProviderId: 'not-a-real-provider' });
    expect(detectProviderFromModel('any/model')).toBe(SupportedProvider.OpenRouter);
  });

  it('defaults to openrouter when readSettingsFile throws', () => {
    mockReadSettingsFile.mockImplementation(() => { throw new Error('disk error'); });
    expect(detectProviderFromModel('any/model')).toBe(SupportedProvider.OpenRouter);
  });

  it('defaults to openrouter when no fallbackProviderId is set', () => {
    mockReadSettingsFile.mockReturnValue({});
    expect(detectProviderFromModel('any/model')).toBe(SupportedProvider.OpenRouter);
  });
});

describe('detectProviderFromModel', () => {
  it('detects Anthropic from claude- prefix', () => {
    expect(detectProviderFromModel('claude-sonnet-4-5-20250929')).toBe('anthropic');
  });

  it('detects OpenAI from gpt- prefix', () => {
    expect(detectProviderFromModel('gpt-4o')).toBe('openai');
  });

  it('detects OpenAI from o1- prefix', () => {
    expect(detectProviderFromModel('o1-preview')).toBe('openai');
  });

  it('detects Google from gemini- prefix', () => {
    expect(detectProviderFromModel('gemini-pro')).toBe('google');
  });

  it('detects Groq from llama- prefix', () => {
    expect(detectProviderFromModel('llama-3.1-70b')).toBe('groq');
  });

  it('detects XAI from grok- prefix', () => {
    expect(detectProviderFromModel('grok-2')).toBe('xai');
  });

  it('returns undefined for unknown model', () => {
    expect(detectProviderFromModel('unknown-model')).toBeUndefined();
  });

  it('routes slash-format models to the explicit fallback provider', () => {
    expect(detectProviderFromModel('anthropic/claude-sonnet-4-5', 'openrouter')).toBe('openrouter');
    expect(detectProviderFromModel('deepseek/deepseek-chat', 'openrouter')).toBe('openrouter');
    expect(detectProviderFromModel('meta-llama/llama-3.3-70b', 'openrouter')).toBe('openrouter');
  });

  it('routes slash-format models to a custom fallback provider when specified', () => {
    expect(detectProviderFromModel('any-provider/any-model', 'anthropic')).toBe('anthropic');
    expect(detectProviderFromModel('some/model', 'openai')).toBe('openai');
  });

  it('native prefixes take priority over slash fallback', () => {
    expect(detectProviderFromModel('claude-sonnet-4-6', 'openrouter')).toBe('anthropic');
    expect(detectProviderFromModel('gpt-4o', 'openrouter')).toBe('openai');
  });
});

describe('createProviderFromModelId', () => {
  it('creates a model with auto-detected provider', () => {
    const result = createProviderFromModelId('claude-sonnet-4-5-20250929') as any;
    expect(result).toBeDefined();
    expect(result.modelId).toBe('claude-sonnet-4-5-20250929');
  });

  it('throws for unrecognized model ID', () => {
    expect(() => createProviderFromModelId('unknown-model-xyz')).toThrow(
      'Cannot detect provider for model "unknown-model-xyz"',
    );
  });

  it('passes overrides to the provider config', () => {
    createProviderFromModelId('claude-sonnet-4-5-20250929', {
      apiKey: 'override-key',
      baseURL: 'https://override.com',
    });
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'override-key',
        baseURL: 'https://override.com',
      }),
    );
  });
});
