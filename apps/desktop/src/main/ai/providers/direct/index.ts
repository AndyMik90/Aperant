/**
 * Direct AI Provider
 * ==================
 *
 * Vercel AI SDK provider wrapping the free, no-API-key web transports from
 * `ai-providers-direct` (DeepSeek + ChatGPT). Lets every existing call site
 * (`streamText` / `generateText`) use the direct connection, with plain-text
 * ReAct emulation standing in for native tool calling.
 */

export { DirectLanguageModel } from './direct-language-model';
export type {
  DirectTransport,
  DirectGenerateOptions,
  DirectGenerateResult,
  DirectLanguageModelOptions,
} from './direct-language-model';

export {
  createDirectProvider,
  DIRECT_PROVIDER_NAME,
  DIRECT_MODEL_IDS,
} from './direct-provider';
export type { DirectProvider, DirectModelId, CreateDirectProviderOptions } from './direct-provider';

export { createDeepSeekTransport, createChatGPTTransport } from './transport';
export type { DeepSeekTransportOptions } from './transport';

export { flattenPrompt } from './prompt-flatten';
export { buildToolInstructions, parseToolCalls } from './tool-protocol';
