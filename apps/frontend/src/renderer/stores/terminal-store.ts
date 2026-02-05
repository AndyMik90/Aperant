import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { arrayMove } from '@dnd-kit/sortable';
import type { TerminalSession, TerminalWorktreeConfig, StructuredBlock } from '../../shared/types';
import { terminalBufferManager } from '../lib/terminal-buffer-manager';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import type { ParsedMessage, ContentBlock, ToolUseContent } from '../lib/claude-output-parser';
import { ClaudeOutputParser } from '../lib/claude-output-parser';

/**
 * Module-level Map to store terminal ID -> xterm write callback mappings.
 *
 * DESIGN NOTE: This is stored outside of Zustand state because:
 * 1. Callbacks are functions and shouldn't be serialized in state
 * 2. The callbacks need to be accessible from the global terminal listener
 * 3. Registration/unregistration happens on terminal mount/unmount, not state changes
 *
 * When a terminal component mounts, it registers its xterm.write function here.
 * When the global terminal output listener receives data, it calls the callback
 * if registered (terminal is visible), otherwise just buffers the data.
 * This allows output to be written to xterm immediately when visible, while
 * still buffering when the terminal is not rendered (project switched away).
 */
const xtermCallbacks = new Map<string, (data: string) => void>();

/**
 * Register an xterm write callback for a terminal.
 * Called when a terminal component mounts and xterm is ready.
 *
 * @param terminalId - The terminal ID
 * @param callback - Function to write data to xterm instance
 */
export function registerOutputCallback(
  terminalId: string,
  callback: (data: string) => void
): void {
  xtermCallbacks.set(terminalId, callback);
  debugLog(`[TerminalStore] Registered output callback for terminal: ${terminalId}`);
}

/**
 * Unregister an xterm write callback for a terminal.
 * Called when a terminal component unmounts.
 *
 * @param terminalId - The terminal ID
 */
export function unregisterOutputCallback(terminalId: string): void {
  xtermCallbacks.delete(terminalId);
  debugLog(`[TerminalStore] Unregistered output callback for terminal: ${terminalId}`);
}

/**
 * Write terminal output to the appropriate destination.
 *
 * If the terminal has a registered callback (component is mounted and visible),
 * writes directly to xterm AND buffers. If no callback is registered (terminal
 * component is unmounted due to project switch), only buffers the data.
 *
 * NOTE: Task monitor structured output is handled via the TERMINAL_STRUCTURED_OUTPUT
 * IPC channel (see useGlobalTerminalListeners), NOT through this function's parser.
 * This function only buffers raw output for task monitors (for potential raw view fallback).
 *
 * This function is called by the global terminal output listener in
 * useGlobalTerminalListeners, which ensures output is always captured
 * regardless of which project is currently active.
 *
 * @param terminalId - The terminal ID
 * @param data - The output data to write
 */
export function writeToTerminal(terminalId: string, data: string): void {
  // Always buffer the data to ensure persistence
  terminalBufferManager.append(terminalId, data);

  // Check if this is a task monitor terminal
  const store = useTerminalStore.getState();
  const terminal = store.terminals.find(t => t.id === terminalId);

  // For task monitors, structured output parsing happens via IPC (TERMINAL_STRUCTURED_OUTPUT)
  // from the main process. We skip parsing here to avoid duplicate/conflicting updates.
  // The raw output is still buffered above for potential raw view fallback.
  if (terminal?.isTaskMonitor) {
    // Set streaming status when we receive any output
    if (!terminal.isStreaming) {
      store.setIsStreaming(terminalId, true);
    }
    return;
  }

  // If terminal has a registered callback, write to xterm immediately
  // (for regular terminals only - task monitors use the rich UI)
  const callback = xtermCallbacks.get(terminalId);
  if (callback) {
    try {
      callback(data);
    } catch (error) {
      debugError(`[TerminalStore] Error writing to terminal ${terminalId}:`, error);
    }
  }
}

export type TerminalStatus = 'idle' | 'running' | 'claude-active' | 'exited';

