import { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import { FileDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTerminalStore } from '../stores/terminal-store';
import { useSettingsStore } from '../stores/settings-store';
import { useToast } from '../hooks/use-toast';
import type { TerminalProps } from './terminal/types';
import type { TerminalWorktreeConfig } from '../../shared/types';
import { TERMINAL_DOM_UPDATE_DELAY_MS } from '../../shared/constants';
import { TerminalHeader } from './terminal/TerminalHeader';
import { CreateWorktreeDialog } from './terminal/CreateWorktreeDialog';
import { useXterm } from './terminal/useXterm';
import { usePtyProcess } from './terminal/usePtyProcess';
import { useTerminalEvents } from './terminal/useTerminalEvents';
import { useAutoNaming } from './terminal/useAutoNaming';
import { useTerminalFileDrop } from './terminal/useTerminalFileDrop';

// Minimum dimensions to prevent PTY creation with invalid sizes
const MIN_COLS = 10;
const MIN_ROWS = 3;

/**
 * Handle interface exposed by Terminal component for external control.
 * Used by parent components (e.g., SortableTerminalWrapper) to trigger operations
 * like refitting the terminal after container size changes.
 */
export interface TerminalHandle {
  /** Refit the terminal to its container size */
  fit: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal({
  id,
  cwd,
  projectPath,
  isActive,
  onClose,
  onActivate,
  tasks = [],
  onNewTaskClick,
  terminalCount = 1,
  dragHandleListeners,
  isDragging,
  isExpanded,
  onToggleExpand,
}, ref) {
  const { t } = useTranslation('common');

  const isMountedRef = useRef(true);
  const isCreatedRef = useRef(false);
  // Track deliberate terminal recreation (e.g., worktree switching)
  // This prevents exit handlers from triggering auto-removal during controlled recreation
  const isRecreatingRef = useRef(false);
  // Store pending worktree config during recreation to sync after PTY creation
  // This fixes a race condition where IPC calls to set worktree config happen before
  // the terminal exists in main process, causing the config to not be persisted
  const pendingWorktreeConfigRef = useRef<TerminalWorktreeConfig | null>(null);

  // Worktree dialog state
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);

  // Terminal store
  const terminal = useTerminalStore((state) => state.terminals.find((t) => t.id === id));
  const setClaudeMode = useTerminalStore((state) => state.setClaudeMode);
  const updateTerminal = useTerminalStore((state) => state.updateTerminal);
  const setAssociatedTask = useTerminalStore((state) => state.setAssociatedTask);
  const setWorktreeConfig = useTerminalStore((state) => state.setWorktreeConfig);

  // Use cwd from store if available (for worktree), otherwise use prop
  const effectiveCwd = terminal?.cwd || cwd;

  // Settings store for IDE preferences
  const { settings } = useSettingsStore();

  // Toast for user feedback
  const { toast } = useToast();

  const associatedTask = terminal?.associatedTaskId
    ? tasks.find((t) => t.id === terminal.associatedTaskId)
    : undefined;

  // Setup drop zone for file drag-and-drop
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `terminal-${id}`,
    data: { type: 'terminal', terminalId: id }
  });

  // Check if a terminal is being dragged (vs a file)
  const { active } = useDndContext();
  const isDraggingTerminal = active?.data.current?.type === 'terminal-panel';

  // Use custom hook for native HTML5 file drop handling from FileTreeItem
  // This hook is extracted to enable proper unit testing with renderHook()
  const { isNativeDragOver, handleNativeDragOver, handleNativeDragLeave, handleNativeDrop } =
    useTerminalFileDrop({ terminalId: id });

  // Only show file drop overlay when dragging files (via @dnd-kit or native), not terminals
  const showFileDropOverlay = (isOver && !isDraggingTerminal) || isNativeDragOver;

  // Auto-naming functionality
  const { handleCommandEnter, cleanup: cleanupAutoNaming } = useAutoNaming({
    terminalId: id,
    cwd: effectiveCwd,
  });

  // Track when xterm dimensions are ready for PTY creation
  const [readyDimensions, setReadyDimensions] = useState<{ cols: number; rows: number } | null>(null);

  // Callback when xterm has measured valid dimensions
  const handleDimensionsReady = useCallback((cols: number, rows: number) => {
    // Only set dimensions if they're valid (above minimum thresholds)
    if (cols >= MIN_COLS && rows >= MIN_ROWS) {
      setReadyDimensions({ cols, rows });
    }
  }, []);

  // Initialize xterm with command tracking
  const {
    terminalRef,
    xtermRef: _xtermRef,
    fit,
    write: _write,  // Output now handled by useGlobalTerminalListeners
    writeln,
    focus,
    dispose,
    cols,
    rows,
  } = useXterm({
    terminalId: id,
    onCommandEnter: handleCommandEnter,
    onResize: (cols, rows) => {
      if (isCreatedRef.current) {
        window.electronAPI.resizeTerminal(id, cols, rows);
      }
    },
    onDimensionsReady: handleDimensionsReady,
  });

  // Expose fit method to parent components via ref
  // This allows external triggering of terminal resize (e.g., after drag-drop reorder)
  useImperativeHandle(ref, () => ({
    fit,
  }), [fit]);

  // Use ready dimensions for PTY creation (wait until xterm has measured)
  // This prevents creating PTY with default 80x24 when container is smaller
  const ptyDimensions = useMemo(() => {
    if (readyDimensions) {
      return readyDimensions;
    }
    // Fallback to current dimensions if they're valid
    if (cols >= MIN_COLS && rows >= MIN_ROWS) {
      return { cols, rows };
    }
    // Return null to prevent PTY creation until dimensions are ready
    return null;
  }, [readyDimensions, cols, rows]);

  // Create PTY process - only when we have valid dimensions
  const { prepareForRecreate, resetForRecreate } = usePtyProcess({
    terminalId: id,
    cwd: effectiveCwd,
    projectPath,
    cols: ptyDimensions?.cols ?? 80,
    rows: ptyDimensions?.rows ?? 24,
    // Only allow PTY creation when dimensions are ready
    skipCreation: !ptyDimensions,
    // Pass recreation ref to coordinate with deliberate terminal destruction/recreation
    isRecreatingRef,
    onCreated: () => {
      isCreatedRef.current = true;
      // If there's a pending worktree config from a recreation attempt,
      // sync it to main process now that the terminal exists.
      // This fixes the race condition where IPC calls happen before terminal creation.
      if (pendingWorktreeConfigRef.current) {
        const config = pendingWorktreeConfigRef.current;
        try {
          window.electronAPI.setTerminalWorktreeConfig(id, config);
          window.electronAPI.setTerminalTitle(id, config.name);
        } catch (error) {
          console.error('Failed to sync worktree config after PTY creation:', error);
        }
        pendingWorktreeConfigRef.current = null;
      }
    },
    onError: (error) => {
      // Clear pending config on error to prevent stale config from being applied
      // if PTY is recreated later (fixes potential race condition on failed recreation)
      pendingWorktreeConfigRef.current = null;
      writeln(`\r\n\x1b[31mError: ${error}\x1b[0m`);
    },
  });

  // Handle terminal events (output is now handled globally via useGlobalTerminalListeners)
  useTerminalEvents({
    terminalId: id,
    // Pass recreation ref to skip auto-removal during deliberate terminal recreation
    isRecreatingRef,
    onExit: (exitCode) => {
      isCreatedRef.current = false;
      writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`);
    },
  });

  // Focus terminal when it becomes active
  useEffect(() => {
    if (isActive) {
      focus();
    }
  }, [isActive, focus]);

  // Refit terminal when expansion state changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fit();
    }, TERMINAL_DOM_UPDATE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [isExpanded, fit]);

  // Trigger deferred Claude resume when terminal becomes active
  // This ensures Claude sessions are only resumed when the user actually views the terminal,
  // preventing all terminals from resuming simultaneously on app startup (which can crash the app)
  useEffect(() => {
    if (isActive && terminal?.pendingClaudeResume) {
      // Clear the pending flag and trigger the actual resume
      useTerminalStore.getState().setPendingClaudeResume(id, false);
      window.electronAPI.activateDeferredClaudeResume(id);
    }
  }, [isActive, id, terminal?.pendingClaudeResume]);

  // Handle keyboard shortcuts for this terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this terminal is active
      if (!isActive) return;

      // Cmd/Ctrl+W to close terminal
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }

      // Cmd/Ctrl+Shift+E to toggle expand/collapse
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        onToggleExpand?.();
      }
    };

    // Use capture phase to get the event before xterm
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, onClose, onToggleExpand]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cleanupAutoNaming();

      setTimeout(() => {
        if (!isMountedRef.current) {
          dispose();
          isCreatedRef.current = false;
        }
      }, 100);
    };
  }, [id, dispose, cleanupAutoNaming]);

  const handleInvokeClaude = useCallback(() => {
    setClaudeMode(id, true);
    window.electronAPI.invokeClaudeInTerminal(id, effectiveCwd);
  }, [id, effectiveCwd, setClaudeMode]);

  const handleClick = useCallback(() => {
    onActivate();
    focus();
  }, [onActivate, focus]);

  const handleTitleChange = useCallback((newTitle: string) => {
    updateTerminal(id, { title: newTitle });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, newTitle);
  }, [id, updateTerminal]);

  const handleTaskSelect = useCallback((taskId: string) => {
    const selectedTask = tasks.find((t) => t.id === taskId);
    if (!selectedTask) return;

    setAssociatedTask(id, taskId);
    updateTerminal(id, { title: selectedTask.title });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, selectedTask.title);

    const contextMessage = `I'm working on: ${selectedTask.title}

Description:
${selectedTask.description}

Please confirm you're ready by saying: I'm ready to work on ${selectedTask.title} - Context is loaded.`;

    window.electronAPI.sendTerminalInput(id, contextMessage + '\r');
  }, [id, tasks, setAssociatedTask, updateTerminal]);

  const handleClearTask = useCallback(() => {
    setAssociatedTask(id, undefined);
    updateTerminal(id, { title: 'Claude' });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, 'Claude');
  }, [id, setAssociatedTask, updateTerminal]);

  // Worktree handlers
  const handleCreateWorktree = useCallback(() => {
    setShowWorktreeDialog(true);
  }, []);

  const applyWorktreeConfig = useCallback(async (config: TerminalWorktreeConfig) => {
    // IMPORTANT: Set isRecreatingRef BEFORE destruction to signal deliberate recreation
    // This prevents exit handlers from triggering auto-removal during controlled recreation
    isRecreatingRef.current = true;

    // Store pending config to be synced after PTY creation succeeds
    // This fixes race condition where IPC calls happen before terminal exists in main process
    pendingWorktreeConfigRef.current = config;

    // Set isCreatingRef BEFORE updating the store to prevent race condition
    // This prevents the PTY effect from running before destroyTerminal completes
    prepareForRecreate();

    // Update terminal store with worktree config
    setWorktreeConfig(id, config);
    // Try to sync to main process (may be ignored if terminal doesn't exist yet)
    // The onCreated callback will re-sync using pendingWorktreeConfigRef
    window.electronAPI.setTerminalWorktreeConfig(id, config);

    // Update terminal title and cwd to worktree path
    updateTerminal(id, { title: config.name, cwd: config.worktreePath });
    // Try to sync to main process (may be ignored if terminal doesn't exist yet)
    window.electronAPI.setTerminalTitle(id, config.name);

    // Destroy current PTY - a new one will be created in the worktree directory
    if (isCreatedRef.current) {
      await window.electronAPI.destroyTerminal(id);
      isCreatedRef.current = false;
    }

    // Reset refs to allow recreation - effect will now trigger with new cwd
    resetForRecreate();
  }, [id, setWorktreeConfig, updateTerminal, prepareForRecreate, resetForRecreate]);

  const handleWorktreeCreated = useCallback(async (config: TerminalWorktreeConfig) => {
    await applyWorktreeConfig(config);
  }, [applyWorktreeConfig]);

  const handleSelectWorktree = useCallback(async (config: TerminalWorktreeConfig) => {
    await applyWorktreeConfig(config);
  }, [applyWorktreeConfig]);

  const handleOpenInIDE = useCallback(async () => {
    const worktreePath = terminal?.worktreeConfig?.worktreePath;
    if (!worktreePath) return;

    const preferredIDE = settings.preferredIDE || 'vscode';
    try {
      await window.electronAPI.worktreeOpenInIDE(
        worktreePath,
        preferredIDE,
        settings.customIDEPath
      );
    } catch (err) {
      console.error('Failed to open in IDE:', err);
      toast({
        title: t('terminal.failedToOpenIDE'),
        description: err instanceof Error ? err.message : t('terminal.couldNotLaunchIDE'),
        variant: 'destructive',
      });
    }
  }, [terminal?.worktreeConfig?.worktreePath, settings.preferredIDE, settings.customIDEPath, toast]);

  // Get backlog tasks for worktree dialog
  const backlogTasks = tasks.filter((t) => t.status === 'backlog');

  // Determine border color based on Claude busy state
  // Red (busy) = Claude is actively processing
  // Green (idle) = Claude is ready for input
  const isClaudeBusy = terminal?.isClaudeBusy;
  const showClaudeBusyIndicator = terminal?.isClaudeMode && isClaudeBusy !== undefined;

  return (
    <div
      ref={setDropRef}
      className={cn(
        'flex h-full flex-col rounded-lg border bg-[#0B0B0F] overflow-hidden transition-all relative',
        // Default border states
        isActive ? 'border-primary ring-1 ring-primary/20' : 'border-border',
        // File drop overlay
        showFileDropOverlay && 'ring-2 ring-info border-info',
        // Claude busy state indicator (subtle colored border when in Claude mode)
        showClaudeBusyIndicator && isClaudeBusy && 'border-red-500/60 ring-1 ring-red-500/20',
        showClaudeBusyIndicator && !isClaudeBusy && 'border-green-500/60 ring-1 ring-green-500/20'
      )}
      onClick={handleClick}
      onDragOver={handleNativeDragOver}
      onDragLeave={handleNativeDragLeave}
      onDrop={handleNativeDrop}
    >
      {showFileDropOverlay && (
        <div className="absolute inset-0 bg-info/10 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-info/90 text-info-foreground px-3 py-2 rounded-md">
            <FileDown className="h-4 w-4" />
            <span className="text-sm font-medium">{t('terminal.dropToInsertPath')}</span>
          </div>
        </div>
      )}

      <TerminalHeader
        terminalId={id}
        title={terminal?.title || t('terminal.title')}
        status={terminal?.status || 'idle'}
        isClaudeMode={terminal?.isClaudeMode || false}
        tasks={tasks}
        associatedTask={associatedTask}
        onClose={onClose}
        onInvokeClaude={handleInvokeClaude}
        onTitleChange={handleTitleChange}
        onTaskSelect={handleTaskSelect}
        onClearTask={handleClearTask}
        onNewTaskClick={onNewTaskClick}
        terminalCount={terminalCount}
        worktreeConfig={terminal?.worktreeConfig}
        projectPath={projectPath}
        onCreateWorktree={handleCreateWorktree}
        onSelectWorktree={handleSelectWorktree}
        onOpenInIDE={handleOpenInIDE}
        dragHandleListeners={dragHandleListeners}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
      />

      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ minHeight: 0 }}
      />

      {/* Worktree creation dialog */}
      {projectPath && (
        <CreateWorktreeDialog
          open={showWorktreeDialog}
          onOpenChange={setShowWorktreeDialog}
          terminalId={id}
          projectPath={projectPath}
          backlogTasks={backlogTasks}
          onWorktreeCreated={handleWorktreeCreated}
        />
      )}
    </div>
  );
});
