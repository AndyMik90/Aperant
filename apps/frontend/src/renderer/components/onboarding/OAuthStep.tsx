import { useState, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Eye,
  EyeOff,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Star,
  Check,
  Pencil,
  X,
  LogIn,
  ChevronDown,
  ChevronRight,
  Users,
  Lock
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import { AuthTerminal } from '../settings/AuthTerminal';
import { loadClaudeProfiles as loadGlobalClaudeProfiles } from '../../stores/claude-profile-store';
import { useToast } from '../../hooks/use-toast';
import type { ClaudeProfile } from '../../../shared/types';

interface OAuthStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * OAuth step component for the onboarding wizard.
 * Guides users through Claude profile management and OAuth authentication,
 * reusing patterns from IntegrationSettings.tsx.
 */
export function OAuthStep({ onNext, onBack, onSkip }: OAuthStepProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const { toast } = useToast();

  // Claude Profiles state
  const [claudeProfiles, setClaudeProfiles] = useState<ClaudeProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [newProfileName, setNewProfileName] = useState('');
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [authenticatingProfileId, setAuthenticatingProfileId] = useState<string | null>(null);

  // Manual token entry state
  const [expandedTokenProfileId, setExpandedTokenProfileId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [manualTokenEmail, setManualTokenEmail] = useState('');
  const [showManualToken, setShowManualToken] = useState(false);
  const [savingTokenProfileId, setSavingTokenProfileId] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Auth terminal state - for embedded authentication
  const [authTerminal, setAuthTerminal] = useState<{
    terminalId: string;
    configDir: string;
    profileId: string;
    profileName: string;
  } | null>(null);

  // Derived state: check if at least one profile is authenticated
  const hasAuthenticatedProfile = claudeProfiles.some(
    (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
  );

  // Reusable function to load Claude profiles
  const loadClaudeProfiles = async () => {
    setIsLoadingProfiles(true);
    setError(null);
    try {
      const result = await window.electronAPI.getClaudeProfiles();
      if (result.success && result.data) {
        setClaudeProfiles(result.data.profiles);
        setActiveProfileId(result.data.activeProfileId);
        // Also update the global store
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setIsLoadingProfiles(false);
    }
  };

  // Load Claude profiles on mount
  useEffect(() => {
    loadClaudeProfiles();
  }, [loadClaudeProfiles]);

  // Profile management handlers - following patterns from IntegrationSettings.tsx
  const handleAddProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsAddingProfile(true);
    setError(null);
    try {
      const profileName = newProfileName.trim();
      // Sanitize slug: only allow alphanumeric and dashes, remove leading/trailing dashes
      const profileSlug = profileName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Validate that sanitized slug is not empty (e.g., "!!!" becomes "")
      if (!profileSlug) {
        setError('Profile name must contain at least one letter or number');
        setIsAddingProfile(false);
        return;
      }

      const result = await window.electronAPI.saveClaudeProfile({
        id: `profile-${Date.now()}`,
        name: profileName,
        configDir: `~/.claude-profiles/${profileSlug}`,
        isDefault: false,
        createdAt: new Date()
      });

      if (result.success && result.data) {
        await loadClaudeProfiles();
        const savedProfileName = newProfileName.trim();
        setNewProfileName('');

        // Get terminal config for authentication
        const authResult = await window.electronAPI.authenticateClaudeProfile(result.data.id);

        if (authResult.success && authResult.data) {
          setAuthenticatingProfileId(result.data.id);

          // Set up embedded auth terminal
          setAuthTerminal({
            terminalId: authResult.data.terminalId,
            configDir: authResult.data.configDir,
            profileId: result.data.id,
            profileName: savedProfileName,
          });

          console.warn('[OAuthStep] New profile auth terminal ready:', authResult.data);
        } else {
          alert(t('oauth.alerts.profileCreatedAuthFailed', { error: authResult.error || t('oauth.toast.tryAgain') }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add profile');
      toast({
        variant: 'destructive',
        title: t('oauth.toast.addProfileFailed'),
        description: t('oauth.toast.tryAgain'),
      });
    } finally {
      setIsAddingProfile(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    setDeletingProfileId(profileId);
    setError(null);
    try {
      const result = await window.electronAPI.deleteClaudeProfile(profileId);
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
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

    setError(null);
    try {
      const result = await window.electronAPI.renameClaudeProfile(editingProfileId, editingProfileName.trim());
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename profile');
    } finally {
      setEditingProfileId(null);
      setEditingProfileName('');
    }
  };

  const handleSetActiveProfile = async (profileId: string) => {
    setError(null);
    try {
      const result = await window.electronAPI.setActiveClaudeProfile(profileId);
      if (result.success) {
        setActiveProfileId(profileId);
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set active profile');
    }
  };

  // Handle auth terminal close
  const handleAuthTerminalClose = useCallback(() => {
    setAuthTerminal(null);
    setAuthenticatingProfileId(null);
  }, []);

  // Handle auth terminal success
  const handleAuthTerminalSuccess = useCallback(async (email?: string) => {
    console.warn('[OAuthStep] Auth success:', email);

    // Close terminal immediately
    setAuthTerminal(null);
    setAuthenticatingProfileId(null);

    // Reload profiles to get updated auth state
    await loadClaudeProfiles();
  }, [loadClaudeProfiles]);

  // Handle auth terminal error
  const handleAuthTerminalError = useCallback((error: string) => {
    console.error('[OAuthStep] Auth error:', error);
    // Don't auto-close on error - let user see the error and close manually
  }, []);

  const handleAuthenticateProfile = async (profileId: string) => {
    // Find the profile name for display
    const profile = claudeProfiles.find(p => p.id === profileId);
    const profileName = profile?.name || 'Profile';

    setAuthenticatingProfileId(profileId);
    setError(null);
    try {
      // Get terminal config from backend (terminalId and configDir)
      const result = await window.electronAPI.authenticateClaudeProfile(profileId);

      if (!result.success || !result.data) {
        alert(t('oauth.alerts.authPrepareFailed', { error: result.error || t('oauth.toast.tryAgain') }));
        setAuthenticatingProfileId(null);
        return;
      }

      // Set up embedded auth terminal
      setAuthTerminal({
        terminalId: result.data.terminalId,
        configDir: result.data.configDir,
        profileId,
        profileName,
      });

      console.warn('[OAuthStep] Auth terminal ready:', result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate profile');
      alert(t('oauth.alerts.authStartFailedMessage'));
      setAuthenticatingProfileId(null);
    }
  };

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
    setError(null);
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
          title: t('oauth.toast.tokenSaved'),
          description: t('oauth.toast.tokenSavedDescription'),
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('oauth.toast.tokenSaveFailed'),
          description: result.error || t('oauth.toast.tryAgain'),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token');
      toast({
        variant: 'destructive',
        title: t('oauth.toast.tokenSaveFailed'),
        description: t('oauth.toast.tryAgain'),
      });
    } finally {
      setSavingTokenProfileId(null);
    }
  };

  const handleContinue = () => {
    onNext();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('oauth.configureTitle')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('oauth.addAccountsDesc')}
          </p>
        </div>

        {/* Loading state */}
        {isLoadingProfiles && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Profile management UI - placeholder for subtask-1-4 */}
        {!isLoadingProfiles && (
          <div className="space-y-6">
            {/* Error banner */}
            {error && (
              <Card className="border border-destructive/30 bg-destructive/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Info card */}
            <Card className="border border-info/30 bg-info/10">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">
                      {t('oauth.multiAccountInfo')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Keychain explanation - macOS only */}
            {navigator.platform.toLowerCase().includes('mac') && (
              <Card className="border border-border bg-muted/30">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground mb-1">
                        {t('oauth.keychainTitle')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t('oauth.keychainDescription')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Profile list */}
            <div className="rounded-lg bg-muted/30 border border-border p-4">
              {claudeProfiles.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center mb-4">
                  <p className="text-sm text-muted-foreground">{t('oauth.noAccountsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {claudeProfiles.map((profile) => (
                    <div
                      key={profile.id}
                      className={cn(
                        "rounded-lg border transition-colors",
                        profile.id === activeProfileId
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
                            profile.id === activeProfileId
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
                                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{t('oauth.badges.default')}</span>
                                  )}
                                  {profile.id === activeProfileId && (
                                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Star className="h-3 w-3" />
                                      {t('oauth.badges.active')}
                                    </span>
                                  )}
                                  {(profile.oauthToken || (profile.isDefault && profile.configDir)) ? (
                                    <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded flex items-center gap-1">
                                      <Check className="h-3 w-3" />
                                      {t('oauth.badges.authenticated')}
                                    </span>
                                  ) : (
                                    <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                      {t('oauth.badges.needsAuth')}
                                    </span>
                                  )}
                                </div>
                                {profile.email && (
                                  <span className="text-xs text-muted-foreground">{profile.email}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {editingProfileId !== profile.id && (
                          <div className="flex items-center gap-1">
                            {/* Authenticate button - show if not authenticated */}
                            {!profile.oauthToken && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAuthenticateProfile(profile.id)}
                                disabled={authenticatingProfileId === profile.id}
                                className="gap-1 h-7 text-xs"
                              >
                                {authenticatingProfileId === profile.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <LogIn className="h-3 w-3" />
                                )}
                                {t('oauth.buttons.authenticate')}
                              </Button>
                            )}
                            {profile.id !== activeProfileId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetActiveProfile(profile.id)}
                                className="gap-1 h-7 text-xs"
                              >
                                <Check className="h-3 w-3" />
                                {t('oauth.buttons.setActive')}
                              </Button>
                            )}
                            {/* Toggle token entry button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleTokenEntry(profile.id)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={expandedTokenProfileId === profile.id ? t('common:accessibility.hideTokenEntryAriaLabel') : t('common:accessibility.enterTokenManuallyAriaLabel')}
                            >
                              {expandedTokenProfileId === profile.id ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditingProfile(profile)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={t('common:accessibility.renameProfileAriaLabel')}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {!profile.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteProfile(profile.id)}
                                disabled={deletingProfileId === profile.id}
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={t('common:accessibility.deleteProfileAriaLabel')}
                              >
                                {deletingProfileId === profile.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
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
                                {t('common:oauth.manualTokenEntry')}
                              </Label>
                              <span className="text-xs text-muted-foreground">
                                <Trans
                                  i18nKey="common:oauth.tokenCommandHint"
                                  components={{ code: <code className="font-mono bg-muted px-1 rounded" /> }}
                                />
                              </span>
                            </div>

                            <div className="space-y-2">
                              <div className="relative">
                                <Input
                                  type={showManualToken ? 'text' : 'password'}
                                  placeholder="sk-ant-oat01-..."
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
                                placeholder={t('common:oauth.emailOptionalPlaceholder')}
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
                                {t('common:buttons.cancel')}
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
                                {t('common:oauth.saveToken')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
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

              {/* Add new account input */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('common:oauth.accountNamePlaceholder')}
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
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || isAddingProfile}
                  size="sm"
                  className="gap-1 shrink-0"
                >
                  {isAddingProfile ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  {t('common:buttons.add')}
                </Button>
              </div>
            </div>

            {/* Success state when profiles are authenticated */}
            {hasAuthenticatedProfile && (
              <Card className="border border-success/30 bg-success/10">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    <p className="text-sm text-success">
                      {t('common:oauth.hasAuthenticatedAccount')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('oauth.buttons.back')}
          </Button>
          <div className="flex gap-4">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('oauth.buttons.skip')}
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!hasAuthenticatedProfile}
            >
              {t('oauth.buttons.continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
