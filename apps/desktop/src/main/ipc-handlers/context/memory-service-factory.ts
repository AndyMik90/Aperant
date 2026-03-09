/**
 * Memory Service Factory
 *
 * Singleton factory for MemoryServiceImpl backed by libSQL.
 * Lazily initialized on first call; subsequent calls return the same instance.
 */

import { getMemoryClient } from '../../ai/memory/db';
import { EmbeddingService } from '../../ai/memory/embedding-service';
import type { EmbeddingConfig } from '../../ai/memory/embedding-service';
import { RetrievalPipeline } from '../../ai/memory/retrieval/pipeline';
import { Reranker } from '../../ai/memory/retrieval/reranker';
import { MemoryServiceImpl } from '../../ai/memory/memory-service';
import { readSettingsFile } from '../../settings-utils';

let _instance: MemoryServiceImpl | null = null;
let _initPromise: Promise<MemoryServiceImpl> | null = null;
let _embeddingProvider: string | null = null;

function buildEmbeddingConfig(): EmbeddingConfig | undefined {
  const settings = readSettingsFile();
  if (!settings?.memoryEmbeddingProvider) return undefined;
  return {
    provider: settings.memoryEmbeddingProvider as EmbeddingConfig['provider'],
    openaiApiKey: settings.globalOpenAIApiKey as string | undefined,
    openaiEmbeddingModel: settings.memoryOpenaiEmbeddingModel as string | undefined,
    googleApiKey: settings.globalGoogleApiKey as string | undefined,
    googleEmbeddingModel: settings.memoryGoogleEmbeddingModel as string | undefined,
    azureApiKey: settings.memoryAzureApiKey as string | undefined,
    azureBaseUrl: settings.memoryAzureBaseUrl as string | undefined,
    azureDeployment: settings.memoryAzureEmbeddingDeployment as string | undefined,
    voyageApiKey: settings.memoryVoyageApiKey as string | undefined,
    voyageModel: settings.memoryVoyageEmbeddingModel as string | undefined,
    ollamaBaseUrl: settings.ollamaBaseUrl as string | undefined,
    ollamaModel: settings.memoryOllamaEmbeddingModel as string | undefined,
  };
}

/**
 * Get or create the singleton MemoryServiceImpl.
 * Initialization is lazy and idempotent — safe to call from multiple places.
 */
export async function getMemoryService(): Promise<MemoryServiceImpl> {
  if (_instance) return _instance;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await getMemoryClient();
    const embeddingService = new EmbeddingService(db, buildEmbeddingConfig());
    await embeddingService.initialize();
    _embeddingProvider = embeddingService.getProvider();
    const reranker = new Reranker();
    await reranker.initialize();
    const pipeline = new RetrievalPipeline(db, embeddingService, reranker);
    _instance = new MemoryServiceImpl(db, embeddingService, pipeline);
    return _instance;
  })();

  return _initPromise;
}

/**
 * Get the detected embedding provider string (e.g. 'ollama-4b', 'openai', 'onnx').
 * Returns null if the service has not been initialized yet.
 */
export function getEmbeddingProvider(): string | null {
  return _embeddingProvider;
}

/**
 * Reset the singleton (e.g. for tests or after closing the DB).
 */
export function resetMemoryService(): void {
  _instance = null;
  _initPromise = null;
  _embeddingProvider = null;
}
