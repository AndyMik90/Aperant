/**
 * AccountSettings - Unified account management for Claude Code and Custom Endpoints
 *
 * Consolidates the former "Integrations" and "API Profiles" settings into a single
 * tabbed interface with shared automatic account switching controls.
 *
 * Structure:
 * - Tabs: "Claude Code" (OAuth accounts) | "Custom Endpoints" (API profiles)
 * - Persistent: Automatic Account Switching section (below tabs)
 */
import { useState, useEffect, useCallback } from 'react';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SettingsSection } from './SettingsSection';
import { AuthTerminal } from './AuthTerminal';
import { ProfileEditDialog } from './ProfileEditDialog';
import { AccountPriorityList, type UnifiedAccount } from './AccountPriorityList';
import { maskApiKey } from '../../lib/profile-utils';
import { loadClaudeProfiles as loadGlobalClaudeProfiles } from '../../stores/claude-profile-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import type { AppSettings, ClaudeProfile, ClaudeAutoSwitchSettings, ProfileUsageSummary } from '../../../shared/types';
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
 * Unified account settings with tabs for Claude Code and Custom Endpoints
 */
export function AccountSettings({ settings, onSettingsChange, isOpen }: AccountSettingsProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState<'claude-code' | 'custom-endpoints'>('claude-code');

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

  // Build unified accounts list from both OAuth and API profiles
  const buildUnifiedAccounts = useCallback((): UnifiedAccount[] => {
    const unifiedList: UnifiedAccount[] = [];

    // Add OAuth profiles with usage data
    claudeProfiles.forEach((profile) => {
      const usageData = profileUsageData.get(profile.id);
      unifiedList.push({
        id: `oauth-${profile.id}`,
        name: profile.name,
        type: 'oauth',
        displayName: profile.name,
        identifier: profile.email || t('accounts.priority.noEmail'),
        isActive: profile.id === activeClaudeProfileId && !activeApiProfileId,
        isNext: false, // Will be computed by AccountPriorityList
        isAvailable: profile.isAuthenticated ?? false,
        hasUnlimitedUsage: false,
        // Use real usage data from the usage monitor
        sessionPercent: usageData?.sessionPercent,
        weeklyPercent: usageData?.weeklyPercent,
        isRateLimited: usageData?.isRateLimited,
        rateLimitType: usageData?.rateLimitType,
        isAuthenticated: profile.isAuthenticated,
        needsReauthentication: usageData?.needsReauthentication,
      });
    });

    // Add API profiles
    apiProfiles.forEach((profile) => {
      unifiedList.push({
        id: `api-${profile.id}`,
        name: profile.name,
        type: 'api',
        displayName: profile.name,
        identifier: profile.baseUrl,
        isActive: profile.id === activeApiProfileId,
        isNext: false, // Will be computed by AccountPriorityList
        isAvailable: true, // API profiles are always considered available
        hasUnlimitedUsage: true, // API profiles have no rate limits
        sessionPercent: undefined,
        weeklyPercent: undefined,
      });
    });

    // Sort by priority order if available
    if (priorityOrder.length > 0) {
      unifiedList.sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.id);
        const bIndex = priorityOrder.indexOf(b.id);
        // Items not in priority order go to the end
        const aPos = aIndex === -1 ? Infinity : aIndex;
        const bPos = bIndex === -1 ? Infinity : bIndex;
        return aPos - bPos;
      });
    }

    return unifiedList;
  }, [claudeProfiles, apiProfiles, activeClaudeProfileId, activeApiProfileId, priorityOrder, profileUsageData, t]);

  const unifiedAccounts = buildUnifiedAccounts();

  // Load priority order from settings
  const loadPriorityOrder = async () => {
    try {
      const result = await window.electronAPI.getAccountPriorityOrder();
      if (result.success && result.data) {
        setPriorityOrder(result.data);
      }
    } catch (err) {
      console.warn('[AccountSettings] Failed to load priority order:', err);
    }
  };

  // Save priority order
  const handlePriorityReorder = async (newOrder: string[]) => {
    setPriorityOrder(newOrder);
    setIsSavingPriority(true);
    try {
      await window.electronAPI.setAccountPriorityOrder(newOrder);
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
      loadPriorityOrder();
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
        // Remove from priority order
        const unifiedId = `oauth-${profileId}`;
        if (priorityOrder.includes(unifiedId)) {
          const newOrder = priorityOrder.filter(id => id !== unifiedId);
          await handlePriorityReorder(newOrder);
        }
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
      // Remove from priority order
      const unifiedId = `api-${deleteConfirmProfile.id}`;
      if (priorityOrder.includes(unifiedId)) {
        const newOrder = priorityOrder.filter(id => id !== unifiedId);
        await handlePriorityReorder(newOrder);
      }
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
      } else {
        const activeProfile = apiProfiles.find(p => p.id === profileId);
        if (activeProfile) {
          toast({
            title: t('apiProfiles.toast.switch.profileTitle'),
            description: t('apiProfiles.toast.switch.profileDescription', { name: activeProfile.name }),
          });
        }
      }
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
  const totalAccounts = claudeProfiles.length + apiProfiles.length;

  return (
    <SettingsSection
      title={t('accounts.title')}
      description={t('accounts.description')}
    >
      <div className="space-y-6">
        {/* Tabs for Claude Code vs Custom Endpoints */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'claude-code' | 'custom-endpoints')}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="claude-code" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t('accounts.tabs.claudeCode')}
            </TabsTrigger>
            <TabsTrigger value="custom-endpoints" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              {t('accounts.tabs.customEndpoints')}
            </TabsTrigger>
          </TabsList>

          {/* Claude Code Tab Content */}
          <TabsContent value="claude-code">
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

                    return (
                    <div
                      key={profile.id}
                      className={cn(
                        "rounded-lg border transition-colors",
                        needsReauth
                          ? "border-destructive/50 bg-destructive/5"
                          : profile.id === activeClaudeProfileId && !activeApiProfileId
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
                            profile.id === activeClaudeProfileId && !activeApiProfileId
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
                                  {profile.id === activeClaudeProfileId && !activeApiProfileId && (
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
                            {(profile.id !== activeClaudeProfileId || activeApiProfileId) && (
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
          </TabsContent>

          {/* Custom Endpoints Tab Content */}
          <TabsContent value="custom-endpoints">
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
                  {activeApiProfileId && (
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
                    const isActive = activeApiProfileId === profile.id;
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
          </TabsContent>
        </Tabs>

        {/* Auto-Switch Settings Section - Persistent below tabs */}
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
