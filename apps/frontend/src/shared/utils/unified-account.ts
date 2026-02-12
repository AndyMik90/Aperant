/**
 * Unified Account Utilities
 *
 * Conversion utilities and helpers for unified account management.
 * These functions convert between OAuth/API profiles and the unified account format.
 */

import type { ClaudeProfile } from '../types/agent';
import type { APIProfile } from '../types/profile';
import type { UnifiedAccount, RateLimitType } from '../types/unified-account';

// ============================================
// Constants
// ============================================

/**
 * ID prefix for OAuth accounts in unified format
 */
export const OAUTH_ID_PREFIX = 'oauth-';

/**
 * ID prefix for API accounts in unified format
 */
export const API_ID_PREFIX = 'api-';

// ============================================
// Conversion Functions
// ============================================

/**
 * Convert a ClaudeProfile (OAuth) to UnifiedAccount format
 *
 * @param profile - The OAuth profile to convert
 * @param isActive - Whether this is the currently active account
 * @param options - Additional options for conversion
 * @param options.isRateLimited - Whether the profile is currently rate limited
 * @param options.rateLimitType - The type of rate limit (session or weekly)
 * @param options.isAuthenticated - Whether the profile is authenticated (REQUIRED - must be computed by caller)
 */
export function claudeProfileToUnified(
  profile: ClaudeProfile,
  isActive: boolean,
  options?: {
    isRateLimited?: boolean;
    rateLimitType?: RateLimitType;
    isAuthenticated?: boolean;
  }
): UnifiedAccount {
  // Check for rate limit from profile's rate limit events
  const now = new Date();
  const activeRateLimit = profile.rateLimitEvents?.find(e => e.resetAt > now);
  const isRateLimited = options?.isRateLimited ?? !!activeRateLimit;
  // Use explicit isAuthenticated from options, falling back to profile property (which may be undefined for raw profiles)
  const isAuthenticated = options?.isAuthenticated ?? profile.isAuthenticated ?? false;

  // Derive isAvailable from the computed values
  const isAvailable = !!(isAuthenticated && !isRateLimited);

  return {
    id: `${OAUTH_ID_PREFIX}${profile.id}`,
    name: profile.name,
    type: 'oauth',
    displayName: profile.name,
    identifier: profile.email || profile.id,
    isActive,
    isNext: false, // Computed later based on priority order
    isAvailable,
    hasUnlimitedUsage: false, // OAuth accounts have usage limits
    sessionPercent: profile.usage?.sessionUsagePercent,
    weeklyPercent: profile.usage?.weeklyUsagePercent,
    isRateLimited,
    rateLimitType: options?.rateLimitType ?? activeRateLimit?.type,
    isAuthenticated,
    needsReauthentication: false // Set separately if needed
  };
}

/**
 * Convert an APIProfile to UnifiedAccount format
 *
 * @param profile - The API profile to convert
 * @param isActive - Whether this is the currently active account
 * @param isAuthenticated - Whether the API key is valid (has been tested). Defaults to false for safety.
 */
export function apiProfileToUnified(
  profile: APIProfile,
  isActive: boolean,
  isAuthenticated: boolean = false
): UnifiedAccount {
  // API profiles are available if they have a valid API key
  // They have unlimited usage (pay-per-use)
  const isAvailable = isAuthenticated && !!profile.apiKey;

  return {
    id: `${API_ID_PREFIX}${profile.id}`,
    name: profile.name,
    type: 'api',
    displayName: profile.name,
    identifier: profile.baseUrl,
    isActive,
    isNext: false, // Computed later based on priority order
    isAvailable,
    hasUnlimitedUsage: true, // API profiles are pay-per-use with no rate limits
    sessionPercent: undefined, // Not applicable to API profiles
    weeklyPercent: undefined, // Not applicable to API profiles
    isRateLimited: false, // API profiles don't have rate limits
    rateLimitType: undefined,
    isAuthenticated,
    needsReauthentication: false
  };
}

// ============================================
// ID Helper Functions
// ============================================

/**
 * Check if a unified account ID is for an OAuth account
 */
export function isOAuthAccountId(id: string): boolean {
  return id.startsWith(OAUTH_ID_PREFIX);
}

/**
 * Check if a unified account ID is for an API account
 */
export function isAPIAccountId(id: string): boolean {
  return id.startsWith(API_ID_PREFIX);
}

/**
 * Extract the original profile ID from a unified account ID
 */
export function extractProfileId(unifiedId: string): string {
  if (unifiedId.startsWith(OAUTH_ID_PREFIX)) {
    return unifiedId.slice(OAUTH_ID_PREFIX.length);
  }
  if (unifiedId.startsWith(API_ID_PREFIX)) {
    return unifiedId.slice(API_ID_PREFIX.length);
  }
  return unifiedId;
}

/**
 * Create a unified account ID from an OAuth profile ID
 * Guards against double-prefixing if profileId already has the prefix
 */
export function toOAuthUnifiedId(profileId: string): string {
  if (profileId.startsWith(OAUTH_ID_PREFIX)) return profileId;
  if (profileId.startsWith(API_ID_PREFIX)) {
    throw new Error(`Cannot convert API-prefixed ID "${profileId}" to OAuth unified ID`);
  }
  return `${OAUTH_ID_PREFIX}${profileId}`;
}

/**
 * Create a unified account ID from an API profile ID
 * Guards against double-prefixing if profileId already has the prefix
 */
export function toAPIUnifiedId(profileId: string): string {
  if (profileId.startsWith(API_ID_PREFIX)) return profileId;
  if (profileId.startsWith(OAUTH_ID_PREFIX)) {
    throw new Error(`Cannot convert OAuth-prefixed ID "${profileId}" to API unified ID`);
  }
  return `${API_ID_PREFIX}${profileId}`;
}
