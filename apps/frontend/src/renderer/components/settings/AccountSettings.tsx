/**
 * AccountSettings - Unified account management for Claude Code, OpenAI Codex, and Custom Endpoints.
 *
 * Provider sections share a single provider-account registry and automatic switching order.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  EyeOff,
  Users,
  Plus,
  Trash2,
  Star,
  Check,
  Pencil,
  X,
  Loader2,
  LogIn,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Activity,
  AlertCircle,
  Server,
  Globe,
  Clock,
  TrendingUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SettingsSection } from './SettingsSection';
import { AuthTerminal } from './AuthTerminal';
import { ProfileEditDialog } from './ProfileEditDialog';
import { AccountPriorityList } from './AccountPriorityList';
import { maskApiKey } from '../../lib/profile-utils';
import { hasUsageMonitoring } from '../../../shared/utils/provider-detection';
import { loadClaudeProfiles as loadGlobalClaudeProfiles } from '../../stores/claude-profile-store';
import { useSettingsStore, loadSettings as reloadSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import type { AppSettings, ClaudeProfile, ClaudeAutoSwitchSettings, CodexAuthState, ProfileUsageSummary, ProviderAccount } from '../../../shared/types';
import type { UnifiedAccount } from '../../../shared/types/unified-account';
import type { APIProfile } from '@shared/types/profile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog';

interface AccountSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  isOpen: boolean;
}

/**
 * Unified account settings with provider sections for Claude Code, OpenAI Codex, and Custom Endpoints.
 */
