/**
 * AI Auth Resolver
 *
 * Multi-stage credential resolution for Vercel AI SDK providers.
 * Reuses existing claude-profile/credential-utils.ts for OAuth token retrieval.
 *
 * Fallback chain (in priority order):
 * 1. Profile-specific OAuth token (from credential-utils keychain/credential store)
 * 2. Profile-specific API key (from app settings)
 * 3. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 * 4. Default provider credentials (no-auth for Ollama, etc.)
 *
 * This module does NOT rewrite credential storage — it imports from
 * existing claude-profile/ utilities.
 */

import * as path from 'node:path';
import { ensureValidToken, reactiveTokenRefresh } from '../../claude-profile/token-refresh';
import type { SupportedProvider } from '../providers/types';
import { detectProviderFromModel } from '../providers/factory';
import type { AuthResolverContext, QueueResolvedAuth, ResolvedAuth } from './types';
import {
  PROVIDER_BASE_URL_ENV,
  PROVIDER_ENV_VARS,
  PROVIDER_SETTINGS_KEY,
} from './types';
import type { ProviderAccount } from '../../../shared/types/provider-account';
import type { BuiltinProvider } from '../../../shared/types/provider-account';
import { resolveModelEquivalent } from '../../../shared/constants/models';
import { scoreProviderAccount } from '../../claude-profile/profile-scorer';
import type { ClaudeAutoSwitchSettings } from '../../../shared/types/agent';

// ============================================
// Z.AI Endpoint Routing
// ============================================

/** Z.AI General API — for usage-based (pay-per-use) API keys */
const ZAI_GENERAL_API = 'https://api.z.ai/api/paas/v4';
/** Z.AI Coding API — for Coding Plan subscription keys */
const ZAI_CODING_API = 'https://api.z.ai/api/coding/paas/v4';

// ============================================
// Settings Accessor
// ============================================

/**
 * Function type for retrieving a global API key from app settings.
 * Injected to avoid circular dependency on settings-store.
 */
type SettingsAccessor = (key: string) => string | undefined;

let _getSettingsValue: SettingsAccessor | null = null;

/**
 * Register a settings accessor function.
 * Called once during app initialization to wire up settings access.
 *
 * @param accessor - Function that retrieves a value from AppSettings by key
 */
export function registerSettingsAccessor(accessor: SettingsAccessor): void {
  _getSettingsValue = accessor;
}

// ============================================
// Stage 0: Provider Account (Unified Accounts)
// ============================================

/**
 * Attempt to resolve credentials from unified ProviderAccount in settings.
 * This is the highest priority stage — checks providerAccounts array.
 */
async function resolveFromProviderAccount(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  if (!_getSettingsValue) return null;

  // Read providerAccounts from settings
  const accountsRaw = _getSettingsValue('providerAccounts');
  if (!accountsRaw) return null;

  let accounts: Array<{ provider: string; isActive: boolean; authType: string; apiKey?: string; baseUrl?: string; claudeProfileId?: string; billingModel?: string }>;
  try {
    accounts = typeof accountsRaw === 'string' ? JSON.parse(accountsRaw) : (accountsRaw as any);
  } catch {
    return null;
  }

  if (!Array.isArray(accounts)) return null;

  // Find active account for this provider
  const account = accounts.find(a => a.provider === ctx.provider && a.isActive);
  if (!account) return null;

  // File-based OAuth accounts (e.g., OpenAI Codex)
  if (account.authType === 'oauth' && account.provider === 'openai') {
    // Resolve token file path on main thread (has electron.app access)
    const { app } = await import('electron');
    const tokenFilePath = path.join(app.getPath('userData'), 'codex-auth.json');
    const { ensureValidOAuthToken } = await import('../providers/oauth-fetch');
    const token = await ensureValidOAuthToken(tokenFilePath, 'openai');
    if (token) {
      return {
        apiKey: 'codex-oauth-placeholder', // Dummy key; real token injected via custom fetch
        source: 'codex-oauth',
        oauthTokenFilePath: tokenFilePath,
      };
    }
    return null;
  }

  // OAuth accounts — delegate to profile OAuth flow
  if (account.authType === 'oauth' && account.claudeProfileId) {
    // Let the existing OAuth stage handle it
    return null;
  }

  // API key accounts
  if (account.authType === 'api-key' && account.apiKey) {
    // Z.AI: route to correct endpoint based on billing model
    const baseURL = account.provider === 'zai'
      ? (account.baseUrl || (account.billingModel === 'subscription' ? ZAI_CODING_API : ZAI_GENERAL_API))
      : account.baseUrl;

    return {
      apiKey: account.apiKey,
      source: 'profile-api-key',
      baseURL,
    };
  }

  return null;
}

