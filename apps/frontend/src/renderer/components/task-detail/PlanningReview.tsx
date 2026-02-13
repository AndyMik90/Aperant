import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw, MessageSquare, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';
import { startBuild, startTask, useTaskStore, isTaskBlocked, forcePlanningIncomplete } from '../../stores/task-store';
import type { Task } from '../../../shared/types';

interface PlanningReviewProps {
  task: Task;
  onClose?: () => void;
}

/**
 * Planning review banner shown at the top of TaskDetailModal when a planning task has completed.
 * Displays inline above the normal tabs — all tabs remain visible.
 * Allows user to:
 * 1. Approve and start build
 * 2. Send back to planning with notes
 */
export function PlanningReview({ task, onClose }: PlanningReviewProps) {
  const { t } = useTranslation(['tasks']);
  const [notes, setNotes] = useState('');
  const [isStartingBuild, setIsStartingBuild] = useState(false);
  const [isReplanning, setIsReplanning] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const allTasks = useTaskStore((state) => state.tasks);
  const isBlocked = isTaskBlocked(task, allTasks);

  const handleApproveAndBuild = async () => {
    if (isBlocked) return;
    setIsStartingBuild(true);
    try {
      const success = await startBuild(task.id);
      if (success && onClose) {
        onClose();
      }
    } finally {
      setIsStartingBuild(false);
    }
  };

  const handleSendBackToPlanning = async () => {
    setIsReplanning(true);
    try {
      // Step 1: Reset files on disk FIRST (synchronous IPC — awaited)
      // Renames spec.md → spec.previous.md, writes PLANNING_FEEDBACK.md
      // This MUST complete before we update UI state or start the task.
      await window.electronAPI.resetPlanning(task.id, notes.trim() || undefined);

      // Step 2: NOW update frontend caches — files are guaranteed renamed on disk
      forcePlanningIncomplete(task.id);

      // Step 3: Clear stale subtasks from the old plan — they'll be regenerated
      const taskStore = useTaskStore.getState();
      taskStore.updateTask(task.id, { subtasks: [] });

      // Step 4: Start the planning agent (no planningNotes needed — feedback file already written)
      startTask(task.id);
      if (onClose) {
        onClose();
      }
    } finally {
      setIsReplanning(false);
    }
  };

  const subtaskCount = task.subtasks?.length ?? 0;

  return (
    <div className="border-b border-border bg-success/5">
      {/* Banner header with actions */}
      <div className="px-5 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {t('planningReview.title', { defaultValue: 'Planning Complete' })}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {t('planningReview.description', {
              defaultValue: 'Spec and prompt have been generated with {{count}} subtasks. Review before starting the build.',
              count: subtaskCount,
            })}
          </span>
        </div>

        {/* Action buttons inline */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-muted-foreground"
          onClick={() => setShowNotes(!showNotes)}
        >
          <MessageSquare className="h-3 w-3" />
          {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleSendBackToPlanning}
          disabled={isReplanning || isStartingBuild}
        >
          {isReplanning ? (
            <RotateCcw className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          {t('planningReview.sendBack', { defaultValue: 'Send Back to Planning' })}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleApproveAndBuild}
          disabled={isBlocked || isStartingBuild || isReplanning}
        >
          {isStartingBuild ? (
            <Play className="h-3 w-3 animate-pulse" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {isBlocked
            ? t('planningReview.blocked', { defaultValue: 'Blocked' })
            : t('planningReview.approve', { defaultValue: 'Approve & Start Build' })}
        </Button>
      </div>

      {/* Expandable notes section */}
      {showNotes && (
        <div className="px-5 pb-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('planningReview.notesPlaceholder', {
              defaultValue: 'Add feedback on the spec or prompt if you want to send back to planning...',
            })}
            className="w-full min-h-[60px] max-h-[100px] text-sm resize-none rounded-md border border-input bg-background px-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}
    </div>
  );
}