export interface Terminal {
  id: string;
  title: string;
  status: TerminalStatus;
  cwd: string;
  createdAt: Date;
  isClaudeMode: boolean;
  claudeSessionId?: string;  // Claude Code session ID for resume
  // outputBuffer removed - now managed by terminalBufferManager singleton
  isRestored?: boolean;  // Whether this terminal was restored from a saved session
  associatedTaskId?: string;  // ID of task associated with this terminal (for context loading)
  projectPath?: string;  // Project this terminal belongs to (for multi-project support)
  worktreeConfig?: TerminalWorktreeConfig;  // Associated worktree for isolated development
  isClaudeBusy?: boolean;  // Whether Claude Code is actively processing (for visual indicator)
  pendingClaudeResume?: boolean;  // Whether this terminal has a pending Claude resume (deferred until tab activated)
  displayOrder?: number;  // Display order for tab persistence (lower = further left)
  // Task monitor specific fields
  isTaskMonitor?: boolean;  // Whether this is a task monitor terminal (displays task output)
  taskId?: string;  // Associated task ID for task monitors
  specId?: string;  // Associated spec ID for task monitors
  taskStatus?: 'running' | 'completed' | 'failed';  // Current status of the monitored task
  taskProgress?: number;  // Progress percentage of the monitored task

  // Task monitor chat UI state (for rich terminal view)
  viewMode?: 'rich' | 'raw';  // Display mode: rich chat UI vs raw terminal output
  messages?: ParsedMessage[];  // Parsed message history for rich UI
  parser?: ClaudeOutputParser;  // Parser instance for converting terminal output to messages
  isStreaming?: boolean;  // Whether agent is actively streaming output
  isMinimized?: boolean;  // Whether the terminal is minimized to just title bar (task monitors only)
}

interface TerminalLayout {
  id: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

interface TerminalState {
  terminals: Terminal[];
  layouts: TerminalLayout[];
  activeTerminalId: string | null;
  maxTerminals: number;
  hasRestoredSessions: boolean;  // Track if we've restored sessions for this project

  // Actions
  addTerminal: (cwd?: string, projectPath?: string) => Terminal | null;
  addClaudeCodeTerminal: (cwd?: string, projectPath?: string) => Terminal | null;
  addRestoredTerminal: (session: TerminalSession) => Terminal;
  // Add a terminal with a specific ID (for terminals created in main process, like OAuth login terminals)
  addExternalTerminal: (id: string, title: string, cwd?: string, projectPath?: string) => Terminal | null;
  removeTerminal: (id: string) => void;
  updateTerminal: (id: string, updates: Partial<Terminal>) => void;
  setActiveTerminal: (id: string | null) => void;
  setTerminalStatus: (id: string, status: TerminalStatus) => void;
  setClaudeMode: (id: string, isClaudeMode: boolean) => void;
  setClaudeSessionId: (id: string, sessionId: string) => void;
  setAssociatedTask: (id: string, taskId: string | undefined) => void;
  setWorktreeConfig: (id: string, config: TerminalWorktreeConfig | undefined) => void;
  setClaudeBusy: (id: string, isBusy: boolean) => void;
  setPendingClaudeResume: (id: string, pending: boolean) => void;
  clearAllTerminals: () => void;
  setHasRestoredSessions: (value: boolean) => void;
  reorderTerminals: (activeId: string, overId: string) => void;

  // Task monitor chat UI actions
  setViewMode: (id: string, mode: 'rich' | 'raw') => void;
  appendParsedMessages: (id: string, messages: ParsedMessage[]) => void;
  appendStructuredBlock: (id: string, block: StructuredBlock) => void;
  setIsStreaming: (id: string, isStreaming: boolean) => void;
  setIsMinimized: (id: string, isMinimized: boolean) => void;
  initializeParser: (id: string) => void;
  clearMessages: (id: string) => void;
  addUserMessage: (id: string, content: string) => void;

