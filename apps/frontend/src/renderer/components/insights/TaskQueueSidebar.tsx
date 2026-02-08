import { useEffect, useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeft, ListTodo, Trash2, Lightbulb, Settings, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { useInsightsTaskQueueStore, type InsightsQueuedTask } from '../../stores/insights-task-queue-store';
import { TaskQueueCard } from './TaskQueueCard';
import { TaskDetailModal } from './TaskDetailModal';
import { useNavigation } from '../../contexts/NavigationContext';
import { createTask, startTask, useTaskStore } from '../../stores/task-store';
import { useInsightsStore } from '../../stores/insights-store';
import { useProjectStore } from '../../stores/project-store';
import type { Task, TaskMetadata } from '../../../shared/types';

/**
 * Convert a main Task to InsightsQueuedTask format for rendering in the queue
 */
function taskToQueuedTask(task: Task): InsightsQueuedTask {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status === 'done' ? 'complete' : 'running',
    createdAt: task.createdAt,
    startedAt: task.createdAt, // Approximate - tasks are started when created
    completedAt: task.status === 'done' ? task.updatedAt : undefined,
    taskId: task.id, // Self-reference since this IS the main task
    metadata: task.metadata,
  };
}

interface TaskQueueSidebarProps {
  width?: number; // Width in pixels
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  accentColor?: string;
}

