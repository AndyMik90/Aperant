/**
 * Usage Monitor - Proactive usage monitoring and account switching
 *
 * Monitors Claude account usage at configured intervals and automatically
 * switches to alternative accounts before hitting rate limits.
 *
 * Uses hybrid approach:
 * 1. Primary: Direct OAuth API (https://api.anthropic.com/api/oauth/usage)
 * 2. Fallback: CLI /usage command parsing
 */

import { EventEmitter } from 'events';
import { homedir } from 'os';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { ClaudeUsageSnapshot, ProfileUsageSummary, AllProfilesUsage } from '../../shared/types/agent';
import { loadProfilesFile } from '../services/profile/profile-manager';
import type { APIProfile } from '../../shared/types/profile';
import { detectProvider as sharedDetectProvider, type ApiProvider } from '../../shared/utils/provider-detection';
import { getCredentialsFromKeychain, clearKeychainCache } from './credential-utils';
import { reactiveTokenRefresh, ensureValidToken } from './token-refresh';
import { isProfileRateLimited } from './rate-limit-manager';
import { getOperationRegistry } from './operation-registry';

// Re-export for backward compatibility
export type { ApiProvider };

/**
 * Create a safe fingerprint of a credential for debug logging.
 * Shows first 8 and last 4 characters, hiding the sensitive middle portion.
 * This is NOT for authentication - only for human-readable debug identification.
 *
 * @param credential - The credential (token or API key) to create a fingerprint for
 * @returns A safe fingerprint like "sk-ant-oa...xyz9" or "null" if no credential
 */
function getCredentialFingerprint(credential: string | null | undefined): string {
  if (!credential) return 'null';
  if (credential.length <= 16) return credential.slice(0, 4) + '...' + credential.slice(-2);
  return credential.slice(0, 8) + '...' + credential.slice(-4);
}

/**
 * Allowed domains for usage API requests.
 * Only these domains are permitted for outbound usage monitoring requests.
 */
const ALLOWED_USAGE_API_DOMAINS = new Set([
  'api.anthropic.com',
  'api.z.ai',
  'open.bigmodel.cn',
  'www.minimax.io',
  'api.minimax.io',
]);

/**
 * Provider usage endpoint configuration
 * Maps each provider to its usage monitoring endpoint path
 */
interface ProviderUsageEndpoint {
  provider: ApiProvider;
  usagePath: string;
}

const PROVIDER_USAGE_ENDPOINTS: readonly ProviderUsageEndpoint[] = [
  {
    provider: 'anthropic',
    usagePath: '/api/oauth/usage'
  },
  {
    provider: 'zai',
    usagePath: '/api/monitor/usage/quota/limit'
  },
  {
    provider: 'zhipu',
    usagePath: '/api/monitor/usage/quota/limit'
  },
  {
    provider: 'minimax',
    usagePath: '/v1/api/openplatform/coding_plan/remains'
  }
] as const;

/**
 * Get usage endpoint URL for a provider
 * Constructs full usage endpoint URL from provider baseUrl and usage path
 *
 * @param provider - The provider type
 * @param baseUrl - The API base URL (e.g., 'https://api.z.ai/api/anthropic')
 * @returns Full usage endpoint URL or null if provider unknown
 *
 * @example
 * getUsageEndpoint('anthropic', 'https://api.anthropic.com')
 * // returns 'https://api.anthropic.com/api/oauth/usage'
 * getUsageEndpoint('zai', 'https://api.z.ai/api/anthropic')
 * // returns 'https://api.z.ai/api/monitor/usage/quota/limit'
 * getUsageEndpoint('unknown', 'https://example.com')
 * // returns null
 */
export function getUsageEndpoint(provider: ApiProvider, baseUrl: string): string | null {
  const isDebug = process.env.DEBUG === 'true';

  if (isDebug) {
    console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Constructing usage endpoint:', {
      provider,
      baseUrl
    });
  }

  const endpointConfig = PROVIDER_USAGE_ENDPOINTS.find(e => e.provider === provider);
  if (!endpointConfig) {
    if (isDebug) {
      console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Unknown provider - no endpoint configured:', {
        provider,
        availableProviders: PROVIDER_USAGE_ENDPOINTS.map(e => e.provider)
      });
    }
    return null;
  }

  if (isDebug) {
    console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Found endpoint config for provider:', {
      provider,
      usagePath: endpointConfig.usagePath
    });
  }

  try {
    const url = new URL(baseUrl);
    const originalPath = url.pathname;

    // MiniMax usage API works on api.minimax.io (www.minimax.io blocked by Cloudflare WAF)

    // Replace the path with the usage endpoint path
    url.pathname = endpointConfig.usagePath;

    // Note: quota/limit endpoint doesn't require query parameters
    // The model-usage and tool-usage endpoints would need time windows, but we're using quota/limit

    const finalUrl = url.toString();

    if (isDebug) {
      console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Successfully constructed endpoint:', {
        provider,
        originalPath,
        newPath: endpointConfig.usagePath,
        finalUrl
      });
    }

    return finalUrl;
  } catch (error) {
    console.error('[UsageMonitor] Invalid baseUrl for usage endpoint:', baseUrl);
    if (isDebug) {
      console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] URL construction failed:', {
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
}

/**
 * Detect API provider from baseUrl
 * Extracts domain and matches against known provider patterns
 *
 * @param baseUrl - The API base URL (e.g., 'https://api.z.ai/api/anthropic')
 * @returns The detected provider type ('anthropic' | 'zai' | 'zhipu' | 'unknown')
 *
 * @example
 * detectProvider('https://api.anthropic.com') // returns 'anthropic'
 * detectProvider('https://api.z.ai/api/anthropic') // returns 'zai'
 * detectProvider('https://open.bigmodel.cn/api/anthropic') // returns 'zhipu'
 * detectProvider('https://unknown.com/api') // returns 'unknown'
 */
export function detectProvider(baseUrl: string): ApiProvider {
  // Wrapper around shared detectProvider with debug logging for main process
  const isDebug = process.env.DEBUG === 'true';

  const provider = sharedDetectProvider(baseUrl);

  if (isDebug) {
    console.warn('[UsageMonitor:PROVIDER_DETECTION] Detected provider:', {
      baseUrl,
      provider
    });
  }

  return provider;
}

/**
 * Result of determining the active profile type
 */
interface ActiveProfileResult {
  profileId: string;
  profileName: string;
  profileEmail?: string;
  isAPIProfile: boolean;
  baseUrl: string;
  credential?: string;
}

/**
 * Type guard to check if an error has an HTTP status code
 * @param error - The error to check
 * @returns true if the error has a statusCode property
 */
function isHttpError(error: unknown): error is Error & { statusCode?: number } {
  return error instanceof Error && 'statusCode' in error;
}

export class UsageMonitor extends EventEmitter {
  private static instance: UsageMonitor;
  private intervalId: NodeJS.Timeout | null = null;
  private currentUsage: ClaudeUsageSnapshot | null = null;
  private currentUsageProfileId: string | null = null; // Track which profile's usage is in currentUsage
  private lastGoodUsage: ClaudeUsageSnapshot | null = null; // Disk-persisted fallback (never grays out meter)
  private isChecking = false;

  // Per-profile API failure tracking with cooldown-based retry
  // Map<profileId, lastFailureTimestamp> - stores when API last failed for this profile
  private apiFailureTimestamps: Map<string, number> = new Map();
  private static API_FAILURE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown before API retry

  // Swap loop protection: track profiles that recently failed auth
  private authFailedProfiles: Map<string, number> = new Map(); // profileId -> timestamp
  private static AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

  // Track profiles that need re-authentication (invalid refresh token)
  // These profiles have permanent auth failures that require manual re-auth
  private needsReauthProfiles: Set<string> = new Set();

  // Cache for all profiles' usage data
  // Map<profileId, { usage: ProfileUsageSummary, fetchedAt: number }>
  private allProfilesUsageCache: Map<string, { usage: ProfileUsageSummary; fetchedAt: number }> = new Map();
  private static PROFILE_USAGE_CACHE_TTL_MS = 60 * 1000; // 1 minute cache for inactive profiles

  // Throttle usage emissions to prevent renderer re-render floods (trailing-edge debounce)
  private lastEmitTimestamp = 0;
  private static EMIT_THROTTLE_MS = 5_000; // Min 5 seconds between emissions
  private pendingUsage: ClaudeUsageSnapshot | null = null;
  private pendingEmitTimer: ReturnType<typeof setTimeout> | null = null;

  // Track last RDR notification state to avoid redundant pauseRdr/warnRdr calls
  private lastRdrNotificationState: 'none' | 'warning' | 'paused' = 'none';

  // Debug flag for verbose logging
  private readonly isDebug = process.env.DEBUG === 'true';

  /**
   * Debug log helper - only logs when DEBUG=true
   */
  private debugLog(message: string, data?: unknown): void {
    if (this.isDebug) {
      if (data !== undefined) {
        console.warn(message, data);
      } else {
        console.warn(message);
      }
    }
  }

  /**
   * Trailing-edge debounced emit for 'usage-updated'.
   * Emits immediately if enough time has passed, otherwise schedules the latest
   * value to be emitted after the cooldown. Never silently drops the latest update.
   */
  private throttledEmitUsage(usage: ClaudeUsageSnapshot): void {
    this.pendingUsage = usage;
    const now = Date.now();

    if (now - this.lastEmitTimestamp >= UsageMonitor.EMIT_THROTTLE_MS) {
      // Enough time passed — emit immediately
      this.clearPendingEmit();
      this.lastEmitTimestamp = now;
      this.emit('usage-updated', usage);
    } else if (!this.pendingEmitTimer) {
      // Schedule trailing emission so the latest value is never lost
      const remaining = UsageMonitor.EMIT_THROTTLE_MS - (now - this.lastEmitTimestamp);
      this.pendingEmitTimer = setTimeout(() => {
        this.pendingEmitTimer = null;
        if (this.pendingUsage) {
          this.lastEmitTimestamp = Date.now();
          const toEmit = this.pendingUsage;
          this.pendingUsage = null;
          this.emit('usage-updated', toEmit);
        }
      }, remaining);
    }
  }

  /** Cancel any scheduled trailing emission */
  private clearPendingEmit(): void {
    if (this.pendingEmitTimer) {
      clearTimeout(this.pendingEmitTimer);
      this.pendingEmitTimer = null;
    }
    this.pendingUsage = null;
  }

  /**
   * If a cached snapshot's reset timestamps have passed, zero out the stale percentages.
   * Returns a new snapshot (immutable) with corrected values, or the original if still valid.
   */
  private expireStaleUsage(cached: ClaudeUsageSnapshot): ClaudeUsageSnapshot {
    const now = Date.now();
    let sessionPct = cached.sessionPercent;
    let weeklyPct = cached.weeklyPercent;

    // If session reset time has passed, the 5-hour window rolled over — usage is ~0%
    if (cached.sessionResetTimestamp) {
      const resetMs = new Date(cached.sessionResetTimestamp).getTime();
      if (Number.isFinite(resetMs) && resetMs <= now) {
        sessionPct = 0;
      }
    }

    // If weekly reset time has passed, the weekly window rolled over — usage is ~0%
    if (cached.weeklyResetTimestamp) {
      const resetMs = new Date(cached.weeklyResetTimestamp).getTime();
      if (Number.isFinite(resetMs) && resetMs <= now) {
        weeklyPct = 0;
      }
    }

    if (sessionPct === cached.sessionPercent && weeklyPct === cached.weeklyPercent) {
      return cached; // No change — still valid
    }

    console.log(`[UsageMonitor] Expired stale cached usage: session ${cached.sessionPercent}%→${sessionPct}%, weekly ${cached.weeklyPercent}%→${weeklyPct}%`);
    return { ...cached, sessionPercent: sessionPct, weeklyPercent: weeklyPct };
  }

