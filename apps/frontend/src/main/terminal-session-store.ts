import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, promises as fsPromises } from 'fs';
import type { TerminalWorktreeConfig } from '../shared/types';
import { debugLog } from '../shared/utils/debug-logger';

/**
 * Persisted terminal session data
 */
export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  projectPath: string;  // Which project this terminal belongs to
  isClaudeMode: boolean;
  claudeSessionId?: string;  // Claude session ID for resume functionality
  outputBuffer: string;  // Last 100KB of output for replay
  createdAt: string;  // ISO timestamp
  lastActiveAt: string;  // ISO timestamp
  /** Associated worktree configuration (validated on restore) */
  worktreeConfig?: TerminalWorktreeConfig;
  /** UI display position for ordering terminals after drag-drop */
  displayOrder?: number;
}

/**
 * Session date info for dropdown display
 */
export interface SessionDateInfo {
  date: string;  // YYYY-MM-DD format
  label: string;  // Human readable: "Today", "Yesterday", "Dec 10"
  sessionCount: number;  // Total sessions across all projects
  projectCount: number;  // Number of projects with sessions
}

/**
 * All persisted sessions grouped by date, then by project
 */
interface SessionData {
  version: number;
  // date (YYYY-MM-DD) -> projectPath -> sessions
  sessionsByDate: Record<string, Record<string, TerminalSession[]>>;
}

const STORE_VERSION = 2;  // Bumped for new structure
const MAX_OUTPUT_BUFFER = 100000;  // 100KB per terminal
const MAX_DAYS_TO_KEEP = 10;  // Keep sessions for 10 days

/**
 * Get date string in YYYY-MM-DD format
 */
function getDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get human readable date label
 */
