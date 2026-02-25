import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import type { InsightsSession, InsightsSessionSummary, ImageAttachment } from '../../shared/types';
import { InsightsPaths } from './paths';

/**
 * Session storage manager
 * Handles persisting and loading sessions from the filesystem
 */
export class SessionStorage {
  private paths: InsightsPaths;

  constructor(paths: InsightsPaths) {
    this.paths = paths;
  }

  /**
   * Generate a title from the first user message
   */
  generateTitle(message: string): string {
    // Truncate to first 50 characters and clean up
    const title = message.trim().replace(/\n/g, ' ').slice(0, 50);
    return title.length < message.trim().length ? `${title}...` : title;
  }

  /**
   * Load a specific session from disk
   */
  loadSessionById(projectPath: string, sessionId: string): InsightsSession | null {
    try {
      const sessionPath = this.paths.getSessionPath(projectPath, sessionId);
      if (!existsSync(sessionPath)) return null;

      const content = readFileSync(sessionPath, 'utf-8');
      const session = JSON.parse(content) as InsightsSession;
      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);
      if (session.archivedAt) {
        session.archivedAt = new Date(session.archivedAt);
      }
      session.messages = session.messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
        // Convert toolsUsed timestamps if present
        toolsUsed: m.toolsUsed?.map(t => ({
          ...t,
          timestamp: new Date(t.timestamp)
        }))
      }));
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Save session to disk
   */
  saveSession(projectPath: string, session: InsightsSession): void {
    try {
      const sessionsDir = this.paths.getSessionsDir(projectPath);
      if (!existsSync(sessionsDir)) {
        mkdirSync(sessionsDir, { recursive: true });
      }

      const sessionPath = this.paths.getSessionPath(projectPath, session.id);
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[SessionStorage] Failed to save session ${session.id}:`, error);
      throw error;
    }
  }

  /**
   * Archive a session
   */
  archiveSession(projectPath: string, sessionId: string): boolean {
    const session = this.loadSessionById(projectPath, sessionId);
    if (!session) return false;

    try {
      session.archivedAt = new Date();
      this.saveSession(projectPath, session);
      return true;
    } catch (error) {
      console.error(`[SessionStorage] Failed to archive session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Unarchive a session
   */
  unarchiveSession(projectPath: string, sessionId: string): boolean {
    const session = this.loadSessionById(projectPath, sessionId);
    if (!session) return false;

    try {
      delete session.archivedAt;
      this.saveSession(projectPath, session);
      return true;
    } catch (error) {
      console.error(`[SessionStorage] Failed to unarchive session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple sessions
   */
  deleteSessions(projectPath: string, sessionIds: string[]): { deletedIds: string[]; failedIds: string[] } {
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    for (const sessionId of sessionIds) {
      if (this.deleteSession(projectPath, sessionId)) {
        deletedIds.push(sessionId);
      } else {
        failedIds.push(sessionId);
      }
    }

    return { deletedIds, failedIds };
  }

  /**
   * Archive multiple sessions
   */
  archiveSessions(projectPath: string, sessionIds: string[]): { archivedIds: string[]; failedIds: string[] } {
    const archivedIds: string[] = [];
    const failedIds: string[] = [];

    for (const sessionId of sessionIds) {
      if (this.archiveSession(projectPath, sessionId)) {
        archivedIds.push(sessionId);
      } else {
        failedIds.push(sessionId);
      }
    }

    return { archivedIds, failedIds };
  }

  /**
   * Delete a session from disk
   */
  deleteSession(projectPath: string, sessionId: string): boolean {
    try {
      const sessionPath = this.paths.getSessionPath(projectPath, sessionId);
      if (!existsSync(sessionPath)) return false;

      unlinkSync(sessionPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all sessions for a project
   */
  listSessions(projectPath: string, includeArchived = false): InsightsSessionSummary[] {
    const sessionsDir = this.paths.getSessionsDir(projectPath);
    if (!existsSync(sessionsDir)) return [];

    try {
      const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      const sessions: InsightsSessionSummary[] = [];

      for (const file of files) {
        try {
          const content = readFileSync(path.join(sessionsDir, file), 'utf-8');
          const session = JSON.parse(content) as InsightsSession;

          // Generate title if not present
          let title = session.title;
          if (!title && session.messages.length > 0) {
            const firstUserMessage = session.messages.find(m => m.role === 'user');
            title = firstUserMessage
              ? this.generateTitle(firstUserMessage.content)
              : 'Untitled Conversation';
          }

          // Skip archived sessions unless explicitly included
          if (!includeArchived && session.archivedAt) {
            continue;
          }

          sessions.push({
            id: session.id,
            projectId: session.projectId,
            title: title || 'New Conversation',
            messageCount: session.messages.length,
            modelConfig: session.modelConfig,
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
            ...(session.archivedAt ? { archivedAt: new Date(session.archivedAt) } : {})
          });
        } catch {
          // Skip invalid session files
        }
      }

      // Sort by updatedAt descending (most recent first)
      return sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * Get current session ID for a project
   */
  getCurrentSessionId(projectPath: string): string | null {
    const currentPath = this.paths.getCurrentSessionPath(projectPath);
    if (!existsSync(currentPath)) return null;

    try {
      const content = readFileSync(currentPath, 'utf-8');
      const data = JSON.parse(content);
      return data.currentSessionId || null;
    } catch {
      return null;
    }
  }

  /**
   * Save current session ID pointer
   */
  saveCurrentSessionId(projectPath: string, sessionId: string): void {
    const insightsDir = this.paths.getInsightsDir(projectPath);
    if (!existsSync(insightsDir)) {
      mkdirSync(insightsDir, { recursive: true });
    }

    const currentPath = this.paths.getCurrentSessionPath(projectPath);
    writeFileSync(currentPath, JSON.stringify({ currentSessionId: sessionId }, null, 2), 'utf-8');
  }

  /**
   * Clear current session pointer
   */
  clearCurrentSessionId(projectPath: string): void {
    const currentPath = this.paths.getCurrentSessionPath(projectPath);
    if (existsSync(currentPath)) {
      unlinkSync(currentPath);
    }
  }

  /**
   * Strip full-resolution image data from a session for persistence.
   * Keeps only thumbnail, id, filename, mimeType, and size to prevent bloated JSON files.
   */
  private stripImageDataForPersistence(session: InsightsSession): InsightsSession {
    return {
      ...session,
      messages: session.messages.map(m => {
        if (!m.images || m.images.length === 0) return m;
        return {
          ...m,
          images: m.images.map(({ data, path: _path, ...rest }: ImageAttachment) => rest)
        };
      })
    };
  }

  /**
   * Migrate old session format to new multi-session format
   */
  migrateOldSession(projectPath: string): void {
    const oldSessionPath = this.paths.getOldSessionPath(projectPath);
    if (!existsSync(oldSessionPath)) return;

    try {
      const content = readFileSync(oldSessionPath, 'utf-8');
      const oldSession = JSON.parse(content) as InsightsSession;

      // Only migrate if it has messages
      if (oldSession.messages && oldSession.messages.length > 0) {
        // Ensure sessions directory exists
        const sessionsDir = this.paths.getSessionsDir(projectPath);
        if (!existsSync(sessionsDir)) {
          mkdirSync(sessionsDir, { recursive: true });
        }

        // Generate title from first user message
        const firstUserMessage = oldSession.messages.find(m => m.role === 'user');
        const title = firstUserMessage
          ? this.generateTitle(firstUserMessage.content)
          : 'Imported Conversation';

        // Create new session with title
        const newSession: InsightsSession = {
          ...oldSession,
          title
        };

        // Save as new session file
        this.saveSession(projectPath, newSession);

        // Set as current session
        this.saveCurrentSessionId(projectPath, oldSession.id);
      }

      // Remove old session file
      unlinkSync(oldSessionPath);
    } catch {
      // Ignore migration errors
    }
  }
}
