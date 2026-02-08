import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, TerminalSquare, Eye, Trash2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';
import { deleteTask, startBuild, startTask } from '../stores/task-store';
import { useToast } from '../hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import type { TaskStatus } from '../../shared/types';

interface TaskCardContextMenuProps {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  onViewTerminal: () => void;
  onOpenDetail: () => void;
  children: React.ReactNode;
}

export const TaskCardContextMenu: React.FC<TaskCardContextMenuProps> = ({
  taskId,
  taskTitle,
  taskStatus,
  onViewTerminal,
  onOpenDetail,
  children,
}) => {
  const { t } = useTranslation(['tasks', 'common']);
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  // Determine which start action to show
  const canStartBuild = taskStatus === 'planning';
  const canStartTask = taskStatus === 'coding';

  const handleStartBuild = useCallback(async () => {
    try {
      const result = await startBuild(taskId);
      if (!result) {
        toast({
          title: t('common:errors.operationFailed'),
          description: t('tasks:errors.startBuildFailed', { defaultValue: 'Failed to start build' }),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('[TaskCardContextMenu] Error starting build:', error);
      toast({
        title: t('common:errors.operationFailed'),
        description: t('common:errors.unknownError'),
        variant: 'destructive',
      });
    }
  }, [taskId, t, toast]);

  const handleStartTask = useCallback(() => {
    try {
      startTask(taskId);
    } catch (error) {
      console.error('[TaskCardContextMenu] Error starting task:', error);
      toast({
        title: t('common:errors.operationFailed'),
        description: t('common:errors.unknownError'),
        variant: 'destructive',
      });
    }
  }, [taskId, t, toast]);

  const handleDeleteTask = useCallback(async () => {
    setShowDeleteConfirm(false);
    try {
      const result = await deleteTask(taskId);
      if (result.success) {
        toast({
          title: t('tasks:deleteSuccess', { defaultValue: 'Task deleted' }),
          description: taskTitle,
        });
      } else {
        toast({
          title: t('common:errors.operationFailed'),
          description: result.error || t('common:errors.unknownError'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('[TaskCardContextMenu] Error deleting task:', error);
      toast({
        title: t('common:errors.operationFailed'),
        description: t('common:errors.unknownError'),
        variant: 'destructive',
      });
    }
  }, [taskId, taskTitle, t, toast]);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {/* Start Build - only for planning status */}
          {canStartBuild && (
            <>
              <ContextMenuItem onClick={handleStartBuild} className="gap-2">
                <Play className="h-4 w-4" />
                <span>{t('actions.startBuild', { defaultValue: 'Start Build' })}</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          {/* Start Task - only for coding status */}
          {canStartTask && (
            <>
              <ContextMenuItem onClick={handleStartTask} className="gap-2">
                <Play className="h-4 w-4" />
                <span>{t('actions.run', { defaultValue: 'Start Task' })}</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          {/* View Terminal */}
          <ContextMenuItem onClick={onViewTerminal} className="gap-2">
            <TerminalSquare className="h-4 w-4" />
            <span>{t('actions.viewTerminal', { defaultValue: 'View Terminal' })}</span>
          </ContextMenuItem>

          {/* View Details */}
          <ContextMenuItem onClick={onOpenDetail} className="gap-2">
            <Eye className="h-4 w-4" />
            <span>{t('actions.viewDetails', { defaultValue: 'View Details' })}</span>
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Delete Task */}
          <ContextMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            <span>{t('actions.delete', { defaultValue: 'Delete Task' })}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('dialogs.deleteTask.title', { defaultValue: 'Delete Task' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('dialogs.deleteTask.description', {
                defaultValue: 'Are you sure you want to delete this task? This action cannot be undone.',
                taskTitle,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('actions.delete', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