function CollapsibleSection({
  title,
  icon,
  count,
  collapsed,
  onToggle,
  children,
  accentColor = 'text-muted-foreground'
}: CollapsibleSectionProps) {
  if (count === 0) return null;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Section Header */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className={cn("flex-shrink-0", accentColor)}>{icon}</div>
          <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{count}</span>
          {collapsed ? (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Section Content */}
      {!collapsed && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

export function TaskQueueSidebar({ width = 280 }: TaskQueueSidebarProps = {}) {
  const { setActiveView } = useNavigation();

  // Queue store (Jerry suggestions, not yet started)
  const queueTasks = useInsightsTaskQueueStore((state) => state.tasks);
  const isSidebarCollapsed = useInsightsTaskQueueStore((state) => state.isCollapsed);
  const toggleSidebarCollapsed = useInsightsTaskQueueStore((state) => state.toggleCollapsed);
  const removeTask = useInsightsTaskQueueStore((state) => state.removeTask);
  const updateTaskStatus = useInsightsTaskQueueStore((state) => state.updateTaskStatus);
  const clearCompletedTasks = useInsightsTaskQueueStore((state) => state.clearCompletedTasks);

  // Main task store (all created tasks)
  const mainTasks = useTaskStore((state) => state.tasks);
  const projectId = useProjectStore((state) => state.activeProjectId);

  // Section collapse states
  const [suggestedCollapsed, setSuggestedCollapsed] = useState(false);
  const [inProgressCollapsed, setInProgressCollapsed] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(true);

  // Task detail modal state
  const [detailModalTask, setDetailModalTask] = useState<Task | null>(null);

  // Filter tasks into 3 sections
  const suggestedTasks = useMemo(() => {
    // Jerry-suggested tasks from the queue (not yet started)
    // Filter to current project only
    return queueTasks.filter(t =>
      t.status === 'pending' && t.projectId === projectId
    );
  }, [queueTasks, projectId]);

  const inProgressTasks = useMemo(() => {
    // All active tasks from main store (any source)
    // Filter to current project only
    return mainTasks.filter(t => {
      // Only show tasks for current project
      if (t.projectId !== projectId) return false;

      // Show tasks that are actively being worked on
      return ['planning', 'coding', 'qa', 'reviewing', 'pr_pending'].includes(t.status);
    });
  }, [mainTasks, projectId]);

  const completedTasks = useMemo(() => {
    // Recently completed tasks (within 24h, max 5)
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    return mainTasks
      .filter(t => {
        if (t.projectId !== projectId) return false;
        if (t.status !== 'done') return false;

        // Check if completed within last 24 hours
        const completedAt = t.updatedAt?.getTime() || 0;
        return (now - completedAt) < DAY_MS;
      })
      .slice(0, 5); // Limit to 5 most recent
  }, [mainTasks, projectId]);

  // Build lookup map for linking queue tasks to real tasks
  const mainTaskMap = useMemo(() => {
    const map = new Map<string, Task>();
    mainTasks.forEach(t => map.set(t.id, t));
    return map;
  }, [mainTasks]);

  // Load from localStorage on mount
  useEffect(() => {
    useInsightsTaskQueueStore.getState().loadFromStorage();
  }, []);

  // Reactive sync: clean up orphaned and completed queue tasks (for current project only)
  useEffect(() => {
    const mainTaskIds = new Set(mainTasks.map(t => t.id));
    const doneTaskIds = new Set(
      mainTasks.filter(t => t.status === 'done').map(t => t.id)
    );

    const queueStore = useInsightsTaskQueueStore.getState();
    queueStore.tasks.forEach(qTask => {
      // Only clean up tasks for this project
      if (qTask.projectId !== projectId) return;
      if (!qTask.taskId) return;

      // Task completed — remove from queue
      if (doneTaskIds.has(qTask.taskId) && qTask.status !== 'complete') {
        queueStore.removeTask(qTask.id);
        return;
      }

      // Task no longer exists — remove orphan
      if (!mainTaskIds.has(qTask.taskId) && (qTask.status === 'running' || qTask.status === 'pending')) {
        console.log('[TaskQueueSidebar] Removing orphaned queue task:', qTask.id, qTask.title);
        queueStore.removeTask(qTask.id);
      }
    });
  }, [mainTasks, projectId]);

  // Total counts for stats bar
  const totalCounts = useMemo(() => {
    return {
      suggested: suggestedTasks.length,
      inProgress: inProgressTasks.length,
      completed: completedTasks.length,
      total: suggestedTasks.length + inProgressTasks.length + completedTasks.length,
    };
  }, [suggestedTasks, inProgressTasks, completedTasks]);

  const handleStartTask = async (queuedTaskId: string) => {
    const queuedTask = queueTasks.find((t) => t.id === queuedTaskId);
    if (!queuedTask) return;

    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) {
      console.error('[TaskQueueSidebar] No active project');
      updateTaskStatus(queuedTaskId, 'failed');
      return;
    }

    try {
      // Mark as running
      updateTaskStatus(queuedTaskId, 'running');

      // Create actual task via task-store (uses proper electronAPI bridge)
      const task = await createTask(
        projectId,
        queuedTask.title,
        queuedTask.description || '',
        queuedTask.metadata as TaskMetadata | undefined,
      );

      if (task) {
        // Update queue with actual task ID
        updateTaskStatus(queuedTaskId, 'running', task.id);

        // Start the task (don't auto-navigate - user can click card to go to kanban)
        startTask(task.id);
      } else {
        // Failed to create task
        updateTaskStatus(queuedTaskId, 'failed');
      }
    } catch (error) {
      console.error('[TaskQueueSidebar] Failed to start task:', error);
      updateTaskStatus(queuedTaskId, 'failed');
    }
  };

  const handleViewTask = (taskId: string) => {
    // Open task detail modal
    const task = mainTaskMap.get(taskId);
    if (task) {
      setDetailModalTask(task);
    }
  };

  const handleDeleteTask = (queuedTaskId: string) => {
    const queuedTask = queueTasks.find((t) => t.id === queuedTaskId);
    removeTask(queuedTaskId);

    // Mark as dismissed to prevent auto-queueing again
    if (queuedTask) {
      const insightsStore = useInsightsStore.getState();
      const session = insightsStore.session;
      if (session) {
        const message = session.messages.find(
          (m) => m.suggestedTask && m.suggestedTask.title === queuedTask.title && m.taskCreatedId
        );
        if (message) {
          // Mark as dismissed instead of clearing - prevents re-queuing
          insightsStore.markTaskCreated(message.id, 'dismissed');
        }
      }
    }
  };

  const handleClearCompleted = () => {
    clearCompletedTasks();
  };

  if (isSidebarCollapsed) {
    return (
      <div className="w-12 border-l border-border bg-background flex flex-col">
        {/* Header - Expand button */}
        <div className="p-2 border-b border-border flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleSidebarCollapsed}
            title="Expand task queue"
          >
            <PanelLeft className="w-4 h-4" />
          </Button>
        </div>

        {/* Task count indicator */}
        {totalCounts.total > 0 && (
          <div className="p-2 flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <ListTodo className="w-4 h-4" />
            <span className="font-mono">{totalCounts.total}</span>
          </div>
        )}

        {/* Collapsed task status dots - show suggested + in progress only */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {suggestedTasks.map((task) => (
              <TaskQueueCard
                key={task.id}
                task={task}
                linkedTask={task.taskId ? mainTaskMap.get(task.taskId) : undefined}
                onStart={handleStartTask}
                onDelete={handleDeleteTask}
                onView={handleViewTask}
                isCollapsed={true}
              />
            ))}
            {inProgressTasks.map((task) => (
              <TaskQueueCard
                key={task.id}
                task={taskToQueuedTask(task)}
                linkedTask={task}
                onStart={handleStartTask}
                onDelete={handleDeleteTask}
                onView={handleViewTask}
                isCollapsed={true}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="border-l border-border bg-background flex flex-col overflow-hidden" style={{ width: `${width}px`, minWidth: `${Math.min(width, 220)}px` }}>
      {/* Header */}
      <div className="h-12 flex items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ListTodo className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <h3 className="font-semibold text-sm truncate">Task Queue</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={toggleSidebarCollapsed}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats — only show when there are actual tasks */}
      {totalCounts.total > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {totalCounts.suggested > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                {totalCounts.suggested} suggested
              </span>
            )}
            {totalCounts.inProgress > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                {totalCounts.inProgress} active
              </span>
            )}
            {totalCounts.completed > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                {totalCounts.completed} done
              </span>
            )}
          </div>
        </div>
      )}

      {/* Task sections */}
      <ScrollArea className="flex-1">
        {totalCounts.total === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No tasks in queue</p>
            <p className="text-xs mt-1">Tasks suggested by Jerry will appear here</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Section 1: Suggested by Jerry */}
            <CollapsibleSection
              title="Suggested by Jerry"
              icon={<Lightbulb className="w-3.5 h-3.5" />}
              count={totalCounts.suggested}
              collapsed={suggestedCollapsed}
              onToggle={() => setSuggestedCollapsed(!suggestedCollapsed)}
              accentColor="text-purple-500"
            >
              {suggestedTasks.map((task) => (
                <TaskQueueCard
                  key={task.id}
                  task={task}
                  linkedTask={task.taskId ? mainTaskMap.get(task.taskId) : undefined}
                  onStart={handleStartTask}
                  onDelete={handleDeleteTask}
                  onView={handleViewTask}
                />
              ))}
            </CollapsibleSection>

            {/* Section 2: In Progress */}
            <CollapsibleSection
              title="In Progress"
              icon={<Settings className="w-3.5 h-3.5" />}
              count={totalCounts.inProgress}
              collapsed={inProgressCollapsed}
              onToggle={() => setInProgressCollapsed(!inProgressCollapsed)}
              accentColor="text-green-500"
            >
              {inProgressTasks.map((task) => (
                <TaskQueueCard
                  key={task.id}
                  task={taskToQueuedTask(task)}
                  linkedTask={task}
                  onStart={handleStartTask}
                  onDelete={handleDeleteTask}
                  onView={handleViewTask}
                />
              ))}
            </CollapsibleSection>

            {/* Section 3: Recently Completed */}
            <CollapsibleSection
              title="Recently Completed"
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              count={totalCounts.completed}
              collapsed={completedCollapsed}
              onToggle={() => setCompletedCollapsed(!completedCollapsed)}
              accentColor="text-emerald-500"
            >
              {completedTasks.map((task) => (
                <TaskQueueCard
                  key={task.id}
                  task={taskToQueuedTask(task)}
                  linkedTask={task}
                  onStart={handleStartTask}
                  onDelete={handleDeleteTask}
                  onView={handleViewTask}
                />
              ))}
            </CollapsibleSection>
          </div>
        )}
      </ScrollArea>

      {/* Footer - Clear completed button */}
      {totalCounts.completed > 0 && (
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleClearCompleted}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear {totalCounts.completed} completed
          </Button>
        </div>
      )}

      {/* Task Detail Modal */}
      <TaskDetailModal
        task={detailModalTask}
        open={!!detailModalTask}
        onClose={() => setDetailModalTask(null)}
      />
    </div>
  );
}
