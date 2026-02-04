import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '../contexts/NavigationContext';
import { Play, Square, Clock, Zap, Target, Shield, Gauge, Palette, FileCode, Bug, Wrench, Loader2, AlertTriangle, RotateCcw, Archive, GitPullRequest, TerminalSquare, Link2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { TaskMonitorChat } from './terminal/TaskMonitorChat';
import { CompactTerminalPreview } from './terminal/CompactTerminalPreview';
import { DriftBadge } from './drift/DriftIndicator';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn, formatRelativeTime, sanitizeMarkdownForDisplay } from '../lib/utils';
import { ANIMATION_CLASSES } from '../lib/animations';
import { estimateRemainingTime, formatETA, calculateProgress } from '../../shared/progress';
import { PhaseProgressIndicator } from './PhaseProgressIndicator';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_IMPACT_COLORS,
  TASK_IMPACT_LABELS,
  TASK_PRIORITY_COLORS,
  TASK_PRIORITY_LABELS,
  EXECUTION_PHASE_LABELS,
  EXECUTION_PHASE_BADGE_COLORS,
  JSON_ERROR_PREFIX,
  JSON_ERROR_TITLE_SUFFIX
} from '../../shared/constants';
import { startTask, stopTask, startBuild, checkTaskRunning, recoverStuckTask, isIncompleteHumanReview, archiveTasks, useTaskStore, isTaskBlocked, getBlockingTasks } from '../stores/task-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useProjectStore } from '../stores/project-store';
import type { Task, TaskCategory, ReviewReason, TaskStatus } from '../../shared/types';

// Category icon mapping
const CategoryIcon: Record<TaskCategory, typeof Zap> = {
  feature: Target,
  bug_fix: Bug,
  refactoring: Wrench,
  documentation: FileCode,
  security: Shield,
  performance: Gauge,
  ui_ux: Palette,
  infrastructure: Wrench,
  testing: FileCode
};

// Phases where stuck detection should be skipped (terminal states + initial planning)
// Defined outside component to avoid recreation on every render
const STUCK_CHECK_SKIP_PHASES = ['complete', 'failed', 'planning'] as const;

function shouldSkipStuckCheck(phase: string | undefined): boolean {
  return STUCK_CHECK_SKIP_PHASES.includes(phase as typeof STUCK_CHECK_SKIP_PHASES[number]);
}

/**
 * METRICS-1B: Format duration for display
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "5s", "2m", "1h 30m"
 */
function formatDurationShort(ms: number): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * METRICS-1C: Duration breakdown display for completed tasks
 */
interface DurationBreakdownProps {
  durations: {
    planning_ms?: number;
    coding_ms?: number;
    ai_review_ms?: number;
    total_ai_ms?: number;
  };
}

