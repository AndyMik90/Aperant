import { useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from './use-toast';
import { useTerminalStore } from '../stores/terminal-store';
import { terminalBufferManager } from '../lib/terminal-buffer-manager';
import type { TerminalProfileChangedEvent } from '../../shared/types';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

/**
 * Hook to handle terminal profile change events.
 * When a Claude profile switches, all terminals need to be recreated with the new profile's
 * environment variables. Terminals with active Claude sessions will have their sessions
 * migrated and automatically resumed with --continue.
 */
export function useTerminalProfileChange(): void {
  const { t } = useTranslation(['terminal']);
  // Track terminals being recreated to prevent duplicate processing
  const recreatingTerminals = useRef<Set<string>>(new Set());

  const recreateTerminal = useCallback(async (
    terminalId: string,
    sessionId?: string,
    sessionMigrated?: boolean,
    isClaudeMode?: boolean
  ) => {
    // Prevent duplicate recreation
    if (recreatingTerminals.current.has(terminalId)) {
      debugLog('[useTerminalProfileChange] Terminal already being recreated:', terminalId);
      return;
    }

    recreatingTerminals.current.add(terminalId);

    try {
      const store = useTerminalStore.getState();
      const terminal = store.getTerminal(terminalId);

      if (!terminal) {
        debugLog('[useTerminalProfileChange] Terminal not found in store:', terminalId);
        return;
      }

      debugLog('[useTerminalProfileChange] Recreating terminal:', {
        terminalId,
        sessionId,
        sessionMigrated,
        cwd: terminal.cwd,
        projectPath: terminal.projectPath
      });

      // Save terminal state before destroying
      const terminalState = {
        cwd: terminal.cwd,
        projectPath: terminal.projectPath,
        title: terminal.title,
        worktreeConfig: terminal.worktreeConfig,
        associatedTaskId: terminal.associatedTaskId
      };

      // Clear the output buffer for this terminal
      terminalBufferManager.clear(terminalId);

      // Destroy the existing terminal (PTY process)
      await window.electronAPI.destroyTerminal(terminalId);

      // Remove from store
      store.removeTerminal(terminalId);

      // Create a new terminal with the same settings
      // The new terminal will be created with the new profile's env vars
      const newTerminal = store.addTerminal(terminalState.cwd, terminalState.projectPath);

      if (!newTerminal) {
        debugError('[useTerminalProfileChange] Failed to create new terminal');
        return;
      }

      // Restore terminal state
      store.updateTerminal(newTerminal.id, {
        title: terminalState.title,
        worktreeConfig: terminalState.worktreeConfig,
        associatedTaskId: terminalState.associatedTaskId
      });

      // Create the new PTY process
      const createResult = await window.electronAPI.createTerminal({
        id: newTerminal.id,
        cwd: terminalState.cwd,
        projectPath: terminalState.projectPath
      });

      // Set worktree config after terminal creation if it existed
      if (terminalState.worktreeConfig) {
        window.electronAPI.setTerminalWorktreeConfig(newTerminal.id, terminalState.worktreeConfig);
      }

      if (!createResult.success) {
        debugError('[useTerminalProfileChange] Failed to create PTY:', createResult.error);
        store.removeTerminal(newTerminal.id);
        return;
      }

      debugLog('[useTerminalProfileChange] Terminal recreated:', {
        oldId: terminalId,
        newId: newTerminal.id
      });

      // If there was an active Claude session that was migrated, auto-resume it
      if (sessionId && sessionMigrated) {
        debugLog('[useTerminalProfileChange] Session migrated, auto-resuming:', sessionId);
        // Store the session ID for tracking
        store.setClaudeSessionId(newTerminal.id, sessionId);

        // Auto-resume the Claude session with --continue
        // YOLO mode (dangerouslySkipPermissions) is preserved server-side by the
        // main process during migration (storeMigratedSessionFlag), so resumeClaudeAsync
        // will restore it automatically when migratedSession is true
        // Note: resumeClaudeInTerminal uses fire-and-forget IPC (ipcRenderer.send).
        // If resume fails in the main process, the error is logged but no failure event
        // is emitted back to the renderer. The terminal will show an empty shell prompt.
        window.electronAPI.resumeClaudeInTerminal(
          newTerminal.id,
          sessionId,
          { migratedSession: true }
        );
        debugLog('[useTerminalProfileChange] Resume initiated for terminal:', newTerminal.id);
      } else if (isClaudeMode && sessionId && !sessionMigrated) {
        // Session had an active Claude session but migration failed
        // Notify user that their Claude session was lost
        debugError('[useTerminalProfileChange] Session migration failed for terminal:', terminalId);
        toast({
          title: t('terminal:swap.migrationFailed'),
          variant: 'destructive',
        });
      }

    } finally {
      recreatingTerminals.current.delete(terminalId);
    }
  }, [t]);

  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalProfileChanged(async (event: TerminalProfileChangedEvent) => {
      debugLog('[useTerminalProfileChange] Profile changed event received:', {
        previousProfileId: event.previousProfileId,
        newProfileId: event.newProfileId,
        terminalsCount: event.terminals.length
      });

      // Recreate all terminals sequentially to avoid race conditions
      for (const terminalInfo of event.terminals) {
        await recreateTerminal(
          terminalInfo.id,
          terminalInfo.sessionId,
          terminalInfo.sessionMigrated,
          terminalInfo.isClaudeMode
        );
      }

      debugLog('[useTerminalProfileChange] All terminals recreated');
    });

    return cleanup;
  }, [recreateTerminal]);
}
