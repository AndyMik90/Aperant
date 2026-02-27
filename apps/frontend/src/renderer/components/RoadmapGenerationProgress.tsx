import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Users, Sparkles, CheckCircle2, AlertCircle, Square, Clock } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import type { RoadmapGenerationStatus } from '../../shared/types/roadmap';

/**
 * Formats elapsed time in seconds into a human-readable string.
 * Examples: "0:05", "1:23", "12:05", "1:00:05"
 *
 * @param seconds - The elapsed time in seconds
 * @returns Formatted time string (MM:SS or H:MM:SS for >= 1 hour)
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats a timestamp into a human-readable relative time string.
 * Examples: "just now", "5s ago", "2m ago", "1h ago"
 *
 * @param timestamp - The Date object or timestamp to format
 * @returns Formatted relative time string
 */
function formatTimeAgo(timestamp: Date | string | undefined): string {
  if (!timestamp) return '';

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 5) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

interface RoadmapGenerationProgressProps {
  generationStatus: RoadmapGenerationStatus;
  className?: string;
  onStop?: () => void | Promise<void>;
}

// Type for generation phases (excluding idle)
type GenerationPhase = Exclude<RoadmapGenerationStatus['phase'], 'idle'>;

// Phase display configuration (colors and icons only - labels are translated)
const PHASE_CONFIG: Record<
  GenerationPhase,
  {
    labelKey: string;
    descriptionKey: string;
    icon: typeof Search;
    color: string;
    bgColor: string;
  }
> = {
  analyzing: {
    labelKey: 'roadmapProgress.phases.analyzing.label',
    descriptionKey: 'roadmapProgress.phases.analyzing.description',
    icon: Search,
    color: 'bg-amber-500',
    bgColor: 'bg-amber-500/20',
  },
  discovering: {
    labelKey: 'roadmapProgress.phases.discovering.label',
    descriptionKey: 'roadmapProgress.phases.discovering.description',
    icon: Users,
    color: 'bg-info',
    bgColor: 'bg-info/20',
  },
  generating: {
    labelKey: 'roadmapProgress.phases.generating.label',
    descriptionKey: 'roadmapProgress.phases.generating.description',
    icon: Sparkles,
    color: 'bg-primary',
    bgColor: 'bg-primary/20',
  },
  complete: {
    labelKey: 'roadmapProgress.phases.complete.label',
    descriptionKey: 'roadmapProgress.phases.complete.description',
    icon: CheckCircle2,
    color: 'bg-success',
    bgColor: 'bg-success/20',
  },
  error: {
    labelKey: 'roadmapProgress.phases.error.label',
    descriptionKey: 'roadmapProgress.phases.error.description',
    icon: AlertCircle,
    color: 'bg-destructive',
    bgColor: 'bg-destructive/20',
  },
};

// Phases shown in the step indicator (excluding complete and error)
const STEP_PHASES: { key: GenerationPhase; labelKey: string }[] = [
  { key: 'analyzing', labelKey: 'roadmapProgress.steps.analyze' },
  { key: 'discovering', labelKey: 'roadmapProgress.steps.discover' },
  { key: 'generating', labelKey: 'roadmapProgress.steps.generate' },
];

/**
 * Internal component for heartbeat animation indicator.
 * Shows a subtle pulsing animation to indicate the process is alive.
 * Reduced motion is handled via CSS @media (prefers-reduced-motion: reduce).
 */
