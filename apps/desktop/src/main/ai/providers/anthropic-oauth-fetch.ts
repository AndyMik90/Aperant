/**
 * Anthropic OAuth System-Prompt Interceptor
 *
 * Claude Code subscription (OAuth) tokens are only accepted by the Anthropic
 * Messages API when the request's FIRST system block is the verbatim Claude Code
 * identity line. Any other leading system content is rejected with a (misleading)
 * 429 rate_limit_error. API keys have no such requirement.
 *
 * This fetch interceptor rewrites the outgoing request body so that the first
 * system block is always the Claude Code identity, preserving the caller's own
 * system prompt as the following block(s). It only touches /v1/messages requests
 * with a body; everything else passes through untouched.
 *
 * Centralizing this here means every code path that builds a provider via
 * createProvider() (worker agents, insights, roadmap, chat, runners) gets the
 * correct behavior without each call site having to know about it.
 */

/** The exact identity line Anthropic requires as the first system block for OAuth. */
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

type SystemBlock = { type: 'text'; text: string; [k: string]: unknown };

/**
 * Ensure the `system` field of an Anthropic Messages request is a block array
 * whose first block is the Claude Code identity. Returns the normalized system value.
 */
function withClaudeCodeIdentity(system: unknown): SystemBlock[] {
  const identity: SystemBlock = { type: 'text', text: CLAUDE_CODE_IDENTITY };

  // No system provided → just the identity block.
  if (system == null) {
    return [identity];
  }

  // String system → [identity, original].
  if (typeof system === 'string') {
    const trimmed = system.trim();
    if (trimmed === CLAUDE_CODE_IDENTITY) return [identity];
    return trimmed.length > 0 ? [identity, { type: 'text', text: system }] : [identity];
  }

  // Array of blocks.
  if (Array.isArray(system)) {
    const blocks = system as SystemBlock[];
    const firstText = blocks.length > 0 && blocks[0] && typeof blocks[0].text === 'string'
      ? blocks[0].text.trim()
      : undefined;
    // Already correct — leave as-is.
    if (firstText === CLAUDE_CODE_IDENTITY) return blocks;
    return [identity, ...blocks];
  }

  // Unknown shape → prepend identity, keep original as a best-effort text block.
  return [identity, { type: 'text', text: String(system) }];
}

/**
 * Wrap a fetch implementation so Anthropic Messages requests always carry the
 * Claude Code identity as their first system block. Safe to use for API-key
 * requests too (the identity block is harmless), but intended for OAuth.
 */
export function createAnthropicOAuthFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === 'string' ? input
        : input instanceof URL ? input.toString()
        : input instanceof Request ? input.url
        : String(input);

      const body = init?.body;
      // Only rewrite Messages API calls that carry a JSON string body.
      if (url.includes('/v1/messages') && typeof body === 'string' && body.length > 0) {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          parsed.system = withClaudeCodeIdentity(parsed.system);
          const newInit: RequestInit = { ...init, body: JSON.stringify(parsed) };
          return baseFetch(input, newInit);
        } catch {
          // Body wasn't JSON we could parse — fall through and send unmodified.
        }
      }
    } catch {
      // Never let the interceptor break the request; fall through to base fetch.
    }
    return baseFetch(input, init);
  };
}
