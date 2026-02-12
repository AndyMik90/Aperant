/**
 * Profile Scorer Module
 * Handles profile availability scoring and auto-switch logic
 *
 * Priority-Based Selection (v2):
 * 1. User's configured priority order is the PRIMARY factor
 * 2. Accounts are filtered by availability criteria:
 *    - Must be authenticated
 *    - Must not be rate-limited (explicit 429 error)
 *    - Must be below user's configured thresholds (default: 95% session, 99% weekly)
 * 3. First profile in priority order that passes all filters is selected
 * 4. If no profile passes all filters, falls back to "least bad" option
 *
 * v3 Enhancement: Unified Account Support
 * - Supports both OAuth profiles (ClaudeProfile) and API profiles (APIProfile)
 * - API profiles are always considered available (hasUnlimitedUsage = true)
 * - Unified selection algorithm considers both types in priority order
 */

import type { ClaudeProfile, ClaudeAutoSwitchSettings, APIProfile } from '../../shared/types';
import type { UnifiedAccount } from '../../shared/types/unified-account';
import {
  claudeProfileToUnified,
  apiProfileToUnified,
  OAUTH_ID_PREFIX
} from '../../shared/utils/unified-account';
import { isProfileRateLimited } from './rate-limit-manager';
import { isProfileAuthenticated } from './profile-utils';

const isDebug = process.env.DEBUG === 'true';

