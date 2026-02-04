import { useCallback, useEffect, useState, useRef } from 'react';
import type { Task } from '../../shared/types';

interface UseKeyboardNavigationOptions {
  tasks: Task[];
  onTaskSelect?: (task: Task) => void;
  onTaskOpen?: (task: Task) => void;
  onTaskStart?: (task: Task) => void;
  onTaskReview?: (task: Task) => void;
  onShowHelp?: () => void;
  enabled?: boolean;
}

/**
 * UX-5: Keyboard navigation hook for Kanban board.
 *
 * Shortcuts:
 * - j / ArrowDown: Next task
 * - k / ArrowUp: Previous task
 * - Enter: Open selected task
 * - s: Start/Stop task
 * - r: Review spec
 * - ?: Show shortcuts help
 * - Escape: Clear selection / close modal
 */
export function useKeyboardNavigation({
  tasks,
  onTaskSelect,
  onTaskOpen,
  onTaskStart,
  onTaskReview,
  onShowHelp,
  enabled = true,
}: UseKeyboardNavigationOptions) {
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get currently selected task
  const selectedTask = selectedIndex >= 0 && selectedIndex < tasks.length
    ? tasks[selectedIndex]
    : null;

  // Move selection up
  const moveUp = useCallback(() => {
    if (tasks.length === 0) return;
    setSelectedIndex(prev => {
      const newIndex = prev <= 0 ? tasks.length - 1 : prev - 1;
      return newIndex;
    });
  }, [tasks.length]);

  // Move selection down
  const moveDown = useCallback(() => {
    if (tasks.length === 0) return;
    setSelectedIndex(prev => {
      const newIndex = prev >= tasks.length - 1 ? 0 : prev + 1;
      return newIndex;
    });
  }, [tasks.length]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  // Select specific task by ID
  const selectTask = useCallback((taskId: string) => {
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, [tasks]);

  // Handle keyboard events
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          moveDown();
          break;

        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          moveUp();
          break;

        case 'Enter':
          if (selectedTask) {
            event.preventDefault();
            onTaskOpen?.(selectedTask);
          }
          break;

        case 's':
          if (selectedTask) {
            event.preventDefault();
            onTaskStart?.(selectedTask);
          }
          break;

        case 'r':
          if (selectedTask) {
            event.preventDefault();
            onTaskReview?.(selectedTask);
          }
          break;

        case '?':
          event.preventDefault();
          onShowHelp?.();
          break;

        case 'Escape':
          if (selectedIndex !== -1) {
            event.preventDefault();
            clearSelection();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    moveDown,
    moveUp,
    selectedTask,
    selectedIndex,
    clearSelection,
    onTaskOpen,
    onTaskStart,
    onTaskReview,
    onShowHelp,
  ]);

  // Notify parent of selection changes
  useEffect(() => {
    if (selectedTask) {
      onTaskSelect?.(selectedTask);
    }
  }, [selectedTask, onTaskSelect]);

  // Reset selection when tasks change significantly
  useEffect(() => {
    if (selectedIndex >= tasks.length) {
      setSelectedIndex(tasks.length - 1);
    }
  }, [tasks.length, selectedIndex]);

  return {
    selectedIndex,
    selectedTask,
    selectTask,
    clearSelection,
    containerRef,
    moveUp,
    moveDown,
  };
}

/**
 * Keyboard shortcut definitions for help display
 */
export const KEYBOARD_SHORTCUTS = [
  { key: 'j / ↓', action: 'Next task', context: 'Kanban board' },
  { key: 'k / ↑', action: 'Previous task', context: 'Kanban board' },
  { key: 'Enter', action: 'Open selected task', context: 'Kanban board' },
  { key: 'Escape', action: 'Close modal / Clear selection', context: 'Anywhere' },
  { key: 's', action: 'Start/Stop task', context: 'Task selected' },
  { key: 'r', action: 'Review spec', context: 'Task selected' },
  { key: '?', action: 'Show shortcuts help', context: 'Anywhere' },
  { key: 'Ctrl+K', action: 'Quick task', context: 'Anywhere' },
  { key: 'Ctrl+P', action: 'Global search', context: 'Anywhere' },
] as const;
