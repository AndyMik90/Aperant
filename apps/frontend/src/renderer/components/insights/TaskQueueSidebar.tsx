import { useEffect, useMemo } from 'react';
import { PanelLeftClose, PanelLeft, ListTodo, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { useInsightsTaskQueueStore } from '../../stores/insights-task-queue-store';
import { TaskQueueCard } from './TaskQueueCard';
import { useNavigation } from '../../contexts/NavigationContext';
import { createTask, startTask } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';
import type { TaskMetadata } from '../../../shared/types';

interface TaskQueueSidebarProps {
  width?: number; // Width in pixels
}

export function TaskQueueSidebar({ width = 280 }: TaskQueueSidebarProps = {}) {
  const { setActiveView } = useNavigation();
  const tasks = useInsightsTaskQueueStore((state) => state.tasks);
  const isCollapsed = useInsightsTaskQueueStore((state) => state.isCollapsed);
  const toggleCollapsed = useInsightsTaskQueueStore((state) => state.toggleCollapsed);
  const removeTask = useInsightsTaskQueueStore((state) => state.removeTask);
  const updateTaskStatus = useInsightsTaskQueueStore((state) => state.updateTaskStatus);
  const clearCompletedTasks = useInsightsTaskQueueStore((state) => state.clearCompletedTasks);

  // Load from localStorage on mount
  useEffect(() => {
    useInsightsTaskQueueStore.getState().loadFromStorage();
  }, []);

  // Count tasks by status
  const taskCounts = useMemo(() => {
    return {
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      complete: tasks.filter((t) => t.status === 'complete').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      total: tasks.length,
    };
  }, [tasks]);

  const handleStartTask = async (queuedTaskId: string) => {
    const queuedTask = tasks.find((t) => t.id === queuedTaskId);
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

        // Start the task
        startTask(task.id);

        // Navigate to kanban to see the task
        setActiveView('kanban');
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
    // Navigate to kanban where the task cards are visible
    setActiveView('kanban');
  };

  const handleDeleteTask = (queuedTaskId: string) => {
    removeTask(queuedTaskId);
  };

  const handleClearCompleted = () => {
    clearCompletedTasks();
  };

  if (isCollapsed) {
    return (
      <div className="w-12 border-l border-border bg-background flex flex-col">
        {/* Header - Expand button */}
        <div className="p-2 border-b border-border flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleCollapsed}
            title="Expand task queue"
          >
            <PanelLeft className="w-4 h-4" />
          </Button>
        </div>

        {/* Task count indicator */}
        {taskCounts.total > 0 && (
          <div className="p-2 flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <ListTodo className="w-4 h-4" />
            <span className="font-mono">{taskCounts.total}</span>
          </div>
        )}

        {/* Collapsed task status dots */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {tasks.map((task) => (
              <TaskQueueCard
                key={task.id}
                task={task}
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
    <div className="border-l border-border bg-background flex flex-col" style={{ width: `${width}px` }}>
      {/* Header */}
      <div className="h-12 flex items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Task Queue</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={toggleCollapsed}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex gap-2 text-xs text-muted-foreground">
          {taskCounts.pending > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              {taskCounts.pending} pending
            </span>
          )}
          {taskCounts.running > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              {taskCounts.running} running
            </span>
          )}
          {taskCounts.complete > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              {taskCounts.complete} done
            </span>
          )}
        </div>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1">
        {tasks.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No tasks in queue</p>
            <p className="text-xs mt-1">Tasks created in chat will appear here</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {tasks.map((task) => (
              <TaskQueueCard
                key={task.id}
                task={task}
                onStart={handleStartTask}
                onDelete={handleDeleteTask}
                onView={handleViewTask}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer - Clear completed button */}
      {taskCounts.complete > 0 && (
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleClearCompleted}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear {taskCounts.complete} completed
          </Button>
        </div>
      )}
    </div>
  );
}
