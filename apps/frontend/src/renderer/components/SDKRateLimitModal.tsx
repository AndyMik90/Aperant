import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ExternalLink, Clock, RefreshCw, User, ChevronDown, Check, Star, Zap, FileText, ListTodo, Map, Lightbulb, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useRateLimitStore } from '../stores/rate-limit-store';
import { useClaudeProfileStore, loadClaudeProfiles } from '../stores/claude-profile-store';
import { useToast } from '../hooks/use-toast';
import { debugError } from '../../shared/utils/debug-logger';
import type { SDKRateLimitInfo } from '../../shared/types';

const CLAUDE_UPGRADE_URL = 'https://claude.ai/upgrade';

/**
 * Get a human-readable name for the source
 */
function getSourceName(source: SDKRateLimitInfo['source']): string {
  switch (source) {
    case 'changelog': return 'Changelog Generation';
    case 'task': return 'Task Execution';
    case 'roadmap': return 'Roadmap Generation';
    case 'ideation': return 'Ideation';
    case 'title-generator': return 'Title Generation';
    default: return 'Claude Operation';
  }
}

/**
 * Get an icon for the source
 */
function getSourceIcon(source: SDKRateLimitInfo['source']) {
  switch (source) {
    case 'changelog': return FileText;
    case 'task': return ListTodo;
    case 'roadmap': return Map;
    case 'ideation': return Lightbulb;
    default: return AlertCircle;
  }
}

