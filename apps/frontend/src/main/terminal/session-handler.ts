/**
 * Session Handler Module
 * Manages terminal session persistence, restoration, and Claude session tracking
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TerminalProcess, WindowGetter } from './types';
import { getTerminalSessionStore, type TerminalSession } from '../terminal-session-store';
import { IPC_CHANNELS } from '../../shared/constants';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import { safeSendToRenderer } from '../ipc-handlers/utils';

/**
 * Track session IDs that have been claimed by terminals to prevent race conditions.
 * When multiple terminals invoke Claude simultaneously, this prevents them from
 * all capturing the same session ID.
 *
 * Key: sessionId, Value: terminalId that claimed it
 */
const claimedSessionIds: Map<string, string> = new Map();

/**
 * Claim a session ID for a terminal. Returns true if successful, false if already claimed.
 */
export function claimSessionId(sessionId: string, terminalId: string): boolean {
  const existingClaim = claimedSessionIds.get(sessionId);
  if (existingClaim && existingClaim !== terminalId) {
    debugLog('[SessionHandler] Session ID already claimed:', sessionId, 'by terminal:', existingClaim);
    return false;
  }
  claimedSessionIds.set(sessionId, terminalId);
  debugLog('[SessionHandler] Claimed session ID:', sessionId, 'for terminal:', terminalId);
  return true;
}

/**
 * Release a session ID claim when a terminal is destroyed or session changes.
 */
export function releaseSessionId(terminalId: string): void {
  for (const [sessionId, claimedBy] of claimedSessionIds.entries()) {
    if (claimedBy === terminalId) {
      claimedSessionIds.delete(sessionId);
      debugLog('[SessionHandler] Released session ID:', sessionId, 'from terminal:', terminalId);
    }
  }
}

/**
 * Get all currently claimed session IDs (for exclusion during search).
 */
export function getClaimedSessionIds(): Set<string> {
  return new Set(claimedSessionIds.keys());
}

/**
 * Get the Claude project slug from a project path.
 * Claude uses the full path with forward slashes replaced by dashes.
 */
function getClaudeProjectSlug(projectPath: string): string {
  return projectPath.replace(/[/\\]/g, '-');
}

/**
 * Find the most recent Claude session file for a project
 */
export function findMostRecentClaudeSession(projectPath: string): string | null {
  const slug = getClaudeProjectSlug(projectPath);
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', slug);

  try {
    if (!fs.existsSync(claudeProjectDir)) {
      debugLog('[SessionHandler] Claude project directory not found:', claudeProjectDir);
      return null;
    }

    const files = fs.readdirSync(claudeProjectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(claudeProjectDir, f),
        mtime: fs.statSync(path.join(claudeProjectDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      debugLog('[SessionHandler] No Claude session files found in:', claudeProjectDir);
      return null;
    }

    const sessionId = files[0].name.replace('.jsonl', '');
    debugLog('[SessionHandler] Found most recent Claude session:', sessionId);
    return sessionId;
  } catch (error) {
    debugError('[SessionHandler] Error finding Claude session:', error);
    return null;
  }
}

/**
 * Find a Claude session created/modified after a given timestamp.
 * Excludes session IDs that have already been claimed by other terminals
 * to prevent race conditions when multiple terminals invoke Claude simultaneously.
 *
 * @param projectPath - The project path to search sessions for
 * @param afterTimestamp - Only consider sessions modified after this timestamp
 * @param excludeSessionIds - Optional set of session IDs to exclude (already claimed)
 */
export function findClaudeSessionAfter(
  projectPath: string,
  afterTimestamp: number,
  excludeSessionIds?: Set<string>
): string | null {
  const slug = getClaudeProjectSlug(projectPath);
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', slug);

  try {
    if (!fs.existsSync(claudeProjectDir)) {
      return null;
    }

    const files = fs.readdirSync(claudeProjectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        sessionId: f.replace('.jsonl', ''),
        path: path.join(claudeProjectDir, f),
        mtime: fs.statSync(path.join(claudeProjectDir, f)).mtime.getTime()
      }))
      .filter(f => f.mtime > afterTimestamp)
      // Exclude already-claimed session IDs to prevent race conditions
      .filter(f => !excludeSessionIds || !excludeSessionIds.has(f.sessionId))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return null;
    }

    const sessionId = files[0].sessionId;
    debugLog('[SessionHandler] Found unclaimed session after timestamp:', sessionId, 'excluded:', excludeSessionIds?.size ?? 0);
    return sessionId;
  } catch (error) {
    debugError('[SessionHandler] Error finding Claude session:', error);
    return null;
  }
}

/**
 * Create a TerminalSession object from a TerminalProcess.
 * Shared helper used by both persistSession and persistSessionAsync.
 */
function createSessionObject(terminal: TerminalProcess): TerminalSession {
  return {
    id: terminal.id,
    title: terminal.title,
    cwd: terminal.cwd,
    projectPath: terminal.projectPath!,
    isClaudeMode: terminal.isClaudeMode,
    claudeSessionId: terminal.claudeSessionId,
    outputBuffer: terminal.outputBuffer,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    worktreeConfig: terminal.worktreeConfig,
  };
}

/**
 * Persist a terminal session to disk
 */
export function persistSession(terminal: TerminalProcess): void {
  if (!terminal.projectPath) {
    return;
  }

  const store = getTerminalSessionStore();
  store.saveSession(createSessionObject(terminal));
}

/**
 * Persist a terminal session to disk asynchronously (fire-and-forget).
 * This is non-blocking and prevents the main process from freezing during disk writes.
 */
