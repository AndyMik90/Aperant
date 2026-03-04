/**
 * Provider Registry
 *
 * Creates a centralized provider registry using AI SDK v6's createProviderRegistry.
 * Enables unified model access via 'provider:model' string format.
 *
 * See apps/desktop/src/main/ai/providers/registry.ts for the TypeScript implementation.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createXai } from '@ai-sdk/xai';
import { createProviderRegistry } from 'ai';
import type { LanguageModel } from 'ai';
import type { ProviderV3 } from '@ai-sdk/provider';

import { type ProviderConfig, SupportedProvider } from './types';

// =============================================================================
// Registry Types
// =============================================================================

/** Configuration for building the provider registry */
export interface RegistryConfig {
  /** Map of provider ID to its configuration */
  providers: Partial<Record<SupportedProvider, Omit<ProviderConfig, 'provider'>>>;
}

// =============================================================================
// Provider Instance Creation (for registry)
// =============================================================================

/**
 * Creates a raw provider SDK instance for use in the registry.
 * Unlike factory.ts createProvider which returns a LanguageModel,
 * this returns the provider object itself for registry registration.
 */
function createProviderSDKInstance(
  provider: SupportedProvider,
  config: Omit<ProviderConfig, 'provider'>,
) {
  const { apiKey, baseURL, headers } = config;

  switch (provider) {
    case SupportedProvider.Anthropic:
      return createAnthropic({ apiKey, baseURL, headers });

    case SupportedProvider.OpenAI:
      return createOpenAI({ apiKey, baseURL, headers });

    case SupportedProvider.Google:
      return createGoogleGenerativeAI({ apiKey, baseURL, headers });

    case SupportedProvider.Bedrock:
      return createAmazonBedrock({ region: config.region ?? 'us-east-1', apiKey });

    case SupportedProvider.Azure:
      return createAzure({ apiKey, baseURL, headers });

    case SupportedProvider.Mistral:
      return createMistral({ apiKey, baseURL, headers });

    case SupportedProvider.Groq:
      return createGroq({ apiKey, baseURL, headers });

    case SupportedProvider.XAI:
      return createXai({ apiKey, baseURL, headers });

    case SupportedProvider.OpenRouter:
      return createOpenRouter({
        apiKey,
      });

    case SupportedProvider.ZAI:
      return createOpenAICompatible({
        name: 'zai',
        apiKey,
        baseURL: baseURL ?? 'https://api.z.ai/api/paas/v4',
        headers,
      });

    case SupportedProvider.Ollama: {
      // Account settings store the base Ollama URL (e.g., 'http://localhost:11434')
      // but the OpenAI-compatible SDK needs the /v1 path appended.
      let ollamaBaseURL = baseURL ?? 'http://localhost:11434';
      if (!ollamaBaseURL.endsWith('/v1')) {
        ollamaBaseURL = ollamaBaseURL.replace(/\/+$/, '') + '/v1';
      }
      return createOpenAICompatible({
        name: 'ollama',
        apiKey: apiKey ?? 'ollama',
        baseURL: ollamaBaseURL,
        headers,
      });
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

// =============================================================================
// Registry Creation
// =============================================================================

/**
 * Builds a provider registry from the given configuration.
 *
 * The returned registry supports unified model access via
 * `registry.languageModel('anthropic:claude-sonnet-4-5-20250929')`.
 *
 * @param config - Provider configurations keyed by provider ID
 * @returns A provider registry instance
 */
export function buildRegistry(config: RegistryConfig) {
  const providers: Record<string, ProviderV3> = {};

  for (const [providerKey, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig) {
      // Cast needed: some @ai-sdk/* providers (e.g., openai-compatible) use
      // Omit<ProviderV3, 'imageModel'> but are functionally compatible
      providers[providerKey] = createProviderSDKInstance(
        providerKey as SupportedProvider,
        providerConfig,
      ) as ProviderV3;
    }
  }

  return createProviderRegistry(providers);
}

// =============================================================================
// Model Resolution
// =============================================================================

/** Return type of buildRegistry */
export type ProviderRegistry = ReturnType<typeof buildRegistry>;

/**
 * Resolves a 'provider:model' string to a LanguageModel instance
 * using the given registry.
 *
 * @param registry - The provider registry to resolve from
 * @param providerAndModel - String in 'provider:model' format (e.g., 'anthropic:claude-sonnet-4-5-20250929')
 * @returns A configured LanguageModel instance
 * @throws If the provider or model is not found in the registry
 */
export function resolveModel(
  registry: ProviderRegistry,
  providerAndModel: `${string}:${string}`,
): LanguageModel {
  return registry.languageModel(providerAndModel);
}
