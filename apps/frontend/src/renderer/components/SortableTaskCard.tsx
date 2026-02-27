import { memo, useCallback, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from './TaskCard';
import { cn } from '../lib/utils';
import type { Task, TaskStatus } from '../../shared/types';

interface SortableTaskCardProps {
  task: Task;
  onTaskClick: (task: Task) => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => unknown;
  isSelectable?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
}

// Custom comparator - only re-render when task data or stable handler refs change,
// plus fine-grained check for this specific task's selection state
function sortableTaskCardPropsAreEqual(
  prevProps: SortableTaskCardProps,
  nextProps: SortableTaskCardProps
): boolean {
  if (prevProps.task !== nextProps.task) return false;
  if (prevProps.onTaskClick !== nextProps.onTaskClick) return false;
  if (prevProps.onStatusChange !== nextProps.onStatusChange) return false;
  if (prevProps.isSelectable !== nextProps.isSelectable) return false;
  if (prevProps.onToggleSelect !== nextProps.onToggleSelect) return false;
  // Only check this task's selection state, not the whole Set reference
  if (prevProps.isSelectable) {
    const prevSel = prevProps.selectedTaskIds?.has(prevProps.task.id) ?? false;
    const nextSel = nextProps.selectedTaskIds?.has(nextProps.task.id) ?? false;
    if (prevSel !== nextSel) return false;
  }
  return true;
}

export const SortableTaskCard = memo(function SortableTaskCard({ task, onTaskClick, onStatusChange, isSelectable, selectedTaskIds, onToggleSelect }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({
    id: task.id,
    disabled: task.status === 'in_progress' // Prevent dragging tasks that are currently running or stuck
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  // Create per-card handlers from stable parent refs — these only change
  // when onTaskClick/onStatusChange/onToggleSelect refs or task identity changes
  const handleClick = useCallback(() => onTaskClick(task), [onTaskClick, task]);

  const handleStatusChange = useMemo(
    () => onStatusChange ? (newStatus: TaskStatus) => onStatusChange(task.id, newStatus) : undefined,
    [onStatusChange, task.id]
  );

  const handleToggleSelect = useCallback(
    () => onToggleSelect?.(task.id),
    [onToggleSelect, task.id]
  );

  const isSelected = isSelectable ? selectedTaskIds?.has(task.id) : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'touch-none transition-all duration-200',
        isDragging && 'dragging-placeholder opacity-40 scale-[0.98]',
        isOver && !isDragging && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-background rounded-xl'
      )}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        onClick={handleClick}
        onStatusChange={handleStatusChange}
        isSelectable={isSelectable}
        isSelected={isSelected}
        onToggleSelect={handleToggleSelect}
      />
    </div>
  );
}, sortableTaskCardPropsAreEqual);
