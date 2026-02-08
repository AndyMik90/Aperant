/**
 * Terminal Manager
 * Main orchestrator for terminal lifecycle, Claude integration, and profile management
 */

import type { TerminalCreateOptions } from '../../shared/types';
import type { TerminalSession } from '../terminal-session-store';

// Internal modules
import type {
  TerminalProcess,
  WindowGetter,
  TerminalOperationResult
} from './types';
import * as PtyManager from './pty-manager';
import * as SessionHandler from './session-handler';
import * as TerminalLifecycle from './terminal-lifecycle';
import * as TerminalEventHandler from './terminal-event-handler';
import * as ClaudeIntegration from './claude-integration-handler';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

export class TerminalManager {
  private terminals: Map<string, TerminalProcess> = new Map();
  private getWindow: WindowGetter;
  private saveTimer: NodeJS.Timeout | null = null;
  private isSaving = false; // Mutex to prevent concurrent persistence writes
  private lastNotifiedRateLimitReset: Map<string, string> = new Map();
  private eventCallbacks: TerminalEventHandler.EventHandlerCallbacks;

  constructor(getWindow: WindowGetter) {
    this.getWindow = getWindow;

    // Create event callbacks with bound context
    this.eventCallbacks = TerminalEventHandler.createEventCallbacks(
      this.getWindow,
      this.lastNotifiedRateLimitReset,
      async (terminalId, profileId) => {
        await this.switchClaudeProfile(terminalId, profileId);
      }
    );

    // Periodically save session data (every 30 seconds)
    // Uses a mutex to prevent concurrent writes if persistence takes >30s
    this.saveTimer = setInterval(() => {
      if (this.isSaving) {
        debugLog('[TerminalManager] Skipping save — previous persistence still in progress');
        return;
      }
      this.isSaving = true;
      SessionHandler.persistAllSessionsAsync(this.terminals)
        .catch((error) => {
          console.error('[TerminalManager] Failed to persist sessions:', error);
        })
        .finally(() => {
          this.isSaving = false;
        });
    }, 30000);
  }

  /**
   * Create a new terminal process
   */
  async create(
    options: TerminalCreateOptions & { projectPath?: string }
  ): Promise<TerminalOperationResult> {
    return TerminalLifecycle.createTerminal(
      options,
      this.terminals,
      this.getWindow,
      (terminal, data) => this.handleTerminalData(terminal, data)
    );
  }

  /**
   * Restore a terminal session
   */
  async restore(
    session: TerminalSession,
    cols = 80,
    rows = 24
  ): Promise<TerminalOperationResult> {
    return TerminalLifecycle.restoreTerminal(
      session,
      this.terminals,
      this.getWindow,
      (terminal, data) => this.handleTerminalData(terminal, data),
      {
        resumeClaudeSession: true,
        captureSessionId: (terminalId, projectPath, startTime) => {
          SessionHandler.captureClaudeSessionId(
            terminalId,
            projectPath,
            startTime,
            this.terminals,
            this.getWindow
          );
        },
        onResumeNeeded: (terminalId, sessionId) => {
          // Use async version to avoid blocking main process
          this.resumeClaudeAsync(terminalId, sessionId).catch((error) => {
            debugError('[terminal-manager] Failed to resume Claude session:', error);
          });
        }
      },
      cols,
      rows
    );
  }

  /**
   * Destroy a terminal process
   */
  async destroy(id: string): Promise<TerminalOperationResult> {
    return TerminalLifecycle.destroyTerminal(
      id,
      this.terminals,
      (terminalId) => {
        this.lastNotifiedRateLimitReset.delete(terminalId);
      }
    );
  }

  /**
   * Kill all terminal processes
   */
  async killAll(): Promise<void> {
    this.saveTimer = await TerminalLifecycle.destroyAllTerminals(
      this.terminals,
      this.saveTimer
    );
  }

  /**
   * Send input to a terminal
   */
  write(id: string, data: string): void {
    if (process.env.DEBUG === 'true') {
      debugLog('[TerminalManager:write] Writing to terminal:', id, 'data length:', data.length);
    }
    const terminal = this.terminals.get(id);
    if (terminal) {
      if (process.env.DEBUG === 'true') {
        debugLog('[TerminalManager:write] Terminal found, calling writeToPty...');
      }
      PtyManager.writeToPty(terminal, data);
      if (process.env.DEBUG === 'true') {
        debugLog('[TerminalManager:write] writeToPty completed');
      }
    } else {
      debugError('[TerminalManager:write] Terminal NOT found:', id);
    }
  }