export function AccountSettings({ settings, onSettingsChange, isOpen }: AccountSettingsProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();

  // ============================================
  // Claude Code (OAuth) state
  // ============================================
  const [claudeProfiles, setClaudeProfiles] = useState<ClaudeProfile[]>([]);
  const [activeClaudeProfileId, setActiveClaudeProfileId] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [authenticatingProfileId, setAuthenticatingProfileId] = useState<string | null>(null);
  const [expandedTokenProfileId, setExpandedTokenProfileId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [manualTokenEmail, setManualTokenEmail] = useState('');
  const [showManualToken, setShowManualToken] = useState(false);
  const [savingTokenProfileId, setSavingTokenProfileId] = useState<string | null>(null);

  // Auth terminal state
  const [authTerminal, setAuthTerminal] = useState<{
    terminalId: string;
    configDir: string;
    profileId: string;
    profileName: string;
  } | null>(null);

  // ============================================
  // Shared provider-account state
  // ============================================
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([]);
  const [disabledAutoSwitchAccountIds, setDisabledAutoSwitchAccountIds] = useState<string[]>([]);
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(false);

  // ============================================
  // OpenAI Codex (OAuth) state
  // ============================================
  const [codexAuthStates, setCodexAuthStates] = useState<Record<string, CodexAuthState>>({});
  const [codexLoadingIds, setCodexLoadingIds] = useState<Record<string, boolean>>({});
  const [newOpenAIAccountName, setNewOpenAIAccountName] = useState('');
  const [isAddingOpenAIAccount, setIsAddingOpenAIAccount] = useState(false);
  const [editingOpenAIAccountId, setEditingOpenAIAccountId] = useState<string | null>(null);
  const [editingOpenAIAccountName, setEditingOpenAIAccountName] = useState('');
  const [deletingOpenAIAccountId, setDeletingOpenAIAccountId] = useState<string | null>(null);

  // ============================================
  // Custom Endpoints (API Profiles) state
  // ============================================
  const {
    profiles: apiProfiles,
    activeProfileId: activeApiProfileId,
    deleteProfile: deleteApiProfile,
    setActiveProfile: setActiveApiProfile,
    profilesError
  } = useSettingsStore();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editApiProfile, setEditApiProfile] = useState<APIProfile | null>(null);
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<APIProfile | null>(null);
  const [isDeletingApiProfile, setIsDeletingApiProfile] = useState(false);
  const [isSettingActiveApiProfile, setIsSettingActiveApiProfile] = useState(false);

  // ============================================
  // Auto-switch settings state (shared)
  // ============================================
  const [autoSwitchSettings, setAutoSwitchSettings] = useState<ClaudeAutoSwitchSettings | null>(null);
  const [isLoadingAutoSwitch, setIsLoadingAutoSwitch] = useState(false);

  // ============================================
  // Priority order state
  // ============================================
  const [priorityOrder, setPriorityOrder] = useState<string[]>([]);
  const [isSavingPriority, setIsSavingPriority] = useState(false);

  // ============================================
  // Usage data state (for priority list visualization)
  // ============================================
  const [profileUsageData, setProfileUsageData] = useState<Map<string, ProfileUsageSummary>>(new Map());

  // Fetch all profiles usage data
  // Force refresh to get fresh data when Settings opens (bypasses 1-minute cache)
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
    } catch (err) {
      console.warn('[AccountSettings] Failed to load profile usage data:', err);
    }
  }, []);

  const openAIAccounts = useMemo(
    () => providerAccounts.filter((account) => account.provider === 'openai'),
    [providerAccounts]
  );

  const loadCodexAuthStatuses = useCallback(async (accounts: ProviderAccount[]) => {
    const openAIProviderAccounts = accounts.filter((account) => account.provider === 'openai');
    if (openAIProviderAccounts.length === 0) {
      setCodexAuthStates({});
      return;
    }

    const results = await Promise.all(
      openAIProviderAccounts.map(async (account) => {
        try {
          const result = await window.electronAPI.codexAuthStatus(account.id);
          return [account.id, result.success && result.data ? result.data : { isAuthenticated: false }] as const;
        } catch {
          return [account.id, { isAuthenticated: false }] as const;
        }
      })
    );

    setCodexAuthStates(
      Object.fromEntries(results)
    );
  }, []);

  const loadProviderAccounts = useCallback(async () => {
    setIsLoadingProviderAccounts(true);
    try {
      const result = await window.electronAPI.getProviderAccounts();
      if (result.success && result.data) {
        setProviderAccounts(result.data.accounts);
        setPriorityOrder(result.data.globalPriorityOrder);
        setDisabledAutoSwitchAccountIds(result.data.disabledAutoSwitchAccountIds);
        onSettingsChange({
          ...settings,
          providerAccounts: result.data.accounts,
          globalPriorityOrder: result.data.globalPriorityOrder,
          disabledAutoSwitchAccountIds: result.data.disabledAutoSwitchAccountIds,
          _migratedProviderAccounts: true,
        });
        await loadCodexAuthStatuses(result.data.accounts);
        await reloadSettingsStore();
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.loadProfilesFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to load provider accounts:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.loadProfilesFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsLoadingProviderAccounts(false);
    }
  }, [loadCodexAuthStatuses, onSettingsChange, settings, t, toast]);

  const activeProviderAccountId = useMemo(() => {
    if (autoSwitchSettings?.defaultProviderId && providerAccounts.some((account) => account.id === autoSwitchSettings.defaultProviderId)) {
      return autoSwitchSettings.defaultProviderId;
    }

    const activeApiAccount = providerAccounts.find(
      (account) => account.provider === 'openai-compatible' && account.apiProfileId === activeApiProfileId
    );
    if (activeApiAccount) {
      return activeApiAccount.id;
    }

    const activeClaudeAccount = providerAccounts.find(
      (account) => account.provider === 'anthropic' && account.claudeProfileId === activeClaudeProfileId
    );
    return activeClaudeAccount?.id ?? null;
  }, [activeApiProfileId, activeClaudeProfileId, autoSwitchSettings?.defaultProviderId, providerAccounts]);

  const hasActiveCustomEndpoint = useMemo(
    () => providerAccounts.some((account) => account.provider === 'openai-compatible' && account.id === activeProviderAccountId),
    [activeProviderAccountId, providerAccounts]
  );

  const unifiedAccountMap = useMemo(() => {
    const accounts = new Map<string, UnifiedAccount>();

    for (const account of providerAccounts) {
      if (account.provider === 'anthropic' && account.claudeProfileId) {
        const profile = claudeProfiles.find((candidate) => candidate.id === account.claudeProfileId);
        if (!profile) {
          continue;
        }
        const usageData = profileUsageData.get(profile.id);
        accounts.set(account.id, {
          id: account.id,
          name: account.name,
          type: 'oauth',
          displayName: account.name,
          identifier: profile.email || t('accounts.priority.noEmail'),
          isActive: account.id === activeProviderAccountId,
          isNext: false,
          isAvailable: profile.isAuthenticated ?? false,
          hasUnlimitedUsage: false,
          sessionPercent: usageData?.sessionPercent,
          weeklyPercent: usageData?.weeklyPercent,
          isRateLimited: usageData?.isRateLimited,
          rateLimitType: usageData?.rateLimitType,
          isAuthenticated: profile.isAuthenticated,
          needsReauthentication: usageData?.needsReauthentication,
        });
        continue;
      }

      if (account.provider === 'openai-compatible' && account.apiProfileId) {
        const profile = apiProfiles.find((candidate) => candidate.id === account.apiProfileId);
        if (!profile) {
          continue;
        }
        const monitored = hasUsageMonitoring(profile.baseUrl);
        const usageData = monitored ? profileUsageData.get(profile.id) : undefined;
        accounts.set(account.id, {
          id: account.id,
          name: account.name,
          type: 'api',
          displayName: account.name,
          identifier: profile.baseUrl,
          isActive: account.id === activeProviderAccountId,
          isNext: false,
          isAvailable: true,
          hasUnlimitedUsage: !monitored,
          sessionPercent: usageData?.sessionPercent,
          weeklyPercent: usageData?.weeklyPercent,
          isAuthenticated: true,
        });
        continue;
      }

      if (account.provider === 'openai') {
        const authState = codexAuthStates[account.id];
        const usageData = profileUsageData.get(account.id);
        accounts.set(account.id, {
          id: account.id,
          name: account.name,
          type: 'oauth',
          displayName: account.name,
          identifier: authState?.email || account.email || t('accounts.priority.noEmail'),
          isActive: account.id === activeProviderAccountId,
          isNext: false,
          isAvailable: authState?.isAuthenticated ?? false,
          hasUnlimitedUsage: false,
          sessionPercent: usageData?.sessionPercent,
          weeklyPercent: usageData?.weeklyPercent,
          isRateLimited: usageData?.isRateLimited,
          rateLimitType: usageData?.rateLimitType,
          isAuthenticated: authState?.isAuthenticated ?? false,
          needsReauthentication: usageData?.needsReauthentication ?? !authState?.isAuthenticated,
        });
      }
    }

    return accounts;
  }, [activeProviderAccountId, apiProfiles, claudeProfiles, codexAuthStates, profileUsageData, providerAccounts, t]);

  const unifiedPriorityAccounts = useMemo(
    () => priorityOrder
      .map((accountId) => unifiedAccountMap.get(accountId))
      .filter((account): account is UnifiedAccount => !!account),
    [priorityOrder, unifiedAccountMap]
  );

  const unifiedDisabledAccounts = useMemo(
    () => disabledAutoSwitchAccountIds
      .map((accountId) => unifiedAccountMap.get(accountId))
      .filter((account): account is UnifiedAccount => !!account),
    [disabledAutoSwitchAccountIds, unifiedAccountMap]
  );

  const unifiedAccounts = useMemo(
    () => [...unifiedPriorityAccounts, ...unifiedDisabledAccounts],
    [unifiedDisabledAccounts, unifiedPriorityAccounts]
  );

  const handlePriorityReorder = async (newOrder: string[], disabledIds: string[]) => {
    setPriorityOrder(newOrder);
    setDisabledAutoSwitchAccountIds(disabledIds);
    setIsSavingPriority(true);
    try {
      const result = await window.electronAPI.setProviderAccountOrder(newOrder, disabledIds);
      if (result.success && result.data) {
        setPriorityOrder(result.data.globalPriorityOrder);
        setDisabledAutoSwitchAccountIds(result.data.disabledAutoSwitchAccountIds);
        await reloadSettingsStore();
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.settingsUpdateFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to save priority order:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.settingsUpdateFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsSavingPriority(false);
    }
  };

  // Load data when section is opened
  useEffect(() => {
    if (isOpen) {
      loadClaudeProfiles();
      loadAutoSwitchSettings();
      // Force refresh usage data when Settings opens to get fresh data
      // This bypasses the 1-minute cache to ensure accurate duplicate detection
      loadProfileUsageData(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loadProfileUsageData]);

  // Subscribe to usage updates for real-time data
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAllProfilesUsageUpdated?.((allProfilesUsage) => {
      const usageMap = new Map<string, ProfileUsageSummary>();
      allProfilesUsage.allProfiles.forEach(profile => {
        usageMap.set(profile.profileId, profile);
      });
      setProfileUsageData(usageMap);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // ============================================
  // Claude Code (OAuth) handlers
  // ============================================
  const loadClaudeProfiles = async () => {
    setIsLoadingProfiles(true);
    try {
      const result = await window.electronAPI.getClaudeProfiles();
      if (result.success && result.data) {
        setClaudeProfiles(result.data.profiles);
        setActiveClaudeProfileId(result.data.activeProfileId);
        await loadGlobalClaudeProfiles();
        await loadProviderAccounts();
      } else if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.loadProfilesFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to load Claude profiles:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.loadProfilesFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsLoadingProfiles(false);
    }
  };

  const handleAddClaudeProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsAddingProfile(true);
    try {
      const profileName = newProfileName.trim();
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');

      const result = await window.electronAPI.saveClaudeProfile({
        id: `profile-${Date.now()}`,
        name: profileName,
        configDir: `~/.claude-profiles/${profileSlug}`,
        isDefault: false,
        createdAt: new Date()
      });

      if (result.success && result.data) {
        await loadClaudeProfiles();
        setNewProfileName('');

        const authResult = await window.electronAPI.authenticateClaudeProfile(result.data.id);
        if (authResult.success && authResult.data) {
          setAuthenticatingProfileId(result.data.id);
          setAuthTerminal({
            terminalId: authResult.data.terminalId,
            configDir: authResult.data.configDir,
            profileId: result.data.id,
            profileName,
          });
        } else {
          toast({
            variant: 'destructive',
            title: t('accounts.toast.authFailed'),
            description: authResult.error || t('accounts.toast.tryAgain'),
          });
        }
      }
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.addProfileFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsAddingProfile(false);
    }
  };

  const handleDeleteClaudeProfile = async (profileId: string) => {
    setDeletingProfileId(profileId);
    try {
      const result = await window.electronAPI.deleteClaudeProfile(profileId);
      if (result.success) {
        await loadClaudeProfiles();
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.deleteProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.deleteProfileFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setDeletingProfileId(null);
    }
  };

  const startEditingProfile = (profile: ClaudeProfile) => {
    setEditingProfileId(profile.id);
    setEditingProfileName(profile.name);
  };

  const cancelEditingProfile = () => {
    setEditingProfileId(null);
    setEditingProfileName('');
  };

  const handleRenameProfile = async () => {
    if (!editingProfileId || !editingProfileName.trim()) return;

    try {
      const result = await window.electronAPI.renameClaudeProfile(editingProfileId, editingProfileName.trim());
      if (result.success) {
        await loadClaudeProfiles();
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.renameProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.renameProfileFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setEditingProfileId(null);
      setEditingProfileName('');
    }
  };

  const handleSetActiveClaudeProfile = async (profileId: string) => {
    try {
      // If an API profile is currently active, clear it first
      // so the OAuth profile becomes the active account
      if (activeApiProfileId) {
        await setActiveApiProfile(null);
      }

      const result = await window.electronAPI.setActiveClaudeProfile(profileId);
      if (result.success) {
        setActiveClaudeProfileId(profileId);
        await loadGlobalClaudeProfiles();
        const providerAccount = providerAccounts.find(
          (account) => account.provider === 'anthropic' && account.claudeProfileId === profileId
        );
        if (providerAccount) {
          await moveProviderAccountToFront(providerAccount.id);
        }
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.setActiveProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.setActiveProfileFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    }
  };

  const handleAuthenticateProfile = async (profileId: string) => {
    const profile = claudeProfiles.find(p => p.id === profileId);
    const profileName = profile?.name || 'Profile';

    setAuthenticatingProfileId(profileId);
    try {
      const result = await window.electronAPI.authenticateClaudeProfile(profileId);
      if (!result.success || !result.data) {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.authFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
        setAuthenticatingProfileId(null);
        return;
      }

      setAuthTerminal({
        terminalId: result.data.terminalId,
        configDir: result.data.configDir,
        profileId,
        profileName,
      });
    } catch (err) {
      console.error('Failed to authenticate profile:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.authFailed'),
        description: t('accounts.toast.tryAgain'),
      });
      setAuthenticatingProfileId(null);
    }
  };

  const handleAuthTerminalClose = useCallback(() => {
    setAuthTerminal(null);
    setAuthenticatingProfileId(null);
  }, []);

  const handleAuthTerminalSuccess = useCallback(async () => {
    setAuthTerminal(null);
    setAuthenticatingProfileId(null);
    await loadClaudeProfiles();
  }, [loadClaudeProfiles]);

  const handleAuthTerminalError = useCallback(() => {
    // Don't auto-close on error
  }, []);

  const toggleTokenEntry = (profileId: string) => {
    if (expandedTokenProfileId === profileId) {
      setExpandedTokenProfileId(null);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    } else {
      setExpandedTokenProfileId(profileId);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    }
  };

  const handleSaveManualToken = async (profileId: string) => {
    if (!manualToken.trim()) return;

    setSavingTokenProfileId(profileId);
    try {
      const result = await window.electronAPI.setClaudeProfileToken(
        profileId,
        manualToken.trim(),
        manualTokenEmail.trim() || undefined
      );
      if (result.success) {
        await loadClaudeProfiles();
        setExpandedTokenProfileId(null);
        setManualToken('');
        setManualTokenEmail('');
        setShowManualToken(false);
        toast({
          title: t('accounts.toast.tokenSaved'),
          description: t('accounts.toast.tokenSavedDescription'),
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.tokenSaveFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.tokenSaveFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setSavingTokenProfileId(null);
    }
  };

  async function moveProviderAccountToFront(accountId: string): Promise<boolean> {
    const nextOrder = [accountId, ...priorityOrder.filter((id) => id !== accountId)];
    const nextDisabledIds = disabledAutoSwitchAccountIds.filter((id) => id !== accountId);

    setPriorityOrder(nextOrder);
    setDisabledAutoSwitchAccountIds(nextDisabledIds);

    const result = await window.electronAPI.setProviderAccountOrder(nextOrder, nextDisabledIds);
    if (!result.success || !result.data) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.settingsUpdateFailed'),
        description: result.error || t('accounts.toast.tryAgain'),
      });
      await loadProviderAccounts();
      return false;
    }

    setPriorityOrder(result.data.globalPriorityOrder);
    setDisabledAutoSwitchAccountIds(result.data.disabledAutoSwitchAccountIds);
    await handleUpdateAutoSwitch({ defaultProviderId: accountId });
    await reloadSettingsStore();
    await loadProfileUsageData(true);
    return true;
  }

  // ============================================
  // OpenAI Codex (OAuth) handlers
  // ============================================
  const startEditingOpenAIAccount = (account: ProviderAccount) => {
    setEditingOpenAIAccountId(account.id);
    setEditingOpenAIAccountName(account.name);
  };

  const cancelEditingOpenAIAccount = () => {
    setEditingOpenAIAccountId(null);
    setEditingOpenAIAccountName('');
  };

  const handleSaveOpenAIAccountName = async () => {
    if (!editingOpenAIAccountId || !editingOpenAIAccountName.trim()) {
      return;
    }

    try {
      const result = await window.electronAPI.updateProviderAccount(editingOpenAIAccountId, {
        name: editingOpenAIAccountName.trim(),
      });
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.renameProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
      await loadProviderAccounts();
      await reloadSettingsStore();
    } finally {
      cancelEditingOpenAIAccount();
    }
  };

  const handleAddOpenAIAccount = async () => {
    if (!newOpenAIAccountName.trim()) {
      return;
    }

    setIsAddingOpenAIAccount(true);
    try {
      const result = await window.electronAPI.saveProviderAccount({
        provider: 'openai',
        name: newOpenAIAccountName.trim(),
        authType: 'oauth',
        billingModel: 'subscription',
      });
      if (result.success && result.data) {
        setNewOpenAIAccountName('');
        await loadProviderAccounts();
        await reloadSettingsStore();
        await handleCodexLogin(result.data.id);
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.addProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to add OpenAI account:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.addProfileFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsAddingOpenAIAccount(false);
    }
  };

  const handleCodexLogin = async (accountId: string) => {
    setCodexLoadingIds((current) => ({ ...current, [accountId]: true }));
    try {
      const result = await window.electronAPI.codexAuthLogin(accountId);
      if (result.success) {
        setCodexAuthStates((current) => ({
          ...current,
          [accountId]: result.data ?? { isAuthenticated: false },
        }));
        await loadProviderAccounts();
        await reloadSettingsStore();
        await loadProfileUsageData(true);
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.codexLoginFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to authenticate Codex:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.codexLoginFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setCodexLoadingIds((current) => ({ ...current, [accountId]: false }));
    }
  };

  const handleCodexLogout = async (accountId: string) => {
    setCodexLoadingIds((current) => ({ ...current, [accountId]: true }));
    try {
      const result = await window.electronAPI.codexAuthLogout(accountId);
      if (result.success) {
        setCodexAuthStates((current) => ({
          ...current,
          [accountId]: { isAuthenticated: false },
        }));
      } else {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.codexLogoutFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to clear Codex auth:', err);
      toast({
        variant: 'destructive',
        title: t('accounts.toast.codexLogoutFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setCodexLoadingIds((current) => ({ ...current, [accountId]: false }));
      await loadProviderAccounts();
      await loadProfileUsageData(true);
    }
  };

  const handleDeleteOpenAIAccount = async (accountId: string) => {
    setDeletingOpenAIAccountId(accountId);
    try {
      await window.electronAPI.codexAuthLogout(accountId).catch(() => undefined);
      const result = await window.electronAPI.deleteProviderAccount(accountId);
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('accounts.toast.deleteProfileFailed'),
          description: result.error || t('accounts.toast.tryAgain'),
        });
        return;
      }

      const nextDefaultProviderId = autoSwitchSettings?.defaultProviderId === accountId
        ? priorityOrder.find((id) => id !== accountId)
        : autoSwitchSettings?.defaultProviderId;

      if (autoSwitchSettings?.defaultProviderId === accountId) {
        await handleUpdateAutoSwitch({ defaultProviderId: nextDefaultProviderId });
      }

      await loadProviderAccounts();
      await reloadSettingsStore();
    } finally {
      setDeletingOpenAIAccountId(null);
    }
  };

  // ============================================
  // Custom Endpoints (API Profiles) handlers
  // ============================================
  const handleDeleteApiProfile = async () => {
    if (!deleteConfirmProfile) return;

    setIsDeletingApiProfile(true);
    const success = await deleteApiProfile(deleteConfirmProfile.id);
    setIsDeletingApiProfile(false);

    if (success) {
      toast({
        title: t('apiProfiles.toast.delete.title'),
        description: t('apiProfiles.toast.delete.description', { name: deleteConfirmProfile.name }),
      });
      await loadProviderAccounts();
      setDeleteConfirmProfile(null);
    } else {
      toast({
        variant: 'destructive',
        title: t('apiProfiles.toast.delete.errorTitle'),
        description: profilesError || t('apiProfiles.toast.delete.errorFallback'),
      });
    }
  };

  const handleSetActiveApiProfileClick = async (profileId: string | null) => {
    if (profileId !== null && profileId === activeApiProfileId) return;

    setIsSettingActiveApiProfile(true);
    const success = await setActiveApiProfile(profileId);
    setIsSettingActiveApiProfile(false);

    if (success) {
      if (profileId === null) {
        toast({
          title: t('apiProfiles.toast.switch.oauthTitle'),
          description: t('apiProfiles.toast.switch.oauthDescription'),
        });

        const activeClaudeAccount = providerAccounts.find(
          (account) => account.provider === 'anthropic' && account.claudeProfileId === activeClaudeProfileId
        );
        const fallbackClaudeAccount = activeClaudeAccount
          ?? priorityOrder
            .map((accountId) => providerAccounts.find((account) => account.id === accountId))
            .find((account): account is ProviderAccount => !!account && account.provider === 'anthropic')
          ?? providerAccounts.find((account) => account.provider === 'anthropic');

        if (fallbackClaudeAccount) {
          await moveProviderAccountToFront(fallbackClaudeAccount.id);
        } else {
          await handleUpdateAutoSwitch({ defaultProviderId: undefined });
        }
      } else {
        const activeProfile = apiProfiles.find(p => p.id === profileId);
        if (activeProfile) {
          toast({
            title: t('apiProfiles.toast.switch.profileTitle'),
            description: t('apiProfiles.toast.switch.profileDescription', { name: activeProfile.name }),
          });
        }
      }
      if (profileId !== null) {
        const providerAccount = providerAccounts.find(
          (account) => account.provider === 'openai-compatible' && account.apiProfileId === profileId
        );
        if (providerAccount) {
          await moveProviderAccountToFront(providerAccount.id);
        }
      }
      await loadProviderAccounts();
    } else {
      toast({
        variant: 'destructive',
        title: t('apiProfiles.toast.switch.errorTitle'),
        description: profilesError || t('apiProfiles.toast.switch.errorFallback'),
      });
    }
  };

  const getHostFromUrl = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(timestamp);
    } catch {
      return new Date(timestamp).toLocaleString();
    }
  };

  // ============================================
  // Auto-switch settings handlers (shared)
  // ============================================
  const loadAutoSwitchSettings = async () => {
    setIsLoadingAutoSwitch(true);
    try {
      const result = await window.electronAPI.getAutoSwitchSettings();
      if (result.success && result.data) {
        setAutoSwitchSettings(result.data);
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to load auto-switch settings:', err);
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  const handleUpdateAutoSwitch = async (updates: Partial<ClaudeAutoSwitchSettings>) => {
    setAutoSwitchSettings((current) => current ? { ...current, ...updates } : current);
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
    } catch (_err) {
      toast({
        variant: 'destructive',
        title: t('accounts.toast.settingsUpdateFailed'),
        description: t('accounts.toast.tryAgain'),
      });
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  // Calculate total accounts for auto-switch visibility
  const totalAccounts = providerAccounts.length;

  return (
    <SettingsSection
      title={t('accounts.title')}
      description={t('accounts.description')}
    >
      <div className="space-y-6">
        {isLoadingProviderAccounts && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('accounts.priority.loading', 'Loading account providers...')}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('accounts.tabs.claudeCode')}</h4>
          </div>
            <div className="rounded-lg bg-muted/30 border border-border p-4">
              <p className="text-sm text-muted-foreground mb-4">
                {t('accounts.claudeCode.description')}
              </p>

              {/* Accounts list */}
              {isLoadingProfiles ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : claudeProfiles.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center mb-4">
                  <p className="text-sm text-muted-foreground">{t('accounts.claudeCode.noAccountsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {claudeProfiles.map((profile) => {
                    // Get usage data to check needsReauthentication flag
                    const usageData = profileUsageData.get(profile.id);
                    const needsReauth = usageData?.needsReauthentication ?? false;
                    const providerAccount = providerAccounts.find(
                      (account) => account.provider === 'anthropic' && account.claudeProfileId === profile.id
                    );
                    const isActiveProvider = providerAccount?.id === activeProviderAccountId;

                    return (
                    <div
                      key={profile.id}
                      className={cn(
                        "rounded-lg border transition-colors",
                        needsReauth
                          ? "border-destructive/50 bg-destructive/5"
                          : isActiveProvider
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background"
                      )}
                    >
                      <div className={cn(
                        "flex items-center justify-between p-3",
                        expandedTokenProfileId !== profile.id && "hover:bg-muted/50"
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                            isActiveProvider
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {(editingProfileId === profile.id ? editingProfileName : profile.name).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            {editingProfileId === profile.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={editingProfileName}
                                  onChange={(e) => setEditingProfileName(e.target.value)}
                                  className="h-7 text-sm w-40"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameProfile();
                                    if (e.key === 'Escape') cancelEditingProfile();
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleRenameProfile}
                                  className="h-7 w-7 text-success hover:text-success hover:bg-success/10"
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={cancelEditingProfile}
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-foreground">{profile.name}</span>
                                  {profile.isDefault && (
                                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{t('accounts.claudeCode.default')}</span>
                                  )}
                                  {isActiveProvider && (
                                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Star className="h-3 w-3" />
                                      {t('accounts.claudeCode.active')}
                                    </span>
                                  )}
                                  {needsReauth ? (
                                    <span className="text-xs bg-destructive/20 text-destructive px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <AlertCircle className="h-3 w-3" />
                                      {t('accounts.priority.needsReauth')}
                                    </span>
                                  ) : profile.isAuthenticated ? (
                                    <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Check className="h-3 w-3" />
                                      {t('accounts.claudeCode.authenticated')}
                                    </span>
                                  ) : (
                                    <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                      {t('accounts.claudeCode.needsAuth')}
                                    </span>
                                  )}
                                </div>
                                {profile.email && (
                                  <span className="text-xs text-muted-foreground">{profile.email}</span>
                                )}
                                {/* Usage bars - show if we have usage data */}
                                {usageData && profile.isAuthenticated && !needsReauth && (
                                  <div className="flex items-center gap-3 mt-1.5">
                                    {/* Session usage */}
                                    <div className="flex items-center gap-1.5">
                                      <Clock className="h-3 w-3 text-muted-foreground" />
                                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${
                                            (usageData.sessionPercent ?? 0) >= 95 ? 'bg-red-500' :
                                            (usageData.sessionPercent ?? 0) >= 91 ? 'bg-orange-500' :
                                            (usageData.sessionPercent ?? 0) >= 71 ? 'bg-yellow-500' :
                                            'bg-green-500'
                                          }`}
                                          style={{ width: `${Math.min(usageData.sessionPercent ?? 0, 100)}%` }}
                                        />
                                      </div>
                                      <span className={`text-[10px] tabular-nums w-7 ${
                                        (usageData.sessionPercent ?? 0) >= 95 ? 'text-red-500' :
                                        (usageData.sessionPercent ?? 0) >= 91 ? 'text-orange-500' :
                                        (usageData.sessionPercent ?? 0) >= 71 ? 'text-yellow-500' :
                                        'text-muted-foreground'
                                      }`}>
                                        {Math.round(usageData.sessionPercent ?? 0)}%
                                      </span>
                                    </div>
                                    {/* Weekly usage */}
                                    <div className="flex items-center gap-1.5">
                                      <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${
                                            (usageData.weeklyPercent ?? 0) >= 95 ? 'bg-red-500' :
                                            (usageData.weeklyPercent ?? 0) >= 91 ? 'bg-orange-500' :
                                            (usageData.weeklyPercent ?? 0) >= 71 ? 'bg-yellow-500' :
                                            'bg-green-500'
                                          }`}
                                          style={{ width: `${Math.min(usageData.weeklyPercent ?? 0, 100)}%` }}
                                        />
                                      </div>
                                      <span className={`text-[10px] tabular-nums w-7 ${
                                        (usageData.weeklyPercent ?? 0) >= 95 ? 'text-red-500' :
                                        (usageData.weeklyPercent ?? 0) >= 91 ? 'text-orange-500' :
                                        (usageData.weeklyPercent ?? 0) >= 71 ? 'text-yellow-500' :
                                        'text-muted-foreground'
                                      }`}>
                                        {Math.round(usageData.weeklyPercent ?? 0)}%
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {editingProfileId !== profile.id && (
                          <div className="flex items-center gap-1">
                            {!profile.isAuthenticated ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAuthenticateProfile(profile.id)}
                                disabled={authenticatingProfileId === profile.id}
                                className="gap-1 h-7 text-xs"
                              >
                                {authenticatingProfileId === profile.id ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    {t('accounts.claudeCode.authenticating')}
                                  </>
                                ) : (
                                  <>
                                    <LogIn className="h-3 w-3" />
                                    {t('accounts.claudeCode.authenticate')}
                                  </>
                                )}
                              </Button>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleAuthenticateProfile(profile.id)}
                                    disabled={authenticatingProfileId === profile.id}
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  >
                                    {authenticatingProfileId === profile.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{tCommon('accessibility.reAuthenticateProfileAriaLabel')}</TooltipContent>
                              </Tooltip>
                            )}
                            {!isActiveProvider && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetActiveClaudeProfile(profile.id)}
                                className="gap-1 h-7 text-xs"
                              >
                                <Check className="h-3 w-3" />
                                {t('accounts.claudeCode.setActive')}
                              </Button>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => toggleTokenEntry(profile.id)}
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                >
                                  {expandedTokenProfileId === profile.id ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {expandedTokenProfileId === profile.id
                                  ? tCommon('accessibility.hideTokenEntryAriaLabel')
                                  : tCommon('accessibility.enterTokenManuallyAriaLabel')}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => startEditingProfile(profile)}
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{tCommon('accessibility.renameProfileAriaLabel')}</TooltipContent>
                            </Tooltip>
                            {!profile.isDefault && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteClaudeProfile(profile.id)}
                                    disabled={deletingProfileId === profile.id}
                                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  >
                                    {deletingProfileId === profile.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{tCommon('accessibility.deleteProfileAriaLabel')}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Expanded token entry section */}
                      {expandedTokenProfileId === profile.id && (
                        <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-0">
                          <div className="bg-muted/30 rounded-lg p-3 mt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium text-muted-foreground">
                                {t('accounts.claudeCode.manualTokenEntry')}
                              </Label>
                              <span className="text-xs text-muted-foreground">
                                {t('accounts.claudeCode.runSetupToken')}
                              </span>
                            </div>

                            <div className="space-y-2">
                              <div className="relative">
                                <Input
                                  type={showManualToken ? 'text' : 'password'}
                                  placeholder={t('accounts.claudeCode.tokenPlaceholder')}
                                  value={manualToken}
                                  onChange={(e) => setManualToken(e.target.value)}
                                  className="pr-10 font-mono text-xs h-8"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowManualToken(!showManualToken)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {showManualToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                              </div>

                              <Input
                                type="email"
                                placeholder={t('accounts.claudeCode.emailPlaceholder')}
                                value={manualTokenEmail}
                                onChange={(e) => setManualTokenEmail(e.target.value)}
                                className="text-xs h-8"
                              />
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleTokenEntry(profile.id)}
                                className="h-7 text-xs"
                              >
                                {tCommon('buttons.cancel')}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSaveManualToken(profile.id)}
                                disabled={!manualToken.trim() || savingTokenProfileId === profile.id}
                                className="h-7 text-xs gap-1"
                              >
                                {savingTokenProfileId === profile.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )}
                                {t('accounts.claudeCode.saveToken')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}

              {/* Embedded Auth Terminal */}
              {authTerminal && (
                <div className="mb-4">
                  <div className="rounded-lg border border-primary/30 overflow-hidden" style={{ height: '320px' }}>
                    <AuthTerminal
                      terminalId={authTerminal.terminalId}
                      configDir={authTerminal.configDir}
                      profileName={authTerminal.profileName}
                      onClose={handleAuthTerminalClose}
                      onAuthSuccess={handleAuthTerminalSuccess}
                      onAuthError={handleAuthTerminalError}
                    />
                  </div>
                </div>
              )}

              {/* Add new account */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('accounts.claudeCode.accountNamePlaceholder')}
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  disabled={!!authTerminal}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      handleAddClaudeProfile();
                    }
                  }}
                />
                <Button
                  onClick={handleAddClaudeProfile}
                  disabled={!newProfileName.trim() || isAddingProfile || !!authTerminal}
                  size="sm"
                  className="gap-1 shrink-0"
                >
                  {isAddingProfile ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {tCommon('buttons.add')}
                </Button>
              </div>
            </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('accounts.tabs.openaiCodex')}</h4>
          </div>
            <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('accounts.openaiCodex.description')}
                </p>
                <div className="rounded-lg border border-border/70 bg-background p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      {t('accounts.openaiCodex.runtimeNote')}
                    </p>
                  </div>
                </div>
              </div>

              {openAIAccounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t('accounts.openaiCodex.noAccount')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {openAIAccounts.map((account) => {
                    const authState = codexAuthStates[account.id];
                    const usageData = profileUsageData.get(account.id);
                    const isBusy = codexLoadingIds[account.id] || false;
                    const isActiveProvider = activeProviderAccountId === account.id;
                    const isEditing = editingOpenAIAccountId === account.id;

                    return (
                      <div
                        key={account.id}
                        className={cn(
                          'rounded-lg border transition-colors',
                          isActiveProvider ? 'border-primary bg-primary/5' : 'border-border bg-background'
                        )}
                      >
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                              isActiveProvider ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            )}>
                              {(isEditing ? editingOpenAIAccountName : account.name).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              {isEditing ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={editingOpenAIAccountName}
                                    onChange={(e) => setEditingOpenAIAccountName(e.target.value)}
                                    className="h-7 text-sm w-40"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveOpenAIAccountName();
                                      if (e.key === 'Escape') cancelEditingOpenAIAccount();
                                    }}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleSaveOpenAIAccountName}
                                    className="h-7 w-7 text-success hover:text-success hover:bg-success/10"
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={cancelEditingOpenAIAccount}
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-foreground">{account.name}</span>
                                    {isActiveProvider && (
                                      <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
                                        <Star className="h-3 w-3" />
                                        {t('accounts.claudeCode.active')}
                                      </span>
                                    )}
                                    {authState?.isAuthenticated ? (
                                      <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded flex items-center gap-1">
                                        <Check className="h-3 w-3" />
                                        {t('accounts.openaiCodex.connected')}
                                      </span>
                                    ) : (
                                      <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                        {t('accounts.openaiCodex.notConnected')}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {authState?.email || account.email || t('accounts.openaiCodex.noAccount')}
                                  </span>
                                  {authState?.expiresAt && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {t('accounts.openaiCodex.expiresAt', { date: formatTimestamp(authState.expiresAt) })}
                                    </p>
                                  )}
                                  {usageData && authState?.isAuthenticated && !usageData.needsReauthentication && (
                                    <div className="flex items-center gap-3 mt-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${
                                              (usageData.sessionPercent ?? 0) >= 95 ? 'bg-red-500' :
                                              (usageData.sessionPercent ?? 0) >= 91 ? 'bg-orange-500' :
                                              (usageData.sessionPercent ?? 0) >= 71 ? 'bg-yellow-500' :
                                              'bg-green-500'
                                            }`}
                                            style={{ width: `${Math.min(usageData.sessionPercent ?? 0, 100)}%` }}
                                          />
                                        </div>
                                        <span className={`text-[10px] tabular-nums w-7 ${
                                          (usageData.sessionPercent ?? 0) >= 95 ? 'text-red-500' :
                                          (usageData.sessionPercent ?? 0) >= 91 ? 'text-orange-500' :
                                          (usageData.sessionPercent ?? 0) >= 71 ? 'text-yellow-500' :
                                          'text-muted-foreground'
                                        }`}>
                                          {Math.round(usageData.sessionPercent ?? 0)}%
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${
                                              (usageData.weeklyPercent ?? 0) >= 95 ? 'bg-red-500' :
                                              (usageData.weeklyPercent ?? 0) >= 91 ? 'bg-orange-500' :
                                              (usageData.weeklyPercent ?? 0) >= 71 ? 'bg-yellow-500' :
                                              'bg-green-500'
                                            }`}
                                            style={{ width: `${Math.min(usageData.weeklyPercent ?? 0, 100)}%` }}
                                          />
                                        </div>
                                        <span className={`text-[10px] tabular-nums w-7 ${
                                          (usageData.weeklyPercent ?? 0) >= 95 ? 'text-red-500' :
                                          (usageData.weeklyPercent ?? 0) >= 91 ? 'text-orange-500' :
                                          (usageData.weeklyPercent ?? 0) >= 71 ? 'text-yellow-500' :
                                          'text-muted-foreground'
                                        }`}>
                                          {Math.round(usageData.weeklyPercent ?? 0)}%
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {!isEditing && (
                            <div className="flex items-center gap-1">
                              {!isActiveProvider && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => moveProviderAccountToFront(account.id)}
                                  className="gap-1 h-7 text-xs"
                                >
                                  <Check className="h-3 w-3" />
                                  {t('accounts.claudeCode.setActive')}
                                </Button>
                              )}
                              <Button
                                variant={authState?.isAuthenticated ? 'ghost' : 'outline'}
                                size={authState?.isAuthenticated ? 'icon' : 'sm'}
                                onClick={() => handleCodexLogin(account.id)}
                                disabled={isBusy}
                                className={cn(authState?.isAuthenticated ? 'h-7 w-7 text-muted-foreground hover:text-foreground' : 'gap-1 h-7 text-xs')}
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : authState?.isAuthenticated ? (
                                  <RefreshCw className="h-3 w-3" />
                                ) : (
                                  <>
                                    <LogIn className="h-3 w-3" />
                                    {!authState?.isAuthenticated && t('accounts.openaiCodex.authenticate')}
                                  </>
                                )}
                              </Button>
                              {authState?.isAuthenticated && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleCodexLogout(account.id)}
                                  disabled={isBusy}
                                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => startEditingOpenAIAccount(account)}
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteOpenAIAccount(account.id)}
                                disabled={deletingOpenAIAccountId === account.id}
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                {deletingOpenAIAccountId === account.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('accounts.claudeCode.accountNamePlaceholder')}
                  value={newOpenAIAccountName}
                  onChange={(e) => setNewOpenAIAccountName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newOpenAIAccountName.trim()) {
                      handleAddOpenAIAccount();
                    }
                  }}
                />
                <Button
                  onClick={handleAddOpenAIAccount}
                  disabled={!newOpenAIAccountName.trim() || isAddingOpenAIAccount}
                  size="sm"
                  className="gap-1 shrink-0"
                >
                  {isAddingOpenAIAccount ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {tCommon('buttons.add')}
                </Button>
              </div>
            </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('accounts.tabs.customEndpoints')}</h4>
          </div>
            <div className="space-y-4">
              {/* Header with Add button */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('accounts.customEndpoints.description')}
                </p>
                <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('accounts.customEndpoints.addButton')}
                </Button>
              </div>

              {/* Empty state */}
              {apiProfiles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg">
                  <Server className="h-12 w-12 text-muted-foreground mb-4" />
                  <h4 className="text-lg font-medium mb-2">{t('accounts.customEndpoints.empty.title')}</h4>
                  <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
                    {t('accounts.customEndpoints.empty.description')}
                  </p>
                  <Button onClick={() => setIsAddDialogOpen(true)} variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    {t('accounts.customEndpoints.empty.action')}
                  </Button>
                </div>
              )}

              {/* Profile list */}
              {apiProfiles.length > 0 && (
                <div className="space-y-2">
                  {hasActiveCustomEndpoint && (
                    <div className="flex items-center justify-end pb-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActiveApiProfileClick(null)}
                        disabled={isSettingActiveApiProfile}
                      >
                        {isSettingActiveApiProfile
                          ? t('accounts.customEndpoints.switchToOauth.loading')
                          : t('accounts.customEndpoints.switchToOauth.label')}
                      </Button>
                    </div>
                  )}
                  {apiProfiles.map((profile) => {
                    const providerAccount = providerAccounts.find(
                      (account) => account.provider === 'openai-compatible' && account.apiProfileId === profile.id
                    );
                    const isActive = providerAccount?.id === activeProviderAccountId;
                    return (
                      <div
                        key={profile.id}
                        className={cn(
                          'flex items-center justify-between p-4 rounded-lg border transition-colors',
                          isActive
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-accent/50'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium truncate">{profile.name}</h4>
                            {isActive && (
                              <span className="flex items-center text-xs text-primary">
                                <Check className="h-3 w-3 mr-1" />
                                {t('accounts.customEndpoints.activeBadge')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" />
                                  <span className="truncate max-w-[200px]">
                                    {getHostFromUrl(profile.baseUrl)}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{profile.baseUrl}</p>
                              </TooltipContent>
                            </Tooltip>
                            <div className="truncate">
                              {maskApiKey(profile.apiKey)}
                            </div>
                          </div>
                          {profile.models && Object.keys(profile.models).length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {t('accounts.customEndpoints.customModels', {
                                models: Object.keys(profile.models).join(', ')
                              })}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {!isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetActiveApiProfileClick(profile.id)}
                              disabled={isSettingActiveApiProfile}
                            >
                              {isSettingActiveApiProfile
                                ? t('accounts.customEndpoints.setActive.loading')
                                : t('accounts.customEndpoints.setActive.label')}
                            </Button>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditApiProfile(profile)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('accounts.customEndpoints.tooltips.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmProfile(profile)}
                                disabled={isActive}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isActive
                                ? t('accounts.customEndpoints.tooltips.deleteActive')
                                : t('accounts.customEndpoints.tooltips.deleteInactive')}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add/Edit Dialog */}
              <ProfileEditDialog
                open={isAddDialogOpen || editApiProfile !== null}
                onOpenChange={(open) => {
                  if (!open) {
                    setIsAddDialogOpen(false);
                    setEditApiProfile(null);
                  }
                }}
                onSaved={() => {
                  setIsAddDialogOpen(false);
                  setEditApiProfile(null);
                  void loadProviderAccounts();
                  void reloadSettingsStore();
                }}
                profile={editApiProfile ?? undefined}
              />

              {/* Delete Confirmation Dialog */}
              <AlertDialog
                open={deleteConfirmProfile !== null}
                onOpenChange={() => setDeleteConfirmProfile(null)}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('accounts.customEndpoints.dialog.deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('accounts.customEndpoints.dialog.deleteDescription', {
                        name: deleteConfirmProfile?.name ?? ''
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeletingApiProfile}>
                      {t('accounts.customEndpoints.dialog.cancel')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteApiProfile}
                      disabled={isDeletingApiProfile}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeletingApiProfile
                        ? t('accounts.customEndpoints.dialog.deleting')
                        : t('accounts.customEndpoints.dialog.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
        </div>

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
                  {/* Proactive Monitoring Section */}
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
                        {/* Session threshold */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="session-threshold" className="text-sm">{t('accounts.autoSwitching.sessionThreshold')}</Label>
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

                        {/* Weekly threshold */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="weekly-threshold" className="text-sm">{t('accounts.autoSwitching.weeklyThreshold')}</Label>
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

                  {/* Reactive Recovery Section */}
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

                    {/* Auto-switch on auth failure */}
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
                      activeAccounts={unifiedPriorityAccounts}
                      disabledAccounts={unifiedDisabledAccounts}
                      onReorder={handlePriorityReorder}
                      isLoading={isSavingPriority}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Provider Combinations Section — separate from Auto-Switch */}
        {totalAccounts > 1 && (
          <div className="space-y-4 pt-6 border-t border-border">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <h4 className="text-sm font-semibold text-foreground">{t('accounts.providerCombinations.title', 'Provider Combinations')}</h4>
            </div>

            <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">{t('accounts.providerCombinations.enable', 'Enable profile combinations')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('accounts.providerCombinations.description', 'When enabled, tasks can specify which provider to use independently')}
                  </p>
                </div>
                <Switch
                  checked={autoSwitchSettings?.profileCombinations ?? false}
                  onCheckedChange={(value) => handleUpdateAutoSwitch({ profileCombinations: value })}
                  disabled={isLoadingAutoSwitch}
                />
              </div>

              {/* Provider cards — only show when enabled */}
              {autoSwitchSettings?.profileCombinations && (
                <div className="space-y-3 pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground font-medium">
                    {t('accounts.providerCombinations.configuredProviders', 'Configured Providers')}
                  </p>

                  {unifiedAccounts.map((account) => {
                    const providerAccount = providerAccounts.find((candidate) => candidate.id === account.id);
                    return (
                    <div
                      key={account.id}
                      className={`rounded-md border p-3 space-y-1.5 ${
                        account.isActive
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{account.displayName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            account.type === 'oauth'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-amber-500/10 text-amber-500'
                          }`}>
                            {providerAccount?.provider === 'openai'
                              ? 'OpenAI Codex'
                              : providerAccount?.provider === 'openai-compatible'
                                ? 'Custom Endpoint'
                                : account.type === 'oauth'
                                  ? 'Claude Code'
                                  : 'API'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-medium ${
                          account.isActive ? 'text-green-500' : 'text-muted-foreground'
                        }`}>
                          {account.isActive ? t('accounts.providerCombinations.active', 'Active') : t('accounts.providerCombinations.available', 'Available')}
                        </span>
                      </div>

                      {/* Model names */}
                      <div className="text-xs text-muted-foreground">
                        {providerAccount?.provider === 'openai' ? (
                          'Models: default: GPT-5.3-Codex, sonnet: GPT-5.3-Codex, haiku: GPT-5.4-Mini, opus: GPT-5.4'
                        ) : account.type === 'api' ? (
                          (() => {
                            const apiProfile = apiProfiles.find(p => p.id === providerAccount?.apiProfileId);
                            const models = apiProfile?.models;
                            const modelList = [
                              models?.opus && `opus: ${models.opus}`,
                              models?.sonnet && `sonnet: ${models.sonnet}`,
                              models?.haiku && `haiku: ${models.haiku}`,
                              models?.default && `default: ${models.default}`,
                            ].filter(Boolean);
                            return modelList.length > 0
                              ? `Models: ${modelList.join(', ')}`
                              : 'Models: Using provider defaults';
                          })()
                        ) : (
                          'Models: Claude Opus 4.6, Sonnet 4.5, Haiku 4.5'
                        )}
                      </div>

                      {/* Usage bars */}
                      {!account.hasUnlimitedUsage && (
                        <div className="flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Session:</span>
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  (account.sessionPercent ?? 0) >= 90 ? 'bg-red-500' : (account.sessionPercent ?? 0) >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(account.sessionPercent ?? 0, 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums">{Math.round(account.sessionPercent ?? 0)}%</span>
                          </div>
                          {account.type === 'oauth' && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-muted-foreground">Weekly:</span>
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    (account.weeklyPercent ?? 0) >= 90 ? 'bg-red-500' : (account.weeklyPercent ?? 0) >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(account.weeklyPercent ?? 0, 100)}%` }}
                                />
                              </div>
                              <span className="tabular-nums">{Math.round(account.weeklyPercent ?? 0)}%</span>
                            </div>
                          )}
                        </div>
                      )}
                      {account.hasUnlimitedUsage && (
                        <div className="text-xs text-muted-foreground/70">Pay-per-use</div>
                      )}
                    </div>
                  );
                  })}

                  <p className="text-[11px] text-muted-foreground/70 pt-1">
                    {t('accounts.providerCombinations.hint', 'Select a provider per task in the Create Task dialog or via MCP tools.')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
