/**
 * AI Provider Types
 *
 * Defines supported AI providers and their configuration interfaces
 * for the Vercel AI SDK integration layer.
 */

/**
 * Supported AI provider identifiers.
 * Each maps to a Vercel AI SDK provider package.
 */
export const SupportedProvider = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'google',
  Bedrock: 'bedrock',
  Azure: 'azure',
  Mistral: 'mistral',
  Groq: 'groq',
  XAI: 'xai',
  OpenRouter: 'openrouter',
  ZAI: 'zai',
  MiniMax: 'minimax',
  Ollama: 'ollama',
} as const;

export type SupportedProvider = (typeof SupportedProvider)[keyof typeof SupportedProvider];

/**
 * Provider-specific configuration options.
 * Each provider may require different auth and endpoint settings.
 */
export interface ProviderConfig {
  /** Provider identifier */
  provider: SupportedProvider;
  /** API key or token for authentication */
  apiKey?: string;
  /** Custom base URL for the provider API */
  baseURL?: string;
  /** AWS region (for Bedrock) */
  region?: string;
  /** Azure deployment name */
  deploymentName?: string;
  /** Additional provider-specific headers */
  headers?: Record<string, string>;
  /** Pre-resolved path to OAuth token file for file-based OAuth providers (e.g., Codex) */
  oauthTokenFilePath?: string;
}

/**
 * Result of resolving a model shorthand to a full provider model configuration.
 */
export interface ModelResolution {
  /** The resolved full model ID (e.g., 'claude-sonnet-4-5-20250929') */
  modelId: string;
  /** The provider to use for this model */
  provider: SupportedProvider;
  /** Required beta headers (e.g., 1M context window) */
  betas: string[];
}

/**
 * Provider capability flags for feature detection.
 */
export interface ProviderCapabilities {
  /** Supports extended thinking / chain-of-thought */
  supportsThinking: boolean;
  /** Supports tool/function calling */
  supportsTools: boolean;
  /** Supports streaming responses */
  supportsStreaming: boolean;
  /** Supports image/vision inputs */
  supportsVision: boolean;
}
