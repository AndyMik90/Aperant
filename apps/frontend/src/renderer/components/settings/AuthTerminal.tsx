import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

// Debug logging - only active when DEBUG=true (npm run dev:debug)
const DEBUG = typeof process !== 'undefined' && process.env?.DEBUG === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG) console.warn('[AuthTerminal:DEBUG]', ...args);
};

interface AuthTerminalProps {
  /** Terminal ID for this auth session */
  terminalId: string;
  /** Claude config directory for this profile (CLAUDE_CONFIG_DIR) */
  configDir: string;
  /** Profile name being authenticated */
  profileName: string;
  /** Callback when terminal is closed */
  onClose: () => void;
  /** Callback when authentication succeeds */
  onAuthSuccess?: (email?: string) => void;
  /** Callback when authentication fails */
  onAuthError?: (error: string) => void;
}

/**
 * Embedded terminal component for Claude profile authentication.
 * Shows a minimal terminal where users can run /login to authenticate.
 * Automatically detects OAuth token capture via TERMINAL_OAUTH_TOKEN event.
 */
export function AuthTerminal({
  terminalId,
  configDir,
  profileName,
  onClose,
  onAuthSuccess,
  onAuthError,
}: AuthTerminalProps) {
  const { t } = useTranslation('common');
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isCreatedRef = useRef(false);
  const cleanupFnsRef = useRef<(() => void)[]>([]);
  const loginSentRef = useRef(false); // Track if /login was already sent
  const loginTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track setTimeout for cleanup
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track success auto-close timeout for cleanup
  const authCompletedRef = useRef(false); // Track if auth has already completed to prevent race conditions

  const [status, setStatus] = useState<'connecting' | 'ready' | 'onboarding' | 'success' | 'error'>('connecting');
  const [authEmail, setAuthEmail] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  // Refs to track current status/email for exit handler closure
  const statusRef = useRef(status);
  const authEmailRef = useRef(authEmail);
  statusRef.current = status;
  authEmailRef.current = authEmail;

  debugLog('Component render', { terminalId, status, isCreated: isCreatedRef.current, loginSent: loginSentRef.current });

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const xterm = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: 'hsl(var(--card))',
        foreground: 'hsl(var(--card-foreground))',
        cursor: 'hsl(var(--primary))',
        selectionBackground: 'hsl(var(--accent))',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(terminalRef.current);

    // Initial fit
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors
      }
    }, 100);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    return () => {
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Create the PTY terminal
  useEffect(() => {
    if (!xtermRef.current || isCreatedRef.current) return;

    const createTerminal = async () => {
      const xterm = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (!xterm || !fitAddon) return;

      try {
        // Fit to get proper dimensions
        fitAddon.fit();
        const cols = xterm.cols;
        const rows = xterm.rows;

        console.warn('[AuthTerminal] Creating terminal:', terminalId, { cols, rows, configDir });

        // Create terminal with CLAUDE_CONFIG_DIR set for this profile
        // The terminal ID pattern (claude-login-{profileId}-*) tells the
        // integration handler which profile to save captured tokens to
        const result = await window.electronAPI.createTerminal({
          id: terminalId,
          cols,
          rows,
          skipOAuthToken: true, // Don't inject existing token for auth terminals
          env: {
            CLAUDE_CONFIG_DIR: configDir,
          },
        });

        if (!result.success) {
          console.error('[AuthTerminal] Failed to create terminal:', result.error);
          setStatus('error');
          const errorMsg = result.error || t('authTerminal.failedToCreate');
          setErrorMessage(errorMsg);
          onAuthError?.(errorMsg);
          return;
        }

        isCreatedRef.current = true;
        setStatus('ready');

        // Show instructions
        const titleText = t('authTerminal.instructionTitle');
        const step1Text = t('authTerminal.step1');
        const step2Text = t('authTerminal.step2');
        const step3Text = t('authTerminal.step3');

        xterm.writeln('\x1b[1;36m╔════════════════════════════════════════════════════════════╗\x1b[0m');
        xterm.writeln(`\x1b[1;36m║\x1b[0m   \x1b[1m${titleText}\x1b[0m${' '.repeat(Math.max(0, 60 - titleText.length - 3))}\x1b[1;36m║\x1b[0m`);
        xterm.writeln('\x1b[1;36m╠════════════════════════════════════════════════════════════╣\x1b[0m');
        xterm.writeln('\x1b[1;36m║\x1b[0m                                                            \x1b[1;36m║\x1b[0m');
        xterm.writeln(`\x1b[1;36m║\x1b[0m   \x1b[33m1.\x1b[0m ${step1Text}${' '.repeat(Math.max(0, 60 - step1Text.length - 6))}\x1b[1;36m║\x1b[0m`);
        xterm.writeln(`\x1b[1;36m║\x1b[0m   \x1b[33m2.\x1b[0m ${step2Text}${' '.repeat(Math.max(0, 60 - step2Text.length - 6))}\x1b[1;36m║\x1b[0m`);
        xterm.writeln(`\x1b[1;36m║\x1b[0m   \x1b[33m3.\x1b[0m ${step3Text}${' '.repeat(Math.max(0, 60 - step3Text.length - 6))}\x1b[1;36m║\x1b[0m`);
        xterm.writeln('\x1b[1;36m║\x1b[0m                                                            \x1b[1;36m║\x1b[0m');
        xterm.writeln('\x1b[1;36m╚════════════════════════════════════════════════════════════╝\x1b[0m');
        xterm.writeln('');

        // Pre-fill the terminal with 'claude /login' command
        // Wait a moment for the shell prompt to be ready, then send the command
        // (without carriage return so user must press Enter)
        // Guard: only send once per component lifecycle
        if (!loginSentRef.current) {
          debugLog('Scheduling /login pre-fill', { terminalId, delay: 500 });
          loginTimeoutRef.current = setTimeout(() => {
            // Double-check guard in case of race conditions
            if (!loginSentRef.current) {
              loginSentRef.current = true;
              debugLog('Sending /login pre-fill NOW', { terminalId });
              window.electronAPI.sendTerminalInput(terminalId, 'claude /login');
            } else {
              debugLog('SKIPPED /login pre-fill (already sent)', { terminalId });
            }
          }, 500);
        } else {
          debugLog('SKIPPED scheduling /login pre-fill (already sent)', { terminalId });
        }

        console.warn('[AuthTerminal] Terminal created successfully');
      } catch (error) {
        console.error('[AuthTerminal] Error creating terminal:', error);
        setStatus('error');
        const errorMsg = error instanceof Error ? error.message : t('authTerminal.unknownError');
        setErrorMessage(errorMsg);
        onAuthError?.(errorMsg);
      }
    };

    createTerminal();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- configDir is stable for auth terminal lifecycle
  }, [terminalId, onAuthError, configDir, t]);

  // Setup terminal event listeners
  useEffect(() => {
    debugLog('Setting up event listeners effect', { terminalId, hasXterm: !!xtermRef.current });
    if (!xtermRef.current) return;

    const xterm = xtermRef.current;

    // Handle terminal output
    const unsubOutput = window.electronAPI.onTerminalOutput((id, data) => {
      if (id === terminalId && xterm) {
        xterm.write(data);
      }
    });
    cleanupFnsRef.current.push(unsubOutput);

    // Handle terminal input - log user keystrokes for debugging
    const inputDisposable = xterm.onData((data) => {
      // Log Enter key presses and significant input
      if (data === '\r' || data === '\n') {
        debugLog('User pressed ENTER', { terminalId, status: statusRef.current });
      } else if (data.length > 1) {
        debugLog('User input (paste or special)', { terminalId, dataLength: data.length });
      }
      window.electronAPI.sendTerminalInput(terminalId, data);
    });

    // Handle OAuth token capture
    const unsubOAuth = window.electronAPI.onTerminalOAuthToken((info) => {
      console.warn('[AuthTerminal] OAuth token event:', info);
      debugLog('OAuth token event received', {
        terminalId: info.terminalId,
        thisTerminalId: terminalId,
        isMatch: info.terminalId === terminalId,
        success: info.success,
        needsOnboarding: info.needsOnboarding,
        email: info.email,
        currentStatus: statusRef.current,
        loginSent: loginSentRef.current
      });
      if (info.terminalId === terminalId) {
        if (info.success) {
          setAuthEmail(info.email);
          // If needsOnboarding is true, user should complete setup in terminal
          // Otherwise, authentication is fully complete
          if (info.needsOnboarding) {
            debugLog('Setting status to onboarding', { terminalId });
            setStatus('onboarding');
          } else {
            debugLog('Setting status to success (no onboarding needed)', { terminalId });
            setStatus('success');
            onAuthSuccess?.(info.email);
          }
        } else {
          debugLog('OAuth failed', { terminalId, message: info.message });
          setStatus('error');
          const errorMsg = info.message || t('authTerminal.authFailed');
          setErrorMessage(errorMsg);
          onAuthError?.(errorMsg);
        }
      }
    });
    cleanupFnsRef.current.push(unsubOAuth);

    // Handle terminal exit
    const unsubExit = window.electronAPI.onTerminalExit((id, exitCode) => {
      if (id === terminalId) {
        console.warn('[AuthTerminal] Terminal exited:', exitCode, 'status:', statusRef.current);
        debugLog('Terminal exit event', {
          terminalId,
          exitCode,
          currentStatus: statusRef.current,
          loginSent: loginSentRef.current,
          willTransitionToSuccess: statusRef.current === 'onboarding' && exitCode === 0
        });
        // If we were in onboarding status and terminal exits with code 0,
        // that means the user completed the onboarding successfully
        if (statusRef.current === 'onboarding' && exitCode === 0) {
          // Prevent race condition with onboarding-complete handler
          if (authCompletedRef.current) {
            debugLog('SKIPPED exit handler - auth already completed', { terminalId });
            return;
          }
          authCompletedRef.current = true;
          debugLog('Transitioning from onboarding to success', { terminalId });
          setStatus('success');
          onAuthSuccess?.(authEmailRef.current);
        }
        // Don't close automatically - let user see any error messages
      }
    });
    cleanupFnsRef.current.push(unsubExit);

    // Handle onboarding complete (Claude shows ready state after login)
    const unsubOnboardingComplete = window.electronAPI.onTerminalOnboardingComplete((info) => {
      if (info.terminalId === terminalId) {
        console.warn('[AuthTerminal] Onboarding complete:', info);
        debugLog('Onboarding complete event', {
          terminalId: info.terminalId,
          profileId: info.profileId,
          currentStatus: statusRef.current
        });
        // Only process if we're in onboarding status
        if (statusRef.current === 'onboarding') {
          // Prevent race condition with terminal exit handler
          if (authCompletedRef.current) {
            debugLog('SKIPPED onboarding-complete handler - auth already completed', { terminalId });
            return;
          }
          authCompletedRef.current = true;
          debugLog('Auto-closing terminal after onboarding complete', { terminalId });
          setStatus('success');
          onAuthSuccess?.(authEmailRef.current);
          // Auto-close after a brief delay to show success UI
          successTimeoutRef.current = setTimeout(() => {
            if (isCreatedRef.current) {
              window.electronAPI.destroyTerminal(terminalId).catch(console.error);
              isCreatedRef.current = false;
            }
            onClose();
          }, 1500);
        }
      }
    });
    cleanupFnsRef.current.push(unsubOnboardingComplete);

    return () => {
      debugLog('Cleaning up event listeners', { terminalId });
      inputDisposable.dispose();
      cleanupFnsRef.current.forEach(fn => fn());
      cleanupFnsRef.current = [];
    };
  }, [terminalId, onAuthSuccess, onAuthError, onClose, t]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          const cols = xtermRef.current.cols;
          const rows = xtermRef.current.rows;
          window.electronAPI.resizeTerminal(terminalId, cols, rows);
        } catch {
          // Ignore resize errors
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial resize after a brief delay
    const timer = setTimeout(handleResize, 200);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [terminalId]);

  // Cleanup terminal on unmount
  useEffect(() => {
    return () => {
      debugLog('Component unmounting', {
        terminalId,
        isCreated: isCreatedRef.current,
        loginSent: loginSentRef.current,
        hasLoginTimeout: !!loginTimeoutRef.current,
        hasSuccessTimeout: !!successTimeoutRef.current
      });
      // Clear pending login timeout if component unmounts before it fires
      if (loginTimeoutRef.current) {
        debugLog('Clearing pending login timeout', { terminalId });
        clearTimeout(loginTimeoutRef.current);
        loginTimeoutRef.current = null;
      }
      // Clear pending success timeout if component unmounts before it fires
      if (successTimeoutRef.current) {
        debugLog('Clearing pending success timeout', { terminalId });
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
      if (isCreatedRef.current) {
        debugLog('Destroying terminal', { terminalId });
        window.electronAPI.destroyTerminal(terminalId).catch(console.error);
      }
    };
  }, [terminalId]);

  const handleClose = useCallback(() => {
    if (isCreatedRef.current) {
      window.electronAPI.destroyTerminal(terminalId).catch(console.error);
      isCreatedRef.current = false;
    }
    onClose();
  }, [terminalId, onClose]);

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          {status === 'connecting' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {status === 'ready' && (
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
          )}
          {status === 'onboarding' && (
            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          )}
          {status === 'success' && (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          {status === 'error' && (
            <AlertCircle className="h-4 w-4 text-destructive" />
          )}
          <span className="text-sm font-medium">
            {status === 'connecting' && t('authTerminal.connecting')}
            {status === 'ready' && t('authTerminal.authenticate', { profileName })}
            {status === 'onboarding' && t('authTerminal.completeSetup', { profileName })}
            {status === 'success' && (authEmail ? t('authTerminal.authenticatedAs', { email: authEmail }) : t('authTerminal.authenticated'))}
            {status === 'error' && t('authTerminal.authError')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Terminal area */}
      <div
        ref={terminalRef}
        className={cn(
          "flex-1 min-h-[200px]",
          status === 'success' && "opacity-50"
        )}
        style={{ padding: '8px' }}
      />

      {/* Status bar */}
      {status === 'onboarding' && (
        <div className="px-3 py-2 border-t border-border bg-blue-500/10">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            {t('authTerminal.onboardingMessage')}
          </p>
        </div>
      )}
      {status === 'success' && (
        <div className="px-3 py-2 border-t border-border bg-success/10">
          <p className="text-sm text-success">
            {t('authTerminal.successMessage')}
          </p>
        </div>
      )}
      {status === 'error' && errorMessage && (
        <div className="px-3 py-2 border-t border-border bg-destructive/10">
          <p className="text-sm text-destructive">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