  // Selectors
  getTerminal: (id: string) => Terminal | undefined;
  getActiveTerminal: () => Terminal | undefined;
  canAddTerminal: (projectPath?: string) => boolean;
  getTerminalsForProject: (projectPath: string) => Terminal[];
  getWorktreeCount: () => number;
}

/**
 * Helper function to count active (non-exited) terminals for a specific project.
 * Extracted to avoid duplicating the counting logic across multiple methods.
 *
 * @param terminals - The array of all terminals
 * @param projectPath - The project path to filter by
 * @returns The count of active terminals for the given project
 */
function getActiveProjectTerminalCount(terminals: Terminal[], projectPath?: string): number {
  // Only count regular terminals, not task monitors
  // Task monitors are managed separately and shouldn't block users from creating new terminals
  return terminals.filter(t =>
    t.status !== 'exited' &&
    t.projectPath === projectPath &&
    !t.isTaskMonitor
  ).length;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  layouts: [],
  activeTerminalId: null,
  // Maximum terminals per project - limited to 12 to prevent excessive memory usage
  // from terminal buffers (~1MB each) and PTY process resource exhaustion.
  // Each terminal maintains a scrollback buffer and associated xterm.js state.
  maxTerminals: 12,
  hasRestoredSessions: false,

  addTerminal: (cwd?: string, projectPath?: string) => {
    const state = get();
    const activeCount = getActiveProjectTerminalCount(state.terminals, projectPath);
    if (activeCount >= state.maxTerminals) {
      debugLog(`[TerminalStore] Cannot add terminal: limit of ${state.maxTerminals} reached for project ${projectPath}`);
      return null;
    }

    const newTerminal: Terminal = {
      id: uuid(),
      title: `Terminal ${state.terminals.length + 1}`,
      status: 'idle',
      cwd: cwd || process.env.HOME || '~',
      createdAt: new Date(),
      isClaudeMode: false,
      // outputBuffer removed - managed by terminalBufferManager
      projectPath,
      displayOrder: state.terminals.length,  // New terminals appear at the end
    };

    set((state) => ({
      terminals: [...state.terminals, newTerminal],
      activeTerminalId: newTerminal.id,
    }));

    return newTerminal;
  },

  addClaudeCodeTerminal: (cwd?: string, projectPath?: string) => {
    const state = get();
    const activeCount = getActiveProjectTerminalCount(state.terminals, projectPath);
    if (activeCount >= state.maxTerminals) {
      debugLog(`[TerminalStore] Cannot add Claude Code terminal: limit of ${state.maxTerminals} reached for project ${projectPath}`);
      return null;
    }

    const newTerminal: Terminal = {
      id: uuid(),
      title: 'Claude Code',
      status: 'idle',
      cwd: cwd || process.env.HOME || '~',
      createdAt: new Date(),
      isClaudeMode: true,  // Start in Claude mode
      projectPath,
      displayOrder: state.terminals.length,
    };

    set((state) => ({
      terminals: [...state.terminals, newTerminal],
      activeTerminalId: newTerminal.id,
    }));

    return newTerminal;
  },

  addRestoredTerminal: (session: TerminalSession) => {
    const state = get();

    // Check if terminal already exists
    const existingTerminal = state.terminals.find(t => t.id === session.id);
    if (existingTerminal) {
      return existingTerminal;
    }

    // NOTE: Restored terminals are intentionally exempt from the per-project limit.
    // This preserves user state from previous sessions - if a user had 12 terminals
    // before closing the app, they should get all 12 back on restore.
    // The limit only applies to newly created terminals.

    const restoredTerminal: Terminal = {
      id: session.id,
      title: session.title,
      status: 'idle',  // Will be updated to 'running' when PTY is created
      cwd: session.cwd,
      createdAt: new Date(session.createdAt),
      // Reset Claude mode to false - Claude Code is killed on app restart
      // Keep claudeSessionId so users can resume by clicking the invoke button
      isClaudeMode: false,
      claudeSessionId: session.claudeSessionId,
      // outputBuffer now stored in terminalBufferManager
      isRestored: true,
      projectPath: session.projectPath,
      // Worktree config is validated in main process before restore
      worktreeConfig: session.worktreeConfig,
      // Restore displayOrder for tab position persistence (falls back to end if not set)
      displayOrder: session.displayOrder ?? state.terminals.length,
      // Restore task monitor fields
      isTaskMonitor: session.isTaskMonitor,
      taskId: session.taskId,
      specId: session.specId,
      taskStatus: session.taskStatus,
      // Initialize rich UI for task monitors
      viewMode: session.isTaskMonitor ? 'rich' : undefined,
      messages: session.isTaskMonitor ? [] : undefined,
      parser: session.isTaskMonitor ? new ClaudeOutputParser() : undefined,
      isStreaming: false,
    };

    // Restore buffer to buffer manager
    if (session.outputBuffer) {
      terminalBufferManager.set(session.id, session.outputBuffer);
    }

    set((state) => ({
      terminals: [...state.terminals, restoredTerminal],
      activeTerminalId: state.activeTerminalId || restoredTerminal.id,
    }));

    return restoredTerminal;
  },

  addExternalTerminal: (id: string, title: string, cwd?: string, projectPath?: string) => {
    const state = get();

    // Check if terminal with this ID already exists
    const existingTerminal = state.terminals.find(t => t.id === id);
    if (existingTerminal) {
      // Just activate it and return it
      set({ activeTerminalId: id });
      return existingTerminal;
    }

    const activeCount = getActiveProjectTerminalCount(state.terminals, projectPath);
    if (activeCount >= state.maxTerminals) {
      debugLog(`[TerminalStore] Cannot add external terminal: limit of ${state.maxTerminals} reached for project ${projectPath}`);
      return null;
    }

    const newTerminal: Terminal = {
      id,
      title,
      status: 'running',  // External terminals are already running
      cwd: cwd || process.env.HOME || '~',
      createdAt: new Date(),
      isClaudeMode: false,
      projectPath,
      displayOrder: state.terminals.length,  // New terminals appear at the end
    };

    set((state) => ({
      terminals: [...state.terminals, newTerminal],
      activeTerminalId: newTerminal.id,
    }));

    return newTerminal;
  },

  removeTerminal: (id: string) => {
    // Clean up buffer manager and output callback
    terminalBufferManager.dispose(id);
    xtermCallbacks.delete(id);

    set((state) => {
      const newTerminals = state.terminals.filter((t) => t.id !== id);
      const newActiveId = state.activeTerminalId === id
        ? (newTerminals.length > 0 ? newTerminals[newTerminals.length - 1].id : null)
        : state.activeTerminalId;

      return {
        terminals: newTerminals,
        activeTerminalId: newActiveId,
      };
    });
  },

  updateTerminal: (id: string, updates: Partial<Terminal>) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },

