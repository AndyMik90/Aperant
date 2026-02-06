import { useEffect, useCallback, useRef } from 'react';
import { useTerminalStore } from '../stores/terminal-store';
import { terminalBufferManager } from '../lib/terminal-buffer-manager';
import type { TerminalProfileChangedEvent } from '../../shared/types';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

/**
 * Hook to handle terminal profile change events.
 * When a Claude profile switches, all terminals need to be recreated with the new profile's
 * environment variables. Terminals with active Claude sessions will have their sessions
 * migrated and can be resumed with --resume {sessionId}.
 */
export function useTerminalProfileChange(): void {
  // Track terminals being recreated to prevent duplicate processing
  const recreatingTerminals = useRef<Set<string>>(new Set());

  const recreateTerminal = useCallback(async (
    terminalId: string,
    sessionId?: string,
    sessionMigrated?: boolean
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

      // If there was an active Claude session that was migrated, show a message
      // and set up for potential resume
      if (sessionId && sessionMigrated) {
        debugLog('[useTerminalProfileChange] Session migrated, ready for resume:', sessionId);
        // Store the session ID so the user can resume if desired
        store.setClaudeSessionId(newTerminal.id, sessionId);
        // Set pending resume flag - user can trigger resume from terminal tab
        store.setPendingClaudeResume(newTerminal.id, true);
        // Send a message to the terminal about the session
        window.electronAPI.sendTerminalInput(
          newTerminal.id,
          `# Profile switched. Previous Claude session available.\n# Run: claude --resume ${sessionId}\n`
        );
      }

    } finally {
      recreatingTerminals.current.delete(terminalId);
    }
  }, []);

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
          terminalInfo.sessionMigrated
        );
      }

      debugLog('[useTerminalProfileChange] All terminals recreated');
    });

    return cleanup;
  }, [recreateTerminal]);
}
