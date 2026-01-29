/**
 * Usage Indicator - Real-time Claude usage display in header
 *
 * Displays current session/weekly usage as a badge with color-coded status.
 * - Hover to show breakdown popup (auto-closes on mouse leave)
 * - Click to pin popup open (stays until clicking outside)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, TrendingUp, AlertCircle, Clock, ChevronRight, Info, LogIn } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { useTranslation } from 'react-i18next';
import { formatTimeRemaining, localizeUsageWindowLabel, hasHardcodedText } from '../../shared/utils/format-time';
import type { ClaudeUsageSnapshot, ProfileUsageSummary } from '../../shared/types/agent';
import type { AppSection } from './settings/AppSettings';

/**
 * Usage threshold constants for color coding
 */
const THRESHOLD_CRITICAL = 95;  // Red: At or near limit
const THRESHOLD_WARNING = 91;   // Orange: Very high usage
const THRESHOLD_ELEVATED = 71;  // Yellow: Moderate usage
// Below 71 is considered normal (green)

/**
 * Get color class based on usage percentage
 */
const getColorClass = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'text-red-500';
  if (percent >= THRESHOLD_WARNING) return 'text-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'text-yellow-500';
  return 'text-green-500';
};

/**
 * Get background/border color classes for badges based on usage percentage
 */
const getBadgeColorClasses = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'text-red-500 bg-red-500/10 border-red-500/20';
  if (percent >= THRESHOLD_WARNING) return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
  if (percent >= THRESHOLD_ELEVATED) return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
  return 'text-green-500 bg-green-500/10 border-green-500/20';
};

/**
 * Get gradient background class based on usage percentage
 */
const getGradientClass = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'bg-gradient-to-r from-red-600 to-red-500';
  if (percent >= THRESHOLD_WARNING) return 'bg-gradient-to-r from-orange-600 to-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'bg-gradient-to-r from-yellow-600 to-yellow-500';
  return 'bg-gradient-to-r from-green-600 to-green-500';
};

/**
 * Get background class for small usage bars based on usage percentage
 */
const getBarColorClass = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'bg-red-500';
  if (percent >= THRESHOLD_WARNING) return 'bg-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'bg-yellow-500';
  return 'bg-green-500';
};

