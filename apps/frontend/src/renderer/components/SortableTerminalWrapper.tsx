import { useRef, forwardRef, useImperativeHandle } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../shared/types';
import { Terminal, type TerminalHandle } from './Terminal';
import { cn } from '../lib/utils';

/**
 * Handle interface exposed by SortableTerminalWrapper for external control.
 * Allows parent components to trigger terminal operations like fit.
 */
export interface SortableTerminalWrapperHandle {
  /** Refit the terminal to its container size */
  fit: () => void;
}

interface SortableTerminalWrapperProps {
  id: string;
  cwd?: string;
  projectPath?: string;
  isActive: boolean;
  onClose: () => void;
  onActivate: () => void;
  tasks: Task[];
  onNewTaskClick?: () => void;
  terminalCount: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const SortableTerminalWrapper = forwardRef<SortableTerminalWrapperHandle, SortableTerminalWrapperProps>(
  function SortableTerminalWrapper({
    id,
    cwd,
    projectPath,
    isActive,
    onClose,
    onActivate,
    tasks,
    onNewTaskClick,
    terminalCount,
    isExpanded,
    onToggleExpand,
  }, ref) {
    const terminalRef = useRef<TerminalHandle>(null);

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id,
      data: {
        type: 'terminal-panel',
        terminalId: id,
      },
    });

    // Expose fit method to parent components via ref
    // This allows external triggering of terminal resize (e.g., after drag-drop reorder)
    useImperativeHandle(ref, () => ({
      fit: () => terminalRef.current?.fit(),
    }), []);

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 50 : undefined,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'h-full',
          isDragging && 'opacity-50'
        )}
        {...attributes}
      >
        <Terminal
          ref={terminalRef}
          id={id}
          cwd={cwd}
          projectPath={projectPath}
          isActive={isActive}
          onClose={onClose}
          onActivate={onActivate}
          tasks={tasks}
          onNewTaskClick={onNewTaskClick}
          terminalCount={terminalCount}
          dragHandleListeners={listeners}
          isDragging={isDragging}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      </div>
    );
  }
);
