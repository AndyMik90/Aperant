/**
 * FIX-29c: VS Code-style bottom panel terminal
 *
 * A resizable bottom panel that displays task terminal output with:
 * - Drag handle for resizing
 * - Minimize/maximize/close controls
 * - Chat input for sending messages to the agent
 * - Full terminal output with scrolling
 * - Split view with independent view mode tabs per panel
 * - Draggable/reorderable terminal tabs
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, AlignLeft, List, FileText, Code, Columns, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '../ui/button';
import { ErrorBoundary } from '../ui/error-boundary';
import { TaskMonitorChat } from './TaskMonitorChat';
import { SpecDocView } from './SpecDocView';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import { cn } from '../../lib/utils';

export type ViewMode = 'raw' | 'structured' | 'spec' | 'prompt';

interface BottomPanelTab {
  taskId: string;
  taskTitle: string;
}

interface BottomPanelTerminalProps {
  taskId: string | null;
  taskTitle?: string;
  isOpen: boolean;
  openTabs?: BottomPanelTab[];
  onClose: () => void;
  onCloseTab?: (taskId: string) => void;
  onSwitchTab?: (taskId: string, taskTitle: string) => void;
  onMinimize: () => void;
  splitMode?: boolean;
  splitTaskId?: string | null;
  splitTaskTitle?: string;
  onToggleSplit?: () => void;
  onSetSplitTask?: (taskId: string, taskTitle: string) => void;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT_PERCENT = 0.7; // 70% of viewport
const DEFAULT_HEIGHT = 300;

/**
 * Inline view mode tab bar for a single panel (left or right in split, or full in single mode)
 */
function PanelViewModeTabs({
  viewMode,
  onViewModeChange,
  taskTitle,
  className
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  taskTitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 flex-shrink-0", className)}>
      {/* Task label */}
      {taskTitle && (
        <span className="text-xs font-medium text-muted-foreground truncate max-w-[160px] mr-1" title={taskTitle}>
          {taskTitle}
        </span>
      )}
      {/* View mode buttons */}
      <div className="flex items-center bg-card border border-border rounded-md overflow-hidden flex-shrink-0" role="tablist">
        <button
          onClick={() => onViewModeChange('raw')}
          className={cn(
            "px-2 py-0.5 text-[11px] flex items-center gap-1 transition-colors",
            viewMode === 'raw'
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground"
          )}
          title="Raw output"
        >
          <AlignLeft className="h-3 w-3" />
          Raw
        </button>
        <button
          onClick={() => onViewModeChange('structured')}
          className={cn(
            "px-2 py-0.5 text-[11px] flex items-center gap-1 transition-colors",
            viewMode === 'structured'
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground"
          )}
          title="Timeline view"
        >
          <List className="h-3 w-3" />
          Timeline
        </button>
        <button
          onClick={() => onViewModeChange('spec')}
          className={cn(
            "px-2 py-0.5 text-[11px] flex items-center gap-1 transition-colors",
            viewMode === 'spec'
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground"
          )}
          title="Spec document"
        >
          <FileText className="h-3 w-3" />
          Spec
        </button>
        <button
          onClick={() => onViewModeChange('prompt')}
          className={cn(
            "px-2 py-0.5 text-[11px] flex items-center gap-1 transition-colors",
            viewMode === 'prompt'
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground"
          )}
          title="Coding prompt"
        >
          <Code className="h-3 w-3" />
          Prompt
        </button>
      </div>
    </div>
  );
}

/**
 * Sortable tab component for drag-and-drop reordering
 */
