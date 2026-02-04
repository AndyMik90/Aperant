import React, { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
  type GroupImperativeHandle,
} from 'react-resizable-panels';
import { useViewState } from '../contexts/ViewStateContext';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { Plus, Inbox, Loader2, Eye, RefreshCw, GitPullRequest, X, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { TaskCard } from './TaskCard';
import { SortableTaskCard } from './SortableTaskCard';
import { TASK_STATUS_COLUMNS, TASK_STATUS_LABELS } from '../../shared/constants';
import { cn } from '../lib/utils';
import { persistTaskStatus, forceCompleteTask, useTaskStore } from '../stores/task-store';
import { useKanbanStore } from '../stores/kanban-store';
import { useToast } from '../hooks/use-toast';
import { WorktreeCleanupDialog } from './WorktreeCleanupDialog';
import { BulkPRDialog } from './BulkPRDialog';
import { BottomPanelTerminal } from './terminal/BottomPanelTerminal';
import type { Task, TaskStatus, TaskOrderState } from '../../shared/types';

// Type guard for valid drop column targets - preserves literal type from TASK_STATUS_COLUMNS
const VALID_DROP_COLUMNS = new Set<string>(TASK_STATUS_COLUMNS);
function isValidDropColumn(id: string): id is typeof TASK_STATUS_COLUMNS[number] {
  return VALID_DROP_COLUMNS.has(id);
}

/**
 * Get the visual column for a task status.
 * Done/pr_created tasks are not shown on the Kanban board (they live on Worktrees page).
 * This is used to compare visual positions during drag-and-drop operations.
 */
function getVisualColumn(status: TaskStatus): typeof TASK_STATUS_COLUMNS[number] | null {
  // done/pr_created tasks are not shown on Kanban board
  if (status === 'done' || status === 'pr_created') {
    return null;
  }
  return status;
}

interface KanbanBoardProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onNewTaskClick?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  hideRefreshButton?: boolean;
}

interface DroppableColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => unknown;
  isOver: boolean;
  onAddClick?: () => void;
  // Selection props for human_review column
  selectedTaskIds?: Set<string>;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onToggleSelect?: (taskId: string) => void;
  // Collapse props
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  // FIX-29b: Bottom panel terminal callback
  onOpenBottomPanel?: (taskId: string, taskTitle: string) => void;
}

/**
 * Compare two tasks arrays for meaningful changes.
 * Returns true if tasks are equivalent (should skip re-render).
 */