export function persistSessionAsync(terminal: TerminalProcess): void {
  if (!terminal.projectPath) {
    return;
  }

  const store = getTerminalSessionStore();
  store.saveSessionAsync(createSessionObject(terminal)).catch((error) => {
    debugError('[SessionHandler] Failed to persist session:', error);
  });
}

/**
 * Persist all active sessions asynchronously
 *
 * Uses async persistence to avoid blocking the main process when saving
 * multiple sessions (e.g., on app quit).
 */
export async function persistAllSessionsAsync(terminals: Map<string, TerminalProcess>): Promise<void> {
  const store = getTerminalSessionStore();

  const savePromises: Promise<void>[] = [];
  terminals.forEach((terminal) => {
    if (terminal.projectPath) {
      savePromises.push(store.saveSessionAsync(createSessionObject(terminal)));
    }
  });

  await Promise.all(savePromises);
}

/**
 * Persist all active sessions (blocking sync version)
 *
 * @deprecated Use persistAllSessionsAsync for non-blocking persistence.
 * This function is kept for backwards compatibility with existing callers.
 */
export function persistAllSessions(terminals: Map<string, TerminalProcess>): void {
  terminals.forEach((terminal) => {
    if (terminal.projectPath) {
      persistSession(terminal);
    }
  });
}

/**
 * Clear a terminal ID from pendingDelete, allowing session saves to proceed.
 *
 * Must be called when re-creating a terminal with a previously-used ID
 * (e.g., worktree switching, terminal restart after shell exit). Without this,
 * the pendingDelete guard blocks persistence for the new terminal.
 */
export function clearPendingDelete(terminalId: string): void {
  const store = getTerminalSessionStore();
  store.clearPendingDelete(terminalId);
}

/**
 * Remove a session from persistent storage
 */
export function removePersistedSession(terminal: TerminalProcess): void {
  if (!terminal.projectPath) {
    return;
  }

  const store = getTerminalSessionStore();
  store.removeSession(terminal.projectPath, terminal.id);
}

/**
 * Update Claude session ID in persistent storage
 */
export function updateClaudeSessionId(
  projectPath: string,
  terminalId: string,
  sessionId: string
): void {
  const store = getTerminalSessionStore();
  store.updateClaudeSessionId(projectPath, terminalId, sessionId);
}

/**
 * Get saved sessions for a project
 */
export function getSavedSessions(projectPath: string): TerminalSession[] {
  const store = getTerminalSessionStore();
  return store.getSessions(projectPath);
}

/**
 * Clear all saved sessions for a project
 */
export function clearSavedSessions(projectPath: string): void {
  const store = getTerminalSessionStore();
  store.clearProjectSessions(projectPath);
}

/**
 * Get available session dates
 */
export function getAvailableSessionDates(
  projectPath?: string
): import('../terminal-session-store').SessionDateInfo[] {
  const store = getTerminalSessionStore();
  return store.getAvailableDates(projectPath);
}

/**
 * Get sessions for a specific date
 */
export function getSessionsForDate(date: string, projectPath: string): TerminalSession[] {
  const store = getTerminalSessionStore();
  return store.getSessionsForDate(date, projectPath);
}

/**
 * Update display orders for terminals after drag-drop reorder
 */
export function updateDisplayOrders(
  projectPath: string,
  orders: Array<{ terminalId: string; displayOrder: number }>
): void {
  const store = getTerminalSessionStore();
  store.updateDisplayOrders(projectPath, orders);
}

/**
 * Attempt to capture Claude session ID by polling the session directory.
 * Uses the claim mechanism to prevent race conditions when multiple terminals
 * invoke Claude simultaneously - each terminal will get a unique session ID.
 */
export function captureClaudeSessionId(
  terminalId: string,
  projectPath: string,
  startTime: number,
  terminals: Map<string, TerminalProcess>,
  getWindow: WindowGetter
): void {
  let attempts = 0;
  const maxAttempts = 10;

  const checkForSession = () => {
    attempts++;

    const terminal = terminals.get(terminalId);
    if (!terminal || !terminal.isClaudeMode) {
      debugLog('[SessionHandler] Terminal no longer in Claude mode, stopping session capture:', terminalId);
      return;
    }

    if (terminal.claudeSessionId) {
      debugLog('[SessionHandler] Terminal already has session ID, stopping capture:', terminalId);
      return;
    }

    // Get currently claimed session IDs to exclude from search
    const claimedIds = getClaimedSessionIds();
    const sessionId = findClaudeSessionAfter(projectPath, startTime, claimedIds);

    if (sessionId) {
      // Try to claim this session ID - if another terminal beat us to it, keep searching
      if (claimSessionId(sessionId, terminalId)) {
        terminal.claudeSessionId = sessionId;
        debugLog('[SessionHandler] Captured and claimed Claude session ID:', sessionId, 'for terminal:', terminalId);

        if (terminal.projectPath) {
          updateClaudeSessionId(terminal.projectPath, terminalId, sessionId);
        }

        // Use safeSendToRenderer with isDestroyed() check to prevent crashes
        safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_CLAUDE_SESSION, terminalId, sessionId);
      } else {
        // Session was claimed by another terminal, keep polling for a different one
        debugLog('[SessionHandler] Session ID was claimed by another terminal, continuing to poll:', sessionId);
        if (attempts < maxAttempts) {
          setTimeout(checkForSession, 1000);
        }
      }
    } else if (attempts < maxAttempts) {
      setTimeout(checkForSession, 1000);
    } else {
      debugLog('[SessionHandler] Could not capture Claude session ID after', maxAttempts, 'attempts for terminal:', terminalId);
    }
  };

  setTimeout(checkForSession, 2000);
}
