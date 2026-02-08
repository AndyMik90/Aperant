import { memo, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from './TaskCard';
import { TaskCardContextMenu } from './TaskCardContextMenu';
import { cn } from '../lib/utils';
import type { Task, TaskStatus } from '../../shared/types';

interface SortableTaskCardProps {
  task: Task;
  onClick: () => void;
  onStatusChange?: (newStatus: TaskStatus) => unknown;
  // Optional selection props for multi-selection in Human Review column
  isSelectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  // FIX-29b: Bottom panel terminal callback
  onOpenBottomPanel?: (taskId: string, taskTitle: string) => void;
  // Context menu callbacks
  onOpenDetail?: () => void;
}

// Custom comparator - only re-render when task or onClick actually changed
function sortableTaskCardPropsAreEqual(
  prevProps: SortableTaskCardProps,
  nextProps: SortableTaskCardProps
): boolean {
  // TaskCard has its own memo, so we just need to check reference equality
  // for the task object and onClick handler
  return (
    prevProps.task === nextProps.task &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onStatusChange === nextProps.onStatusChange &&
    prevProps.isSelectable === nextProps.isSelectable &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelect === nextProps.onToggleSelect &&
    prevProps.onOpenBottomPanel === nextProps.onOpenBottomPanel &&
    prevProps.onOpenDetail === nextProps.onOpenDetail
  );
}

export const SortableTaskCard = memo(function SortableTaskCard({ task, onClick, onStatusChange, isSelectable, isSelected, onToggleSelect, onOpenBottomPanel, onOpenDetail }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  // Memoize onClick to prevent unnecessary TaskCard re-renders
  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);

  // Memoize detail view handler
  const handleOpenDetail = useCallback(() => {
    onOpenDetail?.();
  }, [onOpenDetail]);

  // Memoize terminal view handler
  const handleViewTerminal = useCallback(() => {
    if (onOpenBottomPanel) {
      onOpenBottomPanel(task.id, task.title);
    }
  }, [onOpenBottomPanel, task.id, task.title]);

  return (
    <TaskCardContextMenu
      taskId={task.id}
      taskTitle={task.title}
      taskStatus={task.status}
      onViewTerminal={handleViewTerminal}
      onOpenDetail={handleOpenDetail}
    >
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'touch-none transition-all duration-200 w-full max-w-full min-w-0 overflow-hidden',
          isDragging && 'dragging-placeholder opacity-40 scale-[0.98]',
          isOver && !isDragging && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-background rounded-xl'
        )}
        {...attributes}
        {...listeners}
      >
        <TaskCard
          task={task}
          onClick={handleClick}
          onStatusChange={onStatusChange}
          isSelectable={isSelectable}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          onOpenBottomPanel={onOpenBottomPanel}
        />
      </div>
    </TaskCardContextMenu>
  );
}, sortableTaskCardPropsAreEqual);
