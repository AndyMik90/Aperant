import { create } from 'zustand';
import { createActor } from 'xstate';
import type { ActorRefFrom } from 'xstate';
import { v4 as uuid } from 'uuid';
import { arrayMove } from '@dnd-kit/sortable';
import type { TerminalSession, TerminalWorktreeConfig } from '../../shared/types';
import { terminalMachine, type TerminalEvent } from '@shared/state-machines';
import { terminalBufferManager } from '../lib/terminal-buffer-manager';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

type TerminalActor = ActorRefFrom<typeof terminalMachine>;

/**
 * Module-level Map to store terminal ID -> XState actor mappings.
 *
 * DESIGN NOTE: Stored outside Zustand because actors are mutable references
 * that shouldn't be serialized in state. Similar pattern to xtermCallbacks.
 */
const terminalActors = new Map<string, TerminalActor>();

/**
 * Get or create an XState terminal actor for a given terminal ID.
 * Actors are lazily created on first access and cached for the terminal's lifetime.
 */
export function getOrCreateTerminalActor(terminalId: string): TerminalActor {
  let actor = terminalActors.get(terminalId);
  if (!actor) {
    actor = createActor(terminalMachine);
    actor.start();
    terminalActors.set(terminalId, actor);
    debugLog(`[TerminalStore] Created XState actor for terminal: ${terminalId}`);
  }
  return actor;
}

/**
 * Send an event to a terminal's XState machine.
 * Creates the actor if it doesn't exist yet.
 */
