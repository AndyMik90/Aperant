import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { memo, useRef, useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import type { ExecutionPhase, TaskLogs, Subtask } from '../../shared/types';

interface PhaseProgressIndicatorProps {
  phase?: ExecutionPhase;
  subtasks: Subtask[];
  phaseLogs?: TaskLogs | null;
  /** Fallback progress percentage (0-100) when phaseLogs unavailable */
  phaseProgress?: number;
  isStuck?: boolean;
  isRunning?: boolean;
  className?: string;
}

// Phase display configuration (colors only - labels are translated)
const PHASE_COLORS: Record<ExecutionPhase, { color: string; bgColor: string }> = {
  idle: { color: 'bg-muted-foreground', bgColor: 'bg-muted' },
  planning: { color: 'bg-amber-500', bgColor: 'bg-amber-500/20' },
  coding: { color: 'bg-info', bgColor: 'bg-info/20' },
  rate_limit_paused: { color: 'bg-orange-500', bgColor: 'bg-orange-500/20' },
  auth_failure_paused: { color: 'bg-red-500', bgColor: 'bg-red-500/20' },
  qa_review: { color: 'bg-purple-500', bgColor: 'bg-purple-500/20' },
  qa_fixing: { color: 'bg-orange-500', bgColor: 'bg-orange-500/20' },
  complete: { color: 'bg-success', bgColor: 'bg-success/20' },
  failed: { color: 'bg-destructive', bgColor: 'bg-destructive/20' },
};

// Phase label translation keys
const PHASE_LABEL_KEYS: Record<ExecutionPhase, string> = {
  idle: 'execution.phases.idle',
  planning: 'execution.phases.planning',
  coding: 'execution.phases.coding',
  rate_limit_paused: 'execution.phases.rate_limit_paused',
  auth_failure_paused: 'execution.phases.auth_failure_paused',
  qa_review: 'execution.phases.reviewing',
  qa_fixing: 'execution.phases.fixing',
  complete: 'execution.phases.complete',
  failed: 'execution.phases.failed',
};

/**
 * Smart progress indicator that adapts based on execution phase:
 * - Planning/Validation: Shows animated activity bar with entry count
 * - Coding: Shows subtask-based percentage progress
 * - Stuck: Shows warning state with interrupted animation
 *
 * Performance: Uses IntersectionObserver to pause animations when not visible
 */
export const PhaseProgressIndicator = memo(function PhaseProgressIndicator({
  phase: rawPhase,
  subtasks,
  phaseLogs,
  phaseProgress,
  isStuck = false,
  isRunning = false,
  className,
}: PhaseProgressIndicatorProps) {
  const { t } = useTranslation('tasks');
  const phase = rawPhase || 'idle';
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const prevVisibleRef = useRef(true);

  // Use IntersectionObserver to pause animations when component is not visible
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nowVisible = entry.isIntersecting;

        if (prevVisibleRef.current !== nowVisible && window.DEBUG) {
          console.log(`[PhaseProgress] Visibility changed: ${prevVisibleRef.current} -> ${nowVisible}, animations ${nowVisible ? 'resumed' : 'paused'}`);
        }

        prevVisibleRef.current = nowVisible;
        setIsVisible(nowVisible);
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Only animate when visible and running
  const shouldAnimate = isVisible && isRunning && !isStuck;

  // Calculate subtask-based progress (for coding phase)
  const completedSubtasks = subtasks.filter((c) => c.status === 'completed').length;
  const totalSubtasks = subtasks.length;
  const subtaskProgress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0;

  // Get log entry counts for activity indication
  const planningEntries = phaseLogs?.phases?.planning?.entries?.length || 0;
  const codingEntries = phaseLogs?.phases?.coding?.entries?.length || 0;
  const validationEntries = phaseLogs?.phases?.validation?.entries?.length || 0;

  // Determine which phase log to show activity for
  const getActivePhaseEntries = () => {
    if (phase === 'planning') return planningEntries;
    if (phase === 'qa_review' || phase === 'qa_fixing') return validationEntries;
    return codingEntries;
  };

  // Determine if we should show indeterminate (activity) vs determinate (%) progress
  const isIndeterminatePhase = phase === 'planning' || phase === 'qa_review' || phase === 'qa_fixing';
  // Show subtask progress whenever subtasks exist (stops pulsing animation when spec completes)
  const showSubtaskProgress = totalSubtasks > 0;

  const colors = PHASE_COLORS[phase] || PHASE_COLORS.idle;
  const phaseLabel = t(PHASE_LABEL_KEYS[phase] || PHASE_LABEL_KEYS.idle);
  const activeEntries = getActivePhaseEntries();

  return (
    <div ref={containerRef} className={cn('space-y-1.5', className)}>
      {/* Progress label row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isStuck ? t('execution.labels.interrupted') : showSubtaskProgress ? t('execution.labels.progress') : phaseLabel}
          </span>
          {/* Activity indicator dot for non-coding phases - only animate when visible */}
          {isRunning && !isStuck && isIndeterminatePhase && (
            <motion.div
              className={cn('h-1.5 w-1.5 rounded-full', colors.color)}
              animate={shouldAnimate ? {
                scale: [1, 1.5, 1],
                opacity: [1, 0.5, 1],
              } : { scale: 1, opacity: 1 }}
              transition={shouldAnimate ? {
                duration: 1,
                repeat: Infinity,
                ease: 'easeInOut',
              } : undefined}
            />
          )}
        </div>
        <span className="text-xs font-medium text-foreground">
          {showSubtaskProgress ? (
            `${subtaskProgress}%`
          ) : activeEntries > 0 ? (
            <span className="text-muted-foreground">
              {activeEntries} {activeEntries === 1 ? t('execution.labels.entry') : t('execution.labels.entries')}
            </span>
          ) : isRunning && isIndeterminatePhase && (phaseProgress ?? 0) > 0 ? (
            `${Math.round(Math.min(phaseProgress!, 100))}%`
          ) : (
            '—'
          )}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className={cn(
          'relative h-1.5 w-full overflow-hidden rounded-full',
          isStuck ? 'bg-warning/20' : 'bg-border'
        )}
      >
        <AnimatePresence mode="wait">
          {isStuck ? (
            // Stuck/Interrupted state - pulsing warning bar (only animate when visible)
            <motion.div
              key="stuck"
              className="absolute inset-0 bg-warning/40"
              initial={{ opacity: 0 }}
              animate={isVisible ? { opacity: [0.3, 0.6, 0.3] } : { opacity: 0.45 }}
              transition={isVisible ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
            />
          ) : showSubtaskProgress ? (
            // Determinate progress for coding phase
            <motion.div
              key="determinate"
              className={cn('h-full rounded-full', colors.color)}
              initial={{ width: 0 }}
              animate={{ width: `${subtaskProgress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          ) : shouldAnimate && isIndeterminatePhase ? (
            // Indeterminate animated progress for planning/validation (only when visible)
            <motion.div
              key="indeterminate"
              className={cn('absolute h-full w-1/3 rounded-full', colors.color)}
              animate={{
                x: ['-100%', '400%'],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ) : isRunning && isIndeterminatePhase && !isVisible ? (
            // Static placeholder when not visible but running
            <motion.div
              key="indeterminate-static"
              className={cn('absolute h-full w-1/3 rounded-full left-1/3', colors.color)}
            />
          ) : null}
        </AnimatePresence>
      </div>

      {/* Subtask indicators (only show when subtasks exist) */}
      {totalSubtasks > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {subtasks.slice(0, 10).map((subtask, index) => {
            const isInProgress = subtask.status === 'in_progress';
            const shouldPulse = isInProgress && isVisible;

            return (
              <motion.div
                key={subtask.id || `subtask-${index}`}
                className={cn(
                  'h-2 w-2 rounded-full',
                  subtask.status === 'completed' && 'bg-success',
                  isInProgress && 'bg-info',
                  subtask.status === 'failed' && 'bg-destructive',
                  subtask.status === 'pending' && 'bg-muted-foreground/30'
                )}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  // Only animate boxShadow when visible to save GPU cycles
                  ...(shouldPulse && {
                    boxShadow: [
                      '0 0 0 0 rgba(var(--info), 0.4)',
                      '0 0 0 4px rgba(var(--info), 0)',
                    ],
                  }),
                }}
                transition={{
                  scale: { delay: index * 0.03, duration: 0.2 },
                  opacity: { delay: index * 0.03, duration: 0.2 },
                  // Only repeat animation when visible
                  boxShadow: shouldPulse
                    ? { duration: 1, repeat: Infinity, ease: 'easeOut' }
                    : undefined,
                }}
                title={`${subtask.title || subtask.id}: ${subtask.status}`}
              />
            );
          })}
          {totalSubtasks > 10 && (
            <span key="overflow-count" className="text-[10px] text-muted-foreground font-medium ml-0.5">
              +{totalSubtasks - 10}
            </span>
          )}
        </div>
      )}

      {/* Phase steps indicator (shows overall flow) */}
      {(isRunning || phase !== 'idle') && (
        <PhaseStepsIndicator currentPhase={phase} isStuck={isStuck} isVisible={isVisible} />
      )}
    </div>
  );
});

/**
 * Mini phase steps indicator showing the overall flow
 */
const PhaseStepsIndicator = memo(function PhaseStepsIndicator({
  currentPhase,
  isStuck,
  isVisible = true,
}: {
  currentPhase: ExecutionPhase;
  isStuck: boolean;
  isVisible?: boolean;
}) {
  const { t } = useTranslation('tasks');

  const phases: { key: ExecutionPhase; labelKey: string }[] = [
    { key: 'planning', labelKey: 'execution.shortPhases.plan' },
    { key: 'coding', labelKey: 'execution.shortPhases.code' },
    { key: 'qa_review', labelKey: 'execution.shortPhases.qa' },
  ];

  const getPhaseState = (phaseKey: ExecutionPhase) => {
    const phaseOrder = ['planning', 'coding', 'qa_review', 'qa_fixing', 'complete'];
    const currentIndex = phaseOrder.indexOf(currentPhase);
    const phaseIndex = phaseOrder.indexOf(phaseKey);

    if (currentPhase === 'failed') return 'failed';
    if (currentPhase === 'complete') return 'complete';
    if (phaseKey === currentPhase || (phaseKey === 'qa_review' && currentPhase === 'qa_fixing')) {
      return isStuck ? 'stuck' : 'active';
    }
    if (phaseIndex < currentIndex) return 'complete';
    return 'pending';
  };

  return (
    <div className="flex items-center gap-1 mt-2">
      {phases.map((phase, index) => {
        const state = getPhaseState(phase.key);
        const shouldAnimate = state === 'active' && !isStuck && isVisible;

        return (
          <div key={phase.key} className="flex items-center">
            <motion.div
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium',
                state === 'complete' && 'bg-success/10 text-success',
                state === 'active' && 'bg-primary/10 text-primary',
                state === 'stuck' && 'bg-warning/10 text-warning',
                state === 'failed' && 'bg-destructive/10 text-destructive',
                state === 'pending' && 'bg-muted text-muted-foreground'
              )}
              animate={shouldAnimate ? { opacity: [1, 0.6, 1] } : { opacity: 1 }}
              transition={shouldAnimate ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
            >
              {state === 'complete' && (
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {t(phase.labelKey)}
            </motion.div>
            {index < phases.length - 1 && (
              <div
                className={cn(
                  'w-2 h-px mx-0.5',
                  getPhaseState(phases[index + 1].key) !== 'pending' ? 'bg-success/50' : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
