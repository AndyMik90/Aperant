import { motion } from 'motion/react';
import { memo, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { ExecutionPhase, ExecutionProgress, Subtask } from '../../shared/types';

interface AgentAnalysisBannerProps {
  currentSubtask?: string;
  subtasks: Subtask[];
  phase?: ExecutionPhase;
  executionProgress?: ExecutionProgress;
  startedAt?: Date | string;
  className?: string;
}

// Phase display colors — mirrors PhaseProgressIndicator
const PHASE_COLORS: Record<ExecutionPhase, { dot: string; bg: string }> = {
  idle: { dot: 'bg-muted-foreground', bg: 'bg-muted' },
  planning: { dot: 'bg-amber-500', bg: 'bg-amber-500/10' },
  coding: { dot: 'bg-info', bg: 'bg-info/10' },
  rate_limit_paused: { dot: 'bg-orange-500', bg: 'bg-orange-500/10' },
  auth_failure_paused: { dot: 'bg-red-500', bg: 'bg-red-500/10' },
  qa_review: { dot: 'bg-purple-500', bg: 'bg-purple-500/10' },
  qa_fixing: { dot: 'bg-orange-500', bg: 'bg-orange-500/10' },
  complete: { dot: 'bg-success', bg: 'bg-success/10' },
  failed: { dot: 'bg-destructive', bg: 'bg-destructive/10' },
};

// Phases that indicate active execution
const ACTIVE_PHASES = new Set<ExecutionPhase>([
  'planning',
  'coding',
  'rate_limit_paused',
  'auth_failure_paused',
  'qa_review',
  'qa_fixing',
]);

// i18n key constants under the 'tasks' namespace
const I18N = {
  analyzing: 'analysisBanner.analyzing',
  next: 'analysisBanner.next',
  lastItem: 'analysisBanner.lastItem',
  elapsed: 'analysisBanner.elapsed',
  last30min: 'analysisBanner.last30min',
  completed: 'analysisBanner.completed',
  inProgress: 'analysisBanner.inProgress',
  pending: 'analysisBanner.pending',
  noActivity: 'analysisBanner.noActivity',
} as const;

/**
 * Format elapsed time as MM:SS
 */
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Compact status banner displayed while an agent is actively running on a task.
 * Shows the current subtask being analyzed, the next pending subtask, and elapsed time.
 */
export const AgentAnalysisBanner = memo(function AgentAnalysisBanner({
  currentSubtask,
  subtasks,
  phase: rawPhase,
  executionProgress,
  startedAt,
  className,
}: AgentAnalysisBannerProps) {
  const { t } = useTranslation('tasks');
  const phase = rawPhase || 'idle';
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer — ticks every second while the banner is active
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }

    const origin = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;

    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - origin.getTime()) / 1000));
      setElapsed(diff);
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startedAt]);

  // Resolve current subtask object
  const currentSubtaskObj = useMemo(() => {
    if (!currentSubtask) return undefined;
    return subtasks.find(
      (s) => s.id === currentSubtask || s.title === currentSubtask,
    );
  }, [currentSubtask, subtasks]);

  // Determine next pending subtask after current
  const nextSubtask = useMemo(() => {
    if (!currentSubtaskObj) {
      return subtasks.find((s) => s.status === 'pending');
    }
    const currentIndex = subtasks.indexOf(currentSubtaskObj);
    if (currentIndex === -1) {
      return subtasks.find((s) => s.status === 'pending');
    }
    return subtasks.slice(currentIndex + 1).find((s) => s.status === 'pending');
  }, [currentSubtaskObj, subtasks]);

  // Activity summary for the last 30 minutes
  const activitySummary = useMemo(() => {
    const completedCount = subtasks.filter((s) => s.status === 'completed').length;
    const inProgressCount = subtasks.filter((s) => s.status === 'in_progress').length;
    const pendingCount = subtasks.filter((s) => s.status === 'pending').length;
    return { completedCount, inProgressCount, pendingCount };
  }, [subtasks]);

  // Do not render when execution is not active
  if (!ACTIVE_PHASES.has(phase)) {
    return null;
  }

  const colors = PHASE_COLORS[phase] || PHASE_COLORS.idle;
  const currentTitle =
    currentSubtaskObj?.title ||
    executionProgress?.currentSubtask ||
    currentSubtask;

  const hasActivity =
    activitySummary.completedCount > 0 ||
    activitySummary.inProgressCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        colors.bg,
        className,
      )}
    >
      {/* Primary line */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: phase dot + current subtask */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <motion.span
            className={cn('inline-block h-2 w-2 shrink-0 rounded-full', colors.dot)}
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="truncate">
            <span className="font-medium text-foreground">
              {t(I18N.analyzing)}:
            </span>{' '}
            <span className="text-muted-foreground">
              {currentTitle || '...'}
            </span>
          </span>
        </div>

        {/* Center: next subtask */}
        <div className="hidden sm:flex items-center gap-1 text-muted-foreground/70 min-w-0 shrink-0">
          <span className="font-medium">{t(I18N.next)}:</span>{' '}
          <span className="truncate max-w-[200px]">
            {nextSubtask ? nextSubtask.title : t(I18N.lastItem)}
          </span>
        </div>

        {/* Right: elapsed timer */}
        <div className="flex items-center gap-1 shrink-0 tabular-nums text-muted-foreground">
          <span className="font-medium">{t(I18N.elapsed)}</span>
          <span>{formatElapsed(elapsed)}</span>
        </div>
      </div>

      {/* Secondary line */}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/60">
        <span>
          {t(I18N.last30min)}:{' '}
          {hasActivity ? (
            <>
              {activitySummary.completedCount > 0 && (
                <span>
                  {activitySummary.completedCount} {t(I18N.completed)}
                </span>
              )}
              {activitySummary.completedCount > 0 &&
                activitySummary.inProgressCount > 0 && ', '}
              {activitySummary.inProgressCount > 0 && (
                <span>
                  {activitySummary.inProgressCount} {t(I18N.inProgress)}
                </span>
              )}
            </>
          ) : (
            t(I18N.noActivity)
          )}
        </span>
        {executionProgress?.message && (
          <>
            <span className="text-border">|</span>
            <span className="truncate">{executionProgress.message}</span>
          </>
        )}
      </div>
    </motion.div>
  );
});