// ============================================
// Stage 1: Profile OAuth Token
// ============================================

/**
 * Attempt to resolve credentials from the profile's OAuth token store.
 * Only applicable for Anthropic provider (Claude profiles use OAuth).
 * Calls ensureValidToken() for proactive token refresh before expiry.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
async function resolveFromProfileOAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  if (ctx.provider !== 'anthropic') return null;

  try {
    const tokenResult = await ensureValidToken(ctx.configDir);
    if (tokenResult.token) {
      const resolved: ResolvedAuth = {
        apiKey: tokenResult.token,
        source: 'profile-oauth',
        // OAuth tokens require the beta header for Anthropic API
        headers: { 'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14' },
      };

      // Check for custom base URL from environment (profile may set ANTHROPIC_BASE_URL)
      const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
      if (baseUrlEnv) {
        const baseURL = process.env[baseUrlEnv];
        if (baseURL) resolved.baseURL = baseURL;
      }

      return resolved;
    }
  } catch {
    // Token refresh failed (network, keychain locked, etc.) — fall through
  }

  return null;
}

/**
 * Perform a reactive OAuth token refresh (called on 401 errors).
 * Forces a refresh regardless of apparent token state.
 *
 * @param configDir - Config directory for the profile
 * @returns New token or null if refresh failed
 */
export async function refreshOAuthTokenReactive(configDir: string | undefined): Promise<string | null> {
  try {
    const result = await reactiveTokenRefresh(configDir);
    return result.token ?? null;
  } catch {
    return null;
  }
}

// ============================================
// Stage 2: Profile API Key (from settings)
// ============================================

/**
 * Attempt to resolve credentials from profile-specific API key in app settings.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
function resolveFromProfileApiKey(ctx: AuthResolverContext): ResolvedAuth | null {
  if (!_getSettingsValue) return null;

  const settingsKey = PROVIDER_SETTINGS_KEY[ctx.provider];
  if (!settingsKey) return null;

  const apiKey = _getSettingsValue(settingsKey);
  if (!apiKey) return null;

  const resolved: ResolvedAuth = {
    apiKey,
    source: 'profile-api-key',
  };

  const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
  if (baseUrlEnv) {
    const baseURL = process.env[baseUrlEnv];
    if (baseURL) resolved.baseURL = baseURL;
  }

  return resolved;
}

// ============================================
// Stage 3: Environment Variable
// ============================================

/**
 * Attempt to resolve credentials from environment variables.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
function resolveFromEnvironment(ctx: AuthResolverContext): ResolvedAuth | null {
  const envVar = PROVIDER_ENV_VARS[ctx.provider];
  if (!envVar) return null;

  const apiKey = process.env[envVar];
  if (!apiKey) return null;

  const resolved: ResolvedAuth = {
    apiKey,
    source: 'environment',
  };

  const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
  if (baseUrlEnv) {
    const baseURL = process.env[baseUrlEnv];
    if (baseURL) resolved.baseURL = baseURL;
  }

  return resolved;
}

// ============================================
// Stage 4: Default Provider Credentials
// ============================================

/** Providers that work without explicit authentication */
const NO_AUTH_PROVIDERS = new Set<SupportedProvider>([
  'ollama',
]);

/**
 * Attempt to resolve default credentials for providers that don't require auth.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if provider requires auth
 */
function resolveDefaultCredentials(ctx: AuthResolverContext): ResolvedAuth | null {
  if (!NO_AUTH_PROVIDERS.has(ctx.provider)) return null;

  return {
    apiKey: '',
    source: 'default',
  };
}

// ============================================
// Public API
// ============================================

/**
 * Resolve authentication credentials for a given provider and profile.
 *
 * Walks the multi-stage fallback chain in priority order:
 * 1. Profile OAuth token (Anthropic only, from system keychain, with proactive refresh)
 * 2. Profile API key (from app settings)
 * 3. Environment variable
 * 4. Default provider credentials (no-auth providers like Ollama)
 *
 * @param ctx - Auth resolution context (provider, profileId, configDir)
 * @returns Resolved auth credentials, or null if no credentials found
 */
export async function resolveAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  return (
    (await resolveFromProviderAccount(ctx)) ??
    (await resolveFromProfileOAuth(ctx)) ??
    resolveFromProfileApiKey(ctx) ??
    resolveFromEnvironment(ctx) ??
    resolveDefaultCredentials(ctx) ??
    null
  );
}

