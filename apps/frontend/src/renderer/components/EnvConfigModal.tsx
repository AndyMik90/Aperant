import { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Key,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Info,
  LogIn,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useSettingsStore } from '../stores/settings-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { cn } from '../lib/utils';
import type { ClaudeProfile } from '../../shared/types';

interface EnvConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured?: () => void;
  title?: string;
  description?: string;
  projectId?: string;
}

export function EnvConfigModal({
  open,
  onOpenChange,
  onConfigured,
  title = 'Claude Authentication Required',
  description = 'A Claude Code OAuth token is required to use AI features like Ideation and Roadmap generation.',
  projectId
}: EnvConfigModalProps) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [claudeProfiles, setClaudeProfiles] = useState<Array<{
    id: string;
    name: string;
    oauthToken?: string;
    email?: string;
    isDefault: boolean;
  }>>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);

  // Load Claude profiles and check token status when modal opens
  useEffect(() => {
    const loadData = async () => {
      if (!open) return;

      setIsChecking(true);
      setIsLoadingProfiles(true);
      setError(null);
      setSuccess(false);

      try {
        // Load both token status and Claude profiles in parallel
        const [tokenResult, profilesResult] = await Promise.all([
          window.electronAPI.checkSourceToken(),
          window.electronAPI.getClaudeProfiles()
        ]);

        // Handle token status
        if (tokenResult.success && tokenResult.data) {
          setSourcePath(tokenResult.data.sourcePath || null);
          setHasExistingToken(tokenResult.data.hasToken);

          if (tokenResult.data.hasToken) {
            // Token exists, show success state
            setSuccess(true);
          }
        } else {
          setError(tokenResult.error || 'Failed to check token status');
        }

        // Handle Claude profiles
        if (profilesResult.success && profilesResult.data) {
          const authenticatedProfiles = profilesResult.data.profiles.filter(
            (p: ClaudeProfile) => p.oauthToken || (p.isDefault && p.configDir)
          );
          setClaudeProfiles(authenticatedProfiles);

          // Auto-select first authenticated profile
          if (authenticatedProfiles.length > 0 && !selectedProfileId) {
            setSelectedProfileId(authenticatedProfiles[0].id);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsChecking(false);
        setIsLoadingProfiles(false);
      }
    };

    loadData();
  }, [open, selectedProfileId]);

  // Listen for OAuth token from terminal
  useEffect(() => {
    if (!open) return;

    const cleanup = window.electronAPI.onTerminalOAuthToken(async (info) => {
      if (info.success) {
        // Token is auto-saved to the profile by the main process
        // Just update UI state to reflect authentication success
        setSuccess(true);
        setHasExistingToken(true);
        setIsAuthenticating(false);

        // Notify parent
        setTimeout(() => {
          onConfigured?.();
          onOpenChange(false);
        }, 1500);
      }
    });

    return cleanup;
  }, [open, onConfigured, onOpenChange]);

  const handleUseExistingProfile = async () => {
    if (!selectedProfileId) return;

    setIsSaving(true);
    setError(null);

    try {
      // Get the selected profile's token
      const profile = claudeProfiles.find(p => p.id === selectedProfileId);
      if (!profile?.oauthToken) {
        setError('Selected profile does not have a valid token');
        setIsSaving(false);
        return;
      }

      // Save the token to auto-claude .env
      const result = await window.electronAPI.updateSourceEnv({
        claudeOAuthToken: profile.oauthToken
      });

      if (result.success) {
        setSuccess(true);
        setHasExistingToken(true);

        // Notify parent
        setTimeout(() => {
          onConfigured?.();
          onOpenChange(false);
        }, 1500);
      } else {
        setError(result.error || 'Failed to save token');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAuthenticateWithBrowser = async () => {
    if (!projectId) {
      setError('No project selected. Please select a project first.');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Invoke the Claude setup-token flow in terminal
      const result = await window.electronAPI.invokeClaudeSetup(projectId);

      if (!result.success) {
        setError(result.error || 'Failed to start authentication');
        setIsAuthenticating(false);
      }
      // Keep isAuthenticating true - will be cleared when token is received
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start authentication');
      setIsAuthenticating(false);
    }
  };

  const handleSave = async () => {
    if (!token.trim()) {
      setError('Please enter a token');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await window.electronAPI.updateSourceEnv({
        claudeOAuthToken: token.trim()
      });

      if (result.success) {
        setSuccess(true);
        setHasExistingToken(true);
        setToken(''); // Clear the input

        // Notify parent that configuration is complete
        setTimeout(() => {
          onConfigured?.();
          onOpenChange(false);
        }, 1500);
      } else {
        setError(result.error || 'Failed to save token');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText('claude setup-token');
  };

  const handleOpenDocs = () => {
    // Open the Claude Code documentation for getting a token
    window.open('https://docs.anthropic.com/en/docs/claude-code', '_blank');
  };

  const handleClose = () => {
    if (!isSaving) {
      setToken('');
      setError(null);
      setSuccess(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Key className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Loading state */}
        {isChecking && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Success state */}
        {!isChecking && success && (
          <div className="py-4">
            <div className="rounded-lg bg-success/10 border border-success/30 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-success">
                  Token configured successfully
                </p>
                <p className="text-xs text-success/80 mt-1">
                  You can now use AI features like Ideation and Roadmap generation.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Configuration form */}
        {!isChecking && !success && (
          <div className="py-4 space-y-4">
            {/* Error banner */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Option 1: Use existing authenticated profile */}
            {!isLoadingProfiles && claudeProfiles.length > 0 && (
              <div className="space-y-3">
                <div className="rounded-lg bg-success/10 border border-success/30 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-foreground font-medium mb-1">
                        Use Existing Account
                      </p>
                      <p className="text-xs text-muted-foreground">
                        You have {claudeProfiles.length} authenticated Claude account{claudeProfiles.length > 1 ? 's' : ''}. Select one to use:
                      </p>
                    </div>
                  </div>
                </div>

                {/* Profile selector */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">
                    Select Account
                  </Label>
                  <div className="space-y-2">
                    {claudeProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => setSelectedProfileId(profile.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left",
                          selectedProfileId === profile.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <div className={cn(
                          "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0",
                          selectedProfileId === profile.id
                            ? "border-primary"
                            : "border-muted-foreground"
                        )}>
                          {selectedProfileId === profile.id && (
                            <div className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {profile.name}
                            {profile.isDefault && (
                              <span className="ml-2 text-xs text-muted-foreground">(Default)</span>
                            )}
                          </p>
                          {profile.email && (
                            <p className="text-xs text-muted-foreground truncate">
                              {profile.email}
                            </p>
                          )}
                        </div>
                        <CheckCircle2 className={cn(
                          "h-4 w-4 shrink-0",
                          selectedProfileId === profile.id ? "text-primary" : "text-transparent"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={handleUseExistingProfile}
                  disabled={!selectedProfileId || isSaving}
                  className="w-full"
                  size="lg"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Key className="mr-2 h-5 w-5" />
                      Use This Account
                    </>
                  )}
                </Button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>
              </div>
            )}

            {/* Option 2: Authenticate new account with browser */}
            {!isLoadingProfiles && (
              <div className="space-y-3">
                <div className="rounded-lg bg-info/10 border border-info/30 p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-foreground font-medium mb-1">
                        {claudeProfiles.length > 0 ? 'Or Authenticate New Account' : 'Authenticate with Browser'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {claudeProfiles.length > 0
                          ? 'Add a new Claude account by logging in with your browser.'
                          : 'Click below to open your browser and log in with your Claude account.'
                        }
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleAuthenticateWithBrowser}
                  disabled={isAuthenticating}
                  className="w-full"
                  size="lg"
                  variant={claudeProfiles.length > 0 ? "outline" : "default"}
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Waiting for authentication...
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-5 w-5" />
                      {claudeProfiles.length > 0 ? 'Authenticate New Account' : 'Authenticate with Browser'}
                    </>
                  )}
                </Button>

                {isAuthenticating && (
                  <p className="text-xs text-muted-foreground text-center">
                    A browser window should open. Complete the authentication there, then return here.
                  </p>
                )}
              </div>
            )}

            {/* Divider before manual entry */}
            {!isLoadingProfiles && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>
            )}

            {/* Secondary: Manual Token Entry (Collapsible) */}
            <div className="space-y-3">
              <button
                onClick={() => setShowManualEntry(!showManualEntry)}
                className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Enter token manually</span>
                {showManualEntry ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {showManualEntry && (
                <div className="space-y-3 pl-4 border-l-2 border-border">
                  {/* Manual token instructions */}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Steps:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Install Claude Code CLI if you haven't already</li>
                      <li>
                        Run{' '}
                        <code className="px-1 py-0.5 bg-muted rounded font-mono">
                          claude setup-token
                        </code>
                        {' '}
                        <button
                          onClick={handleCopyCommand}
                          className="inline-flex items-center text-info hover:text-info/80"
                        >
                          <Copy className="h-3 w-3 ml-1" />
                        </button>
                      </li>
                      <li>Copy the token and paste it below</li>
                    </ol>
                    <button
                      onClick={handleOpenDocs}
                      className="text-info hover:text-info/80 flex items-center gap-1 mt-2"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View documentation
                    </button>
                  </div>

                  {/* Token input */}
                  <div className="space-y-2">
                    <Label htmlFor="token" className="text-sm font-medium text-foreground">
                      Claude Code OAuth Token
                    </Label>
                    <div className="relative">
                      <Input
                        id="token"
                        type={showToken ? 'text' : 'password'}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Enter your token..."
                        className="pr-10 font-mono text-sm"
                        disabled={isSaving || isAuthenticating}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showToken ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {showToken ? 'Hide token' : 'Show token'}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The token will be saved to{' '}
                      <code className="px-1 py-0.5 bg-muted rounded font-mono">
                        {sourcePath ? `${sourcePath}/.env` : 'auto-claude/.env'}
                      </code>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Existing token info */}
            {hasExistingToken && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">
                  A token is already configured. {showManualEntry ? 'Enter a new token above to replace it.' : 'Authenticate again to replace it.'}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving || isAuthenticating}>
            {success ? 'Close' : 'Cancel'}
          </Button>
          {!success && showManualEntry && token.trim() && (
            <Button onClick={handleSave} disabled={isSaving || isAuthenticating}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Key className="mr-2 h-4 w-4" />
                  Save Token
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to check if the Claude token is configured
 * Returns { hasToken, isLoading, checkToken }
 *
 * This combines two sources of authentication:
 * 1. OAuth token from source .env (checked via checkSourceToken)
 * 2. Active API profile (custom Anthropic-compatible endpoint)
 */
export function useClaudeTokenCheck() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get active API profile from settings store
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);

  const checkToken = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Compute once - activeProfileId is captured from closure
    const hasAPIProfile = !!activeProfileId;

    try {
      const result = await window.electronAPI.checkSourceToken();
      const hasSourceOAuthToken = result.success && result.data?.hasToken;

      // Auth is valid if either OAuth token OR API profile exists
      setHasToken(hasSourceOAuthToken || hasAPIProfile);

      // Set error if OAuth check failed and no API profile fallback
      if (!result.success && !hasAPIProfile) {
        setError(result.error || 'Failed to check token');
      }
    } catch (err) {
      // Even if OAuth check fails, API profile is still valid auth
      setHasToken(hasAPIProfile);
      if (!hasAPIProfile) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeProfileId]);

  useEffect(() => {
    checkToken();
  }, [checkToken]); // Re-check when checkToken changes (i.e., when activeProfileId changes)

  return { hasToken, isLoading, error, checkToken };
}
