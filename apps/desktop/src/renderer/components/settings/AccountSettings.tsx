/**
 * AccountSettings - Unified account management across all AI providers
 *
 * Replaced the former two-tab (Claude Code / Custom Endpoints) layout with a
 * single provider-grouped list using ProviderAccountsList. The automatic
 * account switching section (AccountPriorityList) is kept below.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Activity,
  AlertCircle,
  Clock,
  TrendingUp
} from 'lucide-react';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { SettingsSection } from './SettingsSection';
import { AccountPriorityList, type UnifiedAccount } from './AccountPriorityList';
import { ProviderAccountsList } from './ProviderAccountsList';
import { useSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import type { AppSettings, ClaudeAutoSwitchSettings, ProfileUsageSummary } from '../../../shared/types';

interface AccountSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  isOpen: boolean;
}

export function AccountSettings({ settings, onSettingsChange, isOpen }: AccountSettingsProps) {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const { getProviderAccounts } = useSettingsStore();

  // ============================================
  // Auto-switch settings state
  // ============================================
  const [autoSwitchSettings, setAutoSwitchSettings] = useState<ClaudeAutoSwitchSettings | null>(null);
  const [isLoadingAutoSwitch, setIsLoadingAutoSwitch] = useState(false);

  // ============================================
  // Priority order state
  // ============================================
  const [priorityOrder, setPriorityOrder] = useState<string[]>([]);
  const [isSavingPriority, setIsSavingPriority] = useState(false);

  // ============================================
  // Usage data state
  // ============================================
  const [profileUsageData, setProfileUsageData] = useState<Map<string, ProfileUsageSummary>>(new Map());

  const loadProfileUsageData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      const result = await window.electronAPI.requestAllProfilesUsage?.(forceRefresh);
      if (result?.success && result.data) {
        const usageMap = new Map<string, ProfileUsageSummary>();
        result.data.allProfiles.forEach(profile => {
          usageMap.set(profile.profileId, profile);
        });
        setProfileUsageData(usageMap);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Build unified accounts list from provider accounts
  const buildUnifiedAccounts = useCallback((): UnifiedAccount[] => {
    const allAccounts = getProviderAccounts();
    return allAccounts.map(account => {
      const usageData = (account.claudeProfileId
        ? profileUsageData.get(account.claudeProfileId)
        : undefined) ?? profileUsageData.get(account.id);
      const profileEmail = usageData?.profileEmail || account.email;

      const identifier = account.authType === 'oauth'
        ? (profileEmail || PROVIDER_REGISTRY.find(p => p.id === account.provider)?.name || t('accounts.priority.noEmail'))
        : (account.baseUrl ?? (PROVIDER_REGISTRY.find(p => p.id === account.provider)?.name ?? account.provider));

      return {
        id: account.id,
        name: account.name,
        type: account.authType === 'oauth' ? 'oauth' : 'api',
        displayName: account.name,
        identifier,
        provider: account.provider,
        profileEmail,
        isActive: priorityOrder.length > 0 ? priorityOrder[0] === account.id : false,
        isNext: false,
        isAvailable: true,
        hasUnlimitedUsage: account.authType === 'api-key',
        sessionPercent: usageData?.sessionPercent,
        weeklyPercent: usageData?.weeklyPercent,
        isRateLimited: usageData?.isRateLimited,
        rateLimitType: usageData?.rateLimitType,
        needsReauthentication: usageData?.needsReauthentication,
      } satisfies UnifiedAccount;
    }).sort((a, b) => {
      if (priorityOrder.length === 0) return 0;
      const aPos = priorityOrder.indexOf(a.id);
      const bPos = priorityOrder.indexOf(b.id);
      return (aPos === -1 ? Infinity : aPos) - (bPos === -1 ? Infinity : bPos);
    });
  }, [getProviderAccounts, profileUsageData, priorityOrder]);

  const unifiedAccounts = buildUnifiedAccounts();

  const loadPriorityOrder = async () => {
    try {
      const result = await window.electronAPI.getAccountPriorityOrder();
      if (result.success && result.data) {
        setPriorityOrder(result.data);
      }
    } catch {
      // Non-fatal
    }
  };

  const handlePriorityReorder = async (newOrder: string[]) => {
    setPriorityOrder(newOrder);
    setIsSavingPriority(true);
    try {
      await window.electronAPI.setAccountPriorityOrder(newOrder);
    } catch {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.settingsUpdateFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsSavingPriority(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAutoSwitchSettings();
      loadPriorityOrder();
      loadProfileUsageData(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loadProfileUsageData]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAllProfilesUsageUpdated?.((allProfilesUsage) => {
      const usageMap = new Map<string, ProfileUsageSummary>();
      allProfilesUsage.allProfiles.forEach(profile => {
        usageMap.set(profile.profileId, profile);
      });
      setProfileUsageData(usageMap);
    });
    return () => { unsubscribe?.(); };
  }, []);

  const loadAutoSwitchSettings = async () => {
    setIsLoadingAutoSwitch(true);
    try {
      const result = await window.electronAPI.getAutoSwitchSettings();
      if (result.success && result.data) {
        setAutoSwitchSettings(result.data);
      }
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  const handleUpdateAutoSwitch = async (updates: Partial<ClaudeAutoSwitchSettings>) => {
    setIsLoadingAutoSwitch(true);
    try {
      const result = await window.electronAPI.updateAutoSwitchSettings(updates);
      if (result.success) {
        await loadAutoSwitchSettings();
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.settingsUpdateFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.settingsUpdateFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  const totalAccounts = unifiedAccounts.length;

  return (
    <SettingsSection
      title={t('accounts.title')}
      description={t('accounts.description')}
    >
      <div className="space-y-6">
        {/* Provider accounts list - replaces the former tabs */}
        <ProviderAccountsList />

        {/* Auto-Switch Settings Section */}
        {totalAccounts > 1 && (
          <div className="space-y-4 pt-6 border-t border-border">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold text-foreground">{t('accounts.autoSwitching.title')}</h4>
            </div>

            <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('accounts.autoSwitching.description')}
              </p>

              {/* Master toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">{t('accounts.autoSwitching.enableAutoSwitching')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('accounts.autoSwitching.masterSwitch')}
                  </p>
                </div>
                <Switch
                  checked={autoSwitchSettings?.enabled ?? false}
                  onCheckedChange={(enabled) => handleUpdateAutoSwitch({ enabled })}
                  disabled={isLoadingAutoSwitch}
                />
              </div>

              {autoSwitchSettings?.enabled && (
                <>
                  {/* Proactive Monitoring */}
                  <div className="pl-6 space-y-4 pt-2 border-l-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5" />
                          {t('accounts.autoSwitching.proactiveMonitoring')}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('accounts.autoSwitching.proactiveDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={autoSwitchSettings?.proactiveSwapEnabled ?? true}
                        onCheckedChange={(value) => handleUpdateAutoSwitch({ proactiveSwapEnabled: value })}
                        disabled={isLoadingAutoSwitch}
                      />
                    </div>

                    {autoSwitchSettings?.proactiveSwapEnabled && (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="session-threshold" className="text-sm flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              {t('accounts.autoSwitching.sessionThreshold')}
                            </Label>
                            <span className="text-sm font-mono">{autoSwitchSettings?.sessionThreshold ?? 95}%</span>
                          </div>
                          <input
                            id="session-threshold"
                            type="range"
                            min="0"
                            max="99"
                            step="1"
                            value={autoSwitchSettings?.sessionThreshold ?? 95}
                            onChange={(e) => handleUpdateAutoSwitch({ sessionThreshold: parseInt(e.target.value, 10) })}
                            disabled={isLoadingAutoSwitch}
                            className="w-full"
                            aria-describedby="session-threshold-description"
                          />
                          <p id="session-threshold-description" className="text-xs text-muted-foreground">
                            {t('accounts.autoSwitching.sessionThresholdDescription')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="weekly-threshold" className="text-sm flex items-center gap-1.5">
                              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                              {t('accounts.autoSwitching.weeklyThreshold')}
                            </Label>
                            <span className="text-sm font-mono">{autoSwitchSettings?.weeklyThreshold ?? 99}%</span>
                          </div>
                          <input
                            id="weekly-threshold"
                            type="range"
                            min="0"
                            max="99"
                            step="1"
                            value={autoSwitchSettings?.weeklyThreshold ?? 99}
                            onChange={(e) => handleUpdateAutoSwitch({ weeklyThreshold: parseInt(e.target.value, 10) })}
                            disabled={isLoadingAutoSwitch}
                            className="w-full"
                            aria-describedby="weekly-threshold-description"
                          />
                          <p id="weekly-threshold-description" className="text-xs text-muted-foreground">
                            {t('accounts.autoSwitching.weeklyThresholdDescription')}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Reactive Recovery */}
                  <div className="pl-6 space-y-4 pt-2 border-l-2 border-orange-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {t('accounts.autoSwitching.reactiveRecovery')}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('accounts.autoSwitching.reactiveDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={autoSwitchSettings?.autoSwitchOnRateLimit ?? false}
                        onCheckedChange={(value) => handleUpdateAutoSwitch({ autoSwitchOnRateLimit: value })}
                        disabled={isLoadingAutoSwitch}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">
                          {t('accounts.autoSwitching.autoSwitchOnAuthFailure')}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('accounts.autoSwitching.autoSwitchOnAuthFailureDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={autoSwitchSettings?.autoSwitchOnAuthFailure ?? false}
                        onCheckedChange={(value) => handleUpdateAutoSwitch({ autoSwitchOnAuthFailure: value })}
                        disabled={isLoadingAutoSwitch}
                      />
                    </div>
                  </div>

                  {/* Account Priority Order */}
                  <div className="pt-4 border-t border-border/50">
                    <AccountPriorityList
                      accounts={unifiedAccounts}
                      onReorder={handlePriorityReorder}
                      isLoading={isSavingPriority}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