/**
 * Check if credentials are available for a provider without returning them.
 * Useful for UI validation and provider availability checks.
 *
 * @param ctx - Auth resolution context
 * @returns True if credentials can be resolved
 */
export async function hasCredentials(ctx: AuthResolverContext): Promise<boolean> {
  return (await resolveAuth(ctx)) !== null;
}

// ============================================
// Queue-Based Resolution (Global Priority Queue)
// ============================================

/**
 * Provider name to SupportedProvider mapping.
 * Maps BuiltinProvider (from provider-account.ts) to SupportedProvider (from providers/types.ts).
 */
const BUILTIN_TO_SUPPORTED: Record<string, SupportedProvider> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  'amazon-bedrock': 'bedrock',
  azure: 'azure',
  mistral: 'mistral',
  groq: 'groq',
  xai: 'xai',
  openrouter: 'openrouter',
  zai: 'zai',
  ollama: 'ollama',
};

/**
 * Resolve auth from the global priority queue.
 *
 * Algorithm:
 * 1. Walk queue in order
 * 2. Skip excluded accounts (previously failed)
 * 3. Check availability (scoring: subscription = check limits, pay-per-use = always available)
 * 4. Find model equivalent for account's provider (user overrides → defaults)
 * 5. Resolve credentials (OAuth token refresh, API key, etc.)
 * 6. Return first match with resolved model + reasoning config
 */
export async function resolveAuthFromQueue(
  requestedModel: string,
  queue: ProviderAccount[],
  options?: {
    excludeAccountIds?: string[];
    userModelOverrides?: Record<string, Partial<Record<BuiltinProvider, import('../../../shared/constants/models').ProviderModelSpec>>>;
    autoSwitchSettings?: ClaudeAutoSwitchSettings;
  }
): Promise<QueueResolvedAuth | null> {
  const excludeSet = new Set(options?.excludeAccountIds ?? []);
  const defaultSettings: ClaudeAutoSwitchSettings = {
    enabled: true,
    proactiveSwapEnabled: false,
    sessionThreshold: 95,
    weeklyThreshold: 99,
    autoSwitchOnRateLimit: true,
    autoSwitchOnAuthFailure: true,
    usageCheckInterval: 30000,
  };
  const settings = options?.autoSwitchSettings ?? defaultSettings;

  for (const account of queue) {
    // Skip excluded accounts
    if (excludeSet.has(account.id)) continue;

    // Score account availability
    const { available } = scoreProviderAccount(account, settings);
    if (!available) continue;

    // Map BuiltinProvider to SupportedProvider
    const supportedProvider = BUILTIN_TO_SUPPORTED[account.provider];
    if (!supportedProvider) continue;

    // Resolve which model to use on this account.
    // First try the equivalence table (maps shorthands like 'sonnet' across providers).
    // If no equivalence exists, check if the model is native to this provider
    // (e.g., 'llama3.1:8b' on Ollama). If the model belongs to a different provider,
    // skip this account to avoid sending provider-mismatched requests (e.g., sending
    // an Anthropic model ID to an OpenAI endpoint → 400 Bad Request).
    const modelSpec = resolveModelEquivalent(
      requestedModel,
      account.provider,
      options?.userModelOverrides,
    );

    if (!modelSpec) {
      // No cross-provider equivalent found. Only proceed if the model is
      // native to this provider's API (detected via model ID prefix).
      // Ollama is a special case: it runs arbitrary user-installed models with
      // no predictable prefix (e.g., 'llama3.1:8b', 'mistral:7b', 'phi3:mini').
      // When the account IS Ollama, allow any unrecognized model through since
      // the user explicitly configured it. When the account is NOT Ollama, skip
      // if the model can't be identified as native.
      const nativeProvider = detectProviderFromModel(requestedModel);
      if (nativeProvider !== supportedProvider && supportedProvider !== 'ollama') continue;
      // If nativeProvider is defined but doesn't match Ollama, skip (e.g., 'claude-*' on Ollama)
      if (supportedProvider === 'ollama' && nativeProvider && nativeProvider !== 'ollama') continue;
    }

    const resolvedModelId = modelSpec?.modelId ?? requestedModel;

    // Note: Codex OAuth accounts now use .responses() for ALL models (not just
    // Codex-named ones) in the provider factory, so no format mismatch guard
    // is needed here. All OpenAI models are eligible through Codex OAuth.

    // Resolve credentials for this account
    const auth = await resolveCredentialsForAccount(account, supportedProvider);
    if (!auth) continue;

    // Success — return the fully resolved auth
    return {
      ...auth,
      accountId: account.id,
      resolvedProvider: supportedProvider,
      resolvedModelId,
      reasoningConfig: modelSpec?.reasoning ?? { type: 'none' },
    };
  }

  return null;
}