function SortableTab({
  tab,
  isActive,
  onSwitchTab,
  onCloseTab
}: {
  tab: BottomPanelTab;
  isActive: boolean;
  onSwitchTab: (taskId: string, taskTitle: string) => void;
  onCloseTab?: (taskId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tab.taskId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1 px-1 py-1.5 text-xs border-r border-border cursor-pointer transition-colors min-w-0 max-w-[200px]",
        isActive
          ? "bg-background text-foreground border-b-2 border-b-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      onClick={() => onSwitchTab(tab.taskId, tab.taskTitle)}
      title={tab.taskTitle}
    >
      {/* Drag handle */}
      <div
        className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </div>
      <span className="truncate flex-1">{tab.taskTitle}</span>
      {onCloseTab && (
        <button
          className="flex-shrink-0 h-4 w-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.taskId);
          }}
          title="Close tab"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Draggable tab for per-pane tab bars in split mode.
 * Supports click-to-switch and drag-to-move between panes.
 */
function DraggablePaneTab({
  tab,
  isActive,
  onSelect,
}: {
  tab: BottomPanelTab;
  isActive: boolean;
  onSelect: (taskId: string, taskTitle: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging: isDragActive } = useDraggable({
    id: `pane-tab-${tab.taskId}`,
    data: { taskId: tab.taskId, taskTitle: tab.taskTitle },
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragActive ? 0.5 : 1,
    zIndex: isDragActive ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1 px-2 py-1 text-xs cursor-pointer transition-colors min-w-0 max-w-[180px] border-r border-border",
        isActive
          ? "bg-background text-foreground border-b-2 border-b-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      onClick={() => onSelect(tab.taskId, tab.taskTitle)}
      title={tab.taskTitle}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
      <span className="truncate flex-1">{tab.taskTitle}</span>
    </div>
  );
}

/**
 * Per-pane tab bar for split mode.
 * Shows all open tabs, highlights the active one, and acts as a droppable zone
 * for cross-pane drag-and-drop.
 */
function PaneTabBar({
  tabs,
  activeTaskId,
  paneId,
  onSelect,
}: {
  tabs: BottomPanelTab[];
  activeTaskId: string | null;
  paneId: string;
  onSelect: (taskId: string, taskTitle: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: paneId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center border-b border-border bg-muted/30 overflow-x-auto flex-shrink-0 min-h-[28px]",
        isOver && "bg-primary/10 border-b-primary/50"
      )}
    >
      {tabs.map((tab) => (
        <DraggablePaneTab
          key={tab.taskId}
          tab={tab}
          isActive={tab.taskId === activeTaskId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * Panel content renderer — renders the terminal/spec/prompt based on view mode
 */
function PanelContent({
  taskId,
  viewMode,
  terminal,
  terminalRef
}: {
  taskId: string;
  viewMode: ViewMode;
  terminal: Terminal | null;
  terminalRef: React.RefObject<HTMLDivElement | null> | null;
}) {
  const { t } = useTranslation(['terminal']);

  if (viewMode === 'spec') {
    return <SpecDocView taskId={taskId} fileName="spec.md" title="Spec" />;
  }
  if (viewMode === 'prompt') {
    return <SpecDocView taskId={taskId} fileName="ralph_prompt.md" title="Prompt" />;
  }
  if (terminal) {
    return (
      <TaskMonitorChat
        terminal={terminal}
        terminalRef={terminalRef ?? { current: null }}
        isActive={true}
        isMinimized={false}
        viewMode={viewMode}
      />
    );
  }
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      {t('terminal:waitingForOutput', { defaultValue: 'Waiting for terminal output...' })}
    </div>
  );
}

export function BottomPanelTerminal({
  taskId,
  taskTitle,
  isOpen,
  openTabs = [],
  onClose,
  onCloseTab,
  onSwitchTab,
  onMinimize,
  splitMode = false,
  splitTaskId = null,
  splitTaskTitle = '',
  onToggleSplit,
  onSetSplitTask
}: BottomPanelTerminalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const [splitViewMode, setSplitViewMode] = useState<ViewMode>('raw');
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Get terminal for the task
  const taskTerminalId = taskId ? `task-${taskId}` : null;
  const terminals = useTerminalStore((state) => state.terminals);
  const terminal = taskTerminalId
    ? terminals.find((t) => t.id === taskTerminalId)
    : null;

  // Get terminal for split task
  const splitTerminalId = splitTaskId ? `task-${splitTaskId}` : null;
  const splitTerminal = splitTerminalId
    ? terminals.find((t) => t.id === splitTerminalId)
    : null;

  // Sync tab order with openTabs — add new tabs, remove stale ones
  useEffect(() => {
    const openIds = new Set(openTabs.map(t => t.taskId));
    setTabOrder(prev => {
      // Keep existing order for tabs that still exist
      const kept = prev.filter(id => openIds.has(id));
      // Add any new tabs at the end
      const existing = new Set(kept);
      const newTabs = openTabs.filter(t => !existing.has(t.taskId)).map(t => t.taskId);
      return [...kept, ...newTabs];
    });
  }, [openTabs]);

  // Ordered tabs for rendering
  const orderedTabs = tabOrder
    .map(id => openTabs.find(t => t.taskId === id))
    .filter((t): t is BottomPanelTab => t !== undefined);

  // DnD sensors for tab reordering
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleTabDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setTabOrder(prev => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  // Track which tab IDs belong to the right pane (everything else is left)
  const [rightPaneTabIds, setRightPaneTabIds] = useState<Set<string>>(new Set());

  // Partition tabs between panes
  const leftTabs = orderedTabs.filter(t => !rightPaneTabIds.has(t.taskId));
  const rightTabs = orderedTabs.filter(t => rightPaneTabIds.has(t.taskId));

  // When entering split mode, move the split task to the right pane
  useEffect(() => {
    if (splitMode && openTabs.length > 1 && taskId) {
      if (!splitTaskId) {
        // Auto-select first other tab for right pane
        const otherTab = openTabs.find(t => t.taskId !== taskId);
        if (otherTab) {
          setRightPaneTabIds(new Set([otherTab.taskId]));
          onSetSplitTask?.(otherTab.taskId, otherTab.taskTitle);
        }
      } else if (!rightPaneTabIds.has(splitTaskId)) {
        // Ensure splitTaskId is in the right pane set
        setRightPaneTabIds(prev => new Set([...prev, splitTaskId]));
      }
    }
    if (!splitMode) {
      setRightPaneTabIds(new Set());
    }
  }, [splitMode, splitTaskId, openTabs, taskId, onSetSplitTask]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync right pane tabs: remove closed tabs, ensure active right tab is present
  useEffect(() => {
    const openIds = new Set(openTabs.map(t => t.taskId));
    setRightPaneTabIds(prev => {
      const cleaned = new Set([...prev].filter(id => openIds.has(id)));
      if (prev.size !== cleaned.size) return cleaned;
      return prev;
    });
  }, [openTabs]);

  // Cross-pane drag handler for split mode
  const handleCrossPaneDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const data = active.data.current as { taskId: string; taskTitle: string } | undefined;
    if (!data) return;

    const overId = String(over.id);
    if (overId === 'drop-left' && rightPaneTabIds.has(data.taskId)) {
      // Move tab from right pane to left pane
      setRightPaneTabIds(prev => {
        const next = new Set(prev);
        next.delete(data.taskId);
        return next;
      });
      onSwitchTab?.(data.taskId, data.taskTitle);
    } else if (overId === 'drop-right' && !rightPaneTabIds.has(data.taskId)) {
      // Move tab from left pane to right pane
      setRightPaneTabIds(prev => new Set([...prev, data.taskId]));
      onSetSplitTask?.(data.taskId, data.taskTitle);
    }
  }, [onSwitchTab, onSetSplitTask, rightPaneTabIds]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startYRef.current = e.clientY;
    startHeightRef.current = height;
  }, [height]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const deltaY = startYRef.current - e.clientY;
    const newHeight = Math.min(
      window.innerHeight * MAX_HEIGHT_PERCENT,
      Math.max(MIN_HEIGHT, startHeightRef.current + deltaY)
    );
    setHeight(newHeight);
    setIsMaximized(false);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse event listeners for drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Toggle maximize
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setHeight(DEFAULT_HEIGHT);
      setIsMaximized(false);
    } else {
      setHeight(window.innerHeight * MAX_HEIGHT_PERCENT);
      setIsMaximized(true);
    }
  }, [isMaximized]);

  if (!isOpen || !taskId) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative bg-background border-t border-border shadow-lg z-40',
        'flex flex-col flex-shrink-0',
        'transition-[height] duration-200',
        isDragging && 'transition-none select-none'
      )}
      style={{ height: isOpen ? height : 0 }}
    >
      {/* Drag handle for resizing */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/50 z-10',
          isDragging && 'bg-primary'
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Task terminal tabs - draggable, shown when multiple terminals are open (hidden in split mode — each pane has its own) */}
      {orderedTabs.length > 1 && !splitMode && (
        <div className="flex-shrink-0 flex items-center border-b border-border bg-muted/30 overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext
              items={orderedTabs.map(t => t.taskId)}
              strategy={horizontalListSortingStrategy}
            >
              {orderedTabs.map((tab) => (
                <SortableTab
                  key={tab.taskId}
                  tab={tab}
                  isActive={tab.taskId === taskId}
                  onSwitchTab={(id, title) => onSwitchTab?.(id, title)}
                  onCloseTab={onCloseTab}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Compact header bar - controls only (view mode tabs moved into panels) */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* In non-split mode, show view mode tabs here */}
          {!splitMode && (
            <PanelViewModeTabs
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              taskTitle={orderedTabs.length <= 1 ? (taskTitle || 'Task Monitor') : undefined}
              className="border-b-0 bg-transparent px-0 py-0"
            />
          )}
          {/* In split mode, just show a label */}
          {splitMode && (
            <span className="text-xs text-muted-foreground">Split View</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <Button
            variant={splitMode ? 'default' : 'ghost'}
            size="icon"
            className="h-6 w-6"
            onClick={onToggleSplit}
            title={splitMode ? 'Disable split view' : 'Enable split view'}
          >
            <Columns className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onMinimize}
            title={t('common:actions.minimize')}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleMaximize}
            title={isMaximized ? t('common:actions.restore', { defaultValue: 'Restore' }) : t('common:actions.maximize')}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
            onClick={onClose}
            title={t('common:buttons.close')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal content area - flex-1 to fill remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {splitMode ? (
          // Split view layout - each panel has its own tab bar and view mode tabs
          <DndContext
            sensors={sensors}
            onDragEnd={handleCrossPaneDragEnd}
          >
            <div className="flex h-full gap-0">
              {/* Left panel - primary task */}
              <div className="flex-1 min-w-0 overflow-hidden border-r border-border flex flex-col">
                <PaneTabBar
                  tabs={leftTabs}
                  activeTaskId={taskId}
                  paneId="drop-left"
                  onSelect={(id, title) => onSwitchTab?.(id, title)}
                />
                <PanelViewModeTabs
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  taskTitle={taskTitle || taskId}
                />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ErrorBoundary>
                    <PanelContent
                      taskId={taskId}
                      viewMode={viewMode}
                      terminal={terminal ?? null}
                      terminalRef={terminalRef}
                    />
                  </ErrorBoundary>
                </div>
              </div>

              {/* Right panel - split task */}
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                <PaneTabBar
                  tabs={rightTabs}
                  activeTaskId={splitTaskId}
                  paneId="drop-right"
                  onSelect={(id, title) => onSetSplitTask?.(id, title)}
                />
                {splitTaskId ? (
                  <>
                    <PanelViewModeTabs
                      viewMode={splitViewMode}
                      onViewModeChange={setSplitViewMode}
                      taskTitle={splitTaskTitle || splitTaskId}
                    />
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <ErrorBoundary>
                        <PanelContent
                          taskId={splitTaskId}
                          viewMode={splitViewMode}
                          terminal={splitTerminal ?? null}
                          terminalRef={null}
                        />
                      </ErrorBoundary>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
                    Click a tab above to open a task here
                  </div>
                )}
              </div>
            </div>
          </DndContext>
        ) : (
          // Single view layout — view mode tabs are in the header bar
          <ErrorBoundary>
            <PanelContent
              taskId={taskId}
              viewMode={viewMode}
              terminal={terminal ?? null}
              terminalRef={terminalRef}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