  /**
   * Resize a terminal
   */
  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      PtyManager.resizePty(terminal, cols, rows);
    }
  }

  /**
   * Invoke Claude in a terminal with optional profile override (async - non-blocking)
   */
  async invokeClaudeAsync(id: string, cwd?: string, profileId?: string, dangerouslySkipPermissions?: boolean): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }

    await ClaudeIntegration.invokeClaudeAsync(
      terminal,
      cwd,
      profileId,
      this.getWindow,
      (terminalId, projectPath, startTime) => {
        SessionHandler.captureClaudeSessionId(
          terminalId,
          projectPath,
          startTime,
          this.terminals,
          this.getWindow
        );
      },
      dangerouslySkipPermissions
    );
  }

  /**
   * Invoke Claude in a terminal with optional profile override
   * @deprecated Use invokeClaudeAsync for non-blocking behavior
   */
  invokeClaude(id: string, cwd?: string, profileId?: string, dangerouslySkipPermissions?: boolean): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }

    ClaudeIntegration.invokeClaude(
      terminal,
      cwd,
      profileId,
      this.getWindow,
      (terminalId, projectPath, startTime) => {
        SessionHandler.captureClaudeSessionId(
          terminalId,
          projectPath,
          startTime,
          this.terminals,
          this.getWindow
        );
      },
      dangerouslySkipPermissions
    );
  }

  /**
   * Switch a terminal to a different Claude profile
   */
  async switchClaudeProfile(id: string, profileId: string): Promise<TerminalOperationResult> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return { success: false, error: 'Terminal not found' };
    }

    return ClaudeIntegration.switchClaudeProfile(
      terminal,
      profileId,
      this.getWindow,
      async (terminalId, cwd, profileId, dangerouslySkipPermissions) => this.invokeClaudeAsync(terminalId, cwd, profileId, dangerouslySkipPermissions),
      (terminalId) => this.lastNotifiedRateLimitReset.delete(terminalId)
    );
  }

  /**
   * Resume Claude in a terminal asynchronously (non-blocking)
   */
  async resumeClaudeAsync(id: string, sessionId?: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }

    await ClaudeIntegration.resumeClaudeAsync(terminal, sessionId, this.getWindow);
  }

  /**
   * Activate deferred Claude resume for a terminal
   * Called when a terminal with pendingClaudeResume becomes active (user views it)
   */
  async activateDeferredResume(id: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }

    // Check if terminal has a pending resume
    if (!terminal.pendingClaudeResume) {
      return;
    }

    // Clear the pending flag
    terminal.pendingClaudeResume = false;

    // Now actually resume Claude
    await ClaudeIntegration.resumeClaudeAsync(terminal, undefined, this.getWindow);
  }

  /**
   * Resume Claude in a terminal with a specific session ID
   * @deprecated Use resumeClaudeAsync for non-blocking behavior
   */
  resumeClaude(id: string, sessionId?: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }

    ClaudeIntegration.resumeClaude(terminal, sessionId, this.getWindow);
  }

  /**
   * Get saved sessions for a project
   */
  getSavedSessions(projectPath: string): TerminalSession[] {
    return SessionHandler.getSavedSessions(projectPath);
  }

  /**
   * Clear saved sessions for a project
   */
  clearSavedSessions(projectPath: string): void {
    SessionHandler.clearSavedSessions(projectPath);
  }

  /**
   * Get available session dates
   */
  getAvailableSessionDates(projectPath?: string): import('../terminal-session-store').SessionDateInfo[] {
    return SessionHandler.getAvailableSessionDates(projectPath);
  }

  /**
   * Get sessions for a specific date
   */
  getSessionsForDate(date: string, projectPath: string): TerminalSession[] {
    return SessionHandler.getSessionsForDate(date, projectPath);
  }

  /**
   * Update display orders for terminals after drag-drop reorder
   */
  updateDisplayOrders(
    projectPath: string,
    orders: Array<{ terminalId: string; displayOrder: number }>
  ): void {
    SessionHandler.updateDisplayOrders(projectPath, orders);
  }

  /**
   * Restore all sessions from a specific date
   */
  async restoreSessionsFromDate(
    date: string,
    projectPath: string,
    cols = 80,
    rows = 24
  ): Promise<{ restored: number; failed: number; sessions: Array<{ id: string; success: boolean; error?: string }> }> {
    return TerminalLifecycle.restoreSessionsFromDate(
      date,
      projectPath,
      this.terminals,
      this.getWindow,
      (terminal, data) => this.handleTerminalData(terminal, data),
      {
        resumeClaudeSession: true,
        captureSessionId: (terminalId, projectPath, startTime) => {
          SessionHandler.captureClaudeSessionId(
            terminalId,
            projectPath,
            startTime,
            this.terminals,
            this.getWindow
          );
        },
        onResumeNeeded: (terminalId, sessionId) => {
          // Use async version to avoid blocking main process
          this.resumeClaudeAsync(terminalId, sessionId).catch((error) => {
            debugError('[terminal-manager] Failed to resume Claude session:', error);
          });
        }
      },
      cols,
      rows
    );
  }

  /**
   * Get all active terminal IDs
   */
  getActiveTerminalIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /**
   * Check if a terminal is in Claude mode
   */
  isClaudeMode(id: string): boolean {
    const terminal = this.terminals.get(id);
    return terminal?.isClaudeMode ?? false;
  }

  /**
   * Get Claude session ID for a terminal
   */
  getClaudeSessionId(id: string): string | undefined {
    const terminal = this.terminals.get(id);
    return terminal?.claudeSessionId;
  }

  /**
   * Update terminal title
   */
  setTitle(id: string, title: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.title = title;
    }
  }

  /**
   * Update terminal worktree config
   */
  setWorktreeConfig(id: string, config: import('../../shared/types').TerminalWorktreeConfig | undefined): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.worktreeConfig = config;
      // Persist immediately when worktree config changes (async to avoid blocking)
      if (terminal.projectPath) {
        SessionHandler.persistSessionAsync(terminal);
      }
    }
  }

  /**
   * Check if a terminal's PTY process is alive
   */
  isTerminalAlive(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  /**
   * Handle terminal data output
   */
  private handleTerminalData(terminal: TerminalProcess, data: string): void {
    TerminalEventHandler.handleTerminalData(terminal, data, this.eventCallbacks);
  }
}