function HeartbeatIndicator({
  isActive,
  color,
  processingLabel,
  tooltipText,
}: {
  isActive: boolean;
  color: string;
  processingLabel: string;
  tooltipText: string;
}) {
  if (!isActive) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex items-center gap-1.5 cursor-help', 'animate-heartbeat')}>
          <div className={cn('h-2 w-2 rounded-full', color)} />
          <span className="text-xs text-muted-foreground">{processingLabel}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Internal component for showing phase steps indicator
 */
function PhaseStepsIndicator({
  currentPhase,
  t,
}: {
  currentPhase: RoadmapGenerationStatus['phase'];
  t: (key: string) => string;
}) {
  const getPhaseState = (
    phaseKey: GenerationPhase
  ): 'pending' | 'active' | 'complete' | 'error' => {
    const phaseOrder: GenerationPhase[] = ['analyzing', 'discovering', 'generating', 'complete'];
    const currentIndex = phaseOrder.indexOf(currentPhase as GenerationPhase);
    const phaseIndex = phaseOrder.indexOf(phaseKey);

    if (currentPhase === 'error') return 'error';
    if (currentPhase === 'complete') return 'complete';
    if (phaseKey === currentPhase) return 'active';
    if (phaseIndex < currentIndex) return 'complete';
    return 'pending';
  };

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      {STEP_PHASES.map((phase, index) => {
        const state = getPhaseState(phase.key);
        return (
          <div key={phase.key} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
                state === 'complete' && 'bg-success/10 text-success',
                state === 'active' && 'bg-primary/10 text-primary',
                state === 'error' && 'bg-destructive/10 text-destructive',
                state === 'pending' && 'bg-muted text-muted-foreground',
                state === 'active' && 'animate-pulse-opacity'
              )}
            >
              {state === 'complete' && (
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
              {t(phase.labelKey)}
            </div>
            {index < STEP_PHASES.length - 1 && (
              <div
                className={cn(
                  'w-4 h-px mx-1',
                  getPhaseState(STEP_PHASES[index + 1].key) !== 'pending'
                    ? 'bg-success/50'
                    : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Animated progress component for roadmap generation.
 * Displays the current generation phase with animated transitions,
 * progress visualization, and step indicators.
 */
export function RoadmapGenerationProgress({
  generationStatus,
  className,
  onStop
}: RoadmapGenerationProgressProps) {
  const { t } = useTranslation('common');
  const { phase, progress, message, error, startedAt, lastActivityAt } = generationStatus;
  const [isStopping, setIsStopping] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [lastActivityDisplay, setLastActivityDisplay] = useState('');

  /**
   * Calculate elapsed time from startedAt timestamp
   */
  const calculateElapsedTime = useCallback(() => {
    if (!startedAt) return 0;
    const startDate = startedAt instanceof Date ? startedAt : new Date(startedAt);
    const now = new Date();
    return Math.floor((now.getTime() - startDate.getTime()) / 1000);
  }, [startedAt]);

  /**
   * Update elapsed time every second while generation is active
   */
  useEffect(() => {
    // Only track time for active phases (not idle, complete, or error)
    const isActivePhase = phase !== 'idle' && phase !== 'complete' && phase !== 'error';

    if (!isActivePhase || !startedAt) {
      // Reset elapsed time when not active or no start time
      if (phase === 'idle') {
        setElapsedTime(0);
      }
      return;
    }

    // Calculate initial elapsed time
    setElapsedTime(calculateElapsedTime());

    // Set up interval to update every second
    const intervalId = setInterval(() => {
      setElapsedTime(calculateElapsedTime());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [phase, startedAt, calculateElapsedTime]);

  /**
   * Update last activity display periodically for relative time
   */
  useEffect(() => {
    // Only track last activity for active phases
    const isActivePhase = phase !== 'idle' && phase !== 'complete' && phase !== 'error';

    if (!isActivePhase || !lastActivityAt) {
      setLastActivityDisplay('');
      return;
    }

    // Calculate initial display
    setLastActivityDisplay(formatTimeAgo(lastActivityAt));

    // Update every 5 seconds to keep relative time current
    const intervalId = setInterval(() => {
      setLastActivityDisplay(formatTimeAgo(lastActivityAt));
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [phase, lastActivityAt]);

  /**
   * Handle stop button click with error handling and double-click prevention
   */
  const handleStopClick = async () => {
    if (!onStop || isStopping) return;

    setIsStopping(true);
    try {
      await onStop();
    } catch (err) {
      console.error('Failed to stop generation:', err);
    } finally {
      setIsStopping(false);
    }
  };

  // Don't render anything for idle phase
  if (phase === 'idle') {
    return null;
  }

  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const isActivePhase = phase !== 'complete' && phase !== 'error';

  return (
    <div className={cn('space-y-4 p-6 rounded-xl bg-card border', className)}>
      {/* Header with Stop button */}
      {isActivePhase && onStop && (
        <div className="flex justify-end mb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopClick}
                disabled={isStopping}
              >
                <Square className="h-4 w-4 mr-1" />
                {isStopping ? t('roadmapProgress.stopping') : t('buttons.stop')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('roadmapProgress.stopGeneration')}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Main phase display */}
      <div className="flex flex-col items-center text-center space-y-3">
        {/* Animated icon with pulsing animation for active phase */}
        <div className="relative">
          <div className={cn('p-4 rounded-full', config.bgColor, isActivePhase && 'animate-pulse-icon')}>
            <Icon className={cn('h-8 w-8', config.color.replace('bg-', 'text-'))} />
          </div>
          {/* Pulsing activity indicator dot for active phase */}
          {isActivePhase && (
            <div className={cn('absolute top-0 right-0 h-3 w-3 rounded-full', config.color, 'animate-pulse-dot')} />
          )}
        </div>

        {/* Phase label and description */}
        <div key={phase} className="space-y-1 animate-fade-slide-up">
          <h3 className="text-lg font-semibold">{t(config.labelKey)}</h3>
          <p className="text-sm text-muted-foreground">{t(config.descriptionKey)}</p>
          {message && message !== t(config.descriptionKey) && (
            <p className="text-xs text-muted-foreground mt-1">{message}</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActivePhase && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('roadmapProgress.progress')}</span>
              {/* Elapsed time display */}
              {startedAt && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="tabular-nums">{formatElapsedTime(elapsedTime)}</span>
                </div>
              )}
              {/* Last activity display */}
              {lastActivityDisplay && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground/70 cursor-help">
                      · {t('roadmapProgress.lastActivityPrefix')} {lastActivityDisplay}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('roadmapProgress.lastProgressUpdateTooltip')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Heartbeat indicator to show process is alive */}
              <HeartbeatIndicator
                isActive={isActivePhase}
                color={config.color}
                processingLabel={t('roadmapProgress.processing')}
                tooltipText={t('roadmapProgress.processActiveTooltip')}
              />
              <span className="text-xs font-medium">{progress}%</span>
            </div>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
            {progress > 0 ? (
              // Determinate progress bar
              <div
                className={cn('h-full rounded-full', config.color)}
                style={{ width: `${Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0))}%`, transition: 'width 0.5s ease-out' }}
              />
            ) : (
              // Indeterminate progress bar when progress is 0
              <div className={cn('absolute h-full w-1/3 rounded-full', config.color, 'animate-indeterminate')} />
            )}
          </div>
        </div>
      )}

      {/* Phase steps indicator */}
      <PhaseStepsIndicator currentPhase={phase} t={t} />

      {/* Error display - shows whenever error is present, regardless of phase */}
      {error && (
        <div role="alert" aria-live="assertive" aria-atomic="true" className="p-3 bg-destructive/10 rounded-md animate-fade-slide-up">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