  setActiveTerminal: (id: string | null) => {
    set({ activeTerminalId: id });
  },

  setTerminalStatus: (id: string, status: TerminalStatus) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    }));
  },

  setClaudeMode: (id: string, isClaudeMode: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id
          ? {
              ...t,
              isClaudeMode,
              status: isClaudeMode ? 'claude-active' : 'running',
              // Reset busy state when leaving Claude mode
              isClaudeBusy: isClaudeMode ? t.isClaudeBusy : undefined
            }
          : t
      ),
    }));
  },

  setClaudeSessionId: (id: string, sessionId: string) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, claudeSessionId: sessionId } : t
      ),
    }));
  },

  setAssociatedTask: (id: string, taskId: string | undefined) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, associatedTaskId: taskId } : t
      ),
    }));
  },

  setWorktreeConfig: (id: string, config: TerminalWorktreeConfig | undefined) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, worktreeConfig: config } : t
      ),
    }));
  },

  setClaudeBusy: (id: string, isBusy: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, isClaudeBusy: isBusy } : t
      ),
    }));
  },

  setPendingClaudeResume: (id: string, pending: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, pendingClaudeResume: pending } : t
      ),
    }));
  },

  clearAllTerminals: () => {
    set({ terminals: [], activeTerminalId: null, hasRestoredSessions: false });
  },

  setHasRestoredSessions: (value: boolean) => {
    set({ hasRestoredSessions: value });
  },

  reorderTerminals: (activeId: string, overId: string) => {
    set((state) => {
      const oldIndex = state.terminals.findIndex((t) => t.id === activeId);
      const newIndex = state.terminals.findIndex((t) => t.id === overId);

      if (oldIndex === -1 || newIndex === -1) {
        return state;
      }

      // Reorder terminals and update displayOrder values based on new positions
      const reorderedTerminals = arrayMove(state.terminals, oldIndex, newIndex);
      const terminalsWithOrder = reorderedTerminals.map((terminal, index) => ({
        ...terminal,
        displayOrder: index,
      }));

      return {
        terminals: terminalsWithOrder,
      };
    });
  },

  // Task monitor chat UI actions
  setViewMode: (id: string, mode: 'rich' | 'raw') => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, viewMode: mode } : t
      ),
    }));
  },

  appendParsedMessages: (id: string, messages: ParsedMessage[]) => {
    set((state) => ({
      terminals: state.terminals.map((t) => {
        if (t.id === id) {
          // Since parser now returns ALL messages (including in-progress),
          // we SET the messages instead of appending to avoid duplicates
          return {
            ...t,
            messages: messages,
          };
        }
        return t;
      }),
    }));
  },

  appendStructuredBlock: (id: string, block: StructuredBlock) => {
    // Debug log to track structured block flow
    console.log(`[TerminalStore] appendStructuredBlock for ${id}:`, {
      type: block.type,
      ...(block.type === 'tool_use' ? { name: block.name, hasInput: !!block.input, inputKeys: block.input ? Object.keys(block.input) : [] } : {}),
      ...(block.type === 'text' ? { contentLength: block.content?.length } : {}),
    });

    set((state) => ({
      terminals: state.terminals.map((t) => {
        if (t.id !== id || !t.isTaskMonitor) return t;

        const messages = [...(t.messages || [])];
        let currentMessage = messages[messages.length - 1];

        // Ensure we have a current message
        if (!currentMessage || currentMessage.role !== 'assistant') {
          currentMessage = {
            role: 'assistant' as const,
            content: [],
            timestamp: Date.now(),
          };
          messages.push(currentMessage);
        }

        // Convert StructuredBlock to ContentBlock and append
        switch (block.type) {
          case 'text': {
            // Merge with previous text block if possible
            const lastContent = currentMessage.content[currentMessage.content.length - 1];
            if (lastContent && lastContent.type === 'text') {
              lastContent.text += '\n' + block.content;
            } else if (block.content.trim()) {
              currentMessage.content.push({
                type: 'text',
                text: block.content,
              });
            }
            break;
          }

          case 'thinking': {
            currentMessage.content.push({
              type: 'thinking',
              text: block.content,
              signature: 'signature' in block ? block.signature : undefined,
            });
            break;
          }

          // NEW: Handle tool_use (from SDK format)
          case 'tool_use': {
            currentMessage.content.push({
              type: 'tool_use',
              toolName: block.name,
              toolId: block.id,
              input: block.input || {},
              status: 'running',
            });
            break;
          }

          // NEW: Handle tool_result (from SDK format)
          case 'tool_result': {
            // Find the matching tool_use and update its status
            for (let i = currentMessage.content.length - 1; i >= 0; i--) {
              const content = currentMessage.content[i];
              if (content.type === 'tool_use' && content.status === 'running') {
                // Match by tool_use_id or tool name
                const toolContent = content as ToolUseContent;
                if (toolContent.toolId === block.tool_use_id ||
                    (!block.tool_use_id && toolContent.toolName === block.name)) {
                  toolContent.status = block.is_error ? 'error' : 'success';
                  toolContent.output = block.content;
                  break;
                }
              }
            }
            break;
          }

          // Legacy: Handle tool_start (backwards compatibility)
          case 'tool_start': {
            currentMessage.content.push({
              type: 'tool_use',
              toolName: block.toolName,
              input: block.input || {},
              status: 'running',
            });
            break;
          }

          // Legacy: Handle tool_end (backwards compatibility)
          case 'tool_end': {
            // Find the matching tool_start and update its status
            for (let i = currentMessage.content.length - 1; i >= 0; i--) {
              const content = currentMessage.content[i];
              if (content.type === 'tool_use' && content.status === 'running') {
                // Only update if tool names match (or if block.toolName is empty for legacy format)
                if (!block.toolName || content.toolName === block.toolName) {
                  (content as ToolUseContent).status = block.success ? 'success' : 'error';
                  if (block.result) {
                    (content as ToolUseContent).output = block.result;
                  }
                  break;
                }
              }
            }
            break;
          }

          case 'error': {
            currentMessage.content.push({
              type: 'text',
              text: `[Error] ${block.content}`,
            });
            break;
          }

          case 'phase_start':
          case 'phase_end':
          case 'subphase_start': {
            // Phase blocks can be shown as system info
            const phaseText = block.type === 'phase_start'
              ? `Phase: ${block.phase}`
              : block.type === 'phase_end'
                ? `Phase ${block.phase} ${block.success ? 'completed' : 'failed'}`
                : `Subphase: ${block.subphase}`;

            currentMessage.content.push({
              type: 'text',
              text: `[${phaseText}]`,
            });
            break;
          }
        }

        return {
          ...t,
          messages,
          isStreaming: true,
        };
      }),
    }));
  },

  setIsStreaming: (id: string, isStreaming: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, isStreaming } : t
      ),
    }));
  },

  setIsMinimized: (id: string, isMinimized: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, isMinimized } : t
      ),
    }));
  },

  initializeParser: (id: string) => {
    set((state) => ({
      terminals: state.terminals.map((t) => {
        if (t.id === id && !t.parser) {
          return {
            ...t,
            parser: new ClaudeOutputParser(t.messages || []),
            viewMode: t.viewMode || 'rich',
            messages: t.messages || [],
          };
        }
        return t;
      }),
    }));
  },

  clearMessages: (id: string) => {
    set((state) => ({
      terminals: state.terminals.map((t) => {
        if (t.id === id) {
          t.parser?.clear();
          return {
            ...t,
            messages: [],
          };
        }
        return t;
      }),
    }));
  },

  addUserMessage: (id: string, content: string) => {
    set((state) => ({
      terminals: state.terminals.map((t) => {
        if (t.id === id) {
          const messages = [...(t.messages || [])];
          messages.push({
            role: 'user' as const,
            content: [{
              type: 'text' as const,
              text: content,
            }],
            timestamp: Date.now(),
          });
          return {
            ...t,
            messages,
          };
        }
        return t;
      }),
    }));
  },

  getTerminal: (id: string) => {
    return get().terminals.find((t) => t.id === id);
  },

  getActiveTerminal: () => {
    const state = get();
    return state.terminals.find((t) => t.id === state.activeTerminalId);
  },

  canAddTerminal: (projectPath?: string) => {
    const state = get();
    return getActiveProjectTerminalCount(state.terminals, projectPath) < state.maxTerminals;
  },

  getTerminalsForProject: (projectPath: string) => {
    return get().terminals.filter(t => t.projectPath === projectPath);
  },

  getWorktreeCount: () => {
    return get().terminals.filter(t => t.worktreeConfig).length;
  },
}));

