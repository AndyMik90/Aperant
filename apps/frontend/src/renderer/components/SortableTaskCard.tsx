import { memo, useCallback } from 'react';
import { useSortable, defaultAnimateLayoutChanges, type AnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from './TaskCard';
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
    prevProps.onToggleSelect === nextProps.onToggleSelect
  );
}

// Skip layout animation when the item is being actively dragged to prevent stutter
const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args;
  if (isSorting || wasDragging) {
    return defaultAnimateLayoutChanges(args);
  }
  return true;
};

export const SortableTaskCard = memo(function SortableTaskCard({ task, onClick, onStatusChange, isSelectable, isSelected, onToggleSelect }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id: task.id, animateLayoutChanges });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  // Memoize onClick to prevent unnecessary TaskCard re-renders
  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'touch-none',
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
      />
    </div>
  );
}, sortableTaskCardPropsAreEqual);
