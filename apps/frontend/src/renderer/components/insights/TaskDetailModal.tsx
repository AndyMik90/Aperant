import { X, Calendar, FileText, Tag, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { formatRelativeTime } from '../../lib/utils';
import { PhaseProgressIndicator } from '../PhaseProgressIndicator';
import type { Task } from '../../../shared/types';

interface TaskDetailModalProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
}

// Phase-to-color mapping (matches Kanban columns)
const phaseColorMap: Record<string, { bg: string; text: string; label: string }> = {
  starting:  { bg: 'bg-primary/10',     text: 'text-primary',     label: 'Starting' },
  planning:  { bg: 'bg-amber-500/10',   text: 'text-amber-500',   label: 'Planning' },
  coding:    { bg: 'bg-blue-500/10',    text: 'text-blue-500',    label: 'Coding' },
  qa_review: { bg: 'bg-purple-500/10',  text: 'text-purple-500',  label: 'QA Review' },
  qa_fixing: { bg: 'bg-orange-500/10',  text: 'text-orange-500',  label: 'Fixing' },
  complete:  { bg: 'bg-emerald-500/10', text: 'text-emerald-500', label: 'Complete' },
  done:      { bg: 'bg-emerald-500/10', text: 'text-emerald-500', label: 'Done' },
  failed:    { bg: 'bg-red-500/10',     text: 'text-red-500',     label: 'Failed' },
};

export function TaskDetailModal({ task, open, onClose }: TaskDetailModalProps) {
  if (!task) return null;

  const phase = task.executionProgress?.phase || task.status;
  const phaseConfig = phaseColorMap[phase] || phaseColorMap.starting;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl mb-2 pr-8">{task.title}</DialogTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('text-xs', phaseConfig.bg, phaseConfig.text)}>
                  {phaseConfig.label}
                </Badge>
                {task.metadata?.complexity && (
                  <Badge variant="outline" className="text-xs">
                    {task.metadata.complexity}
                  </Badge>
                )}
                {task.metadata?.category && (
                  <Badge variant="outline" className="text-xs">
                    {task.metadata.category}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-4">
            {/* Description */}
            {task.description && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Description</h3>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            {/* Progress (if running) */}
            {task.executionProgress && task.status !== 'done' && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Progress</h3>
                </div>
                <PhaseProgressIndicator
                  phase={task.executionProgress.phase}
                  subtasks={task.subtasks || []}
                  phaseProgress={task.executionProgress.phaseProgress}
                  isRunning={['planning', 'coding', 'qa'].includes(task.status)}
                  isStuck={false}
                />
              </div>
            )}

            {/* Metadata */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Task ID:</span>
                  <span className="ml-2 font-mono">{task.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className="ml-2">{task.status}</span>
                </div>
                {task.metadata?.sourceType && (
                  <div>
                    <span className="text-muted-foreground">Source:</span>
                    <span className="ml-2">{task.metadata.sourceType}</span>
                  </div>
                )}
                {task.metadata?.priority && (
                  <div>
                    <span className="text-muted-foreground">Priority:</span>
                    <span className="ml-2">{task.metadata.priority}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Timestamps */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Timeline</h3>
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <span className="ml-2">{formatRelativeTime(task.createdAt)}</span>
                </div>
                {task.updatedAt && (
                  <div>
                    <span className="text-muted-foreground">Updated:</span>
                    <span className="ml-2">{formatRelativeTime(task.updatedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Subtasks (if any) */}
            {task.subtasks && task.subtasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Subtasks ({task.subtasks.length})</h3>
                </div>
                <div className="space-y-1">
                  {task.subtasks.map((subtask, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <div className={cn(
                        'w-4 h-4 rounded-full flex-shrink-0 mt-0.5',
                        subtask.status === 'completed' ? 'bg-emerald-500' :
                        subtask.status === 'failed' ? 'bg-red-500' :
                        subtask.status === 'in_progress' ? 'bg-blue-500' :
                        'bg-muted'
                      )} />
                      <span className={cn(
                        subtask.status === 'completed' && 'text-muted-foreground line-through'
                      )}>{subtask.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Logs preview (if any) */}
            {task.logs && task.logs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Recent Logs ({task.logs.length})</h3>
                </div>
                <div className="bg-muted/50 rounded-md p-3 max-h-32 overflow-y-auto">
                  <div className="space-y-1 text-xs font-mono">
                    {task.logs.slice(-5).map((log, idx) => (
                      <div key={idx} className="text-muted-foreground">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