function getDateLabel(dateStr: string): string {
  const today = getDateString();
  const yesterday = getDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  if (dateStr === today) {
    return 'Today';
  } else if (dateStr === yesterday) {
    return 'Yesterday';
  } else {
    // Format as "Dec 10" or similar
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Manages persistent terminal session storage organized by date
 * Sessions are saved to userData/sessions/terminals.json
 */
export class TerminalSessionStore {
  private storePath: string;
  private tempPath: string;
  private backupPath: string;
  private data: SessionData;
  /**
   * Tracks session IDs that are being deleted to prevent async writes from
   * resurrecting them. This fixes a race condition where saveSessionAsync()
   * could complete after removeSession() and re-add deleted sessions.
   */
  private pendingDelete: Set<string> = new Set();
  /**
   * Tracks cleanup timers for pendingDelete entries to prevent timer accumulation
   * when many sessions are deleted rapidly.
   */
  private pendingDeleteTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /**
   * Write serialization state - prevents concurrent async writes from
   * interleaving and potentially losing data.
   */
  private writeInProgress = false;
  private writePending = false;
  /**
   * Failure tracking for async writes - helps detect persistent write issues
   * that might otherwise go unnoticed in fire-and-forget scenarios.
   */
  private consecutiveFailures = 0;
  private static readonly MAX_FAILURES_BEFORE_WARNING = 3;

  constructor() {
    const sessionsDir = join(app.getPath('userData'), 'sessions');
    this.storePath = join(sessionsDir, 'terminals.json');
    this.tempPath = join(sessionsDir, 'terminals.json.tmp');
    this.backupPath = join(sessionsDir, 'terminals.json.backup');

    // Ensure directory exists
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    // Load existing data or initialize
    this.data = this.load();

    // Clean up old sessions on startup
    this.cleanupOldSessions();
  }

  /**
   * Load sessions from disk with backup recovery
   */
  private load(): SessionData {
    // Try loading from main file first
    const mainResult = this.tryLoadFile(this.storePath);
    if (mainResult.success && mainResult.data) {
      return mainResult.data;
    }

    // If main file failed, try backup
    if (mainResult.error) {
      console.warn('[TerminalSessionStore] Main file corrupted, attempting backup recovery...');
      const backupResult = this.tryLoadFile(this.backupPath);
      if (backupResult.success && backupResult.data) {
        console.warn('[TerminalSessionStore] Successfully recovered from backup!');
        // Immediately save the recovered data to main file
        try {
          writeFileSync(this.storePath, JSON.stringify(backupResult.data, null, 2), 'utf-8');
          console.warn('[TerminalSessionStore] Restored main file from backup');
        } catch (writeError) {
          console.error('[TerminalSessionStore] Failed to restore main file:', writeError);
        }
        return backupResult.data;
      }
      console.error('[TerminalSessionStore] Backup recovery failed, starting fresh');
    }

    return { version: STORE_VERSION, sessionsByDate: {} };
  }

  /**
   * Try to load and parse a session file
   */
  private tryLoadFile(filePath: string): { success: boolean; data?: SessionData; error?: Error } {
    try {
      if (!existsSync(filePath)) {
        return { success: false };
      }

      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Migrate from v1 to v2 structure
      if (data.version === 1 && data.sessions) {
        console.warn('[TerminalSessionStore] Migrating from v1 to v2 structure');
        const today = getDateString();
        const migratedData: SessionData = {
          version: STORE_VERSION,
          sessionsByDate: {
            [today]: data.sessions
          }
        };
        return { success: true, data: migratedData };
      }

      if (data.version === STORE_VERSION) {
        return { success: true, data: data as SessionData };
      }

      console.warn('[TerminalSessionStore] Version mismatch, resetting sessions');
      return { success: false };
    } catch (error) {
      console.error(`[TerminalSessionStore] Error loading ${filePath}:`, error);
      return { success: false, error: error as Error };
    }
  }

  /**
   * Save sessions to disk using atomic write pattern:
   * 1. Write to temp file
   * 2. Rotate current file to backup
   * 3. Rename temp to target (atomic on most filesystems)
   *
   * If an async write is in progress, defers to the async writer to avoid
   * both operations competing for the same temp file (ENOENT race condition).
   */
  private save(): void {
    // If an async write is in progress, don't write synchronously — the async
    // writer shares the same temp file path. Instead, mark a pending write so
    // saveAsync() will re-save with the latest in-memory data when it finishes.
    if (this.writeInProgress) {
      this.writePending = true;
      debugLog('[TerminalSessionStore] Deferring sync save — async write in progress');
      return;
    }

    try {
      const content = JSON.stringify(this.data, null, 2);

      // Step 1: Write to temp file
      writeFileSync(this.tempPath, content, 'utf-8');

      // Step 2: Rotate current file to backup (if it exists and is valid)
      if (existsSync(this.storePath)) {
        try {
          // Verify current file is valid before backing up
          const currentContent = readFileSync(this.storePath, 'utf-8');
          JSON.parse(currentContent); // Throws if invalid
          // Current file is valid, rotate to backup
          if (existsSync(this.backupPath)) {
            unlinkSync(this.backupPath);
          }
          renameSync(this.storePath, this.backupPath);
        } catch {
          // Current file is corrupted, don't back it up - just delete
          console.warn('[TerminalSessionStore] Current file corrupted, not backing up');
          unlinkSync(this.storePath);
        }
      }

      // Step 3: Atomic rename temp to target
      renameSync(this.tempPath, this.storePath);
    } catch (error) {
      console.error('[TerminalSessionStore] Error saving sessions:', error);
      // Clean up temp file if it exists
      try {
        if (existsSync(this.tempPath)) {
          unlinkSync(this.tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Helper to check if a file exists asynchronously
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save sessions to disk asynchronously (non-blocking) using atomic write pattern
   *
   * Safe to call from Electron main process without blocking the event loop.
   * Uses write serialization to prevent concurrent writes from losing data.
   * Tracks consecutive failures and logs warnings for persistent issues.
   */
  private async saveAsync(): Promise<void> {
    // If a write is in progress, mark that another write is needed
    if (this.writeInProgress) {
      this.writePending = true;
      return;
    }

    this.writeInProgress = true;
    try {
      const content = JSON.stringify(this.data, null, 2);

      // Step 1: Write to temp file
      await fsPromises.writeFile(this.tempPath, content, 'utf-8');

      // Step 2: Rotate current file to backup (if it exists and is valid)
      if (await this.fileExists(this.storePath)) {
        try {
          const currentContent = await fsPromises.readFile(this.storePath, 'utf-8');
          JSON.parse(currentContent); // Throws if invalid
          // Current file is valid, rotate to backup
          if (await this.fileExists(this.backupPath)) {
            await fsPromises.unlink(this.backupPath);
          }
          await fsPromises.rename(this.storePath, this.backupPath);
        } catch {
          // Current file is corrupted, don't back it up - just delete
          console.warn('[TerminalSessionStore] Current file corrupted, not backing up');
          await fsPromises.unlink(this.storePath);
        }
      }

      // Step 3: Atomic rename temp to target
      await fsPromises.rename(this.tempPath, this.storePath);

      // Reset failure counter on success
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;
      console.error('[TerminalSessionStore] Error saving sessions:', error);

      // Clean up temp file if it exists
      try {
        if (await this.fileExists(this.tempPath)) {
          await fsPromises.unlink(this.tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      // Warn about persistent failures that might indicate a real problem
      if (this.consecutiveFailures >= TerminalSessionStore.MAX_FAILURES_BEFORE_WARNING) {
        console.error(
          `[TerminalSessionStore] WARNING: ${this.consecutiveFailures} consecutive save failures. ` +
          'Session data may not be persisting. Check disk space and permissions.'
        );
      }
    } finally {
      this.writeInProgress = false;

      // If another write was requested while we were writing, do it now
      if (this.writePending) {
        this.writePending = false;
        // Use setImmediate to avoid stack overflow with many rapid calls
        setImmediate(() => this.saveAsync());
      }
    }
  }

  /**
   * Remove sessions older than MAX_DAYS_TO_KEEP days
   */
  private cleanupOldSessions(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_DAYS_TO_KEEP);
    const cutoffStr = getDateString(cutoffDate);

    let removedCount = 0;
    const dates = Object.keys(this.data.sessionsByDate);

    for (const dateStr of dates) {
      if (dateStr < cutoffStr) {
        delete this.data.sessionsByDate[dateStr];
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.warn(`[TerminalSessionStore] Cleaned up sessions from ${removedCount} old dates`);
      this.save();
    }
  }

  /**
   * Get sessions for today, organized by project
   */
  private getTodaysSessions(): Record<string, TerminalSession[]> {
    const today = getDateString();
    if (!this.data.sessionsByDate[today]) {
      this.data.sessionsByDate[today] = {};
    }
    return this.data.sessionsByDate[today];
  }

  /**
   * Update session in memory (shared logic for saveSession and saveSessionAsync)
   *
   * Returns false if the session is pending deletion and should not be saved.
   */
  private updateSessionInMemory(session: TerminalSession): boolean {
    // Check if session was deleted - skip if pending deletion
    if (this.pendingDelete.has(session.id)) {
      debugLog('[TerminalSessionStore] Skipping save for deleted session:', session.id,
        'pendingDelete size:', this.pendingDelete.size,
        'all pending IDs:', [...this.pendingDelete].join(', '));
      return false;
    }

    const { projectPath } = session;
    const todaySessions = this.getTodaysSessions();

    if (!todaySessions[projectPath]) {
      todaySessions[projectPath] = [];
    }

    // Debug: Log incoming outputBuffer info
    const incomingBufferLen = session.outputBuffer?.length ?? 0;
    debugLog('[TerminalSessionStore] Updating session in memory:', session.id,
      'incoming outputBuffer:', incomingBufferLen, 'bytes',
      'isClaudeMode:', session.isClaudeMode);

    // Update existing or add new
    const existingIndex = todaySessions[projectPath].findIndex(s => s.id === session.id);
    if (existingIndex >= 0) {
      // Preserve displayOrder from existing session if not provided in incoming session
      // This prevents periodic saves (which don't include displayOrder) from losing tab order
      const existingSession = todaySessions[projectPath][existingIndex];
      const existingBufferLen = existingSession.outputBuffer?.length ?? 0;
      const truncatedLen = session.outputBuffer.slice(-MAX_OUTPUT_BUFFER).length;
      debugLog('[TerminalSessionStore] Updating existing session:', session.id,
        'existing outputBuffer:', existingBufferLen, 'bytes',
        'new outputBuffer (after truncation):', truncatedLen, 'bytes');

      todaySessions[projectPath][existingIndex] = {
        ...session,
        // Limit output buffer size
        outputBuffer: session.outputBuffer.slice(-MAX_OUTPUT_BUFFER),
        lastActiveAt: new Date().toISOString(),
        // Preserve existing displayOrder if incoming session doesn't have it
        displayOrder: session.displayOrder ?? existingSession.displayOrder,
      };
    } else {
      const truncatedLen = session.outputBuffer.slice(-MAX_OUTPUT_BUFFER).length;
      debugLog('[TerminalSessionStore] Creating new session:', session.id,
        'outputBuffer (after truncation):', truncatedLen, 'bytes');

      todaySessions[projectPath].push({
        ...session,
        outputBuffer: session.outputBuffer.slice(-MAX_OUTPUT_BUFFER),
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      });
    }

    return true;
  }

  /**
   * Save a terminal session (to today's bucket)
   */
  saveSession(session: TerminalSession): void {
    if (this.updateSessionInMemory(session)) {
      this.save();
    }
  }

  /**
   * Validate worktree config - check if the worktree still exists
   * Returns undefined if worktree doesn't exist or is invalid
   */
  private validateWorktreeConfig(config: TerminalWorktreeConfig | undefined): TerminalWorktreeConfig | undefined {
    if (!config) return undefined;

    // Check if the worktree path still exists
    if (!existsSync(config.worktreePath)) {
      console.warn(`[TerminalSessionStore] Worktree path no longer exists: ${config.worktreePath}, clearing config`);
      return undefined;
    }

    return config;
  }

  /**
   * Get most recent sessions for a project.
   * First checks today, then looks at the most recent date with sessions.
   * When restoring from a previous date, MIGRATES sessions to today to prevent
   * duplication issues across days.
   * Validates worktree configs - clears them if worktree no longer exists.
   */
  getSessions(projectPath: string): TerminalSession[] {
    const today = getDateString();

    debugLog('[TerminalSessionStore] Getting sessions for project:', projectPath, 'date:', today);

    // First check today
    const todaySessions = this.getTodaysSessions();
    if (todaySessions[projectPath]?.length > 0) {
      // Debug: Log outputBuffer info for each session
      for (const session of todaySessions[projectPath]) {
        const bufferLen = session.outputBuffer?.length ?? 0;
        debugLog('[TerminalSessionStore] Session', session.id, 'outputBuffer:', bufferLen, 'bytes',
          'isClaudeMode:', session.isClaudeMode,
          'hasBuffer:', bufferLen > 0);
      }
      // Validate worktree configs before returning
      return todaySessions[projectPath].map(session => ({
        ...session,
        worktreeConfig: this.validateWorktreeConfig(session.worktreeConfig),
      }));
    }

    // If no sessions today, find the most recent date with sessions for this project
    const dates = Object.keys(this.data.sessionsByDate)
      .filter(date => {
        // Exclude today since we already checked it
        if (date === today) return false;
        const sessions = this.data.sessionsByDate[date][projectPath];
        return sessions && sessions.length > 0;
      })
      .sort((a, b) => b.localeCompare(a));  // Most recent first

    if (dates.length > 0) {
      const mostRecentDate = dates[0];
      console.warn(`[TerminalSessionStore] No sessions today, migrating sessions from ${mostRecentDate} to today`);
      const sessions = this.data.sessionsByDate[mostRecentDate][projectPath] || [];

      // Debug: Log outputBuffer info for sessions being migrated
      for (const session of sessions) {
        const bufferLen = session.outputBuffer?.length ?? 0;
        debugLog('[TerminalSessionStore] Migrating session', session.id, 'from', mostRecentDate,
          'outputBuffer:', bufferLen, 'bytes',
          'isClaudeMode:', session.isClaudeMode,
          'hasBuffer:', bufferLen > 0);
      }

      // MIGRATE: Copy sessions to today's bucket with validated worktree configs
      const migratedSessions = sessions.map(session => ({
        ...session,
        worktreeConfig: this.validateWorktreeConfig(session.worktreeConfig),
        // Update lastActiveAt to now since we're restoring them
        lastActiveAt: new Date().toISOString(),
      }));

      // Add migrated sessions to today
      todaySessions[projectPath] = migratedSessions;

      // Remove sessions from the old date to prevent duplication
      delete this.data.sessionsByDate[mostRecentDate][projectPath];

      // Clean up empty date buckets
      if (Object.keys(this.data.sessionsByDate[mostRecentDate]).length === 0) {
        delete this.data.sessionsByDate[mostRecentDate];
      }

      // Save the migration
      this.save();

      console.warn(`[TerminalSessionStore] Migrated ${migratedSessions.length} sessions from ${mostRecentDate} to ${today}`);

      return migratedSessions;
    }

    return [];
  }

  /**
   * Get sessions for a specific date and project
   * Validates worktree configs - clears them if worktree no longer exists.
   */
  getSessionsForDate(date: string, projectPath: string): TerminalSession[] {
    const dateSessions = this.data.sessionsByDate[date];
    if (!dateSessions) return [];
    const sessions = dateSessions[projectPath] || [];
    // Validate worktree configs before returning
    return sessions.map(session => ({
      ...session,
      worktreeConfig: this.validateWorktreeConfig(session.worktreeConfig),
    }));
  }

  /**
   * Get all sessions for a specific date (all projects)
   */
  getAllSessionsForDate(date: string): Record<string, TerminalSession[]> {
    return this.data.sessionsByDate[date] || {};
  }

  /**
   * Get available session dates with metadata
   */
  getAvailableDates(projectPath?: string): SessionDateInfo[] {
    const dates = Object.keys(this.data.sessionsByDate)
      .filter(date => {
        // If projectPath specified, only include dates with sessions for that project
        if (projectPath) {
          const sessions = this.data.sessionsByDate[date][projectPath];
          return sessions && sessions.length > 0;
        }
        return true;
      })
      .sort((a, b) => b.localeCompare(a));  // Most recent first

    return dates.map(date => {
      const dateSessions = this.data.sessionsByDate[date];
      let sessionCount = 0;
      let projectCount = 0;

      for (const [projPath, sessions] of Object.entries(dateSessions)) {
        if (!projectPath || projPath === projectPath) {
          if (sessions.length > 0) {
            sessionCount += sessions.length;
            projectCount++;
          }
        }
      }

      return {
        date,
        label: getDateLabel(date),
        sessionCount,
        projectCount
      };
    }).filter(info => info.sessionCount > 0);  // Only dates with actual sessions
  }

  /**
   * Get a specific session
   */
  getSession(projectPath: string, sessionId: string): TerminalSession | undefined {
    const todaySessions = this.getTodaysSessions();
    const sessions = todaySessions[projectPath] || [];
    return sessions.find(s => s.id === sessionId);
  }

  /**
   * Clear a session ID from pendingDelete, allowing saves to proceed.
   *
   * Called when a terminal is legitimately re-created with the same ID
   * (e.g., worktree switching, terminal restart after exit). Without this,
   * the 5-second pendingDelete window blocks session persistence for the
   * new terminal.
   */
  clearPendingDelete(sessionId: string): void {
    if (this.pendingDelete.has(sessionId)) {
      this.pendingDelete.delete(sessionId);
      // Also clear the cleanup timer since we're explicitly clearing
      const timer = this.pendingDeleteTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.pendingDeleteTimers.delete(sessionId);
      }
      debugLog('[TerminalSessionStore] Cleared pendingDelete for re-created terminal:', sessionId);
    }
  }

  /**
   * Remove a session (from today's sessions)
   *
   * Adds the session ID to pendingDelete to prevent async writes from
   * resurrecting the session if saveSessionAsync() is in-flight.
   */
  removeSession(projectPath: string, sessionId: string): void {
    // Mark as pending delete BEFORE modifying data to prevent race condition
    // with in-flight saveSessionAsync() calls
    this.pendingDelete.add(sessionId);
    debugLog('[TerminalSessionStore] removeSession: added to pendingDelete:', sessionId,
      'pendingDelete size:', this.pendingDelete.size,
      'all pending IDs:', [...this.pendingDelete].join(', '));

    const todaySessions = this.getTodaysSessions();
    if (todaySessions[projectPath]) {
      todaySessions[projectPath] = todaySessions[projectPath].filter(
        s => s.id !== sessionId
      );
      this.save();
    }

    // Cancel any existing cleanup timer for this session (prevents timer accumulation
    // when the same session ID is deleted multiple times rapidly)
    const existingTimer = this.pendingDeleteTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Keep the ID in pendingDelete for a short time to handle any in-flight
    // async operations, then clean up to prevent memory leaks
    const timer = setTimeout(() => {
      this.pendingDelete.delete(sessionId);
      this.pendingDeleteTimers.delete(sessionId);
      debugLog('[TerminalSessionStore] Cleanup timer fired for:', sessionId,
        'removing from pendingDelete. Remaining:', this.pendingDelete.size);
    }, 5000);
    this.pendingDeleteTimers.set(sessionId, timer);
  }

  /**
   * Clear all sessions for a project (from today)
   */
  clearProjectSessions(projectPath: string): void {
    const todaySessions = this.getTodaysSessions();
    delete todaySessions[projectPath];
    this.save();
  }

  /**
   * Clear sessions for a specific date and project
   */
  clearSessionsForDate(date: string, projectPath?: string): void {
    if (projectPath) {
      if (this.data.sessionsByDate[date]) {
        delete this.data.sessionsByDate[date][projectPath];
      }
    } else {
      delete this.data.sessionsByDate[date];
    }
    this.save();
  }

  /**
   * Update output buffer for a session (called frequently, batched save)
   */
  updateOutputBuffer(projectPath: string, sessionId: string, output: string): void {
    const todaySessions = this.getTodaysSessions();
    const sessions = todaySessions[projectPath];
    if (!sessions) return;

    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      const prevLen = session.outputBuffer?.length ?? 0;
      session.outputBuffer = (session.outputBuffer + output).slice(-MAX_OUTPUT_BUFFER);
      const newLen = session.outputBuffer.length;
      session.lastActiveAt = new Date().toISOString();

      // Debug: Log buffer update (throttled to avoid spam - only log when significant changes)
      if (newLen - prevLen > 1000 || prevLen === 0) {
        debugLog('[TerminalSessionStore] updateOutputBuffer:', sessionId,
          'prev:', prevLen, 'bytes, added:', output.length, 'bytes, new total:', newLen, 'bytes');
      }
      // Note: We don't save immediately here to avoid excessive disk writes
      // Call saveAllPending() periodically or on app quit
    }
  }

  /**
   * Update Claude session ID for a terminal
   */
  updateClaudeSessionId(projectPath: string, terminalId: string, claudeSessionId: string): void {
    const todaySessions = this.getTodaysSessions();
    const sessions = todaySessions[projectPath];
    if (!sessions) return;

    const session = sessions.find(s => s.id === terminalId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
      session.isClaudeMode = true;
      this.save();
      console.warn('[TerminalSessionStore] Saved Claude session ID:', claudeSessionId, 'for terminal:', terminalId);
    }
  }

  /**
   * Save all pending changes (call on app quit or periodically)
   */
  saveAllPending(): void {
    this.save();
  }

  /**
   * Update display orders for multiple terminals (after drag-drop reorder).
   * This updates the displayOrder property for matching sessions in today's bucket.
   */
  updateDisplayOrders(projectPath: string, orders: Array<{ terminalId: string; displayOrder: number }>): void {
    const todaySessions = this.getTodaysSessions();
    const sessions = todaySessions[projectPath];
    if (!sessions) return;

    let hasChanges = false;
    for (const { terminalId, displayOrder } of orders) {
      const session = sessions.find(s => s.id === terminalId);
      if (session && session.displayOrder !== displayOrder) {
        session.displayOrder = displayOrder;
        session.lastActiveAt = new Date().toISOString();
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.save();
    }
  }

  /**
   * Save a terminal session asynchronously (non-blocking)
   *
   * Mirrors saveSession() but uses async disk write to avoid blocking
   * the main process. Use this for fire-and-forget session persistence.
   *
   * Uses shared updateSessionInMemory() which checks pendingDelete to avoid
   * resurrecting sessions that have been removed while this async operation
   * was queued/in-flight.
   */
  async saveSessionAsync(session: TerminalSession): Promise<void> {
    if (this.updateSessionInMemory(session)) {
      await this.saveAsync();
    }
  }

  /**
   * Get all sessions (for debugging)
   */
  getAllSessions(): SessionData {
    return this.data;
  }
}

// Singleton instance
let instance: TerminalSessionStore | null = null;

export function getTerminalSessionStore(): TerminalSessionStore {
  if (!instance) {
    instance = new TerminalSessionStore();
  }
  return instance;
}
