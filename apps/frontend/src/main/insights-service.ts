import { EventEmitter } from 'events';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsModelConfig
} from '../shared/types';
import { InsightsConfig } from './insights/config';
import { InsightsPaths } from './insights/paths';
import { SessionStorage } from './insights/session-storage';
import { SessionManager } from './insights/session-manager';
import { InsightsExecutor } from './insights/insights-executor';
import { MemoryStorage } from './insights/memory-storage';

/**
 * Service for AI-powered codebase insights chat
 *
 * This service coordinates between multiple specialized modules:
 * - InsightsConfig: Manages configuration and environment
 * - InsightsPaths: Provides consistent path resolution
 * - SessionStorage: Handles filesystem persistence
 * - SessionManager: Manages session lifecycle and cache
 * - InsightsExecutor: Executes Python insights runner
 */
export class InsightsService extends EventEmitter {
  private config: InsightsConfig;
  private paths: InsightsPaths;
  private storage: SessionStorage;
  private sessionManager: SessionManager;
  private executor: InsightsExecutor;
  private memory: MemoryStorage;

  constructor() {
    super();

    // Initialize modules
    this.config = new InsightsConfig();
    this.paths = new InsightsPaths();
    this.storage = new SessionStorage(this.paths);
    this.sessionManager = new SessionManager(this.storage, this.paths);
    this.executor = new InsightsExecutor(this.config);
    this.memory = new MemoryStorage(this.paths);

    // Forward executor events
    this.executor.on('status', (projectId, status) => {
      this.emit('status', projectId, status);
    });
    this.executor.on('stream-chunk', (projectId, chunk) => {
      // Persist memory saves before forwarding to renderer
      if (chunk.type === 'memory_save' && chunk.memorySave) {
        try {
          const { projectStore } = require('./project-store');
          const project = projectStore.getProject(projectId);
          if (project) {
            this.memory.appendMemory(
              project.path,
              chunk.memorySave.section,
              chunk.memorySave.content,
              `Session ${new Date().toISOString().split('T')[0]}`
            );
          }
        } catch { /* non-critical */ }
      }
      this.emit('stream-chunk', projectId, chunk);
    });
    this.executor.on('error', (projectId, error) => {
      this.emit('error', projectId, error);
    });
    this.executor.on('sdk-rate-limit', (info) => {
      this.emit('sdk-rate-limit', info);
    });
  }