/**
 * Build a default queue config from app settings.
 * Reads providerAccounts and globalPriorityOrder, sorts accounts
 * by the priority order, and returns a queueConfig object compatible
 * with createSimpleClient() / createAgentClient().
 *
 * Returns undefined if no provider accounts are configured.
 */
export function buildDefaultQueueConfig(
  requestedModel: string,
): { queue: ProviderAccount[]; requestedModel: string } | undefined {
  if (!_getSettingsValue) return undefined;

  // Read providerAccounts
  const accountsRaw = _getSettingsValue('providerAccounts');
  if (!accountsRaw) return undefined;

  let accounts: ProviderAccount[];
  try {
    accounts = typeof accountsRaw === 'string' ? JSON.parse(accountsRaw) : (accountsRaw as ProviderAccount[]);
  } catch {
    return undefined;
  }

  if (!Array.isArray(accounts) || accounts.length === 0) return undefined;

  // Read priority order
  const priorityRaw = _getSettingsValue('globalPriorityOrder');
  let priorityOrder: string[] = [];
  if (priorityRaw) {
    try {
      priorityOrder = typeof priorityRaw === 'string' ? JSON.parse(priorityRaw) : (priorityRaw as string[]);
    } catch {
      // Use accounts in their natural order
    }
  }

  // Sort accounts by priority order (accounts not in the list go to the end)
  const sorted = [...accounts].sort((a, b) => {
    const idxA = priorityOrder.indexOf(a.id);
    const idxB = priorityOrder.indexOf(b.id);
    const effectiveA = idxA === -1 ? Infinity : idxA;
    const effectiveB = idxB === -1 ? Infinity : idxB;
    return effectiveA - effectiveB;
  });

  return { queue: sorted, requestedModel };
}

/**
 * Resolve the correct Z.AI base URL based on billing model.
 * Coding Plan (subscription) → /api/coding/paas/v4
 * Usage-Based (pay-per-use)  → /api/paas/v4
 *
 * If the account has an explicit baseUrl set, it takes precedence.
 */
function resolveZaiBaseUrl(account: ProviderAccount): string {
  if (account.baseUrl) return account.baseUrl;
  return account.billingModel === 'subscription' ? ZAI_CODING_API : ZAI_GENERAL_API;
}

/**
 * Resolve credentials for a specific ProviderAccount.
 * Handles OAuth token refresh, API keys, and Codex OAuth.
 */
async function resolveCredentialsForAccount(
  account: ProviderAccount,
  provider: SupportedProvider,
): Promise<ResolvedAuth | null> {
  // No-auth providers (e.g., Ollama) — no API key required
  if (NO_AUTH_PROVIDERS.has(provider)) {
    return {
      apiKey: '',
      source: 'default',
      baseURL: account.baseUrl,
    };
  }

  // File-based OAuth (e.g., OpenAI Codex subscription)
  if (account.authType === 'oauth' && account.provider === 'openai') {
    try {
      const { app } = await import('electron');
      const tokenFilePath = path.join(app.getPath('userData'), 'codex-auth.json');
      const { ensureValidOAuthToken } = await import('../providers/oauth-fetch');
      const token = await ensureValidOAuthToken(tokenFilePath, 'openai');
      if (token) {
        return {
          apiKey: 'codex-oauth-placeholder',
          source: 'codex-oauth',
          oauthTokenFilePath: tokenFilePath,
        };
      }
    } catch { /* fall through */ }
    return null;
  }

  // Anthropic OAuth — refresh token via existing claude-profile system
  if (account.authType === 'oauth' && account.provider === 'anthropic') {
    if (account.claudeProfileId) {
      // Delegate to profile OAuth resolution
      const ctx: AuthResolverContext = { provider, profileId: account.claudeProfileId };
      return resolveAuth(ctx);
    }
    return null;
  }

  // API key accounts
  if (account.authType === 'api-key' && account.apiKey) {
    // Z.AI: route to correct endpoint based on billing model
    const baseURL = account.provider === 'zai'
      ? resolveZaiBaseUrl(account)
      : account.baseUrl;

    return {
      apiKey: account.apiKey,
      source: 'profile-api-key',
      baseURL,
    };
  }

  return null;
}
