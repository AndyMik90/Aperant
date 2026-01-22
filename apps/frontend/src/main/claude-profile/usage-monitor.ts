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
import { getClaudeProfileManager } from '../claude-profile-manager';
import { ClaudeUsageSnapshot } from '../../shared/types/agent';
import { loadProfilesFile } from '../services/profile/profile-manager';
import type { APIProfile } from '../../shared/types/profile';
import { detectProvider as sharedDetectProvider, type ApiProvider } from '../../shared/utils/provider-detection';

// Re-export for backward compatibility
export type { ApiProvider };

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
 * detectProvider('https://open.bigmodel.cn/api/paas/v4') // returns 'zhipu'
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
  isAPIProfile: boolean;
  baseUrl: string;
  credential?: string;
}

export class UsageMonitor extends EventEmitter {
  private static instance: UsageMonitor;
  private intervalId: NodeJS.Timeout | null = null;
  private currentUsage: ClaudeUsageSnapshot | null = null;
  private isChecking = false;

  // Per-profile API failure tracking with cooldown-based retry
  // Map<profileId, lastFailureTimestamp> - stores when API last failed for this profile
  private apiFailureTimestamps: Map<string, number> = new Map();
  private static API_FAILURE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown before API retry

  // Swap loop protection: track profiles that recently failed auth
  private authFailedProfiles: Map<string, number> = new Map(); // profileId -> timestamp
  private static AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

  // Debug flag for verbose logging
  private readonly isDebug = process.env.DEBUG === 'true';

  private constructor() {
    super();
    console.warn('[UsageMonitor] Initialized');
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
      console.warn('[UsageMonitor] Already running');
      return;
    }

    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();
    const interval = settings.usageCheckInterval || 30000; // 30 seconds for accurate usage tracking

