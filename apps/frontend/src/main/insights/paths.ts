import path from 'path';

const INSIGHTS_DIR = '.auto-claude/insights';
const SESSIONS_DIR = 'sessions';
const CURRENT_SESSION_FILE = 'current_session.json';

/**
 * Path utilities for insights service
 * Provides consistent path resolution for sessions and insights data
 */
export class InsightsPaths {
  /**
   * Get insights directory path for a project
   */
  getInsightsDir(projectPath: string): string {
    return path.join(projectPath, INSIGHTS_DIR);
  }

  /**
   * Get sessions directory path for a project
   */
  getSessionsDir(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), SESSIONS_DIR);
  }

  /**
   * Validate that a session ID matches the expected safe pattern.
   * Prevents path traversal attacks via crafted session IDs.
   */
  private validateSessionId(sessionId: string): void {
    if (!/^session-\d{1,20}$/.test(sessionId)) {
      throw new Error('Invalid session ID format');
    }
  }

  /**
   * Get session file path for a specific session
   */
  getSessionPath(projectPath: string, sessionId: string): string {
    this.validateSessionId(sessionId);
    return path.join(this.getSessionsDir(projectPath), `${sessionId}.json`);
  }

  /**
   * Get current session pointer file path
   */
  getCurrentSessionPath(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), CURRENT_SESSION_FILE);
  }

  /**
   * Get old session path for migration
   */
  getOldSessionPath(projectPath: string): string {
    return path.join(this.getInsightsDir(projectPath), 'session.json');
  }
}
