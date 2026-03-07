/**
 * AuthStatusIndicator - Display current authentication method in header
 *
 * Shows the active authentication method and provider:
 * - OAuth: Shows "OAuth Anthropic" with Lock icon
 * - API Profile: Shows provider name (z.ai, ZHIPU AI) with Key icon and provider-specific colors
 *
 * Provider detection is based on the profile's baseUrl:
 * - api.anthropic.com → Anthropic
 * - api.z.ai → z.ai
 * - open.bigmodel.cn, dev.bigmodel.cn → ZHIPU AI
 *
 * Usage warning badge: Shows to the left of provider badge when usage exceeds 90%
 */

import { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Key, Lock, Shield, Server, Fingerprint, ExternalLink } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settings-store';
import { detectProvider, getProviderLabel, getProviderBadgeColor, type ApiProvider } from '../../shared/utils/provider-detection';
import { formatTimeRemaining, localizeUsageWindowLabel, hasHardcodedText } from '../../shared/utils/format-time';
import type { ClaudeUsageSnapshot } from '../../shared/types/agent';

/**
 * Type-safe mapping from ApiProvider to translation keys
 */
const PROVIDER_TRANSLATION_KEYS: Readonly<Record<ApiProvider, string>> = {
  anthropic: 'common:usage.providerAnthropic',
  zai: 'common:usage.providerZai',
  zhipu: 'common:usage.providerZhipu',
  unknown: 'common:usage.providerUnknown'
} as const;

/**
 * OAuth fallback state when no profile is active or profile not found
 */
const OAUTH_FALLBACK = {
  type: 'oauth' as const,
  name: 'OAuth',
  provider: 'anthropic' as const,
  providerLabel: 'Anthropic',
  badgeColor: 'bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/15'
} as const;

