import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Plus, Grid2X2, FolderTree, File, Folder, History, ChevronDown, ChevronLeft, ChevronRight, Loader2, TerminalSquare, GripVertical } from 'lucide-react';
import { Group, Panel, Separator, type PanelImperativeHandle, type GroupImperativeHandle } from 'react-resizable-panels';
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
  const terminals = useMemo(() => {
    const filtered = projectPath
      ? allTerminals.filter(t => t.projectPath === projectPath || !t.projectPath)
      : allTerminals;
    // Exclude exited terminals from the visible list
    return filtered.filter(t => t.status !== 'exited');
  }, [allTerminals, projectPath]);

  // Get tasks from task store for task selection dropdown in terminals
  const tasks = useTaskStore((state) => state.tasks);

  // Separate terminals into task monitors (by status) and regular terminals
  // Note: done/pr_created tasks are shown on Worktrees page, not in terminal grid
  const { planningTaskTerminals, inProgressTaskTerminals, aiReviewTaskTerminals, humanReviewTaskTerminals, regularTerminals } = useMemo(() => {
    const planning: typeof terminals = [];
    const inProgress: typeof terminals = [];
    const aiReview: typeof terminals = [];
    const humanReview: typeof terminals = [];
    const regular: typeof terminals = [];

    terminals.forEach(t => {
      if (t.isTaskMonitor && t.taskId) {
        // Find the actual task to get its real status
        const task = tasks.find(task => task.id === t.taskId);
        if (task) {
          switch (task.status) {
            case 'planning':
              planning.push(t);
              break;
            case 'coding':
              inProgress.push(t);
              break;
            case 'ai_review':
              aiReview.push(t);
              break;
            case 'human_review':
              humanReview.push(t);
              break;
            // done/pr_created tasks go to Worktrees page - skip them here
          }
        }
      } else if (!t.isTaskMonitor) {
        regular.push(t);
      }
    });

    return {
      planningTaskTerminals: planning,
      inProgressTaskTerminals: inProgress,
      aiReviewTaskTerminals: aiReview,
      humanReviewTaskTerminals: humanReview,
      regularTerminals: regular,
    };
  }, [terminals, tasks]);
  const activeTerminalId = useTerminalStore((state) => state.activeTerminalId);
  const addTerminal = useTerminalStore((state) => state.addTerminal);
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

  // Panel refs for programmatic collapse/expand
  const panelRefs = {
    planning: useRef<PanelImperativeHandle>(null),
    inProgress: useRef<PanelImperativeHandle>(null),
    aiReview: useRef<PanelImperativeHandle>(null),
    humanReview: useRef<PanelImperativeHandle>(null),
    terminals: useRef<PanelImperativeHandle>(null),
  };

  // Group ref for layout management
  const groupRef = useRef<GroupImperativeHandle>(null);

  // Collapsed columns state - tracks which columns are manually collapsed
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());

  // Redistribute space among non-collapsed panels
  const redistributeLayout = useCallback((newCollapsedSet: Set<string>) => {
    if (!groupRef.current) return;

    const collapsedSize = 1.5; // Match the collapsedSize prop
    const panelIds = ['col-planning', 'col-in-progress', 'col-ai-review', 'col-human-review', 'col-terminals'];
    const columnIdToPanel: Record<string, string> = {
      'planning': 'col-planning',
      'in-progress': 'col-in-progress',
      'ai-review': 'col-ai-review',
      'human-review': 'col-human-review',
      'terminals': 'col-terminals',
    };

    const collapsedCount = newCollapsedSet.size;
    const expandedCount = 5 - collapsedCount;

    if (expandedCount === 0) return; // All collapsed, nothing to redistribute

    // Calculate: collapsed panels get 8%, expanded panels share the rest equally
    const totalCollapsedSpace = collapsedCount * collapsedSize;
    const remainingSpace = 100 - totalCollapsedSpace;
    const expandedPanelSize = remainingSpace / expandedCount;

    const newLayout: Record<string, number> = {};
    Object.entries(columnIdToPanel).forEach(([columnId, panelId]) => {
      if (newCollapsedSet.has(columnId)) {
        newLayout[panelId] = collapsedSize;
      } else {
        newLayout[panelId] = expandedPanelSize;
      }
    });

    // Apply the new layout
    groupRef.current.setLayout(newLayout);
  }, []);

  // Toggle column collapse state - calls the Panel's imperative API
  const toggleColumnCollapse = useCallback((columnId: string) => {
    const refMap: Record<string, React.RefObject<PanelImperativeHandle | null>> = {
      'planning': panelRefs.planning,
      'in-progress': panelRefs.inProgress,
      'ai-review': panelRefs.aiReview,
      'human-review': panelRefs.humanReview,
      'terminals': panelRefs.terminals,
    };

    const panelRef = refMap[columnId];
    if (panelRef?.current) {
      // Use our own state to determine if collapsed (more reliable than library's isCollapsed)
      const isCurrentlyCollapsed = collapsedColumns.has(columnId);
      if (isCurrentlyCollapsed) {
        panelRef.current.expand();
        // Update local state and redistribute
        const next = new Set(collapsedColumns);
        next.delete(columnId);
        setCollapsedColumns(next);
        // Redistribute after state update
        setTimeout(() => redistributeLayout(next), 50);
      } else {
        panelRef.current.collapse();
        // Update local state and redistribute
        const next = new Set([...collapsedColumns, columnId]);
        setCollapsedColumns(next);
        // Redistribute after state update
        setTimeout(() => redistributeLayout(next), 50);
      }
    }
  }, [collapsedColumns, redistributeLayout]);

  // Reset expanded terminal when project changes
  useEffect(() => {
    setExpandedTerminalId(null);
  }, [projectPath]);

  // Track previous terminal counts to detect changes
  const prevCountsRef = useRef<Record<string, number>>({});
  // Track if this is the initial mount (need longer delay for panel group to initialize)
  const isInitialMountRef = useRef(true);

  // Auto-collapse empty columns, auto-expand columns that get terminals
  // Use a small timeout to ensure panel refs are ready after render
  useEffect(() => {
    const columnTerminalCounts: Record<string, number> = {
      'planning': planningTaskTerminals.length,
      'in-progress': inProgressTaskTerminals.length,
      'ai-review': aiReviewTaskTerminals.length,
      'human-review': humanReviewTaskTerminals.length,
      'terminals': regularTerminals.length,
    };

    const refMap: Record<string, React.RefObject<PanelImperativeHandle | null>> = {
      'planning': panelRefs.planning,
      'in-progress': panelRefs.inProgress,
      'ai-review': panelRefs.aiReview,
      'human-review': panelRefs.humanReview,
      'terminals': panelRefs.terminals,
    };

    // Use longer delay on initial mount to ensure panel group is fully initialized
    const delay = isInitialMountRef.current ? 300 : 100;

    const timeoutId = setTimeout(() => {
      let hasChanges = false;
      const newCollapsed = new Set(collapsedColumns);

      Object.entries(columnTerminalCounts).forEach(([columnId, count]) => {
        const panelRef = refMap[columnId];
        const prevCount = prevCountsRef.current[columnId] ?? 0;

        if (panelRef?.current) {
          // Auto-collapse: went from having terminals to having none
          if (count === 0 && prevCount > 0) {
            panelRef.current.collapse();
            newCollapsed.add(columnId);
            hasChanges = true;
          }
          // Auto-expand: went from having none to having terminals
          else if (count > 0 && prevCount === 0) {
            panelRef.current.expand();
            newCollapsed.delete(columnId);
            hasChanges = true;
          }
          // Initial collapse: first render with 0 terminals
          else if (count === 0 && prevCount === 0 && prevCountsRef.current[columnId] === undefined) {
            panelRef.current.collapse();
            newCollapsed.add(columnId);
            hasChanges = true;
          }
        }
      });

      // Update state and redistribute layout if there were changes
      if (hasChanges) {
        setCollapsedColumns(newCollapsed);
        // Redistribute layout after a small delay, with retry for initial mount
        const redistributeDelay = isInitialMountRef.current ? 100 : 50;
        setTimeout(() => {
          redistributeLayout(newCollapsed);
          // On initial mount, do a second redistribute to ensure it takes effect
          if (isInitialMountRef.current) {
            setTimeout(() => redistributeLayout(newCollapsed), 150);
          }
        }, redistributeDelay);
      }

      // Update previous counts and mark initial mount as complete
      prevCountsRef.current = columnTerminalCounts;
      isInitialMountRef.current = false;
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [planningTaskTerminals.length, inProgressTaskTerminals.length, aiReviewTaskTerminals.length, humanReviewTaskTerminals.length, regularTerminals.length, collapsedColumns, redistributeLayout]);

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
  }, [reorderTerminals, terminals]);

  // Terminal IDs for SortableContext (only regular terminals are sortable)
  const terminalIds = useMemo(() => regularTerminals.map(t => t.id), [regularTerminals]);

  // Empty state
  if (terminals.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-card p-4">
            <Grid2X2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agent Terminals</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-md">
              Spawn multiple terminals to run Claude agents in parallel.
              Use <kbd className="px-1.5 py-0.5 text-xs bg-card border border-border rounded">Ctrl+T</kbd> to create a new terminal.
            </p>
          </div>
        </div>
        <Button onClick={handleAddTerminal} className="gap-2">
          <Plus className="h-4 w-4" />
          New Terminal
        </Button>
      </div>
    );
  }

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
            {inProgressTaskTerminals.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                <span className="text-blue-500">{inProgressTaskTerminals.length}</span> in progress
              </span>
            )}
            {aiReviewTaskTerminals.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                <span className="text-purple-500">{aiReviewTaskTerminals.length}</span> ai review
              </span>
            )}
            {humanReviewTaskTerminals.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                <span className="text-orange-500">{humanReviewTaskTerminals.length}</span> human review
              </span>
            )}
            {regularTerminals.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                {regularTerminals.length} {regularTerminals.length === 1 ? 'terminal' : 'terminals'}
              </span>
            )}
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
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleAddTerminal}
              disabled={!canAddTerminal(projectPath)}
            >
              <Plus className="h-3 w-3" />
              New Terminal
              <kbd className="ml-1 text-[10px] text-muted-foreground">
                {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+T
              </kbd>
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
          {/* Terminal grid using resizable panels */}
          <div className={cn(
            "flex-1 overflow-auto p-2 transition-all duration-300 ease-out",
            fileExplorerOpen && "pr-0"
          )}>
            {expandedTerminalId ? (
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
              /* Kanban-style vertical columns layout with resizable panels - all columns always rendered */
              <Group orientation="horizontal" className="flex-1 p-4 h-full" groupRef={groupRef}>
                {/* Planning Column (Backlog) - FIRST */}
                <Panel
                  panelRef={panelRefs.planning}
                  id="col-planning"
                  defaultSize={20}
                  minSize={3}
                  collapsible
                  collapsedSize={1.5}
                >
                  <div className={cn(
                    "flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm border-t-2 border-t-slate-500/60 mx-1 transition-all",
                    collapsedColumns.has('planning') && "items-center"
                  )}>
                    {collapsedColumns.has('planning') ? (
                      <button
                        onClick={() => toggleColumnCollapse('planning')}
                        className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
                        title="Expand Planning"
                      >
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                        <span className="text-xs font-medium text-slate-400 [writing-mode:vertical-rl] rotate-180">
                          Planning ({planningTaskTerminals.length})
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                          <div className="flex items-center gap-2.5">
                            <h2 className="font-semibold text-sm text-foreground">Planning</h2>
                            <span className="text-xs font-medium bg-slate-500/20 text-slate-400 px-2 py-0.5 rounded-full">
                              {planningTaskTerminals.length}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleColumnCollapse('planning')}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="Collapse column"
                          >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-auto">
                          {planningTaskTerminals.length > 0 ? (
                            planningTaskTerminals.map((terminal) => (
                              <div key={terminal.id} className={terminal.isMinimized ? 'flex-shrink-0' : 'flex-1 min-h-48'}>
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
                            ))
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                              No terminals
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>

                <Separator className="w-2 flex items-center justify-center group cursor-col-resize">
                  <GripVertical className="h-6 w-4 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                </Separator>

                {/* In Progress Column */}
                <Panel
                  panelRef={panelRefs.inProgress}
                  id="col-in-progress"
                  defaultSize={20}
                  minSize={3}
                  collapsible
                  collapsedSize={1.5}
                >
                  <div className={cn(
                    "flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm border-t-2 border-t-blue-500/60 mx-1 transition-all",
                    collapsedColumns.has('in-progress') && "items-center"
                  )}>
                    {collapsedColumns.has('in-progress') ? (
                      <button
                        onClick={() => toggleColumnCollapse('in-progress')}
                        className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
                        title="Expand In Progress"
                      >
                        <ChevronRight className="h-4 w-4 text-blue-400" />
                        <span className="text-xs font-medium text-blue-400 [writing-mode:vertical-rl] rotate-180">
                          In Progress ({inProgressTaskTerminals.length})
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                          <div className="flex items-center gap-2.5">
                            <h2 className="font-semibold text-sm text-foreground">In Progress</h2>
                            <span className="text-xs font-medium bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                              {inProgressTaskTerminals.length}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleColumnCollapse('in-progress')}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="Collapse column"
                          >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-auto">
                          {inProgressTaskTerminals.length > 0 ? (
                            inProgressTaskTerminals.map((terminal) => (
                              <div key={terminal.id} className={terminal.isMinimized ? 'flex-shrink-0' : 'flex-1 min-h-48'}>
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
                            ))
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                              No terminals
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>

                <Separator className="w-2 flex items-center justify-center group cursor-col-resize">
                  <GripVertical className="h-6 w-4 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                </Separator>

                {/* AI Review Column */}
                <Panel
                  panelRef={panelRefs.aiReview}
                  id="col-ai-review"
                  defaultSize={20}
                  minSize={3}
                  collapsible
                  collapsedSize={1.5}
                >
                  <div className={cn(
                    "flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm border-t-2 border-t-purple-500/60 mx-1 transition-all",
                    collapsedColumns.has('ai-review') && "items-center"
                  )}>
                    {collapsedColumns.has('ai-review') ? (
                      <button
                        onClick={() => toggleColumnCollapse('ai-review')}
                        className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
                        title="Expand AI Review"
                      >
                        <ChevronRight className="h-4 w-4 text-purple-400" />
                        <span className="text-xs font-medium text-purple-400 [writing-mode:vertical-rl] rotate-180">
                          AI Review ({aiReviewTaskTerminals.length})
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                          <div className="flex items-center gap-2.5">
                            <h2 className="font-semibold text-sm text-foreground">AI Review</h2>
                            <span className="text-xs font-medium bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                              {aiReviewTaskTerminals.length}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleColumnCollapse('ai-review')}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="Collapse column"
                          >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-auto">
                          {aiReviewTaskTerminals.length > 0 ? (
                            aiReviewTaskTerminals.map((terminal) => (
                              <div key={terminal.id} className={terminal.isMinimized ? 'flex-shrink-0' : 'flex-1 min-h-48'}>
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
                            ))
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                              No terminals
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>

                <Separator className="w-2 flex items-center justify-center group cursor-col-resize">
                  <GripVertical className="h-6 w-4 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                </Separator>

                {/* Human Review Column */}
                <Panel
                  panelRef={panelRefs.humanReview}
                  id="col-human-review"
                  defaultSize={20}
                  minSize={3}
                  collapsible
                  collapsedSize={1.5}
                >
                  <div className={cn(
                    "flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm border-t-2 border-t-orange-500/60 mx-1 transition-all",
                    collapsedColumns.has('human-review') && "items-center"
                  )}>
                    {collapsedColumns.has('human-review') ? (
                      <button
                        onClick={() => toggleColumnCollapse('human-review')}
                        className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
                        title="Expand Human Review"
                      >
                        <ChevronRight className="h-4 w-4 text-orange-400" />
                        <span className="text-xs font-medium text-orange-400 [writing-mode:vertical-rl] rotate-180">
                          Human Review ({humanReviewTaskTerminals.length})
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                          <div className="flex items-center gap-2.5">
                            <h2 className="font-semibold text-sm text-foreground">Human Review</h2>
                            <span className="text-xs font-medium bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                              {humanReviewTaskTerminals.length}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleColumnCollapse('human-review')}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="Collapse column"
                          >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-auto">
                          {humanReviewTaskTerminals.length > 0 ? (
                            humanReviewTaskTerminals.map((terminal) => (
                              <div key={terminal.id} className={terminal.isMinimized ? 'flex-shrink-0' : 'flex-1 min-h-48'}>
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
                            ))
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                              No terminals
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>

                <Separator className="w-2 flex items-center justify-center group cursor-col-resize">
                  <GripVertical className="h-6 w-4 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                </Separator>

                {/* Regular Terminals Column */}
                <Panel
                  panelRef={panelRefs.terminals}
                  id="col-terminals"
                  defaultSize={20}
                  minSize={3}
                  collapsible
                  collapsedSize={1.5}
                >
                  <div className={cn(
                    "flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm border-t-2 border-t-muted-foreground/30 mx-1 transition-all",
                    collapsedColumns.has('terminals') && "items-center"
                  )}>
                    {collapsedColumns.has('terminals') ? (
                      <button
                        onClick={() => toggleColumnCollapse('terminals')}
                        className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
                        title="Expand Terminals"
                      >
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                          Terminals ({regularTerminals.length})
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                          <div className="flex items-center gap-2.5">
                            <h2 className="font-semibold text-sm text-foreground">Terminals</h2>
                            <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                              {regularTerminals.length}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleColumnCollapse('terminals')}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="Collapse column"
                          >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-auto">
                          {regularTerminals.length > 0 ? (
                            <SortableContext items={terminalIds} strategy={rectSortingStrategy}>
                              {regularTerminals.map((terminal) => (
                                <div key={terminal.id} className={terminal.isMinimized ? 'flex-shrink-0' : 'flex-1 min-h-48'}>
                                  <SortableTerminalWrapper
                                    id={terminal.id}
                                    cwd={terminal.cwd || projectPath}
                                    projectPath={projectPath}
                                    isActive={terminal.id === activeTerminalId}
                                    onClose={() => handleCloseTerminal(terminal.id)}
                                    onActivate={() => setActiveTerminal(terminal.id)}
                                    tasks={tasks}
                                    onNewTaskClick={onNewTaskClick}
                                    terminalCount={regularTerminals.length}
                                    isExpanded={false}
                                    onToggleExpand={() => handleToggleExpand(terminal.id)}
                                  />
                                </div>
                              ))}
                            </SortableContext>
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                              No terminals
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Panel>
              </Group>
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
