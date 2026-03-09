/**
 * Generic OAuth Fetch Interceptor
 *
 * Data-driven OAuth token management for file-based OAuth providers.
 * Adding a new OAuth provider = adding an entry to OAUTH_PROVIDER_REGISTRY.
 *
 * Works in both main thread and worker threads since it operates
 * on a pre-resolved token file path (no Electron APIs needed).
 */

import * as fs from 'node:fs';

// =============================================================================
// Debug Logging
// =============================================================================

const DEBUG = process.env.DEBUG === 'true' || process.argv.includes('--debug');

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const prefix = `[OAuthFetch ${new Date().toISOString()}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

// =============================================================================
// OAuth Provider Registry
// =============================================================================

interface OAuthProviderSpec {
  /** Token endpoint for refresh_token grant */
  tokenEndpoint: string;
  /** OAuth client ID */
  clientId: string;
  /** Rewrite the request URL (e.g., to a subscription-specific endpoint) */
  rewriteUrl?: (url: string) => string;
  /** Transform the request body before sending (e.g., to inject required fields) */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
}

const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

const OAUTH_PROVIDER_REGISTRY: Record<string, OAuthProviderSpec> = {
  openai: {
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    rewriteUrl: (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes('/chat/completions') || parsed.pathname.includes('/v1/responses')) {
        return CODEX_API_ENDPOINT;
      }
      return url;
    },
    // Codex endpoint requires store=false and instructions (not system messages in input).
    // The SDK puts the system prompt as a system/developer message in the input array,
    // but the Codex endpoint requires it in the top-level `instructions` field instead.
    transformBody: (body: Record<string, unknown>) => {
      const transformed: Record<string, unknown> = { ...body, store: false };

      // Extract system/developer message from input array → instructions field
      if (!transformed.instructions && Array.isArray(transformed.input)) {
        const input = transformed.input as Array<{ role?: string; content?: string }>;
        const sysIdx = input.findIndex(m => m.role === 'system' || m.role === 'developer');
        if (sysIdx !== -1) {
          const sysMsg = input[sysIdx];
          transformed.instructions = sysMsg.content ?? '';
          transformed.input = input.filter((_, i) => i !== sysIdx);
        }
      }

      return transformed;
    },
  },
  // Future OAuth providers: just add entries here
};

// =============================================================================
// Token File I/O
// =============================================================================

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

/** How far before expiry to consider a token "near expiry" and trigger refresh */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function readTokenFile(tokenFilePath: string): StoredTokens | null {
  try {
    const raw = fs.readFileSync(tokenFilePath, 'utf8');
    const tokens = JSON.parse(raw) as StoredTokens;
    debugLog('Read token file', { path: tokenFilePath, expiresAt: tokens.expires_at });
    return tokens;
  } catch {
    debugLog('Failed to read token file', { path: tokenFilePath });
    return null;
  }
}

function writeTokenFile(tokenFilePath: string, tokens: StoredTokens): void {
  fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2), 'utf8');
  try {
    fs.chmodSync(tokenFilePath, 0o600);
  } catch {
    // chmod may fail on Windows; non-critical
  }
  debugLog('Wrote tokens to file', { path: tokenFilePath, expiresAt: tokens.expires_at });
}

// =============================================================================
// Token Refresh
// =============================================================================

async function refreshOAuthToken(
  refreshToken: string,
  providerSpec: OAuthProviderSpec,
  tokenFilePath: string,
): Promise<string | null> {
  debugLog('Refreshing OAuth token');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: providerSpec.clientId,
  });

  const response = await fetch(providerSpec.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  debugLog('Token refresh response', { status: response.status, ok: response.ok });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore parse errors
    }
    debugLog('Token refresh failed', { error: errorMessage });
    return null;
  }

  const data = await response.json() as Record<string, unknown>;
  debugLog('Token refresh success', {
    hasAccessToken: !!data.access_token,
    hasNewRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in,
  });

  if (!data.access_token || typeof data.access_token !== 'string') {
    debugLog('Token refresh response missing access_token');
    return null;
  }

  // Token rotation: new refresh token may be issued
  const newRefreshToken =
    typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  writeTokenFile(tokenFilePath, {
    access_token: data.access_token,
    refresh_token: newRefreshToken,
    expires_at: expiresAt,
  });

  return data.access_token;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detect the OAuth provider from a token file path.
 * Falls back to 'openai' (the only provider currently).
 */
function detectProvider(provider?: string): OAuthProviderSpec | undefined {
  const key = provider ?? 'openai';
  return OAUTH_PROVIDER_REGISTRY[key];
}

/**
 * Ensure a valid OAuth access token is available from the given token file.
 *
 * - Returns null if no tokens are stored.
 * - If the token expires within 5 minutes, auto-refreshes.
 * - Returns the valid access token.
 *
 * Works in both main thread and worker threads (no Electron APIs needed).
 */
export async function ensureValidOAuthToken(
  tokenFilePath: string,
  provider?: string,
): Promise<string | null> {
  debugLog('Ensuring valid OAuth token', { path: tokenFilePath, provider });

  const stored = readTokenFile(tokenFilePath);
  if (!stored) {
    debugLog('No stored tokens — returning null');
    return null;
  }

  const expiresIn = stored.expires_at - Date.now();
  debugLog('Token expiry check', { expiresInMs: expiresIn, thresholdMs: REFRESH_THRESHOLD_MS });

  if (expiresIn > REFRESH_THRESHOLD_MS) {
    debugLog('Token still valid');
    return stored.access_token;
  }

  // Token expired or near expiry — attempt refresh
  debugLog('Token expired or near expiry, attempting refresh');
  const providerSpec = detectProvider(provider);
  if (!providerSpec) {
    debugLog('No provider spec found for refresh', { provider });
    return null;
  }

  try {
    return await refreshOAuthToken(stored.refresh_token, providerSpec, tokenFilePath);
  } catch (err) {
    debugLog('Token refresh failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Create a custom fetch function for file-based OAuth providers.
 *
 * The returned fetch interceptor:
 * 1. Reads and auto-refreshes the OAuth token from the token file
 * 2. Strips any existing Authorization header and injects the real token
 * 3. Rewrites the URL if the provider specifies a rewrite rule
 *
 * Data-driven: adding a new provider = adding an entry to OAUTH_PROVIDER_REGISTRY.
 */

/**
 * Reassemble an SSE (Server-Sent Events) stream into the final JSON response object.
 * The Codex endpoint streams responses in SSE format. The last `response.completed` event
 * contains the full response object that matches the Responses API JSON format.
 *
 * This allows `generateText()` (which expects a JSON response) to work transparently
 * with the Codex endpoint (which requires `stream: true`).
 */
function reassembleSSEToJSON(sseText: string): Record<string, unknown> | null {
  // Parse SSE events — find the last response.completed event which contains the full response
  const lines = sseText.split('\n');
  let lastCompletedData: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('event: response.completed')) {
      // Next line starting with "data: " contains the JSON
      const dataLine = lines[i + 1];
      if (dataLine?.startsWith('data: ')) {
        lastCompletedData = dataLine.slice(6);
      }
    }
  }

  if (!lastCompletedData) return null;

  try {
    const parsed = JSON.parse(lastCompletedData) as Record<string, unknown>;
    // The event data wraps the response: { type: "response.completed", response: {...} }
    const response = parsed.response as Record<string, unknown> | undefined;
    return response ?? parsed;
  } catch {
    return null;
  }
}

export function createOAuthProviderFetch(
  tokenFilePath: string,
  provider?: string,
): typeof globalThis.fetch {
  const providerSpec = detectProvider(provider);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // 1. Get valid OAuth token (auto-refresh if needed)
    const token = await ensureValidOAuthToken(tokenFilePath, provider);
    if (!token) {
      throw new Error('OAuth: No valid token available. Please re-authenticate.');
    }

    // 2. Build headers — strip dummy Authorization, inject real token
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.delete('Authorization');
    headers.set('Authorization', `Bearer ${token}`);

    // 3. Resolve URL
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    // 4. Rewrite URL if provider specifies a rewrite rule
    const originalUrl = url;
    if (providerSpec?.rewriteUrl) {
      url = providerSpec.rewriteUrl(url);
    }

    if (DEBUG && url !== originalUrl) {
      debugLog(`${originalUrl} -> ${url} (token: [redacted])`);
    }

    // 5. Transform request body if provider specifies a body transform
    //    (e.g., Codex endpoint requires store=false)
    let finalInit = { ...init, headers };
    let wasNonStreaming = false;
    if (providerSpec?.transformBody && url !== originalUrl && init?.body) {
      try {
        const bodyStr = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer);
        const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
        wasNonStreaming = parsed.stream !== true;
        const transformed = providerSpec.transformBody(parsed);
        // Codex endpoint requires stream=true; force it even for generateText() calls
        transformed.stream = true;
        finalInit = { ...finalInit, body: JSON.stringify(transformed) };
        if (DEBUG) {
          debugLog('Transformed request body for Codex endpoint', {
            store: transformed.store,
            forcedStream: wasNonStreaming,
          });
        }
      } catch {
        // If body isn't JSON, send as-is
      }
    }

    const response = await globalThis.fetch(url, finalInit);

    if (DEBUG) {
      debugLog(`Response: ${response.status} ${response.statusText}`, {
        url,
        contentType: response.headers.get('content-type'),
        hasBody: response.body !== null,
      });
      // Log error response body for 4xx errors to diagnose issues
      if (response.status >= 400 && response.status < 500) {
        try {
          const cloned = response.clone();
          const errorBody = await cloned.text();
          debugLog('Error response body', errorBody.substring(0, 500));
        } catch {
          // Ignore clone/read errors
        }
      }
    }

    // 6. If the SDK sent a non-streaming request but we forced stream=true,
    //    consume the SSE stream and return a synthetic JSON response so that
    //    the SDK's doGenerate() response handler can parse it correctly.
    if (wasNonStreaming && response.ok && response.body) {
      try {
        const sseText = await response.text();
        const jsonResponse = reassembleSSEToJSON(sseText);
        if (DEBUG) {
          debugLog('Reassembled SSE→JSON for non-streaming caller', {
            status: jsonResponse ? 'ok' : 'fallback',
          });
        }
        if (jsonResponse) {
          return new Response(JSON.stringify(jsonResponse), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              ...Object.fromEntries(response.headers.entries()),
            },
          });
        }
      } catch (e) {
        if (DEBUG) {
          debugLog('SSE reassembly failed, returning original response', e);
        }
      }
    }

    return response;
  };
}
