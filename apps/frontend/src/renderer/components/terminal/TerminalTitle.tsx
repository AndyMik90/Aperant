import { useState, useRef, useCallback } from 'react';
import type { Task } from '../../../shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { getTitleMaxWidthClass } from './types';
import { cn } from '../../lib/utils';

interface TerminalTitleProps {
  title: string;
  associatedTask?: Task;
  onTitleChange: (newTitle: string) => void;
  terminalCount?: number;
  /** Whether this is a task monitor (shows full title without truncation) */
  isTaskMonitor?: boolean;
}

export function TerminalTitle({ title, associatedTask, onTitleChange, terminalCount = 1, isTaskMonitor }: TerminalTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  // Task monitors show full title, regular terminals use max-width based on count
  const maxWidthClass = isTaskMonitor ? '' : getTitleMaxWidthClass(terminalCount);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = useCallback(() => {
    setEditedTitle(title);
    setIsEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [title]);

  const handleSave = useCallback(() => {
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    }
    setIsEditing(false);
  }, [editedTitle, title, onTitleChange]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedTitle('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editedTitle}
        onChange={(e) => setEditedTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        onClick={(e) => e.stopPropagation()}
        className={cn("text-xs font-medium text-foreground bg-transparent border border-primary/50 rounded px-1 py-0.5 outline-none focus:border-primary", maxWidthClass)}
        style={{ width: `${Math.max(editedTitle.length * 6 + 16, 60)}px` }}
      />
    );
  }

  if (associatedTask) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn("text-xs font-medium text-foreground truncate cursor-text hover:text-primary/80 transition-colors", maxWidthClass)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleStartEdit();
              }}
            >
              {title}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="text-sm">{associatedTask.description}</p>
            <p className="text-xs text-muted-foreground mt-1">Double-click to rename</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("text-xs font-medium text-foreground truncate cursor-text hover:text-primary/80 transition-colors", maxWidthClass)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartEdit();
            }}
          >
            {title}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Double-click to rename</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