    console.warn('[UsageMonitor] Starting with interval:', interval, 'ms (30-second updates for accurate usage stats)');

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
      console.warn('[UsageMonitor] Stopped');
    }
  }

  /**
   * Get current usage snapshot (for UI indicator)
   */
  getCurrentUsage(): ClaudeUsageSnapshot | null {
    return this.currentUsage;
  }

  /**
   * Get credential for usage monitoring (OAuth token or API key)
   * Detects profile type and returns appropriate credential
   *
   * Priority:
   * 1. API Profile (if active) - returns apiKey directly
   * 2. OAuth Profile - returns decrypted oauthToken
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
        if (activeProfile && activeProfile.apiKey) {
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Using API profile credential:', activeProfile.name);
          }
          return activeProfile.apiKey;
        }
      }
    } catch (error) {
      // API profile loading failed, fall through to OAuth
      if (this.isDebug) {
        console.warn('[UsageMonitor:TRACE] Failed to load API profiles, falling back to OAuth:', error);
      }
    }

    // Fall back to OAuth profile
    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();
    if (activeProfile?.oauthToken) {
      const decryptedToken = profileManager.getProfileToken(activeProfile.id);
      if (this.isDebug && decryptedToken) {
        console.warn('[UsageMonitor:TRACE] Using OAuth profile credential:', activeProfile.name);
      }
      return decryptedToken;
    }

    // No credential available
    if (this.isDebug) {
      console.warn('[UsageMonitor:TRACE] No credential available (no API or OAuth profile active)');
    }
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
      const usage = await this.fetchUsage(profileId, credential, activeProfile);
      if (!usage) {
        console.warn('[UsageMonitor] Failed to fetch usage');
        return;
      }

      this.currentUsage = usage;

      // Step 3: Emit usage update for UI (always emit, regardless of proactive swap settings)
      this.emit('usage-updated', usage);

      // Step 4: Check thresholds and perform proactive swap (OAuth profiles only)
      if (!isAPIProfile) {
        const profileManager = getClaudeProfileManager();
        const settings = profileManager.getAutoSwitchSettings();

        if (!settings.enabled || !settings.proactiveSwapEnabled) {
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Proactive swap disabled, skipping threshold check');
          }
          return;
        }

        const thresholds = this.checkThresholdsExceeded(usage, settings);

        if (thresholds.anyExceeded) {
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Threshold exceeded', {
              sessionPercent: usage.sessionPercent,
              weekPercent: usage.weeklyPercent,
              activeProfile: profileId,
              hasCredential: !!credential
            });
          }

          console.warn('[UsageMonitor] Threshold exceeded:', {
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
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Usage OK', {
              sessionPercent: usage.sessionPercent,
              weekPercent: usage.weeklyPercent
            });
          }
        }
      } else {
        if (this.isDebug) {
          console.warn('[UsageMonitor:TRACE] Skipping proactive swap for API profile (only supported for OAuth profiles)');
        }
      }
    } catch (error) {
      // Step 5: Handle auth failures
      if ((error as any).statusCode === 401 || (error as any).statusCode === 403) {
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
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Active auth type: API Profile', {
              profileId: activeAPIProfile.id,
              profileName: activeAPIProfile.name,
              baseUrl: activeAPIProfile.baseUrl
            });
          }
          return {
            profileId: activeAPIProfile.id,
            profileName: activeAPIProfile.name,
            isAPIProfile: true,
            baseUrl: activeAPIProfile.baseUrl
          };
        } else if (activeAPIProfile) {
          // API profile exists but missing apiKey - fall back to OAuth
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Active API profile missing apiKey, falling back to OAuth', {
              profileId: activeAPIProfile.id,
              profileName: activeAPIProfile.name
            });
          }
        } else {
          // activeProfileId is set but profile not found - fall through to OAuth
          if (this.isDebug) {
            console.warn('[UsageMonitor:TRACE] Active API profile ID set but profile not found, falling back to OAuth');
          }
        }
      }
    } catch (error) {
      // Failed to load API profiles - fall through to OAuth
      if (this.isDebug) {
        console.warn('[UsageMonitor:TRACE] Failed to load API profiles, falling back to OAuth:', error);
      }
    }

    // If no API profile is active, check OAuth profiles
    const profileManager = getClaudeProfileManager();
    const activeOAuthProfile = profileManager.getActiveProfile();

    if (!activeOAuthProfile) {
      console.warn('[UsageMonitor] No active profile (neither API nor OAuth)');
      return null;
    }

    if (this.isDebug) {
      console.warn('[UsageMonitor:TRACE] Active auth type: OAuth Profile', {
        profileId: activeOAuthProfile.id,
        profileName: activeOAuthProfile.name
      });
    }

    return {
      profileId: activeOAuthProfile.id,
      profileName: activeOAuthProfile.name,
      isAPIProfile: false,
      baseUrl: 'https://api.anthropic.com'
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
   * Handle auth failure by marking profile as failed and attempting proactive swap
   *
   * @param profileId - Profile that failed auth
   * @param isAPIProfile - Whether this is an API profile (proactive swap only for OAuth)
   */
  private async handleAuthFailure(profileId: string, isAPIProfile: boolean): Promise<void> {
    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();

    // Proactive swap is only supported for OAuth profiles, not API profiles
    if (isAPIProfile || !settings.enabled || !settings.proactiveSwapEnabled) {
      console.warn('[UsageMonitor] Auth failure detected but proactive swap is disabled or using API profile, skipping swap');
      return;
    }

    // Mark this profile as auth-failed to prevent swap loops
    this.authFailedProfiles.set(profileId, Date.now());
    console.warn('[UsageMonitor] Auth failure detected, marked profile as failed:', profileId);

    // Clean up expired entries from the failed profiles map
    const now = Date.now();
    this.authFailedProfiles.forEach((timestamp, failedProfileId) => {
      if (now - timestamp > UsageMonitor.AUTH_FAILURE_COOLDOWN_MS) {
        this.authFailedProfiles.delete(failedProfileId);
      }
    });

    try {
      const excludeProfiles = Array.from(this.authFailedProfiles.keys());
      console.warn('[UsageMonitor] Attempting proactive swap (excluding failed profiles):', excludeProfiles);
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
    // Get profile name - check both API profiles and OAuth profiles
    let profileName: string | undefined;

    // First, check if it's an API profile
    try {
      const profilesFile = await loadProfilesFile();
      const apiProfile = profilesFile.profiles.find(p => p.id === profileId);
      if (apiProfile) {
        profileName = apiProfile.name;
        if (this.isDebug) {
          console.warn('[UsageMonitor:FETCH] Found API profile:', {
            profileId,
            profileName,
            baseUrl: apiProfile.baseUrl
          });
        }
      }
    } catch (error) {
      // Failed to load API profiles, continue to OAuth check
      if (this.isDebug) {
        console.warn('[UsageMonitor:FETCH] Failed to load API profiles:', error);
      }
    }

    // If not found in API profiles, check OAuth profiles
    if (!profileName) {
      const profileManager = getClaudeProfileManager();
      const oauthProfile = profileManager.getProfile(profileId);
      if (oauthProfile) {
        profileName = oauthProfile.name;
        if (this.isDebug) {
          console.warn('[UsageMonitor:FETCH] Found OAuth profile:', {
            profileId,
            profileName
          });
        }
      }
    }

    // If still not found, return null
    if (!profileName) {
      console.warn('[UsageMonitor:FETCH] Profile not found in either API or OAuth profiles:', profileId);
      return null;
    }

    if (this.isDebug) {
      console.warn('[UsageMonitor:FETCH] Starting usage fetch:', {
        profileId,
        profileName,
        hasCredential: !!credential,
        useApiMethod: this.shouldUseApiMethod(profileId)
      });
    }

    // Attempt 1: Direct API call (preferred)
    // Per-profile tracking: if API fails for one profile, it only affects that profile
    if (this.shouldUseApiMethod(profileId) && credential) {
      if (this.isDebug) {
        console.warn('[UsageMonitor:FETCH] Attempting API fetch method');
      }
      const apiUsage = await this.fetchUsageViaAPI(credential, profileId, profileName, activeProfile);
      if (apiUsage) {
        console.warn('[UsageMonitor] Successfully fetched via API');
        if (this.isDebug) {
          console.warn('[UsageMonitor:FETCH] API fetch successful:', {
            sessionPercent: apiUsage.sessionPercent,
            weeklyPercent: apiUsage.weeklyPercent
          });
        }
        return apiUsage;
      }

      // API failed - record timestamp for cooldown-based retry
      console.warn('[UsageMonitor] API method failed, recording failure timestamp for cooldown retry');
      if (this.isDebug) {
        console.warn('[UsageMonitor:FETCH] API fetch failed, will retry after cooldown');
      }
      this.apiFailureTimestamps.set(profileId, Date.now());
    } else if (!credential) {
      if (this.isDebug) {
        console.warn('[UsageMonitor:FETCH] No credential available, skipping API method');
      }
    }

    // Attempt 2: CLI /usage command (fallback)
    if (this.isDebug) {
      console.warn('[UsageMonitor:FETCH] Attempting CLI fallback method');
    }
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
   * @param activeProfile - Optional pre-determined active profile info to avoid race conditions
   * @returns Normalized usage snapshot or null on failure
   */
  private async fetchUsageViaAPI(
    credential: string,
    profileId: string,
    profileName: string,
    activeProfile?: ActiveProfileResult
  ): Promise<ClaudeUsageSnapshot | null> {
    if (this.isDebug) {
      console.warn('[UsageMonitor:API_FETCH] Starting API fetch for usage:', {
        profileId,
        profileName,
        hasCredential: !!credential,
        hasActiveProfile: !!activeProfile
      });
    }

    try {
      // Step 1: Determine if we're using an API profile or OAuth profile
      // Use passed activeProfile if available, otherwise detect to maintain backward compatibility
      let apiProfile: APIProfile | undefined;
      let baseUrl: string;
      let provider: ApiProvider;

      if (activeProfile && activeProfile.isAPIProfile) {
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

        if (apiProfile && apiProfile.apiKey) {
          // API profile found
          baseUrl = apiProfile.baseUrl;
          provider = detectProvider(baseUrl);
        } else {
          // OAuth profile fallback
          provider = 'anthropic';
          baseUrl = 'https://api.anthropic.com';
        }
      }

      if (this.isDebug) {
        const isAPIProfile = !!apiProfile;
        console.warn('[UsageMonitor:TRACE] Fetching usage', {
          provider,
          baseUrl,
          isAPIProfile,
          profileId
        });
      }

      // Step 3: Get provider-specific usage endpoint
      const usageEndpoint = getUsageEndpoint(provider, baseUrl);
      if (!usageEndpoint) {
        console.warn('[UsageMonitor] Unknown provider - no usage endpoint configured:', {
          provider,
          baseUrl,
          profileId
        });
        return null;
      }

      if (this.isDebug) {
        console.warn('[UsageMonitor:API_FETCH] Fetching from endpoint:', {
          provider,
          endpoint: usageEndpoint,
          hasCredential: !!credential
        });
      }

      // Step 4: Fetch usage from provider endpoint
      // All providers use Bearer token authentication (RFC 6750)
      const authHeader = `Bearer ${credential}`;

      const response = await fetch(usageEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          ...(provider === 'anthropic' && { 'anthropic-version': '2023-06-01' })
        }
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

        // For other error statuses, try to parse response body to detect auth failures
        // This handles cases where providers might return different status codes for auth errors
        let errorData: any;
        try {
          errorData = await response.json();
        } catch (parseError) {
          // If we can't parse the error response, just log it and continue
          if (this.isDebug) {
            console.warn('[UsageMonitor:AUTH_DETECTION] Could not parse error response body:', {
              provider,
              status: response.status,
              parseError
            });
          }
          // Record failure timestamp for cooldown retry
          this.apiFailureTimestamps.set(profileId, Date.now());
          return null;
        }

        if (this.isDebug) {
          console.warn('[UsageMonitor:AUTH_DETECTION] Checking error response for auth failure:', {
            provider,
            status: response.status,
            errorData
          });
        }

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

      if (this.isDebug) {
        console.warn('[UsageMonitor:API_FETCH] API response received successfully:', {
          provider,
          status: response.status,
          contentType: response.headers.get('content-type')
        });
      }

      // Step 5: Parse and normalize response based on provider
      const rawData = await response.json();

      if (this.isDebug) {
        console.warn('[UsageMonitor:PROVIDER] Raw response from', provider, ':', JSON.stringify(rawData, null, 2));
      }

      // Step 6: Extract data wrapper for z.ai and ZHIPU responses
      // These providers wrap the actual usage data in a 'data' field
      let responseData = rawData;
      if (provider === 'zai' || provider === 'zhipu') {
        if (rawData.data) {
          responseData = rawData.data;
          if (this.isDebug) {
            console.warn('[UsageMonitor:PROVIDER] Extracted data field from response:', {
              provider,
              extractedData: JSON.stringify(responseData, null, 2)
            });
          }
        } else {
          if (this.isDebug) {
            console.warn('[UsageMonitor:PROVIDER] No data field found in response, using raw response:', {
              provider,
              responseKeys: Object.keys(rawData)
            });
          }
        }
      }

      // Step 7: Normalize response based on provider type
      let normalizedUsage: ClaudeUsageSnapshot | null = null;

      if (this.isDebug) {
        console.warn('[UsageMonitor:NORMALIZATION] Selecting normalization method:', {
          provider,
          method: `normalize${provider.charAt(0).toUpperCase() + provider.slice(1)}Response`
        });
      }

      switch (provider) {
        case 'anthropic':
          normalizedUsage = this.normalizeAnthropicResponse(rawData, profileId, profileName);
          break;
        case 'zai':
          normalizedUsage = this.normalizeZAIResponse(responseData, profileId, profileName);
          break;
        case 'zhipu':
          normalizedUsage = this.normalizeZhipuResponse(responseData, profileId, profileName);
          break;
        default:
          console.warn('[UsageMonitor] Unsupported provider for usage normalization:', provider);
          return null;
      }

      if (!normalizedUsage) {
        console.warn('[UsageMonitor] Failed to normalize response from', provider);
        // Record failure timestamp for cooldown retry (normalization failure)
        this.apiFailureTimestamps.set(profileId, Date.now());
        return null;
      }

      if (this.isDebug) {
        console.warn('[UsageMonitor:PROVIDER] Normalized usage:', {
          provider,
          sessionPercent: normalizedUsage.sessionPercent,
          weeklyPercent: normalizedUsage.weeklyPercent,
          limitType: normalizedUsage.limitType
        });
        console.warn('[UsageMonitor:API_FETCH] API fetch completed successfully');
      }

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
   * Expected Anthropic response format:
   * {
   *   "five_hour_utilization": 0.72,  // 0.0-1.0
   *   "seven_day_utilization": 0.45,  // 0.0-1.0
   *   "five_hour_reset_at": "2025-01-17T15:00:00Z",
   *   "seven_day_reset_at": "2025-01-20T12:00:00Z"
   * }
   */
  private normalizeAnthropicResponse(
    data: any,
    profileId: string,
    profileName: string
  ): ClaudeUsageSnapshot {
    const fiveHourUtil = data.five_hour_utilization ?? 0;
    const sevenDayUtil = data.seven_day_utilization ?? 0;

    return {
      sessionPercent: Math.round(fiveHourUtil * 100),
      weeklyPercent: Math.round(sevenDayUtil * 100),
      // Omit sessionResetTime/weeklyResetTime - renderer uses timestamps with formatTimeRemaining
      sessionResetTime: undefined,
      weeklyResetTime: undefined,
      sessionResetTimestamp: data.five_hour_reset_at,
      weeklyResetTimestamp: data.seven_day_reset_at,
      profileId,
      profileName,
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
   * @param providerName - Provider name for logging ('zai' or 'zhipu')
   * @returns Normalized usage snapshot or null on parse failure
   */
  private normalizeQuotaLimitResponse(
    data: any,
    profileId: string,
    profileName: string,
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
    profileName: string
  ): ClaudeUsageSnapshot | null {
    // Delegate to shared quota/limit response normalization
    return this.normalizeQuotaLimitResponse(data, profileId, profileName, 'zai');
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
    profileName: string
  ): ClaudeUsageSnapshot | null {
    // Delegate to shared quota/limit response normalization
    return this.normalizeQuotaLimitResponse(data, profileId, profileName, 'zhipu');
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
    console.warn('[UsageMonitor] CLI fallback not implemented, API method should be used');
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

    // Get all profiles to swap to, excluding current and any additional exclusions
    const allProfiles = profileManager.getProfilesSortedByAvailability();
    const excludeIds = new Set([currentProfileId, ...additionalExclusions]);
    const eligibleProfiles = allProfiles.filter(p => !excludeIds.has(p.id));

    if (eligibleProfiles.length === 0) {
      console.warn('[UsageMonitor] No alternative profile for proactive swap (excluded:', Array.from(excludeIds), ')');
      this.emit('proactive-swap-failed', {
        reason: additionalExclusions.length > 0 ? 'all_alternatives_failed_auth' : 'no_alternative',
        currentProfile: currentProfileId,
        excludedProfiles: Array.from(excludeIds)
      });
      return;
    }

    // Use the best available from eligible profiles
    const bestProfile = eligibleProfiles[0];

    console.warn('[UsageMonitor] Proactive swap:', {
      from: currentProfileId,
      to: bestProfile.id,
      reason: limitType
    });

    // Switch profile
    profileManager.setActiveProfile(bestProfile.id);

    // Emit swap event
    this.emit('proactive-swap-completed', {
      fromProfile: { id: currentProfileId, name: profileManager.getProfile(currentProfileId)?.name },
      toProfile: { id: bestProfile.id, name: bestProfile.name },
      limitType,
      timestamp: new Date()
    });

    // Notify UI
    this.emit('show-swap-notification', {
      fromProfile: profileManager.getProfile(currentProfileId)?.name,
      toProfile: bestProfile.name,
      reason: 'proactive',
      limitType
    });

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