export function AuthStatusIndicator() {
  // Subscribe to profile state from settings store
  const { profiles, activeProfileId } = useSettingsStore();
  const { t } = useTranslation(['common']);

  // Track usage data for warning badge
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);

  // Listen for usage updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsLoadingUsage(false);
    });

    // Request initial usage
    window.electronAPI.requestUsageUpdate()
      .then((result) => {
        if (result.success && result.data) {
          setUsage(result.data);
        }
      })
      .catch((error) => {
        console.warn('[AuthStatusIndicator] Failed to fetch usage:', error);
      })
      .finally(() => {
        setIsLoadingUsage(false);
      });

    return () => {
      unsubscribe();
    };
  }, []);

  // Determine if usage warning badge should be shown
  const shouldShowUsageWarning = usage && !isLoadingUsage && (
    usage.sessionPercent >= 90 || usage.weeklyPercent >= 90
  );

  // Get the higher usage percentage for the warning badge
  const warningBadgePercent = usage
    ? Math.max(usage.sessionPercent, usage.weeklyPercent)
    : 0;

  // Get formatted reset times (calculated dynamically from timestamps)
  // Only fall back to sessionResetTime if it doesn't contain placeholder/hardcoded text
  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime))
    : (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime);

  // Compute auth status and provider detection using useMemo to avoid unnecessary re-renders
  const authStatus = useMemo(() => {
    if (activeProfileId) {
      const activeProfile = profiles.find(p => p.id === activeProfileId);
      if (activeProfile) {
        // Detect provider from profile's baseUrl
        const provider = detectProvider(activeProfile.baseUrl);
        const providerLabel = getProviderLabel(provider);
        return {
          type: 'profile' as const,
          name: activeProfile.name,
          id: activeProfile.id,
          baseUrl: activeProfile.baseUrl,
          createdAt: activeProfile.createdAt,
          provider,
          providerLabel,
          badgeColor: getProviderBadgeColor(provider)
        };
      }
      // Profile ID set but profile not found - fallback to OAuth
      return OAUTH_FALLBACK;
    }
    // No active profile - using OAuth
    return OAUTH_FALLBACK;
  }, [activeProfileId, profiles]);

  // Helper function to truncate ID for display
  const truncateId = (id: string): string => {
    return id.slice(0, 8);
  };

  // Get localized provider label for display
  // Uses type-safe mapping with fallback to getProviderLabel for unknown providers
  const getLocalizedProviderLabel = (provider: ApiProvider): string => {
    const translationKey = PROVIDER_TRANSLATION_KEYS[provider];

    // If we have a translation key (including providerUnknown), use it
    if (translationKey) {
      const translated = t(translationKey);
      // If translation returns the key itself (not found), use getProviderLabel fallback
      if (translated !== translationKey) {
        return translated;
      }
    }

    // Fallback to getProviderLabel for providers without translation keys
    return getProviderLabel(provider);
  };

  const isOAuth = authStatus.type === 'oauth';
  const Icon = isOAuth ? Lock : Key;
  // Compute once and reuse for aria-label and displayed text
  const localizedProviderLabel = getLocalizedProviderLabel(authStatus.provider);
  // Badge label: "Claude Code" for OAuth, "API Key" for API profiles
  const badgeLabel = isOAuth ? t('common:usage.claudeCode') : t('common:usage.apiKey');

  return (
    <div className="flex items-center gap-2">
      {/* Usage Warning Badge (shown when usage >= 90%) */}
      {shouldShowUsageWarning && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-red-500/10 text-red-500 border-red-500/20">
                <AlertTriangle className="h-3.5 w-3.5 motion-safe:animate-pulse" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground font-medium">{t('common:usage.usageAlert')}</span>
                  <span className="font-semibold text-red-500">{Math.round(warningBadgePercent)}%</span>
                </div>
                <div className="h-px bg-border" />
                <div className="text-[10px] text-muted-foreground">
                  {t('common:usage.accountExceedsThreshold')}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Provider Badge */}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all hover:opacity-80 ${authStatus.badgeColor}`}
              aria-label={t('common:usage.authenticationAriaLabel', { provider: badgeLabel })}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">
                {badgeLabel}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-xs p-0">
            <div className="p-3 space-y-3">
              {/* Header section */}
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  <span className="font-semibold text-xs">{t('common:usage.authenticationDetails')}</span>
                </div>
                <div className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  isOAuth
                    ? 'bg-orange-500/15 text-orange-500'
                    : 'bg-primary/15 text-primary'
                }`}>
                  {isOAuth ? t('common:usage.oauth') : t('common:usage.apiKey')}
                </div>
              </div>

              {/* Provider info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  <span className="font-medium text-[11px]">{t('common:usage.provider')}</span>
                </div>
                <span className="font-semibold text-xs">{localizedProviderLabel}</span>
              </div>

              {/* Claude Code subscription label for OAuth */}
              {isOAuth && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span className="text-[10px]">{t('common:usage.subscription')}</span>
                  </div>
                  <span className="font-medium text-[10px]">{t('common:usage.claudeCodeSubscription')}</span>
                </div>
              )}

              {/* Profile details for API profiles */}
              {!isOAuth && (
                <div className="pt-2 border-t space-y-2">
                    {/* Profile name with icon */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Key className="h-3 w-3" />
                        <span className="text-[10px]">{t('common:usage.profile')}</span>
                      </div>
                      <span className="font-medium text-[10px]">{authStatus.name}</span>
                    </div>

                    {/* Profile ID with icon */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Fingerprint className="h-3 w-3" />
                        <span className="text-[10px]">{t('common:usage.id')}</span>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {truncateId(authStatus.id)}
                      </span>
                    </div>

                    {/* API Endpoint with better styling */}
                    {authStatus.baseUrl && (
                      <div className="pt-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                          <ExternalLink className="h-3 w-3" />
                          <span>{t('common:usage.apiEndpoint')}</span>
                        </div>
                        <div className="text-[10px] font-mono bg-muted px-2 py-1.5 rounded break-all border">
                          {authStatus.baseUrl}
                        </div>
                      </div>
                    )}
                  </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 5 Hour Usage Badge (shown when session usage >= 90%) */}
      {usage && !isLoadingUsage && usage.sessionPercent >= 90 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-red-500/10 text-red-500 border-red-500/20 text-xs font-semibold">
                {Math.round(usage.sessionPercent)}%
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground font-medium">{localizeUsageWindowLabel(usage?.usageWindows?.sessionWindowLabel, t)}</span>
                  <span className="font-semibold text-red-500">{Math.round(usage.sessionPercent)}%</span>
                </div>
                {sessionResetTime && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="text-[10px] text-muted-foreground">
                      {sessionResetTime}
                    </div>
                  </>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
