/**
 * Direct Provider Factory
 * =======================
 *
 * Builds a callable provider — `(modelId) => DirectLanguageModel` — mirroring
 * the shape of the `@ai-sdk/*` provider instances so it slots into the existing
 * `createProvider()` factory generic path with no special-casing.
 *
 * Model IDs routed here:
 *   - `deepseek`            → DeepSeek transport, reasoning off
 *   - `deepseek-thinking`   → DeepSeek transport, reasoning on
 *   - `chatgpt`             → ChatGPT (Playwright) transport
 *
 * The DeepSeek web token is carried on `ProviderConfig.apiKey` (the same slot
 * every other provider uses for its credential), so the generic auth-resolution
 * path needs no direct-specific branch.
 */

import { DirectLanguageModel } from './direct-language-model';
import { createChatGPTTransport, createDeepSeekTransport } from './transport';

/** Provider label surfaced in telemetry/logs. */
export const DIRECT_PROVIDER_NAME = 'direct';

/** Model IDs the direct provider understands. */
export const DIRECT_MODEL_IDS = ['deepseek', 'deepseek-thinking', 'chatgpt'] as const;
export type DirectModelId = (typeof DIRECT_MODEL_IDS)[number];

export interface CreateDirectProviderOptions {
  /** DeepSeek web token (from Settings → Direct AI Connection). */
  apiKey?: string;
  /** Per-call timeout forwarded to the DeepSeek transport. */
  timeoutMs?: number;
}

/** A callable provider instance, matching the @ai-sdk/* provider call shape. */
export type DirectProvider = (modelId: string) => DirectLanguageModel;

/**
 * Create a direct provider. The returned function builds a `DirectLanguageModel`
 * for the requested model ID, selecting the DeepSeek or ChatGPT transport.
 */
export function createDirectProvider(
  options: CreateDirectProviderOptions = {},
): DirectProvider {
  const getToken = () => options.apiKey ?? '';

  return (modelId: string): DirectLanguageModel => {
    const isChatGpt = modelId.startsWith('chatgpt');

    const transport = isChatGpt
      ? createChatGPTTransport()
      : createDeepSeekTransport({ getToken, timeoutMs: options.timeoutMs });

    return new DirectLanguageModel({
      provider: DIRECT_PROVIDER_NAME,
      modelId,
      transport,
    });
  };
}
