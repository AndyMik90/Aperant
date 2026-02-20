import { useEffect, useRef, type RefObject } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

interface UseTerminalEventsOptions {
  terminalId: string;
  // Track deliberate recreation scenarios (e.g., worktree switching)
  // When true, skips auto-removal to allow proper recreation
  isRecreatingRef?: RefObject<boolean>;
  onExit?: (exitCode: number) => void;
  onTitleChange?: (title: string) => void;
  onClaudeSession?: (sessionId: string) => void;
}

export function useTerminalEvents({
  terminalId,
  isRecreatingRef,
  onExit,
  onTitleChange,
  onClaudeSession,
}: UseTerminalEventsOptions) {
  // Use refs to always have the latest callbacks without re-registering listeners
  // This prevents duplicate listener registration when callbacks change identity
  const onExitRef = useRef(onExit);
  const onTitleChangeRef = useRef(onTitleChange);
  const onClaudeSessionRef = useRef(onClaudeSession);

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    onClaudeSessionRef.current = onClaudeSession;
  }, [onClaudeSession]);

  // Handle terminal exit
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalExit((id, exitCode) => {
      if (id === terminalId) {
        // During deliberate recreation (e.g., worktree switching), skip the normal
        // exit handling to prevent setting status to 'exited' and scheduling removal.
        // The recreation flow will handle status transitions.
        if (isRecreatingRef?.current) {
          onExitRef.current?.(exitCode);
          return;
        }

        const store = useTerminalStore.getState();
        store.setTerminalStatus(terminalId, 'exited');
        // Reset Claude mode when terminal exits - the Claude process has ended
        // setTerminalStatus('exited') already sends SHELL_EXITED to XState (which handles
        // claude_active -> exited transition), so setClaudeMode(false) here only updates Zustand
        // (its XState guard skips CLAUDE_EXITED since the machine is already in 'exited')
        const terminal = store.getTerminal(terminalId);
        if (terminal?.isClaudeMode) {
          store.setClaudeMode(terminalId, false);
        }
        onExitRef.current?.(exitCode);

        // Auto-remove exited terminals from store after a short delay
        // This prevents them from counting toward the max terminal limit
        // and ensures they don't get persisted and restored on next launch
        setTimeout(() => {
          const currentStore = useTerminalStore.getState();
          const currentTerminal = currentStore.getTerminal(terminalId);
          // Only remove if still exited (user hasn't recreated it)
          if (currentTerminal?.status === 'exited') {
            // First call destroyTerminal to clean up persisted session on disk
            // (the PTY is already dead, but this ensures session removal)
            window.electronAPI.destroyTerminal(terminalId).catch(() => {
              // Ignore errors - PTY may already be gone
            });
            currentStore.removeTerminal(terminalId);
          }
        }, 2000); // 2 second delay to show exit message
      }
    });

    return cleanup;
  }, [terminalId, isRecreatingRef]);

  // Handle terminal title change
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalTitleChange((id, title) => {
      if (id === terminalId) {
        useTerminalStore.getState().updateTerminal(terminalId, { title });
        onTitleChangeRef.current?.(title);
      }
    });

    return cleanup;
  }, [terminalId]);

  // Handle worktree config change (synced from main process during restoration)
  // This ensures the worktree label appears after terminal recovery
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalWorktreeConfigChange((id, config) => {
      if (id === terminalId) {
        useTerminalStore.getState().setWorktreeConfig(terminalId, config);
      }
    });

    return cleanup;
  }, [terminalId]);

  // Handle Claude session ID capture
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalClaudeSession((id, sessionId) => {
      if (id === terminalId) {
        const store = useTerminalStore.getState();
        store.setClaudeSessionId(terminalId, sessionId);
        // Also set Claude mode to true when we receive a session ID
        // This ensures the Claude badge shows up after auto-resume
        store.setClaudeMode(terminalId, true);
        console.warn('[Terminal] Captured Claude session ID:', sessionId);
        onClaudeSessionRef.current?.(sessionId);
      }
    });

    return cleanup;
  }, [terminalId]);

  // Handle Claude busy state changes (for visual indicator)
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalClaudeBusy((id, isBusy) => {
      if (id === terminalId) {
        useTerminalStore.getState().setClaudeBusy(terminalId, isBusy);
      }
    });

    return cleanup;
  }, [terminalId]);

  // Handle Claude exit (user closed Claude within terminal, returned to shell)
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalClaudeExit((id: string) => {
      if (id === terminalId) {
        const store = useTerminalStore.getState();
        const terminal = store.getTerminal(terminalId);
        // Guard: If terminal has already exited, don't set status back to 'running'
        // This handles the race condition where terminal exit and Claude exit events
        // arrive in unexpected order (e.g., user types 'exit' which closes both)
        if (terminal?.status === 'exited') {
          return;
        }
        // Reset Claude mode - Claude has exited but terminal is still running
        // Use setClaudeMode which properly sends CLAUDE_EXITED to the XState machine,
        // then clear residual Claude state separately
        store.setClaudeMode(terminalId, false);
        store.updateTerminal(terminalId, {
          isClaudeBusy: undefined,
          claudeSessionId: undefined,
        });
        console.warn('[Terminal] Claude exited, reset mode for terminal:', terminalId);
      }
    });

    return cleanup;
  }, [terminalId]);

  // Handle pending Claude resume notification (for deferred resume on tab activation)
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalPendingResume((id, _sessionId) => {
      if (id === terminalId) {
        useTerminalStore.getState().setPendingClaudeResume(terminalId, true);
      }
    });

    return cleanup;
  }, [terminalId]);
}
