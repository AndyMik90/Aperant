/**
 * AI Auth Types
 *
 * Authentication types for the Vercel AI SDK integration layer.
 * Supports multi-stage credential resolution with fallback chains
 * across OAuth tokens, API keys, and environment variables.
 */

import type { SupportedProvider } from '../providers/types';
import type { ReasoningConfig } from '../../../shared/constants/models';

// ============================================
// Auth Source Tracking
// ============================================

/**
 * Identifies the source of a resolved credential.
 * Used for diagnostics and priority ordering.
 */
export type AuthSource =
  | 'profile-oauth'       // OAuth token from claude-profile credential store
  | 'codex-oauth'         // OAuth token from OpenAI Codex PKCE flow
  | 'profile-api-key'     // API key stored in profile settings
  | 'environment'         // Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
  | 'default'             // Default provider credentials (e.g., built-in defaults)
  | 'none';               // No credentials found

// ============================================
// Resolved Credentials
// ============================================

/**
 * A resolved authentication credential ready for use with a provider.
 */
export interface ResolvedAuth {
  /** The API key or OAuth token */
  apiKey: string;
  /** Where this credential came from */
  source: AuthSource;
  /** Optional custom base URL (from profile or environment) */
  baseURL?: string;
  /** Optional additional headers (e.g., auth tokens for proxies) */
  headers?: Record<string, string>;
  /** Pre-resolved path to OAuth token file for file-based OAuth providers (e.g., Codex) */
  oauthTokenFilePath?: string;
}

// ============================================
// Auth Resolution Context
// ============================================

/**
 * Context provided to the auth resolver to determine which credentials to use.
 */
export interface AuthResolverContext {
  /** Target provider for this request */
  provider: SupportedProvider;
  /** Optional profile ID (for multi-profile credential lookup) */
  profileId?: string;
  /** Optional CLAUDE_CONFIG_DIR for profile-specific keychain lookup */
  configDir?: string;
  /** Abort signal for cancellation during credential resolution */
  abortSignal?: AbortSignal;
}

// ============================================
// Provider Environment Variable Mapping
// ============================================

/**
 * Maps each provider to its environment variable name for API key lookup.
 */
export const PROVIDER_ENV_VARS: Record<SupportedProvider, string | undefined> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  bedrock: undefined,  // Uses AWS credential chain, not a single env var
  azure: 'AZURE_OPENAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  zai: 'ZHIPU_API_KEY',
  ollama: undefined,   // No auth required for local Ollama
} as const;

/**
 * Maps each provider to the settings field name for global API keys.
 * These correspond to fields in AppSettings (src/shared/types/settings.ts).
 */
export const PROVIDER_SETTINGS_KEY: Partial<Record<SupportedProvider, string>> = {
  anthropic: 'globalAnthropicApiKey',
  openai: 'globalOpenAIApiKey',
  google: 'globalGoogleApiKey',
  groq: 'globalGroqApiKey',
  mistral: 'globalMistralApiKey',
  xai: 'globalXAIApiKey',
  azure: 'globalAzureApiKey',
  openrouter: 'globalOpenRouterApiKey',
  zai: 'globalZAIApiKey',
} as const;

/**
 * Maps provider to the base URL environment variable (if applicable).
 */
export const PROVIDER_BASE_URL_ENV: Partial<Record<SupportedProvider, string>> = {
  anthropic: 'ANTHROPIC_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  azure: 'AZURE_OPENAI_ENDPOINT',
} as const;

// ============================================
// Queue-Based Resolution Types
// ============================================

/**
 * Extended auth result from the global priority queue.
 * Includes model + reasoning mapping for cross-provider fallback.
 */
export interface QueueResolvedAuth extends ResolvedAuth {
  /** The account ID from the priority queue */
  accountId: string;
  /** The resolved provider for this account */
  resolvedProvider: SupportedProvider;
  /** The resolved model ID for this provider (from equivalence mapping) */
  resolvedModelId: string;
  /** Reasoning configuration for this model on this provider */
  reasoningConfig: ReasoningConfig;
}