  /**
   * Configure paths for Python and ac-jerry source
   */
  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    this.config.configure(pythonPath, autoBuildSourcePath);
  }

  /**
   * Load current session from disk or cache
   */
  loadSession(projectId: string, projectPath: string): InsightsSession | null {
    return this.sessionManager.loadSession(projectId, projectPath);
  }

  /**
   * List all sessions for a project
   */
  listSessions(projectPath: string): InsightsSessionSummary[] {
    return this.sessionManager.listSessions(projectPath);
  }

  /**
   * Create a new session
   */
  createNewSession(projectId: string, projectPath: string): InsightsSession {
    return this.sessionManager.createNewSession(projectId, projectPath);
  }

  /**
   * Switch to a different session
   */
  switchSession(projectId: string, projectPath: string, sessionId: string): InsightsSession | null {
    return this.sessionManager.switchSession(projectId, projectPath, sessionId);
  }

  /**
   * Delete a session
   */
  deleteSession(projectId: string, projectPath: string, sessionId: string): boolean {
    return this.sessionManager.deleteSession(projectId, projectPath, sessionId);
  }

  /**
   * Rename a session
   */
  renameSession(projectPath: string, sessionId: string, newTitle: string): boolean {
    return this.sessionManager.renameSession(projectPath, sessionId, newTitle);
  }

  /**
   * Load a specific session by ID (for export)
   */
  getSessionById(projectPath: string, sessionId: string): InsightsSession | null {
    return this.storage.loadSessionById(projectPath, sessionId);
  }

  /**
   * Export a session as markdown
   */
  exportSessionAsMarkdown(session: InsightsSession): string {
    return this.storage.exportSessionAsMarkdown(session);
  }

  /**
   * Load persistent memory for a project
   */
  loadMemory(projectPath: string): string | null {
    return this.memory.loadMemory(projectPath);
  }

  /**
   * Append to persistent memory
   */
  appendMemory(projectPath: string, section: string, content: string, source: string): boolean {
    return this.memory.appendMemory(projectPath, section, content, source);
  }

  /**
   * Clear persistent memory
   */
  clearMemory(projectPath: string): void {
    this.memory.clearMemory(projectPath);
  }

  /**
   * Clear current session (delete messages but keep the session)
   */
  clearSession(projectId: string, projectPath: string): void {
    this.sessionManager.clearSession(projectId, projectPath);
  }

  /**
   * Send a message and get AI response
   */
  async sendMessage(
    projectId: string,
    projectPath: string,
    message: string,
    modelConfig?: InsightsModelConfig,
    imagePaths?: string[]
  ): Promise<void> {
    // Cancel any existing session
    this.executor.cancelSession(projectId);

    // Validate ac-jerry source
    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      this.emit('error', projectId, 'AC Jerry source not found');
      return;
    }

    // Load or create session
    let session = this.sessionManager.loadSession(projectId, projectPath);
    if (!session) {
      session = this.sessionManager.createNewSession(projectId, projectPath);
    }

    // Auto-generate title from first user message if still default
    if (session.messages.length === 0 && session.title === 'New Conversation') {
      session.title = this.storage.generateTitle(message);
    }

    // Add user message
    const userMessage: InsightsChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    session.messages.push(userMessage);
    session.updatedAt = new Date();
    this.sessionManager.saveSession(projectPath, session);

    // Build conversation history for context
    const conversationHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Use provided modelConfig or fall back to session's config
    const configToUse = modelConfig || session.modelConfig;

    // Load persistent memory for context
    const memoryContext = this.memory.loadMemory(projectPath) || undefined;

    try {
      // Execute insights query
      const result = await this.executor.execute(
        projectId,
        projectPath,
        message,
        conversationHistory,
        configToUse,
        imagePaths,
        memoryContext
      );

      // Add assistant message(s) to session
      // When multiple task suggestions exist, create separate messages for each
      // so they all persist correctly on reload (fixes bug where only last survives)
      if (result.suggestedTasks.length > 1) {
        const now = Date.now();
        // Create one message per suggestion with its preceding text
        result.suggestedTasks.forEach(({ task, textBefore }, idx) => {
          const msg: InsightsChatMessage = {
            id: `msg-${now}-${idx}`,
            role: 'assistant',
            content: textBefore,
            timestamp: new Date(),
            suggestedTask: task,
            toolsUsed: idx === 0 && result.toolsUsed.length > 0 ? result.toolsUsed : undefined
          };
          session.messages.push(msg);
        });
        // Add trailing text after last suggestion (if any)
        if (result.trailingText) {
          session.messages.push({
            id: `msg-${now}-trail`,
            role: 'assistant',
            content: result.trailingText,
            timestamp: new Date()
          });
        }
      } else {
        // Single or no suggestion: create one message as before
        const assistantMessage: InsightsChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: result.fullResponse,
          timestamp: new Date(),
          suggestedTask: result.suggestedTask,
          toolsUsed: result.toolsUsed.length > 0 ? result.toolsUsed : undefined
        };
        session.messages.push(assistantMessage);
      }

      session.updatedAt = new Date();
      this.sessionManager.saveSession(projectPath, session);
    } catch (error) {
      // Error already emitted by executor
      console.error('[InsightsService] Error executing insights:', error);
    }
  }

  /**
   * Update model configuration for a session
   */
  updateSessionModelConfig(projectPath: string, sessionId: string, modelConfig: InsightsModelConfig): boolean {
    return this.sessionManager.updateSessionModelConfig(projectPath, sessionId, modelConfig);
  }

  /**
   * Cancel an active insights generation session.
   * Returns true if a session was found and canceled, false if no active session.
   */
  cancelSession(projectId: string): boolean {
    return this.executor.cancelSession(projectId);
  }

  /**
   * Mark a message's task as created (persists across navigation/app restart)
   */
  markTaskCreated(projectPath: string, sessionId: string, messageId: string, taskId: string): boolean {
    return this.sessionManager.markTaskCreated(projectPath, sessionId, messageId, taskId);
  }
}

// Singleton instance
export const insightsService = new InsightsService();
