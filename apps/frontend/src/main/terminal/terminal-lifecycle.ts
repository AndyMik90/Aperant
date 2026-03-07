/**
 * Terminal Lifecycle
 * Handles terminal creation, restoration, and destruction operations
 */

import * as os from 'os';
import { existsSync } from 'fs';
import type { TerminalCreateOptions } from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/constants';
import type { TerminalSession } from '../terminal-session-store';
import * as PtyManager from './pty-manager';
import * as SessionHandler from './session-handler';
import type {
  TerminalProcess,
  WindowGetter,
  TerminalOperationResult
} from './types';
import { isWindows } from '../platform';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import { safeSendToRenderer } from '../ipc-handlers/utils';
import { getClaudeCodeEnv } from '../claude-code-settings';

/**
 * Options for terminal restoration
 */
export interface RestoreOptions {
  resumeClaudeSession: boolean;
  captureSessionId: (terminalId: string, projectPath: string, startTime: number) => void;
  /** Callback triggered when a Claude session needs to be resumed.
   * Note: sessionId is deprecated and ignored - resumeClaude uses --continue */
  onResumeNeeded?: (terminalId: string, sessionId: string | undefined) => void;
}

/**
 * Data handler function type
 */
export type DataHandlerFn = (terminal: TerminalProcess, data: string) => void;

/**
 * Create a new terminal process
 */
export async function createTerminal(
  options: TerminalCreateOptions & { projectPath?: string },
  terminals: Map<string, TerminalProcess>,
  getWindow: WindowGetter,
  dataHandler: DataHandlerFn
): Promise<TerminalOperationResult> {
  const { id, cwd, cols = 80, rows = 24, projectPath, skipOAuthToken, env: customEnv } = options;

  debugLog('[TerminalLifecycle] Creating terminal:', { id, cwd, cols, rows, projectPath, skipOAuthToken, hasCustomEnv: !!customEnv });

  if (terminals.has(id)) {
    debugLog('[TerminalLifecycle] Terminal already exists, returning success:', id);
    return { success: true };
  }

  // Clear any pendingDelete for this terminal ID. This handles the case where
  // a terminal is destroyed and immediately re-created with the same ID (e.g.,
  // worktree switching, terminal restart after shell exit). Without this, the
  // pendingDelete guard (5-second window) blocks session persistence for the
  // new terminal, causing it to be invisible to the session store.
  SessionHandler.clearPendingDelete(id);

  try {
    // For auth terminals, don't inject existing OAuth token - we want a fresh login
    const profileEnv = skipOAuthToken ? {} : PtyManager.getActiveProfileEnv();

    // Read env vars from Claude Code CLI settings files (.claude/settings.json hierarchy)
    const claudeCodeEnv = getClaudeCodeEnv(projectPath);
    if (Object.keys(claudeCodeEnv).length > 0) {
      debugLog('[TerminalLifecycle] Injecting Claude Code settings env vars:', Object.keys(claudeCodeEnv));
    }

    // Merge environment variables (lowest to highest precedence):
    // 1. Claude Code settings env (from settings.json hierarchy)
    // 2. Profile env (CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN)
    // 3. Custom env from TerminalCreateOptions
    const mergedEnv = { ...claudeCodeEnv, ...profileEnv, ...(customEnv || {}) };

    if (mergedEnv.CLAUDE_CODE_OAUTH_TOKEN) {
      debugLog('[TerminalLifecycle] Injecting OAuth token from active profile');
    } else if (skipOAuthToken) {
      debugLog('[TerminalLifecycle] Skipping OAuth token injection (auth terminal)');
    }
    if (mergedEnv.CLAUDE_CONFIG_DIR) {
      debugLog('[TerminalLifecycle] Setting CLAUDE_CONFIG_DIR:', mergedEnv.CLAUDE_CONFIG_DIR);
    }

    // Validate cwd exists - if the directory doesn't exist (e.g., worktree removed),
    // fall back to project path to prevent shell exit with code 1
    let effectiveCwd = cwd;
    if (cwd && !existsSync(cwd)) {
      debugLog('[TerminalLifecycle] Terminal cwd does not exist, falling back:', cwd, '->', projectPath || os.homedir());
      effectiveCwd = projectPath || os.homedir();
    }

    const { pty: ptyProcess, shellType } = PtyManager.spawnPtyProcess(
      effectiveCwd || os.homedir(),
      cols,
      rows,
      mergedEnv
    );

    debugLog('[TerminalLifecycle] PTY process spawned, pid:', ptyProcess.pid, 'shellType:', shellType);

    const terminalCwd = effectiveCwd || os.homedir();
    const terminal: TerminalProcess = {
      id,
      pty: ptyProcess,
      isClaudeMode: false,
      hasExited: false,
      projectPath,
      cwd: terminalCwd,
      outputBuffer: '',
      title: `Terminal ${terminals.size + 1}`,
      shellType
    };

    terminals.set(id, terminal);

    PtyManager.setupPtyHandlers(
      terminal,
      terminals,
      getWindow,
      (term, data) => dataHandler(term, data),
      (term) => handleTerminalExit(term, terminals)
    );

    if (projectPath) {
      SessionHandler.persistSessionAsync(terminal);
    }

    debugLog('[TerminalLifecycle] Terminal created successfully:', id);
    return { success: true };
  } catch (error) {
    debugError('[TerminalLifecycle] Error creating terminal:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create terminal',
    };
  }
}

