/**
 * Unified Account Types
 *
 * Types for representing both OAuth accounts and API profiles in a unified format.
 * Used by the priority list to display and manage all accounts in a single interface.
 *
 * For conversion utilities and helper functions, see shared/utils/unified-account.ts
 */

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
