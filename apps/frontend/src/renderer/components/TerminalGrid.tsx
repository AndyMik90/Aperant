import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Plus, Grid2X2, FolderTree, File, Folder, History, ChevronDown, Loader2, TerminalSquare, Sparkles } from 'lucide-react';
import { SortableTerminalWrapper } from './SortableTerminalWrapper';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { FileExplorerPanel } from './FileExplorerPanel';
import { cn } from '../lib/utils';
import { useTerminalStore } from '../stores/terminal-store';
import { useTaskStore } from '../stores/task-store';
import { useFileExplorerStore } from '../stores/file-explorer-store';
import { TERMINAL_DOM_UPDATE_DELAY_MS } from '../../shared/constants';
import type { SessionDateInfo } from '../../shared/types';

interface TerminalGridProps {
  projectPath?: string;
  onNewTaskClick?: () => void;
  isActive?: boolean;
}

export function TerminalGrid({ projectPath, onNewTaskClick, isActive = false }: TerminalGridProps) {
  const allTerminals = useTerminalStore((state) => state.terminals);
  // Filter terminals to show only those belonging to the current project
  // Also include legacy terminals without projectPath (created before this change)
  // Exclude exited terminals as they are no longer functional
  // Exclude task monitor terminals (they are now accessible from Kanban task cards)
  const terminals = useMemo(() => {
    const filtered = projectPath
      ? allTerminals.filter(t => t.projectPath === projectPath || !t.projectPath)
      : allTerminals;
    // Exclude exited terminals and task monitor terminals from the visible list
    return filtered.filter(t => t.status !== 'exited' && !t.isTaskMonitor);
  }, [allTerminals, projectPath]);

  // Get tasks from task store for task selection dropdown in terminals
  const tasks = useTaskStore((state) => state.tasks);

  const activeTerminalId = useTerminalStore((state) => state.activeTerminalId);
  const addTerminal = useTerminalStore((state) => state.addTerminal);
  const addClaudeCodeTerminal = useTerminalStore((state) => state.addClaudeCodeTerminal);
  const removeTerminal = useTerminalStore((state) => state.removeTerminal);
  const setActiveTerminal = useTerminalStore((state) => state.setActiveTerminal);
  const canAddTerminal = useTerminalStore((state) => state.canAddTerminal);
  const reorderTerminals = useTerminalStore((state) => state.reorderTerminals);

  // File explorer state
  const fileExplorerOpen = useFileExplorerStore((state) => state.isOpen);
  const toggleFileExplorer = useFileExplorerStore((state) => state.toggle);

  // Session history state
  const [sessionDates, setSessionDates] = useState<SessionDateInfo[]>([]);
  const [isLoadingDates, setIsLoadingDates] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Expanded terminal state - when set, this terminal takes up the full grid space
  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(null);

  // Reset expanded terminal when project changes
  useEffect(() => {
    setExpandedTerminalId(null);
  }, [projectPath]);

  // Fetch available session dates when project changes
  useEffect(() => {
    if (!projectPath) {
      setSessionDates([]);
      return;
    }

    const fetchSessionDates = async () => {
      setIsLoadingDates(true);
      try {
        const result = await window.electronAPI.getTerminalSessionDates(projectPath);
        if (result.success && result.data) {
          setSessionDates(result.data);
        }
      } catch (error) {
        console.error('Failed to fetch session dates:', error);
      } finally {
        setIsLoadingDates(false);
      }
    };

    fetchSessionDates();
  }, [projectPath]);

  // Get addRestoredTerminal from store
  const addRestoredTerminal = useTerminalStore((state) => state.addRestoredTerminal);

  // Handle restoring sessions from a specific date
  const handleRestoreFromDate = useCallback(async (date: string) => {
    if (!projectPath || isRestoring) return;

    setIsRestoring(true);
    try {
      // First get the session data for this date (we need it after restore)
      const sessionsResult = await window.electronAPI.getTerminalSessionsForDate(date, projectPath);
      const sessionsToRestore = sessionsResult.success ? sessionsResult.data || [] : [];

      console.warn(`[TerminalGrid] Found ${sessionsToRestore.length} sessions to restore from ${date}`);

      if (sessionsToRestore.length === 0) {
        console.warn('[TerminalGrid] No sessions found for this date');
        setIsRestoring(false);
        return;
      }

      // Close all existing terminals
      for (const terminal of terminals) {
        await window.electronAPI.destroyTerminal(terminal.id);
        removeTerminal(terminal.id);
      }

      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Restore sessions from the selected date (creates PTYs in main process)
      const result = await window.electronAPI.restoreTerminalSessionsFromDate(
        date,
        projectPath,
        80,
        24
      );

      if (result.success && result.data) {
        console.warn(`[TerminalGrid] Main process restored ${result.data.restored} sessions from ${date}`);

        // Sort sessions by displayOrder before restoring to preserve user's tab ordering
        const sortedSessions = [...sessionsToRestore].sort((a, b) => {
          const orderA = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });

        // Add each successfully restored session to the renderer's terminal store
        for (const sessionResult of result.data.sessions) {
          if (sessionResult.success) {
            const fullSession = sortedSessions.find(s => s.id === sessionResult.id);
            if (fullSession) {
              console.warn(`[TerminalGrid] Adding restored terminal to store: ${fullSession.id}`);
              addRestoredTerminal(fullSession);
            }
          }
        }

        // Refresh session dates to update counts
        const datesResult = await window.electronAPI.getTerminalSessionDates(projectPath);
        if (datesResult.success && datesResult.data) {
          setSessionDates(datesResult.data);
        }
      }
    } catch (error) {
      console.error('Failed to restore sessions:', error);
    } finally {
      setIsRestoring(false);
    }
  }, [projectPath, terminals, removeTerminal, addRestoredTerminal, isRestoring]);

  // Setup drag sensors for both file and terminal drag operations
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Track dragging state for file overlay
  const [activeDragData, setActiveDragData] = React.useState<{
    path: string;
    name: string;
    isDirectory: boolean;
  } | null>(null);

  // Track dragging terminal for overlay
  const [draggingTerminalId, setDraggingTerminalId] = React.useState<string | null>(null);
  const draggingTerminal = terminals.find(t => t.id === draggingTerminalId);

  const handleCloseTerminal = useCallback((id: string) => {
    window.electronAPI.destroyTerminal(id);
    removeTerminal(id);
    // Clear expanded state if the closed terminal was expanded
    if (expandedTerminalId === id) {
      setExpandedTerminalId(null);
    }
  }, [removeTerminal, expandedTerminalId]);

  // Handle keyboard shortcut for new terminal (only when this view is active)
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T or Cmd+T for new terminal
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        if (canAddTerminal(projectPath)) {
          addTerminal(projectPath, projectPath);
        }
      }
      // Ctrl+W or Cmd+W to close active terminal
      if ((e.ctrlKey || e.metaKey) && e.key === 'w' && activeTerminalId) {
        e.preventDefault();
        handleCloseTerminal(activeTerminalId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, addTerminal, canAddTerminal, projectPath, activeTerminalId, handleCloseTerminal]);

  const handleAddTerminal = useCallback(() => {
    if (canAddTerminal(projectPath)) {
      addTerminal(projectPath, projectPath);
    }
  }, [addTerminal, canAddTerminal, projectPath]);

  // Add a new Claude Code terminal and launch claude CLI
  const handleAddClaudeCodeTerminal = useCallback(() => {
    if (canAddTerminal(projectPath)) {
      const terminal = addClaudeCodeTerminal(projectPath, projectPath);
      if (terminal) {
        // Wait for the terminal to be created, then send the claude command
        // The terminal component will create the PTY, after which we send input
        setTimeout(() => {
          window.electronAPI.sendTerminalInput(terminal.id, 'claude --dangerously-skip-permissions\r');
        }, 500);
      }
    }
  }, [addClaudeCodeTerminal, canAddTerminal, projectPath]);

  // Toggle terminal expand state
  const handleToggleExpand = useCallback((terminalId: string) => {
    setExpandedTerminalId(prev => prev === terminalId ? null : terminalId);
  }, []);

  // Handle drag start - store dragged item data
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as {
      type: string;
      path?: string;
      name?: string;
      isDirectory?: boolean;
      terminalId?: string;
    } | undefined;

    if (data?.type === 'file' && data.path && data.name !== undefined) {
      setActiveDragData({
        path: data.path,
        name: data.name,
        isDirectory: data.isDirectory ?? false
      });
    } else if (data?.type === 'terminal-panel') {
      setDraggingTerminalId(event.active.id.toString());
    }
  }, []);

  // Handle drag end - insert file path into terminal or reorder terminals
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const activeData = active.data.current as { type?: string; path?: string } | undefined;

    // Clear drag states
    setActiveDragData(null);
    setDraggingTerminalId(null);

    if (!over) return;

    // Handle terminal reordering
    if (activeData?.type === 'terminal-panel') {
      const activeId = active.id.toString();
      let overId = over.id.toString();

      // Handle case where over is the file drop zone (terminal-xyz) instead of sortable item (xyz)
      if (overId.startsWith('terminal-')) {
        overId = overId.replace('terminal-', '');
      }

      if (activeId !== overId && terminals.some(t => t.id === overId)) {
        reorderTerminals(activeId, overId);

        // Persist the new order to disk so it survives app restarts
        // Use a microtask to ensure the store has updated before we read the new order
        if (projectPath) {
          queueMicrotask(async () => {
            const updatedTerminals = useTerminalStore.getState().terminals;
            const orders = updatedTerminals
              .filter(t => t.projectPath === projectPath || !t.projectPath)
              .map(t => ({ terminalId: t.id, displayOrder: t.displayOrder ?? 0 }));
            try {
              const result = await window.electronAPI.updateTerminalDisplayOrders(projectPath, orders);
              if (!result.success) {
                console.warn('[TerminalGrid] Failed to persist terminal order:', result.error);
              }
            } catch (error) {
              console.warn('[TerminalGrid] Failed to persist terminal order:', error);
            }
          });
        }

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('terminal-refit-all'));
        }, TERMINAL_DOM_UPDATE_DELAY_MS);
      }
      return;
    }

    // Handle file drop on terminal
    const overId = over.id.toString();
    let terminalId: string | null = null;

    if (overId.startsWith('terminal-')) {
      terminalId = overId.replace('terminal-', '');
    } else if (terminals.some(t => t.id === overId)) {
      // closestCenter might return the sortable ID instead of droppable ID
      terminalId = overId;
    }

    if (terminalId && activeData?.path) {
      // Quote the path if it contains spaces
      const quotedPath = activeData.path.includes(' ') ? `"${activeData.path}"` : activeData.path;
      // Insert the file path into the terminal with a trailing space
      window.electronAPI.sendTerminalInput(terminalId, quotedPath + ' ');
    }
  }, [reorderTerminals, terminals, projectPath]);

  // Terminal IDs for SortableContext
  const terminalIds = useMemo(() => terminals.map(t => t.id), [terminals]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex h-10 items-center justify-between border-b border-border bg-card/30 px-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {terminals.length} {terminals.length === 1 ? 'terminal' : 'terminals'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Session history dropdown */}
            {projectPath && sessionDates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    disabled={isRestoring || isLoadingDates}
                  >
                    {isRestoring ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <History className="h-3 w-3" />
                    )}
                    History
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Restore sessions from...
                  </div>
                  <DropdownMenuSeparator />
                  {sessionDates.map((dateInfo) => (
                    <DropdownMenuItem
                      key={dateInfo.date}
                      onClick={() => handleRestoreFromDate(dateInfo.date)}
                      className="flex items-center justify-between"
                    >
                      <span>{dateInfo.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {dateInfo.sessionCount} session{dateInfo.sessionCount !== 1 ? 's' : ''}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* FIX-31: Removed icons from terminal buttons for cleaner look */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddTerminal}
              disabled={!canAddTerminal(projectPath)}
            >
              New Terminal
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-[var(--glow-cyan)]/50 text-[var(--glow-cyan)] hover:bg-[var(--glow-cyan)]/10 hover:border-[var(--glow-cyan)]"
              onClick={handleAddClaudeCodeTerminal}
              disabled={!canAddTerminal(projectPath)}
            >
              New Claude Code
            </Button>
            {/* File explorer toggle button */}
            {projectPath && (
              <Button
                variant={fileExplorerOpen ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={toggleFileExplorer}
              >
                <FolderTree className="h-3 w-3" />
                Files
              </Button>
            )}
          </div>
        </div>

        {/* Main content area with terminal grid and file explorer sidebar */}
        <div className="flex flex-1 overflow-hidden">
          {/* Terminal grid */}
          <div className={cn(
            "flex-1 overflow-auto p-2 transition-all duration-300 ease-out",
            fileExplorerOpen && "pr-0"
          )}>
            {terminals.length === 0 ? (
              /* Empty state - shown when no terminals exist */
              <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="rounded-full bg-card p-4">
                    <Grid2X2 className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Agent Terminals</h2>
                    <p className="mt-1 text-sm text-muted-foreground max-w-md">
                      Spawn multiple terminals to run Claude agents in parallel.
                    </p>
                  </div>
                </div>
                {/* FIX-32: Added both New Terminal and New Claude Code buttons to empty state */}
                <div className="flex gap-2">
                  <Button onClick={handleAddTerminal} variant="outline">
                    New Terminal
                  </Button>
                  <Button
                    onClick={handleAddClaudeCodeTerminal}
                    className="border-[var(--glow-cyan)]/50 text-[var(--glow-cyan)] bg-transparent hover:bg-[var(--glow-cyan)]/10"
                    variant="outline"
                  >
                    New Claude Code
                  </Button>
                </div>
              </div>
            ) : expandedTerminalId ? (
              // Show only the expanded terminal
              (() => {
                const expandedTerminal = terminals.find(t => t.id === expandedTerminalId);
                if (!expandedTerminal) return null;
                return (
                  <div className="h-full p-1">
                    <SortableTerminalWrapper
                      id={expandedTerminal.id}
                      cwd={expandedTerminal.cwd || projectPath}
                      projectPath={projectPath}
                      isActive={expandedTerminal.id === activeTerminalId}
                      onClose={() => handleCloseTerminal(expandedTerminal.id)}
                      onActivate={() => setActiveTerminal(expandedTerminal.id)}
                      tasks={tasks}
                      onNewTaskClick={onNewTaskClick}
                      terminalCount={1}
                      isExpanded={true}
                      onToggleExpand={() => handleToggleExpand(expandedTerminal.id)}
                    />
                  </div>
                );
              })()
            ) : (
              /* Simple grid layout for terminals */
              <SortableContext items={terminalIds} strategy={rectSortingStrategy}>
                <div className={cn(
                  "grid gap-2 h-full p-2",
                  terminals.length === 1 && "grid-cols-1",
                  terminals.length === 2 && "grid-cols-2",
                  terminals.length >= 3 && terminals.length <= 4 && "grid-cols-2 grid-rows-2",
                  terminals.length >= 5 && terminals.length <= 6 && "grid-cols-3 grid-rows-2",
                  terminals.length >= 7 && "grid-cols-3 grid-rows-3"
                )}>
                  {terminals.map((terminal) => (
                    <div key={terminal.id} className="min-h-48">
                      <SortableTerminalWrapper
                        id={terminal.id}
                        cwd={terminal.cwd || projectPath}
                        projectPath={projectPath}
                        isActive={terminal.id === activeTerminalId}
                        onClose={() => handleCloseTerminal(terminal.id)}
                        onActivate={() => setActiveTerminal(terminal.id)}
                        tasks={tasks}
                        onNewTaskClick={onNewTaskClick}
                        terminalCount={terminals.length}
                        isExpanded={false}
                        onToggleExpand={() => handleToggleExpand(terminal.id)}
                      />
                    </div>
                  ))}
                </div>
              </SortableContext>
            )}
          </div>

          {/* File explorer panel (slides from right, pushes content) */}
          {projectPath && <FileExplorerPanel projectPath={projectPath} />}
        </div>

        {/* Drag overlay - shows what's being dragged */}
        <DragOverlay>
          {activeDragData && (
            <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 shadow-lg">
              {activeDragData.isDirectory ? (
                <Folder className="h-4 w-4 text-warning" />
              ) : (
                <File className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm">{activeDragData.name}</span>
            </div>
          )}
          {draggingTerminal && (
            <div className="flex items-center gap-2 bg-card border border-primary rounded-md px-3 py-2 shadow-lg">
              <TerminalSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{draggingTerminal.title || 'Terminal'}</span>
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
