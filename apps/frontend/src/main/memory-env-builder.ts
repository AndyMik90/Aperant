/**
 * Memory Environment Variable Builder
 *
 * Converts app-wide memory settings from settings.json into environment variables
 * that can be injected into Python agent processes.
 *
 * This bridges the gap between frontend settings storage and backend configuration.
 */

import type { AppSettings } from '../shared/types/settings';
import { getMemoriesDir } from './config-paths';

/**
 * Build environment variables for memory/Graphiti configuration from app settings.
 *
 * @param settings - App-wide settings from settings.json
 * @returns Record of environment variables to inject into agent processes
 */
export function buildMemoryEnvVars(settings: AppSettings): Record<string, string> {
  const env: Record<string, string> = {};

  // If memory is not enabled, return empty env
  if (!settings.memoryEnabled) {
    return env;
  }

  // Enable Graphiti
  env.GRAPHITI_ENABLED = 'true';

  // Set database path and name (where LadybugDB stores data)
  env.GRAPHITI_DB_PATH = getMemoriesDir();
  env.GRAPHITI_DATABASE = 'ac_jerry_memory';

  // Set embedder provider (default to ollama)
  const embeddingProvider = settings.memoryEmbeddingProvider || 'ollama';
  env.GRAPHITI_EMBEDDER_PROVIDER = embeddingProvider;

  // Provider-specific configuration
  switch (embeddingProvider) {
    case 'ollama':
      env.OLLAMA_BASE_URL = settings.ollamaBaseUrl || 'http://localhost:11434';
      if (settings.memoryOllamaEmbeddingModel) {
        env.OLLAMA_EMBEDDING_MODEL = settings.memoryOllamaEmbeddingModel;
      }
      if (settings.memoryOllamaEmbeddingDim) {
        env.OLLAMA_EMBEDDING_DIM = String(settings.memoryOllamaEmbeddingDim);
      }
      break;

    case 'openai':
      if (settings.globalOpenAIApiKey) {
        env.OPENAI_API_KEY = settings.globalOpenAIApiKey;
      }
      break;

    case 'voyage':
      if (settings.memoryVoyageApiKey) {
        env.VOYAGE_API_KEY = settings.memoryVoyageApiKey;
      }
      break;

    case 'google':
      if (settings.globalGoogleApiKey) {
        env.GOOGLE_API_KEY = settings.globalGoogleApiKey;
      }
      break;

    case 'azure_openai':
      if (settings.memoryAzureApiKey) {
        env.AZURE_OPENAI_API_KEY = settings.memoryAzureApiKey;
      }
      if (settings.memoryAzureBaseUrl) {
        env.AZURE_OPENAI_BASE_URL = settings.memoryAzureBaseUrl;
      }
      if (settings.memoryAzureEmbeddingDeployment) {
        env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = settings.memoryAzureEmbeddingDeployment;
      }
      break;

    case 'openrouter':
      if (settings.globalOpenRouterApiKey) {
        env.OPENROUTER_API_KEY = settings.globalOpenRouterApiKey;
      }
      break;
  }

  return env;
}