/**
 * Restore a terminal session
 */
export async function restoreTerminal(
  session: TerminalSession,
  terminals: Map<string, TerminalProcess>,
  getWindow: WindowGetter,
  dataHandler: DataHandlerFn,
  options: RestoreOptions,
  cols = 80,
  rows = 24
): Promise<TerminalOperationResult> {
  // Look up the stored session to get the correct isClaudeMode value
  // The renderer may pass isClaudeMode: false (by design), but we need the stored value
  // to determine whether to auto-resume Claude
  const storedSessions = SessionHandler.getSavedSessions(session.projectPath);
  const storedSession = storedSessions.find(s => s.id === session.id);
  const storedIsClaudeMode = storedSession?.isClaudeMode ?? session.isClaudeMode;
  const storedClaudeSessionId = storedSession?.claudeSessionId ?? session.claudeSessionId;
  // Get worktreeConfig from stored session (authoritative) since renderer-passed value may be stale
  const storedWorktreeConfig = storedSession?.worktreeConfig ?? session.worktreeConfig;

  debugLog('[TerminalLifecycle] Restoring terminal session:', session.id,
    'Passed Claude mode:', session.isClaudeMode,
    'Stored Claude mode:', storedIsClaudeMode,
    'Stored session ID:', storedClaudeSessionId);

  // Debug: Log outputBuffer info from both passed and stored session
  const passedBufferLen = session.outputBuffer?.length ?? 0;
  const storedBufferLen = storedSession?.outputBuffer?.length ?? 0;
  debugLog('[TerminalLifecycle] OutputBuffer info - passed session:', passedBufferLen, 'bytes, stored session:', storedBufferLen, 'bytes');

  // Validate cwd exists - if the directory was deleted (e.g., worktree removed),
  // fall back to project path to prevent shell exit with code 1
  let effectiveCwd = session.cwd;
  if (!existsSync(session.cwd)) {
    debugLog('[TerminalLifecycle] Session cwd does not exist, falling back to project path:', session.cwd, '->', session.projectPath);
    effectiveCwd = session.projectPath || os.homedir();
  }

  const result = await createTerminal(
    {
      id: session.id,
      cwd: effectiveCwd,
      cols,
      rows,
      projectPath: session.projectPath
    },
    terminals,
    getWindow,
    dataHandler
  );

  if (!result.success) {
    return result;
  }

  const terminal = terminals.get(session.id);
  if (!terminal) {
    return { success: false, error: 'Terminal not found after creation' };
  }

  // Restore title and worktree config from session
  terminal.title = session.title;
  // Only restore worktree config if the worktree directory still exists
  // (effectiveCwd matching session.cwd means no fallback was needed)
  // Use storedWorktreeConfig (from disk) as the authoritative source
  if (effectiveCwd === session.cwd) {
    terminal.worktreeConfig = storedWorktreeConfig;
  } else {
    // Worktree was deleted, clear the config and update terminal's cwd
    terminal.worktreeConfig = undefined;
    terminal.cwd = effectiveCwd;
    debugLog('[TerminalLifecycle] Cleared worktree config for terminal with deleted worktree:', session.id);
  }

  // Re-persist after restoring title and worktreeConfig
  // (createTerminal persists before these are set, so we need to persist again)
  if (terminal.projectPath) {
    SessionHandler.persistSessionAsync(terminal);
  }

  // Send title change event for all restored terminals so renderer updates
  // Use safeSendToRenderer with isDestroyed() check to prevent crashes
  safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_TITLE_CHANGE, session.id, session.title);
  // Always sync worktreeConfig to renderer (even if undefined) to ensure correct state
  // This handles both: showing labels after recovery AND clearing stale labels when worktrees are deleted
  safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_WORKTREE_CONFIG_CHANGE, session.id, terminal.worktreeConfig);

  // Defer Claude resume until terminal becomes active (is viewed by user)
  // This prevents all terminals from resuming Claude simultaneously on app startup,
  // which can cause crashes and resource contention.
  //
  // Use storedIsClaudeMode which comes from the persisted store,
  // not the renderer-passed values (renderer always passes isClaudeMode: false)
  if (options.resumeClaudeSession && storedIsClaudeMode) {
    // Set Claude mode so it persists correctly across app restarts
    // Without this, storedIsClaudeMode would be false on next restore
    terminal.claudeSessionId = storedClaudeSessionId;
    terminal.isClaudeMode = true;
    // Mark terminal as having a pending Claude resume
    // The actual resume will be triggered when the terminal becomes active
    terminal.pendingClaudeResume = true;
    debugLog('[TerminalLifecycle] Marking terminal for deferred Claude resume:', terminal.id);

    // Notify renderer that this terminal has a pending Claude resume
    // The renderer will trigger the resume when the terminal tab becomes active
    // Use safeSendToRenderer with isDestroyed() check to prevent crashes
    safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_PENDING_RESUME, terminal.id, storedClaudeSessionId);

    // Persist the Claude mode and pending resume state
    if (terminal.projectPath) {
      SessionHandler.persistSessionAsync(terminal);
    }
  }

  // Debug: Log the outputBuffer being returned for replay
  const returnBufferLen = session.outputBuffer?.length ?? 0;
  debugLog('[TerminalLifecycle] Returning outputBuffer for terminal:', session.id,
    'length:', returnBufferLen, 'bytes',
    'hasContent:', returnBufferLen > 0);

  return {
    success: true,
    outputBuffer: session.outputBuffer
  };
}

