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
import { ensureValidCodexToken } from '../ai/auth/codex-oauth';
import { fetchCodexUsage, normalizeCodexResponse } from './codex-usage-fetcher';
import { readSettingsFileAsync, writeSettingsFile } from '../settings-utils';
import type { ProviderAccount } from '../../shared/types/provider-account';

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
  'chatgpt.com',
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
    provider: 'openai',
    usagePath: '/backend-api/wham/usage'
  },
  {
    provider: 'zai',
    usagePath: '/api/monitor/usage/quota/limit'
  },
  {
    provider: 'zhipu',
    usagePath: '/api/monitor/usage/quota/limit'
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
  const isVerbose = process.env.VERBOSE === 'true';

  if (isVerbose) {
    console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Constructing usage endpoint:', {
      provider,
      baseUrl
    });
  }

  const endpointConfig = PROVIDER_USAGE_ENDPOINTS.find(e => e.provider === provider);
  if (!endpointConfig) {
    if (isVerbose) {
      console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Unknown provider - no endpoint configured:', {
        provider,
        availableProviders: PROVIDER_USAGE_ENDPOINTS.map(e => e.provider)
      });
    }
    return null;
  }

  if (isVerbose) {
    console.warn('[UsageMonitor:ENDPOINT_CONSTRUCTION] Found endpoint config for provider:', {
      provider,
      usagePath: endpointConfig.usagePath
    });
  }

  try {
    const url = new URL(baseUrl);
    const originalPath = url.pathname;
    // Replace the path with the usage endpoint path
    url.pathname = endpointConfig.usagePath;

    // Note: quota/limit endpoint doesn't require query parameters
    // The model-usage and tool-usage endpoints would need time windows, but we're using quota/limit

    const finalUrl = url.toString();

    if (isVerbose) {
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
    if (isVerbose) {
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
  // Wrapper around shared detectProvider with verbose logging for main process
  const isVerbose = process.env.VERBOSE === 'true';

  const provider = sharedDetectProvider(baseUrl);

  if (isVerbose) {
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
  private static PROFILE_USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache for inactive profiles

  // Request coalescing: track in-flight getAllProfilesUsage() promise to avoid parallel duplicate fetches
  private allProfilesUsageInflight: Promise<AllProfilesUsage | null> | null = null;

  // Timestamp of last inactive-profile refresh (for adaptive cadence)
  private lastInactiveProfileRefreshAt = 0;

  // Rate-limit (429) tracking: separate from general API failures, uses longer cooldown
  private rateLimitedProfiles: Map<string, number> = new Map(); // profileId -> 429 timestamp
  private static RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown for 429s

  // Debug flag for verbose logging
  private readonly isDebug = process.env.DEBUG === 'true';
  // Verbose flag for trace-level logging (only with VERBOSE=true)
  private readonly isVerbose = process.env.VERBOSE === 'true';

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
   * Trace log helper - only logs when VERBOSE=true (more granular than debug)
   */
  private traceLog(message: string, data?: unknown): void {
    if (this.isVerbose) {
      if (data !== undefined) {
        console.warn(message, data);
      } else {
        console.warn(message);
      }
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
   * Update interval: 60 seconds (60000ms) for active profile; inactive profiles every 5 minutes (adaptive: 60s when usage is high)
   */
  start(): void {
    if (this.intervalId) {
      this.debugLog('[UsageMonitor] Already running');
      return;
    }

    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();
    const interval = settings.usageCheckInterval || 60000; // 60 seconds for active profile polling

    this.debugLog('[UsageMonitor] Starting with interval: ' + interval + ' ms (60-second updates for active profile usage stats)');

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
  }

  /**
   * Get current usage snapshot (for UI indicator)
   */
  getCurrentUsage(): ClaudeUsageSnapshot | null {
    return this.currentUsage;
  }

  /**
   * Clear the usage cache for a specific profile.
   * Called after re-authentication to ensure fresh usage data is fetched.
   *
   * @param profileId - Profile identifier to clear cache for
   */
  clearProfileUsageCache(profileId: string): void {
    const deleted = this.allProfilesUsageCache.delete(profileId);

    // Also clear currentUsage if it belongs to this profile
    // This prevents stale data from being displayed when getAllProfilesUsage()
    // uses this.currentUsage for the active profile
    const clearedCurrentUsage = this.currentUsageProfileId === profileId;
    if (clearedCurrentUsage) {
      this.currentUsage = null;
      this.currentUsageProfileId = null;
    }

    this.debugLog('[UsageMonitor] Cleared usage cache for profile:', {
      profileId,
      wasInCache: deleted,
      clearedCurrentUsage
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
   * Called after re-authentication to give the user immediate feedback.
   */
  checkNow(): void {
    this.debugLog('[UsageMonitor] Immediate check triggered');
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
      // Fast path: no coalescing needed since this is synchronous-ish and returns quickly
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

      // Include Codex (OpenAI OAuth) accounts from providerAccounts
      await this.appendCodexAccounts(allProfiles);
      // Include Z.AI provider accounts from providerAccounts
      await this.appendZAIAccounts(allProfiles);

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

    // Request coalescing: if a fetch is already in-flight, return the existing promise
    // This prevents burst API calls when multiple callers trigger getAllProfilesUsage() simultaneously
    if (!forceRefresh && this.allProfilesUsageInflight) {
      return this.allProfilesUsageInflight;
    }

    this.allProfilesUsageInflight = this._doGetAllProfilesUsage(forceRefresh);
    try {
      return await this.allProfilesUsageInflight;
    } finally {
      this.allProfilesUsageInflight = null;
    }
  }

  private async _doGetAllProfilesUsage(
    forceRefresh: boolean
  ): Promise<AllProfilesUsage | null> {
    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getSettings();
    const activeProfileId = settings.activeProfileId;
    const now = Date.now();
    const allProfiles: ProfileUsageSummary[] = [];

    // First pass: identify profiles that need fresh data vs cached
    type ProfileToFetch = { profile: typeof settings.profiles[0]; index: number };
    const profilesToFetch: ProfileToFetch[] = [];
    const profileResults: (ProfileUsageSummary | null)[] = new Array(settings.profiles.length).fill(null);

    // Adaptive cache TTL: when active profile usage is high, refresh inactive profiles more
    // frequently (every 60s instead of 5min) because we may need to swap soon
    const activeUsageHigh = this.currentUsage
      ? (this.currentUsage.sessionPercent > 80 || this.currentUsage.weeklyPercent > 90)
      : false;
    const effectiveCacheTtl = activeUsageHigh
      ? 60 * 1000 // 60s when usage is high (swap-ready mode)
      : UsageMonitor.PROFILE_USAGE_CACHE_TTL_MS; // 5 min normally

    for (let i = 0; i < settings.profiles.length; i++) {
      const profile = settings.profiles[i];
      const cached = this.allProfilesUsageCache.get(profile.id);

      // Use cached data if fresh (within TTL) and not force refreshing
      if (!forceRefresh && cached && (now - cached.fetchedAt) < effectiveCacheTtl) {
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

      // Build provider lookup map for staggered fetching
      // OAuth profiles (with configDir) are always 'anthropic'; API profiles use their stored provider
      const providerAccountsMap = new Map<string, string>(); // profileId -> provider
      try {
        const appSettings = await readSettingsFileAsync();
        if (appSettings) {
          const accounts = (appSettings.providerAccounts as ProviderAccount[] | undefined) ?? [];
          for (const account of accounts) {
            providerAccountsMap.set(account.id, account.provider);
            if (account.claudeProfileId) {
              providerAccountsMap.set(account.claudeProfileId, account.provider);
            }
          }
        }
      } catch {
        // Use default 'anthropic' for all profiles if settings can't be read
      }

      // DEDUPLICATION: Group profiles by configDir to avoid fetching the same underlying
      // account multiple times. Multiple ClaudeProfileManager entries can point to the same
      // configDir (same OAuth credentials = same API endpoint = same usage data).
      // Only fetch once per unique configDir, then share the result with all siblings.
      type FetchItem = { profile: typeof profilesToFetch[0]['profile']; index: number };
      const configDirGroups = new Map<string, FetchItem[]>(); // configDir -> all profiles sharing it
      const noConfigDirItems: FetchItem[] = []; // profiles without configDir (API key profiles)

      for (const item of profilesToFetch) {
        const configDir = item.profile.configDir;
        if (configDir) {
          const group = configDirGroups.get(configDir) ?? [];
          group.push(item);
          configDirGroups.set(configDir, group);
        } else {
          noConfigDirItems.push(item);
        }
      }

      // Build the deduplicated fetch list: one representative per configDir + all non-configDir items
      const deduplicatedFetchItems: FetchItem[] = [];
      const configDirRepresentatives = new Map<string, FetchItem>(); // configDir -> representative item
      for (const [configDir, group] of configDirGroups) {
        const representative = group[0]; // fetch for the first profile in the group
        deduplicatedFetchItems.push(representative);
        configDirRepresentatives.set(configDir, representative);
      }
      deduplicatedFetchItems.push(...noConfigDirItems);

      if (configDirGroups.size < profilesToFetch.length - noConfigDirItems.length) {
        this.debugLog('[UsageMonitor] Deduplicated profiles by configDir:', {
          original: profilesToFetch.length,
          deduplicated: deduplicatedFetchItems.length,
          savedFetches: profilesToFetch.length - deduplicatedFetchItems.length
        });
      }

      // Group deduplicated items by provider for staggered fetching
      const providerGroups = new Map<string, FetchItem[]>();
      for (const item of deduplicatedFetchItems) {
        const provider = providerAccountsMap.get(item.profile.id) ?? 'anthropic';
        const group = providerGroups.get(provider) ?? [];
        group.push(item);
        providerGroups.set(provider, group);
      }

      // 15-second stagger between consecutive same-provider fetches
      const STAGGER_DELAY_MS = 15_000;

      // Fetch provider groups in parallel; within each group, stagger sequentially
      type FetchResult = {
        index: number;
        update: { profileId: string; sessionPercent: number; weeklyPercent: number } | null;
        profile: FetchItem['profile'];
        inactiveUsage: ClaudeUsageSnapshot | null;
        rateLimitStatus: ReturnType<typeof isProfileRateLimited>;
        sessionPercent?: number;
        weeklyPercent?: number;
      };
      const groupPromises = Array.from(providerGroups.values()).map(async (group) => {
        const groupResults: FetchResult[] = [];

        for (let gi = 0; gi < group.length; gi++) {
          if (gi > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, STAGGER_DELAY_MS));
          }
          const { profile, index } = group[gi];
          const inactiveUsage = await this.fetchUsageForInactiveProfile(profile);
          const rateLimitStatus = isProfileRateLimited(profile);

          if (inactiveUsage) {
            groupResults.push({
              index,
              update: { profileId: profile.id, sessionPercent: inactiveUsage.sessionPercent, weeklyPercent: inactiveUsage.weeklyPercent },
              profile,
              inactiveUsage,
              rateLimitStatus
            });
          } else {
            groupResults.push({
              index,
              update: null,
              profile,
              inactiveUsage,
              rateLimitStatus,
              sessionPercent: profile.usage?.sessionUsagePercent ?? 0,
              weeklyPercent: profile.usage?.weeklyUsagePercent ?? 0
            });
          }
        }
        return groupResults;
      });

      // Wait for all provider groups to complete in parallel
      const allGroupResults = await Promise.all(groupPromises);
      const fetchResults = allGroupResults.flat();

      // Build a map of configDir -> fetch result for sharing with sibling profiles
      const configDirFetchResults = new Map<string, FetchResult>();

      // Collect all updates and build summaries for fetched (representative) profiles
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

        // Store fetch result for sibling profiles sharing the same configDir
        if (profile.configDir) {
          configDirFetchResults.set(profile.configDir, result);
        }
      }

      // Propagate fetch results to sibling profiles that share the same configDir
      // (these were deduplicated above and not fetched individually)
      for (const [configDir, group] of configDirGroups) {
        if (group.length <= 1) continue; // No siblings to propagate to
        const representativeResult = configDirFetchResults.get(configDir);
        if (!representativeResult) continue;

        const { inactiveUsage } = representativeResult;
        const sessionPercent = representativeResult.update?.sessionPercent ?? representativeResult.sessionPercent ?? 0;
        const weeklyPercent = representativeResult.update?.weeklyPercent ?? representativeResult.weeklyPercent ?? 0;

        // Skip the first item (already processed as the representative)
        for (let si = 1; si < group.length; si++) {
          const sibling = group[si];
          const rateLimitStatus = isProfileRateLimited(sibling.profile);

          // Copy rate-limit/failure state from representative to sibling
          if (this.rateLimitedProfiles.has(representativeResult.profile.id)) {
            const ts = this.rateLimitedProfiles.get(representativeResult.profile.id)!;
            this.rateLimitedProfiles.set(sibling.profile.id, ts);
          }

          usageUpdates.push({ profileId: sibling.profile.id, sessionPercent, weeklyPercent });

          const summary: ProfileUsageSummary = {
            profileId: sibling.profile.id,
            profileName: sibling.profile.name,
            profileEmail: sibling.profile.email,
            sessionPercent,
            weeklyPercent,
            isAuthenticated: sibling.profile.isAuthenticated ?? false,
            isRateLimited: rateLimitStatus.limited,
            rateLimitType: rateLimitStatus.type,
            availabilityScore: this.calculateAvailabilityScore(
              sessionPercent,
              weeklyPercent,
              rateLimitStatus.limited,
              rateLimitStatus.type,
              sibling.profile.isAuthenticated ?? false
            ),
            isActive: sibling.profile.id === activeProfileId,
            lastFetchedAt: inactiveUsage?.fetchedAt?.toISOString() ?? sibling.profile.usage?.lastUpdated?.toISOString(),
            needsReauthentication: this.needsReauthProfiles.has(sibling.profile.id)
          };

          this.allProfilesUsageCache.set(sibling.profile.id, { usage: summary, fetchedAt: now });
          profileResults[sibling.index] = summary;
        }
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

    // Include Codex (OpenAI OAuth) accounts from providerAccounts
    await this.appendCodexAccounts(allProfiles);
    // Include Z.AI provider accounts from providerAccounts
    await this.appendZAIAccounts(allProfiles);

    // Sort by availability score (highest first = most available)
    allProfiles.sort((a, b) => b.availabilityScore - a.availabilityScore);

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      activeProfile: this.currentUsage!, // Non-null: _doGetAllProfilesUsage is only called when currentUsage is set
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

        // If we got a valid token (regardless of refresh), clear the needs-reauth flag.
        // This handles the case where the startup null-check in getAllProfilesUsage()
        // incorrectly marked the profile (sync keychain read returned null, but async
        // ensureValidToken succeeds later).
        if (token && !tokenResult.persistenceFailed) {
          this.needsReauthProfiles.delete(profile.id);
        }

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
        // Got a valid token from keychain fallback — clear stale needs-reauth flag
        this.needsReauthProfiles.delete(profile.id);
      }

      this.traceLog('[UsageMonitor] Fetching usage for inactive profile:', {
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
        this.traceLog('[UsageMonitor] Successfully fetched inactive profile usage:', {
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
   * Append Codex (OpenAI OAuth) provider accounts to the allProfiles list.
   * These accounts live in providerAccounts (settings.json), not in ClaudeProfileManager,
   * so they must be added separately.
   */
  private async appendCodexAccounts(allProfiles: ProfileUsageSummary[]): Promise<void> {
    try {
      const appSettings = await readSettingsFileAsync();
      if (!appSettings) return;

      const providerAccounts = (appSettings.providerAccounts as ProviderAccount[] | undefined) ?? [];

      for (const account of providerAccounts) {
        if (account.provider !== 'openai' || account.authType !== 'oauth') continue;
        // Skip if already present
        if (allProfiles.some(p => p.profileId === account.id)) continue;

        // If this account matches currentUsage, use that data
        if (this.currentUsage && this.currentUsage.profileId === account.id) {
          const s = this.currentUsage;
          allProfiles.push({
            profileId: s.profileId,
            profileName: s.profileName || account.name,
            profileEmail: s.profileEmail,
            sessionPercent: s.sessionPercent,
            weeklyPercent: s.weeklyPercent,
            sessionResetTimestamp: s.sessionResetTimestamp,
            weeklyResetTimestamp: s.weeklyResetTimestamp,
            isAuthenticated: true,
            isRateLimited: s.sessionPercent >= 95 || s.weeklyPercent >= 95,
            rateLimitType: s.limitType,
            availabilityScore: this.calculateAvailabilityScore(s.sessionPercent, s.weeklyPercent, false, undefined, true),
            isActive: true,
            lastFetchedAt: s.fetchedAt instanceof Date ? s.fetchedAt.toISOString() : undefined,
            needsReauthentication: s.needsReauthentication,
          });
          continue;
        }

        // Inactive Codex account — try to fetch its usage
        try {
          const token = await ensureValidCodexToken();
          if (token) {
            const { getCodexAccountId } = await import('./codex-usage-fetcher');
            const codexAccountId = getCodexAccountId(token);
            const rawData = await fetchCodexUsage(token, codexAccountId);
            if (rawData) {
              const n = normalizeCodexResponse(rawData, account.id, account.name);
              allProfiles.push({
                profileId: account.id,
                profileName: account.name,
                profileEmail: n.profileEmail,
                sessionPercent: n.sessionPercent,
                weeklyPercent: n.weeklyPercent,
                sessionResetTimestamp: n.sessionResetTimestamp,
                weeklyResetTimestamp: n.weeklyResetTimestamp,
                isAuthenticated: true,
                isRateLimited: n.sessionPercent >= 95 || n.weeklyPercent >= 95,
                rateLimitType: n.limitType,
                availabilityScore: this.calculateAvailabilityScore(n.sessionPercent, n.weeklyPercent, false, undefined, true),
                isActive: false,
                lastFetchedAt: new Date().toISOString(),
                needsReauthentication: false,
              });
              continue;
            }
          }
        } catch {
          // Fetch failed — add minimal entry below
        }

        // No data available — add minimal entry so the account appears in the list
        allProfiles.push({
          profileId: account.id,
          profileName: account.name,
          sessionPercent: 0,
          weeklyPercent: 0,
          isAuthenticated: true,
          isRateLimited: false,
          availabilityScore: 100,
          isActive: false,
        });
      }
    } catch (error) {
      this.debugLog('[UsageMonitor] Failed to append Codex accounts:', error);
    }
  }

  /**
   * Append Z.AI provider accounts to the allProfiles list.
   * Z.AI accounts use API keys and have a quota/limit monitoring API.
   */
  private async appendZAIAccounts(allProfiles: ProfileUsageSummary[]): Promise<void> {
    try {
      const appSettings = await readSettingsFileAsync();
      if (!appSettings) return;

      const providerAccounts = (appSettings.providerAccounts as ProviderAccount[] | undefined) ?? [];

      for (const account of providerAccounts) {
        if (account.provider !== 'zai' || !account.apiKey) continue;
        // Skip if already present
        if (allProfiles.some(p => p.profileId === account.id)) continue;

        // If this account matches currentUsage, use that data
        if (this.currentUsage && this.currentUsage.profileId === account.id) {
          const s = this.currentUsage;
          allProfiles.push({
            profileId: s.profileId,
            profileName: s.profileName || account.name,
            profileEmail: s.profileEmail,
            sessionPercent: s.sessionPercent,
            weeklyPercent: s.weeklyPercent,
            sessionResetTimestamp: s.sessionResetTimestamp,
            weeklyResetTimestamp: s.weeklyResetTimestamp,
            isAuthenticated: true,
            isRateLimited: s.sessionPercent >= 95 || s.weeklyPercent >= 95,
            rateLimitType: s.limitType,
            availabilityScore: this.calculateAvailabilityScore(s.sessionPercent, s.weeklyPercent, false, undefined, true),
            isActive: true,
            lastFetchedAt: s.fetchedAt instanceof Date ? s.fetchedAt.toISOString() : undefined,
            needsReauthentication: false,
          });
          continue;
        }

        // Inactive Z.AI account — try to fetch its usage
        try {
          // CodeQL: file data in outbound request - validate API key is a non-empty string before use
          const safeApiKey = typeof account.apiKey === 'string' && account.apiKey.length > 0 ? account.apiKey : '';
          const response = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
            headers: {
              'Authorization': safeApiKey,
            },
          });
          if (response.ok) {
            const json = await response.json();
            // Z.AI wraps response in a data field
            const rawData = json.data ?? json;
            const normalized = this.normalizeZAIResponse(rawData, account.id, account.name);
            if (normalized) {
              allProfiles.push({
                profileId: account.id,
                profileName: account.name,
                profileEmail: normalized.profileEmail,
                sessionPercent: normalized.sessionPercent,
                weeklyPercent: normalized.weeklyPercent,
                sessionResetTimestamp: normalized.sessionResetTimestamp,
                weeklyResetTimestamp: normalized.weeklyResetTimestamp,
                isAuthenticated: true,
                isRateLimited: normalized.sessionPercent >= 95 || normalized.weeklyPercent >= 95,
                rateLimitType: normalized.limitType,
                availabilityScore: this.calculateAvailabilityScore(normalized.sessionPercent, normalized.weeklyPercent, false, undefined, true),
                isActive: false,
                lastFetchedAt: new Date().toISOString(),
                needsReauthentication: false,
              });
              continue;
            }
          }
        } catch {
          // Fetch failed — add minimal entry below
        }

        // No data available — add minimal entry so the account appears in the list
        allProfiles.push({
          profileId: account.id,
          profileName: account.name,
          sessionPercent: 0,
          weeklyPercent: 0,
          isAuthenticated: true,
          isRateLimited: false,
          availabilityScore: 100,
          isActive: false,
        });
      }
    } catch (error) {
      this.debugLog('[UsageMonitor] Failed to append Z.AI accounts:', error);
    }
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
          this.traceLog('[UsageMonitor:TRACE] Using API profile credential: ' + activeProfile.name);
          return activeProfile.apiKey;
        }
      }
    } catch (error) {
      // API profile loading failed, fall through to OAuth
      this.traceLog('[UsageMonitor:TRACE] Failed to load API profiles, falling back to OAuth:', error);
    }

    // Check for Codex OAuth token (OpenAI)
    try {
      const settings = await readSettingsFileAsync();
      if (settings) {
        const providerAccounts = (settings.providerAccounts as ProviderAccount[] | undefined) ?? [];
        const queue = (settings.globalPriorityOrder as string[] | undefined) ?? [];
        for (const accountId of queue) {
          const account = providerAccounts.find(a => a.id === accountId);
          if (account?.provider === 'openai' && account.authType === 'oauth') {
            const codexToken = await ensureValidCodexToken();
            if (codexToken) {
              this.traceLog('[UsageMonitor:TRACE] Using Codex OAuth token', {
                tokenFingerprint: getCredentialFingerprint(codexToken)
              });
              return codexToken;
            }
            this.traceLog('[UsageMonitor:TRACE] Codex OAuth token not available');
            break;
          }
        }
      }
    } catch (error) {
      this.traceLog('[UsageMonitor:TRACE] Failed to get Codex token, falling back to Claude OAuth:', error);
    }

    // Fall back to Claude OAuth profile - use ensureValidToken for proactive refresh
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
          // Valid token obtained — clear any stale needs-reauth flag
          if (!tokenResult.persistenceFailed) {
            this.needsReauthProfiles.delete(activeProfile.id);
          }
          this.traceLog('[UsageMonitor:TRACE] Using OAuth token for profile: ' + activeProfile.name, {
            tokenFingerprint: getCredentialFingerprint(tokenResult.token),
            wasRefreshed: tokenResult.wasRefreshed
          });
          return tokenResult.token;
        }

        // Token unavailable - log the error
        if (tokenResult.error) {
          this.traceLog('[UsageMonitor:TRACE] Token validation failed:', tokenResult.error);

          // Check for invalid_grant error - indicates refresh token is permanently invalid
          // and user needs to manually re-authenticate
          if (tokenResult.errorCode === 'invalid_grant') {
            this.traceLog('[UsageMonitor:TRACE] Profile needs re-authentication (invalid refresh token): ' + activeProfile.name);
            this.needsReauthProfiles.add(activeProfile.id);
          }

          // Check for missing_credentials error - indicates no token in credential store
          // User needs to authenticate via /login
          if (tokenResult.errorCode === 'missing_credentials') {
            this.traceLog('[UsageMonitor:TRACE] Profile needs authentication (no credentials found): ' + activeProfile.name);
            this.needsReauthProfiles.add(activeProfile.id);
          }
        }
      } catch (error) {
        console.error('[UsageMonitor] ensureValidToken threw error:', error);
      }

      // Fallback: Try direct keychain read (e.g., if refresh token unavailable)
      const keychainCreds = getCredentialsFromKeychain(activeProfile.configDir);
      if (keychainCreds.token) {
        // Got a valid token from keychain fallback — clear stale needs-reauth flag
        this.needsReauthProfiles.delete(activeProfile.id);
        this.traceLog('[UsageMonitor:TRACE] Using fallback OAuth token from Keychain for profile: ' + activeProfile.name, {
          tokenFingerprint: getCredentialFingerprint(keychainCreds.token)
        });
        return keychainCreds.token;
      }

      // Keychain read also failed
      if (keychainCreds.error) {
        this.traceLog('[UsageMonitor:TRACE] Keychain access failed:', keychainCreds.error);
      } else {
        this.traceLog('[UsageMonitor:TRACE] No token in Keychain for profile: ' + activeProfile.name +
          ' - user may need to re-authenticate with claude /login');
      }

      // Mark profile as needing re-authentication since credentials are missing
      this.needsReauthProfiles.add(activeProfile.id);
    }

    // No credential available
    this.traceLog('[UsageMonitor:TRACE] No credential available (no API or OAuth profile active)');
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

      // Step 2: Fetch current usage using the credential resolved by determineActiveProfile
      const usage = await this.fetchUsage(profileId, activeProfile.credential, activeProfile);
      if (!usage) {
        this.traceLog('[UsageMonitor] Failed to fetch usage (API may be rate-limited or credential unavailable)');
        return;
      }

      // Add needsReauthentication flag to the snapshot for the active profile
      usage.needsReauthentication = this.needsReauthProfiles.has(profileId);

      this.currentUsage = usage;
      this.currentUsageProfileId = profileId; // Track which profile this usage belongs to

      // Step 2.5: Persist usage to profile for caching (so other profiles can display cached usage)
      const profileManager = getClaudeProfileManager();
      profileManager.updateProfileUsageFromAPI(profileId, usage.sessionPercent, usage.weeklyPercent);

      // Step 3: Emit usage update for UI (always emit, regardless of proactive swap settings)
      this.emit('usage-updated', usage);

      // Step 3.5: Emit all profiles usage for multi-profile display
      const allProfilesUsage = await this.getAllProfilesUsage();
      if (allProfilesUsage) {
        this.emit('all-profiles-usage-updated', allProfilesUsage);

        // Single summary line for debug output
        if (this.isDebug) {
          const summary = allProfilesUsage.allProfiles
            .map(p => `${p.profileName} ${p.sessionPercent}%/${p.weeklyPercent}%`)
            .join(' | ');
          console.warn(`[UsageMonitor] Usage: ${summary}`);
        }
      }

      // Step 4: Check thresholds and perform proactive swap (OAuth profiles only)
      if (!isAPIProfile) {
        const profileManager = getClaudeProfileManager();
        const settings = profileManager.getAutoSwitchSettings();

        if (!settings.enabled || !settings.proactiveSwapEnabled) {
          this.traceLog('[UsageMonitor:TRACE] Proactive swap disabled, skipping threshold check');
          return;
        }

        const thresholds = this.checkThresholdsExceeded(usage, settings);

        if (thresholds.anyExceeded) {
          this.traceLog('[UsageMonitor:TRACE] Threshold exceeded', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent,
            activeProfile: profileId,
            hasCredential: !!activeProfile.credential
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
          this.traceLog('[UsageMonitor:TRACE] Usage OK', {
            sessionPercent: usage.sessionPercent,
            weekPercent: usage.weeklyPercent
          });
        }
      } else {
        this.traceLog('[UsageMonitor:TRACE] Skipping proactive swap for API profile (only supported for OAuth profiles)');
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
    // Check rate-limit (429) cooldown first — longer backoff than general API failures
    // Also check sibling profiles that share the same configDir (same underlying API endpoint).
    // When Anthropic 429s one profile, all profiles sharing the same credential are also blocked.
    const profileIdsToCheck = this.getProfileIdFamily(profileId);

    for (const id of profileIdsToCheck) {
      const lastRateLimit = this.rateLimitedProfiles.get(id);
      if (lastRateLimit) {
        const elapsed = Date.now() - lastRateLimit;
        if (elapsed < UsageMonitor.RATE_LIMIT_COOLDOWN_MS) {
          return false; // Any sibling is rate-limited → block all
        }
        this.rateLimitedProfiles.delete(id); // Cooldown expired, clear the marker
      }
    }

    // Check general API failure cooldown
    const lastFailure = this.apiFailureTimestamps.get(profileId);
    if (!lastFailure) return true; // No previous failure, try API
    // Check if cooldown has expired (use >= to allow retry at exact boundary)
    const elapsed = Date.now() - lastFailure;
    return elapsed >= UsageMonitor.API_FAILURE_COOLDOWN_MS;
  }

  /**
   * Get all profile IDs that share the same configDir as the given profile.
   * This is used to propagate rate-limit state across duplicate profile entries
   * that point to the same underlying OAuth credential/API endpoint.
   */
  private getProfileIdFamily(profileId: string): string[] {
    try {
      const profileManager = getClaudeProfileManager();
      const settings = profileManager.getSettings();
      const targetProfile = settings.profiles.find(p => p.id === profileId);

      if (!targetProfile?.configDir) return [profileId];

      // Find all profiles with the same configDir
      const siblings = settings.profiles
        .filter(p => p.configDir === targetProfile.configDir)
        .map(p => p.id);

      return siblings.length > 0 ? siblings : [profileId];
    } catch {
      return [profileId];
    }
  }

  /**
   * Determine which profile is active by reading globalPriorityOrder from settings.
   * The first account in the priority order is considered the active one — this
   * matches the UI's account-selection logic so usage monitoring always tracks the
   * same account the user sees as "active".
   *
   * Supported account types (in order of detection within the priority list):
   *   - Anthropic OAuth  (provider: 'anthropic', authType: 'oauth')
   *   - Anthropic API key (provider: 'anthropic', authType: 'api-key')
   *   - OpenAI/Codex OAuth (provider: 'openai', authType: 'oauth')
   *   - Z.AI API key (provider: 'zai')
   *   - Other providers: returns null (no usage monitoring supported)
   *
   * @returns Active profile info (including resolved credential) or null if undetermined
   */
  private async determineActiveProfile(): Promise<ActiveProfileResult | null> {
    // Step 1: Read settings to get providerAccounts and globalPriorityOrder
    let settings: Record<string, unknown> | undefined;
    try {
      settings = await readSettingsFileAsync();
    } catch (error) {
      this.traceLog('[UsageMonitor:TRACE] Failed to read settings file:', error);
    }

    if (!settings) {
      this.traceLog('[UsageMonitor:TRACE] No settings available, falling back to legacy profile detection');
      return this.determineActiveProfileLegacy();
    }

    const providerAccounts = (settings.providerAccounts as ProviderAccount[] | undefined) ?? [];
    const globalPriorityOrder = (settings.globalPriorityOrder as string[] | undefined) ?? [];

    if (globalPriorityOrder.length === 0) {
      this.traceLog('[UsageMonitor:TRACE] No globalPriorityOrder in settings, falling back to legacy profile detection');
      return this.determineActiveProfileLegacy();
    }

    // Step 2: Find the first ProviderAccount in the priority order
    let account: ProviderAccount | undefined;
    for (const accountId of globalPriorityOrder) {
      const found = providerAccounts.find(a => a.id === accountId);
      if (found) {
        account = found;
        break;
      }
    }

    if (!account) {
      this.traceLog('[UsageMonitor:TRACE] No ProviderAccount found in globalPriorityOrder, falling back to legacy profile detection');
      return this.determineActiveProfileLegacy();
    }

    this.traceLog('[UsageMonitor:TRACE] Resolved active account from globalPriorityOrder:', {
      accountId: account.id,
      accountName: account.name,
      provider: account.provider,
      authType: account.authType
    });

    // Step 3: Resolve credential and baseUrl based on account type
    if (account.provider === 'anthropic' && account.authType === 'oauth') {
      // Anthropic OAuth — resolve via ClaudeProfileManager + keychain
      const claudeProfileId = account.claudeProfileId;
      if (!claudeProfileId) {
        this.traceLog('[UsageMonitor:TRACE] Anthropic OAuth account missing claudeProfileId:', account.id);
        return null;
      }

      const profileManager = getClaudeProfileManager();
      const claudeProfile = profileManager.getProfile(claudeProfileId);
      if (!claudeProfile || !claudeProfile.configDir) {
        this.traceLog('[UsageMonitor:TRACE] ClaudeProfile not found or missing configDir for id:', claudeProfileId);
        return null;
      }

      const configDir = claudeProfile.configDir.startsWith('~')
        ? claudeProfile.configDir.replace(/^~/, homedir())
        : claudeProfile.configDir;

      // Get a fresh OAuth token (proactively refresh if near expiry)
      let credential: string | undefined;
      try {
        const tokenResult = await ensureValidToken(configDir);

        if (tokenResult.wasRefreshed) {
          this.debugLog('[UsageMonitor] Proactively refreshed OAuth token for active account: ' + account.name, {
            tokenFingerprint: getCredentialFingerprint(tokenResult.token)
          });
          if (tokenResult.persistenceFailed) {
            console.warn('[UsageMonitor] Token refreshed but persistence failed for account: ' + account.name +
              ' - user should re-authenticate to avoid auth errors on next restart');
            this.needsReauthProfiles.add(account.id);
          } else {
            this.needsReauthProfiles.delete(account.id);
          }
        }

        if (tokenResult.token) {
          credential = tokenResult.token;
          // Valid token obtained — clear any stale needs-reauth flag
          if (!tokenResult.persistenceFailed) {
            this.needsReauthProfiles.delete(account.id);
          }
        } else if (tokenResult.error) {
          this.traceLog('[UsageMonitor:TRACE] Token validation failed for active account:', tokenResult.error);
          if (tokenResult.errorCode === 'invalid_grant') {
            this.needsReauthProfiles.add(account.id);
          }
          if (tokenResult.errorCode === 'missing_credentials') {
            this.needsReauthProfiles.add(account.id);
          }
        }
      } catch (error) {
        this.traceLog('[UsageMonitor:TRACE] ensureValidToken failed for active account:', error);
      }

      // Fallback: direct keychain read
      if (!credential) {
        const keychainCreds = getCredentialsFromKeychain(configDir);
        credential = keychainCreds.token ?? undefined;
        if (credential) {
          // Got a valid token from keychain fallback — clear stale needs-reauth flag
          this.needsReauthProfiles.delete(account.id);
        } else {
          this.traceLog('[UsageMonitor:TRACE] No token in keychain for Anthropic OAuth account: ' + account.name);
          this.needsReauthProfiles.add(account.id);
        }
      }

      // Discover email from keychain if not persisted on the account
      let email: string | undefined = account.email;
      if (!email) {
        const keychainCreds = getCredentialsFromKeychain(configDir);
        email = keychainCreds.email ?? undefined;

        // Persist discovered email back to settings asynchronously (non-blocking)
        if (email) {
          const discoveredEmail = email;
          const accountId = account.id;
          readSettingsFileAsync().then(currentSettings => {
            if (!currentSettings) return;
            const accounts = (currentSettings.providerAccounts as ProviderAccount[] | undefined) ?? [];
            const target = accounts.find(a => a.id === accountId);
            if (target && !target.email) {
              target.email = discoveredEmail;
              try {
                writeSettingsFile(currentSettings);
              } catch {
                // Non-critical — email will be discovered again next poll
              }
            }
          }).catch(() => {});
        }
      }

      this.traceLog('[UsageMonitor:TRACE] Active auth type: Anthropic OAuth (via globalPriorityOrder)', {
        profileId: account.id,
        profileName: account.name,
        profileEmail: email
      });

      return {
        profileId: account.id,
        profileName: account.name,
        profileEmail: email,
        isAPIProfile: false,
        baseUrl: 'https://api.anthropic.com',
        credential
      };
    }

    if (account.provider === 'anthropic' && account.authType === 'api-key') {
      // Anthropic API key account
      const credential = account.apiKey;
      if (!credential) {
        this.traceLog('[UsageMonitor:TRACE] Anthropic API key account missing apiKey:', account.id);
        return null;
      }

      // Try to get baseUrl from the legacy profiles file if there's a matching API profile
      let baseUrl = account.baseUrl ?? 'https://api.anthropic.com';
      try {
        const profilesFile = await loadProfilesFile();
        const matchingProfile = profilesFile.profiles.find(p => p.apiKey === credential);
        if (matchingProfile?.baseUrl) {
          baseUrl = matchingProfile.baseUrl;
        }
      } catch {
        // Use account.baseUrl or default
      }

      this.traceLog('[UsageMonitor:TRACE] Active auth type: Anthropic API key (via globalPriorityOrder)', {
        profileId: account.id,
        profileName: account.name,
        baseUrl
      });

      return {
        profileId: account.id,
        profileName: account.name,
        profileEmail: account.email,
        isAPIProfile: true,
        baseUrl,
        credential
      };
    }

    if (account.provider === 'openai' && account.authType === 'oauth') {
      // OpenAI/Codex OAuth account
      let credential: string | undefined;
      try {
        const codexToken = await ensureValidCodexToken();
        credential = codexToken ?? undefined;
      } catch (error) {
        this.traceLog('[UsageMonitor:TRACE] Failed to get Codex OAuth token:', error);
      }

      this.traceLog('[UsageMonitor:TRACE] Active auth type: Codex OAuth (via globalPriorityOrder)', {
        profileId: account.id,
        profileName: account.name,
        hasCredential: !!credential
      });

      return {
        profileId: account.id,
        profileName: account.name,
        profileEmail: account.email,
        isAPIProfile: false,
        baseUrl: 'https://chatgpt.com',
        credential
      };
    }

    if (account.provider === 'zai') {
      // Z.AI API key account
      const credential = account.apiKey;
      if (!credential) {
        this.traceLog('[UsageMonitor:TRACE] Z.AI account missing apiKey:', account.id);
        return null;
      }

      const baseUrl = account.baseUrl ?? 'https://api.z.ai';

      this.traceLog('[UsageMonitor:TRACE] Active auth type: Z.AI API key (via globalPriorityOrder)', {
        profileId: account.id,
        profileName: account.name,
        baseUrl
      });

      return {
        profileId: account.id,
        profileName: account.name,
        profileEmail: account.email,
        isAPIProfile: true,
        baseUrl,
        credential
      };
    }

    // Other providers (google, amazon-bedrock, etc.) — no usage monitoring support
    this.traceLog('[UsageMonitor:TRACE] Provider not supported for usage monitoring:', {
      provider: account.provider,
      accountId: account.id
    });
    return null;
  }

  /**
   * Legacy fallback for determineActiveProfile when settings/globalPriorityOrder
   * are not available. Uses the old hardcoded priority:
   *   1. API profiles file (loadProfilesFile)
   *   2. ClaudeProfileManager.getActiveProfile()
   *
   * @returns Active profile info or null
   */
  private async determineActiveProfileLegacy(): Promise<ActiveProfileResult | null> {
    // First, check if an API profile is active
    try {
      const profilesFile = await loadProfilesFile();
      if (profilesFile.activeProfileId) {
        const activeAPIProfile = profilesFile.profiles.find(
          (p) => p.id === profilesFile.activeProfileId
        );
        if (activeAPIProfile?.apiKey) {
          this.traceLog('[UsageMonitor:TRACE] [Legacy] Active auth type: API Profile', {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name,
            baseUrl: activeAPIProfile.baseUrl
          });
          return {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name,
            isAPIProfile: true,
            baseUrl: activeAPIProfile.baseUrl,
            credential: activeAPIProfile.apiKey
          };
        }
      }
    } catch (error) {
      this.traceLog('[UsageMonitor:TRACE] [Legacy] Failed to load API profiles:', error);
    }

    // Fall back to Claude OAuth profile
    const profileManager = getClaudeProfileManager();
    const activeOAuthProfile = profileManager.getActiveProfile();

    if (!activeOAuthProfile) {
      this.debugLog('[UsageMonitor] [Legacy] No active profile found');
      return null;
    }

    let profileEmail = activeOAuthProfile.email;
    if (!profileEmail) {
      const keychainCreds = getCredentialsFromKeychain(activeOAuthProfile.configDir);
      profileEmail = keychainCreds.email ?? undefined;
    }

    // Get credential via ensureValidToken
    let credential: string | undefined;
    try {
      const tokenResult = await ensureValidToken(activeOAuthProfile.configDir);
      if (tokenResult.token) {
        credential = tokenResult.token;
      }
    } catch {
      const keychainCreds = getCredentialsFromKeychain(activeOAuthProfile.configDir);
      credential = keychainCreds.token ?? undefined;
    }

    this.traceLog('[UsageMonitor:TRACE] [Legacy] Active auth type: OAuth Profile', {
      profileId: activeOAuthProfile.id,
      profileName: activeOAuthProfile.name,
      profileEmail
    });

    return {
      profileId: activeOAuthProfile.id,
      profileName: activeOAuthProfile.name,
      profileEmail,
      isAPIProfile: false,
      baseUrl: 'https://api.anthropic.com',
      credential
    };
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
      this.traceLog('[UsageMonitor:FETCH] Using activeProfile data:', {
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
          this.traceLog('[UsageMonitor:FETCH] Found API profile:', {
            profileId,
            profileName,
            baseUrl: apiProfile.baseUrl
          });
        }
      } catch (error) {
        // Failed to load API profiles, continue to OAuth check
        this.traceLog('[UsageMonitor:FETCH] Failed to load API profiles:', error);
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
        this.traceLog('[UsageMonitor:FETCH] Found OAuth profile:', {
          profileId,
          profileName,
          profileEmail
        });
      }
    }

    // If still not found, return null
    if (!profileName) {
      this.traceLog('[UsageMonitor:FETCH] Profile not found in either API or OAuth profiles: ' + profileId);
      return null;
    }

    this.traceLog('[UsageMonitor:FETCH] Starting usage fetch:', {
      profileId,
      profileName,
      hasCredential: !!credential,
      useApiMethod: this.shouldUseApiMethod(profileId)
    });

    // Attempt 1: Direct API call (preferred)
    // Per-profile tracking: if API fails for one profile, it only affects that profile
    if (this.shouldUseApiMethod(profileId) && credential) {
      this.traceLog('[UsageMonitor:FETCH] Attempting API fetch method');
      const apiUsage = await this.fetchUsageViaAPI(credential, profileId, profileName, profileEmail, activeProfile);
      if (apiUsage) {
        this.traceLog('[UsageMonitor] Successfully fetched via API');
        this.traceLog('[UsageMonitor:FETCH] API fetch successful:', {
          sessionPercent: apiUsage.sessionPercent,
          weeklyPercent: apiUsage.weeklyPercent
        });
        return apiUsage;
      }

      // API failed - record timestamp for cooldown-based retry
      this.traceLog('[UsageMonitor:FETCH] API fetch failed, will retry after cooldown');
      this.apiFailureTimestamps.set(profileId, Date.now());
    } else if (!credential) {
      this.traceLog('[UsageMonitor:FETCH] No credential available, skipping API method');
    }

    // Attempt 2: CLI /usage command (fallback)
    this.traceLog('[UsageMonitor:FETCH] Attempting CLI fallback method');
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
  private async fetchUsageViaAPI(
    credential: string,
    profileId: string,
    profileName: string,
    profileEmail?: string,
    activeProfile?: ActiveProfileResult
  ): Promise<ClaudeUsageSnapshot | null> {
    this.traceLog('[UsageMonitor:API_FETCH] Starting API fetch for usage:', {
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
        // OAuth profile — detect provider from baseUrl (supports Anthropic + Codex)
        baseUrl = activeProfile.baseUrl;
        provider = detectProvider(baseUrl);
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
      this.traceLog('[UsageMonitor:TRACE] Fetching usage', {
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

      this.traceLog('[UsageMonitor:API_FETCH] API request:', {
        endpoint: usageEndpoint,
        profileId,
        credentialFingerprint: getCredentialFingerprint(credential)
      });

      this.traceLog('[UsageMonitor:API_FETCH] Fetching from endpoint:', {
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
      // CodeQL: file data in outbound request - validate credential is a non-empty string before use
      const safeCredential = typeof credential === 'string' && credential.length > 0 ? credential : '';
      const authHeader = `Bearer ${safeCredential}`;

      // Build headers based on provider
      // Anthropic OAuth requires the 'anthropic-beta: oauth-2025-04-20' header
      // See: https://codelynx.dev/posts/claude-code-usage-limits-statusline
      const headers: Record<string, string> = {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      };

      if (provider === 'anthropic') {
        // OAuth authentication requires the beta header
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
        headers['anthropic-version'] = '2023-06-01';
      } else if (provider === 'openai') {
        // Codex usage endpoint may need account ID for team accounts
        try {
          const { getCodexAccountId } = await import('./codex-usage-fetcher');
          const accountId = getCodexAccountId(credential);
          if (accountId) {
            headers['ChatGPT-Account-Id'] = accountId;
          }
        } catch {
          // Non-critical — personal accounts work without the header
        }
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

        // Handle rate limiting with a much longer backoff than general API failures
        // Propagate to all sibling profiles sharing the same configDir (same API endpoint)
        if (response.status === 429) {
          const now = Date.now();
          const siblingIds = this.getProfileIdFamily(profileId);
          console.warn('[UsageMonitor] Rate limited (429) by provider, backing off for 10 minutes:', {
            provider,
            endpoint: usageEndpoint,
            cooldownMs: UsageMonitor.RATE_LIMIT_COOLDOWN_MS,
            affectedProfiles: siblingIds.length
          });
          for (const id of siblingIds) {
            this.rateLimitedProfiles.set(id, now);
          }
          return null;
        }

        // Check for auth failures via status code (works for all providers)
        if (response.status === 401 || response.status === 403) {
          const error = new Error(`API Auth Failure: ${response.status} (${provider})`);
          (error as any).statusCode = response.status;
          throw error;
        }

        // For other error statuses, try to parse response body to detect auth failures
        // This handles cases where providers might return different status codes for auth errors
        let errorData: any;
        try {
          errorData = await response.json();
        } catch (parseError) {
          // If we can't parse the error response, just log it and continue
          this.traceLog('[UsageMonitor:AUTH_DETECTION] Could not parse error response body:', {
            provider,
            status: response.status,
            parseError
          });
          // Record failure timestamp for cooldown retry
          this.apiFailureTimestamps.set(profileId, Date.now());
          return null;
        }

        this.traceLog('[UsageMonitor:AUTH_DETECTION] Checking error response for auth failure:', {
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

      this.traceLog('[UsageMonitor:API_FETCH] API response received successfully:', {
        provider,
        status: response.status,
        contentType: response.headers.get('content-type')
      });

      // Step 5: Parse and normalize response based on provider
      const rawData = await response.json();

      this.traceLog('[UsageMonitor:PROVIDER] Raw response from ' + provider + ':', JSON.stringify(rawData, null, 2));

      // Step 6: Extract data wrapper for z.ai and ZHIPU responses
      // These providers wrap the actual usage data in a 'data' field
      let responseData = rawData;
      if (provider === 'zai' || provider === 'zhipu') {
        if (rawData.data) {
          responseData = rawData.data;
          this.traceLog('[UsageMonitor:PROVIDER] Extracted data field from response:', {
            provider,
            extractedData: JSON.stringify(responseData, null, 2)
          });
        } else {
          this.traceLog('[UsageMonitor:PROVIDER] No data field found in response, using raw response:', {
            provider,
            responseKeys: Object.keys(rawData)
          });
        }
      }

      // Step 7: Normalize response based on provider type
      let normalizedUsage: ClaudeUsageSnapshot | null = null;

      this.traceLog('[UsageMonitor:NORMALIZATION] Selecting normalization method:', {
        provider,
        method: `normalize${provider.charAt(0).toUpperCase() + provider.slice(1)}Response`
      });

      switch (provider) {
        case 'anthropic':
          normalizedUsage = this.normalizeAnthropicResponse(rawData, profileId, profileName, profileEmail);
          break;
        case 'openai':
          normalizedUsage = normalizeCodexResponse(rawData, profileId, profileName, profileEmail);
          break;
        case 'zai':
          normalizedUsage = this.normalizeZAIResponse(responseData, profileId, profileName, profileEmail);
          break;
        case 'zhipu':
          normalizedUsage = this.normalizeZhipuResponse(responseData, profileId, profileName, profileEmail);
          break;
        default:
          this.traceLog('[UsageMonitor:TRACE] Unsupported provider for usage normalization: ' + provider);
          return null;
      }

      if (!normalizedUsage) {
        this.traceLog('[UsageMonitor:TRACE] Failed to normalize response from ' + provider);
        // Record failure timestamp for cooldown retry (normalization failure)
        this.apiFailureTimestamps.set(profileId, Date.now());
        return null;
      }

      this.traceLog('[UsageMonitor:API_FETCH] Fetch completed - usage:', {
        profileId,
        profileName,
        email: normalizedUsage.profileEmail,
        provider,
        sessionPercent: normalizedUsage.sessionPercent,
        weeklyPercent: normalizedUsage.weeklyPercent,
        limitType: normalizedUsage.limitType
      });
      this.traceLog('[UsageMonitor:API_FETCH] API fetch completed successfully');

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

    if (this.isVerbose) {
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

      if (this.isVerbose) {
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

      if (this.isVerbose) {
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
   * Fetch usage via CLI /usage command (fallback)
   * Note: This is a fallback method. The API method is preferred.
   * CLI-based fetching would require spawning a Claude process and parsing output,
   * which is complex. For now, we rely on the API method.
   */
  private async fetchUsageViaCLI(
    _profileId: string,
    _profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    // CLI-based usage fetching is not implemented yet.
    // The API method should handle most cases. If we need CLI fallback,
    // we would need to spawn a Claude process with /usage command and parse the output.
    // CLI-based usage fetching is intentionally not implemented.
    // The API method handles all cases; this fallback path is expected when API is rate-limited or unavailable.
    return null;
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
