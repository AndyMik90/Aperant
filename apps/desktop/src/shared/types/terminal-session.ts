/**
 * Terminal Session State for Persistence
 *
 * This provides the comprehensive state needed for session restoration
 * across app restarts, crashes, and hot reloads.
 */

export interface TerminalSessionState {
  // Identity
  id: string;
  title: string;

  // Process configuration (for recreation)
  shell: string;
  shellArgs: string[];
  cwd: string;
  env: Record<string, string>;

  // Display state
  rows: number;
  cols: number;

  // Claude Code specific
  isCLIMode: boolean;
  claudeSessionId?: string;  // For potential /resume

  // Timing
  createdAt: number;
  lastActiveAt: number;

  // Persistence metadata
  bufferFile?: string;  // Reference to serialized buffer file

  // Daemon reference
  daemonPtyId?: string;  // ID of PTY in daemon process

  // Project context
  projectPath?: string;
}

export interface TerminalSessionsFile {
  version: 2;
  savedAt: number;
  sessions: TerminalSessionState[];
}

/**
 * Recovery information for session restoration UI
 */
export interface TerminalRecoveryInfo {
  totalSessions: number;
  recoverableSessions: number;
  recoveryMethod: 'daemon' | 'state' | 'none';
  sessions: Array<{
    id: string;
    title: string;
    isCLIMode: boolean;
    lastActiveAt: number;
    hasBuffer: boolean;
    hasDaemonPty: boolean;
  }>;
}

/**
 * Result of session recovery attempt
 */
export interface SessionRecoveryResult {
  sessionId: string;
  success: boolean;
  method: 'daemon-reconnect' | 'state-restore' | 'failed';
  error?: string;
  restoredBuffer: boolean;
  restoredProcess: boolean;
}
