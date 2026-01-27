import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Github,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
  Terminal,
  Copy,
  Check,
  Clock
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface GitHubOAuthFlowProps {
  onSuccess: (token: string, username?: string) => void;
  onCancel?: () => void;
}

// Debug logging helper - logs when DEBUG env var is set or in development
const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[GitHubOAuth] ${message}`, data);
    } else {
      console.warn(`[GitHubOAuth] ${message}`);
    }
  }
}

// Authentication timeout in milliseconds (5 minutes)
// GitHub device codes typically expire after 15 minutes, but 5 minutes is a reasonable UX timeout
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * GitHub OAuth flow component using gh CLI
 * Guides users through authenticating with GitHub using the gh CLI
 */
export function GitHubOAuthFlow({ onSuccess, onCancel }: GitHubOAuthFlowProps) {
  const { t } = useTranslation('github');
  const [status, setStatus] = useState<'checking' | 'need-install' | 'need-auth' | 'authenticating' | 'success' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [_cliInstalled, setCliInstalled] = useState(false);
  const [cliVersion, setCliVersion] = useState<string | undefined>();
  const [username, setUsername] = useState<string | undefined>();

  // Device flow state for displaying code and auth URL
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [browserOpened, setBrowserOpened] = useState<boolean>(false);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);
  const [urlCopied, setUrlCopied] = useState<boolean>(false);
  const [isTimeout, setIsTimeout] = useState<boolean>(false);

  // Ref to track authentication timeout
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs to track copy feedback timeouts
  const codeCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check gh CLI installation and authentication status on mount
  // Use a ref to prevent double-execution in React Strict Mode
  const hasCheckedRef = useRef(false);

  // Clear the authentication timeout
  const clearAuthTimeout = useCallback(() => {
    if (authTimeoutRef.current) {
      debugLog('Clearing auth timeout');
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;
    }
  }, []);

  // Cleanup copy feedback timeouts on unmount
  useEffect(() => {
    return () => {
      if (codeCopyTimeoutRef.current) {
        clearTimeout(codeCopyTimeoutRef.current);
      }
      if (urlCopyTimeoutRef.current) {
        clearTimeout(urlCopyTimeoutRef.current);
      }
    };
  }, []);

  // Handle authentication timeout
  const handleAuthTimeout = useCallback(() => {
    debugLog('Authentication timeout triggered after 5 minutes');
    setIsTimeout(true);
    setError(t('oauth.authenticationTimeoutMessage'));
    setStatus('error');
    authTimeoutRef.current = null;
  }, [t]);

  useEffect(() => {
    if (hasCheckedRef.current) {
      debugLog('Skipping duplicate check (Strict Mode)');
      return;
    }
    hasCheckedRef.current = true;
    debugLog('Component mounted, checking GitHub status...');
    checkGitHubStatus();

    // Cleanup timeout on unmount
    return () => {
      clearAuthTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once on mount, checkGitHubStatus is intentionally excluded
  }, [clearAuthTimeout]);

  // Listen for device code events from the main process
  // This allows us to display the code IMMEDIATELY when extracted, not after the auth completes
  useEffect(() => {
    if (status !== 'authenticating') {
      return;
    }

    debugLog('Setting up device code event listener');

    // Listen for device code from main process (sent immediately when extracted)
    const cleanup = window.electronAPI.onGitHubAuthDeviceCode((data) => {
      debugLog('Received device code from main process:', {
        hasCode: !!data.deviceCode,
        authUrl: data.authUrl,
        browserOpened: data.browserOpened
      });

      if (data.deviceCode) {
        setDeviceCode(data.deviceCode);
      }
      if (data.authUrl) {
        setAuthUrl(data.authUrl);
      }
      setBrowserOpened(data.browserOpened);
    });

    return () => {
      debugLog('Cleaning up device code event listener');
      cleanup();
    };
  }, [status]);

  const checkGitHubStatus = async () => {
    debugLog('checkGitHubStatus() called');
    setStatus('checking');
    setError(null);

    try {
      // Check if gh CLI is installed
      debugLog('Calling checkGitHubCli...');
      const cliResult = await window.electronAPI.checkGitHubCli();
      debugLog('checkGitHubCli result:', cliResult);

      if (!cliResult.success) {
        debugLog('checkGitHubCli failed:', cliResult.error);
        setError(cliResult.error || 'Failed to check GitHub CLI');
        setStatus('error');
        return;
      }

      if (!cliResult.data?.installed) {
        debugLog('GitHub CLI not installed');
        setStatus('need-install');
        setCliInstalled(false);
        return;
      }

      setCliInstalled(true);
      setCliVersion(cliResult.data.version);
      debugLog('GitHub CLI installed, version:', cliResult.data.version);

      // Check if already authenticated
      debugLog('Calling checkGitHubAuth...');
      const authResult = await window.electronAPI.checkGitHubAuth();
      debugLog('checkGitHubAuth result:', authResult);

      if (authResult.success && authResult.data?.authenticated) {
        debugLog('Already authenticated as:', authResult.data.username);
        setUsername(authResult.data.username);
        // Get the token and notify parent
        await fetchAndNotifyToken();
      } else {
        debugLog('Not authenticated, showing auth prompt');
        setStatus('need-auth');
      }
    } catch (err) {
      debugLog('Error in checkGitHubStatus:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const fetchAndNotifyToken = async () => {
    debugLog('fetchAndNotifyToken() called');
    try {
      debugLog('Calling getGitHubToken...');
      const tokenResult = await window.electronAPI.getGitHubToken();
      debugLog('getGitHubToken result:', {
        success: tokenResult.success,
        hasToken: !!tokenResult.data?.token,
        tokenLength: tokenResult.data?.token?.length,
        error: tokenResult.error
      });

      if (tokenResult.success && tokenResult.data?.token) {
        debugLog('Token retrieved successfully, calling onSuccess with username:', username);
        setStatus('success');
        onSuccess(tokenResult.data.token, username);
      } else {
        debugLog('Failed to get token:', tokenResult.error);
        setError(tokenResult.error || 'Failed to get token');
        setStatus('error');
      }
    } catch (err) {
      debugLog('Error in fetchAndNotifyToken:', err);
      setError(err instanceof Error ? err.message : 'Failed to get token');
      setStatus('error');
    }
  };

  const handleStartAuth = async () => {
    debugLog('handleStartAuth() called');
    setStatus('authenticating');
    setError(null);

    // Reset device flow state
    setDeviceCode(null);
    setAuthUrl(null);
    setBrowserOpened(false);
    setCodeCopied(false);
    setUrlCopied(false);
    setIsTimeout(false);

    // Clear any existing timeout and start a new one
    clearAuthTimeout();
    debugLog(`Starting auth timeout (${AUTH_TIMEOUT_MS / 1000 / 60} minutes)`);
    authTimeoutRef.current = setTimeout(handleAuthTimeout, AUTH_TIMEOUT_MS);

    try {
      debugLog('Calling startGitHubAuth...');
      const result = await window.electronAPI.startGitHubAuth();
      debugLog('startGitHubAuth result:', result);

      // Clear timeout since we got a response
      clearAuthTimeout();

      // Capture device flow info if available
      if (result.data?.deviceCode) {
        debugLog('Device code received:', result.data.deviceCode);
        setDeviceCode(result.data.deviceCode);
      }
      if (result.data?.authUrl) {
        debugLog('Auth URL received:', result.data.authUrl);
        setAuthUrl(result.data.authUrl);
      }
      if (result.data?.browserOpened !== undefined) {
        debugLog('Browser opened status:', result.data.browserOpened);
        setBrowserOpened(result.data.browserOpened);
      }

      if (result.success && result.data?.success) {
        debugLog('Auth successful, fetching token...');
        // Fetch the token and notify parent
        await fetchAndNotifyToken();
      } else {
        debugLog('Auth failed:', result.error);
        // Include fallback URL info in error message if available
        const errorMessage = result.error || 'Authentication failed';
        setError(errorMessage);
        // Keep authUrl from response for fallback display
        if (result.data?.fallbackUrl) {
          setAuthUrl(result.data.fallbackUrl);
        }
        setStatus('error');
      }
    } catch (err) {
      // Clear timeout on error
      clearAuthTimeout();
      debugLog('Error in handleStartAuth:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setStatus('error');
    }
  };

  const handleOpenGhInstall = () => {
    debugLog('Opening gh CLI install page');
    window.open('https://cli.github.com/', '_blank');
  };

  const handleRetry = () => {
    debugLog('Retry clicked');
    checkGitHubStatus();
  };

  const handleCopyDeviceCode = async () => {
    if (!deviceCode) return;
    debugLog('Copying device code to clipboard');
    try {
      await navigator.clipboard.writeText(deviceCode);
      setCodeCopied(true);
      // Clear any existing timeout before setting a new one
      if (codeCopyTimeoutRef.current) {
        clearTimeout(codeCopyTimeoutRef.current);
      }
      // Reset the copied state after 2 seconds
      codeCopyTimeoutRef.current = setTimeout(() => setCodeCopied(false), 2000);
    } catch (err) {
      debugLog('Failed to copy device code:', err);
    }
  };

  const handleOpenAuthUrl = () => {
    if (authUrl) {
      debugLog('Opening auth URL manually:', authUrl);
      window.open(authUrl, '_blank');
    }
  };

  debugLog('Rendering with status:', status);

  return (
    <div className="space-y-4">
      {/* Checking status */}
      {status === 'checking' && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Need to install gh CLI */}
      {status === 'need-install' && (
        <div className="space-y-4">
          <Card className="border border-warning/30 bg-warning/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Terminal className="h-6 w-6 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-medium text-foreground">
                    {t('oauth.cliRequired')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('oauth.cliRequiredDescription')}
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={handleOpenGhInstall} className="gap-2">
                      <ExternalLink className="h-4 w-4" />
                      {t('oauth.installCli')}
                    </Button>
                    <Button variant="outline" onClick={handleRetry}>
                      {t('oauth.iveInstalledIt')}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                <div className="flex-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-2">{t('oauth.installationInstructions')}</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>{t('oauth.installMacos')} <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">brew install gh</code></li>
                    <li>{t('oauth.installWindows')} <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">winget install GitHub.cli</code></li>
                    <li>{t('oauth.installLinux')} <a href="https://cli.github.com/" target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{t('oauth.installLinuxLink')}</a></li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Need authentication */}
      {status === 'need-auth' && (
        <div className="space-y-4">
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Github className="h-6 w-6 text-info shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-medium text-foreground">
                    {t('oauth.connectToGitHub')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('oauth.connectDescription')}
                  </p>
                  {cliVersion && (
                    <p className="text-xs text-muted-foreground">
                      {t('oauth.usingCli', { version: cliVersion })}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button onClick={handleStartAuth} size="lg" className="gap-2">
              <Github className="h-5 w-5" />
              {t('oauth.authenticateWithGitHub')}
            </Button>
          </div>
        </div>
      )}

      {/* Authenticating */}
      {status === 'authenticating' && (
        <div className="space-y-4">
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-info shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-foreground">
                    {t('oauth.authenticating')}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {browserOpened
                      ? t('oauth.completeAuthInBrowser')
                      : t('oauth.waitingForAuth')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Device Code Display */}
          {deviceCode && (
            <Card className="border border-primary/30 bg-primary/5">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {t('oauth.oneTimeCode')}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <code className="text-3xl font-mono font-bold tracking-widest text-primary px-4 py-2 bg-primary/10 rounded-lg">
                        {deviceCode}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyDeviceCode}
                        className="shrink-0"
                      >
                        {codeCopied ? (
                          <>
                            <Check className="h-4 w-4 mr-1 text-success" />
                            {t('oauth.copied')}
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            {t('oauth.copy')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>
                      {browserOpened
                        ? t('oauth.enterCodeInBrowser')
                        : t('oauth.copyCodeThenOpenLink')}
                    </p>
                    {!browserOpened && authUrl && (
                      <Button
                        variant="link"
                        onClick={handleOpenAuthUrl}
                        className="text-info hover:text-info/80 p-0 h-auto gap-1"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t('oauth.open', { url: authUrl })}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Success */}
      {status === 'success' && (
        <Card className="border border-success/30 bg-success/10">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-success">
                  {t('oauth.successfullyConnected')}
                </h3>
                <p className="text-sm text-success/80 mt-1">
                  {username ? t('oauth.connectedAs', { username }) : t('oauth.accountNowConnected')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="space-y-4">
          <Card className={`border ${isTimeout ? 'border-warning/30 bg-warning/10' : 'border-destructive/30 bg-destructive/10'}`}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                {isTimeout ? (
                  <Clock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <h3 className={`text-lg font-medium ${isTimeout ? 'text-warning' : 'text-destructive'}`}>
                    {isTimeout ? t('oauth.authenticationTimedOut') : t('oauth.authenticationFailed')}
                  </h3>
                  <p className={`text-sm mt-1 ${isTimeout ? 'text-warning/80' : 'text-destructive/80'}`}>{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fallback URL display when browser failed to open */}
          {authUrl && (
            <Card className="border border-warning/30 bg-warning/10">
              <CardContent className="p-5">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-base font-medium text-foreground">
                        {t('oauth.completeAuthManually')}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('oauth.browserFailedToOpen')}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <code className="text-sm font-mono text-foreground flex-1 break-all">
                        {authUrl}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(authUrl);
                            setUrlCopied(true);
                            // Clear any existing timeout before setting a new one
                            if (urlCopyTimeoutRef.current) {
                              clearTimeout(urlCopyTimeoutRef.current);
                            }
                            urlCopyTimeoutRef.current = setTimeout(() => setUrlCopied(false), 2000);
                          } catch (err) {
                            debugLog('Failed to copy URL:', err);
                          }
                        }}
                        className="shrink-0"
                      >
                        {urlCopied ? (
                          <>
                            <Check className="h-4 w-4 mr-1 text-success" />
                            {t('oauth.copied')}
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            {t('oauth.copy')}
                          </>
                        )}
                      </Button>
                    </div>

                    <Button
                      variant="secondary"
                      onClick={handleOpenAuthUrl}
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t('oauth.openUrlInBrowser')}
                    </Button>
                  </div>

                  {/* Device code reminder if available */}
                  {deviceCode && (
                    <div className="pt-2 border-t border-warning/20">
                      <p className="text-sm text-muted-foreground">
                        {t('oauth.whenPromptedEnterCode')}{' '}
                        <code className="font-mono font-bold text-primary px-2 py-0.5 bg-primary/10 rounded">
                          {deviceCode}
                        </code>
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-center gap-3">
            <Button onClick={handleStartAuth} variant="outline">
              {t('oauth.retry')}
            </Button>
            {onCancel && (
              <Button onClick={onCancel} variant="ghost">
                {t('oauth.cancel')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Cancel button for non-error states */}
      {status !== 'error' && status !== 'success' && onCancel && (
        <div className="flex justify-center pt-2">
          <Button onClick={onCancel} variant="ghost">
            {t('oauth.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
