/**
 * HTTP Proxy Utility
 *
 * Provides proxy support for all outbound HTTP requests in the application.
 * Reads proxy configuration from environment variables (HTTP_PROXY, HTTPS_PROXY).
 */

import { fetch as undiciFetch } from 'undici';
import { getProxyAgentFromEnvironment } from './runtime-proxy-config';

export { getProxyAgentFromEnvironment as getProxyAgent };

function isMockedFetch(fetchFn: typeof globalThis.fetch): boolean {
  const candidate = fetchFn as unknown as {
    _isMockFunction?: boolean;
    mock?: unknown;
    getMockName?: () => string;
  };

  return (
    candidate._isMockFunction === true ||
    typeof candidate.getMockName === 'function' ||
    candidate.mock !== undefined
  );
}

/**
 * Fetch with proxy support
 * Automatically uses proxy if environment variables are set
 */
export async function fetchWithProxy(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // Test compatibility: when fetch is mocked (Vitest/Jest), prefer native fetch
  // so the mock can intercept calls even if host proxy env vars are present.
  if (isMockedFetch(fetch)) {
    return fetch(input, init);
  }

  const requestUrl =
    typeof input === 'string' || input instanceof URL
      ? input
      : input instanceof Request
        ? input.url
        : undefined;
  const proxyAgent = getProxyAgentFromEnvironment(requestUrl);

  if (proxyAgent) {
    const requestDerivedInit: RequestInit =
      input instanceof Request
        ? {
            method: input.method,
            headers: input.headers,
            body: input.body ?? undefined,
            cache: input.cache,
            credentials: input.credentials,
            integrity: input.integrity,
            keepalive: input.keepalive,
            mode: input.mode,
            referrer: input.referrer,
            referrerPolicy: input.referrerPolicy,
            redirect: input.redirect,
            signal: input.signal,
          }
        : {};

    const undiciInput: string | URL = input instanceof Request ? input.url : input;

    // Intentional cast: undici fetch init extends standard RequestInit with dispatcher,
    // but TypeScript sees mixed DOM/undici types in Electron main process.
    return undiciFetch(undiciInput, {
      ...requestDerivedInit,
      ...init,
      dispatcher: proxyAgent,
    } as any) as unknown as Response;
  }

  // Fallback to native fetch if no proxy configured
  return fetch(input, init);
}