function tasksAreEquivalent(prevTasks: Task[], nextTasks: Task[]): boolean {
  if (prevTasks.length !== nextTasks.length) return false;
  if (prevTasks === nextTasks) return true;

  // Compare by ID and fields that affect rendering
  for (let i = 0; i < prevTasks.length; i++) {
    const prev = prevTasks[i];
    const next = nextTasks[i];
    if (
      prev.id !== next.id ||
      prev.status !== next.status ||
      prev.executionProgress?.phase !== next.executionProgress?.phase ||
      prev.updatedAt !== next.updatedAt
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Custom comparator for DroppableColumn memo.
 */
function droppableColumnPropsAreEqual(
  prevProps: DroppableColumnProps,
  nextProps: DroppableColumnProps
): boolean {
  // Quick checks first
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.isOver !== nextProps.isOver) return false;
  if (prevProps.onTaskClick !== nextProps.onTaskClick) return false;
  if (prevProps.onStatusChange !== nextProps.onStatusChange) return false;
  if (prevProps.onAddClick !== nextProps.onAddClick) return false;
  if (prevProps.onSelectAll !== nextProps.onSelectAll) return false;
  if (prevProps.onDeselectAll !== nextProps.onDeselectAll) return false;
  if (prevProps.onToggleSelect !== nextProps.onToggleSelect) return false;
  if (prevProps.isCollapsed !== nextProps.isCollapsed) return false;
  if (prevProps.onToggleCollapse !== nextProps.onToggleCollapse) return false;
  if (prevProps.onOpenBottomPanel !== nextProps.onOpenBottomPanel) return false;

  // Compare selectedTaskIds Set
  if (prevProps.selectedTaskIds !== nextProps.selectedTaskIds) {
    // If one is undefined and other isn't, different
    if (!prevProps.selectedTaskIds || !nextProps.selectedTaskIds) return false;
    // Compare Set contents
    if (prevProps.selectedTaskIds.size !== nextProps.selectedTaskIds.size) return false;
    for (const id of prevProps.selectedTaskIds) {
      if (!nextProps.selectedTaskIds.has(id)) return false;
    }
  }

  // Deep compare tasks
  const tasksEqual = tasksAreEquivalent(prevProps.tasks, nextProps.tasks);

  // Only log when re-rendering (reduces noise)
  if (window.DEBUG && !tasksEqual) {
    console.log(`[DroppableColumn] Re-render: ${nextProps.status} column (${nextProps.tasks.length} tasks)`);
  }

  return tasksEqual;
}

// Empty state content for each column
const getEmptyStateContent = (status: TaskStatus, t: (key: string) => string): { icon: React.ReactNode; message: string; subtext?: string; showAddButton?: boolean } => {
  switch (status) {
    case 'planning':
      return {
        icon: <Inbox className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyPlanning'),
        subtext: t('kanban.emptyPlanningHint'),
        showAddButton: true
      };
    case 'coding':
      return {
        icon: <Loader2 className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyCoding'),
        subtext: t('kanban.emptyCodingHint')
      };
    case 'ai_review':
      return {
        icon: <Eye className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyAiReview'),
        subtext: t('kanban.emptyAiReviewHint')
      };
    case 'human_review':
      return {
        icon: <Eye className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyHumanReview'),
        subtext: t('kanban.emptyHumanReviewHint')
      };
    default:
      return {
        icon: <Inbox className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyDefault')
      };
  }
};

const DroppableColumn = memo(function DroppableColumn({ status, tasks, onTaskClick, onStatusChange, isOver, onAddClick, selectedTaskIds, onSelectAll, onDeselectAll, onToggleSelect, isCollapsed, onToggleCollapse, onOpenBottomPanel }: DroppableColumnProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { setNodeRef } = useDroppable({
    id: status
  });

  // Calculate selection state for human_review column
  const isHumanReview = status === 'human_review';
  const selectedCount = selectedTaskIds?.size ?? 0;
  const taskCount = tasks.length;
  const isAllSelected = isHumanReview && taskCount > 0 && selectedCount === taskCount;
  const isSomeSelected = isHumanReview && selectedCount > 0 && selectedCount < taskCount;

  // Determine checkbox checked state: true (all), 'indeterminate' (some), false (none)
  const selectAllCheckedState: boolean | 'indeterminate' = isAllSelected
    ? true
    : isSomeSelected
      ? 'indeterminate'
      : false;

  // Handle select all checkbox change
  const handleSelectAllChange = useCallback(() => {
    if (isAllSelected) {
      onDeselectAll?.();
    } else {
      onSelectAll?.();
    }
  }, [isAllSelected, onSelectAll, onDeselectAll]);

  // Memoize taskIds to prevent SortableContext from re-rendering unnecessarily
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  // Create stable onClick handlers for each task to prevent unnecessary re-renders
  const onClickHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    tasks.forEach((task) => {
      handlers.set(task.id, () => onTaskClick(task));
    });
    return handlers;
  }, [tasks, onTaskClick]);

  // Create stable onStatusChange handlers for each task
  const onStatusChangeHandlers = useMemo(() => {
    const handlers = new Map<string, (newStatus: TaskStatus) => unknown>();
    tasks.forEach((task) => {
      handlers.set(task.id, (newStatus: TaskStatus) => onStatusChange(task.id, newStatus));
    });
    return handlers;
  }, [tasks, onStatusChange]);

  // Create stable onToggleSelect handlers for each task (only for human_review column)
  const onToggleSelectHandlers = useMemo(() => {
    if (!onToggleSelect) return null;
    const handlers = new Map<string, () => void>();
    tasks.forEach((task) => {
      handlers.set(task.id, () => onToggleSelect(task.id));
    });
    return handlers;
  }, [tasks, onToggleSelect]);

  // Memoize task card elements to prevent recreation on every render
  const taskCards = useMemo(() => {
    if (tasks.length === 0) return null;
    const isSelectable = !!onToggleSelectHandlers;
    return tasks.map((task) => (
      <SortableTaskCard
        key={task.id}
        task={task}
        onClick={onClickHandlers.get(task.id)!}
        onStatusChange={onStatusChangeHandlers.get(task.id)}
        isSelectable={isSelectable}
        isSelected={isSelectable ? selectedTaskIds?.has(task.id) : undefined}
        onToggleSelect={onToggleSelectHandlers?.get(task.id)}
        onOpenBottomPanel={onOpenBottomPanel}
      />
    ));
  }, [tasks, onClickHandlers, onStatusChangeHandlers, onToggleSelectHandlers, selectedTaskIds, onOpenBottomPanel]);

  const getColumnBorderColor = (): string => {
    switch (status) {
      case 'planning':
        return 'column-planning';
      case 'coding':
        return 'column-coding';
      case 'ai_review':
        return 'column-ai-review';
      case 'human_review':
        return 'column-human-review';
      default:
        return 'border-t-muted-foreground/30';
    }
  };

  const emptyState = getEmptyStateContent(status, t);

  // Get column color for collapsed state
  const getCollapsedTextColor = (): string => {
    switch (status) {
      case 'planning':
        return 'text-amber-400';
      case 'coding':
        return 'text-blue-400';
      case 'ai_review':
        return 'text-purple-400';
      case 'human_review':
        return 'text-orange-400';
      default:
        return 'text-muted-foreground';
    }
  };

  // Collapsed view - vertical text with expand button
  if (isCollapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex h-full flex-col items-center rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm transition-all duration-200',
          getColumnBorderColor(),
          'border-t-2'
        )}
      >
        <button
          onClick={onToggleCollapse}
          className="flex flex-col items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors h-full justify-center"
          title={`Expand ${t(TASK_STATUS_LABELS[status])}`}
        >
          <ChevronRight className={cn("h-4 w-4", getCollapsedTextColor())} />
          <span className={cn("text-xs font-medium [writing-mode:vertical-rl] rotate-180", getCollapsedTextColor())}>
            {t(TASK_STATUS_LABELS[status])} ({tasks.length})
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full flex-col rounded-xl border border-white/5 bg-gradient-to-b from-secondary/30 to-transparent backdrop-blur-sm transition-all duration-200',
        getColumnBorderColor(),
        'border-t-2',
        isOver && 'drop-zone-highlight'
      )}
    >
      {/* Column header - enhanced styling */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          {/* Select All checkbox for human_review column */}
          {isHumanReview && onSelectAll && onDeselectAll && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Checkbox
                    checked={selectAllCheckedState}
                    onCheckedChange={handleSelectAllChange}
                    disabled={taskCount === 0}
                    aria-label={isAllSelected ? t('kanban.deselectAll') : t('kanban.selectAll')}
                    className="h-4 w-4"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {isAllSelected ? t('kanban.deselectAll') : t('kanban.selectAll')}
              </TooltipContent>
            </Tooltip>
          )}
          <h2 className="font-semibold text-sm text-foreground">
            {t(TASK_STATUS_LABELS[status])}
          </h2>
          <span className="column-count-badge">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* FIX-28: Removed duplicate '+' button from Planning column header
              The '+' button is already available in the sidebar */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Collapse column"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full px-3 pb-3 pt-2">
          <SortableContext
            items={taskIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3 min-h-[120px]">
              {tasks.length === 0 ? (
                <div
                  className={cn(
                    'empty-column-dropzone flex flex-col items-center justify-center py-6',
                    isOver && 'active'
                  )}
                >
                  {isOver ? (
                    <>
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium text-primary">{t('kanban.dropHere')}</span>
                    </>
                  ) : (
                    <>
                      {emptyState.icon}
                      <span className="mt-2 text-sm font-medium text-muted-foreground/70">
                        {emptyState.message}
                      </span>
                      {emptyState.subtext && (
                        <span className="mt-0.5 text-xs text-muted-foreground/50">
                          {emptyState.subtext}
                        </span>
                      )}
                      {emptyState.showAddButton && onAddClick && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={onAddClick}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          {t('kanban.newTask')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                taskCards
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
}, droppableColumnPropsAreEqual);

export function KanbanBoard({ tasks, onTaskClick, onNewTaskClick, onRefresh, isRefreshing, hideRefreshButton }: KanbanBoardProps) {
  const { t } = useTranslation(['tasks', 'dialogs', 'common']);
  const { toast } = useToast();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const { showArchived, toggleShowArchived } = useViewState();

  // Panel refs for programmatic collapse/expand
  const panelRefs = useRef<Record<string, PanelImperativeHandle | null>>({
    planning: null,
    coding: null,
    ai_review: null,
    human_review: null,
  });

  // Group ref for layout management
  const groupRef = useRef<GroupImperativeHandle>(null);

  // FIX-23: Collapsed columns state from persisted store
  const persistedCollapsedColumns = useKanbanStore((state) => state.collapsedColumns);
  const toggleColumnCollapseStore = useKanbanStore((state) => state.toggleColumnCollapse);

  // Convert persisted array to Set for efficient lookups
  const collapsedColumns = useMemo(() => new Set(persistedCollapsedColumns), [persistedCollapsedColumns]);

  // Redistribute space among non-collapsed panels
  const redistributeLayout = useCallback((newCollapsedSet: Set<string>) => {
    if (!groupRef.current) return;

    const collapsedSize = 2; // Match the collapsedSize prop
    const columnCount = TASK_STATUS_COLUMNS.length;
    const collapsedCount = newCollapsedSet.size;
    const expandedCount = columnCount - collapsedCount;

    if (expandedCount === 0) return; // All collapsed, nothing to redistribute

    // Calculate: collapsed panels get collapsedSize%, expanded panels share the rest equally
    const totalCollapsedSpace = collapsedCount * collapsedSize;
    const remainingSpace = 100 - totalCollapsedSpace;
    const expandedPanelSize = remainingSpace / expandedCount;

    const newLayout: Record<string, number> = {};
    TASK_STATUS_COLUMNS.forEach((status) => {
      const panelId = `col-${status}`;
      if (newCollapsedSet.has(status)) {
        newLayout[panelId] = collapsedSize;
      } else {
        newLayout[panelId] = expandedPanelSize;
      }
    });

    // Apply the new layout
    groupRef.current.setLayout(newLayout);
  }, []);

  // FIX-23: Toggle column collapse state with persistence
  const toggleColumnCollapse = useCallback((columnId: string) => {
    const panelRef = panelRefs.current[columnId];
    if (panelRef) {
      const isCurrentlyCollapsed = collapsedColumns.has(columnId);
      if (isCurrentlyCollapsed) {
        panelRef.expand();
      } else {
        panelRef.collapse();
      }
      // Update persisted store
      toggleColumnCollapseStore(columnId);
      // Compute new set for layout redistribution
      const next = isCurrentlyCollapsed
        ? new Set([...collapsedColumns].filter(id => id !== columnId))
        : new Set([...collapsedColumns, columnId]);
      setTimeout(() => redistributeLayout(next), 50);
    }
  }, [collapsedColumns, redistributeLayout, toggleColumnCollapseStore]);

  // FIX-23: Restore collapsed state on mount
  useEffect(() => {
    if (persistedCollapsedColumns.length > 0) {
      // Apply persisted collapsed state to panels
      persistedCollapsedColumns.forEach((columnId) => {
        const panelRef = panelRefs.current[columnId];
        if (panelRef) {
          panelRef.collapse();
        }
      });
      // Redistribute layout after a short delay
      setTimeout(() => redistributeLayout(collapsedColumns), 100);
    }
  // Only run on initial mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection state for bulk actions (Human Review column)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Bulk PR dialog state
  const [bulkPRDialogOpen, setBulkPRDialogOpen] = useState(false);

  // Worktree cleanup dialog state
  const [worktreeCleanupDialog, setWorktreeCleanupDialog] = useState<{
    open: boolean;
    taskId: string | null;
    taskTitle: string;
    worktreePath?: string;
    isProcessing: boolean;
    error?: string;
  }>({
    open: false,
    taskId: null,
    taskTitle: '',
    worktreePath: undefined,
    isProcessing: false,
    error: undefined
  });

  // FIX-29c: Bottom panel terminal state
  const [bottomPanelState, setBottomPanelState] = useState<{
    isOpen: boolean;
    taskId: string | null;
    taskTitle: string;
  }>({
    isOpen: false,
    taskId: null,
    taskTitle: ''
  });

  // FIX-29b: Callback to open bottom panel terminal
  const handleOpenBottomPanel = useCallback((taskId: string, taskTitle: string) => {
    setBottomPanelState({
      isOpen: true,
      taskId,
      taskTitle
    });
  }, []);

  const handleCloseBottomPanel = useCallback(() => {
    setBottomPanelState(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  const handleMinimizeBottomPanel = useCallback(() => {
    setBottomPanelState(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  // Filter tasks based on archive status
  const filteredTasks = useMemo(() => {
    if (showArchived) {
      return tasks; // Show all tasks including archived
    }
    return tasks.filter((t) => !t.metadata?.archivedAt);
  }, [tasks, showArchived]);

  // PROP-1: Kanban drag-and-drop is DISABLED
  // Tasks should only move between columns via explicit user actions:
  // - "Start Build" button (planning -> coding)
  // - Review approval/rejection
  // This prevents accidental status changes and enforces the user-controlled workflow.
  // To re-enable: restore the original sensor configuration below.
  const sensors = useSensors(
    // Disabled: PointerSensor, KeyboardSensor
    // useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Get task order from store for custom ordering
  const taskOrder = useTaskStore((state) => state.taskOrder);

  const tasksByStatus = useMemo(() => {
    // Note: done/pr_created tasks are not shown on Kanban - they live on Worktrees page
    const grouped: Record<typeof TASK_STATUS_COLUMNS[number], Task[]> = {
      planning: [],
      coding: [],
      ai_review: [],
      human_review: []
    };

    filteredTasks.forEach((task) => {
      // Skip done/pr_created tasks - they're shown on Worktrees page
      if (task.status === 'done' || task.status === 'pr_created') {
        return;
      }
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    });

    // Sort tasks within each column
    Object.keys(grouped).forEach((status) => {
      const statusKey = status as typeof TASK_STATUS_COLUMNS[number];
      const columnTasks = grouped[statusKey];
      const columnOrder = taskOrder?.[statusKey];

      if (columnOrder && columnOrder.length > 0) {
        // Custom order exists: sort by order index
        // 1. Create a set of current task IDs for fast lookup (filters stale IDs)
        const currentTaskIds = new Set(columnTasks.map(t => t.id));

        // 2. Create valid order by filtering out stale IDs
        const validOrder = columnOrder.filter(id => currentTaskIds.has(id));
        const validOrderSet = new Set(validOrder);

        // 3. Find new tasks not in order (prepend at top)
        const newTasks = columnTasks.filter(t => !validOrderSet.has(t.id));
        // Sort new tasks by createdAt (newest first)
        newTasks.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });

        // 4. Sort ordered tasks by their index in validOrder
        // Pre-compute index map for O(n) sorting instead of O(n²) with indexOf
        const indexMap = new Map(validOrder.map((id, idx) => [id, idx]));
        const orderedTasks = columnTasks
          .filter(t => validOrderSet.has(t.id))
          .sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));

        // 5. Prepend new tasks at top, then ordered tasks
        grouped[statusKey] = [...newTasks, ...orderedTasks];
      } else {
        // No custom order: fallback to createdAt sort (newest first)
        grouped[statusKey].sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });
      }
    });

    return grouped;
  }, [filteredTasks, taskOrder]);

  // Prune stale IDs when tasks move out of human_review column
  useEffect(() => {
    const validIds = new Set(tasksByStatus.human_review.map(t => t.id));
    setSelectedTaskIds(prev => {
      const filtered = new Set([...prev].filter(id => validIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [tasksByStatus.human_review]);

  // Selection callbacks for bulk actions (Human Review column)
  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const selectAllTasks = useCallback(() => {
    const humanReviewTasks = tasksByStatus.human_review;
    const allIds = new Set(humanReviewTasks.map(t => t.id));
    setSelectedTaskIds(allIds);
  }, [tasksByStatus.human_review]);

  const deselectAllTasks = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  // Get selected task objects for the BulkPRDialog
  const selectedTasks = useMemo(() => {
    return tasksByStatus.human_review.filter(task => selectedTaskIds.has(task.id));
  }, [tasksByStatus.human_review, selectedTaskIds]);

  // Handle opening the bulk PR dialog
  const handleOpenBulkPRDialog = useCallback(() => {
    if (selectedTaskIds.size > 0) {
      setBulkPRDialogOpen(true);
    }
  }, [selectedTaskIds.size]);

  // Handle bulk PR dialog completion - clear selection
  const handleBulkPRComplete = useCallback(() => {
    deselectAllTasks();
  }, [deselectAllTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;

    if (!over) {
      setOverColumnId(null);
      return;
    }

    const overId = over.id as string;

    // Check if over a column
    if (isValidDropColumn(overId)) {
      setOverColumnId(overId);
      return;
    }

    // Check if over a task - get its column
    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      setOverColumnId(overTask.status);
    }
  };

  /**
   * Handle status change with worktree cleanup dialog support
   * Consolidated handler that accepts an optional task object for the dialog title
   */
  const handleStatusChange = async (taskId: string, newStatus: TaskStatus, providedTask?: Task) => {
    const task = providedTask || tasks.find(t => t.id === taskId);
    const result = await persistTaskStatus(taskId, newStatus);

    if (!result.success) {
      if (result.worktreeExists) {
        // Show the worktree cleanup dialog
        setWorktreeCleanupDialog({
          open: true,
          taskId: taskId,
          taskTitle: task?.title || t('tasks:untitled'),
          worktreePath: result.worktreePath,
          isProcessing: false,
          error: undefined
        });
      } else {
        // Show error toast for other failures
        toast({
          title: t('common:errors.operationFailed'),
          description: result.error || t('common:errors.unknownError'),
          variant: 'destructive'
        });
      }
    }
  };

  /**
   * Handle worktree cleanup confirmation
   */
  const handleWorktreeCleanupConfirm = async () => {
    if (!worktreeCleanupDialog.taskId) return;

    setWorktreeCleanupDialog(prev => ({ ...prev, isProcessing: true, error: undefined }));

    const result = await forceCompleteTask(worktreeCleanupDialog.taskId);

    if (result.success) {
      setWorktreeCleanupDialog({
        open: false,
        taskId: null,
        taskTitle: '',
        worktreePath: undefined,
        isProcessing: false,
        error: undefined
      });
    } else {
      // Keep dialog open with error state for retry - show actual error if available
      setWorktreeCleanupDialog(prev => ({
        ...prev,
        isProcessing: false,
        error: result.error || t('dialogs:worktreeCleanup.errorDescription')
      }));
    }
  };

  // Get task order actions from store
  const reorderTasksInColumn = useTaskStore((state) => state.reorderTasksInColumn);
  const moveTaskToColumnTop = useTaskStore((state) => state.moveTaskToColumnTop);
  const saveTaskOrderToStorage = useTaskStore((state) => state.saveTaskOrder);
  const loadTaskOrder = useTaskStore((state) => state.loadTaskOrder);
  const setTaskOrder = useTaskStore((state) => state.setTaskOrder);

  // Get projectId from tasks (all tasks in KanbanBoard share the same project)
  const projectId = useMemo(() => tasks[0]?.projectId ?? null, [tasks]);

  const saveTaskOrder = useCallback((projectIdToSave: string) => {
    const success = saveTaskOrderToStorage(projectIdToSave);
    if (!success) {
      toast({
        title: t('kanban.orderSaveFailedTitle'),
        description: t('kanban.orderSaveFailedDescription'),
        variant: 'destructive'
      });
    }
    return success;
  }, [saveTaskOrderToStorage, toast, t]);

  // Load task order on mount and when project changes
  useEffect(() => {
    if (projectId) {
      loadTaskOrder(projectId);
    }
  }, [projectId, loadTaskOrder]);

  // Clean up stale task IDs from order when tasks change (e.g., after deletion)
  // This ensures the persisted order doesn't contain IDs for deleted tasks
  useEffect(() => {
    if (!projectId || !taskOrder) return;

    // Build a set of current task IDs for fast lookup
    const currentTaskIds = new Set(tasks.map(t => t.id));

    // Check each column for stale IDs
    let hasStaleIds = false;
    const cleanedOrder: typeof taskOrder = {
      planning: [],
      coding: [],
      ai_review: [],
      human_review: [],
      pr_created: [],
      done: [] // Keep for TaskOrderState compatibility, but not used in Kanban
    };

    for (const status of Object.keys(taskOrder) as Array<keyof typeof taskOrder>) {
      const columnOrder = taskOrder[status] || [];
      const cleanedColumnOrder = columnOrder.filter(id => currentTaskIds.has(id));

      cleanedOrder[status] = cleanedColumnOrder;

      // Check if any IDs were removed
      if (cleanedColumnOrder.length !== columnOrder.length) {
        hasStaleIds = true;
      }
    }

    // If stale IDs were found, update the order and persist
    if (hasStaleIds) {
      setTaskOrder(cleanedOrder);
      saveTaskOrder(projectId);
    }
  }, [tasks, taskOrder, projectId, setTaskOrder, saveTaskOrder]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setOverColumnId(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    if (isValidDropColumn(overId)) {
      const newStatus = overId;
      const task = tasks.find((t) => t.id === activeTaskId);

      if (task && task.status !== newStatus) {
        // Move task to top of target column's order array
        moveTaskToColumnTop(activeTaskId, newStatus, task.status);

        // Persist task order
        if (projectId) {
          saveTaskOrder(projectId);
        }

        // Persist status change to file and update local state
        handleStatusChange(activeTaskId, newStatus, task).catch((err) =>
          console.error('[KanbanBoard] Status change failed:', err)
        );
      }
      return;
    }

    // Check if dropped on another task
    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      const task = tasks.find((t) => t.id === activeTaskId);
      if (!task) return;

      // Get visual columns (null for done/pr_created which aren't on Kanban)
      const taskVisualColumn = getVisualColumn(task.status);
      const overTaskVisualColumn = getVisualColumn(overTask.status);

      // Skip if either task is done/pr_created (shouldn't happen, but guard)
      if (!taskVisualColumn || !overTaskVisualColumn) return;

      // Same visual column: reorder within column
      if (taskVisualColumn === overTaskVisualColumn) {
        // Ensure both tasks are in the order array before reordering
        // This handles tasks that existed before ordering was enabled
        const currentColumnOrder = taskOrder?.[taskVisualColumn] ?? [];
        const activeInOrder = currentColumnOrder.includes(activeTaskId);
        const overInOrder = currentColumnOrder.includes(overId);

        if (!activeInOrder || !overInOrder) {
          // Sync the current visual order to the stored order
          // This ensures existing tasks can be reordered
          const visualOrder = tasksByStatus[taskVisualColumn].map(t => t.id);
          setTaskOrder({
            ...taskOrder,
            [taskVisualColumn]: visualOrder
          } as TaskOrderState);
        }

        // Reorder tasks within the same column using the visual column key
        reorderTasksInColumn(taskVisualColumn, activeTaskId, overId);

        if (projectId) {
          saveTaskOrder(projectId);
        }
        return;
      }

      // Different visual column: move to that task's column (status change)
      // Use the visual column key for ordering to ensure consistency
      moveTaskToColumnTop(activeTaskId, overTaskVisualColumn, taskVisualColumn);

      // Persist task order
      if (projectId) {
        saveTaskOrder(projectId);
      }

      handleStatusChange(activeTaskId, overTask.status, task).catch((err) =>
        console.error('[KanbanBoard] Status change failed:', err)
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Kanban header with refresh button */}
      {onRefresh && !hideRefreshButton && (
        <div className="flex items-center justify-end px-6 pt-4 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? t('common:buttons.refreshing') : t('tasks:refreshTasks')}
          </Button>
        </div>
      )}
      {/* Kanban columns with resizable panels */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <Group orientation="horizontal" className="flex-1 p-6" groupRef={groupRef}>
          {TASK_STATUS_COLUMNS.map((status, index) => (
            <React.Fragment key={status}>
              <Panel
                panelRef={(ref) => { panelRefs.current[status] = ref; }}
                id={`col-${status}`}
                defaultSize={100 / TASK_STATUS_COLUMNS.length}
                minSize={3}
                collapsible
                collapsedSize={2}
                className={cn(
                  collapsedColumns.has(status) ? "min-w-8" : "min-w-48"
                )}
              >
                <div className={cn(
                  "h-full",
                  index > 0 && "ml-1",
                  index < TASK_STATUS_COLUMNS.length - 1 && "mr-1"
                )}>
                  <DroppableColumn
                    status={status}
                    tasks={tasksByStatus[status]}
                    onTaskClick={onTaskClick}
                    onStatusChange={handleStatusChange}
                    isOver={overColumnId === status}
                    onAddClick={status === 'planning' ? onNewTaskClick : undefined}
                    selectedTaskIds={status === 'human_review' ? selectedTaskIds : undefined}
                    onSelectAll={status === 'human_review' ? selectAllTasks : undefined}
                    onDeselectAll={status === 'human_review' ? deselectAllTasks : undefined}
                    onToggleSelect={status === 'human_review' ? toggleTaskSelection : undefined}
                    isCollapsed={collapsedColumns.has(status)}
                    onToggleCollapse={() => toggleColumnCollapse(status)}
                    onOpenBottomPanel={handleOpenBottomPanel}
                  />
                </div>
              </Panel>
              {index < TASK_STATUS_COLUMNS.length - 1 && (
                <Separator className="w-2 flex items-center justify-center group cursor-col-resize">
                  <GripVertical className="h-6 w-4 text-muted-foreground/30 group-hover:text-primary/50 transition-colors" />
                </Separator>
              )}
            </React.Fragment>
          ))}
        </Group>

        {/* Drag overlay - enhanced visual feedback */}
        <DragOverlay>
          {activeTask ? (
            <div className="drag-overlay-card">
              <TaskCard task={activeTask} onClick={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-card shadow-lg backdrop-blur-sm">
            <span className="text-sm font-medium text-foreground">
              {t('kanban.selectedCountOther', { count: selectedTaskIds.size })}
            </span>
            <div className="w-px h-5 bg-border" />
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleOpenBulkPRDialog}
            >
              <GitPullRequest className="h-4 w-4" />
              {t('kanban.createPRs')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={deselectAllTasks}
            >
              <X className="h-4 w-4" />
              {t('kanban.clearSelection')}
            </Button>
          </div>
        </div>
      )}

      {/* Worktree cleanup confirmation dialog */}
      <WorktreeCleanupDialog
        open={worktreeCleanupDialog.open}
        taskTitle={worktreeCleanupDialog.taskTitle}
        worktreePath={worktreeCleanupDialog.worktreePath}
        isProcessing={worktreeCleanupDialog.isProcessing}
        error={worktreeCleanupDialog.error}
        onOpenChange={(open) => {
          if (!open && !worktreeCleanupDialog.isProcessing) {
            setWorktreeCleanupDialog(prev => ({ ...prev, open: false, error: undefined }));
          }
        }}
        onConfirm={handleWorktreeCleanupConfirm}
      />

      {/* Bulk PR creation dialog */}
      <BulkPRDialog
        open={bulkPRDialogOpen}
        tasks={selectedTasks}
        onOpenChange={setBulkPRDialogOpen}
        onComplete={handleBulkPRComplete}
      />

      {/* FIX-29c: Bottom panel terminal */}
      <BottomPanelTerminal
        taskId={bottomPanelState.taskId}
        taskTitle={bottomPanelState.taskTitle}
        isOpen={bottomPanelState.isOpen}
        onClose={handleCloseBottomPanel}
        onMinimize={handleMinimizeBottomPanel}
      />
    </div>
  );
}