export function sendTerminalMachineEvent(terminalId: string, event: TerminalEvent): void {
  const actor = getOrCreateTerminalActor(terminalId);
  const stateBefore = String(actor.getSnapshot().value);
  actor.send(event);
  const stateAfter = String(actor.getSnapshot().value);
  debugLog(`[TerminalStore] Machine ${terminalId}: ${event.type} (${stateBefore} -> ${stateAfter})`);
}

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

  // If terminal has a registered callback, write to xterm immediately
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
  claudeNamedOnce?: boolean;  // Whether this Claude terminal has been auto-named based on initial message (prevents repeated naming)
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
  setClaudeNamedOnce: (id: string, named: boolean) => void;
  clearAllTerminals: () => void;
  setHasRestoredSessions: (value: boolean) => void;
  reorderTerminals: (activeId: string, overId: string) => void;
  resumeAllPendingClaude: () => Promise<void>;

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
  return terminals.filter(t => t.status !== 'exited' && t.projectPath === projectPath).length;
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

  addRestoredTerminal: (session: TerminalSession) => {
    const state = get();
    debugLog(`[TerminalStore] addRestoredTerminal called for session: ${session.id}, title: "${session.title}", projectPath: ${session.projectPath}`);

    // CRITICAL: Always restore buffer to buffer manager FIRST, even if terminal already exists.
    // This ensures useXterm can replay the buffer regardless of whether this is a fresh restore
    // or a re-restore (e.g., after project switch). The buffer must be available before
    // the Terminal component mounts and useXterm tries to read it.
    if (session.outputBuffer) {
      terminalBufferManager.set(session.id, session.outputBuffer);
      debugLog(`[TerminalStore] Restored buffer for terminal ${session.id}, size: ${session.outputBuffer.length} chars`);
    } else {
      debugLog(`[TerminalStore] No output buffer to restore for terminal ${session.id}`);
    }

    // Check if terminal already exists
    const existingTerminal = state.terminals.find(t => t.id === session.id);
    if (existingTerminal) {
      debugLog(`[TerminalStore] Terminal ${session.id} already exists in store, returning existing (buffer was still restored above)`);

      // If session was in Claude mode before shutdown, update pendingClaudeResume for re-restore scenarios
      // (e.g., after project switch). This ensures the deferred resume logic can trigger even when
      // the terminal already exists in the store.
      if (session.isClaudeMode === true && !existingTerminal.pendingClaudeResume) {
        debugLog(`[TerminalStore] Updating pendingClaudeResume for existing terminal ${session.id}`);
        set((state) => ({
          terminals: state.terminals.map(t =>
            t.id === session.id ? { ...t, pendingClaudeResume: true } : t
          )
        }));
      }

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
      // outputBuffer now stored in terminalBufferManager (done above before existence check)
      isRestored: true,
      projectPath: session.projectPath,
      // Worktree config is validated in main process before restore
      worktreeConfig: session.worktreeConfig,
      // Restore displayOrder for tab position persistence (falls back to end if not set)
      displayOrder: session.displayOrder ?? state.terminals.length,
      // If session was in Claude mode before shutdown, mark for deferred resume.
      // This ensures the renderer knows to trigger 'claude --continue' when the terminal
      // becomes active, without relying on the TERMINAL_PENDING_RESUME IPC event timing
      // (which may be sent before the Terminal component mounts its listener).
      pendingClaudeResume: session.isClaudeMode === true,
    };

    set((state) => ({
      terminals: [...state.terminals, restoredTerminal],
      activeTerminalId: state.activeTerminalId || restoredTerminal.id,
    }));

    debugLog(`[TerminalStore] Successfully added restored terminal ${session.id} to store, isRestored: true, claudeSessionId: ${session.claudeSessionId || 'none'}, pendingClaudeResume: ${session.isClaudeMode === true}`);
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
    // Clean up buffer manager, output callback, and XState actor
    terminalBufferManager.dispose(id);
    xtermCallbacks.delete(id);
    const actor = terminalActors.get(id);
    if (actor) {
      actor.stop();
      terminalActors.delete(id);
      debugLog(`[TerminalStore] Cleaned up XState actor for terminal: ${id}`);
    }

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
    // Notify XState machine of lifecycle transitions
    if (status === 'running') {
      sendTerminalMachineEvent(id, { type: 'SHELL_READY' });
    } else if (status === 'exited') {
      sendTerminalMachineEvent(id, { type: 'SHELL_EXITED' });
    }

    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    }));
  },

  setClaudeMode: (id: string, isClaudeMode: boolean) => {
    // Send corresponding event to XState machine
    if (isClaudeMode) {
      // Ensure machine has transitioned past idle before sending CLAUDE_ACTIVE
      const actor = getOrCreateTerminalActor(id);
      if (String(actor.getSnapshot().value) === 'idle') {
        sendTerminalMachineEvent(id, { type: 'SHELL_READY' });
      }
      // Include current claudeSessionId to prevent XState action from overwriting it
      const terminal = get().terminals.find(t => t.id === id);
      sendTerminalMachineEvent(id, { type: 'CLAUDE_ACTIVE', claudeSessionId: terminal?.claudeSessionId });
    } else {
      // Only send CLAUDE_EXITED if machine is in a state that accepts it
      const actor = getOrCreateTerminalActor(id);
      const currentState = String(actor.getSnapshot().value);
      if (currentState === 'claude_starting' || currentState === 'claude_active') {
        sendTerminalMachineEvent(id, { type: 'CLAUDE_EXITED' });
      }
    }

    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id
          ? {
              ...t,
              isClaudeMode,
              status: isClaudeMode ? 'claude-active' : (t.status === 'exited' ? 'exited' : 'running'),
              // Reset busy state and naming flag when leaving Claude mode
              isClaudeBusy: isClaudeMode ? t.isClaudeBusy : undefined,
              claudeNamedOnce: isClaudeMode ? t.claudeNamedOnce : undefined
            }
          : t
      ),
    }));
  },

  setClaudeSessionId: (id: string, sessionId: string) => {
    // Ensure machine has transitioned past idle before sending CLAUDE_ACTIVE
    const actor = getOrCreateTerminalActor(id);
    if (String(actor.getSnapshot().value) === 'idle') {
      sendTerminalMachineEvent(id, { type: 'SHELL_READY' });
    }
    // Send CLAUDE_ACTIVE with session ID to XState machine
    sendTerminalMachineEvent(id, { type: 'CLAUDE_ACTIVE', claudeSessionId: sessionId });

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
    // Send CLAUDE_BUSY event to XState machine
    sendTerminalMachineEvent(id, { type: 'CLAUDE_BUSY', isBusy });

    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, isClaudeBusy: isBusy } : t
      ),
    }));
  },

  setPendingClaudeResume: (id: string, pending: boolean) => {
    // Send RESUME_REQUESTED or RESUME_COMPLETE to XState machine
    let shouldUpdateZustand = true;

    if (pending) {
      const terminal = get().terminals.find(t => t.id === id);
      if (terminal?.claudeSessionId) {
        sendTerminalMachineEvent(id, { type: 'RESUME_REQUESTED', claudeSessionId: terminal.claudeSessionId });
      } else {
        // No claudeSessionId - can't send RESUME_REQUESTED, so don't set pendingClaudeResume
        // to avoid XState/Zustand divergence (UI would show pending but machine wouldn't know)
        debugLog('[terminal-store] setPendingClaudeResume: dropping request for terminal', id, '- no claudeSessionId');
        shouldUpdateZustand = false;
      }
    } else {
      // Resume cleared - either completed or cancelled
      const actor = terminalActors.get(id);
      if (actor && String(actor.getSnapshot().value) === 'pending_resume') {
        // Include claudeSessionId to prevent XState action from overwriting it to undefined
        const terminal = get().terminals.find(t => t.id === id);
        sendTerminalMachineEvent(id, { type: 'RESUME_COMPLETE', claudeSessionId: terminal?.claudeSessionId });
      }
    }

    // Only update Zustand state if XState was notified (prevents state divergence)
    if (shouldUpdateZustand) {
      set((state) => ({
        terminals: state.terminals.map((t) =>
          t.id === id ? { ...t, pendingClaudeResume: pending } : t
        ),
      }));
    }
  },

  setClaudeNamedOnce: (id: string, named: boolean) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, claudeNamedOnce: named } : t
      ),
    }));
  },

  clearAllTerminals: () => {
    // Clean up all resources for every terminal
    const terminals = get().terminals;
    for (const terminal of terminals) {
      terminalBufferManager.dispose(terminal.id);
      xtermCallbacks.delete(terminal.id);
    }

    // Clean up all XState actors
    for (const [_id, actor] of terminalActors) {
      actor.stop();
    }
    terminalActors.clear();
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

  resumeAllPendingClaude: async () => {
    const state = get();

    // Filter terminals with pending Claude resume
    const pendingTerminals = state.terminals.filter(t => t.pendingClaudeResume === true);

    if (pendingTerminals.length === 0) {
      debugLog('[TerminalStore] No terminals with pending Claude resume');
      return;
    }

    debugLog(`[TerminalStore] Resuming ${pendingTerminals.length} pending Claude sessions with 500ms stagger`);

    // Iterate through terminals with staggered delays
    for (let i = 0; i < pendingTerminals.length; i++) {
      const terminal = pendingTerminals[i];
      // Clear the pending flag BEFORE IPC call to prevent race condition
      // with auto-resume effect in Terminal.tsx (which checks this flag on a 100ms timeout)
      get().setPendingClaudeResume(terminal.id, false);

      debugLog(`[TerminalStore] Activating deferred Claude resume for terminal: ${terminal.id}`);
      window.electronAPI.activateDeferredClaudeResume(terminal.id);

      // Wait 500ms before processing next terminal (staggered delay)
      if (i < pendingTerminals.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    debugLog('[TerminalStore] Completed resuming all pending Claude sessions');
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
  // Validate input
  if (!projectPath || typeof projectPath !== 'string') {
    debugLog('[TerminalStore] Invalid projectPath, skipping restore');
    return;
  }

  // Prevent concurrent restores for same project (race condition protection)
  if (restoringProjects.has(projectPath)) {
    debugLog('[TerminalStore] Already restoring terminals for this project, skipping');
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
    debugLog(`[TerminalStore] Fetching terminal sessions from disk for project: ${projectPath}`);
    const result = await window.electronAPI.getTerminalSessions(projectPath);
    if (!result.success || !result.data || result.data.length === 0) {
      debugLog(`[TerminalStore] No sessions found on disk for project: ${projectPath}, success: ${result.success}, sessionCount: ${result.data?.length || 0}`);
      return;
    }
    debugLog(`[TerminalStore] Found ${result.data.length} sessions on disk for project: ${projectPath}`);

    // Sort sessions by displayOrder before restoring (lower = further left)
    // Sessions without displayOrder are placed at the end
    const sortedSessions = [...result.data].sort((a, b) => {
      const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

    // Add terminals to the store in correct order (they'll be created in the TerminalGrid component)
    debugLog(`[TerminalStore] Adding ${sortedSessions.length} sorted sessions to store`);
    for (const session of sortedSessions) {
      store.addRestoredTerminal(session);
    }

    store.setHasRestoredSessions(true);
    debugLog(`[TerminalStore] Completed terminal session restoration for project: ${projectPath}`);
  } catch (error) {
    debugError('[TerminalStore] Error restoring sessions:', error);
  } finally {
    restoringProjects.delete(projectPath);
  }
}
