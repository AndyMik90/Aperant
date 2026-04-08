import type { AppSettings } from '@shared/types/settings';
import { ProxyAgent } from 'undici';

export const HTTP_PROXY_KEYS = ['HTTP_PROXY', 'http_proxy'] as const;
export const HTTPS_PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy'] as const;

const proxyAgentCache = new Map<string, ProxyAgent>();

function tryDisposeAgent(agent: ProxyAgent): void {
  try {
    if (typeof (agent as unknown as { close?: () => Promise<void> }).close === 'function') {
      void (agent as unknown as { close: () => Promise<void> }).close();
      return;
    }

    if (typeof (agent as unknown as { destroy?: () => void }).destroy === 'function') {
      (agent as unknown as { destroy: () => void }).destroy();
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function pruneStaleProxyAgents(activeProxyUrls: Set<string>): void {
  for (const [url, agent] of proxyAgentCache.entries()) {
    if (activeProxyUrls.has(url)) {
      continue;
    }
    tryDisposeAgent(agent);
    proxyAgentCache.delete(url);
  }
}

function getRequestScheme(target?: string | URL): string | undefined {
  if (!target) {
    return undefined;
  }

  if (target instanceof URL) {
    return target.protocol;
  }

  try {
    return new URL(target).protocol;
  } catch {
    return undefined;
  }
}

export type RuntimeProxyInput = Pick<
  AppSettings,
  'proxyEnabled' | 'proxyHttpUrl' | 'proxyHttpsUrl'
>;

export type ProxyConfigValidationErrorCode =
  | 'MISSING_PROXY_URL'
  | 'INVALID_HTTP_PROXY_URL'
  | 'INVALID_HTTPS_PROXY_URL'
  | 'UNSUPPORTED_HTTP_PROXY_PROTOCOL'
  | 'UNSUPPORTED_HTTPS_PROXY_PROTOCOL';

export interface ProxyConfigValidationError {
  code: ProxyConfigValidationErrorCode;
  message: string;
}

export interface RuntimeProxyEnabledConfig {
  state: 'enabled';
  httpProxyUrl: string;
  httpsProxyUrl: string;
}

export interface RuntimeProxyDisabledConfig {
  state: 'disabled';
}

export interface RuntimeProxyInvalidConfig {
  state: 'invalid';
  errors: ProxyConfigValidationError[];
}

export type RuntimeProxyConfigResult =
  | RuntimeProxyEnabledConfig
  | RuntimeProxyDisabledConfig
  | RuntimeProxyInvalidConfig;

function validateProxyUrl(
  value: string | undefined,
  kind: 'http' | 'https',
): { normalized: string | null; errors: ProxyConfigValidationError[] } {
  if (!value) {
    return { normalized: null, errors: [] };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { normalized: null, errors: [] };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        normalized: null,
        errors: [
          {
            code:
              kind === 'http'
                ? 'UNSUPPORTED_HTTP_PROXY_PROTOCOL'
                : 'UNSUPPORTED_HTTPS_PROXY_PROTOCOL',
            message: `Proxy URL for ${kind.toUpperCase()} must use http:// or https://.`,
          },
        ],
      };
    }

    return {
      normalized: parsed.toString(),
      errors: [],
    };
  } catch {
    return {
      normalized: null,
      errors: [
        {
          code: kind === 'http' ? 'INVALID_HTTP_PROXY_URL' : 'INVALID_HTTPS_PROXY_URL',
          message: `Proxy URL for ${kind.toUpperCase()} is invalid.`,
        },
      ],
    };
  }
}

/**
 * Normalize app settings into deterministic runtime proxy behavior.
 *
 * Rules:
 * - Disabled -> runtime proxy disabled
 * - Enabled + invalid URL(s) -> invalid result
 * - Enabled + one URL provided -> use that URL for both HTTP and HTTPS
 * - Enabled + both URLs provided -> preserve per-protocol values
 */
export function normalizeRuntimeProxyConfig(input: RuntimeProxyInput): RuntimeProxyConfigResult {
  if (!input.proxyEnabled) {
    return { state: 'disabled' };
  }

  const validatedHttp = validateProxyUrl(input.proxyHttpUrl, 'http');
  const validatedHttps = validateProxyUrl(input.proxyHttpsUrl, 'https');
  const errors = [...validatedHttp.errors, ...validatedHttps.errors];

  if (errors.length > 0) {
    return { state: 'invalid', errors };
  }

  const resolvedHttp = validatedHttp.normalized ?? validatedHttps.normalized;
  const resolvedHttps = validatedHttps.normalized ?? validatedHttp.normalized;

  if (!resolvedHttp || !resolvedHttps) {
    return {
      state: 'invalid',
      errors: [
        {
          code: 'MISSING_PROXY_URL',
          message: 'Proxy is enabled but no HTTP/HTTPS proxy URL is configured.',
        },
      ],
    };
  }

  return {
    state: 'enabled',
    httpProxyUrl: resolvedHttp,
    httpsProxyUrl: resolvedHttps,
  };
}

/**
 * Apply normalized proxy config to process env.
 *
 * If validation fails, process env is left unchanged.
 */
export function applyRuntimeProxyConfig(input: RuntimeProxyInput): RuntimeProxyConfigResult {
  const normalized = normalizeRuntimeProxyConfig(input);

  if (normalized.state === 'invalid') {
    return normalized;
  }

  if (normalized.state === 'disabled') {
    for (const key of HTTP_PROXY_KEYS) {
      delete process.env[key];
    }
    for (const key of HTTPS_PROXY_KEYS) {
      delete process.env[key];
    }
    return normalized;
  }

  process.env.HTTP_PROXY = normalized.httpProxyUrl;
  process.env.http_proxy = normalized.httpProxyUrl;
  process.env.HTTPS_PROXY = normalized.httpsProxyUrl;
  process.env.https_proxy = normalized.httpsProxyUrl;

  return normalized;
}

/**
 * Shared env lookup order for runtime proxy consumers.
 */
export function getProxyUrlFromEnvironment(target?: string | URL): string | undefined {
  const scheme = getRequestScheme(target);
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

  if (scheme === 'http:') {
    return httpProxy || httpsProxy;
  }

  if (scheme === 'https:') {
    return httpsProxy || httpProxy;
  }

  if (httpsProxy) {
    return httpsProxy;
  }

  return httpProxy;
}

/**
 * Shared proxy agent creation for runtime network consumers.
 */
export function getProxyAgentFromEnvironment(target?: string | URL): ProxyAgent | undefined {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

  const activeProxyUrls = new Set<string>();
  if (httpProxy) {
    activeProxyUrls.add(httpProxy);
  }
  if (httpsProxy) {
    activeProxyUrls.add(httpsProxy);
  }

  pruneStaleProxyAgents(activeProxyUrls);

  const proxyUrl = getProxyUrlFromEnvironment(target);
  if (!proxyUrl) {
    return undefined;
  }

  const cachedAgent = proxyAgentCache.get(proxyUrl);
  if (cachedAgent) {
    return cachedAgent;
  }

  const agent = new ProxyAgent(proxyUrl);
  proxyAgentCache.set(proxyUrl, agent);
  return agent;
}
