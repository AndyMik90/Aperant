import { useEffect, useRef, useCallback, useState, type RefObject } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';
import { debugLog, debugError } from '../../../shared/utils/debug-logger';

// Maximum retry attempts for recreation when dimensions aren't ready
// Increased from 10 to 30 (3 seconds total) to handle slow app startup scenarios
// where xterm dimensions may take longer to stabilize
const MAX_RECREATION_RETRIES = 30;
// Delay between retry attempts in ms
const RECREATION_RETRY_DELAY = 100;

interface UsePtyProcessOptions {
  terminalId: string;
  cwd?: string;
  projectPath?: string;
  cols: number;
  rows: number;
  skipCreation?: boolean; // Skip PTY creation until dimensions are ready
  // Track deliberate recreation scenarios (e.g., worktree switching)
  // When true, resets terminal status to 'idle' to allow proper recreation
  isRecreatingRef?: RefObject<boolean>;
  onCreated?: () => void;
  onError?: (error: string) => void;
}

export function usePtyProcess({
  terminalId,
  cwd,
  projectPath,
  cols,
  rows,
  skipCreation = false,
  isRecreatingRef,
  onCreated,
  onError,
}: UsePtyProcessOptions) {
  const isCreatingRef = useRef(false);
  const isCreatedRef = useRef(false);
  const currentCwdRef = useRef(cwd);
  // Trigger state to force re-creation after resetForRecreate()
  // Refs don't trigger re-renders, so we need a state to ensure the effect runs
  const [_recreationTrigger, setRecreationTrigger] = useState(0);
  // Track retry attempts during recreation when dimensions aren't ready
  const recreationRetryCountRef = useRef(0);
  const recreationRetryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use getState() pattern for store actions to avoid React Fast Refresh issues
  // The selectors like useTerminalStore((state) => state.setTerminalStatus) can fail
  // during HMR with "Should have a queue" errors. Using getState() in callbacks
  // avoids this by not relying on React's hook queue mechanism.
  const getStore = useCallback(() => useTerminalStore.getState(), []);

  // Helper to clear any pending retry timer
  const clearRetryTimer = useCallback(() => {
    if (recreationRetryTimerRef.current) {
      clearTimeout(recreationRetryTimerRef.current);
      recreationRetryTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule a retry or fail with error.
   * Returns true if a retry was scheduled, false if max retries exceeded or not recreating.
   * When scheduling a retry, isCreatingRef remains true to prevent duplicate creation attempts.
   */
  const scheduleRetryOrFail = useCallback((error: string): boolean => {
    if (isRecreatingRef?.current && recreationRetryCountRef.current < MAX_RECREATION_RETRIES) {
      recreationRetryCountRef.current += 1;
      // Clear any existing timer before setting a new one
      clearRetryTimer();
      recreationRetryTimerRef.current = setTimeout(() => {
        setRecreationTrigger((prev) => prev + 1);
      }, RECREATION_RETRY_DELAY);
      // Keep isCreatingRef.current = true to prevent duplicate creation during retry window
      return true;
    }
    // Not recreating or max retries exceeded - clear state and report error
    if (isRecreatingRef?.current) {
      isRecreatingRef.current = false;
    }
    recreationRetryCountRef.current = 0;
    isCreatingRef.current = false;
    onError?.(error);
    return false;
  }, [isRecreatingRef, onError, clearRetryTimer]);

  // Cleanup retry timer on unmount
  useEffect(() => {
    return () => {
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  // Track cwd changes - if cwd changes while terminal exists, trigger recreate
  useEffect(() => {
    if (currentCwdRef.current !== cwd) {
      // Only reset if we're not already in a controlled recreation process.
      // prepareForRecreate() sets isCreatingRef=true to prevent auto-recreation
      // while awaiting destroyTerminal(). Without this check, we'd reset isCreatingRef
      // back to false before destroyTerminal completes, causing a race condition
      // where a new PTY is created before the old one is destroyed.
      if (isCreatedRef.current && !isCreatingRef.current) {
        // Terminal exists and we're not in a controlled recreation, reset refs
        isCreatedRef.current = false;
      }
      currentCwdRef.current = cwd;
    }
  }, [cwd]);

  // Create PTY process
  // recreationTrigger is included to force the effect to run after resetForRecreate()
  // since refs don't trigger re-renders
  useEffect(() => {
    // Clear any pending retry timer at the START of the effect to prevent
    // race conditions when dependencies change before timer fires
    clearRetryTimer();

    // During recreation, if dimensions aren't ready, schedule a retry instead of giving up
    if (skipCreation && isRecreatingRef?.current) {
      debugLog(`[usePtyProcess] Skipping PTY creation for terminal: ${terminalId} - dimensions not ready during recreation, scheduling retry`);
      scheduleRetryOrFail('Terminal recreation failed: dimensions not ready');
      return;
    }

    // Normal skip (not during recreation) - just return
    if (skipCreation) {
      debugLog(`[usePtyProcess] Skipping PTY creation for terminal: ${terminalId} - dimensions not ready (skipCreation=true)`);
      return;
    }
    if (isCreatingRef.current || isCreatedRef.current) {
      debugLog(`[usePtyProcess] Skipping PTY creation for terminal: ${terminalId} - already creating: ${isCreatingRef.current}, already created: ${isCreatedRef.current}`);
      return;
    }

    // Clear retry counter since we're proceeding with creation
    recreationRetryCountRef.current = 0;

    const store = getStore();
    const terminalState = store.terminals.find((t) => t.id === terminalId);
    const alreadyRunning = terminalState?.status === 'running' || terminalState?.status === 'claude-active';
    const isRestored = terminalState?.isRestored;

    debugLog(`[usePtyProcess] Starting PTY creation for terminal: ${terminalId}`);
    debugLog(`[usePtyProcess] Terminal ${terminalId} state: isRestored=${isRestored}, status=${terminalState?.status}`);
    debugLog(`[usePtyProcess] Terminal ${terminalId} dimensions for PTY: cols=${cols}, rows=${rows}`);

    // When recreating (e.g., worktree switching), reset status from 'exited' to 'idle'
    // This allows proper recreation after deliberate terminal destruction
    if (isRecreatingRef?.current && terminalState?.status === 'exited') {
      store.setTerminalStatus(terminalId, 'idle');
    }

    isCreatingRef.current = true;

    // Helper to handle successful creation
    const handleSuccess = () => {
      isCreatedRef.current = true;
      if (isRecreatingRef?.current) {
        isRecreatingRef.current = false;
      }
      recreationRetryCountRef.current = 0;
      isCreatingRef.current = false;
    };

    // Helper to handle error - returns true if retry was scheduled
    const handleError = (error: string): boolean => {
      const retrying = scheduleRetryOrFail(error);
      // Only clear isCreatingRef if not retrying (scheduleRetryOrFail handles this)
      // When retrying, keep isCreatingRef true to prevent duplicate creation
      return retrying;
    };

    if (isRestored && terminalState) {
      // Restored session
      debugLog(`[usePtyProcess] Restoring session for terminal: ${terminalId}, cwd: ${terminalState.cwd}, isClaudeMode: ${terminalState.isClaudeMode}, claudeSessionId: ${terminalState.claudeSessionId || 'none'}`);
      window.electronAPI.restoreTerminalSession(
        {
          id: terminalState.id,
          title: terminalState.title,
          cwd: terminalState.cwd,
          projectPath: projectPath || '',
          isClaudeMode: terminalState.isClaudeMode,
          claudeSessionId: terminalState.claudeSessionId,
          outputBuffer: '',
          createdAt: terminalState.createdAt.toISOString(),
          lastActiveAt: new Date().toISOString(),
          // Pass worktreeConfig so backend can restore it and persist correctly
          worktreeConfig: terminalState.worktreeConfig,
        },
        cols,
        rows
      ).then((result) => {
        if (result.success && result.data?.success) {
          debugLog(`[usePtyProcess] Successfully restored PTY session for terminal: ${terminalId}`);
          handleSuccess();
          const store = getStore();
          store.setTerminalStatus(terminalId, terminalState.isClaudeMode ? 'claude-active' : 'running');
          store.updateTerminal(terminalId, { isRestored: false });
          onCreated?.();
        } else {
          const errorMsg = `Error restoring session: ${result.data?.error || result.error}`;
          debugError(`[usePtyProcess] Failed to restore PTY session for terminal: ${terminalId}, error: ${errorMsg}`);
          handleError(errorMsg);
        }
      }).catch((err) => {
        debugError(`[usePtyProcess] Exception restoring PTY session for terminal: ${terminalId}, error:`, err);
        handleError(err.message);
      });
    } else {
      // New terminal
      debugLog(`[usePtyProcess] Creating new PTY for terminal: ${terminalId}, cwd: ${cwd}, projectPath: ${projectPath}`);
      window.electronAPI.createTerminal({
        id: terminalId,
        cwd,
        cols,
        rows,
        projectPath,
      }).then((result) => {
        if (result.success) {
          debugLog(`[usePtyProcess] Successfully created PTY for terminal: ${terminalId}`);
          handleSuccess();
          if (!alreadyRunning) {
            getStore().setTerminalStatus(terminalId, 'running');
          }
          onCreated?.();
        } else {
          const errorMsg = result.error || 'Unknown error';
          debugError(`[usePtyProcess] Failed to create PTY for terminal: ${terminalId}, error: ${errorMsg}`);
          handleError(errorMsg);
        }
      }).catch((err) => {
        debugError(`[usePtyProcess] Exception creating PTY for terminal: ${terminalId}, error:`, err);
        handleError(err.message);
      });
    }

  }, [terminalId, cwd, projectPath, cols, rows, skipCreation, getStore, onCreated, clearRetryTimer, scheduleRetryOrFail, isRecreatingRef]);

  // Function to prepare for recreation by preventing the effect from running
  // Call this BEFORE updating the store cwd to avoid race condition
  const prepareForRecreate = useCallback(() => {
    isCreatingRef.current = true;
  }, []);

  // Function to reset refs and allow recreation
  // Call this AFTER destroying the old terminal
  // Increments recreationTrigger to force the effect to run since refs don't trigger re-renders
  const resetForRecreate = useCallback(() => {
    isCreatedRef.current = false;
    isCreatingRef.current = false;
    // Increment trigger to force the creation effect to run
    setRecreationTrigger((prev) => prev + 1);
  }, []);

  return {
    isCreated: isCreatedRef.current,
    prepareForRecreate,
    resetForRecreate,
  };
}
