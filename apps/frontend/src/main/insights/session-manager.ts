import type { InsightsSession, InsightsSessionSummary, InsightsModelConfig } from '../../shared/types';
import { SessionStorage } from './session-storage';
import { InsightsPaths } from './paths';

/**
 * Session manager
 * Manages in-memory session cache and coordinates with session storage
 */
export class SessionManager {
  private sessions: Map<string, InsightsSession> = new Map();
  private storage: SessionStorage;

  constructor(storage: SessionStorage, _paths: InsightsPaths) {
    this.storage = storage;
    // Note: paths parameter kept for API compatibility but not currently used
  }

  /**
   * Load current session from disk or cache
   */
  loadSession(projectId: string, projectPath: string): InsightsSession | null {
    // Check in-memory cache first
    if (this.sessions.has(projectId)) {
      return this.sessions.get(projectId)!;
    }

    // Migrate old format if needed
    this.storage.migrateOldSession(projectPath);

    const currentSessionId = this.storage.getCurrentSessionId(projectPath);
    if (!currentSessionId) return null;

    const session = this.storage.loadSessionById(projectPath, currentSessionId);
    if (session) {
      this.sessions.set(projectId, session);
    }
    return session;
  }

  /**
   * List all sessions for a project
   */
  listSessions(projectPath: string): InsightsSessionSummary[] {
    // Migrate old format if needed
    this.storage.migrateOldSession(projectPath);
    return this.storage.listSessions(projectPath);
  }

  /**
   * Create a new session
   */
  createNewSession(projectId: string, projectPath: string): InsightsSession {
    const sessionId = `session-${Date.now()}`;
    const session: InsightsSession = {
      id: sessionId,
      projectId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save new session
    this.storage.saveSession(projectPath, session);
    this.storage.saveCurrentSessionId(projectPath, sessionId);
    this.sessions.set(projectId, session);

    return session;
  }

  /**
   * Switch to a different session
   */
  switchSession(projectId: string, projectPath: string, sessionId: string): InsightsSession | null {
    const session = this.storage.loadSessionById(projectPath, sessionId);
    if (session) {
      this.storage.saveCurrentSessionId(projectPath, sessionId);
      this.sessions.set(projectId, session);
    }
    return session;
  }

  /**
   * Delete a session
   */
  deleteSession(projectId: string, projectPath: string, sessionId: string): boolean {
    const success = this.storage.deleteSession(projectPath, sessionId);
    if (!success) return false;

    // If this was the current session, clear the cache
    const currentSession = this.sessions.get(projectId);
    if (currentSession?.id === sessionId) {
      this.sessions.delete(projectId);

      // Find another session to switch to, or create new
      const remaining = this.listSessions(projectPath);
      if (remaining.length > 0) {
        this.switchSession(projectId, projectPath, remaining[0].id);
      } else {
        // Clear current session pointer
        this.storage.clearCurrentSessionId(projectPath);
      }
    }

    return true;
  }

  /**
   * Rename a session
   */
  renameSession(projectPath: string, sessionId: string, newTitle: string): boolean {
    const session = this.storage.loadSessionById(projectPath, sessionId);
    if (!session) return false;

    session.title = newTitle;
    session.updatedAt = new Date();
    this.storage.saveSession(projectPath, session);
    return true;
  }

  /**
   * Update model configuration for a session
   */
  updateSessionModelConfig(projectPath: string, sessionId: string, modelConfig: InsightsModelConfig): boolean {
    const session = this.storage.loadSessionById(projectPath, sessionId);
    if (!session) return false;

    session.modelConfig = modelConfig;
    session.updatedAt = new Date();
    this.storage.saveSession(projectPath, session);

    // Update cache if this session is cached
    for (const [projectId, cachedSession] of this.sessions) {
      if (cachedSession.id === sessionId) {
        cachedSession.modelConfig = modelConfig;
        cachedSession.updatedAt = new Date();
        this.sessions.set(projectId, cachedSession);
        break;
      }
    }

    return true;
  }

  /**
   * Save session to disk and update cache
   */
  saveSession(projectPath: string, session: InsightsSession): void {
    this.storage.saveSession(projectPath, session);
    this.sessions.set(session.projectId, session);
  }

  /**
   * Clear current session (create a new one)
   */
  clearSession(projectId: string, projectPath: string): void {
    const newSession = this.createNewSession(projectId, projectPath);
    this.sessions.set(projectId, newSession);
  }

  /**
   * Get cached session without loading from disk
   */
  getCachedSession(projectId: string): InsightsSession | null {
    return this.sessions.get(projectId) || null;
  }

  /**
   * Clear session from cache
   */
  clearCache(projectId: string): void {
    this.sessions.delete(projectId);
  }
}
