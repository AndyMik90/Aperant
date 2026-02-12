/**
 * Unified Account Types
 *
 * Types for representing both OAuth accounts and API profiles in a unified format.
 * Used by the priority list to display and manage all accounts in a single interface.
 */

import type { ClaudeProfile } from './agent';
import type { APIProfile } from './profile';

/**
 * Type discriminator for unified accounts
 */
export type UnifiedAccountType = 'oauth' | 'api';

/**
 * Type of rate limit that was hit
 */
export type RateLimitType = 'session' | 'weekly';

/**
 * Unified account representation for the priority list.
 *
 * This interface provides a common format for both OAuth accounts (Claude subscriptions)
 * and API profiles (custom endpoints), enabling unified display and management.
 *
 * Key concepts:
 * - Only ONE account should have `isActive: true` at any time (the currently in-use account)
 * - `isNext` indicates the fallback account that will be used next
 * - Priority is determined by position in the list (index 0 = highest priority)
 */
export interface UnifiedAccount {
  /** Unique identifier for this account */
  id: string;

  /** Internal name/key for the account */
  name: string;

  /** Account type discriminator */
  type: UnifiedAccountType;

  /** Human-friendly display name */
  displayName: string;

  /** email for OAuth accounts, baseUrl for API profiles */
  identifier: string;

  /** TRUE only for the ONE account currently in use */
  isActive: boolean;

  /** TRUE for the account that will be used next (first available after active) */
  isNext: boolean;

  /** Whether this account is available for use (authenticated, not rate limited) */
  isAvailable: boolean;

  /** TRUE for API profiles (pay-per-use without rate limits) */
  hasUnlimitedUsage: boolean;

  /** Session usage percentage (0-100), only for OAuth accounts */
  sessionPercent?: number;

  /** Weekly usage percentage (0-100), only for OAuth accounts */
  weeklyPercent?: number;

  /** Whether this account is currently rate limited */
  isRateLimited?: boolean;

  /** Which type of limit was hit, if rate limited */
  rateLimitType?: RateLimitType;

  /** Whether this OAuth account has valid authentication */
  isAuthenticated?: boolean;

  /**
   * Set when this account has identical usage to another OAuth account.
   * This may indicate the same underlying Anthropic account registered twice.
   */
  isDuplicateUsage?: boolean;

  /**
   * Set when this OAuth account has an invalid refresh token and needs re-authentication.
   * The user should be prompted to log in again.
   */
  needsReauthentication?: boolean;
}

// ============================================
// Conversion Utilities
// ============================================

/**
 * ID prefix for OAuth accounts in unified format
 */
export const OAUTH_ID_PREFIX = 'oauth-';

/**
 * ID prefix for API accounts in unified format
 */
export const API_ID_PREFIX = 'api-';

/**
 * Convert a ClaudeProfile (OAuth) to UnifiedAccount format
 *
 * @param profile - The OAuth profile to convert
 * @param isActive - Whether this is the currently active account
 * @param options - Additional options for conversion
 */
export function claudeProfileToUnified(
  profile: ClaudeProfile,
  isActive: boolean,
  options?: {
    isRateLimited?: boolean;
    rateLimitType?: RateLimitType;
  }
): UnifiedAccount {
  // Check for rate limit from profile's rate limit events
  const activeRateLimit = profile.rateLimitEvents?.find(e => e.resetAt > new Date());
  const isRateLimited = options?.isRateLimited ?? !!activeRateLimit;

  // Derive isAvailable from the computed isRateLimited value
  const isAvailable = !!(profile.isAuthenticated && !isRateLimited);

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
    isAuthenticated: profile.isAuthenticated,
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
    isAuthenticated
  };
}

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
  return `${OAUTH_ID_PREFIX}${profileId}`;
}

/**
 * Create a unified account ID from an API profile ID
 * Guards against double-prefixing if profileId already has the prefix
 */
export function toAPIUnifiedId(profileId: string): string {
  if (profileId.startsWith(API_ID_PREFIX)) return profileId;
  return `${API_ID_PREFIX}${profileId}`;
}