export function SDKRateLimitModal() {
  const { isSDKModalOpen, sdkRateLimitInfo, hideSDKRateLimitModal, clearPendingRateLimit } = useRateLimitStore();
  const { profiles, isSwitching, setSwitching } = useClaudeProfileStore();
  const { toast } = useToast();
  const { t } = useTranslation('common');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [swapInfo, setSwapInfo] = useState<{
    wasAutoSwapped: boolean;
    swapReason?: 'proactive' | 'reactive';
    swappedFrom?: string;
    swappedTo?: string;
  } | null>(null);

  // Load profiles and auto-switch settings when modal opens
  useEffect(() => {
    if (isSDKModalOpen) {
      loadClaudeProfiles();
      loadAutoSwitchSettings();

      // Pre-select the suggested profile if available
      if (sdkRateLimitInfo?.suggestedProfile?.id) {
        setSelectedProfileId(sdkRateLimitInfo.suggestedProfile.id);
      }

      // Set swap info if auto-swap occurred
      if (sdkRateLimitInfo) {
        setSwapInfo({
          wasAutoSwapped: sdkRateLimitInfo.wasAutoSwapped ?? false,
          swapReason: sdkRateLimitInfo.swapReason,
          swappedFrom: profiles.find(p => p.id === sdkRateLimitInfo.profileId)?.name,
          swappedTo: sdkRateLimitInfo.swappedToProfile?.name
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSDKModalOpen, sdkRateLimitInfo, profiles]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isSDKModalOpen) {
      setSelectedProfileId(null);
      setIsRetrying(false);
      setIsAddingProfile(false);
      setNewProfileName('');
    }
  }, [isSDKModalOpen]);

  const loadAutoSwitchSettings = async () => {
    try {
      const result = await window.electronAPI.getAutoSwitchSettings();
      if (result.success && result.data) {
        setAutoSwitchEnabled(result.data.autoSwitchOnRateLimit);
      }
    } catch (err) {
      debugError('[SDKRateLimitModal] Failed to load auto-switch settings:', err);
    }
  };

  const handleAutoSwitchToggle = async (enabled: boolean) => {
    setIsLoadingSettings(true);
    try {
      await window.electronAPI.updateAutoSwitchSettings({
        enabled: enabled,
        autoSwitchOnRateLimit: enabled
      });
      setAutoSwitchEnabled(enabled);
    } catch (err) {
      debugError('[SDKRateLimitModal] Failed to update auto-switch settings:', err);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const handleUpgrade = () => {
    window.open(CLAUDE_UPGRADE_URL, '_blank');
  };

  const handleAddProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsAddingProfile(true);
    try {
      // Create a new profile - the backend will set the proper configDir
      const profileName = newProfileName.trim();
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');

      const result = await window.electronAPI.saveClaudeProfile({
        id: `profile-${Date.now()}`,
        name: profileName,
        // Use a placeholder - the backend will resolve the actual path
        configDir: `~/.claude-profiles/${profileSlug}`,
        isDefault: false,
        createdAt: new Date()
      });

      if (result.success && result.data) {
        // Reload profiles
        loadClaudeProfiles();
        setNewProfileName('');
        // Close the modal
        hideSDKRateLimitModal();

        // Direct user to Settings to complete authentication
        alert(
          `${t('profileCreated.title', { profileName })}\n\n` +
          `${t('profileCreated.instructions')}\n` +
          `1. ${t('profileCreated.step1')}\n` +
          `2. ${t('profileCreated.step2')}\n` +
          `3. ${t('profileCreated.step3')}\n\n` +
          `${t('profileCreated.footer')}`
        );
      }
    } catch (err) {
      debugError('[SDKRateLimitModal] Failed to add profile:', err);
      toast({
        variant: 'destructive',
        title: t('rateLimit.toast.addProfileFailed'),
        description: t('rateLimit.toast.tryAgain'),
      });
    } finally {
      setIsAddingProfile(false);
    }
  };

  const handleRetryWithProfile = async () => {
    if (!selectedProfileId || !sdkRateLimitInfo?.projectId) return;

    setIsRetrying(true);
    setSwitching(true);

    try {
      // First, set the active profile
      await window.electronAPI.setActiveClaudeProfile(selectedProfileId);

      // Then retry the operation
      const result = await window.electronAPI.retryWithProfile({
        source: sdkRateLimitInfo.source,
        projectId: sdkRateLimitInfo.projectId,
        taskId: sdkRateLimitInfo.taskId,
        profileId: selectedProfileId
      });

      if (result.success) {
        // Clear the pending rate limit since we successfully switched
        clearPendingRateLimit();
      }
    } catch (err) {
      debugError('[SDKRateLimitModal] Failed to retry with profile:', err);
    } finally {
      setIsRetrying(false);
      setSwitching(false);
    }
  };

  if (!sdkRateLimitInfo) return null;

  // Get profiles that are not the current rate-limited one
  const currentProfileId = sdkRateLimitInfo.profileId;
  const availableProfiles = profiles.filter(p => p.id !== currentProfileId);
  const hasMultipleProfiles = profiles.length > 1;

  const selectedProfile = selectedProfileId
    ? profiles.find(p => p.id === selectedProfileId)
    : null;

  const currentProfile = profiles.find(p => p.id === currentProfileId);
  const suggestedProfile = sdkRateLimitInfo.suggestedProfile
    ? profiles.find(p => p.id === sdkRateLimitInfo.suggestedProfile?.id)
    : null;

  const SourceIcon = getSourceIcon(sdkRateLimitInfo.source);
  const sourceName = getSourceName(sdkRateLimitInfo.source);

  return (
    <Dialog open={isSDKModalOpen} onOpenChange={(open) => !open && hideSDKRateLimitModal()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertCircle className="h-5 w-5" />
            {t('rateLimit.sdk.title')}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <SourceIcon className="h-4 w-4" />
            {t('rateLimit.sdk.interrupted', { source: sourceName })}
            {currentProfile && (
              <span className="text-muted-foreground"> (Profile: {currentProfile.name})</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Swap notification info */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            {swapInfo?.wasAutoSwapped ? (
              <>
                <p className="font-medium mb-1">
                  {swapInfo.swapReason === 'proactive' ? t('rateLimit.sdk.proactiveSwap') : t('rateLimit.sdk.reactiveSwap')}
                </p>
                <p>
                  {swapInfo.swapReason === 'proactive'
                    ? t('rateLimit.sdk.proactiveSwapDesc', { from: swapInfo.swappedFrom, to: swapInfo.swappedTo })
                    : t('rateLimit.sdk.reactiveSwapDesc', { from: swapInfo.swappedFrom, to: swapInfo.swappedTo })
                  }
                </p>
                <p className="mt-2 text-[10px]">
                  {t('rateLimit.sdk.continueWithoutInterruption')}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium mb-1">{t('rateLimit.sdk.rateLimitReached')}</p>
                <p>
                  {t('rateLimit.sdk.operationStopped', { account: currentProfile?.name || 'your account' })}
                  {hasMultipleProfiles
                    ? ' ' + t('rateLimit.sdk.switchBelow')
                    : ' ' + t('rateLimit.sdk.addAccountToContinue')}
                </p>
              </>
            )}
          </div>

          {/* Upgrade button */}
          <Button
            variant="default"
            size="sm"
            className="gap-2 w-full"
            onClick={() => window.open(CLAUDE_UPGRADE_URL, '_blank')}
          >
            <Zap className="h-4 w-4" />
            {t('rateLimit.sdk.upgradeToProButton')}
          </Button>

          {/* Reset time info */}
          {sdkRateLimitInfo.resetTime && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4">
              <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('rateLimit.sdk.resetsLabel', { time: sdkRateLimitInfo.resetTime })}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sdkRateLimitInfo.limitType === 'weekly'
                    ? t('rateLimit.sdk.weeklyLimit')
                    : t('rateLimit.sdk.sessionLimit')}
                </p>
              </div>
            </div>
          )}

          {/* Profile switching / Add account section */}
          <div className="rounded-lg border border-accent/50 bg-accent/10 p-4">
            <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <User className="h-4 w-4" />
              {hasMultipleProfiles ? t('rateLimit.sdk.switchAccountRetry') : t('rateLimit.useAnotherAccount')}
            </h4>

            {hasMultipleProfiles ? (
              <>
                <p className="text-sm text-muted-foreground mb-3">
                  {suggestedProfile ? (
                    <>Recommended: <strong>{suggestedProfile.name}</strong> has more capacity available.</>
                  ) : (
                    'Switch to another Claude account and retry the operation:'
                  )}
                </p>

                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="flex-1 justify-between">
                        <span className="truncate flex items-center gap-2">
                          {selectedProfile?.name || 'Select account...'}
                          {selectedProfileId === sdkRateLimitInfo.suggestedProfile?.id && (
                            <Star className="h-3 w-3 text-yellow-500" />
                          )}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[220px] bg-popover border border-border shadow-lg">
                      {availableProfiles.map((profile) => (
                        <DropdownMenuItem
                          key={profile.id}
                          onClick={() => setSelectedProfileId(profile.id)}
                          className="flex items-center justify-between"
                        >
                          <span className="truncate flex items-center gap-2">
                            {profile.name}
                            {profile.id === sdkRateLimitInfo.suggestedProfile?.id && (
                              <Star className="h-3 w-3 text-yellow-500" aria-label="Recommended" />
                            )}
                          </span>
                          {selectedProfileId === profile.id && (
                            <Check className="h-4 w-4 shrink-0" />
                          )}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          // Focus the add account input
                          const input = document.querySelector('input[placeholder*="Account name"]') as HTMLInputElement;
                          if (input) input.focus();
                        }}
                        className="flex items-center gap-2 text-muted-foreground"
                      >
                        <Plus className="h-4 w-4" />
                        Add new account...
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRetryWithProfile}
                    disabled={!selectedProfileId || isRetrying || isSwitching}
                    className="gap-2 shrink-0"
                  >
                    {isRetrying || isSwitching ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        {t('rateLimit.sdk.retrying')}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        {t('rateLimit.sdk.retry')}
                      </>
                    )}
                  </Button>
                </div>

                {selectedProfile?.description && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {selectedProfile.description}
                  </p>
                )}

                {/* Auto-switch toggle */}
                {availableProfiles.length > 0 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
                    <Label htmlFor="sdk-auto-switch" className="text-xs text-muted-foreground cursor-pointer">
                      {t('rateLimit.sdk.autoSwitchRetryLabel')}
                    </Label>
                    <Switch
                      id="sdk-auto-switch"
                      checked={autoSwitchEnabled}
                      onCheckedChange={handleAutoSwitchToggle}
                      disabled={isLoadingSettings}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">
                Add another Claude subscription to automatically switch when you hit rate limits.
              </p>
            )}

            {/* Add new account section */}
            <div className={hasMultipleProfiles ? "mt-4 pt-3 border-t border-border/50" : ""}>
              <p className="text-xs text-muted-foreground mb-2">
                {hasMultipleProfiles ? 'Add another account:' : 'Connect a Claude account:'}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Account name (e.g., Work, Personal)"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      handleAddProfile();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || isAddingProfile}
                  className="gap-1 shrink-0"
                >
                  {isAddingProfile ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {t('rateLimit.sdk.add')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This will open Claude login to authenticate the new account.
              </p>
            </div>
          </div>

          {/* Upgrade prompt */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h4 className="text-sm font-medium text-foreground mb-2">
              Upgrade for more usage
            </h4>
            <p className="text-sm text-muted-foreground mb-3">
              Upgrade your Claude subscription for higher usage limits.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleUpgrade}
            >
              <ExternalLink className="h-4 w-4" />
              Upgrade Subscription
            </Button>
          </div>

          {/* Info about what was interrupted */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            <p className="font-medium mb-1">{t('rateLimit.sdk.whatHappened')}</p>
            <p>
              {t('rateLimit.sdk.whatHappenedDesc', { source: sourceName.toLowerCase(), account: currentProfile?.name || 'Default' })}
              {hasMultipleProfiles
                ? ' ' + t('rateLimit.sdk.switchRetryOrAdd')
                : ' ' + t('rateLimit.sdk.addOrWait')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={hideSDKRateLimitModal}>
            {t('rateLimit.sdk.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