function DurationBreakdown({ durations }: DurationBreakdownProps) {
  const total = durations.total_ai_ms || 0;
  if (total === 0) return null;

  const phases = [
    { name: 'Planning', ms: durations.planning_ms || 0, color: 'bg-blue-500' },
    { name: 'Coding', ms: durations.coding_ms || 0, color: 'bg-green-500' },
    { name: 'AI Review', ms: durations.ai_review_ms || 0, color: 'bg-purple-500' },
  ].filter(p => p.ms > 0);

  return (
    <div className="mt-3 p-2 rounded bg-muted/30 text-xs">
      <div className="text-muted-foreground mb-2 font-medium">AI Work Time</div>
      {/* Phase breakdown bars */}
      <div className="flex h-1.5 rounded-full overflow-hidden mb-2 bg-muted">
        {phases.map((phase, i) => {
          const percent = (phase.ms / total) * 100;
          return (
            <div
              key={i}
              className={cn(phase.color)}
              style={{ width: `${percent}%` }}
              title={`${phase.name}: ${formatDurationShort(phase.ms)} (${Math.round(percent)}%)`}
            />
          );
        })}
      </div>
      {/* Phase labels */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {phases.map((phase, i) => {
          const percent = Math.round((phase.ms / total) * 100);
          return (
            <div key={i} className="flex items-center gap-1">
              <div className={cn('w-2 h-2 rounded-full', phase.color)} />
              <span className="text-muted-foreground">
                {phase.name}: {formatDurationShort(phase.ms)} ({percent}%)
              </span>
            </div>
          );
        })}
      </div>
      {/* Total */}
      <div className="mt-2 pt-2 border-t border-border flex justify-between">
        <span className="text-muted-foreground font-medium">Total AI Time</span>
        <span className="font-medium">{formatDurationShort(total)}</span>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onStatusChange?: (newStatus: TaskStatus) => unknown;
  // Optional selectable mode props for multi-selection
  isSelectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  // FIX-29b: Callback to open task terminal in bottom panel
  onOpenBottomPanel?: (taskId: string, taskTitle: string) => void;
}

// Custom comparator for React.memo - only re-render when relevant task data changes
function taskCardPropsAreEqual(prevProps: TaskCardProps, nextProps: TaskCardProps): boolean {
  const prevTask = prevProps.task;
  const nextTask = nextProps.task;

  // Fast path: same reference (include selectable props)
  if (
    prevTask === nextTask &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onStatusChange === nextProps.onStatusChange &&
    prevProps.isSelectable === nextProps.isSelectable &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelect === nextProps.onToggleSelect &&
    prevProps.onOpenBottomPanel === nextProps.onOpenBottomPanel
  ) {
    return true;
  }

  // Check selectable props first (cheap comparison)
  if (
    prevProps.isSelectable !== nextProps.isSelectable ||
    prevProps.isSelected !== nextProps.isSelected
  ) {
    return false;
  }

  // Compare only the fields that affect rendering
  const isEqual = (
    prevTask.id === nextTask.id &&
    prevTask.status === nextTask.status &&
    prevTask.title === nextTask.title &&
    prevTask.description === nextTask.description &&
    prevTask.updatedAt === nextTask.updatedAt &&
    prevTask.reviewReason === nextTask.reviewReason &&
    prevTask.executionProgress?.phase === nextTask.executionProgress?.phase &&
    prevTask.executionProgress?.phaseProgress === nextTask.executionProgress?.phaseProgress &&
    prevTask.subtasks.length === nextTask.subtasks.length &&
    prevTask.metadata?.category === nextTask.metadata?.category &&
    prevTask.metadata?.complexity === nextTask.metadata?.complexity &&
    prevTask.metadata?.archivedAt === nextTask.metadata?.archivedAt &&
    prevTask.metadata?.prUrl === nextTask.metadata?.prUrl &&
    // Check if any subtask statuses changed (compare all subtasks)
    prevTask.subtasks.every((s, i) => s.status === nextTask.subtasks[i]?.status)
  );

  // Only log when actually re-rendering (reduces noise significantly)
  if (window.DEBUG && !isEqual) {
    const changes: string[] = [];
    if (prevTask.status !== nextTask.status) changes.push(`status: ${prevTask.status} -> ${nextTask.status}`);
    if (prevTask.executionProgress?.phase !== nextTask.executionProgress?.phase) {
      changes.push(`phase: ${prevTask.executionProgress?.phase} -> ${nextTask.executionProgress?.phase}`);
    }
    if (prevTask.subtasks.length !== nextTask.subtasks.length) {
      changes.push(`subtasks: ${prevTask.subtasks.length} -> ${nextTask.subtasks.length}`);
    }
    console.log(`[TaskCard] Re-render: ${prevTask.id} | ${changes.join(', ') || 'other fields'}`);
  }

  return isEqual;
}

export const TaskCard = memo(function TaskCard({
  task,
  onClick,
  onStatusChange,
  isSelectable,
  isSelected,
  onToggleSelect,
  onOpenBottomPanel
}: TaskCardProps) {
  const { t } = useTranslation(['tasks', 'errors']);
  const { setActiveView } = useNavigation();
  const selectedProject = useProjectStore((state) => state.projects.find(p => p.id === state.selectedProjectId));
  const terminals = useTerminalStore((state) => state.terminals);
  const setActiveTerminal = useTerminalStore((state) => state.setActiveTerminal);
  const addTerminal = useTerminalStore((state) => state.addTerminal);
  const [isStuck, setIsStuck] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  // FIX-21: Inline terminal expansion instead of modal
  const [isTerminalExpanded, setIsTerminalExpanded] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const stuckCheckRef = useRef<{ timeout: NodeJS.Timeout | null; interval: NodeJS.Timeout | null }>({
    timeout: null,
    interval: null
  });

  // Coding tasks have active execution agents
  const isRunning = task.status === 'coding';
  // Phase 2: Planning tasks may have active planning agents
  const isPlanning = task.status === 'planning';
  // Check if the agent was stopped (for visual feedback on stop button)
  const isAgentStopped = useTaskStore((state) => state.isAgentStopped(task.id));
  // Both planning and coding tasks can be considered "active" for visual purposes
  // But only if agent hasn't been stopped
  const hasActiveAgent = (task.status === 'coding' || task.status === 'planning') && !isAgentStopped;
  const executionPhase = task.executionProgress?.phase;
  const hasActiveExecution = executionPhase && executionPhase !== 'idle' && executionPhase !== 'complete' && executionPhase !== 'failed';

  // Check if task is in human_review but has no completed subtasks (crashed/incomplete)
  const isIncomplete = isIncompleteHumanReview(task);

  // SUG-6: Check if task is blocked by incomplete dependencies
  const allTasks = useTaskStore((state) => state.tasks);
  const isBlocked = useMemo(() => isTaskBlocked(task, allTasks), [task, allTasks]);
  const blockingTasks = useMemo(() => getBlockingTasks(task, allTasks), [task, allTasks]);

  // METRICS-1B: Elapsed time tracking
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);

  // METRICS-1B: Update elapsed time every second while task is running
  useEffect(() => {
    // Only track time for active tasks (planning or coding with agent running)
    if (!hasActiveAgent) {
      setElapsedTime(null);
      return;
    }

    // Get start time from execution progress
    const startTime = task.executionProgress?.startedAt;
    if (!startTime) {
      setElapsedTime(null);
      return;
    }

    // Calculate initial elapsed time
    const startMs = new Date(startTime).getTime();
    setElapsedTime(Date.now() - startMs);

    // Update every second
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startMs);
    }, 1000);

    return () => clearInterval(interval);
  }, [hasActiveAgent, task.executionProgress?.startedAt]);

  // Memoize expensive computations to avoid running on every render
  // Truncate description for card display - full description shown in modal
  // Handle JSON error tasks with i18n
  const sanitizedDescription = useMemo(() => {
    if (!task.description) return null;
    // Check for JSON error marker and use i18n
    if (task.description.startsWith(JSON_ERROR_PREFIX)) {
      const errorMessage = task.description.slice(JSON_ERROR_PREFIX.length);
      const translatedDesc = t('errors:task.jsonError.description', { error: errorMessage });
      return sanitizeMarkdownForDisplay(translatedDesc, 120);
    }
    return sanitizeMarkdownForDisplay(task.description, 120);
  }, [task.description, t]);

  // Memoize title with JSON error suffix handling
  const displayTitle = useMemo(() => {
    if (task.title.endsWith(JSON_ERROR_TITLE_SUFFIX)) {
      const baseName = task.title.slice(0, -JSON_ERROR_TITLE_SUFFIX.length);
      return `${baseName} ${t('errors:task.jsonError.titleSuffix')}`;
    }
    return task.title;
  }, [task.title, t]);

  // Memoize relative time (recalculates only when updatedAt changes)
  const relativeTime = useMemo(
    () => formatRelativeTime(task.updatedAt),
    [task.updatedAt]
  );


  // Memoized stuck check function to avoid recreating on every render
  const performStuckCheck = useCallback(() => {
    const currentPhase = task.executionProgress?.phase;
    if (shouldSkipStuckCheck(currentPhase)) {
      if (window.DEBUG) {
        console.log(`[TaskCard] Stuck check skipped for ${task.id} - phase is '${currentPhase}' (planning/terminal phases don't need process verification)`);
      }
      setIsStuck(false);
      return;
    }

    // Use requestIdleCallback for non-blocking check when available
    const doCheck = () => {
      checkTaskRunning(task.id).then((actuallyRunning) => {
        // Double-check the phase again in case it changed while waiting
        const latestPhase = task.executionProgress?.phase;
        if (shouldSkipStuckCheck(latestPhase)) {
          setIsStuck(false);
        } else {
          setIsStuck(!actuallyRunning);
        }
      });
    };

    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(doCheck);
    } else {
      doCheck();
    }
  }, [task.id, task.executionProgress?.phase]);

  // Check if task is stuck (status says in_progress but no actual process)
  // Add a longer grace period to avoid false positives during process spawn
  useEffect(() => {
    if (!isRunning) {
      setIsStuck(false);
      // Clear any pending checks
      if (stuckCheckRef.current.timeout) {
        clearTimeout(stuckCheckRef.current.timeout);
        stuckCheckRef.current.timeout = null;
      }
      if (stuckCheckRef.current.interval) {
        clearInterval(stuckCheckRef.current.interval);
        stuckCheckRef.current.interval = null;
      }
      return;
    }

    // Initial check after 5s grace period (increased from 2s)
    stuckCheckRef.current.timeout = setTimeout(performStuckCheck, 5000);

    // Periodic re-check every 30 seconds (reduced frequency from 15s)
    stuckCheckRef.current.interval = setInterval(performStuckCheck, 30000);

    return () => {
      if (stuckCheckRef.current.timeout) {
        clearTimeout(stuckCheckRef.current.timeout);
      }
      if (stuckCheckRef.current.interval) {
        clearInterval(stuckCheckRef.current.interval);
      }
    };
  }, [task.id, isRunning, performStuckCheck]);

  // Add visibility change handler to re-validate on focus (debounced)
  useEffect(() => {
    let debounceTimeout: NodeJS.Timeout | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isRunning) {
        // Debounce visibility checks to avoid rapid re-checks
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(performStuckCheck, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (debounceTimeout) clearTimeout(debounceTimeout);
    };
  }, [isRunning, performStuckCheck]);

  const handleStartStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning && !isStuck) {
      stopTask(task.id);
    } else {
      startTask(task.id);
    }
  };

  const handleRecover = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRecovering(true);
    // Auto-restart the task after recovery (no need to click Start again)
    const result = await recoverStuckTask(task.id, { autoRestart: true });
    if (result.success) {
      setIsStuck(false);
    }
    setIsRecovering(false);
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await archiveTasks(task.projectId, [task.id]);
    if (!result.success) {
      console.error('[TaskCard] Failed to archive task:', task.id, result.error);
    }
  };

  const handleViewPR = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.metadata?.prUrl && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(task.metadata.prUrl);
    }
  };

  // FIX-21: Toggle inline terminal expansion instead of modal
  const handleViewTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsTerminalExpanded(!isTerminalExpanded);
  };

  // FIX-21: Get or create task monitor terminal for inline display
  const taskTerminalId = `task-${task.id}`;
  const taskTerminal = useMemo(() => {
    return terminals.find(t => t.id === taskTerminalId);
  }, [terminals, taskTerminalId]);

  // FIX-21: Create terminal if expanded and doesn't exist
  useEffect(() => {
    if (isTerminalExpanded && !taskTerminal && selectedProject?.path) {
      // Create the task monitor terminal via electron API
      window.electronAPI.createTerminal({
        id: taskTerminalId,
        cwd: selectedProject.path,
        projectPath: selectedProject.path,
        isTaskMonitor: true,
        taskId: task.id,
        specId: task.specId,
        taskTitle: task.title
      }).catch((err: unknown) => {
        console.error('[TaskCard] Failed to create task terminal:', err);
      });
    }
  }, [isTerminalExpanded, taskTerminal, selectedProject?.path, taskTerminalId, task.id, task.specId, task.title]);

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'planning':
        return 'default';
      case 'coding':
        return 'info';
      case 'ai_review':
        return 'warning';
      case 'human_review':
        return 'purple';
      case 'pr_created':
        return 'success';
      case 'done':
        return 'success';
      default:
        return 'secondary';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'planning':
        return t('labels.planning', { defaultValue: 'Planning' });
      case 'coding':
        return t('labels.running');
      case 'ai_review':
        return t('labels.aiReview');
      case 'human_review':
        return t('labels.needsReview');
      case 'pr_created':
        return t('columns.pr_created');
      case 'done':
        return t('status.complete');
      default:
        return t('labels.pending');
    }
  };

  const getReviewReasonLabel = (reason?: ReviewReason): { label: string; variant: 'success' | 'destructive' | 'warning' } | null => {
    if (!reason) return null;
    switch (reason) {
      case 'completed':
        return { label: t('reviewReason.completed'), variant: 'success' };
      case 'errors':
        return { label: t('reviewReason.hasErrors'), variant: 'destructive' };
      case 'qa_rejected':
        return { label: t('reviewReason.qaIssues'), variant: 'warning' };
      case 'plan_review':
        return { label: t('reviewReason.approvePlan'), variant: 'warning' };
      default:
        return null;
    }
  };

  const reviewReasonInfo = task.status === 'human_review' ? getReviewReasonLabel(task.reviewReason) : null;

  /**
   * Get context-aware label for execution phase based on task status.
   * This makes phase labels more understandable to users by showing
   * descriptive labels like "Creating Spec" instead of generic "Planning".
   */
  const getContextualPhaseLabel = (status: TaskStatus, phase: string): string => {
    // Special handling for phase within coding status
    if (status === 'coding') {
      switch (phase) {
        case 'starting':
          return t('execution.phases.starting', { defaultValue: 'Starting...' });
        case 'planning':
          return t('execution.phases.creatingSpec', { defaultValue: 'Creating Spec' });
        case 'coding':
          return t('execution.phases.implementing', { defaultValue: 'Implementing' });
        case 'qa_review':
          return t('execution.phases.testing', { defaultValue: 'Testing' });
        case 'qa_fixing':
          return t('execution.phases.fixing', { defaultValue: 'Fixing Issues' });
        default:
          return EXECUTION_PHASE_LABELS[phase] || phase;
      }
    }

    // For ai_review status
    if (status === 'ai_review') {
      switch (phase) {
        case 'qa_review':
          return t('execution.phases.reviewing', { defaultValue: 'Reviewing' });
        case 'qa_fixing':
          return t('execution.phases.fixing', { defaultValue: 'Fixing Issues' });
        default:
          return EXECUTION_PHASE_LABELS[phase] || phase;
      }
    }

    // Default to standard labels
    return EXECUTION_PHASE_LABELS[phase] || phase;
  };

  const isArchived = !!task.metadata?.archivedAt;

  return (
    <Card
      className={cn(
        'card-surface task-card-enhanced cursor-pointer',
        ANIMATION_CLASSES.cardEnter,
        ANIMATION_CLASSES.cardHover,
        // Phase 2: Both planning and coding tasks with agents show the running pulse
        hasActiveAgent && !isStuck && 'ring-2 ring-primary border-primary task-running-pulse',
        isStuck && 'ring-2 ring-warning border-warning task-stuck-pulse',
        isArchived && 'opacity-60 hover:opacity-80',
        isSelectable && isSelected && 'ring-2 ring-ring border-ring bg-accent/10',
        // FIX-21: Expand when terminal is open
        isTerminalExpanded && 'ring-2 ring-primary/50'
      )}
      onClick={onClick}
    >
      {/* FIX-22: Animated activity indicator bar at top when running */}
      {hasActiveAgent && !isStuck && (
        <div className="h-0.5 bg-gradient-to-r from-primary via-primary/50 to-primary animate-pulse rounded-t-lg" />
      )}
      <CardContent className="p-4">
        <div className={isSelectable ? 'flex gap-3' : undefined}>
          {/* Checkbox for selectable mode - stops event propagation */}
          {isSelectable && (
            <div className="flex-shrink-0 pt-0.5">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
                aria-label={t('tasks:actions.selectTask', { title: displayTitle })}
              />
            </div>
          )}

          <div className={isSelectable ? 'flex-1 min-w-0' : undefined}>
            {/* Title - single line with ellipsis, full text on hover */}
            <h3
              className="font-semibold text-sm text-foreground truncate"
              title={displayTitle}
            >
              {displayTitle}
            </h3>

        {/* Description - 2-3 lines max with proper word wrap and ellipsis */}
        {sanitizedDescription && (
          <p
            className="mt-2 text-xs text-muted-foreground line-clamp-3 break-words"
            title={task.description}
          >
            {sanitizedDescription}
          </p>
        )}

        {/* Metadata badges */}
        {(task.metadata || isStuck || isIncomplete || isBlocked || hasActiveExecution || reviewReasonInfo) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {/* Stuck indicator - highest priority */}
            {isStuck && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0.5 flex items-center gap-1 bg-warning/10 text-warning border-warning/30 badge-priority-urgent"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('labels.stuck')}
              </Badge>
            )}
            {/* SUG-6: Blocked indicator - task has incomplete dependencies */}
            {isBlocked && !isStuck && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0.5 flex items-center gap-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                title={blockingTasks.map(t => t.title).join(', ')}
              >
                <Link2 className="h-2.5 w-2.5" />
                {t('tasks:dependencies.blockedBy', {
                  count: blockingTasks.length,
                  task: blockingTasks[0]?.title?.slice(0, 20) + (blockingTasks[0]?.title?.length > 20 ? '...' : ''),
                  defaultValue: `Blocked by ${blockingTasks.length} task${blockingTasks.length > 1 ? 's' : ''}`
                })}
              </Badge>
            )}
            {/* Incomplete indicator - task in human_review but no subtasks completed */}
            {isIncomplete && !isStuck && !isBlocked && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0.5 flex items-center gap-1 bg-orange-500/10 text-orange-400 border-orange-500/30"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('labels.incomplete')}
              </Badge>
            )}
            {/* Archived indicator - task has been released */}
            {task.metadata?.archivedAt && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0.5 flex items-center gap-1 bg-muted text-muted-foreground border-border"
              >
                <Archive className="h-2.5 w-2.5" />
                {t('status.archived')}
              </Badge>
            )}
            {/* Execution phase badge - shown when actively running */}
            {hasActiveExecution && executionPhase && !isStuck && !isIncomplete && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0.5 flex items-center gap-1',
                  EXECUTION_PHASE_BADGE_COLORS[executionPhase]
                )}
              >
                {/* Show spinner for active phases (hasActiveExecution already excludes complete/failed) */}
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                {/* Use contextual labels instead of generic phase labels */}
                {getContextualPhaseLabel(task.status, executionPhase)}
              </Badge>
            )}
            {/* Drift badge - shows when drift warning/critical detected */}
            <DriftBadge taskId={task.id} />
             {/* Status badge - hide when execution phase badge is showing */}
             {!hasActiveExecution && (
               <>
                  {task.status === 'pr_created' ? (
                    <Badge
                      variant={getStatusBadgeVariant(task.status)}
                      className={cn("text-[10px] px-1.5 py-0.5", ANIMATION_CLASSES.statusTransition)}
                    >
                      {getStatusLabel(task.status)}
                    </Badge>
                  ) : (
                   <Badge
                     variant={isStuck ? 'warning' : isIncomplete ? 'warning' : getStatusBadgeVariant(task.status)}
                     className={cn("text-[10px] px-1.5 py-0.5", ANIMATION_CLASSES.statusTransition)}
                   >
                     {isStuck ? t('labels.needsRecovery') : isIncomplete ? t('labels.needsResume') : getStatusLabel(task.status)}
                   </Badge>
                 )}
               </>
             )}
            {/* Review reason badge - explains why task needs human review */}
            {reviewReasonInfo && !isStuck && !isIncomplete && (
              <Badge
                variant={reviewReasonInfo.variant}
                className="text-[10px] px-1.5 py-0.5"
              >
                {reviewReasonInfo.label}
              </Badge>
            )}
            {/* Category badge with icon */}
            {task.metadata?.category && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', TASK_CATEGORY_COLORS[task.metadata.category])}
              >
                {CategoryIcon[task.metadata.category] && (
                  (() => {
                    const Icon = CategoryIcon[task.metadata.category!];
                    return <Icon className="h-2.5 w-2.5 mr-0.5" />;
                  })()
                )}
                {TASK_CATEGORY_LABELS[task.metadata.category]}
              </Badge>
            )}
            {/* Impact badge - high visibility for important tasks */}
            {task.metadata?.impact && (task.metadata.impact === 'high' || task.metadata.impact === 'critical') && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', TASK_IMPACT_COLORS[task.metadata.impact])}
              >
                {TASK_IMPACT_LABELS[task.metadata.impact]}
              </Badge>
            )}
            {/* Complexity badge */}
            {task.metadata?.complexity && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', TASK_COMPLEXITY_COLORS[task.metadata.complexity])}
              >
                {TASK_COMPLEXITY_LABELS[task.metadata.complexity]}
              </Badge>
            )}
            {/* Priority badge - only show urgent/high */}
            {task.metadata?.priority && (task.metadata.priority === 'urgent' || task.metadata.priority === 'high') && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', TASK_PRIORITY_COLORS[task.metadata.priority])}
              >
                {TASK_PRIORITY_LABELS[task.metadata.priority]}
              </Badge>
            )}
            {/* Security severity - always show */}
            {task.metadata?.securitySeverity && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', TASK_IMPACT_COLORS[task.metadata.securitySeverity])}
              >
                {task.metadata.securitySeverity} {t('metadata.severity')}
              </Badge>
            )}
          </div>
        )}

        {/* Progress section - Phase-aware with animations */}
        {(task.subtasks.length > 0 || hasActiveExecution || isRunning || isStuck) && (
          <div className="mt-4">
            <PhaseProgressIndicator
              phase={executionPhase}
              subtasks={task.subtasks}
              phaseProgress={task.executionProgress?.phaseProgress}
              isStuck={isStuck}
              isRunning={isRunning}
            />
          </div>
        )}

        {/* METRICS-1C: Duration breakdown for completed tasks */}
        {task.status === 'done' && task.durations && task.durations.total_ai_ms && task.durations.total_ai_ms > 0 && (
          <DurationBreakdown durations={task.durations} />
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              {/* METRICS-1B: Show elapsed time when running, otherwise show relative time */}
              {hasActiveAgent && elapsedTime !== null ? (
                <span className="text-primary font-medium">{formatDurationShort(elapsedTime)}</span>
              ) : task.status === 'done' && task.executionProgress?.startedAt ? (
                <span>{t('labels.completed')}</span>
              ) : (
                <span>{relativeTime}</span>
              )}
            </div>
            {/* UX-7: ETA display for running tasks with progress */}
            {hasActiveAgent && elapsedTime !== null && task.subtasks.length > 0 && (() => {
              const progress = calculateProgress(task.subtasks);
              if (progress > 0 && progress < 100 && task.executionProgress?.startedAt) {
                const startTime = new Date(task.executionProgress.startedAt);
                const eta = formatETA(estimateRemainingTime(startTime, progress));
                if (eta) {
                  return (
                    <span className="text-muted-foreground/80 italic">{eta}</span>
                  );
                }
              }
              return null;
            })()}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Action buttons */}
            {isStuck ? (
              <Button
                variant="warning"
                size="sm"
                className="h-7 px-2.5"
                onClick={handleRecover}
                disabled={isRecovering}
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    {t('labels.recovering')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    {t('actions.recover')}
                  </>
                )}
              </Button>
            ) : isIncomplete ? (
              <Button
                variant="default"
                size="sm"
                className="h-7 px-2.5"
                onClick={handleStartStop}
              >
                <Play className="mr-1.5 h-3 w-3" />
                {t('actions.resume')}
              </Button>
            ) : task.status === 'pr_created' ? (
              <div className="flex gap-1">
                {task.metadata?.prUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 cursor-pointer"
                    onClick={handleViewPR}
                    title={t('tooltips.viewPR')}
                  >
                    <GitPullRequest className="h-3 w-3" />
                  </Button>
                )}
                {!task.metadata?.archivedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 cursor-pointer"
                    onClick={handleArchive}
                    title={t('tooltips.archiveTask')}
                  >
                    <Archive className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ) : task.status === 'done' && !task.metadata?.archivedAt ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 hover:bg-muted-foreground/10"
                onClick={handleArchive}
                title={t('tooltips.archiveTask')}
              >
                <Archive className="mr-1.5 h-3 w-3" />
                {t('actions.archive')}
              </Button>
            ) : isPlanning ? (
              // Phase 2: Planning tasks - show Stop while agent runs, Start Build only when spec is ready
              // FIX-14: "Start Build" only shown when agent is stopped (spec may be ready)
              <div className="flex items-center gap-1">
                {isAgentStopped ? (
                  // Agent was stopped - show Resume + Start Build (spec may be ready)
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        startTask(task.id);
                      }}
                      title={t('tooltips.resumePlanningAgent')}
                    >
                      <Play className="mr-1.5 h-3 w-3" />
                      {t('actions.resume')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isBlocked) {
                          startBuild(task.id);
                        }
                      }}
                      disabled={isBlocked}
                      title={isBlocked
                        ? t('tasks:dependencies.blockedTooltip', {
                            defaultValue: 'Cannot start: waiting for dependencies to complete'
                          })
                        : t('tooltips.startBuild')
                      }
                    >
                      {isBlocked ? (
                        <>
                          <Link2 className="mr-1.5 h-3 w-3" />
                          {t('tasks:dependencies.blocked', { defaultValue: 'Blocked' })}
                        </>
                      ) : (
                        <>
                          <Play className="mr-1.5 h-3 w-3" />
                          {t('actions.startBuild')}
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  // Agent is running - show Stop button only (no Start Build during active planning)
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      stopTask(task.id);
                    }}
                    title={t('tooltips.stopPlanningAgent')}
                  >
                    <Square className="mr-1.5 h-3 w-3" />
                    {t('actions.stop')}
                  </Button>
                )}
              </div>
            ) : task.status === 'coding' && (
              <Button
                variant={isRunning ? 'destructive' : 'default'}
                size="sm"
                className="h-7 px-2.5"
                onClick={handleStartStop}
              >
                {isRunning ? (
                  <>
                    <Square className="mr-1.5 h-3 w-3" />
                    {t('actions.stop')}
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-3 w-3" />
                    {isAgentStopped ? t('actions.resume') : t('actions.run')}
                  </>
                )}
              </Button>
            )}

            {/* View Terminal button - show for active task statuses */}
            {/* TERM-4b: Added status indicator dot next to terminal button */}
            {(task.status === 'coding' || task.status === 'ai_review' || task.status === 'human_review' || task.status === 'planning') && (
              <>
                <Button
                  variant={isTerminalExpanded ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 cursor-pointer"
                  onClick={handleViewTerminal}
                  title={t('tooltips.viewTerminal')}
                >
                  {/* TERM-4b: Status indicator dot */}
                  <span className={cn(
                    "w-2 h-2 rounded-full mr-1.5",
                    // Green = actively running (coding/planning with agent running)
                    hasActiveAgent && !isStuck ? "bg-green-500 animate-pulse" :
                    // Red = error/stuck state
                    isStuck ? "bg-red-500" :
                    // Yellow = needs attention (human_review, ai_review)
                    (task.status === 'human_review' || task.status === 'ai_review') ? "bg-yellow-500" :
                    // Gray = idle (stopped but has terminal)
                    "bg-gray-400"
                  )} />
                  <TerminalSquare className="h-3 w-3 mr-1" />
                  {isTerminalExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </Button>
                {/* FIX-29b: Pop out button to open in bottom panel */}
                {onOpenBottomPanel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBottomPanel(task.id, task.title);
                    }}
                    title={t('tooltips.popOutTerminal', { defaultValue: 'Open in bottom panel' })}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </>
            )}

          </div>
        </div>
        {/* Close content wrapper for selectable mode */}
        </div>
        {/* Close flex container for selectable mode */}
        </div>

        {/* FIX-29a: Compact terminal preview (always visible for running tasks) */}
        {hasActiveAgent && !isTerminalExpanded && (
          <div onClick={(e) => e.stopPropagation()}>
            <CompactTerminalPreview taskId={task.id} />
          </div>
        )}

        {/* FIX-21: Inline terminal expansion */}
        {isTerminalExpanded && (
          <div
            className="mt-4 border-t border-border pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-64 rounded-lg overflow-hidden bg-card/50 border border-border">
              {taskTerminal ? (
                <TaskMonitorChat
                  terminal={taskTerminal}
                  terminalRef={terminalRef}
                  isActive={true}
                  isMinimized={false}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('terminal.waitingForOutput')}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}, taskCardPropsAreEqual);