/**
 * Destroy a terminal process.
 * On Windows, waits for the PTY to actually exit before returning to prevent
 * race conditions when recreating terminals (e.g., worktree switching).
 */
export async function destroyTerminal(
  id: string,
  terminals: Map<string, TerminalProcess>,
  onCleanup: (terminalId: string) => void
): Promise<TerminalOperationResult> {
  const terminal = terminals.get(id);
  if (!terminal) {
    return { success: false, error: 'Terminal not found' };
  }

  try {
    SessionHandler.removePersistedSession(terminal);
    // Release any claimed session ID for this terminal
    SessionHandler.releaseSessionId(id);
    onCleanup(id);

    // Delete from map BEFORE killing to prevent race with onExit handler
    terminals.delete(id);

    // On Windows, wait for PTY to actually exit before returning
    // This prevents race conditions when recreating terminals
    if (isWindows()) {
      await PtyManager.killPty(terminal, true);
    } else {
      PtyManager.killPty(terminal);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to destroy terminal',
    };
  }
}

/**
 * Global timeout for destroyAllTerminals to prevent shutdown from hanging (ms).
 */
const DESTROY_ALL_TIMEOUT = 3000;

/**
 * Kill all terminal processes.
 * Sets the shutdown flag first to prevent PTY handlers from accessing destroyed
 * resources, then waits for all PTY processes to exit (with a global timeout).
 *
 * This is the core fix for GitHub issue #1469: by setting the shutdown flag and
 * awaiting PTY exit before returning, we ensure pty.node's native callbacks
 * don't fire after the JS environment tears down (which causes SIGABRT).
 */
export async function destroyAllTerminals(
  terminals: Map<string, TerminalProcess>,
  saveTimer: NodeJS.Timeout | null
): Promise<NodeJS.Timeout | null> {
  // Set shutdown flag first — prevents PTY onData/onExit from accessing
  // destroyed BrowserWindow.webContents (GitHub #1469 shutdown guard pattern)
  PtyManager.setShuttingDown(true);

  await SessionHandler.persistAllSessionsAsync(terminals);

  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  // Kill all terminals and wait for PTY exit to avoid pty.node SIGABRT on shutdown (GitHub #1469)
  const killPromises: Promise<void>[] = [];

  terminals.forEach((terminal) => {
    killPromises.push(
      PtyManager.killPty(terminal, true).catch((error) => {
        console.warn('[TerminalLifecycle] Error during PTY cleanup:', error);
      })
    );
  });

  // Wait for all PTY processes to exit, but cap with a global timeout
  // so shutdown never hangs indefinitely
  await Promise.race([
    Promise.all(killPromises),
    new Promise<void>((resolve) => setTimeout(resolve, DESTROY_ALL_TIMEOUT))
  ]);

  terminals.clear();

  return saveTimer;
}

/**
 * Handle terminal exit event
 * Note: We don't remove sessions here because terminal exit might be due to app shutdown.
 * Sessions are only removed when explicitly destroyed by user action via destroyTerminal().
 */
function handleTerminalExit(
  _terminal: TerminalProcess,
  _terminals: Map<string, TerminalProcess>
): void {
  // Don't remove session - let it persist for restoration
}

/**
 * Restore multiple sessions from a specific date
 */
export async function restoreSessionsFromDate(
  date: string,
  projectPath: string,
  terminals: Map<string, TerminalProcess>,
  getWindow: WindowGetter,
  dataHandler: DataHandlerFn,
  options: RestoreOptions,
  cols = 80,
  rows = 24
): Promise<{ restored: number; failed: number; sessions: Array<{ id: string; success: boolean; error?: string }> }> {
  const sessions = SessionHandler.getSessionsForDate(date, projectPath);
  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const session of sessions) {
    const result = await restoreTerminal(
      session,
      terminals,
      getWindow,
      dataHandler,
      options,
      cols,
      rows
    );
    results.push({
      id: session.id,
      success: result.success,
      error: result.error
    });
  }

  return {
    restored: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    sessions: results
  };
}
