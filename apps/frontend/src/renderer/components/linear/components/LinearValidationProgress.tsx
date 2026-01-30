import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Search, CheckCircle2, AlertCircle, Clock, Tag, TrendingUp, Settings, Square, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';

interface LinearValidationProgressProps {
	/** Current validation phase */
	phase: string;
	/** Progress percentage (0-100) */
	progress: number;
	/** Current activity message */
	message: string;
	/** Error message if validation failed */
	error?: string;
	/** Timestamp when validation started */
	startedAt?: Date;
	/** Timestamp of last activity */
	lastActivityAt?: Date;
	/** Total number of steps */
	totalSteps?: number;
	/** Current step number */
	currentStep?: number;
	/** Current tool being executed (e.g., "Grep", "Read") */
	currentTool?: string;
	/** Status of current tool (running, complete, error) */
	toolStatus?: 'running' | 'complete' | 'error';
	/** Callback for stop/cancel button */
	onStop?: () => void | Promise<void>;
}

/**
 * Formats elapsed time in seconds into MM:SS or H:MM:SS format
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
 * Formats a timestamp into relative time (e.g., "5s ago", "2m ago")
 */
function formatTimeAgo(timestamp: Date | string | undefined): string {
	if (!timestamp) return '';
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	const now = new Date();
	const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

	if (diffSecs < 5) return 'just now';
	if (diffSecs < 60) return `${diffSecs}s ago`;
	const diffMins = Math.floor(diffSecs / 60);
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d ago`;
}

/**
 * Hook to detect user's reduced motion preference
 */
function useReducedMotion(): boolean {
	const [reducedMotion, setReducedMotion] = useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const handleChange = (event: MediaQueryListEvent) => {
			setReducedMotion(event.matches);
		};
		mediaQuery.addEventListener('change', handleChange);
		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	}, []);

	return reducedMotion;
}

/**
 * Phase configuration for Linear validation
 */
const PHASE_CONFIG = {
	initialization: {
		labelKey: 'linear:progressPhases.initialization',
		icon: Loader2,
		color: 'bg-gray-500',
		bgColor: 'bg-gray-500/20',
	},
	content_analysis: {
		labelKey: 'linear:progressPhases.content_analysis',
		icon: FileText,
		color: 'bg-amber-500',
		bgColor: 'bg-amber-500/20',
	},
	codebase_search: {
		labelKey: 'linear:progressPhases.codebase_search',
		icon: Search,
		color: 'bg-blue-500',
		bgColor: 'bg-blue-500/20',
	},
	ai_analysis_start: {
		labelKey: 'linear:progressPhases.ai_analysis_start',
		icon: Loader2,
		color: 'bg-purple-500',
		bgColor: 'bg-purple-500/20',
	},
	completeness_check: {
		labelKey: 'linear:progressPhases.completeness_check',
		icon: CheckCircle2,
		color: 'bg-info',
		bgColor: 'bg-info/20',
	},
	labels_selection: {
		labelKey: 'linear:progressPhases.labels_selection',
		icon: Tag,
		color: 'bg-teal-500',
		bgColor: 'bg-teal-500/20',
	},
	version_calculation: {
		labelKey: 'linear:progressPhases.version_calculation',
		icon: TrendingUp,
		color: 'bg-indigo-500',
		bgColor: 'bg-indigo-500/20',
	},
	properties_recommendation: {
		labelKey: 'linear:progressPhases.properties_recommendation',
		icon: Settings,
		color: 'bg-primary',
		bgColor: 'bg-primary/20',
	},
	ai_analysis_complete: {
		labelKey: 'linear:progressPhases.ai_analysis_complete',
		icon: CheckCircle2,
		color: 'bg-success',
		bgColor: 'bg-success/20',
	},
	complete: {
		labelKey: 'linear:progressPhases.complete',
		icon: CheckCircle2,
		color: 'bg-success',
		bgColor: 'bg-success/20',
	},
	error: {
		labelKey: 'linear:progressPhases.error',
		icon: AlertCircle,
		color: 'bg-destructive',
		bgColor: 'bg-destructive/20',
	},
};

// Validation steps shown in the stepper
const VALIDATION_STEPS: { key: string; labelKey: string; icon: typeof FileText }[] = [
	{ key: 'content_analysis', labelKey: 'linear:validationSteps.analyze', icon: FileText },
	{ key: 'codebase_search', labelKey: 'linear:validationSteps.codebase', icon: Search },
	{ key: 'completeness_check', labelKey: 'linear:validationSteps.completeness', icon: CheckCircle2 },
	{ key: 'labels_selection', labelKey: 'linear:validationSteps.labels', icon: Tag },
	{ key: 'version_calculation', labelKey: 'linear:validationSteps.version', icon: TrendingUp },
	{ key: 'properties_recommendation', labelKey: 'linear:validationSteps.properties', icon: Settings },
];

/**
 * Heartbeat animation indicator showing the process is alive
 */
function HeartbeatIndicator({
	isActive,
	reducedMotion,
	color,
	processingLabel,
	tooltipText,
}: {
	isActive: boolean;
	reducedMotion: boolean;
	color: string;
	processingLabel: string;
	tooltipText: string;
}) {
	if (!isActive) return null;

	const heartbeatAnimation = reducedMotion
		? { scale: 1, opacity: 1 }
		: {
				scale: [1, 1.05, 1],
				opacity: [0.7, 1, 0.7],
			};

	const heartbeatTransition = reducedMotion
		? { duration: 0 }
		: {
				duration: 2,
				repeat: Infinity,
				ease: 'easeInOut' as const,
			};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<motion.div
					className="flex items-center gap-1.5 cursor-help"
					animate={heartbeatAnimation}
					transition={heartbeatTransition}
				>
					<div className={cn('h-2 w-2 rounded-full', color)} />
					<span className="text-xs text-muted-foreground">{processingLabel}</span>
				</motion.div>
			</TooltipTrigger>
			<TooltipContent>{tooltipText}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Phase steps indicator showing validation progress
 */
function ValidationStepsIndicator({
	currentPhase,
	reducedMotion,
	t,
}: {
	currentPhase: string;
	reducedMotion: boolean;
	t: (key: string) => string;
}) {
	// Map phase to step index
	const phaseToStepIndex: Record<string, number> = {
		initialization: -1, // Before first step
		content_analysis: 0, // Step 1: Analyze
		codebase_search: 1, // Step 2: Codebase
		completeness_check: 2, // Step 3: Completeness
		labels_selection: 3, // Step 4: Labels
		version_calculation: 4, // Step 5: Version
		properties_recommendation: 5, // Step 6: Properties
		complete: 6, // All steps complete
		error: -1,
	};

	const currentStepIndex = phaseToStepIndex[currentPhase] ?? 0;

	const getStepState = (
		stepIndex: number,
	): 'pending' | 'active' | 'complete' | 'error' => {
		if (currentPhase === 'error') return 'error';
		if (currentPhase === 'complete') return 'complete';
		if (stepIndex === currentStepIndex) return 'active';
		if (stepIndex < currentStepIndex) return 'complete';
		return 'pending';
	};

	const getStepAnimation = (state: string) => {
		if (state !== 'active') return { opacity: 1 };
		return reducedMotion ? { opacity: 1 } : { opacity: [1, 0.6, 1] };
	};

	const getStepTransition = (state: string) => {
		if (state !== 'active' || reducedMotion) return undefined;
		return { duration: 1.5, repeat: Infinity, ease: 'easeInOut' as const };
	};

	return (
		<div className="flex items-center justify-center gap-1 mt-4">
			{VALIDATION_STEPS.map((step, index) => {
				const state = getStepState(index);
				const StepIcon = step.icon;

				return (
					<div key={step.key} className="flex items-center">
						<motion.div
							className={cn(
								'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
								state === 'complete' && 'bg-success/10 text-success',
								state === 'active' && 'bg-primary/10 text-primary',
								state === 'error' && 'bg-destructive/10 text-destructive',
								state === 'pending' && 'bg-muted text-muted-foreground',
							)}
							animate={getStepAnimation(state)}
							transition={getStepTransition(state)}
						>
							{state === 'complete' ? (
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
							) : state === 'active' ? (
								<StepIcon className="h-3 w-3" />
							) : null}
							<span className="hidden sm:inline">{t(step.labelKey)}</span>
						</motion.div>
						{index < VALIDATION_STEPS.length - 1 && (
							<div
								className={cn(
									'w-4 h-px mx-1',
									getStepState(index + 1) !== 'pending'
										? 'bg-success/50'
										: 'bg-border',
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
 * Streamlined validation progress component for Linear ticket validation.
 * Shows a clean, minimal progress view during scanning/validation phase.
 * Replicates the roadmap progress pattern with heartbeat indicator, phase stepper, and elapsed time.
 */
export function LinearValidationProgress({
	phase,
	progress,
	message,
	error,
	startedAt,
	lastActivityAt,
	totalSteps = 7,
	currentStep = 0,
	currentTool,
	toolStatus,
	onStop,
}: LinearValidationProgressProps) {
	const { t } = useTranslation(['linear', 'common']);
	const reducedMotion = useReducedMotion();
	const [isStopping, setIsStopping] = useState(false);
	const [elapsedTime, setElapsedTime] = useState(0);
	const [lastActivityDisplay, setLastActivityDisplay] = useState('');

	// Use a ref to track the initial start time so the timer doesn't reset on phase changes
	const initialStartTimeRef = useRef<Date | null>(null);

	// On first mount or when startedAt changes, set the initial start time
	useEffect(() => {
		if (startedAt && !initialStartTimeRef.current) {
			initialStartTimeRef.current = startedAt instanceof Date ? startedAt : new Date(startedAt);
		}
	}, [startedAt]);

	// Calculate elapsed time using the stable initial start time
	const calculateElapsedTime = useCallback(() => {
		const startTime = initialStartTimeRef.current;
		if (!startTime) return 0;
		return Math.floor((Date.now() - startTime.getTime()) / 1000);
	}, []);

	// Update elapsed time every second
	useEffect(() => {
		if (!initialStartTimeRef.current) return;
		setElapsedTime(calculateElapsedTime());
		const interval = setInterval(() => {
			setElapsedTime(calculateElapsedTime());
		}, 1000);
		return () => clearInterval(interval);
	}, [calculateElapsedTime]);

	// Update last activity display periodically for relative time
	useEffect(() => {
		const isActivePhase = phase !== 'complete' && phase !== 'error';

		if (!isActivePhase || !lastActivityAt) {
			setLastActivityDisplay('');
			return;
		}

		setLastActivityDisplay(formatTimeAgo(lastActivityAt));

		const intervalId = setInterval(() => {
			setLastActivityDisplay(formatTimeAgo(lastActivityAt));
		}, 5000);

		return () => {
			clearInterval(intervalId);
		};
	}, [phase, lastActivityAt]);

	// Handle stop button click
	const handleStopClick = async () => {
		if (!onStop || isStopping) return;

		setIsStopping(true);
		try {
			await onStop();
		} catch (err) {
			console.error('Failed to stop validation:', err);
		} finally {
			setIsStopping(false);
		}
	};

	// Get phase config (fallback to initialization for unknown phases)
	const config = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] || PHASE_CONFIG.initialization;
	const Icon = config.icon;
	const isComplete = phase === 'complete';
	const isError = phase === 'error' || !!error;
	const isActive = !isComplete && !isError;

	// Animation values that respect reduced motion preference
	const pulseAnimation = reducedMotion
		? {}
		: {
				scale: [1, 1.1, 1],
				opacity: [1, 0.8, 1],
			};

	const pulseTransition = reducedMotion
		? { duration: 0 }
		: {
				duration: 1.5,
				repeat: isActive ? Infinity : 0,
				ease: 'easeInOut' as const,
			};

	const dotAnimation = reducedMotion
		? { scale: 1, opacity: 1 }
		: {
				scale: [1, 1.5, 1],
				opacity: [1, 0.5, 1],
			};

	const dotTransition = reducedMotion
		? { duration: 0 }
		: {
				duration: 1,
				repeat: Infinity,
				ease: 'easeInOut' as const,
			};

	const indeterminateAnimation = reducedMotion
		? { x: '150%' }
		: { x: ['-100%', '400%'] };

	const indeterminateTransition = reducedMotion
		? { duration: 0 }
		: {
				duration: 1.5,
				repeat: Infinity,
				ease: 'easeInOut' as const,
			};

	return (
		<div className="space-y-4 p-6 rounded-xl bg-card border">
			{/* Header with Stop button */}
			{isActive && onStop && (
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
								{isStopping ? t('linear:stopping') : t('common:buttons.stop')}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t('linear:stopValidation')}</TooltipContent>
					</Tooltip>
				</div>
			)}

			{/* Main phase display */}
			<div className="flex flex-col items-center text-center space-y-3">
				{/* Animated icon with pulsing animation for active phase */}
				<div className="relative">
					<motion.div
						className={cn('p-4 rounded-full', config.bgColor)}
						animate={isActive ? pulseAnimation : {}}
						transition={pulseTransition}
					>
						<Icon className={cn('h-8 w-8', config.color.replace('bg-', 'text-'))} />
					</motion.div>
					{/* Pulsing activity indicator dot for active phase */}
					{isActive && (
						<motion.div
							className={cn('absolute top-0 right-0 h-3 w-3 rounded-full', config.color)}
							animate={dotAnimation}
							transition={dotTransition}
						/>
					)}
				</div>

				{/* Phase label and message */}
				<AnimatePresence mode="wait">
					<motion.div
						key={phase}
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2 }}
						className="space-y-1"
					>
						<h3 className="text-lg font-semibold">{t(config.labelKey)}</h3>
						<p className="text-sm text-muted-foreground">{message}</p>
					</motion.div>
				</AnimatePresence>
			</div>

			{/* Progress bar */}
			{isActive && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">{t('linear:progress')}</span>
							{startedAt && (
								<div className="flex items-center gap-1 text-xs text-muted-foreground">
									<Clock className="h-3 w-3" />
									<span className="tabular-nums">{formatElapsedTime(elapsedTime)}</span>
								</div>
							)}
							{lastActivityDisplay && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="text-xs text-muted-foreground/70 cursor-help">
											· {lastActivityDisplay}
										</span>
									</TooltipTrigger>
									<TooltipContent>{t('linear:lastProgressUpdateTooltip')}</TooltipContent>
								</Tooltip>
							)}
						</div>
						<div className="flex items-center gap-3">
							<HeartbeatIndicator
								isActive={isActive}
								reducedMotion={reducedMotion}
								color={config.color}
								processingLabel={t('linear:processing')}
								tooltipText={t('linear:processActiveTooltip')}
							/>
							<span className="text-xs font-medium">
								{currentStep > 0 ? `${currentStep}/${totalSteps}` : `${Math.round(progress)}%`}
							</span>
						</div>
					</div>
					<div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
						{progress > 0 ? (
							<motion.div
								className={cn('h-full rounded-full', config.color)}
								initial={{ width: 0 }}
								animate={{ width: `${progress}%` }}
								transition={{ duration: 0.5, ease: 'easeOut' }}
							/>
						) : (
							<motion.div
								className={cn('absolute h-full w-1/3 rounded-full', config.color)}
								animate={indeterminateAnimation}
								transition={indeterminateTransition}
							/>
						)}
					</div>
				</div>
			)}

			{/* Current tool activity display */}
			{isActive && currentTool && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5 bg-muted/50 rounded-md">
					<span>{t('linear:currentTool')}:</span>
					<span className="font-medium text-foreground">{currentTool}</span>
					{toolStatus === 'running' && (
						<span className="ml-2 inline-flex items-center">
							<span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
						</span>
					)}
				</div>
			)}

			{/* Phase steps indicator */}
			<ValidationStepsIndicator currentPhase={phase} reducedMotion={reducedMotion} t={t} />

			{/* Error display */}
			{error && (
				<motion.div
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					className="p-3 bg-destructive/10 rounded-md"
				>
					<div className="flex items-start gap-2">
						<AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				</motion.div>
			)}
		</div>
	);
}
