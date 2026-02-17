import { useState } from 'react';
import { Play, Trash2, Save, Pencil } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { InsightsQueuedTask } from '../../stores/insights-task-queue-store';
import { useInsightsTaskQueueStore } from '../../stores/insights-task-queue-store';

interface TaskQueuePreviewDialogProps {
  task: InsightsQueuedTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

export function TaskQueuePreviewDialog({
  task,
  open,
  onOpenChange,
  onStart,
  onDelete,
}: TaskQueuePreviewDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const updateTask = useInsightsTaskQueueStore((s) => s.updateTask);

  const handleStartEdit = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!task) return;
    updateTask(task.id, {
      title: editTitle,
      description: editDescription,
    });
    setIsEditing(false);
  };

  const handleStart = () => {
    if (!task) return;
    onStart(task.id);
    onOpenChange(false);
  };

  const handleDelete = () => {
    if (!task) return;
    onDelete(task.id);
    onOpenChange(false);
  };

  if (!task) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-muted-foreground" />
            Queued Task
          </AlertDialogTitle>
          <AlertDialogDescription>
            {task.status === 'pending' ? 'Review and edit before starting' : 'Task details'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          {isEditing ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Task title"
            />
          ) : (
            <div className="text-sm font-medium">{task.title}</div>
          )}

          {/* Description */}
          {isEditing ? (
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Task description"
              rows={4}
            />
          ) : (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">
              {task.description || 'No description'}
            </div>
          )}

          {/* Metadata */}
          {task.metadata && (
            <div className="flex flex-wrap gap-1.5">
              {task.metadata.category && (
                <Badge variant="outline" className="text-xs">
                  {task.metadata.category}
                </Badge>
              )}
              {task.metadata.complexity && (
                <Badge variant="outline" className="text-xs">
                  {task.metadata.complexity}
                </Badge>
              )}
              {task.metadata.priority && (
                <Badge variant="outline" className="text-xs">
                  {task.metadata.priority}
                </Badge>
              )}
            </div>
          )}

          {/* Dependencies */}
          {task.metadata?.dependencies && task.metadata.dependencies.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Depends on:</div>
              <div className="flex flex-col gap-1 pl-2 border-l-2 border-muted-foreground/20">
                {task.metadata.dependencies.map((dep, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-px bg-muted-foreground/30" />
                    <Badge variant="secondary" className="text-xs">
                      {dep}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground pl-2">
                <div className="w-3 h-px bg-primary/50" />
                <span className="text-primary font-medium">Then: {task.title}</span>
              </div>
            </div>
          )}
        </div>

        <AlertDialogFooter className="flex-row gap-2">
          {task.status === 'pending' && (
            <>
              {isEditing ? (
                <Button size="sm" onClick={handleSave}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Save
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={handleStartEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
              <Button size="sm" onClick={handleStart}>
                <Play className="h-3.5 w-3.5 mr-1" />
                Start
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </>
          )}
          {task.status === 'failed' && (
            <>
              <Button size="sm" variant="outline" onClick={handleStart}>
                <Play className="h-3.5 w-3.5 mr-1" />
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </>
          )}
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