interface ScoredProfile {
  profile: ClaudeProfile;
  score: number;
  priorityIndex: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

/**
 * Check if a profile is available for use based on all criteria
 */
function checkProfileAvailability(
  profile: ClaudeProfile,
  settings: ClaudeAutoSwitchSettings
): { available: boolean; reason?: string } {
  // Check authentication
  if (!isProfileAuthenticated(profile)) {
    return { available: false, reason: 'not authenticated' };
  }

  // Check explicit rate limit (from 429 errors)
  const rateLimitStatus = isProfileRateLimited(profile);
  if (rateLimitStatus.limited) {
    return {
      available: false,
      reason: `rate limited (${rateLimitStatus.type}, resets ${rateLimitStatus.resetAt?.toISOString() || 'unknown'})`
    };
  }

  // Check usage thresholds
  if (profile.usage) {
    // Weekly threshold check (more important - longer reset time)
    // Using >= to reject profiles AT or ABOVE threshold (e.g., 95% is rejected when threshold is 95%)
    // This is intentional: we want to switch proactively BEFORE hitting hard limits
    if (profile.usage.weeklyUsagePercent >= settings.weeklyThreshold) {
      return {
        available: false,
        reason: `weekly usage ${profile.usage.weeklyUsagePercent}% >= threshold ${settings.weeklyThreshold}%`
      };
    }

    // Session threshold check
    // Using >= to reject profiles AT or ABOVE threshold (same rationale as weekly)
    if (profile.usage.sessionUsagePercent >= settings.sessionThreshold) {
      return {
        available: false,
        reason: `session usage ${profile.usage.sessionUsagePercent}% >= threshold ${settings.sessionThreshold}%`
      };
    }
  }

  return { available: true };
}

/**
 * Calculate a fallback score for when no profiles meet all criteria
 * Used to pick the "least bad" option
 */
function calculateFallbackScore(
  profile: ClaudeProfile,
  settings: ClaudeAutoSwitchSettings
): number {
  let score = 100;
  const now = new Date();

  // Authentication is critical
  if (!isProfileAuthenticated(profile)) {
    score -= 1000; // Unauthenticated is basically unusable
  }

  // Rate limit status
  const rateLimitStatus = isProfileRateLimited(profile);
  if (rateLimitStatus.limited) {
    if (rateLimitStatus.type === 'weekly') {
      score -= 500; // Weekly limit is worse (longer reset)
    } else {
      score -= 200; // Session limit resets sooner
    }

    // Bonus for profiles that reset sooner
    if (rateLimitStatus.resetAt) {
      const hoursUntilReset = (rateLimitStatus.resetAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      score += Math.max(0, 50 - hoursUntilReset);
    }
  }

  // Usage penalties (prefer lower usage)
  if (profile.usage) {
    // Penalize based on how far over threshold
    const weeklyOverage = Math.max(0, profile.usage.weeklyUsagePercent - settings.weeklyThreshold);
    const sessionOverage = Math.max(0, profile.usage.sessionUsagePercent - settings.sessionThreshold);

    score -= weeklyOverage * 2; // Weekly overage is worse
    score -= sessionOverage;

    // Also factor in absolute usage (lower is better)
    score -= profile.usage.weeklyUsagePercent * 0.3;
    score -= profile.usage.sessionUsagePercent * 0.1;
  }

  return score;
}

// ============================================
// Unified Account Scoring (v3)
// ============================================

interface ScoredUnifiedAccount {
  account: UnifiedAccount;
  score: number;
  priorityIndex: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

/**
 * Options for unified account selection
 */
export interface UnifiedAccountSelectionOptions {
  /** Unified account ID to exclude (usually the current/failing one) */
  excludeAccountId?: string;
  /** User's configured priority order (array of unified IDs) */
  priorityOrder?: string[];
  /** Currently active OAuth profile ID (if any) */
  activeOAuthId?: string;
  /** Currently active API profile ID (if any) */
  activeAPIId?: string;
}

/**
 * Score a single unified account for availability
 *
 * @param account - The unified account to score
 * @param priorityIndex - Index in the user's priority order (lower = higher priority)
 * @param settings - Auto-switch settings containing usage thresholds
 */
function scoreUnifiedAccount(
  account: UnifiedAccount,
  priorityIndex: number,
  settings: ClaudeAutoSwitchSettings
): ScoredUnifiedAccount {
  let score = 100;
  let unavailableReason: string | undefined;
  let isOverThreshold = false;

  // For API profiles: simple availability check
  if (account.type === 'api') {
    if (!account.isAuthenticated) {
      score = -1000;
      unavailableReason = 'API key not validated';
    } else if (!account.isAvailable) {
      score = -500;
      unavailableReason = 'not available';
    }
    // API profiles with valid auth get high scores (no usage limits)

    return {
      account,
      score,
      priorityIndex,
      isAvailable: score > 0,
      unavailableReason
    };
  }

  // For OAuth profiles: detailed scoring with threshold enforcement
  if (!account.isAuthenticated) {
    score = -1000;
    unavailableReason = 'not authenticated';
  } else if (account.isRateLimited) {
    if (account.rateLimitType === 'weekly') {
      score = -500;
    } else {
      score = -200;
    }
    unavailableReason = `rate limited (${account.rateLimitType || 'unknown'})`;
  } else {
    // Check usage thresholds (matching checkProfileAvailability behavior)
    if (account.weeklyPercent !== undefined && account.weeklyPercent >= settings.weeklyThreshold) {
      isOverThreshold = true;
      unavailableReason = `weekly usage ${account.weeklyPercent}% >= threshold ${settings.weeklyThreshold}%`;
    } else if (account.sessionPercent !== undefined && account.sessionPercent >= settings.sessionThreshold) {
      isOverThreshold = true;
      unavailableReason = `session usage ${account.sessionPercent}% >= threshold ${settings.sessionThreshold}%`;
    }

    // Apply proportional penalties for high usage (even if not over threshold)
    if (account.weeklyPercent !== undefined) {
      score -= account.weeklyPercent * 0.3;
    }
    if (account.sessionPercent !== undefined) {
      score -= account.sessionPercent * 0.1;
    }
  }

  return {
    account,
    score,
    priorityIndex,
    isAvailable: score > 0 && account.isAuthenticated === true && !account.isRateLimited && !isOverThreshold,
    unavailableReason
  };
}

/**
 * Get the best unified account from both OAuth and API profiles
 *
 * Selection Logic:
 * 1. Convert all profiles to UnifiedAccount format
 * 2. Sort by user's priority order
 * 3. Filter by availability
 * 4. Return first available account in priority order
 * 5. If none available, return the "least bad" option
 *
 * @param oauthProfiles - All OAuth (Claude) profiles
 * @param apiProfiles - All API profiles
 * @param settings - Auto-switch settings (contains thresholds for OAuth)
 * @param options - Optional configuration for selection
 */
export function getBestAvailableUnifiedAccount(
  oauthProfiles: ClaudeProfile[],
  apiProfiles: APIProfile[],
  settings: ClaudeAutoSwitchSettings,
  options: UnifiedAccountSelectionOptions = {}
): UnifiedAccount | null {
  const { excludeAccountId, priorityOrder = [], activeOAuthId, activeAPIId } = options;
  // Convert all profiles to unified format
  const unifiedAccounts: UnifiedAccount[] = [];

  // Convert OAuth profiles
  for (const profile of oauthProfiles) {
    const isActive = profile.id === activeOAuthId;
    const rateLimitStatus = isProfileRateLimited(profile);
    // Compute authentication status - profile.isAuthenticated may not be set on raw profiles
    const isAuthenticated = isProfileAuthenticated(profile);

    unifiedAccounts.push(claudeProfileToUnified(profile, isActive, {
      isRateLimited: rateLimitStatus.limited,
      rateLimitType: rateLimitStatus.type,
      isAuthenticated
    }));
  }

  // Convert API profiles
  for (const profile of apiProfiles) {
    const isActive = profile.id === activeAPIId;
    // TODO: API profiles are considered authenticated if they have an API key.
    // Add validation tracking to distinguish "has key" from "key is confirmed valid".
    const isAuthenticated = !!profile.apiKey;
    unifiedAccounts.push(apiProfileToUnified(profile, isActive, isAuthenticated));
  }

  // Filter out excluded account
  const candidates = unifiedAccounts.filter(a => a.id !== excludeAccountId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Evaluating', candidates.length, 'candidate accounts (excluding:', excludeAccountId, ')');
    console.warn('[ProfileScorer] Priority order:', priorityOrder);
    console.warn('[ProfileScorer] OAuth thresholds: session =', settings.sessionThreshold, '%, weekly =', settings.weeklyThreshold, '%');
  }

  // Score and check availability for each account
  const scoredAccounts: ScoredUnifiedAccount[] = candidates.map(account => {
    const priorityIndex = priorityOrder.indexOf(account.id);
    const scored = scoreUnifiedAccount(account, priorityIndex === -1 ? Infinity : priorityIndex, settings);

    if (isDebug) {
      console.warn('[ProfileScorer] Scoring account:', account.displayName, '(', account.id, ')');
      console.warn('[ProfileScorer]   Type:', account.type);
      console.warn('[ProfileScorer]   Priority index:', priorityIndex === -1 ? 'not in list (Infinity)' : priorityIndex);
      console.warn('[ProfileScorer]   Available:', scored.isAvailable, scored.unavailableReason ? `(${scored.unavailableReason})` : '');
      if (account.type === 'oauth') {
        console.warn('[ProfileScorer]   Usage:', `session=${account.sessionPercent}%, weekly=${account.weeklyPercent}%`);
      }
      console.warn('[ProfileScorer]   Score:', scored.score);
    }

    return scored;
  });

  // Sort by:
  // 1. Available accounts first
  // 2. Within available: by priority index (lower = higher priority)
  // 3. Within unavailable: by score (higher = better, for "least bad" selection)
  scoredAccounts.sort((a, b) => {
    // Available accounts always come first
    if (a.isAvailable !== b.isAvailable) {
      return a.isAvailable ? -1 : 1;
    }

    // For available accounts, sort by priority order
    if (a.isAvailable && b.isAvailable) {
      if (a.priorityIndex !== b.priorityIndex) {
        return a.priorityIndex - b.priorityIndex;
      }
      // Tiebreaker: prefer higher score
      return b.score - a.score;
    }

    // For unavailable accounts, sort by score (for "least bad" selection)
    return b.score - a.score;
  });

  const best = scoredAccounts[0];

  if (best.isAvailable) {
    if (isDebug) {
      console.warn('[ProfileScorer] Best available account:', best.account.displayName,
        '(type:', best.account.type, ', priority index:', best.priorityIndex, ')');
    }
    return best.account;
  }

  // No account meets all criteria - check if we should return the least bad option
  if (best.score > 0) {
    if (isDebug) {
      console.warn('[ProfileScorer] No ideal account available, using least-bad option:', best.account.displayName,
        '(type:', best.account.type, ', score:', best.score, ', reason:', best.unavailableReason, ')');
    }
    return best.account;
  }

  // All accounts are truly unusable
  if (isDebug) {
    console.warn('[ProfileScorer] No usable account available, all have issues');
  }
  return null;
}

/**
 * Get the best profile to switch to based on priority order and availability
 *
 * Selection Logic:
 * 1. Filter to candidates (excluding the current profile)
 * 2. Check each profile's availability (auth, rate limit, thresholds)
 * 3. Sort by user's priority order
 * 4. Return the first available profile in priority order
 * 5. If none available, return the "least bad" option based on fallback scoring
 *
 * @param profiles - All Claude profiles
 * @param settings - Auto-switch settings (contains thresholds)
 * @param excludeProfileId - Profile ID to exclude (usually the current/failing one)
 * @param priorityOrder - User's configured priority order (array of unified IDs like 'oauth-{id}')
 */
export function getBestAvailableProfile(
  profiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  excludeProfileId?: string,
  priorityOrder: string[] = []
): ClaudeProfile | null {
  // Get all profiles except the excluded one
  const candidates = profiles.filter(p => p.id !== excludeProfileId);

  if (candidates.length === 0) {
    return null;
  }

  if (isDebug) {
    console.warn('[ProfileScorer] Evaluating', candidates.length, 'candidate profiles (excluding:', excludeProfileId, ')');
    console.warn('[ProfileScorer] Priority order:', priorityOrder);
    console.warn('[ProfileScorer] Thresholds: session =', settings.sessionThreshold, '%, weekly =', settings.weeklyThreshold, '%');
  }

  // Score and check availability for each profile
  const scoredProfiles: ScoredProfile[] = candidates.map(profile => {
    const unifiedId = `${OAUTH_ID_PREFIX}${profile.id}`;
    const priorityIndex = priorityOrder.indexOf(unifiedId);
    const availability = checkProfileAvailability(profile, settings);
    const fallbackScore = calculateFallbackScore(profile, settings);

    if (isDebug) {
      console.warn('[ProfileScorer] Scoring profile:', profile.name, '(', profile.id, ')');
      console.warn('[ProfileScorer]   Priority index:', priorityIndex === -1 ? 'not in list (Infinity)' : priorityIndex);
      console.warn('[ProfileScorer]   Available:', availability.available, availability.reason ? `(${availability.reason})` : '');
      console.warn('[ProfileScorer]   Usage:', profile.usage ? `session=${profile.usage.sessionUsagePercent}%, weekly=${profile.usage.weeklyUsagePercent}%` : 'unknown');
      console.warn('[ProfileScorer]   Fallback score:', fallbackScore);
    }

    return {
      profile,
      score: fallbackScore,
      priorityIndex: priorityIndex === -1 ? Infinity : priorityIndex,
      isAvailable: availability.available,
      unavailableReason: availability.reason
    };
  });

  // Sort by:
  // 1. Available profiles first
  // 2. Within available: by priority index (lower = higher priority)
  // 3. Within unavailable: by fallback score (higher = better)
  scoredProfiles.sort((a, b) => {
    // Available profiles always come first
    if (a.isAvailable !== b.isAvailable) {
      return a.isAvailable ? -1 : 1;
    }

    // For available profiles, sort by priority order
    if (a.isAvailable && b.isAvailable) {
      // If both have priority indices, use them
      if (a.priorityIndex !== b.priorityIndex) {
        return a.priorityIndex - b.priorityIndex;
      }
      // Tiebreaker: prefer lower usage
      return b.score - a.score;
    }

    // For unavailable profiles, sort by fallback score (for "least bad" selection)
    return b.score - a.score;
  });

  const best = scoredProfiles[0];

  if (best.isAvailable) {
    console.warn('[ProfileScorer] Best available profile:', best.profile.name, '(priority index:', best.priorityIndex, ')');
    return best.profile;
  }

  // No profile meets all criteria - check if we should return the least bad option
  // Only return if it has a positive score (meaning it might still work)
  if (best.score > 0) {
    console.warn('[ProfileScorer] No ideal profile available, using least-bad option:', best.profile.name,
      '(score:', best.score, ', reason:', best.unavailableReason, ')');
    return best.profile;
  }

  // All profiles are truly unusable
  console.warn('[ProfileScorer] No usable profile available, all have issues');
  return null;
}

/**
 * Determine if we should proactively switch profiles based on current usage
 */
export function shouldProactivelySwitch(
  profile: ClaudeProfile,
  allProfiles: ClaudeProfile[],
  settings: ClaudeAutoSwitchSettings,
  priorityOrder: string[] = []
): { shouldSwitch: boolean; reason?: string; suggestedProfile?: ClaudeProfile } {
  if (!settings.enabled) {
    return { shouldSwitch: false };
  }

  if (!profile?.usage) {
    return { shouldSwitch: false };
  }

  const usage = profile.usage;

  // Check if we're approaching limits
  if (usage.weeklyUsagePercent >= settings.weeklyThreshold) {
    const bestProfile = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (bestProfile) {
      return {
        shouldSwitch: true,
        reason: `Weekly usage at ${usage.weeklyUsagePercent}% (threshold: ${settings.weeklyThreshold}%)`,
        suggestedProfile: bestProfile
      };
    }
  }

  if (usage.sessionUsagePercent >= settings.sessionThreshold) {
    const bestProfile = getBestAvailableProfile(allProfiles, settings, profile.id, priorityOrder);
    if (bestProfile) {
      return {
        shouldSwitch: true,
        reason: `Session usage at ${usage.sessionUsagePercent}% (threshold: ${settings.sessionThreshold}%)`,
        suggestedProfile: bestProfile
      };
    }
  }

  return { shouldSwitch: false };
}

/**
 * Get profiles sorted by availability (best first)
 * This is a simpler sort that doesn't consider priority order - used for display purposes
 */
export function getProfilesSortedByAvailability(profiles: ClaudeProfile[]): ClaudeProfile[] {
  return [...profiles].sort((a, b) => {
    // Authenticated profiles first
    const aAuth = isProfileAuthenticated(a);
    const bAuth = isProfileAuthenticated(b);
    if (aAuth !== bAuth) {
      return aAuth ? -1 : 1;
    }

    // Not rate-limited profiles first
    const aLimited = isProfileRateLimited(a);
    const bLimited = isProfileRateLimited(b);

    if (aLimited.limited !== bLimited.limited) {
      return aLimited.limited ? 1 : -1;
    }

    // If both limited, sort by reset time
    if (aLimited.limited && bLimited.limited && aLimited.resetAt && bLimited.resetAt) {
      return aLimited.resetAt.getTime() - bLimited.resetAt.getTime();
    }

    // Sort by lower weekly usage
    const aWeekly = a.usage?.weeklyUsagePercent ?? 0;
    const bWeekly = b.usage?.weeklyUsagePercent ?? 0;
    if (aWeekly !== bWeekly) {
      return aWeekly - bWeekly;
    }

    // Sort by lower session usage
    const aSession = a.usage?.sessionUsagePercent ?? 0;
    const bSession = b.usage?.sessionUsagePercent ?? 0;
    return aSession - bSession;
  });
}