// Track in-progress restore operations to prevent race conditions
const restoringProjects = new Set<string>();

/**
 * Restore terminal sessions for a project from persisted storage
 */
export async function restoreTerminalSessions(projectPath: string): Promise<void> {
  console.log('[TerminalStore] restoreTerminalSessions called with:', projectPath);

  // Validate input
  if (!projectPath || typeof projectPath !== 'string') {
    console.log('[TerminalStore] Invalid projectPath, skipping restore');
    return;
  }

  // Prevent concurrent restores for same project (race condition protection)
  if (restoringProjects.has(projectPath)) {
    console.log('[TerminalStore] Already restoring terminals for this project, skipping');
    return;
  }
  restoringProjects.add(projectPath);

  try {
    const store = useTerminalStore.getState();

    // Get terminals for this project that exist in state
    const projectTerminals = store.terminals.filter(t => t.projectPath === projectPath);

    if (projectTerminals.length > 0) {
      // Check if PTY processes are alive for existing terminals
      const aliveChecks = await Promise.all(
        projectTerminals.map(async (terminal) => {
          try {
            const result = await window.electronAPI.checkTerminalPtyAlive(terminal.id);
            return { terminal, alive: result.success && result.data?.alive === true };
          } catch {
            return { terminal, alive: false };
          }
        })
      );

      // Remove dead terminals from store (they have state but no PTY process)
      const deadTerminals = aliveChecks.filter(c => !c.alive);

      for (const { terminal } of deadTerminals) {
        debugLog(`[TerminalStore] Removing dead terminal: ${terminal.id}`);
        store.removeTerminal(terminal.id);
      }

      // If all terminals were alive, we're done
      if (deadTerminals.length === 0) {
        debugLog('[TerminalStore] All terminals have live PTY processes');
        return;
      }

      // Note: We don't skip disk restore when alive terminals exist because:
      // 1. Dead terminals were removed from state above
      // 2. addRestoredTerminal() has duplicate protection (checks terminal ID)
      // 3. Disk restore will safely only add back the dead terminals
      debugLog(`[TerminalStore] ${deadTerminals.length} terminals had dead PTY, will restore from disk`);
    }

    // Restore from disk
    const result = await window.electronAPI.getTerminalSessions(projectPath);
    if (result.success && result.data && result.data.length > 0) {
      console.log('[TerminalStore] Restoring', result.data.length, 'terminals from disk');

      // Sort sessions by displayOrder before restoring (lower = further left)
      // Sessions without displayOrder are placed at the end
      const sortedSessions = [...result.data].sort((a, b) => {
        const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      });

      // Add terminals to the store in correct order (they'll be created in the TerminalGrid component)
      for (const session of sortedSessions) {
        store.addRestoredTerminal(session);
      }

      store.setHasRestoredSessions(true);
    } else {
      console.log('[TerminalStore] No regular terminals to restore from disk');
      store.setHasRestoredSessions(true);
    }

    // Recreate task monitor terminals for running tasks
    // This ensures tasks that are still running have their terminals after app restart
    // This runs regardless of whether regular terminals were restored
    await recreateTaskMonitorTerminals(projectPath, store);
  } catch (error) {
    debugError('[TerminalStore] Error restoring sessions:', error);
  } finally {
    restoringProjects.delete(projectPath);
  }
}

