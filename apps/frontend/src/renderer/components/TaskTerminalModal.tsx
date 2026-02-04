/**
 * TaskTerminalModal - Modal for viewing task terminal output
 *
 * SUG-1a: Task Terminal Modal
 * Opens a modal showing the agent output for a task, allowing users
 * to monitor progress and send messages without leaving the current view.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { TaskMonitorChat } from './terminal/TaskMonitorChat';
import { useTerminalStore } from '../stores/terminal-store';
import { useTaskStore } from '../stores/task-store';
import { useNavigation } from '../contexts/NavigationContext';
import { cn } from '../lib/utils';
import type { Task } from '../../shared/types';

interface TaskTerminalModalProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath?: string;
}

export function TaskTerminalModal({
  task,
  open,
  onOpenChange,
  projectPath
}: TaskTerminalModalProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { setActiveView } = useNavigation();
  const terminals = useTerminalStore((state) => state.terminals);
  const setActiveTerminal = useTerminalStore((state) => state.setActiveTerminal);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get the terminal for this task
  const expectedTerminalId = task ? `task-${task.id}` : '';
  const terminal = terminals.find(t => t.id === expectedTerminalId);

  // Create terminal if it doesn't exist when modal opens
  useEffect(() => {
    if (!open || !task || !projectPath) return;

    const createTerminalIfNeeded = async () => {
      const terminalExists = terminals.some(t => t.id === expectedTerminalId);

      if (!terminalExists && (task.status === 'planning' || task.status === 'coding' || task.status === 'ai_review' || task.status === 'human_review')) {
        try {
          await window.electronAPI.createTerminal({
            id: expectedTerminalId,
            cwd: projectPath,
            projectPath,
            isTaskMonitor: true,
            taskId: task.id,
            specId: task.specId,
            taskTitle: task.title
          });
        } catch (error) {
          console.error('[TaskTerminalModal] Error creating task terminal:', error);
        }
      }
    };

    createTerminalIfNeeded();
  }, [open, task, projectPath, expectedTerminalId, terminals]);

  // Handle opening in full terminals page
  const handleOpenInTerminals = useCallback(() => {
    onOpenChange(false);
    setActiveView('terminals');
    if (terminal) {
      setTimeout(() => {
        setActiveTerminal(terminal.id);
      }, 100);
    }
  }, [onOpenChange, setActiveView, setActiveTerminal, terminal]);

  // Get task status info for badge
  const getStatusInfo = () => {
    if (!task) return null;

    const isRunning = task.status === 'coding' || task.status === 'planning';
    const phase = task.executionProgress?.phase;

    if (isRunning && phase && phase !== 'idle') {
      return {
        label: t(`execution.phases.${phase}`, { defaultValue: phase }),
        variant: 'info' as const
      };
    }

    return {
      label: t(`status.${task.status}`, { defaultValue: task.status }),
      variant: task.status === 'coding' ? 'info' as const : 'secondary' as const
    };
  };

  const statusInfo = getStatusInfo();

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col p-0 gap-0',
          isExpanded
            ? 'max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh]'
            : 'max-w-3xl w-[90vw] h-[70vh] max-h-[70vh]'
        )}
      >
        <DialogHeader className="flex-shrink-0 px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <DialogTitle className="truncate text-base font-semibold">
                {task.title}
              </DialogTitle>
              {statusInfo && (
                <Badge variant={statusInfo.variant} className="flex-shrink-0 text-xs">
                  {statusInfo.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? t('common:actions.minimize') : t('common:actions.maximize')}
              >
                {isExpanded ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleOpenInTerminals}
                title={t('tooltips.viewTerminal')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {terminal ? (
            <TaskMonitorChat
              terminal={terminal}
              terminalRef={terminalRef}
              isActive={true}
              isMinimized={false}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mb-4" />
              <p className="text-muted-foreground text-sm">
                {t('terminal.waitingForOutput', { defaultValue: 'Waiting for task output...' })}
              </p>
              <p className="text-muted-foreground/70 text-xs mt-2">
                {t('terminal.outputHint', { defaultValue: 'Output will appear here when the task starts running.' })}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
