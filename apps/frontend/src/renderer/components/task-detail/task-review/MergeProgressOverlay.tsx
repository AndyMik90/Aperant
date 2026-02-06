import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FileCode, AlertTriangle, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Progress } from '../../ui/progress';
import { cn } from '../../../lib/utils';
import type { MergeProgress, MergeLogEntry, MergeLogEntryType } from '../../../../shared/types';

interface MergeProgressOverlayProps {
  mergeProgress: MergeProgress | null;
  logEntries: MergeLogEntry[];
}

/** Time in ms without a progress update before showing stalled indicator */
const STALL_THRESHOLD_MS = 30000;

const STAGE_TO_I18N_KEY: Record<string, string> = {
  analyzing: 'stages.analyzing',
  detecting_conflicts: 'stages.detectingConflicts',
  resolving: 'stages.resolving',
  validating: 'stages.validating',
  complete: 'stages.complete',
  error: 'stages.error',
  stalled: 'stages.stalled',
};

const LOG_TYPE_COLORS: Record<MergeLogEntryType, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
};

/**
 * Overlay component displaying real-time merge progress with a progress bar,
 * stage label, conflict counter, current file indicator, and expandable log viewer.
 *
 * Detects stalled merges when no progress update is received for 30+ seconds.
 */
export function MergeProgressOverlay({ mergeProgress, logEntries }: MergeProgressOverlayProps) {
  const { t } = useTranslation(['taskReview']);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset stall timer whenever we receive a new progress update
  const resetStallTimer = useCallback(() => {
    setIsStalled(false);
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
    }
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, STALL_THRESHOLD_MS);
  }, []);

  // Start/reset stall detection when progress updates arrive
  useEffect(() => {
    if (mergeProgress && mergeProgress.stage !== 'complete' && mergeProgress.stage !== 'error') {
      resetStallTimer();
    } else {
      // Clear timer on terminal states
      setIsStalled(false);
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    }
  }, [mergeProgress, resetStallTimer]);

  // Cleanup stall timer on unmount
  useEffect(() => {
    return () => {
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
      }
    };
  }, []);

  // Auto-scroll log viewer to bottom when new entries arrive
  useEffect(() => {
    if (logsExpanded && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logsExpanded]);

  if (!mergeProgress) {
    return null;
  }

  const { stage, percent, message, details } = mergeProgress;
  const isError = stage === 'error';
  const isComplete = stage === 'complete';

  // Use stalled stage label when stalled, otherwise use the current stage
  const effectiveStage = isStalled && !isError && !isComplete ? 'stalled' : stage;
  const stageLabel = STAGE_TO_I18N_KEY[effectiveStage]
    ? t(`taskReview:mergeProgress.${STAGE_TO_I18N_KEY[effectiveStage]}`)
    : message;

  const conflictsFound = details?.conflicts_found ?? 0;
  const conflictsResolved = details?.conflicts_resolved ?? 0;
  const currentFile = details?.current_file;

  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-3',
        isError && 'border-destructive/50 bg-destructive/5',
        isComplete && 'border-success/50 bg-success/5',
        isStalled && !isError && !isComplete && 'border-warning/50 bg-warning/5',
        !isError && !isComplete && !isStalled && 'border-info/50 bg-info/5'
      )}
    >
      {/* Stage label and percentage */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isError ? (
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
          ) : isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          ) : isStalled ? (
            <Clock className="h-4 w-4 text-warning shrink-0" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-info shrink-0" />
          )}
          <span
            className={cn(
              'text-sm font-medium',
              isError && 'text-destructive',
              isComplete && 'text-success',
              isStalled && !isError && !isComplete && 'text-warning'
            )}
          >
            {stageLabel}
          </span>
        </div>
        <span className="text-sm font-semibold tabular-nums">{percent}%</span>
      </div>

      {/* Progress bar */}
      <Progress
        value={percent}
        className={cn(
          'h-2',
          isError && '[&>div]:bg-destructive',
          isComplete && '[&>div]:bg-success',
          isStalled && !isError && !isComplete && '[&>div]:bg-warning',
          !isError && !isComplete && !isStalled && '[&>div]:bg-info'
        )}
        animated={!isError && !isComplete}
      />

      {/* Conflict counter */}
      {conflictsFound > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
          <span>
            {t('taskReview:mergeProgress.conflictCounter', {
              found: conflictsFound,
              resolved: conflictsResolved,
            })}
          </span>
        </div>
      )}

      {/* Current file indicator */}
      {currentFile && !isComplete && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileCode className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono" title={currentFile}>
            {t('taskReview:mergeProgress.currentFile')}: {currentFile}
          </span>
        </div>
      )}

      {/* Completion / error messages */}
      {isComplete && (
        <p className="text-xs text-success">{t('taskReview:mergeProgress.completionMessage')}</p>
      )}
      {isError && (
        <p className="text-xs text-destructive">{t('taskReview:mergeProgress.errorMessage')}</p>
      )}

      {/* Expandable log viewer */}
      {logEntries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {logsExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {logsExpanded
              ? t('taskReview:mergeProgress.hideLogs')
              : t('taskReview:mergeProgress.viewLogs')}
          </button>

          {logsExpanded && (
            <div
              ref={logContainerRef}
              className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-background/50 p-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
            >
              <div className="space-y-1">
                {logEntries.map((entry, idx) => (
                  <div key={idx} className="flex gap-2 text-xs font-mono">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={cn(LOG_TYPE_COLORS[entry.type])}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
