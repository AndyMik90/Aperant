import { useState, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Key,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface ClaudeOAuthFlowProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

/**
 * Claude OAuth flow component for setup wizard
 * Guides users through authenticating with Claude by opening a visible terminal
 * where they type /login to authenticate. Uses manual verification instead of
 * auto-polling to avoid race conditions with keychain auto-reconnect.
 */
export function ClaudeOAuthFlow({ onSuccess, onCancel }: ClaudeOAuthFlowProps) {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<'ready' | 'authenticating' | 'verifying' | 'success' | 'error'>('ready');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | undefined>();
  const [authenticatingProfileId, setAuthenticatingProfileId] = useState<string | null>(null);

  // Track if we've already started auth to prevent double-execution
  const hasStartedRef = useRef(false);
  // Track the auto-advance timeout so we can cancel it on unmount/re-render
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStartAuth = async () => {
    if (hasStartedRef.current) {
      console.warn('[ClaudeOAuth] Auth already started, ignoring duplicate call');
      return;
    }
    hasStartedRef.current = true;

    console.warn('[ClaudeOAuth] Starting Claude authentication');
    setStatus('authenticating');
    setError(null);

    try {
      // Get the active profile ID
      const profilesResult = await window.electronAPI.getClaudeProfiles();

      if (!profilesResult.success || !profilesResult.data) {
        throw new Error('Failed to get Claude profiles');
      }

      const activeProfileId = profilesResult.data.activeProfileId;
      console.warn('[ClaudeOAuth] Authenticating profile:', activeProfileId);

      // Open visible terminal for authentication
      const result = await window.electronAPI.authenticateClaudeProfile(activeProfileId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to open terminal for authentication');
      }

      setAuthenticatingProfileId(activeProfileId);
      console.warn('[ClaudeOAuth] Terminal opened, waiting for user to complete /login...');
    } catch (err) {
      console.error('[ClaudeOAuth] Authentication failed:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setStatus('error');
      hasStartedRef.current = false;
    }
  };

  const handleVerifyAuth = async () => {
    if (!authenticatingProfileId) {
      setError(t('oauth.noProfileSelected'));
      return;
    }

    setStatus('verifying');
    setError(null);

    try {
      const result = await window.electronAPI.verifyClaudeProfileAuth(authenticatingProfileId);
      console.warn('[ClaudeOAuth] Verification result:', result);

      if (result.success && result.data?.authenticated) {
        console.warn('[ClaudeOAuth] Auth verified! Email:', result.data.email);
        setEmail(result.data.email);
        setStatus('success');

        // Auto-advance after a short delay to show success message
        successTimeoutRef.current = setTimeout(() => {
          successTimeoutRef.current = null;
          onSuccess();
        }, 1500);
      } else {
        setError(t('oauth.authNotDetected'));
        setStatus('authenticating');
      }
    } catch (err) {
      console.error('[ClaudeOAuth] Verification failed:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStatus('authenticating');
    }
  };

  const handleRetry = () => {
    hasStartedRef.current = false;
    setStatus('ready');
    setError(null);
    setAuthenticatingProfileId(null);
  };

  return (
    <div className="space-y-4">
      {/* Ready to authenticate */}
      {status === 'ready' && (
        <div className="space-y-4">
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Key className="h-6 w-6 text-info shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-medium text-foreground">
                    {t('oauth.authenticateTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('oauth.authenticateDescription')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('oauth.authenticateTerminalInfo')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button onClick={handleStartAuth} size="lg" className="gap-2">
              <Key className="h-5 w-5" />
              {t('oauth.authenticateTitle')}
            </Button>
          </div>
        </div>
      )}

      {/* Authenticating - waiting for user to complete /login */}
      {status === 'authenticating' && (
        <Card className="border border-info/30 bg-info/10">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Key className="h-6 w-6 text-info shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-foreground">
                    {t('oauth.completeAuthTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('oauth.terminalOpened')}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-background/50 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">{t('oauth.completeStepsTitle')}</p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>
                        <Trans
                          i18nKey="oauth.stepTypeLogin"
                          components={{ code: <code className="font-mono bg-muted px-1 rounded" /> }}
                        />
                      </li>
                      <li>{t('oauth.stepBrowserOpen')}</li>
                      <li>{t('oauth.stepCompleteOAuth')}</li>
                      <li>
                        <Trans
                          i18nKey="oauth.stepReturnAndVerify"
                          components={{ strong: <strong className="font-semibold" /> }}
                        />
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <div className="flex justify-center gap-3">
                <Button onClick={handleVerifyAuth} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('oauth.verifyAuth')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verifying */}
      {status === 'verifying' && (
        <Card className="border border-info/30 bg-info/10">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-info shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-foreground">
                  {t('oauth.verifyingAuth')}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('oauth.checkingCredentials')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success */}
      {status === 'success' && (
        <Card className="border border-success/30 bg-success/10">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-success">
                  {t('oauth.successTitle')}
                </h3>
                <p className="text-sm text-success/80 mt-1">
                  {email ? t('oauth.connectedAs', { email }) : t('oauth.credentialsSaved')}
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs text-success/70">
                  <Sparkles className="h-3 w-3" />
                  <span>{t('oauth.canUseFeatures')}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="space-y-4">
          <Card className="border border-destructive/30 bg-destructive/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-destructive">
                    {t('oauth.authFailed')}
                  </h3>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center gap-3">
            <Button onClick={handleRetry} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('buttons.retry')}
            </Button>
            {onCancel && (
              <Button onClick={onCancel} variant="ghost">
                {t('buttons.cancel')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Cancel button for ready/authenticating states */}
      {(status === 'ready' || status === 'authenticating') && onCancel && (
        <div className="flex justify-center pt-2">
          <Button onClick={onCancel} variant="ghost" size="sm">
            {t('oauth.skipForNow')}
          </Button>
        </div>
      )}
    </div>
  );
}
