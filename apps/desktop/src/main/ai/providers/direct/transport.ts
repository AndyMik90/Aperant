/**
 * Library Transports
 * ==================
 *
 * Concrete `DirectTransport` implementations that bridge to the actual
 * `ai-providers-direct` web protocols. This is the ONLY module in the direct/
 * folder that imports the library, and it does so lazily (dynamic `import()`)
 * so the heavy runtime deps (WASM proof-of-work solver, Playwright headless
 * Chrome) are never loaded unless a direct model is actually invoked — and so
 * the pure model/parser modules stay free of bundling concerns.
 *
 * Statelessness: the Vercel AI SDK resends the entire conversation on every
 * call, so each `generate()` opens a FRESH provider session and runs a single
 * logical turn. We never reuse server-side context across calls — that would
 * double-count history the SDK already replays in the prompt.
 */

import type {
  DirectGenerateOptions,
  DirectGenerateResult,
  DirectTransport,
} from './direct-language-model';

/** How the caller supplies the (possibly-refreshed) DeepSeek web token. */
export interface DeepSeekTransportOptions {
  /** Returns the current DeepSeek user token. May be async (e.g. keychain read). */
  getToken: () => string | Promise<string>;
  /** Per-call timeout in ms, forwarded to the library. */
  timeoutMs?: number;
}

/**
 * DeepSeek transport: Bearer token + proof-of-work + SSE, no browser required.
 */
export function createDeepSeekTransport(
  options: DeepSeekTransportOptions,
): DirectTransport {
  return {
    async generate(opts: DirectGenerateOptions): Promise<DirectGenerateResult> {
      const { deepseek } = await import('ai-providers-direct');
      const token = await options.getToken();
      if (!token) {
        throw new Error(
          'DeepSeek direct connection is missing a token. Set it in Settings → ' +
            'Direct AI Connection, or capture one via the token refresh script.',
        );
      }

      // Fresh session per call — the AI SDK already replays full history.
      const sessionId = await deepseek.createSession(token, { signal: opts.signal });

      const result = await deepseek.chat({
        token,
        sessionId,
        prompt: opts.prompt,
        thinkingEnabled: !!opts.thinking,
        searchEnabled: false,
        signal: opts.signal,
        timeoutMs: options.timeoutMs,
        onChunk: opts.onText,
        onReasoning: opts.onReasoning,
      });

      return { text: result.text, reasoning: result.reasoning };
    },
  };
}

/**
 * ChatGPT transport: tunnels through a persistent headless Chrome (Playwright)
 * so the browser session handles Cloudflare / Sentinel / proof-of-work.
 *
 * NOTE: this path requires a one-time `chatgpt:setup` sign-in and a working
 * Playwright Chrome install at runtime. It is intentionally heavier than the
 * DeepSeek path and only spun up when a ChatGPT model is selected.
 */
export function createChatGPTTransport(): DirectTransport {
  return {
    async generate(opts: DirectGenerateOptions): Promise<DirectGenerateResult> {
      const { chatgpt } = await import('ai-providers-direct');

      const session = await chatgpt.createSession();
      const result = await chatgpt.chat({
        sessionId: session.sessionId,
        prompt: opts.prompt,
        signal: opts.signal,
        onChunk: opts.onText,
      });

      return { text: result.text };
    },
  };
}