/**
 * Recreate task monitor terminals for running tasks
 * Can be called after tasks are loaded to ensure all running tasks have terminals
 *
 * @param projectPath - Path to the project
 * @param store - Terminal store instance
 * @param tasks - Optional array of tasks (if not provided, will fetch from backend)
 */
export async function recreateTaskMonitorTerminals(
  projectPath: string,
  store: ReturnType<typeof useTerminalStore.getState>,
  tasks?: any[]
): Promise<void> {
  console.log('[TerminalStore] recreateTaskMonitorTerminals called for:', projectPath, 'with', tasks?.length || 0, 'tasks provided');

  try {
    // Use provided tasks or fetch from backend
    let tasksList = tasks;

    if (!tasksList) {
      const tasksResult = await window.electronAPI.getTasks(projectPath);
      console.log('[TerminalStore] getTasks result:', { success: tasksResult.success, taskCount: tasksResult.data?.length });

      if (!tasksResult.success || !tasksResult.data) {
        console.log('[TerminalStore] No tasks found, skipping terminal recreation');
        return;
      }

      tasksList = tasksResult.data;
    }

    // All tasks get terminals - allows chatting with Claude throughout the entire task lifecycle
    // From initial creation through completion, you can discuss the task with the agent
    const tasksNeedingTerminals = tasksList;

    console.log('[TerminalStore] Tasks needing terminals:', {
      total: tasksList.length,
      needingTerminals: tasksNeedingTerminals.length,
      statuses: tasksNeedingTerminals.map(t => ({ id: t.id, status: t.status }))
    });

    if (tasksNeedingTerminals.length === 0) {
      console.log('[TerminalStore] No tasks needing terminals found, skipping terminal recreation');
      return;
    }

    console.log(`[TerminalStore] Found ${tasksNeedingTerminals.length} task(s) needing terminals, checking for missing terminals`);

    // Track tasks that need to be restarted (coding but process not running)
    const tasksToRestart: string[] = [];

    for (const task of tasksNeedingTerminals) {
      const expectedTerminalId = `task-${task.id}`;

      // Check if terminal already exists
      const existingTerminal = store.terminals.find(t => t.id === expectedTerminalId);

      if (!existingTerminal) {
        console.log(`[TerminalStore] Recreating task monitor terminal for task: ${task.title} (${task.id})`);

        // Create a TerminalSession object for the task monitor
        const session: TerminalSession = {
          id: expectedTerminalId,
          title: task.title,
          cwd: projectPath,
          projectPath,
          isClaudeMode: false,
          outputBuffer: '', // Empty buffer for new session
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          isTaskMonitor: true,
          taskId: task.id,
          specId: task.specId,
          taskStatus: 'running'
        };

        console.log('[TerminalStore] Adding terminal to store via addRestoredTerminal');
        // Add the terminal using the proper Zustand method (handles reactivity)
        store.addRestoredTerminal(session);

        console.log('[TerminalStore] Creating virtual terminal in main process');
        // Recreate the virtual terminal in main process
        try {
          await window.electronAPI.createTerminal({
            id: expectedTerminalId,
            cwd: projectPath,
            projectPath,
            isTaskMonitor: true,
            taskId: task.id,
            specId: task.specId,
            taskTitle: task.title
          });
        } catch (error) {
          debugError(`[TerminalStore] Error creating terminal for task ${task.id}:`, error);
        }
      }

      // FIX-3/FIX-4: Coding tasks should NOT auto-restart on app restart
      // User must click "Resume" button to restart a coding task
      // This prevents unwanted auto-execution after interruption
      if (task.status === 'coding') {
        try {
          const runningResult = await window.electronAPI.checkTaskRunning(task.id);
          if (runningResult.success && runningResult.data === false) {
            // Don't auto-restart - just log that it's interrupted
            console.log(`[TerminalStore] Task ${task.id} is coding but no process running (interrupted state - requires manual resume)`);
            // DO NOT add to tasksToRestart - user must click Resume
          } else if (runningResult.success && runningResult.data === true) {
            console.log(`[TerminalStore] Task ${task.id} process is already running`);
          }
        } catch (error) {
          debugError(`[TerminalStore] Error checking if task ${task.id} is running:`, error);
        }
      }

      // FIX-3: For planning tasks, check if process is running and restart if not
      // Planning agents ARE auto-restarted to resume spec creation after app restart
      if (task.status === 'planning') {
        try {
          const runningResult = await window.electronAPI.checkTaskRunning(task.id);
          if (runningResult.success && runningResult.data === false) {
            console.log(`[TerminalStore] Task ${task.id} is planning but no process running, will restart planning agent`);
            tasksToRestart.push(task.id);
          } else if (runningResult.success && runningResult.data === true) {
            console.log(`[TerminalStore] Task ${task.id} planning agent is already running`);
          }
        } catch (error) {
          debugError(`[TerminalStore] Error checking if planning task ${task.id} is running:`, error);
        }
      }
    }

    // Auto-restart stuck tasks after a short delay to ensure terminals are set up
    if (tasksToRestart.length > 0) {
      console.log(`[TerminalStore] Auto-restarting ${tasksToRestart.length} stuck task(s)...`);
      setTimeout(async () => {
        for (const taskId of tasksToRestart) {
          try {
            console.log(`[TerminalStore] Restarting stuck task: ${taskId}`);
            // FIX-3/FIX-4: Use recoverStuckTask with autoRestart to properly restart the task
            // For planning tasks, this will call startPlanningAgent
            // For coding tasks, this will mark as interrupted (no auto-restart)
            const result = await window.electronAPI.recoverStuckTask(taskId, { autoRestart: true });
            if (result.success) {
              console.log(`[TerminalStore] Task ${taskId} restarted successfully`);
            } else {
              console.warn(`[TerminalStore] Failed to restart task ${taskId}:`, result.error);
            }
          } catch (error) {
            debugError(`[TerminalStore] Error restarting task ${taskId}:`, error);
          }
        }
      }, 1000); // 1 second delay to let terminals initialize
    }
  } catch (error) {
    debugError('[TerminalStore] Error recreating task monitor terminals:', error);
  }
}
