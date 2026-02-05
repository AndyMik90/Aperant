/**
 * FIX-29c: VS Code-style bottom panel terminal
 *
 * A resizable bottom panel that displays task terminal output with:
 * - Drag handle for resizing
 * - Minimize/maximize/close controls
 * - Chat input for sending messages to the agent
 * - Full terminal output with scrolling
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { TaskMonitorChat } from './TaskMonitorChat';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import { cn } from '../../lib/utils';

interface BottomPanelTerminalProps {
  taskId: string | null;
  taskTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT_PERCENT = 0.7; // 70% of viewport
const DEFAULT_HEIGHT = 300;

export function BottomPanelTerminal({
  taskId,
  taskTitle,
  isOpen,
  onClose,
  onMinimize
}: BottomPanelTerminalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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

  const displayTitle = taskTitle || t('terminal:taskMonitor.title', { defaultValue: 'Task Monitor' });

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed bottom-0 left-12 right-0 bg-background border-t border-border shadow-lg z-40',
        'flex flex-col',
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

      {/* Header bar - fixed at top */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate max-w-[300px]" title={displayTitle}>
            {t('terminal:bottomPanel.header', { title: displayTitle, defaultValue: `Terminal: ${displayTitle}` })}
          </span>
        </div>
        <div className="flex items-center gap-1">
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
        {terminal ? (
          <TaskMonitorChat
            terminal={terminal}
            terminalRef={terminalRef}
            isActive={true}
            isMinimized={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t('terminal:waitingForOutput', { defaultValue: 'Waiting for terminal output...' })}
          </div>
        )}
      </div>
    </div>
  );
}