export function UsageIndicator() {
  const { t, i18n } = useTranslation(['common']);
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [otherProfiles, setOtherProfiles] = useState<ProfileUsageSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);
  const [activeProfileNeedsReauth, setActiveProfileNeedsReauth] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Helper function to get initials from a profile name
   */
  const getInitials = (name: string): string => {
    if (!name || name.trim().length === 0) {
      return 'UN'; // Unknown
    }
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  /**
   * Helper function to format large numbers with locale-aware compact notation
   */
  const formatUsageValue = (value?: number | null): string | undefined => {
    if (value == null) return undefined;

    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      try {
        return new Intl.NumberFormat(i18n.language, {
          notation: 'compact',
          compactDisplay: 'short',
          maximumFractionDigits: 2
        }).format(value);
      } catch {
        // Intl may fail in some environments, fall back to toString()
      }
    }
    return value.toString();
  };

  /**
   * Navigate to settings accounts tab
   */
  const handleOpenAccounts = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Close the popover first
    setIsOpen(false);
    setIsPinned(false);
    // Dispatch custom event to open settings with accounts section
    // Small delay to allow popover to close first
    setTimeout(() => {
      const event = new CustomEvent<AppSection>('open-app-settings', {
        detail: 'accounts'
      });
      window.dispatchEvent(event);
    }, 100);
  }, []);

  /**
   * Handle swapping to a different profile
   * Uses optimistic UI update for immediate feedback, then fetches fresh data
   */
  const handleSwapProfile = useCallback(async (e: React.MouseEvent, profileId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Capture previous state for revert (before any changes)
    const previousUsage = usage;
    const previousOtherProfiles = otherProfiles;

    // Find the profile we're swapping to
    const targetProfile = otherProfiles.find(p => p.profileId === profileId);
    if (!targetProfile) {
      console.error('[UsageIndicator] Target profile not found:', profileId);
      return;
    }

    // Optimistic update: immediately swap profiles in the UI
    // 1. Convert current active profile to a ProfileUsageSummary for the "other" list
    const currentActiveAsSummary: ProfileUsageSummary = {
      profileId: usage?.profileId || '',
      profileName: usage?.profileName || '',
      profileEmail: usage?.profileEmail,
      sessionPercent: usage?.sessionPercent || 0,
      weeklyPercent: usage?.weeklyPercent || 0,
      sessionResetTimestamp: usage?.sessionResetTimestamp,
      weeklyResetTimestamp: usage?.weeklyResetTimestamp,
      isAuthenticated: true,
      isRateLimited: false,
      availabilityScore: 100 - Math.max(usage?.sessionPercent || 0, usage?.weeklyPercent || 0),
      isActive: false, // It's no longer active
      needsReauthentication: usage?.needsReauthentication,
    };

    // 2. Convert target profile to a ClaudeUsageSnapshot for the active display
    const newActiveUsage: ClaudeUsageSnapshot = {
      profileId: targetProfile.profileId,
      profileName: targetProfile.profileName,
      profileEmail: targetProfile.profileEmail,
      sessionPercent: targetProfile.sessionPercent,
      weeklyPercent: targetProfile.weeklyPercent,
      sessionResetTimestamp: targetProfile.sessionResetTimestamp,
      weeklyResetTimestamp: targetProfile.weeklyResetTimestamp,
      fetchedAt: new Date(),
      needsReauthentication: targetProfile.needsReauthentication,
    };

    // 3. Update the other profiles list: remove target, add current active
    const newOtherProfiles = otherProfiles
      .filter(p => p.profileId !== profileId)
      .concat(usage ? [currentActiveAsSummary] : [])
      .sort((a, b) => b.availabilityScore - a.availabilityScore);

    // Apply optimistic update immediately
    setUsage(newActiveUsage);
    setOtherProfiles(newOtherProfiles);

    try {
      // Actually switch the profile on the backend
      const result = await window.electronAPI.setActiveClaudeProfile(profileId);
      if (result.success) {
        // Fetch fresh data in the background (will update via event listeners)
        window.electronAPI.requestUsageUpdate();
        window.electronAPI.requestAllProfilesUsage?.();

        // If the profile needs re-authentication, open Settings > Accounts
        // so the user can complete the re-auth flow
        if (targetProfile.needsReauthentication) {
          // Close the popover first
          setIsOpen(false);
          setIsPinned(false);
          // Open settings with accounts section after a short delay
          setTimeout(() => {
            const event = new CustomEvent<AppSection>('open-app-settings', {
              detail: 'accounts'
            });
            window.dispatchEvent(event);
          }, 100);
        }
      } else {
        // Revert to captured previous state
        console.error('[UsageIndicator] Failed to swap profile, reverting');
        if (previousUsage) setUsage(previousUsage);
        setOtherProfiles(previousOtherProfiles);
      }
    } catch (error) {
      console.error('[UsageIndicator] Failed to swap profile:', error);
      // Revert to captured previous state
      if (previousUsage) setUsage(previousUsage);
      setOtherProfiles(previousOtherProfiles);
    }
  }, [usage, otherProfiles]);

  /**
   * Handle mouse enter - show popup after short delay (unless pinned)
   */
  const handleMouseEnter = useCallback(() => {
    if (isPinned) return;
    // Clear any pending close timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Open after short delay for smoother UX
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, 150);
  }, [isPinned]);

  /**
   * Handle mouse leave - close popup after delay (unless pinned)
   */
  const handleMouseLeave = useCallback(() => {
    if (isPinned) return;
    // Clear any pending open timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Close after delay to allow moving to popup content
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 300);
  }, [isPinned]);

  /**
   * Handle click on trigger - toggle pinned state
   */
  const handleTriggerClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isPinned) {
      // Clicking when pinned unpins and closes
      setIsPinned(false);
      setIsOpen(false);
    } else {
      // Clicking when not pinned pins it open
      setIsPinned(true);
      setIsOpen(true);
    }
  }, [isPinned]);

  /**
   * Handle popover open change (e.g., clicking outside)
   */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      // Closing from outside click
      setIsOpen(false);
      setIsPinned(false);
    }
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Get formatted reset times (calculated dynamically from timestamps)
  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime))
    : (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime);
  const weeklyResetTime = usage?.weeklyResetTimestamp
    ? (formatTimeRemaining(usage.weeklyResetTimestamp, t) ??
      (hasHardcodedText(usage?.weeklyResetTime) ? undefined : usage?.weeklyResetTime))
    : (hasHardcodedText(usage?.weeklyResetTime) ? undefined : usage?.weeklyResetTime);

  useEffect(() => {
    // Listen for usage updates from main process
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsAvailable(true);
      setIsLoading(false);
    });

    // Listen for all profiles usage updates (for multi-profile display)
    const unsubscribeAllProfiles = window.electronAPI.onAllProfilesUsageUpdated?.((allProfilesUsage) => {
      // Filter out the active profile - we only want to show "other" profiles
      const nonActiveProfiles = allProfilesUsage.allProfiles.filter(p => !p.isActive);
      setOtherProfiles(nonActiveProfiles);
      // Track if active profile needs re-auth
      const activeProfile = allProfilesUsage.allProfiles.find(p => p.isActive);
      setActiveProfileNeedsReauth(activeProfile?.needsReauthentication ?? false);
    });

    // Request initial usage on mount
    window.electronAPI.requestUsageUpdate().then((result) => {
      setIsLoading(false);
      if (result.success && result.data) {
        setUsage(result.data);
        setIsAvailable(true);
      } else {
        setIsAvailable(false);
      }
    }).catch((error) => {
      console.warn('[UsageIndicator] Failed to fetch initial usage:', error);
      setIsLoading(false);
      setIsAvailable(false);
    });

    // Request all profiles usage immediately on mount (so other accounts show right away)
    window.electronAPI.requestAllProfilesUsage?.().then((result) => {
      if (result.success && result.data) {
        const nonActiveProfiles = result.data.allProfiles.filter(p => !p.isActive);
        setOtherProfiles(nonActiveProfiles);
        // Track if active profile needs re-auth (even if main usage is unavailable)
        const activeProfile = result.data.allProfiles.find(p => p.isActive);
        if (activeProfile?.needsReauthentication) {
          setActiveProfileNeedsReauth(true);
        }
      }
    }).catch((error) => {
      console.warn('[UsageIndicator] Failed to fetch all profiles usage:', error);
    });

    return () => {
      unsubscribe();
      unsubscribeAllProfiles?.();
    };
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-muted/50 text-muted-foreground">
        <Activity className="h-3.5 w-3.5 motion-safe:animate-pulse" />
        <span className="text-xs font-semibold">{t('common:usage.loading')}</span>
      </div>
    );
  }

  // Show unavailable state - with better messaging based on cause
  if (!isAvailable || !usage) {
    // Check if it's a re-auth issue (better UX than generic "not supported")
    const needsReauth = activeProfileNeedsReauth;

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border cursor-help ${
                needsReauth
                  ? 'bg-red-500/10 border-red-500/20 text-red-500'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
              aria-label={needsReauth ? t('common:usage.reauthRequired') : t('common:usage.dataUnavailable')}
            >
              {needsReauth ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">!</span>
                </>
              ) : (
                <>
                  <Activity className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">{t('common:usage.notAvailable')}</span>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs w-64">
            <div className="space-y-1">
              {needsReauth ? (
                <>
                  <p className="font-medium text-red-500">{t('common:usage.reauthRequired')}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {t('common:usage.reauthRequiredDescription')}
                  </p>
                  <button
                    onClick={handleOpenAccounts}
                    className="text-[10px] text-primary mt-1 font-medium underline hover:text-primary/80 cursor-pointer"
                  >
                    {t('common:usage.clickToOpenSettings')}
                  </button>
                </>
              ) : (
                <>
                  <p className="font-medium">{t('common:usage.dataUnavailable')}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {t('common:usage.dataUnavailableDescription')}
                  </p>
                </>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Determine colors and labels based on the LIMITING factor (higher of session/weekly)
  const sessionPercent = usage.sessionPercent;
  const weeklyPercent = usage.weeklyPercent;
  const limitingPercent = Math.max(sessionPercent, weeklyPercent);

  // Badge color based on the limiting (higher) percentage
  // Override to red/destructive when re-auth is needed
  const badgeColorClasses = usage.needsReauthentication
    ? 'text-red-500 bg-red-500/10 border-red-500/20'
    : getBadgeColorClasses(limitingPercent);

  // Individual colors for session and weekly in the badge
  const sessionColorClass = getColorClass(sessionPercent);
  const weeklyColorClass = getColorClass(weeklyPercent);

  const sessionLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.sessionWindowLabel,
    t,
    'common:usage.sessionDefault'
  );
  const weeklyLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.weeklyWindowLabel,
    t,
    'common:usage.weeklyDefault'
  );

  const maxUsage = Math.max(usage.sessionPercent, usage.weeklyPercent);
  // Show AlertCircle when re-auth needed or high usage
  const Icon = usage.needsReauthentication ? AlertCircle :
    maxUsage >= THRESHOLD_WARNING ? AlertCircle :
    maxUsage >= THRESHOLD_ELEVATED ? TrendingUp :
    Activity;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1 px-2 py-1.5 rounded-md border transition-all hover:opacity-80 ${badgeColorClasses}`}
          aria-label={t('common:usage.usageStatusAriaLabel')}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleTriggerClick}
        >
          <Icon className="h-3.5 w-3.5 flex-shrink-0" />
          {/* Show "!" when re-auth needed, otherwise dual usage display */}
          {usage.needsReauthentication ? (
            <span className="text-xs font-semibold text-red-500" title={t('common:usage.needsReauth')}>
              !
            </span>
          ) : (
            <div className="flex items-center gap-0.5 text-xs font-semibold font-mono">
              <span className={sessionColorClass} title={t('common:usage.sessionShort')}>
                {Math.round(sessionPercent)}
              </span>
              <span className="text-muted-foreground/50">│</span>
              <span className={weeklyColorClass} title={t('common:usage.weeklyShort')}>
                {Math.round(weeklyPercent)}
              </span>
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="text-xs w-72 p-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-3 space-y-3">
          {/* Header with overall status */}
          <div className="flex items-center gap-1.5 pb-2 border-b">
            <Icon className="h-3.5 w-3.5" />
            <span className="font-semibold text-xs">{t('common:usage.usageBreakdown')}</span>
          </div>

          {/* Re-auth required prompt - shown when active profile needs re-authentication */}
          {usage.needsReauthentication ? (
            <div className="py-2 space-y-3">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">
                    {t('common:usage.reauthRequired')}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {t('common:usage.reauthRequiredDescription')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenAccounts}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-xs font-medium"
              >
                <LogIn className="h-3.5 w-3.5" />
                {t('common:usage.reauthButton')}
              </button>
            </div>
          ) : (
            <>
              {/* Session/5-hour usage */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium text-[11px] flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {sessionLabel}
                  </span>
                  <span className={`font-semibold tabular-nums text-xs ${getColorClass(usage.sessionPercent).replace('500', '600')}`}>
                    {Math.round(usage.sessionPercent)}%
                  </span>
                </div>
                {sessionResetTime && (
                  <div className="text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
                    <Info className="h-2.5 w-2.5" />
                    {sessionResetTime}
                  </div>
                )}
                <div className="h-2 bg-muted rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${getGradientClass(usage.sessionPercent)}`}
                    style={{ width: `${Math.min(usage.sessionPercent, 100)}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-pulse" />
                  </div>
                </div>
                {usage.sessionUsageValue != null && usage.sessionUsageLimit != null && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{t('common:usage.used')}</span>
                    <span className="font-medium tabular-nums">
                      {formatUsageValue(usage.sessionUsageValue)} <span className="text-muted-foreground mx-1">/</span> {formatUsageValue(usage.sessionUsageLimit)}
                    </span>
                  </div>
                )}
              </div>

              {/* Weekly/Monthly usage */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium text-[11px] flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {weeklyLabel}
                  </span>
                  <span className={`font-semibold tabular-nums text-xs ${getColorClass(usage.weeklyPercent).replace('500', '600')}`}>
                    {Math.round(usage.weeklyPercent)}%
                  </span>
                </div>
                {weeklyResetTime && (
                  <div className="text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
                    <Info className="h-2.5 w-2.5" />
                    {weeklyResetTime}
                  </div>
                )}
                <div className="h-2 bg-muted rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${getGradientClass(usage.weeklyPercent)}`}
                    style={{ width: `${Math.min(usage.weeklyPercent, 100)}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-pulse" />
                  </div>
                </div>
                {usage.weeklyUsageValue != null && usage.weeklyUsageLimit != null && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{t('common:usage.used')}</span>
                    <span className="font-medium tabular-nums">
                      {formatUsageValue(usage.weeklyUsageValue)} <span className="text-muted-foreground mx-1">/</span> {formatUsageValue(usage.weeklyUsageLimit)}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Active account footer - clickable to go to settings */}
          <button
            type="button"
            onClick={handleOpenAccounts}
            className={`w-full pt-3 border-t flex items-center gap-2.5 hover:bg-muted/50 -mx-3 px-3 ${otherProfiles.length === 0 ? '-mb-3 pb-3 rounded-b-md' : 'pb-2'} transition-colors cursor-pointer group`}
          >
            {/* Initials Avatar with warning indicator for re-auth needed */}
            <div className="relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                usage.needsReauthentication ? 'bg-red-500/10' : 'bg-primary/10'
              }`}>
                <span className={`text-xs font-semibold ${
                  usage.needsReauthentication ? 'text-red-500' : 'text-primary'
                }`}>
                  {getInitials(usage.profileName)}
                </span>
              </div>
              {/* Status dot for re-auth needed */}
              {usage.needsReauthentication && (
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-background" />
              )}
            </div>

            {/* Account Info */}
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground font-medium">
                  {t('common:usage.activeAccount')}
                </span>
                {usage.needsReauthentication && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-destructive rounded font-semibold">
                    {t('common:usage.needsReauth')}
                  </span>
                )}
              </div>
              <div className={`font-medium text-xs truncate ${
                usage.needsReauthentication ? 'text-destructive' : 'text-primary'
              }`}>
                {usage.profileEmail || usage.profileName}
              </div>
            </div>

            {/* Chevron */}
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
          </button>

          {/* Other profiles section - sorted by availability */}
          {otherProfiles.length > 0 && (
            <div className="pt-2 -mx-3 px-3 -mb-3 pb-3 space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium mb-1.5">
                {t('common:usage.otherAccounts')}
              </div>
              {otherProfiles.map((profile, index) => (
                <div
                  key={profile.profileId}
                  className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/30 transition-colors"
                >
                  {/* Initials Avatar with status indicator */}
                  <div className="relative">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      profile.isRateLimited || profile.needsReauthentication
                        ? 'bg-red-500/10'
                        : !profile.isAuthenticated
                          ? 'bg-muted'
                          : 'bg-muted/80'
                    }`}>
                      <span className={`text-[10px] font-semibold ${
                        profile.isRateLimited || profile.needsReauthentication
                          ? 'text-red-500'
                          : !profile.isAuthenticated
                            ? 'text-muted-foreground'
                            : 'text-foreground/70'
                      }`}>
                        {getInitials(profile.profileName)}
                      </span>
                    </div>
                    {/* Status dot */}
                    {(profile.isRateLimited || profile.needsReauthentication) && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-background" />
                    )}
                  </div>

                  {/* Profile Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium truncate">
                        {profile.profileEmail || profile.profileName}
                      </span>
                      {index === 0 && !profile.isRateLimited && profile.isAuthenticated && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-semibold">
                          {t('common:usage.next')}
                        </span>
                      )}
                      {/* Swap button - only show for authenticated profiles */}
                      {profile.isAuthenticated && (
                        <button
                          onClick={(e) => handleSwapProfile(e, profile.profileId)}
                          className="text-[9px] px-1.5 py-0.5 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground rounded transition-colors ml-auto"
                        >
                          {t('common:usage.swap')}
                        </button>
                      )}
                    </div>
                    {/* Usage bars or status - show both session and weekly */}
                    {profile.isRateLimited ? (
                      <span className="text-[9px] text-red-500">
                        {profile.rateLimitType === 'weekly'
                          ? t('common:usage.weeklyLimitReached')
                          : t('common:usage.sessionLimitReached')}
                      </span>
                    ) : profile.needsReauthentication ? (
                      <span className="text-[9px] text-destructive">
                        {t('common:usage.needsReauth')}
                      </span>
                    ) : !profile.isAuthenticated ? (
                      <span className="text-[9px] text-muted-foreground">
                        {t('common:usage.notAuthenticated')}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 mt-0.5">
                        {/* Session usage (short-term) */}
                        <div className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5 text-muted-foreground/70" />
                          <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getBarColorClass(profile.sessionPercent)}`}
                              style={{ width: `${Math.min(profile.sessionPercent, 100)}%` }}
                            />
                          </div>
                          <span className={`text-[9px] tabular-nums w-6 ${getColorClass(profile.sessionPercent).replace('text-green-500', 'text-muted-foreground').replace('500', '600')}`}>
                            {Math.round(profile.sessionPercent)}%
                          </span>
                        </div>
                        {/* Weekly usage (long-term) */}
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-2.5 w-2.5 text-muted-foreground/70" />
                          <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getBarColorClass(profile.weeklyPercent)}`}
                              style={{ width: `${Math.min(profile.weeklyPercent, 100)}%` }}
                            />
                          </div>
                          <span className={`text-[9px] tabular-nums w-6 ${getColorClass(profile.weeklyPercent).replace('text-green-500', 'text-muted-foreground').replace('500', '600')}`}>
                            {Math.round(profile.weeklyPercent)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
