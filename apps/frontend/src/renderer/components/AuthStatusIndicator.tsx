/**
 * AuthStatusIndicator - Display the active provider/account in the header.
 *
 * Uses the provider-account registry as the source of truth so Claude Code,
 * OpenAI Codex, and Custom Endpoints stay in sync with the usage meter.
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
import { detectProvider, getProviderBadgeColor, getProviderLabel, type ApiProvider } from '../../shared/utils/provider-detection';
import { formatTimeRemaining, localizeUsageWindowLabel, hasHardcodedText } from '../../shared/utils/format-time';
import type { ClaudeAutoSwitchSettings, ClaudeUsageSnapshot, ProviderAccount } from '../../shared/types';

type HeaderProvider = ApiProvider | 'openai' | 'openai-compatible';

interface AuthStatus {
  type: 'oauth' | 'api-key';
  name: string;
  id: string;
  provider: HeaderProvider;
  providerLabel: string;
  badgeColor: string;
  baseUrl?: string;
}

const OAUTH_FALLBACK: AuthStatus = {
  type: 'oauth',
  name: 'Primary',
  id: 'oauth-fallback',
  provider: 'anthropic',
  providerLabel: 'Anthropic',
  badgeColor: 'bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/15',
};

function getHeaderProviderLabel(provider: HeaderProvider, t: (key: string, options?: unknown) => string): string {
  switch (provider) {
    case 'openai':
      return t('common:usage.providerOpenAI', { defaultValue: 'OpenAI Codex' });
    case 'openai-compatible':
      return t('common:usage.providerCustomEndpoint', { defaultValue: 'Custom Endpoint' });
    default:
      return getProviderLabel(provider);
  }
}

function getHeaderProviderBadgeColor(provider: HeaderProvider): string {
  switch (provider) {
    case 'openai':
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/15';
    case 'openai-compatible':
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20 hover:bg-gray-500/15';
    default:
      return getProviderBadgeColor(provider);
  }
}

function resolveUsageMatchedAccount(
  providerAccounts: ProviderAccount[],
  usageProfileId: string | undefined,
): ProviderAccount | undefined {
  if (!usageProfileId) {
    return undefined;
  }

  return providerAccounts.find((account) =>
    account.id === usageProfileId
    || account.claudeProfileId === usageProfileId
    || account.apiProfileId === usageProfileId
  );
}

export function AuthStatusIndicator() {
  const { settings, profiles, activeProfileId } = useSettingsStore();
  const { t } = useTranslation(['common']);
  const providerAccounts = settings.providerAccounts ?? [];

  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [autoSwitchSettings, setAutoSwitchSettings] = useState<ClaudeAutoSwitchSettings | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsLoadingUsage(false);
    });

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

    window.electronAPI.getAutoSwitchSettings?.()
      .then((result) => {
        if (result?.success && result.data) {
          setAutoSwitchSettings(result.data);
        }
      })
      .catch((error) => {
        console.warn('[AuthStatusIndicator] Failed to fetch auto-switch settings:', error);
      });

    return () => {
      unsubscribe();
    };
  }, []);

  const shouldShowUsageWarning = usage && !isLoadingUsage && (
    usage.sessionPercent >= 90 || usage.weeklyPercent >= 90
  );

  const warningBadgePercent = usage
    ? Math.max(usage.sessionPercent, usage.weeklyPercent)
    : 0;

  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime))
    : (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime);

  const authStatus = useMemo<AuthStatus>(() => {
    const usageMatchedAccount = resolveUsageMatchedAccount(providerAccounts, usage?.profileId);
    const defaultAccount = autoSwitchSettings?.defaultProviderId
      ? providerAccounts.find((account) => account.id === autoSwitchSettings.defaultProviderId)
      : undefined;
    const apiMatchedAccount = activeProfileId
      ? providerAccounts.find(
          (account) => account.provider === 'openai-compatible' && account.apiProfileId === activeProfileId
        )
      : undefined;

    const activeAccount = usageMatchedAccount ?? defaultAccount ?? apiMatchedAccount;
    if (!activeAccount) {
      return OAUTH_FALLBACK;
    }

    if (activeAccount.provider === 'openai') {
      return {
        type: 'oauth',
        name: activeAccount.name,
        id: activeAccount.id,
        provider: 'openai',
        providerLabel: getHeaderProviderLabel('openai', t),
        badgeColor: getHeaderProviderBadgeColor('openai'),
        baseUrl: 'https://chatgpt.com',
      };
    }

    if (activeAccount.provider === 'anthropic') {
      return {
        type: 'oauth',
        name: activeAccount.name,
        id: activeAccount.id,
        provider: 'anthropic',
        providerLabel: getHeaderProviderLabel('anthropic', t),
        badgeColor: getHeaderProviderBadgeColor('anthropic'),
      };
    }

    const apiProfile = activeAccount.apiProfileId
      ? profiles.find((profile) => profile.id === activeAccount.apiProfileId)
      : undefined;
    const provider = apiProfile?.baseUrl ? detectProvider(apiProfile.baseUrl) : 'openai-compatible';
    const baseUrl = apiProfile?.baseUrl ?? activeAccount.baseUrl;

    return {
      type: 'api-key',
      name: activeAccount.name,
      id: activeAccount.id,
      provider,
      providerLabel: getHeaderProviderLabel(provider, t),
      badgeColor: getHeaderProviderBadgeColor(provider),
      baseUrl,
    };
  }, [activeProfileId, autoSwitchSettings?.defaultProviderId, profiles, providerAccounts, t, usage?.profileId]);

  const truncateId = (id: string): string => id.slice(0, 8);

  const isCodex = authStatus.provider === 'openai';
  const isOAuth = authStatus.type === 'oauth';
  const Icon = isOAuth ? Lock : Key;
  const badgeLabel = isCodex
    ? t('common:usage.providerOpenAI', { defaultValue: 'OpenAI Codex' })
    : isOAuth
      ? t('common:usage.claudeCode')
      : t('common:usage.apiKey');

  return (
    <div className="flex items-center gap-2">
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
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  <span className="font-semibold text-xs">{t('common:usage.authenticationDetails')}</span>
                </div>
                <div className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  isCodex
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : isOAuth
                      ? 'bg-orange-500/15 text-orange-500'
                      : 'bg-primary/15 text-primary'
                }`}>
                  {isCodex ? 'Codex' : isOAuth ? t('common:usage.oauth') : t('common:usage.apiKey')}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  <span className="font-medium text-[11px]">{t('common:usage.provider')}</span>
                </div>
                <span className="font-semibold text-xs">{authStatus.providerLabel}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Key className="h-3 w-3" />
                  <span className="text-[10px]">{t('common:usage.profile')}</span>
                </div>
                <span className="font-medium text-[10px]">{authStatus.name}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Fingerprint className="h-3 w-3" />
                  <span className="text-[10px]">{t('common:usage.id')}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {truncateId(authStatus.id)}
                </span>
              </div>

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
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

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
