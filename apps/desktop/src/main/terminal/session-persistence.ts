/**
 * Terminal Session Persistence
 *
 * Handles saving and loading terminal session state to disk.
 * This is the fallback recovery layer when the PTY daemon is not available.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  TerminalSessionState,
  TerminalSessionsFile,
  TerminalRecoveryInfo,
} from '../../shared/types/terminal-session';

const SESSIONS_FILE = path.join(app.getPath('userData'), 'terminal-sessions.json');
const BUFFERS_DIR = path.join(app.getPath('userData'), 'terminal-buffers');

// Session age limit: 7 days
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

class SessionPersistence {
  private sessions: Map<string, TerminalSessionState> = new Map();
  private saveTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.ensureDirectories();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(BUFFERS_DIR)) {
      fs.mkdirSync(BUFFERS_DIR, { recursive: true });
    }
  }

  /**
   * Initialize and load sessions on app start
   */
  initialize(): TerminalRecoveryInfo {
    if (this.isInitialized) {
      return this.getRecoveryInfo();
    }

    const sessions = this.loadSessions();
    this.isInitialized = true;

    console.warn(`[SessionPersistence] Initialized with ${sessions.length} sessions`);
    return this.getRecoveryInfo();
  }

  /**
   * Load sessions from disk
   */
  loadSessions(): TerminalSessionState[] {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return [];
    }

    try {
      const data: TerminalSessionsFile = JSON.parse(
        fs.readFileSync(SESSIONS_FILE, 'utf8')
      );

      // Validate version
      if (data.version !== 2) {
        console.warn('[SessionPersistence] Incompatible version, starting fresh');
        return [];
      }

      // Filter out stale sessions (older than 7 days)
      const now = Date.now();
      const validSessions = data.sessions.filter(
        (s) => now - s.lastActiveAt < MAX_SESSION_AGE_MS
      );

      // Clean up buffers for stale sessions
      const staleSessions = data.sessions.filter(
        (s) => now - s.lastActiveAt >= MAX_SESSION_AGE_MS
      );
      staleSessions.forEach((s) => {
        if (s.bufferFile) {
          this.deleteBufferFile(s.bufferFile);
        }
      });

      validSessions.forEach((s) => this.sessions.set(s.id, s));

      console.warn(
        `[SessionPersistence] Loaded ${validSessions.length} valid sessions, cleaned ${staleSessions.length} stale sessions`
      );
      return validSessions;
    } catch (error) {
      console.error('[SessionPersistence] Failed to load sessions:', error);
      return [];
    }
  }

  /**
   * Get recovery information for UI
   */
  getRecoveryInfo(): TerminalRecoveryInfo {
    const sessions = Array.from(this.sessions.values());

    return {
      totalSessions: sessions.length,
      recoverableSessions: sessions.filter((s) => s.bufferFile || s.daemonPtyId).length,
      recoveryMethod: sessions.some((s) => s.daemonPtyId) ? 'daemon' : 'state',
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        isCLIMode: s.isCLIMode,
        lastActiveAt: s.lastActiveAt,
        hasBuffer: !!s.bufferFile,
        hasDaemonPty: !!s.daemonPtyId,
      })),
    };
  }

  /**
   * Save a session (debounced)
   */
  saveSession(session: TerminalSessionState): void {
    session.lastActiveAt = Date.now();
    this.sessions.set(session.id, session);
    this.scheduleSave();
  }

  /**
   * Update session metadata without triggering full save
   */
  updateSessionMetadata(
    id: string,
    updates: Partial<Pick<TerminalSessionState, 'title' | 'isCLIMode' | 'claudeSessionId' | 'daemonPtyId'>>
  ): void {
    const session = this.sessions.get(id);
    if (!session) return;

    Object.assign(session, updates);
    session.lastActiveAt = Date.now();
    this.scheduleSave();
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): TerminalSessionState | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): TerminalSessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Remove a session
   */
  removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session?.bufferFile) {
      this.deleteBufferFile(session.bufferFile);
    }
    this.sessions.delete(id);
    this.scheduleSave();
  }

  /**
   * Save buffer content to disk
   */
  saveBuffer(sessionId: string, serializedBuffer: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[SessionPersistence] Cannot save buffer - session ${sessionId} not found`);
      return;
    }

    const bufferFile = `buffer-${sessionId}.txt`;
    const bufferPath = path.join(BUFFERS_DIR, bufferFile);

    try {
      fs.writeFileSync(bufferPath, serializedBuffer, 'utf8');
      session.bufferFile = bufferFile;
      this.saveSession(session);
      console.warn(`[SessionPersistence] Saved buffer for session ${sessionId} (${serializedBuffer.length} bytes)`);
    } catch (error) {
      console.error(`[SessionPersistence] Failed to save buffer for ${sessionId}:`, error);
    }
  }

  /**
   * Load buffer content from disk
   */
  loadBuffer(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session?.bufferFile) return null;

    const bufferPath = path.join(BUFFERS_DIR, session.bufferFile);
    if (!fs.existsSync(bufferPath)) {
      console.warn(`[SessionPersistence] Buffer file missing: ${session.bufferFile}`);
      return null;
    }

    try {
      return fs.readFileSync(bufferPath, 'utf8');
    } catch (error) {
      console.error(`[SessionPersistence] Failed to load buffer for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Delete a buffer file
   */
  private deleteBufferFile(bufferFile: string): void {
    const bufferPath = path.join(BUFFERS_DIR, bufferFile);
    if (fs.existsSync(bufferPath)) {
      try {
        fs.unlinkSync(bufferPath);
        console.warn(`[SessionPersistence] Deleted buffer file: ${bufferFile}`);
      } catch (error) {
        console.error(`[SessionPersistence] Failed to delete buffer file ${bufferFile}:`, error);
      }
    }
  }

  /**
   * Debounced save to prevent excessive disk I/O
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveToDisk();
    }, 1000); // 1 second debounce
  }

  /**
   * Immediate save (call before app quit)
   */
  saveNow(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveToDisk();
  }

  /**
   * Perform the actual disk write
   */
  private saveToDisk(): void {
    const data: TerminalSessionsFile = {
      version: 2,
      savedAt: Date.now(),
      sessions: Array.from(this.sessions.values()),
    };

    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
      console.warn(`[SessionPersistence] Saved ${data.sessions.length} sessions to disk`);
    } catch (error) {
      console.error('[SessionPersistence] Failed to save sessions:', error);
    }
  }

  /**
   * Clean up old buffer files not referenced by any session
   */
  cleanupOrphanedBuffers(): void {
    if (!fs.existsSync(BUFFERS_DIR)) return;

    try {
      const bufferFiles = fs.readdirSync(BUFFERS_DIR);
      const referencedBuffers = new Set(
        Array.from(this.sessions.values())
          .map((s) => s.bufferFile)
          .filter((f): f is string => !!f)
      );

      let cleanedCount = 0;
      for (const file of bufferFiles) {
        if (!referencedBuffers.has(file)) {
          const filePath = path.join(BUFFERS_DIR, file);
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.warn(`[SessionPersistence] Cleaned up ${cleanedCount} orphaned buffer files`);
      }
    } catch (error) {
      console.error('[SessionPersistence] Failed to cleanup orphaned buffers:', error);
    }
  }
}

// Singleton instance
export const sessionPersistence = new SessionPersistence();

// Hook into app lifecycle
app.on('before-quit', () => {
  console.warn('[SessionPersistence] App quitting, saving sessions...');
  sessionPersistence.saveNow();
});

app.on('will-quit', () => {
  sessionPersistence.saveNow();
});

// Cleanup orphaned buffers on startup (after initial load)
app.whenReady().then(() => {
  setTimeout(() => {
    sessionPersistence.cleanupOrphanedBuffers();
  }, 5000); // Wait 5 seconds after app ready
});
