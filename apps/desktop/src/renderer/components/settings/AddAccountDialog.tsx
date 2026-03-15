import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertCircle, Terminal, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import type { BillingModel, BuiltinProvider, CustomModel, ProviderAccount } from '@shared/types/provider-account';

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
];

type OAuthStatus = 'idle' | 'authenticating' | 'waiting' | 'success' | 'error';

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: BuiltinProvider;
  authType: 'oauth' | 'api-key';
  /** Override billing model (e.g., Z.AI Coding Plan vs usage-based API key) */
  billingModel?: BillingModel;
  editAccount?: ProviderAccount;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  provider,
  authType,
  billingModel: billingModelOverride,
  editAccount,
}: AddAccountDialogProps) {
  const { t } = useTranslation('settings');
  const { addProviderAccount, updateProviderAccount } = useSettingsStore();
  const { toast } = useToast();

  const isEditing = !!editAccount;

  // Form state
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [isSaving, setIsSaving] = useState(false);

  // Custom models for openai-compatible endpoints
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [newModelId, setNewModelId] = useState('');
  const [newModelLabel, setNewModelLabel] = useState('');

  // OAuth subprocess state
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>('idle');
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [oauthProfileId, setOauthProfileId] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [showFallbackTerminal, setShowFallbackTerminal] = useState(false);

  // Tracks whether the account was auto-saved after OAuth success
  const [accountSaved, setAccountSaved] = useState(false);

  // AuthTerminal fallback state
  const [fallbackTerminalId, setFallbackTerminalId] = useState<string | null>(null);
  const [fallbackConfigDir, setFallbackConfigDir] = useState<string | null>(null);

  // Reset form when dialog opens/editAccount changes
  useEffect(() => {
    if (open) {
      if (editAccount) {
        setName(editAccount.name);
        setApiKey(editAccount.apiKey ?? '');
        setBaseUrl(editAccount.baseUrl ?? '');
        setRegion(editAccount.region ?? 'us-east-1');
        setCustomModels(editAccount.customModels ?? []);
      } else {
        setName('');
        setApiKey('');
        setBaseUrl(
          provider === 'ollama' ? 'http://localhost:11434'
          : provider === 'zai' && billingModelOverride === 'subscription' ? 'https://api.z.ai/api/anthropic'
          : provider === 'zai' ? 'https://api.z.ai/api/paas/v4'
          : ''
        );
        setRegion('us-east-1');
        setCustomModels([]);
      }
      setNewModelId('');
      setNewModelLabel('');
      // Reset OAuth state
      setOauthStatus('idle');
      setOauthEmail(null);
      setOauthProfileId(null);
      setOauthError(null);
      setAccountSaved(false);
      setShowFallbackTerminal(false);
      setFallbackTerminalId(null);
      setFallbackConfigDir(null);
    }
  }, [open, editAccount, provider, billingModelOverride]);

  // Parse DUPLICATE_EMAIL error from backend and show user-friendly toast
  const handleDuplicateEmailError = useCallback((error: string): boolean => {
    if (error.startsWith('DUPLICATE_EMAIL:')) {
      const existingName = error.slice('DUPLICATE_EMAIL:'.length);
      toast({
        variant: 'destructive',
        title: t('providers.dialog.toast.error'),
        description: t('providers.dialog.toast.duplicateEmail', { existingName }),
      });
      return true;
    }
    return false;
  }, [toast, t]);

  const isOAuthOnly = (provider === 'anthropic' || provider === 'openai') && authType === 'oauth';
  const isCodexOAuth = provider === 'openai' && authType === 'oauth';

  const refreshUsageData = useCallback(async () => {
    try {
      await window.electronAPI.requestAllProfilesUsage?.(true);
    } catch {
      // Non-fatal. Usage will refresh on the next polling cycle.
    }
  }, []);

  // Subscribe to Anthropic OAuth progress events (not used for Codex/OpenAI)
  useEffect(() => {
    if (!open || oauthStatus === 'idle' || oauthStatus === 'success') return;
    if (isCodexOAuth) return;

    const unsubscribe = window.electronAPI.onClaudeAuthLoginProgress((data) => {
      switch (data.status) {
        case 'authenticating':
          setOauthStatus('authenticating');
          break;
        case 'waiting':
          setOauthStatus('waiting');
          break;
        case 'success':
          setOauthStatus('success');
          if (data.message) setOauthEmail(data.message);
          break;
        case 'error':
          setOauthStatus('error');
          setOauthError(data.message ?? 'Unknown error');
          break;
      }
    });

    return unsubscribe;
  }, [open, oauthStatus, isCodexOAuth]);

  const needsApiKey = provider !== 'ollama' && authType === 'api-key';
  const needsBaseUrl = provider === 'ollama' || provider === 'azure' || provider === 'openai-compatible' || provider === 'zai' || (provider === 'anthropic' && authType === 'api-key');
  const needsRegion = provider === 'amazon-bedrock';
  const isBaseUrlRequired = provider === 'ollama' || provider === 'azure' || provider === 'openai-compatible';

  // Auto-save for Anthropic OAuth on success (mirrors the Codex auto-save behavior)
  useEffect(() => {
    if (oauthStatus !== 'success' || isCodexOAuth || accountSaved || !name.trim()) return;

    const autoSave = async () => {
      let result: {
        success: boolean;
        data?: ProviderAccount;
        error?: string;
      };
      if (isEditing && editAccount) {
        // Re-authenticating existing Anthropic OAuth account — update in place
        result = await updateProviderAccount(editAccount.id, {
          name: name.trim(),
          claudeProfileId: oauthProfileId ?? editAccount.claudeProfileId,
          ...(oauthEmail ? { email: oauthEmail } : {}),
        });
      } else {
        const payload = {
          provider,
          name: name.trim(),
          authType: 'oauth' as const,
          billingModel: 'subscription' as const,
          claudeProfileId: oauthProfileId ?? undefined,
          ...(oauthEmail ? { email: oauthEmail } : {}),
        };
        result = await addProviderAccount(payload);
      }
      if (result.success) {
        setAccountSaved(true);
        await refreshUsageData();
        toast({
          title: isEditing
            ? t('providers.dialog.toast.updated')
            : t('providers.dialog.toast.added'),
          description: name.trim(),
        });
      } else if (result.error && !handleDuplicateEmailError(result.error)) {
        toast({
          variant: 'destructive',
          title: t('providers.dialog.toast.error'),
          description: result.error,
        });
      }
    };
    autoSave();
  }, [oauthStatus, isCodexOAuth, accountSaved, name, provider, oauthProfileId, isEditing, editAccount, oauthEmail, addProviderAccount, updateProviderAccount, handleDuplicateEmailError, toast, t, refreshUsageData]);

  const canSave = () => {
    if (!name.trim()) return false;
    if (isOAuthOnly) return isEditing || oauthStatus === 'success';
    if (needsApiKey && !apiKey.trim()) return false;
    if (isBaseUrlRequired && !baseUrl.trim()) return false;
    return true;
  };

  const oauthAuthLabel = isCodexOAuth
    ? isEditing
      ? t('providers.dialog.codexReauthenticate')
      : t('providers.dialog.codexAuthenticate')
    : isEditing
      ? t('providers.dialog.oauthReauthenticate')
      : t('providers.dialog.oauthAuthenticate');

  const handleAuthenticate = useCallback(async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: t('providers.dialog.oauthNameRequired'),
      });
      return;
    }

    setOauthStatus('authenticating');
    setOauthError(null);

    // Handle OpenAI Codex OAuth flow separately
    if (isCodexOAuth) {
      try {
        setOauthStatus('waiting');
        const result = await window.electronAPI.codexAuthLogin();
        if (result.success) {
          setOauthStatus('success');
          if (result.data?.email) {
            setOauthEmail(result.data.email);
          }
          // Auto-save and close after a brief delay so user sees the success state
          setTimeout(async () => {
            let saveResult: {
              success: boolean;
              data?: ProviderAccount;
              error?: string;
            };
            if (isEditing && editAccount) {
              // Re-authenticating existing account — update in place
              saveResult = await updateProviderAccount(editAccount.id, {
                name: name.trim(),
                ...(result.data?.email ? { email: result.data.email } : {}),
              });
            } else {
              const payload = {
                provider,
                name: name.trim(),
                authType: 'oauth' as const,
                billingModel: 'subscription' as const,
                ...(result.data?.email ? { email: result.data.email } : {}),
              };
              saveResult = await addProviderAccount(payload);
            }
              if (saveResult.success) {
                toast({
                  title: isEditing
                    ? t('providers.dialog.toast.updated')
                    : t('providers.dialog.toast.added'),
                  description: name.trim(),
                });
                await refreshUsageData();
                onOpenChange(false);
              } else if (saveResult.error && !handleDuplicateEmailError(saveResult.error)) {
                toast({
                  variant: 'destructive',
                  title: t('providers.dialog.toast.error'),
                  description: saveResult.error,
                });
              }
            }, 800);
        } else {
          setOauthStatus('error');
          setOauthError(result.error ?? 'Authentication failed');
        }
      } catch (err) {
        setOauthStatus('error');
        setOauthError(err instanceof Error ? err.message : 'Unexpected error');
      }
      return;
    }

    try {
      // Reuse existing Claude profile when re-authenticating, create new otherwise
      let profileId: string;
      if (isEditing && editAccount?.claudeProfileId) {
        profileId = editAccount.claudeProfileId;
        setOauthProfileId(profileId);
      } else {
        const profileResult = await window.electronAPI.saveClaudeProfile({
          id: '',
          name: name.trim(),
          isDefault: false,
          isAuthenticated: false,
          configDir: '',
          createdAt: new Date(),
        });

        if (!profileResult.success || !profileResult.data) {
          setOauthStatus('error');
          setOauthError('Failed to create profile');
          return;
        }

        profileId = profileResult.data.id;
        setOauthProfileId(profileId);
      }

      // Run the subprocess auth (re-authenticates for existing profiles)
      const result = await window.electronAPI.claudeAuthLoginSubprocess(profileId);

      if (result.success && result.data?.authenticated) {
        setOauthStatus('success');
        setOauthEmail(result.data.email ?? null);
      } else {
        setOauthStatus('error');
        setOauthError(result.error ?? 'Authentication failed');
      }
    } catch (err) {
      setOauthStatus('error');
      setOauthError(err instanceof Error ? err.message : 'Unexpected error');
    }
  }, [name, t, toast, isCodexOAuth, isEditing, editAccount, provider, addProviderAccount, updateProviderAccount, handleDuplicateEmailError, onOpenChange, refreshUsageData]);

  const handleFallbackTerminal = useCallback(async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: t('providers.dialog.oauthNameRequired'),
      });
      return;
    }

    try {
      // Create a profile if we don't have one yet
      let profileId = oauthProfileId;
      if (!profileId) {
        const profileResult = await window.electronAPI.saveClaudeProfile({
          id: '',
          name: name.trim(),
          isDefault: false,
          isAuthenticated: false,
          configDir: '',
          createdAt: new Date(),
        });
        if (!profileResult.success || !profileResult.data) {
          toast({ variant: 'destructive', title: t('providers.dialog.toast.createProfileFailed') });
          return;
        }
        profileId = profileResult.data.id;
        setOauthProfileId(profileId);
      }

      // Get terminal config for embedded AuthTerminal
      const authResult = await window.electronAPI.authenticateClaudeProfile(profileId);
      if (!authResult.success || !authResult.data) {
        toast({ variant: 'destructive', title: authResult.error ?? t('providers.dialog.toast.authPrepareFailed') });
        return;
      }

      setFallbackTerminalId(authResult.data.terminalId);
      setFallbackConfigDir(authResult.data.configDir);
      setShowFallbackTerminal(true);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: err instanceof Error ? err.message : t('providers.dialog.toast.unexpectedError'),
      });
    }
  }, [name, oauthProfileId, t, toast]);

  const handleFallbackAuthSuccess = useCallback((email?: string) => {
    setOauthStatus('success');
    setOauthEmail(email ?? null);
    setShowFallbackTerminal(false);
  }, []);

  const handleSave = async () => {
    if (!canSave()) return;

    setIsSaving(true);
    try {
      const payload = {
        provider,
        name: name.trim(),
        authType,
        billingModel: billingModelOverride ?? (authType === 'oauth' ? 'subscription' as const : 'pay-per-use' as const),
        apiKey: needsApiKey ? apiKey.trim() : undefined,
        baseUrl: needsBaseUrl && baseUrl.trim() ? baseUrl.trim() : undefined,
        region: needsRegion ? region : undefined,
        claudeProfileId: isOAuthOnly && !isCodexOAuth ? oauthProfileId ?? undefined : undefined,
        email: isOAuthOnly ? (oauthEmail ?? (isEditing ? editAccount?.email : undefined)) : undefined,
        customModels: provider === 'openai-compatible' && customModels.length > 0 ? customModels : undefined,
      };

      let result: {
        success: boolean;
        data?: ProviderAccount;
        error?: string;
      };
      if (isEditing && editAccount) {
        const payloadUpdates = {
          name: payload.name,
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
          region: payload.region,
          customModels: payload.customModels,
          ...(payload.email ? { email: payload.email } : {}),
        };
        result = await updateProviderAccount(editAccount.id, {
          ...payloadUpdates,
        });
      } else {
        result = await addProviderAccount(payload);
      }

      if (result.success) {
        await refreshUsageData();
        toast({
          title: isEditing
            ? t('providers.dialog.toast.updated')
            : t('providers.dialog.toast.added'),
          description: name.trim(),
        });
        onOpenChange(false);
      } else if (result.error && !handleDuplicateEmailError(result.error)) {
        toast({
          variant: 'destructive',
          title: t('providers.dialog.toast.error'),
          description: result.error ?? t('accounts.toast.tryAgain'),
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const title = isEditing
    ? t('providers.dialog.editTitle', { provider })
    : t('providers.dialog.addTitle', { provider });

  const isAuthInProgress = oauthStatus === 'authenticating' || oauthStatus === 'waiting';

  return (
    <Dialog open={open} onOpenChange={(v) => {
      // Prevent closing during auth
      if (isAuthInProgress) return;
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isCodexOAuth
              ? t('providers.dialog.codexOAuthDescription')
              : isOAuthOnly
                ? t('providers.dialog.oauthDescription')
                : provider === 'zai' && billingModelOverride === 'subscription'
                  ? t('providers.dialog.zaiCodingPlanDescription')
                  : provider === 'zai'
                    ? t('providers.dialog.zaiUsageBasedDescription')
                    : t('providers.dialog.apiKeyDescription')}
          </DialogDescription>
        </DialogHeader>

        {isOAuthOnly ? (
          <div className="space-y-4">
            {/* Account Name */}
            <div className="space-y-2">
              <Label htmlFor="oauth-account-name">{t('providers.dialog.fields.name')}</Label>
              <Input
                id="oauth-account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('providers.dialog.placeholders.name')}
                disabled={oauthStatus === 'success' || isAuthInProgress}
                autoFocus
              />
            </div>

            {/* Authenticate Button */}
            {oauthStatus === 'idle' && (
              <Button
                onClick={handleAuthenticate}
                className="w-full"
                disabled={!name.trim()}
              >
                {oauthAuthLabel}
              </Button>
            )}

            {/* Progress States */}
            {oauthStatus === 'authenticating' && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{isCodexOAuth ? t('providers.dialog.codexAuthenticating') : t('providers.dialog.oauthAuthenticating')}</span>
              </div>
            )}

            {oauthStatus === 'waiting' && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{isCodexOAuth ? t('providers.dialog.codexWaiting') : t('providers.dialog.oauthWaiting')}</span>
              </div>
            )}

            {oauthStatus === 'success' && (
              <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>{isCodexOAuth ? t('providers.dialog.codexSuccess') : t('providers.dialog.oauthSuccess', { email: oauthEmail ?? 'Unknown' })}</span>
              </div>
            )}

            {oauthStatus === 'error' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{isCodexOAuth ? t('providers.dialog.codexError', { error: oauthError ?? 'Unknown' }) : t('providers.dialog.oauthError', { error: oauthError ?? 'Unknown' })}</span>
                </div>
                <Button
                  variant="outline"
                  onClick={handleAuthenticate}
                  className="w-full"
                  disabled={!name.trim()}
                >
                  {oauthAuthLabel}
                </Button>
              </div>
            )}

            {/* Fallback Terminal Link (Anthropic OAuth only) */}
            {!isCodexOAuth && !showFallbackTerminal && oauthStatus !== 'success' && !isAuthInProgress && (
              <button
                type="button"
                onClick={handleFallbackTerminal}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                disabled={!name.trim()}
              >
                <Terminal className="h-3 w-3" />
                {t('providers.dialog.oauthFallback')}
              </button>
            )}

            {/* Fallback AuthTerminal (Anthropic OAuth only) */}
            {!isCodexOAuth && showFallbackTerminal && fallbackTerminalId && fallbackConfigDir && (
              <FallbackTerminalWrapper
                terminalId={fallbackTerminalId}
                configDir={fallbackConfigDir}
                profileName={name.trim()}
                onClose={() => setShowFallbackTerminal(false)}
                onAuthSuccess={handleFallbackAuthSuccess}
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="account-name">{t('providers.dialog.fields.name')}</Label>
              <Input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('providers.dialog.placeholders.name')}
                autoFocus
              />
            </div>

            {/* API Key */}
            {needsApiKey && (
              <div className="space-y-2">
                <Label htmlFor="account-apikey">{t('providers.dialog.fields.apiKey')}</Label>
                <Input
                  id="account-apikey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('providers.dialog.placeholders.apiKey')}
                />
              </div>
            )}

            {/* Base URL */}
            {needsBaseUrl && (
              <div className="space-y-2">
                <Label htmlFor="account-baseurl">
                  {t('providers.dialog.fields.baseUrl')}
                  {!isBaseUrlRequired && (
                    <span className="text-muted-foreground font-normal ml-1">
                      {t('providers.dialog.optional')}
                    </span>
                  )}
                </Label>
                <Input
                  id="account-baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'http://localhost:11434'
                      : provider === 'anthropic'
                        ? 'https://api.anthropic.com'
                        : provider === 'zai' && billingModelOverride === 'subscription'
                          ? 'https://api.z.ai/api/anthropic'
                          : provider === 'zai'
                            ? 'https://api.z.ai/api/paas/v4'
                            : t('providers.dialog.placeholders.baseUrl')
                  }
                />
              </div>
            )}

            {/* Region (Bedrock) */}
            {needsRegion && (
              <div className="space-y-2">
                <Label htmlFor="account-region">{t('providers.dialog.fields.region')}</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id="account-region">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AWS_REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Custom Models (openai-compatible) */}
            {provider === 'openai-compatible' && (
              <div className="space-y-2">
                <Label>{t('providers.dialog.fields.models')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('providers.dialog.modelsDescription')}
                </p>

                {/* Existing models */}
                {customModels.length > 0 && (
                  <div className="space-y-1">
                    {customModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                      >
                        <span className="font-medium truncate">{model.label}</span>
                        <span className="text-xs text-muted-foreground truncate">{model.id}</span>
                        <button
                          type="button"
                          onClick={() => setCustomModels(prev => prev.filter(m => m.id !== model.id))}
                          className="ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new model */}
                <div className="flex gap-1.5">
                  <Input
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    placeholder={t('providers.dialog.placeholders.modelId')}
                    className="flex-1 h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newModelId.trim()) {
                        e.preventDefault();
                        const id = newModelId.trim();
                        const label = newModelLabel.trim() || id;
                        if (!customModels.some(m => m.id === id)) {
                          setCustomModels(prev => [...prev, { id, label }]);
                        }
                        setNewModelId('');
                        setNewModelLabel('');
                      }
                    }}
                  />
                  <Input
                    value={newModelLabel}
                    onChange={(e) => setNewModelLabel(e.target.value)}
                    placeholder={t('providers.dialog.placeholders.modelLabel')}
                    className="w-28 h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newModelId.trim()) {
                        e.preventDefault();
                        const id = newModelId.trim();
                        const label = newModelLabel.trim() || id;
                        if (!customModels.some(m => m.id === id)) {
                          setCustomModels(prev => [...prev, { id, label }]);
                        }
                        setNewModelId('');
                        setNewModelLabel('');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={!newModelId.trim()}
                    onClick={() => {
                      const id = newModelId.trim();
                      const label = newModelLabel.trim() || id;
                      if (id && !customModels.some(m => m.id === id)) {
                        setCustomModels(prev => [...prev, { id, label }]);
                      }
                      setNewModelId('');
                      setNewModelLabel('');
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {accountSaved ? (
            <Button onClick={() => onOpenChange(false)}>
              {t('providers.dialog.close')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving || isAuthInProgress}>
                {t('providers.dialog.cancel')}
              </Button>
              {(isOAuthOnly ? (isEditing || oauthStatus === 'success') : true) && (
                <Button onClick={handleSave} disabled={!canSave() || isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {isEditing ? t('providers.dialog.save') : t('providers.dialog.add')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lazy wrapper for AuthTerminal to avoid importing xterm.js unless needed.
 * AuthTerminal is rendered inside the dialog only when the user clicks "Use Terminal (Fallback)".
 */
function FallbackTerminalWrapper({
  terminalId,
  configDir,
  profileName,
  onClose,
  onAuthSuccess,
}: {
  terminalId: string;
  configDir: string;
  profileName: string;
  onClose: () => void;
  onAuthSuccess: (email?: string) => void;
}) {
  const [AuthTerminalComponent, setAuthTerminalComponent] = useState<React.ComponentType<{
    terminalId: string;
    configDir: string;
    profileName: string;
    onClose: () => void;
    onAuthSuccess?: (email?: string) => void;
  }> | null>(null);

  useEffect(() => {
    import('./AuthTerminal').then((mod) => {
      setAuthTerminalComponent(() => mod.AuthTerminal);
    });
  }, []);

  if (!AuthTerminalComponent) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-border">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden" style={{ height: 280 }}>
      <AuthTerminalComponent
        terminalId={terminalId}
        configDir={configDir}
        profileName={profileName}
        onClose={onClose}
        onAuthSuccess={onAuthSuccess}
      />
    </div>
  );
}