  /**
   * Proactively check usage thresholds and notify RDR system.
   * Called after every successful fetch and on expired startup data.
   * Pauses RDR at 100% usage, resumes below 100%.
   */
  private checkRdrThresholds(usage: ClaudeUsageSnapshot): void {
    try {
      // Lazy import to avoid circular dependency at module load time
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pauseRdr, resumeRdr } = require('../ipc-handlers/rdr-handlers');

      const sessionPct = usage.sessionPercent;
      const weeklyPct = usage.weeklyPercent;
      const bindingPct = Math.max(sessionPct, weeklyPct);

      // Determine reset timestamp for the binding constraint
      const resetTimestamp = weeklyPct > sessionPct
        ? (usage.weeklyResetTimestamp ? new Date(usage.weeklyResetTimestamp).getTime() : Date.now() + 7 * 24 * 60 * 60 * 1000)
        : (usage.sessionResetTimestamp ? new Date(usage.sessionResetTimestamp).getTime() : Date.now() + 5 * 60 * 60 * 1000);

      if (bindingPct >= 100 && this.lastRdrNotificationState !== 'paused') {
        const reason = weeklyPct > sessionPct
          ? `Weekly at ${weeklyPct}% (resets ${usage.weeklyResetTime || 'in ~7 days'})`
          : `Session at ${sessionPct}% (resets ${usage.sessionResetTime || 'in ~5h'})`;
        console.log(`[DIAG] checkRdrThresholds: PAUSE RDR — binding ${bindingPct}% >= 100`);
        pauseRdr(reason, resetTimestamp);
        this.lastRdrNotificationState = 'paused';
      } else if (bindingPct < 100 && this.lastRdrNotificationState !== 'none') {
        console.log(`[DIAG] checkRdrThresholds: RESUME RDR — binding ${bindingPct}% < 100`);
        resumeRdr('Usage below 100%');
        this.lastRdrNotificationState = 'none';
      }
    } catch (err) {
      this.debugLog('[UsageMonitor] checkRdrThresholds error:', err);
    }
  }

  private constructor() {
    super();
    this.debugLog('[UsageMonitor] Initialized');
  }

  static getInstance(): UsageMonitor {
    if (!UsageMonitor.instance) {
      UsageMonitor.instance = new UsageMonitor();
    }
    return UsageMonitor.instance;
  }

  /**
   * Start monitoring usage at configured interval
   *
   * Note: Usage monitoring always runs to display the usage badge.
   * Proactive account swapping only occurs if enabled in settings.
   *
   * Update interval: 30 seconds (30000ms) to keep usage stats accurate
   */
  start(): void {
    if (this.intervalId) {
      this.debugLog('[UsageMonitor] Already running');
      return;
    }

    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();
    const interval = settings.usageCheckInterval || 30000; // 30 seconds for accurate usage tracking

    this.debugLog('[UsageMonitor] Starting with interval: ' + interval + ' ms (30-second updates for accurate usage stats)');

    // Load last-good usage from disk so meter shows something even when API fails on startup
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync, existsSync } = require('fs');
      const p = this.getLastGoodUsagePath();
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        if (parsed.fetchedAt) parsed.fetchedAt = new Date(parsed.fetchedAt);
        this.lastGoodUsage = parsed as ClaudeUsageSnapshot;
        this.debugLog('[UsageMonitor] Loaded lastGoodUsage from disk (meter will show on startup)');
      }
    } catch {
      // Non-critical — silently ignore
    }

    // Emit lastGoodUsage immediately so meter shows data before first API call.
    // Expire stale percentages first — if the 5h/weekly window has reset since last save,
    // the meter should show ~0% instead of the old 100%.
    if (this.lastGoodUsage) {
      const fresh = this.expireStaleUsage(this.lastGoodUsage);
      this.currentUsage = fresh;
      this.currentUsageProfileId = fresh.profileId;
      this.lastEmitTimestamp = 0; // Force first emit through throttle
      this.throttledEmitUsage(fresh);
      this.checkRdrThresholds(fresh); // Proactively clear stale pause state if usage expired to 0%
      this.debugLog('[UsageMonitor] Emitted lastGoodUsage on startup — meter shows data immediately');
    }

    // Check immediately
    this.checkUsageAndSwap();

    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkUsageAndSwap();
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.debugLog('[UsageMonitor] Stopped');
    }
    this.clearPendingEmit();
  }

  /**
   * Path to the persistent last-good usage snapshot file.
   * Independent of claude-profiles.json — works for all users.
   */
  private getLastGoodUsagePath(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    return path.join(app.getPath('userData'), 'last-usage-snapshot.json');
  }

  /**
   * Get current usage snapshot (for UI indicator).
   * Falls back to last-good disk-persisted snapshot so meter never goes gray.
   */
  getCurrentUsage(): ClaudeUsageSnapshot | null {
    return this.currentUsage ?? this.lastGoodUsage;
  }

  /**
   * Get diagnostic snapshot for the diagnostics panel.
   * Exposes internal state for debugging usage meter issues.
   */
  getDiagnostics(): {
    currentUsage: ClaudeUsageSnapshot | null;
    lastGoodUsage: ClaudeUsageSnapshot | null;
    currentUsageProfileId: string | null;
    apiFailureTimestamps: Record<string, number>;
    lastEmitTimestamp: number;
    lastRdrNotificationState: string;
    isChecking: boolean;
    lastGoodUsagePath: string;
  } {
    const failures: Record<string, number> = {};
    for (const [k, v] of this.apiFailureTimestamps) {
      failures[k] = v;
    }
    return {
      currentUsage: this.currentUsage,
      lastGoodUsage: this.lastGoodUsage,
      currentUsageProfileId: this.currentUsageProfileId,
      apiFailureTimestamps: failures,
      lastEmitTimestamp: this.lastEmitTimestamp,
      lastRdrNotificationState: this.lastRdrNotificationState,
      isChecking: this.isChecking,
      lastGoodUsagePath: this.getLastGoodUsagePath(),
    };
  }

  /**
   * Force a fresh usage fetch, bypassing all caches and throttles.
   * Used by the diagnostics panel "Force Fetch" button.
   */
  async forceFetch(): Promise<ClaudeUsageSnapshot | null> {
    // Clear API failure timestamps so shouldUseApiMethod returns true
    this.apiFailureTimestamps.clear();
    // Reset throttle so emission goes through immediately
    this.lastEmitTimestamp = 0;
    // Run the normal check
    await this.checkUsageAndSwap();
    return this.currentUsage;
  }

  /**
   * Force usage to 100% when a task agent detects rate limiting.
   * Closes the polling gap where meter shows <100% but account is rate-limited.
   * Idempotent — safe to call from every rate-limited task agent.
   */
  forceSessionLimit(): void {
    const base = this.currentUsage ?? this.lastGoodUsage;
    if (!base) {
      console.warn('[UsageMonitor] forceSessionLimit: no base usage snapshot — skipping');
      return;
    }

    // Already at 100% — no-op
    if (base.sessionPercent >= 100) return;

    console.log(`[UsageMonitor] forceSessionLimit: forcing ${base.sessionPercent}% → 100%`);

    const forced: ClaudeUsageSnapshot = {
      ...base,
      sessionPercent: 100,
    };

    this.currentUsage = forced;
    this.lastEmitTimestamp = 0; // Force through throttle
    this.throttledEmitUsage(forced);
    this.checkRdrThresholds(forced);
  }

  /**
   * Clear the usage cache for a specific profile.
   * Called after re-authentication to ensure fresh usage data is fetched.
   *
   * @param profileId - Profile identifier to clear cache for
   */
  clearProfileUsageCache(profileId: string): void {
    const deleted = this.allProfilesUsageCache.delete(profileId);

    // Clear API failure cooldown — fresh credentials deserve a fresh attempt
    const hadFailure = this.apiFailureTimestamps.delete(profileId);

    // Also clear currentUsage if it belongs to this profile
    // This prevents stale data from being displayed when getAllProfilesUsage()
    // uses this.currentUsage for the active profile
    const clearedCurrentUsage = this.currentUsageProfileId === profileId;
    if (clearedCurrentUsage) {
      this.currentUsage = null;
      this.currentUsageProfileId = null;
    }

    // Reset throttle so the next emit goes through immediately
    this.lastEmitTimestamp = 0;

    this.debugLog('[UsageMonitor] Cleared usage cache for profile:', {
      profileId,
      wasInCache: deleted,
      clearedCurrentUsage,
      clearedApiFailure: hadFailure
    });
  }

  /**
   * Clear a profile from the auth-failed list.
   * Called after successful re-authentication to allow the profile to be used again.
   *
   * @param profileId - Profile identifier to clear from failed list
   */
  clearAuthFailedProfile(profileId: string): void {
    const wasInFailedList = this.authFailedProfiles.has(profileId);
    const wasNeedsReauth = this.needsReauthProfiles.has(profileId);
    this.authFailedProfiles.delete(profileId);
    this.needsReauthProfiles.delete(profileId);
    this.clearProfileUsageCache(profileId);

    if (wasInFailedList || wasNeedsReauth) {
      this.debugLog('[UsageMonitor] Cleared auth failure status for profile: ' + profileId, {
        wasInFailedList,
        wasNeedsReauth
      });
    }
  }

  /**
   * Trigger an immediate usage check.
   * Called after re-authentication or profile switch to give immediate feedback.
   * Resets the emit throttle so the result is sent to the renderer immediately.
   */
  checkNow(): void {
    this.debugLog('[UsageMonitor] Immediate check triggered');
    this.lastEmitTimestamp = 0; // Bypass throttle so emit goes through immediately
    this.checkUsageAndSwap().catch(error => {
      console.error('[UsageMonitor] Immediate check failed:', error);
    });
  }

  /**
   * Get all profiles usage data (for multi-profile display in UI)
   * Returns cached data if fresh, otherwise fetches for all profiles
   *
   * Uses parallel fetching for inactive profiles to minimize blocking delays.
   *
   * @param forceRefresh - If true, bypasses cache and fetches fresh data for all profiles
   */
  async getAllProfilesUsage(forceRefresh: boolean = false): Promise<AllProfilesUsage | null> {
    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getSettings();
    const activeProfileId = settings.activeProfileId;

    // CRITICAL: On startup, currentUsage may be null, but we still need to check for
    // missing credentials to show the re-auth indicator. Proactively check all profiles
    // for missing credentials and populate needsReauthProfiles.
    if (!this.currentUsage) {
      // Check all OAuth profiles for missing credentials
      for (const profile of settings.profiles) {
        if (profile.configDir) {
          const expandedConfigDir = profile.configDir.startsWith('~')
            ? profile.configDir.replace(/^~/, homedir())
            : profile.configDir;
          const creds = getCredentialsFromKeychain(expandedConfigDir);
          if (!creds.token) {
            // Credentials are missing - mark for re-auth
            this.needsReauthProfiles.add(profile.id);
            this.debugLog('[UsageMonitor:getAllProfilesUsage] Profile needs re-auth (no credentials): ' + profile.name);
          }
        }
      }

      // Build a minimal response with needsReauthentication flags even without usage data
      const allProfiles: ProfileUsageSummary[] = settings.profiles.map(profile => ({
        profileId: profile.id,
        profileName: profile.name,
        profileEmail: profile.email,
        sessionPercent: 0,
        weeklyPercent: 0,
        isAuthenticated: profile.isAuthenticated ?? false,
        isRateLimited: false,
        availabilityScore: profile.isAuthenticated ? 100 : 0,
        isActive: profile.id === activeProfileId,
        needsReauthentication: this.needsReauthProfiles.has(profile.id)
      }));

      // Return minimal data with auth status - don't return null!
      return {
        activeProfile: {
          profileId: activeProfileId || '',
          profileName: settings.profiles.find(p => p.id === activeProfileId)?.name || '',
          sessionPercent: 0,
          weeklyPercent: 0,
          fetchedAt: new Date(),
          needsReauthentication: this.needsReauthProfiles.has(activeProfileId || '')
        },
        allProfiles,
        fetchedAt: new Date()
      };
    }

    const now = Date.now();
    const allProfiles: ProfileUsageSummary[] = [];

    // First pass: identify profiles that need fresh data vs cached
    type ProfileToFetch = { profile: typeof settings.profiles[0]; index: number };
    const profilesToFetch: ProfileToFetch[] = [];
    const profileResults: (ProfileUsageSummary | null)[] = new Array(settings.profiles.length).fill(null);

    for (let i = 0; i < settings.profiles.length; i++) {
      const profile = settings.profiles[i];
      const cached = this.allProfilesUsageCache.get(profile.id);

      // Use cached data if fresh (within TTL) and not force refreshing
      if (!forceRefresh && cached && (now - cached.fetchedAt) < UsageMonitor.PROFILE_USAGE_CACHE_TTL_MS) {
        profileResults[i] = {
          ...cached.usage,
          isActive: profile.id === activeProfileId
        };
        continue;
      }

      // For active profile, use the current detailed usage (always fresh from last poll)
      if (profile.id === activeProfileId && this.currentUsage) {
        const summary = this.buildProfileUsageSummary(profile, this.currentUsage);
        profileResults[i] = summary;
        this.allProfilesUsageCache.set(profile.id, { usage: summary, fetchedAt: now });
        continue;
      }

      // Mark for parallel fetch
      profilesToFetch.push({ profile, index: i });
    }

    // Parallel fetch for all inactive profiles that need fresh data
    if (profilesToFetch.length > 0) {
      // Collect usage updates for batch save (avoids race condition with concurrent saves)
      const usageUpdates: Array<{ profileId: string; sessionPercent: number; weeklyPercent: number }> = [];

      const fetchPromises = profilesToFetch.map(async ({ profile, index }) => {
        const inactiveUsage = await this.fetchUsageForInactiveProfile(profile);
        const rateLimitStatus = isProfileRateLimited(profile);

        let sessionPercent = 0;
        let weeklyPercent = 0;

        if (inactiveUsage) {
          sessionPercent = inactiveUsage.sessionPercent;
          weeklyPercent = inactiveUsage.weeklyPercent;
          // Collect update for batch save (don't save here to avoid race condition)
          return {
            index,
            update: { profileId: profile.id, sessionPercent, weeklyPercent },
            profile,
            inactiveUsage,
            rateLimitStatus
          };
        } else {
          // Fallback to cached profile data if API fetch failed
          sessionPercent = profile.usage?.sessionUsagePercent ?? 0;
          weeklyPercent = profile.usage?.weeklyUsagePercent ?? 0;
          return {
            index,
            update: null, // No update needed for fallback
            profile,
            inactiveUsage,
            rateLimitStatus,
            sessionPercent,
            weeklyPercent
          };
        }
      });

      // Wait for all fetches to complete in parallel
      const fetchResults = await Promise.all(fetchPromises);

      // Collect all updates and build summaries
      for (const result of fetchResults) {
        const { index, update, profile, inactiveUsage, rateLimitStatus } = result;

        // Get percentages from either the update or the fallback values
        const sessionPercent = update?.sessionPercent ?? result.sessionPercent ?? 0;
        const weeklyPercent = update?.weeklyPercent ?? result.weeklyPercent ?? 0;

        if (update) {
          usageUpdates.push(update);
        }

        const summary: ProfileUsageSummary = {
          profileId: profile.id,
          profileName: profile.name,
          profileEmail: profile.email,
          sessionPercent,
          weeklyPercent,
          isAuthenticated: profile.isAuthenticated ?? false,
          isRateLimited: rateLimitStatus.limited,
          rateLimitType: rateLimitStatus.type,
          availabilityScore: this.calculateAvailabilityScore(
            sessionPercent,
            weeklyPercent,
            rateLimitStatus.limited,
            rateLimitStatus.type,
            profile.isAuthenticated ?? false
          ),
          isActive: profile.id === activeProfileId,
          lastFetchedAt: inactiveUsage?.fetchedAt?.toISOString() ?? profile.usage?.lastUpdated?.toISOString(),
          needsReauthentication: this.needsReauthProfiles.has(profile.id)
        };

        this.allProfilesUsageCache.set(profile.id, { usage: summary, fetchedAt: now });
        profileResults[index] = summary;
      }

      // Batch save all usage updates at once (single disk write, no race condition)
      if (usageUpdates.length > 0) {
        profileManager.batchUpdateProfileUsageFromAPI(usageUpdates);
      }
    }

    // Collect non-null results
    for (const result of profileResults) {
      if (result) {
        allProfiles.push(result);
      }
    }

    // Include API profiles (custom endpoints like MiniMax)
    try {
      const { loadProfilesFile } = await import('../services/profile/profile-manager');
      const apiProfilesFile = await loadProfilesFile();
      for (const apiProfile of apiProfilesFile.profiles) {
        // Skip if already in the list (shouldn't happen but be safe)
        if (allProfiles.some(p => p.profileId === apiProfile.id)) continue;

        const isActiveApi = apiProfile.id === apiProfilesFile.activeProfileId;
        allProfiles.push({
          profileId: apiProfile.id,
          profileName: apiProfile.name || apiProfile.baseUrl || 'API Endpoint',
          sessionPercent: 0,
          weeklyPercent: 0,
          isAuthenticated: !!apiProfile.apiKey,
          isRateLimited: false,
          availabilityScore: apiProfile.apiKey ? 50 : 0,
          isActive: isActiveApi,
          lastFetchedAt: new Date().toISOString(),
        });
      }
    } catch {
      // API profiles not available — continue with OAuth profiles only
    }

    // Sort by availability score (highest first = most available)
    allProfiles.sort((a, b) => b.availabilityScore - a.availabilityScore);

    return {
      activeProfile: this.currentUsage,
      allProfiles,
      fetchedAt: new Date()
    };
  }

  /**
   * Fetch usage for an inactive profile using its own credentials
   * This allows showing real usage data for non-active profiles
   *
   * Uses ensureValidToken to proactively refresh tokens before making API calls,
   * preventing 401 errors for inactive profiles whose tokens may have expired.
   */
  private async fetchUsageForInactiveProfile(
    profile: { id: string; name: string; email?: string; configDir?: string; isAuthenticated?: boolean }
  ): Promise<ClaudeUsageSnapshot | null> {
    // Only fetch for authenticated profiles with a configDir
    if (!profile.isAuthenticated || !profile.configDir) {
      this.debugLog('[UsageMonitor] Skipping inactive profile fetch - not authenticated or no configDir:', {
        profileId: profile.id,
        profileName: profile.name,
        isAuthenticated: profile.isAuthenticated,
        hasConfigDir: !!profile.configDir
      });
      return null;
    }

    try {
      // Get credentials from keychain for this profile's configDir
      const expandedConfigDir = profile.configDir.startsWith('~')
        ? profile.configDir.replace(/^~/, homedir())
        : profile.configDir;

      // Use ensureValidToken to proactively refresh the token if near expiry
      // This is critical for inactive profiles whose tokens may have expired
      let token: string | null = null;
      let wasRefreshed = false;

      try {
        const tokenResult = await ensureValidToken(expandedConfigDir);

        if (tokenResult.wasRefreshed) {
          this.debugLog('[UsageMonitor] Proactively refreshed token for inactive profile: ' + profile.name, {
            tokenFingerprint: getCredentialFingerprint(tokenResult.token)
          });
          wasRefreshed = true;

          // Check if token refresh succeeded but persistence failed
          // The token works for this session but will be lost on restart
          if (tokenResult.persistenceFailed) {
            console.warn('[UsageMonitor] Token refreshed but persistence failed for profile: ' + profile.name +
              ' - user should re-authenticate to avoid auth errors on next restart');
            this.needsReauthProfiles.add(profile.id);
          } else {
            // Token was refreshed and persisted successfully - clear from needsReauth if present
            this.needsReauthProfiles.delete(profile.id);
          }
        }

        token = tokenResult.token;

        if (tokenResult.error) {
          this.debugLog('[UsageMonitor] Token validation failed for inactive profile: ' + profile.name, tokenResult.error);

          // Check for invalid_grant error - indicates refresh token is invalid
          // and user needs to manually re-authenticate
          if (tokenResult.errorCode === 'invalid_grant') {
            this.debugLog('[UsageMonitor] Profile needs re-authentication (invalid refresh token): ' + profile.name);
            this.needsReauthProfiles.add(profile.id);
          }

          // Check for missing_credentials error - indicates no token in credential store
          // User needs to authenticate via /login
          if (tokenResult.errorCode === 'missing_credentials') {
            this.debugLog('[UsageMonitor] Profile needs authentication (no credentials found): ' + profile.name);
            this.needsReauthProfiles.add(profile.id);
          }
        }
      } catch (error) {
        this.debugLog('[UsageMonitor] ensureValidToken failed for inactive profile: ' + profile.name, error);
      }

      // Fallback: Try direct keychain read if ensureValidToken failed
      if (!token) {
        const keychainCreds = getCredentialsFromKeychain(expandedConfigDir);
        token = keychainCreds.token;

        if (!token) {
          this.debugLog('[UsageMonitor] No keychain credentials for inactive profile: ' + profile.name);
          // Mark profile as needing re-authentication since credentials are missing
          this.needsReauthProfiles.add(profile.id);
          return null;
        }
      }

      this.debugLog('[UsageMonitor] Fetching usage for inactive profile:', {
        profileId: profile.id,
        profileName: profile.name,
        tokenFingerprint: getCredentialFingerprint(token),
        wasRefreshed
      });

      // Fetch usage via API - OAuth profiles always use Anthropic
      const usage = await this.fetchUsageViaAPI(
        token,
        profile.id,
        profile.name,
        profile.email,
        {
          profileId: profile.id,
          profileName: profile.name,
          profileEmail: profile.email,
          isAPIProfile: false,
          baseUrl: 'https://api.anthropic.com'
        }
      );

      if (usage) {
        this.debugLog('[UsageMonitor] Successfully fetched inactive profile usage:', {
          profileName: profile.name,
          sessionPercent: usage.sessionPercent,
          weeklyPercent: usage.weeklyPercent
        });
      }

      return usage;
    } catch (error) {
      this.debugLog('[UsageMonitor] Failed to fetch inactive profile usage: ' + profile.name, error);
      return null;
    }
  }

  /**
   * Build a ProfileUsageSummary from a ClaudeUsageSnapshot
   */
  private buildProfileUsageSummary(
    profile: { id: string; name: string; email?: string; isAuthenticated?: boolean },
    usage: ClaudeUsageSnapshot
  ): ProfileUsageSummary {
    const profileManager = getClaudeProfileManager();
    const fullProfile = profileManager.getProfile(profile.id);
    const rateLimitStatus = fullProfile ? isProfileRateLimited(fullProfile) : { limited: false };

    return {
      profileId: profile.id,
      profileName: profile.name,
      profileEmail: usage.profileEmail || profile.email,
      sessionPercent: usage.sessionPercent,
      weeklyPercent: usage.weeklyPercent,
      sessionResetTimestamp: usage.sessionResetTimestamp,
      weeklyResetTimestamp: usage.weeklyResetTimestamp,
      isAuthenticated: profile.isAuthenticated ?? true,
      isRateLimited: rateLimitStatus.limited,
      rateLimitType: rateLimitStatus.type,
      availabilityScore: this.calculateAvailabilityScore(
        usage.sessionPercent,
        usage.weeklyPercent,
        rateLimitStatus.limited,
        rateLimitStatus.type,
        profile.isAuthenticated ?? true
      ),
      isActive: usage.profileId === profileManager.getActiveProfile()?.id,
      lastFetchedAt: usage.fetchedAt?.toISOString(),
      needsReauthentication: this.needsReauthProfiles.has(profile.id)
    };
  }

  /**
   * Calculate availability score for a profile (higher = more available)
   *
   * Scoring algorithm:
   * - Base score: 100
   * - Rate limited: -500 (session) or -1000 (weekly)
   * - Unauthenticated: -500
   * - Weekly usage penalty: -(weeklyPercent * 0.5)
   * - Session usage penalty: -(sessionPercent * 0.2)
   */
  private calculateAvailabilityScore(
    sessionPercent: number,
    weeklyPercent: number,
    isRateLimited: boolean,
    rateLimitType?: 'session' | 'weekly',
    isAuthenticated: boolean = true
  ): number {
    let score = 100;

    // Penalize rate-limited profiles heavily
    if (isRateLimited) {
      if (rateLimitType === 'weekly') {
        score -= 1000; // Weekly limit is worse (takes longer to reset)
      } else {
        score -= 500; // Session limit resets sooner
      }
    }

    // Penalize unauthenticated profiles
    if (!isAuthenticated) {
      score -= 500;
    }

    // Penalize based on current usage (weekly more important)
    score -= weeklyPercent * 0.5;
    score -= sessionPercent * 0.2;

    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get credential for usage monitoring (OAuth token or API key)
   * Detects profile type and returns appropriate credential
   *
   * Priority:
   * 1. API Profile (if active) - returns apiKey directly
   * 2. OAuth Profile - reads FRESH token from Keychain (not cached oauthToken)
   *
   * IMPORTANT: For OAuth profiles, we read from Keychain instead of cached profile.oauthToken.
   * OAuth tokens expire in 8-12 hours, but Claude CLI auto-refreshes and stores fresh tokens
   * in Keychain. Using cached tokens causes 401 errors after a few hours.
   * See: docs/LONG_LIVED_AUTH_PLAN.md
   *
   * @returns The credential string or undefined if none available
   */
  private async getCredential(): Promise<string | undefined> {
    // Try API profile first (highest priority)
    try {
      const profilesFile = await loadProfilesFile();
      if (profilesFile.activeProfileId) {
        const activeProfile = profilesFile.profiles.find(
          (p) => p.id === profilesFile.activeProfileId
        );
        if (activeProfile?.apiKey) {
          this.debugLog('[UsageMonitor:TRACE] Using API profile credential: ' + activeProfile.name);
          return activeProfile.apiKey;
        }
      }
    } catch (error) {
      // API profile loading failed, fall through to OAuth
      this.debugLog('[UsageMonitor:TRACE] Failed to load API profiles, falling back to OAuth:', error);
    }

    // Fall back to OAuth profile - use ensureValidToken for proactive refresh
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile) {
      // Use ensureValidToken to proactively refresh tokens before they expire
      // This prevents 401 errors during overnight autonomous operation
      try {
        const tokenResult = await ensureValidToken(activeProfile.configDir);

        if (tokenResult.wasRefreshed) {
          this.debugLog('[UsageMonitor] Proactively refreshed token for profile: ' + activeProfile.name, {
            tokenFingerprint: getCredentialFingerprint(tokenResult.token)
          });

          // Check if token refresh succeeded but persistence failed
          // The token works for this session but will be lost on restart
          if (tokenResult.persistenceFailed) {
            console.warn('[UsageMonitor] Token refreshed but persistence failed for profile: ' + activeProfile.name +
              ' - user should re-authenticate to avoid auth errors on next restart');
            this.needsReauthProfiles.add(activeProfile.id);
          } else {
            // Token was refreshed and persisted successfully - clear from needsReauth if present
            this.needsReauthProfiles.delete(activeProfile.id);
          }
        }

        if (tokenResult.token) {
          this.debugLog('[UsageMonitor:TRACE] Using OAuth token for profile: ' + activeProfile.name, {
            tokenFingerprint: getCredentialFingerprint(tokenResult.token),
            wasRefreshed: tokenResult.wasRefreshed
          });
          return tokenResult.token;
        }

        // Token unavailable - log the error
        if (tokenResult.error) {
          this.debugLog('[UsageMonitor] Token validation failed:', tokenResult.error);

          // Check for invalid_grant error - indicates refresh token is permanently invalid
          // and user needs to manually re-authenticate
          if (tokenResult.errorCode === 'invalid_grant') {
            this.debugLog('[UsageMonitor] Profile needs re-authentication (invalid refresh token): ' + activeProfile.name);
            this.needsReauthProfiles.add(activeProfile.id);
          }

          // Check for missing_credentials error - indicates no token in credential store
          // User needs to authenticate via /login
          if (tokenResult.errorCode === 'missing_credentials') {
            this.debugLog('[UsageMonitor] Profile needs authentication (no credentials found): ' + activeProfile.name);
            this.needsReauthProfiles.add(activeProfile.id);
          }
        }
      } catch (error) {
        console.error('[UsageMonitor] ensureValidToken threw error:', error);
      }

      // Fallback: Try direct keychain read (e.g., if refresh token unavailable)
      const keychainCreds = getCredentialsFromKeychain(activeProfile.configDir);
      if (keychainCreds.token) {
        this.debugLog('[UsageMonitor:TRACE] Using fallback OAuth token from Keychain for profile: ' + activeProfile.name, {
          tokenFingerprint: getCredentialFingerprint(keychainCreds.token)
        });
        return keychainCreds.token;
      }

      // Keychain read also failed
      if (keychainCreds.error) {
        this.debugLog('[UsageMonitor] Keychain access failed:', keychainCreds.error);
      } else {
        this.debugLog('[UsageMonitor:TRACE] No token in Keychain for profile: ' + activeProfile.name +
          ' - user may need to re-authenticate with claude /login');
      }

      // Mark profile as needing re-authentication since credentials are missing
      this.needsReauthProfiles.add(activeProfile.id);
    }

    // No credential available
    this.debugLog('[UsageMonitor:TRACE] No credential available (no API or OAuth profile active)');
    return undefined;
  }

  /**
   * Check usage and trigger swap if thresholds exceeded
   *
   * Refactored to use helper methods for better maintainability:
   * - determineActiveProfile(): Detects API vs OAuth profile
   * - checkThresholdsExceeded(): Evaluates usage against thresholds
   * - handleAuthFailure(): Manages auth failure recovery
   */
  private async checkUsageAndSwap(): Promise<void> {
    if (this.isChecking) {
      return; // Prevent concurrent checks
    }

    this.isChecking = true;
    let profileId: string | undefined;
    let isAPIProfile = false;

    try {
      // Step 1: Determine active profile (API vs OAuth)
      const activeProfile = await this.determineActiveProfile();
      if (!activeProfile) {
        return; // No active profile
      }

      profileId = activeProfile.profileId;
      isAPIProfile = activeProfile.isAPIProfile;

      // Step 2: Fetch current usage (pass activeProfile for consistency)
      const credential = await this.getCredential();
      console.log(`[DIAG] fetchUsage start — credential: ${credential ? 'yes' : 'NO'}, profile: ${profileId}`);
      const usage = await this.fetchUsage(profileId, credential, activeProfile);
      if (!usage) {
        const bestAvailable = this.currentUsage ?? this.lastGoodUsage;
        console.log(`[DIAG] fetchUsage FAILED — re-emitting cached: S:${bestAvailable?.sessionPercent ?? 'null'}% W:${bestAvailable?.weeklyPercent ?? 'null'}%`);
        // Re-emit best-available data so meter doesn't go gray/stale (throttled).
        // Expire stale percentages first — if session has reset, show ~0% not old 100%.
        if (bestAvailable) {
          const fresh = this.expireStaleUsage(bestAvailable);
          this.currentUsage = fresh;
          this.throttledEmitUsage(fresh);
          this.checkRdrThresholds(fresh);
        }
        return;
      }
      console.log(`[DIAG] fetchUsage OK — S:${usage.sessionPercent}% W:${usage.weeklyPercent}%`);

      // Add needsReauthentication flag to the snapshot for the active profile
      usage.needsReauthentication = this.needsReauthProfiles.has(profileId);

      this.currentUsage = usage;
      this.currentUsageProfileId = profileId; // Track which profile this usage belongs to

      // Persist last-good usage to disk — survives restarts and 429 gaps
      // Uses async writeFile to avoid blocking the main Electron event loop
      this.lastGoodUsage = usage;
      try {
        const { writeFile } = require('fs/promises');
        writeFile(this.getLastGoodUsagePath(), JSON.stringify(usage), 'utf8').catch(() => {});
      } catch {
        // Non-critical — silently ignore
      }

      // Step 2.5: Persist usage to profile for caching (so other profiles can display cached usage)
      const profileManager = getClaudeProfileManager();
      profileManager.updateProfileUsageFromAPI(profileId, usage.sessionPercent, usage.weeklyPercent);

      // Step 3: Emit usage update for UI (throttled to prevent renderer floods)
      this.throttledEmitUsage(usage);

      // Step 3.1: Proactively check usage thresholds and notify RDR system.
      // Pauses RDR at 100%, resumes below 100%.
      this.checkRdrThresholds(usage);

      // Step 3.5: Emit all profiles usage for multi-profile display
      const allProfilesUsage = await this.getAllProfilesUsage();
      if (allProfilesUsage) {
        this.emit('all-profiles-usage-updated', allProfilesUsage);
      }

      // Step 4: Check thresholds and perform proactive swap (OAuth profiles only)
      if (!isAPIProfile) {
        const profileManager = getClaudeProfileManager();
        const settings = profileManager.getAutoSwitchSettings();

        if (!settings.enabled || !settings.proactiveSwapEnabled) {
          this.debugLog('[UsageMonitor:TRACE] Proactive swap disabled, skipping threshold check');
          return;
        }

        const thresholds = this.checkThresholdsExceeded(usage, settings);

        if (thresholds.anyExceeded) {
          this.debugLog('[UsageMonitor:TRACE] Threshold exceeded', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent,
            activeProfile: profileId,
            hasCredential: !!credential
          });

          this.debugLog('[UsageMonitor] Threshold exceeded:', {
            sessionPercent: usage.sessionPercent,
            sessionThreshold: settings.sessionThreshold ?? 95,
            weeklyPercent: usage.weeklyPercent,
            weeklyThreshold: settings.weeklyThreshold ?? 99
          });

          // Attempt proactive swap
          await this.performProactiveSwap(
            profileId,
            thresholds.sessionExceeded ? 'session' : 'weekly'
          );
        } else {
          this.debugLog('[UsageMonitor:TRACE] Usage OK', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent
          });
        }
      } else {
        this.debugLog('[UsageMonitor:TRACE] Skipping proactive swap for API profile (only supported for OAuth profiles)');
      }
    } catch (error) {
      // Step 5: Handle auth failures
      if (isHttpError(error) && (error.statusCode === 401 || error.statusCode === 403)) {
        if (profileId) {
          await this.handleAuthFailure(profileId, isAPIProfile);
          return; // handleAuthFailure manages its own logging
        }
      }

      console.error('[UsageMonitor] Check failed:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check if API method should be used for a specific profile
   *
   * Uses cooldown-based retry: API is retried after API_FAILURE_COOLDOWN_MS
   *
   * @param profileId - Profile identifier
   * @returns true if API should be tried, false if CLI should be used
   */
  private shouldUseApiMethod(profileId: string): boolean {
    const lastFailure = this.apiFailureTimestamps.get(profileId);
    if (!lastFailure) return true; // No previous failure, try API
    // Check if cooldown has expired (use >= to allow retry at exact boundary)
    const elapsed = Date.now() - lastFailure;
    return elapsed >= UsageMonitor.API_FAILURE_COOLDOWN_MS;
  }

  /**
   * Determine which profile is active (API profile vs OAuth profile)
   * API profiles take priority over OAuth profiles
   *
   * @returns Active profile info or null if no profile is active
   */
  private async determineActiveProfile(): Promise<ActiveProfileResult | null> {
    // First, check if an API profile is active
    try {
      const profilesFile = await loadProfilesFile();
      if (profilesFile.activeProfileId) {
        const activeAPIProfile = profilesFile.profiles.find(
          (p) => p.id === profilesFile.activeProfileId
        );
        if (activeAPIProfile?.apiKey) {
          // API profile is active and has an apiKey
          this.debugLog('[UsageMonitor:TRACE] Active auth type: API Profile', {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name,
            baseUrl: activeAPIProfile.baseUrl
          });
          return {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name,
            isAPIProfile: true,
            baseUrl: activeAPIProfile.baseUrl
          };
        } else if (activeAPIProfile) {
          // API profile exists but missing apiKey - fall back to OAuth
          this.debugLog('[UsageMonitor:TRACE] Active API profile missing apiKey, falling back to OAuth', {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name
          });
        } else {
          // activeProfileId is set but profile not found - fall through to OAuth
          this.debugLog('[UsageMonitor:TRACE] Active API profile ID set but profile not found, falling back to OAuth');
        }
      }
    } catch (error) {
      // Failed to load API profiles - fall through to OAuth
      this.debugLog('[UsageMonitor:TRACE] Failed to load API profiles, falling back to OAuth:', error);
    }

    // If no API profile is active, check OAuth profiles
    const profileManager = getClaudeProfileManager();
    const activeOAuthProfile = profileManager.getActiveProfile();

    if (!activeOAuthProfile) {
      this.debugLog('[UsageMonitor] No active profile (neither API nor OAuth)');
      return null;
    }

    // Get email from profile or try keychain
    let profileEmail = activeOAuthProfile.email;
    if (!profileEmail) {
      // Try to get email from keychain
      // IMPORTANT: Always pass configDir - service name is based on expanded path (e.g., /Users/xxx/.claude)
      const keychainCreds = getCredentialsFromKeychain(activeOAuthProfile.configDir);
      profileEmail = keychainCreds.email ?? undefined;
    }

    this.debugLog('[UsageMonitor:TRACE] Active auth type: OAuth Profile', {
      profileId: activeOAuthProfile.id,
      profileName: activeOAuthProfile.name,
      profileEmail
    });

    const result = {
      profileId: activeOAuthProfile.id,
      profileName: activeOAuthProfile.name,
      profileEmail,
      isAPIProfile: false,
      baseUrl: 'https://api.anthropic.com'
    };

    return result;
  }

  /**
   * Check if thresholds are exceeded for proactive swapping
   *
   * @param usage - Current usage snapshot
   * @param settings - Auto-switch settings
   * @returns Object indicating which thresholds are exceeded
   */
  private checkThresholdsExceeded(
    usage: ClaudeUsageSnapshot,
    settings: { sessionThreshold?: number; weeklyThreshold?: number }
  ): { sessionExceeded: boolean; weeklyExceeded: boolean; anyExceeded: boolean } {
    const sessionExceeded = usage.sessionPercent >= (settings.sessionThreshold ?? 95);
    const weeklyExceeded = usage.weeklyPercent >= (settings.weeklyThreshold ?? 99);

    return {
      sessionExceeded,
      weeklyExceeded,
      anyExceeded: sessionExceeded || weeklyExceeded
    };
  }

  /**
   * Handle auth failure by attempting token refresh, then marking profile as failed
   * and attempting proactive swap if refresh fails.
   *
   * @param profileId - Profile that failed auth
   * @param isAPIProfile - Whether this is an API profile (token refresh only for OAuth)
   */
  private async handleAuthFailure(profileId: string, isAPIProfile: boolean): Promise<void> {
    const profileManager = getClaudeProfileManager();

    // For OAuth profiles, attempt token refresh before giving up
    if (!isAPIProfile) {
      const profile = profileManager.getProfile(profileId);
      if (profile?.configDir) {
        this.debugLog('[UsageMonitor] Auth failure - attempting token refresh for profile: ' + profileId);

        try {
          const refreshResult = await reactiveTokenRefresh(profile.configDir);

          if (refreshResult.wasRefreshed && refreshResult.token) {
            this.debugLog('[UsageMonitor] Token refresh successful for profile: ' + profileId, {
              tokenFingerprint: getCredentialFingerprint(refreshResult.token)
            });

            // Check if token refresh succeeded but persistence failed
            // The token works for this session but will be lost on restart
            if (refreshResult.persistenceFailed) {
              console.warn('[UsageMonitor] Token refreshed but persistence failed for profile: ' + profileId +
                ' - user should re-authenticate to avoid auth errors on next restart');
              this.needsReauthProfiles.add(profileId);
            } else {
              // Token was refreshed and persisted successfully - clear from needsReauth if present
              this.needsReauthProfiles.delete(profileId);
            }

            // Token was refreshed - don't mark as failed, let next poll use the new token
            return;
          }

          if (refreshResult.error) {
            this.debugLog('[UsageMonitor] Token refresh failed:', refreshResult.error);

            // Check for invalid_grant error - indicates refresh token is permanently invalid
            // and user needs to manually re-authenticate (matches inactive profile handling)
            if (refreshResult.errorCode === 'invalid_grant') {
              this.debugLog('[UsageMonitor] Profile needs re-authentication (invalid refresh token): ' + profileId);
              this.needsReauthProfiles.add(profileId);
            }
          }
        } catch (refreshError) {
          console.error('[UsageMonitor] Token refresh threw error:', refreshError);
        }

        // Refresh failed - clear cache so next attempt gets fresh credentials
        this.debugLog('[UsageMonitor] Auth failure - clearing keychain cache for profile: ' + profileId);
        clearKeychainCache(profile.configDir);
      }
    }

    // Mark this profile as auth-failed to prevent swap loops
    // This MUST happen before the early return to prevent infinite loops
    this.authFailedProfiles.set(profileId, Date.now());
    this.debugLog('[UsageMonitor] Auth failure detected, marked profile as failed: ' + profileId);

    // Clean up expired entries from the failed profiles map
    const now = Date.now();
    this.authFailedProfiles.forEach((timestamp, failedProfileId) => {
      if (now - timestamp > UsageMonitor.AUTH_FAILURE_COOLDOWN_MS) {
        this.authFailedProfiles.delete(failedProfileId);
      }
    });

    const settings = profileManager.getAutoSwitchSettings();

    // Proactive swap is only supported for OAuth profiles, not API profiles
    if (isAPIProfile || !settings.enabled || !settings.proactiveSwapEnabled) {
      this.debugLog('[UsageMonitor] Auth failure detected but proactive swap is disabled or using API profile, skipping swap');
      return;
    }

    try {
      const excludeProfiles = Array.from(this.authFailedProfiles.keys());
      this.debugLog('[UsageMonitor] Attempting proactive swap (excluding failed profiles):', excludeProfiles);
      await this.performProactiveSwap(
        profileId,
        'session', // Treat auth failure as session limit for immediate swap
        excludeProfiles
      );
    } catch (swapError) {
      console.error('[UsageMonitor] Failed to perform auth-failure swap:', swapError);
    }
  }

  /**
   * Fetch usage - HYBRID APPROACH
   * Tries API first, falls back to CLI if API fails
   *
   * Enhanced to support multiple providers (Anthropic, z.ai, ZHIPU)
   * Detects provider from active profile's baseUrl and routes to appropriate endpoint
   *
   * @param profileId - Profile identifier
   * @param credential - OAuth token or API key
   * @param activeProfile - Optional active profile info to avoid race conditions
   */
  private async fetchUsage(
    profileId: string,
    credential?: string,
    activeProfile?: ActiveProfileResult
  ): Promise<ClaudeUsageSnapshot | null> {
    // Get profile name and email - prefer activeProfile since it's already determined
    let profileName: string | undefined;
    let profileEmail: string | undefined;

    // Use activeProfile data if available (already fetched and validated)
    // This fixes the bug where API profile names were incorrectly shown for OAuth profiles
    if (activeProfile?.profileName) {
      profileName = activeProfile.profileName;
      profileEmail = activeProfile.profileEmail;
      this.debugLog('[UsageMonitor:FETCH] Using activeProfile data:', {
        profileId,
        profileName,
        profileEmail,
        isAPIProfile: activeProfile.isAPIProfile
      });
    }

    // Only search API profiles if not already set from activeProfile
    if (!profileName) {
      try {
        const profilesFile = await loadProfilesFile();
        const apiProfile = profilesFile.profiles.find(p => p.id === profileId);
        if (apiProfile) {
          profileName = apiProfile.name;
          this.debugLog('[UsageMonitor:FETCH] Found API profile:', {
            profileId,
            profileName,
            baseUrl: apiProfile.baseUrl
          });
        }
      } catch (error) {
        // Failed to load API profiles, continue to OAuth check
        this.debugLog('[UsageMonitor:FETCH] Failed to load API profiles:', error);
      }
    }

    // If not found in API profiles, check OAuth profiles
    if (!profileName) {
      const profileManager = getClaudeProfileManager();
      const oauthProfile = profileManager.getProfile(profileId);
      if (oauthProfile) {
        profileName = oauthProfile.name;
        // Get email from OAuth profile if not already set
        if (!profileEmail) {
          profileEmail = oauthProfile.email;
        }
        this.debugLog('[UsageMonitor:FETCH] Found OAuth profile:', {
          profileId,
          profileName,
          profileEmail
        });
      }
    }

    // If still not found, return null
    if (!profileName) {
      this.debugLog('[UsageMonitor:FETCH] Profile not found in either API or OAuth profiles: ' + profileId);
      return null;
    }

    this.debugLog('[UsageMonitor:FETCH] Starting usage fetch:', {
      profileId,
      profileName,
      hasCredential: !!credential,
      useApiMethod: this.shouldUseApiMethod(profileId)
    });

    // Attempt 1: Direct API call (preferred)
    // Per-profile tracking: if API fails for one profile, it only affects that profile
    if (this.shouldUseApiMethod(profileId) && credential) {
      this.debugLog('[UsageMonitor:FETCH] Attempting API fetch method');
      const apiUsage = await this.fetchUsageViaAPI(credential, profileId, profileName, profileEmail, activeProfile);
      if (apiUsage) {
        this.debugLog('[UsageMonitor] Successfully fetched via API');
        this.debugLog('[UsageMonitor:FETCH] API fetch successful:', {
          sessionPercent: apiUsage.sessionPercent,
          weeklyPercent: apiUsage.weeklyPercent
        });
        return apiUsage;
      }

      // API failed — fetchUsageViaAPI records cooldown timestamp for all errors (including 429).
      this.debugLog('[UsageMonitor:FETCH] API fetch failed, will retry after cooldown');
    } else if (!credential) {
      this.debugLog('[UsageMonitor:FETCH] No credential available, skipping API method');
    }

    // Attempt 2: CLI /usage command (fallback)
    // NEVER skip CLI fallback based on API failure state — CLI reads ~/.claude/.credentials.json
    // which may have a different token. Blocking CLI during 429 cooldown killed the meter 3 times.
    this.debugLog('[UsageMonitor:FETCH] Attempting CLI fallback method');
    return await this.fetchUsageViaCLI(profileId, profileName);
  }

  /**
   * Fetch usage via provider-specific API endpoints
   *
   * Supports multiple providers with automatic detection:
   * - Anthropic OAuth: https://api.anthropic.com/api/oauth/usage
   * - z.ai: https://api.z.ai/api/monitor/usage/model-usage
   * - ZHIPU: https://open.bigmodel.cn/api/monitor/usage/model-usage
   *
   * Detects provider from active profile's baseUrl and routes to appropriate endpoint.
   * Normalizes all provider responses to common ClaudeUsageSnapshot format.
   *
   * @param credential - OAuth token or API key
   * @param profileId - Profile identifier
   * @param profileName - Profile display name
   * @param profileEmail - Optional email associated with the profile
   * @param activeProfile - Optional pre-determined active profile info to avoid race conditions
   * @returns Normalized usage snapshot or null on failure
   */
  private tryNormalizeResponse(
    data: any, profileId: string, profileName: string,
    profileEmail: string | undefined, provider: ApiProvider
  ): ClaudeUsageSnapshot | null {
    try {
      if (provider === 'anthropic') {
        return this.normalizeAnthropicResponse(data, profileId, profileName, profileEmail);
      }
      if (provider === 'zai' || provider === 'zhipu') {
        const inner = data.data ?? data;
        return this.normalizeQuotaLimitResponse(inner, profileId, profileName, profileEmail, provider);
      }
      if (provider === 'minimax') {
        return this.normalizeMiniMaxResponse(data, profileId, profileName, profileEmail);
      }
    } catch {
      // Normalization failed — caller handles fallback
    }
    return null;
  }

  private async fetchUsageViaAPI(
    credential: string,
    profileId: string,
    profileName: string,
    profileEmail?: string,
    activeProfile?: ActiveProfileResult
  ): Promise<ClaudeUsageSnapshot | null> {
    this.debugLog('[UsageMonitor:API_FETCH] Starting API fetch for usage:', {
      profileId,
      profileName,
      hasCredential: !!credential,
      hasActiveProfile: !!activeProfile
    });

    try {
      // Step 1: Determine if we're using an API profile or OAuth profile
      // Use passed activeProfile if available, otherwise detect to maintain backward compatibility
      let apiProfile: APIProfile | undefined;
      let baseUrl: string;
      let provider: ApiProvider;

      if (activeProfile?.isAPIProfile) {
        // Use the pre-determined profile to avoid race conditions
        // Trust the activeProfile data and use baseUrl directly
        baseUrl = activeProfile.baseUrl;
        provider = detectProvider(baseUrl);
      } else if (activeProfile && !activeProfile.isAPIProfile) {
        // OAuth profile - always Anthropic
        provider = 'anthropic';
        baseUrl = 'https://api.anthropic.com';
      } else {
        // No activeProfile passed - need to detect from profiles file
        const profilesFile = await loadProfilesFile();
        apiProfile = profilesFile.profiles.find(p => p.id === profileId);

        if (apiProfile?.apiKey) {
          // API profile found
          baseUrl = apiProfile.baseUrl;
          provider = detectProvider(baseUrl);
        } else {
          // OAuth profile fallback
          provider = 'anthropic';
          baseUrl = 'https://api.anthropic.com';
        }
      }

      const isAPIProfile = !!apiProfile;
      this.debugLog('[UsageMonitor:TRACE] Fetching usage', {
        provider,
        baseUrl,
        isAPIProfile,
        profileId
      });

      // Step 3: Get provider-specific usage endpoint
      const usageEndpoint = getUsageEndpoint(provider, baseUrl);
      if (!usageEndpoint) {
        this.debugLog('[UsageMonitor] Unknown provider - no usage endpoint configured:', {
          provider,
          baseUrl,
          profileId
        });
        return null;
      }

      this.debugLog('[UsageMonitor:API_FETCH] API request:', {
        endpoint: usageEndpoint,
        profileId,
        credentialFingerprint: getCredentialFingerprint(credential)
      });

      this.debugLog('[UsageMonitor:API_FETCH] Fetching from endpoint:', {
        provider,
        endpoint: usageEndpoint,
        hasCredential: !!credential
      });

      // Step 4: Validate endpoint domain before making request
      // Security: Only allow requests to known provider domains
      let endpointHostname: string;
      try {
        const endpointUrl = new URL(usageEndpoint);
        endpointHostname = endpointUrl.hostname;
      } catch {
        console.error('[UsageMonitor] Invalid usage endpoint URL:', usageEndpoint);
        return null;
      }

      if (!ALLOWED_USAGE_API_DOMAINS.has(endpointHostname)) {
        console.error('[UsageMonitor] Blocked request to unauthorized domain:', endpointHostname, {
          allowedDomains: Array.from(ALLOWED_USAGE_API_DOMAINS)
        });
        return null;
      }

      // Step 5: Fetch usage from provider endpoint
      // All providers use Bearer token authentication (RFC 6750)
      const authHeader = `Bearer ${credential}`;

      // Build headers based on provider
      // Anthropic OAuth requires the 'anthropic-beta: oauth-2025-04-20' header
      // See: https://codelynx.dev/posts/claude-code-usage-limits-statusline
      const headers: Record<string, string> = {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      };

      if (provider === 'anthropic') {
        // OAuth authentication requires the beta header
        headers['anthropic-beta'] = 'oauth-2025-04-20';
        headers['anthropic-version'] = '2023-06-01';
      }

      const response = await fetch(usageEndpoint, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        console.error('[UsageMonitor] API error:', response.status, response.statusText, {
          provider,
          endpoint: usageEndpoint
        });

        // Check for auth failures via status code (works for all providers)
        if (response.status === 401 || response.status === 403) {
          const error = new Error(`API Auth Failure: ${response.status} (${provider})`);
          (error as any).statusCode = response.status;
          throw error;
        }

        // 429 means Anthropic is rate-limiting the usage API endpoint itself.
        // Record failure timestamp so shouldUseApiMethod() skips API for 2 minutes.
        // Without this, we spam the endpoint every 30s and never recover (the 429 never clears).
        if (response.status === 429) {
          console.log('[UsageMonitor] 429 rate-limited on usage API — applying 2-min cooldown');
          this.apiFailureTimestamps.set(profileId, Date.now());
          return null;
        }

        // For other error statuses, try to parse response body to detect auth failures
        // This handles cases where providers might return different status codes for auth errors
        let errorData: any;
        try {
          errorData = await response.json();
        } catch (parseError) {
          // If we can't parse the error response, just log it and continue
          this.debugLog('[UsageMonitor:AUTH_DETECTION] Could not parse error response body:', {
            provider,
            status: response.status,
            parseError
          });
          // Record failure timestamp for cooldown retry
          this.apiFailureTimestamps.set(profileId, Date.now());
          return null;
        }

        this.debugLog('[UsageMonitor:AUTH_DETECTION] Checking error response for auth failure:', {
          provider,
          status: response.status,
          errorData
        });

        // Check for common auth error patterns in response body
        const authErrorPatterns = [
          'unauthorized',
          'authentication',
          'invalid token',
          'invalid api key',
          'expired token',
          'forbidden',
          'access denied',
          'credentials',
          'auth failed'
        ];

        const errorText = JSON.stringify(errorData).toLowerCase();
        const hasAuthError = authErrorPatterns.some(pattern => errorText.includes(pattern));

        if (hasAuthError) {
          const error = new Error(`API Auth Failure detected in response body (${provider}): ${JSON.stringify(errorData)}`);
          (error as any).statusCode = response.status; // Include original status code
          (error as any).detectedInBody = true;
          throw error;
        }

        // Record failure timestamp for cooldown retry (non-auth error)
        this.apiFailureTimestamps.set(profileId, Date.now());
        return null;
      }

      this.debugLog('[UsageMonitor:API_FETCH] API response received successfully:', {
        provider,
        status: response.status,
        contentType: response.headers.get('content-type')
      });

      // Step 5: Parse and normalize response based on provider
      const rawData = await response.json();

      this.debugLog('[UsageMonitor:PROVIDER] Raw response from ' + provider + ':', JSON.stringify(rawData, null, 2));

      // Step 6: Extract data wrapper for z.ai and ZHIPU responses
      // These providers wrap the actual usage data in a 'data' field
      let responseData = rawData;
      if (provider === 'zai' || provider === 'zhipu') {
        if (rawData.data) {
          responseData = rawData.data;
          this.debugLog('[UsageMonitor:PROVIDER] Extracted data field from response:', {
            provider,
            extractedData: JSON.stringify(responseData, null, 2)
          });
        } else {
          this.debugLog('[UsageMonitor:PROVIDER] No data field found in response, using raw response:', {
            provider,
            responseKeys: Object.keys(rawData)
          });
        }
      }

      // Step 7: Normalize response based on provider type
      let normalizedUsage: ClaudeUsageSnapshot | null = null;

      this.debugLog('[UsageMonitor:NORMALIZATION] Selecting normalization method:', {
        provider,
        method: `normalize${provider.charAt(0).toUpperCase() + provider.slice(1)}Response`
      });

      switch (provider) {
        case 'anthropic':
          normalizedUsage = this.normalizeAnthropicResponse(rawData, profileId, profileName, profileEmail);
          break;
        case 'zai':
          normalizedUsage = this.normalizeZAIResponse(responseData, profileId, profileName, profileEmail);
          break;
        case 'zhipu':
          normalizedUsage = this.normalizeZhipuResponse(responseData, profileId, profileName, profileEmail);
          break;
        case 'minimax':
          normalizedUsage = this.normalizeMiniMaxResponse(rawData, profileId, profileName, profileEmail);
          break;
        default:
          this.debugLog('[UsageMonitor] Unsupported provider for usage normalization: ' + provider);
          return null;
      }

      if (!normalizedUsage) {
        this.debugLog('[UsageMonitor] Failed to normalize response from ' + provider);
        // Record failure timestamp for cooldown retry (normalization failure)
        this.apiFailureTimestamps.set(profileId, Date.now());
        return null;
      }

      this.debugLog('[UsageMonitor:API_FETCH] Fetch completed - usage:', {
        profileId,
        profileName,
        email: normalizedUsage.profileEmail,
        provider,
        sessionPercent: normalizedUsage.sessionPercent,
        weeklyPercent: normalizedUsage.weeklyPercent,
        limitType: normalizedUsage.limitType
      });
      this.debugLog('[UsageMonitor:API_FETCH] API fetch completed successfully');

      return normalizedUsage;
    } catch (error: any) {
      // Re-throw auth failures to be handled by checkUsageAndSwap
      // This includes both status code auth failures (401/403) and body-detected failures
      if (error?.message?.includes('Auth Failure') || error?.statusCode === 401 || error?.statusCode === 403) {
        throw error;
      }

      console.error('[UsageMonitor] API fetch failed:', error);
      // Record failure timestamp for cooldown retry (network/other errors)
      this.apiFailureTimestamps.set(profileId, Date.now());
      return null;
    }
  }

  /**
   * Normalize Anthropic API response to ClaudeUsageSnapshot
   *
   * Actual Anthropic OAuth usage API response format:
   * {
   *   "five_hour": {
   *     "utilization": 19,  // integer 0-100
   *     "resets_at": "2025-01-17T15:00:00Z"
   *   },
   *   "seven_day": {
   *     "utilization": 45,  // integer 0-100
   *     "resets_at": "2025-01-20T12:00:00Z"
   *   }
   * }
   */
  private normalizeAnthropicResponse(
    data: any,
    profileId: string,
    profileName: string,
    profileEmail?: string
  ): ClaudeUsageSnapshot {
    // Support both new nested format and legacy flat format for backward compatibility
    //
    // NEW format (current API): { five_hour: { utilization: 72, resets_at: "..." } }
    // OLD format (legacy):      { five_hour_utilization: 0.72, five_hour_reset_at: "..." }

    let fiveHourUtil: number;
    let sevenDayUtil: number;
    let sessionResetTimestamp: string | undefined;
    let weeklyResetTimestamp: string | undefined;

    // Check for new nested format first
    if (data.five_hour !== undefined || data.seven_day !== undefined) {
      // New nested format - utilization is already 0-100 integer
      fiveHourUtil = data.five_hour?.utilization ?? 0;
      sevenDayUtil = data.seven_day?.utilization ?? 0;
      sessionResetTimestamp = data.five_hour?.resets_at;
      weeklyResetTimestamp = data.seven_day?.resets_at;
    } else {
      // Legacy flat format - utilization is 0-1 float, needs *100
      const rawFiveHour = data.five_hour_utilization ?? 0;
      const rawSevenDay = data.seven_day_utilization ?? 0;
      // Convert 0-1 float to 0-100 integer
      fiveHourUtil = Math.round(rawFiveHour * 100);
      sevenDayUtil = Math.round(rawSevenDay * 100);
      sessionResetTimestamp = data.five_hour_reset_at;
      weeklyResetTimestamp = data.seven_day_reset_at;
    }

    return {
      sessionPercent: fiveHourUtil,
      weeklyPercent: sevenDayUtil,
      // Omit sessionResetTime/weeklyResetTime - renderer uses timestamps with formatTimeRemaining
      sessionResetTime: undefined,
      weeklyResetTime: undefined,
      sessionResetTimestamp,
      weeklyResetTimestamp,
      profileId,
      profileName,
      profileEmail,
      fetchedAt: new Date(),
      limitType: sevenDayUtil > fiveHourUtil ? 'weekly' : 'session',
      usageWindows: {
        sessionWindowLabel: 'common:usage.window5Hour',
        weeklyWindowLabel: 'common:usage.window7Day'
      }
    };
  }

  /**
   * Normalize quota/limit response for z.ai and ZHIPU providers
   *
   * Both providers use the same response format with a limits array containing
   * TOKENS_LIMIT (5-hour usage) and TIME_LIMIT (monthly usage) items.
   *
   * @param data - Raw response data with limits array
   * @param profileId - Profile identifier
   * @param profileName - Profile display name
   * @param profileEmail - Optional email associated with the profile
   * @param providerName - Provider name for logging ('zai' or 'zhipu')
   * @returns Normalized usage snapshot or null on parse failure
   */
  private normalizeQuotaLimitResponse(
    data: any,
    profileId: string,
    profileName: string,
    profileEmail: string | undefined,
    providerName: 'zai' | 'zhipu'
  ): ClaudeUsageSnapshot | null {
    const logPrefix = providerName.toUpperCase();

    if (this.isDebug) {
      console.warn(`[UsageMonitor:${logPrefix}_NORMALIZATION] Starting normalization:`, {
        profileId,
        profileName,
        responseKeys: Object.keys(data),
        hasLimits: !!data.limits,
        limitsCount: data.limits?.length || 0
      });
    }

    try {
      // Check if response has limits array
      if (!data || !Array.isArray(data.limits)) {
        console.warn(`[UsageMonitor:${logPrefix}] Invalid response format - missing limits array:`, {
          hasData: !!data,
          hasLimits: !!data?.limits,
          limitsType: typeof data?.limits
        });
        return null;
      }

      // Find TOKENS_LIMIT (5-hour usage) and TIME_LIMIT (monthly usage)
      const tokensLimit = data.limits.find((item: any) => item.type === 'TOKENS_LIMIT');
      const timeLimit = data.limits.find((item: any) => item.type === 'TIME_LIMIT');

      if (this.isDebug) {
        console.warn(`[UsageMonitor:${logPrefix}_NORMALIZATION] Found limit types:`, {
          hasTokensLimit: !!tokensLimit,
          hasTimeLimit: !!timeLimit,
          tokensLimit: tokensLimit ? {
            type: tokensLimit.type,
            unit: tokensLimit.unit,
            number: tokensLimit.number,
            usage: tokensLimit.usage,
            currentValue: tokensLimit.currentValue,
            remaining: tokensLimit.remaining,
            percentage: tokensLimit.percentage,
            nextResetTime: tokensLimit.nextResetTime,
            nextResetDate: tokensLimit.nextResetTime ? new Date(tokensLimit.nextResetTime).toISOString() : undefined
          } : null,
          timeLimit: timeLimit ? {
            type: timeLimit.type,
            percentage: timeLimit.percentage,
            currentValue: timeLimit.currentValue,
            remaining: timeLimit.remaining
          } : null
        });
      }

      // Extract percentages
      const sessionPercent = tokensLimit?.percentage !== undefined
        ? Math.round(tokensLimit.percentage)
        : 0;

      const weeklyPercent = timeLimit?.percentage !== undefined
        ? Math.round(timeLimit.percentage)
        : 0;

      if (this.isDebug) {
        console.warn(`[UsageMonitor:${logPrefix}_NORMALIZATION] Extracted usage:`, {
          sessionPercent,
          weeklyPercent,
          limitType: weeklyPercent > sessionPercent ? 'weekly' : 'session'
        });
      }

      // Extract reset time from API response
      // The API provides nextResetTime as a Unix timestamp (milliseconds) for TOKENS_LIMIT
      const now = new Date();
      let sessionResetTimestamp: string;

      if (tokensLimit?.nextResetTime && typeof tokensLimit.nextResetTime === 'number') {
        // Use the reset time from the API response (Unix timestamp in ms)
        sessionResetTimestamp = new Date(tokensLimit.nextResetTime).toISOString();
      } else {
        // Fallback: calculate as 5 hours from now
        sessionResetTimestamp = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
      }

      // Calculate monthly reset time (1st of next month at midnight UTC)
      const nextMonth = new Date(now);
      nextMonth.setUTCMonth(now.getUTCMonth() + 1, 1);
      nextMonth.setUTCHours(0, 0, 0, 0);
      const weeklyResetTimestamp = nextMonth.toISOString();

      return {
        sessionPercent,
        weeklyPercent,
        // Omit sessionResetTime/weeklyResetTime - renderer uses timestamps with formatTimeRemaining
        sessionResetTime: undefined,
        weeklyResetTime: undefined,
        sessionResetTimestamp,
        weeklyResetTimestamp,
        profileId,
        profileName,
        profileEmail,
        fetchedAt: new Date(),
        limitType: weeklyPercent > sessionPercent ? 'weekly' : 'session',
        usageWindows: {
          sessionWindowLabel: 'common:usage.window5HoursQuota',
          weeklyWindowLabel: 'common:usage.windowMonthlyToolsQuota'
        },
        // Extract raw usage values for display in tooltip
        sessionUsageValue: tokensLimit?.currentValue,
        sessionUsageLimit: tokensLimit?.usage,
        weeklyUsageValue: timeLimit?.currentValue,
        weeklyUsageLimit: timeLimit?.usage
      };
    } catch (error) {
      console.error(`[UsageMonitor:${logPrefix}] Failed to parse quota/limit response:`, error, 'Raw data:', data);
      return null;
    }
  }

  /**
   * Normalize z.ai API response to ClaudeUsageSnapshot
   *
   * Expected endpoint: https://api.z.ai/api/monitor/usage/quota/limit
   *
   * Response format (from empirical testing):
   * {
   *   "data": {
   *     "limits": [
   *       {
   *         "type": "TOKENS_LIMIT",
   *         "percentage": 75.5
   *       },
   *       {
   *         "type": "TIME_LIMIT",
   *         "percentage": 45.2,
   *         "currentValue": 12345,
   *         "usage": 50000,
   *         "usageDetails": {...}
   *       }
   *     ]
   *   }
   * }
   *
   * Maps TOKENS_LIMIT → session usage (5-hour window)
   * Maps TIME_LIMIT → monthly usage (displayed as weekly in UI)
   */
  private normalizeZAIResponse(
    data: any,
    profileId: string,
    profileName: string,
    profileEmail?: string
  ): ClaudeUsageSnapshot | null {
    // Delegate to shared quota/limit response normalization
    return this.normalizeQuotaLimitResponse(data, profileId, profileName, profileEmail, 'zai');
  }

  /**
   * Normalize ZHIPU AI response to ClaudeUsageSnapshot
   *
   * Expected endpoint: https://open.bigmodel.cn/api/monitor/usage/quota/limit
   *
   * Uses the same response format as z.ai with limits array containing
   * TOKENS_LIMIT and TIME_LIMIT items.
   */
  private normalizeZhipuResponse(
    data: any,
    profileId: string,
    profileName: string,
    profileEmail?: string
  ): ClaudeUsageSnapshot | null {
    // Delegate to shared quota/limit response normalization
    return this.normalizeQuotaLimitResponse(data, profileId, profileName, profileEmail, 'zhipu');
  }

  /**
   * Normalize MiniMax Coding Plan response to ClaudeUsageSnapshot
   *
   * Endpoint: https://api.minimax.io/v1/api/openplatform/coding_plan/remains
   *
   * Actual response format:
   * {
   *   "model_remains": [
   *     {
   *       "model_name": "MiniMax-M2.5",
   *       "current_interval_total_count": 15000,
   *       "current_interval_usage_count": 15000,
   *       "remains_time": 16470770,          // ms until session reset
   *       "current_weekly_total_count": 525000,
   *       "current_weekly_usage_count": 523971,
   *       "weekly_remains_time": 290070770,   // ms until weekly reset
   *       "start_time": 1773932400000,
   *       "end_time": 1773950400000
   *     }, ...
   *   ],
   *   "base_resp": {"status_code": 0, "status_msg": "success"}
   * }
   *
   * MiniMax has BOTH 5-hour session AND weekly limits (shared across models).
   */
  private normalizeMiniMaxResponse(
    data: any,
    profileId: string,
    profileName: string,
    profileEmail?: string
  ): ClaudeUsageSnapshot | null {
    const logPrefix = 'MINIMAX';

    try {
      const modelRemains = data.model_remains ?? data.data?.model_remains;

      if (!Array.isArray(modelRemains) || modelRemains.length === 0) {
        console.warn(`[UsageMonitor:${logPrefix}] Invalid response - missing model_remains array:`, {
          responseKeys: Object.keys(data || {}),
          hasModelRemains: !!data.model_remains
        });
        return null;
      }

      // Use the first model entry — limits are shared across all models
      const model = modelRemains[0];

      // The endpoint is "remains" — usage_count fields are REMAINING, not consumed
      const sessionTotal = model.current_interval_total_count;
      const sessionRemaining = model.current_interval_usage_count;
      const sessionUsed = sessionTotal - sessionRemaining;

      const sessionPercent = sessionTotal > 0 ? Math.round((sessionUsed / sessionTotal) * 100) : 0;

      // Reset timestamps from remains_time (ms from now)
      const now = Date.now();
      const sessionResetTimestamp = model.remains_time
        ? new Date(now + model.remains_time).toISOString()
        : new Date(model.end_time).toISOString();
      const weeklyResetTimestamp = model.weekly_remains_time
        ? new Date(now + model.weekly_remains_time).toISOString()
        : undefined;

      if (this.isDebug) {
        console.warn(`[UsageMonitor:${logPrefix}_NORMALIZATION] Extracted:`, {
          model: model.model_name,
          sessionPercent,
          sessionUsed, sessionRemaining, sessionTotal
        });
      }

      return {
        sessionPercent,
        weeklyPercent: 0, // MiniMax Coding Plan has no weekly limit
        sessionResetTime: undefined,
        weeklyResetTime: undefined,
        sessionResetTimestamp,
        weeklyResetTimestamp: undefined,
        profileId,
        profileName,
        profileEmail,
        fetchedAt: new Date(),
        limitType: 'session',
        usageWindows: {
          sessionWindowLabel: 'common:usage.window5HoursQuota'
          // No weeklyWindowLabel — hides weekly section in UsageIndicator
        },
        sessionUsageValue: sessionUsed,
        sessionUsageLimit: sessionTotal,
      };
    } catch (error) {
      console.error(`[UsageMonitor:${logPrefix}] Failed to parse response:`, error, 'Raw data:', data);
      return null;
    }
  }

  /**
   * Fetch usage via CLI /usage command (fallback)
   * Note: This is a fallback method. The API method is preferred.
   * CLI-based fetching would require spawning a Claude process and parsing output,
   * which is complex. For now, we rely on the API method.
   */
  private async fetchUsageViaCLI(
    profileId: string,
    profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    // This fallback reads ~/.claude/.credentials.json (same source as CLI `claude /usage`).
    // It only runs when the primary API method already failed (token expired, 429, etc.),
    // so there is no "double API call" — the primary call already returned null.
    console.log('[DIAG] CLI fallback: attempting to read ~/.claude/.credentials.json');
    try {
      const path = require('path');
      const { readFile, access } = require('fs/promises');
      const { constants } = require('fs');

      const credPath = path.join(homedir(), '.claude', '.credentials.json');
      try {
        await access(credPath, constants.R_OK);
      } catch {
        this.debugLog('[UsageMonitor] CLI fallback: no credentials file at ' + credPath);
        return null;
      }

      const credRaw = await readFile(credPath, 'utf8');
      const credData = JSON.parse(credRaw);
      const token = credData?.claudeAiOauth?.accessToken;
      if (!token) {
        this.debugLog('[UsageMonitor] CLI fallback: no access token in credentials file');
        return null;
      }

      // Make a direct API call with the Claude Code credential
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        this.debugLog('[UsageMonitor] CLI fallback: API returned ' + response.status);
        return null;
      }

      const rawData = await response.json();
      const normalized = this.normalizeAnthropicResponse(rawData, profileId, profileName, undefined);
      if (normalized) {
        console.log(`[DIAG] CLI fallback SUCCESS — S:${normalized.sessionPercent}% W:${normalized.weeklyPercent}%`);
      }
      return normalized;
    } catch (error) {
      console.log('[DIAG] CLI fallback FAILED:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Perform proactive profile swap
   * @param currentProfileId - The profile to switch from
   * @param limitType - The type of limit that triggered the swap
   * @param additionalExclusions - Additional profile IDs to exclude (e.g., auth-failed profiles)
   */
  private async performProactiveSwap(
    currentProfileId: string,
    limitType: 'session' | 'weekly',
    additionalExclusions: string[] = []
  ): Promise<void> {
    const profileManager = getClaudeProfileManager();
    const excludeIds = new Set([currentProfileId, ...additionalExclusions]);

    // Get priority order for unified account system
    const priorityOrder = profileManager.getAccountPriorityOrder();

    // Build unified list of available accounts
    type UnifiedSwapTarget = {
      id: string;
      unifiedId: string;  // oauth-{id} or api-{id}
      name: string;
      type: 'oauth' | 'api';
      priorityIndex: number;
    };

    const unifiedAccounts: UnifiedSwapTarget[] = [];

    // Add OAuth profiles (sorted by availability)
    const oauthProfiles = profileManager.getProfilesSortedByAvailability();
    for (const profile of oauthProfiles) {
      if (!excludeIds.has(profile.id)) {
        const unifiedId = `oauth-${profile.id}`;
        const priorityIndex = priorityOrder.indexOf(unifiedId);
        unifiedAccounts.push({
          id: profile.id,
          unifiedId,
          name: profile.name,
          type: 'oauth',
          priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex
        });
      }
    }

    // Add API profiles (always considered available since they have unlimited usage)
    try {
      const profilesFile = await loadProfilesFile();
      for (const apiProfile of profilesFile.profiles) {
        if (!excludeIds.has(apiProfile.id) && apiProfile.apiKey) {
          const unifiedId = `api-${apiProfile.id}`;
          const priorityIndex = priorityOrder.indexOf(unifiedId);
          unifiedAccounts.push({
            id: apiProfile.id,
            unifiedId,
            name: apiProfile.name,
            type: 'api',
            priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex
          });
        }
      }
    } catch (error) {
      this.debugLog('[UsageMonitor] Failed to load API profiles for swap:', error);
    }

    if (unifiedAccounts.length === 0) {
      this.debugLog('[UsageMonitor] No alternative profile for proactive swap (excluded:', Array.from(excludeIds));
      this.emit('proactive-swap-failed', {
        reason: additionalExclusions.length > 0 ? 'all_alternatives_failed_auth' : 'no_alternative',
        currentProfile: currentProfileId,
        excludedProfiles: Array.from(excludeIds)
      });
      return;
    }

    // Sort by priority order (lower index = higher priority)
    // If no priority order is set, OAuth profiles come first (they were already sorted by availability)
    unifiedAccounts.sort((a, b) => {
      // If both have priority indices, use them
      if (a.priorityIndex !== Infinity || b.priorityIndex !== Infinity) {
        return a.priorityIndex - b.priorityIndex;
      }
      // Otherwise, prefer OAuth profiles (which are sorted by availability)
      if (a.type !== b.type) {
        return a.type === 'oauth' ? -1 : 1;
      }
      return 0;
    });

    // Use the best available from unified accounts
    const bestAccount = unifiedAccounts[0];

    this.debugLog('[UsageMonitor] Proactive swap:', {
      from: currentProfileId,
      to: bestAccount.id,
      toType: bestAccount.type,
      reason: limitType
    });

    // Clear cache for the profile that's becoming inactive
    // This ensures the next fetch gets fresh data instead of stale cached values
    this.clearProfileUsageCache(currentProfileId);

    // Switch to the new profile
    // Note: bestAccount.id is already the raw profile ID (not unified format)
    const rawProfileId = bestAccount.id;

    if (bestAccount.type === 'oauth') {
      // Switch OAuth profile via profile manager
      profileManager.setActiveProfile(rawProfileId);
    } else {
      // Switch API profile via profile-manager service
      try {
        const { setActiveAPIProfile } = await import('../services/profile/profile-manager');
        await setActiveAPIProfile(rawProfileId);
      } catch (error) {
        console.error('[UsageMonitor] Failed to set active API profile:', error);
        return;
      }
    }

    // Get the "from" profile name
    let fromProfileName: string | undefined;
    const fromOAuthProfile = profileManager.getProfile(currentProfileId);
    if (fromOAuthProfile) {
      fromProfileName = fromOAuthProfile.name;
    } else {
      // It might be an API profile
      try {
        const profilesFile = await loadProfilesFile();
        const fromAPIProfile = profilesFile.profiles.find(p => p.id === currentProfileId);
        if (fromAPIProfile) {
          fromProfileName = fromAPIProfile.name;
        }
      } catch {
        // Ignore
      }
    }

    // Emit swap event
    this.emit('proactive-swap-completed', {
      fromProfile: { id: currentProfileId, name: fromProfileName },
      toProfile: { id: bestAccount.id, name: bestAccount.name },
      limitType,
      timestamp: new Date()
    });

    // Notify UI
    this.emit('show-swap-notification', {
      fromProfile: fromProfileName,
      toProfile: bestAccount.name,
      reason: 'proactive',
      limitType
    });

    // PROACTIVE OPERATION RESTART: Stop and restart all running Claude SDK operations with new profile credentials
    // This includes autonomous tasks, PR reviews, insights, roadmap, etc.
    // Claude Agent SDK sessions maintain state independently of auth tokens, so no progress is lost
    const operationRegistry = getOperationRegistry();
    const operationSummary = operationRegistry.getSummary();
    const operationIdsOnOldProfile = operationSummary.byProfile[currentProfileId] || [];

    // Always log running operations info for debugging
    console.log('[UsageMonitor] PROACTIVE-SWAP: Checking running operations:', {
      oldProfileId: currentProfileId,
      newProfileId: bestAccount.id,
      totalRunning: operationSummary.totalRunning,
      byProfile: operationSummary.byProfile,
      byType: operationSummary.byType,
      operationIdsOnOldProfile: operationIdsOnOldProfile
    });

    if (operationIdsOnOldProfile.length > 0) {
      console.log('[UsageMonitor] PROACTIVE-SWAP: Found', operationIdsOnOldProfile.length, 'operations to restart:', operationIdsOnOldProfile);

      // Restart all operations on the old profile with the new profile
      const restartedCount = await operationRegistry.restartOperationsOnProfile(
        currentProfileId,
        bestAccount.id,
        bestAccount.name
      );

      // Emit event for tracking/logging
      this.emit('proactive-operations-restarted', {
        fromProfile: { id: currentProfileId, name: fromProfileName },
        toProfile: { id: bestAccount.id, name: bestAccount.name },
        operationIds: operationIdsOnOldProfile,
        restartedCount,
        limitType,
        timestamp: new Date()
      });
    } else {
      console.log('[UsageMonitor] PROACTIVE-SWAP: No operations running on old profile', currentProfileId, '- swap complete without restart');
    }

    // Note: Don't immediately check new profile - let normal interval handle it
    // This prevents cascading swaps if multiple profiles are near limits
  }
}

/**
 * Get the singleton UsageMonitor instance
 */
export function getUsageMonitor(): UsageMonitor {
  return UsageMonitor.getInstance();
}
