/**
 * Phase Event Protocol Constants
 * ===============================
 * Single source of truth for execution phase communication between
 * Python backend and TypeScript frontend.
 *
 * SYNC REQUIREMENT: Phase values must match apps/backend/core/phase_event.py
 *
 * Protocol: __EXEC_PHASE__:{"phase":"coding","message":"Starting"}
 */

// Protocol marker prefix - must match Python's PHASE_MARKER_PREFIX
export const PHASE_MARKER_PREFIX = '__EXEC_PHASE__:' as const;

// Protocol version for future compatibility checks
export const PHASE_PROTOCOL_VERSION = '1.0.0' as const;

/**
 * All execution phases in order of progression.
 * Order matters for regression detection.
 *
 * 'idle' is frontend-only (initial state before any backend events)
 * 'rate_limit_paused' and 'auth_failure_paused' are pause states that
 * can occur during coding and will resume to coding when resolved.
 */
export const EXECUTION_PHASES = [
  'idle',
  'planning',
  'coding',
  'rate_limit_paused',
  'auth_failure_paused',
  'qa_review',
  'qa_fixing',
  'complete',
  'failed'
] as const;

/**
 * Phases that can be emitted by the Python backend.
 * Subset of EXECUTION_PHASES (excludes 'idle')
 */
export const BACKEND_PHASES = [
  'planning',
  'coding',
  'rate_limit_paused',
  'auth_failure_paused',
  'qa_review',
  'qa_fixing',
  'complete',
  'failed'
] as const;

// Types derived from constants (single source of truth)
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];
export type BackendPhase = (typeof BACKEND_PHASES)[number];

/**
 * Phases that can be completed and tracked in completedPhases array.
 * Excludes 'idle', 'complete', and 'failed' which are not completable workflow phases.
 */
export type CompletablePhase = 'planning' | 'coding' | 'qa_review' | 'qa_fixing';

/**
 * Phase ordering index for regression detection.
 * Higher index = later in the pipeline.
 * Used to prevent fallback text matching from regressing phases.
 *
 * Pause phases (rate_limit_paused, auth_failure_paused) are at the same
 * level as coding since they pause during coding and resume to coding.
 */
export const PHASE_ORDER_INDEX: Readonly<Record<ExecutionPhase, number>> = {
  idle: -1,
  planning: 0,
  coding: 1,
  rate_limit_paused: 1,  // Same level as coding (pause during coding)
  auth_failure_paused: 1,  // Same level as coding (pause during coding)
  qa_review: 2,
  qa_fixing: 3,
  complete: 4,
  failed: 99
} as const;

/**
 * Terminal phases that cannot be changed by fallback text matching.
 * Only structured events can transition away from these.
 */
export const TERMINAL_PHASES: ReadonlySet<ExecutionPhase> = new Set(['complete', 'failed']);

/**
 * Pause phases that represent temporary paused states during execution.
 * These phases will eventually resume to their previous active phase.
 */
export const PAUSE_PHASES: ReadonlySet<ExecutionPhase> = new Set(['rate_limit_paused', 'auth_failure_paused']);

/**
 * Check if a phase is a pause state.
 *
 * @param phase - The phase to check
 * @returns true if the phase is a pause state (rate_limit_paused or auth_failure_paused)
 */
export function isPausePhase(phase: ExecutionPhase): boolean {
  return PAUSE_PHASES.has(phase);
}

/**
 * Check if a phase transition would be a regression.
 * Used to prevent fallback text matching from going backwards.
 *
 * @param currentPhase - The current phase
 * @param newPhase - The proposed new phase
 * @returns true if transitioning to newPhase would be a regression
 */
export function wouldPhaseRegress(currentPhase: ExecutionPhase, newPhase: ExecutionPhase): boolean {
  const currentIndex = PHASE_ORDER_INDEX[currentPhase];
  const newIndex = PHASE_ORDER_INDEX[newPhase];
  return newIndex < currentIndex;
}

/**
 * Check if a phase is a terminal state.
 *
 * @param phase - The phase to check
 * @returns true if the phase is terminal (complete or failed)
 */
export function isTerminalPhase(phase: ExecutionPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/**
 * Validate that a string is a valid backend phase.
 *
 * @param value - The string to validate
 * @returns true if the value is a valid BackendPhase
 */
export function isValidBackendPhase(value: string): value is BackendPhase {
  return (BACKEND_PHASES as readonly string[]).includes(value);
}

/**
 * Validate that a string is a valid execution phase.
 *
 * @param value - The string to validate
 * @returns true if the value is a valid ExecutionPhase
 */
export function isValidExecutionPhase(value: string): value is ExecutionPhase {
  return (EXECUTION_PHASES as readonly string[]).includes(value);
}

/**
 * FIX (ACS-203): Validate that a phase transition is valid based on completed phases.
 * This prevents multiple phases from being active simultaneously.
 *
 * Phase transition rules:
 * - 'idle' can transition to any phase
 * - 'planning' can transition to 'coding' (once planning is in completedPhases)
 * - 'coding' can transition to 'qa_review' (once coding is in completedPhases)
 * - 'qa_review' can transition to 'qa_fixing' or 'complete'
 * - 'qa_fixing' can transition to 'qa_review' or 'complete'
 * - 'complete' and 'failed' are terminal (no transitions out)
 *
 * @param currentPhase - The current phase
 * @param newPhase - The proposed new phase
 * @param completedPhases - Array of phases that have completed
 * @returns true if the transition is valid, false otherwise
 */
export function isValidPhaseTransition(
  currentPhase: ExecutionPhase,
  newPhase: ExecutionPhase,
  completedPhases: CompletablePhase[] = []
): boolean {
  // Terminal phases can't transition to anything else
  if (isTerminalPhase(currentPhase)) {
    return false;
  }

  // idle can transition to any active phase
  if (currentPhase === 'idle') {
    return BACKEND_PHASES.includes(newPhase as BackendPhase);
  }

  // Same phase is always valid (progress update within phase)
  if (currentPhase === newPhase) {
    return true;
  }

  // Define expected previous phases for each transition
  const phasePrerequisites: Record<ExecutionPhase, CompletablePhase[]> = {
    idle: [],
    planning: [],
    coding: ['planning'],
    rate_limit_paused: [],  // Can pause from coding
    auth_failure_paused: [],  // Can pause from coding
    qa_review: ['coding'],
    qa_fixing: ['qa_review'],
    complete: ['qa_review', 'qa_fixing'],
    failed: []  // Can enter failed from any phase
  };

  // Check if the prerequisite phase has been completed
  const prerequisites = phasePrerequisites[newPhase];

  // Special cases that don't require prerequisites:
  // - Can go to failed from any phase (error handling)
  // - Can go from qa_fixing back to qa_review (re-running QA after fixes)
  // - Can go from coding to pause phases (rate limit or auth failure)
  // - Can go from pause phases back to coding (resuming after pause)
  if (newPhase === 'failed') {
    return true;
  }
  if (currentPhase === 'qa_fixing' && newPhase === 'qa_review') {
    return true; // Re-running QA after fixes
  }
  if (currentPhase === 'coding' && isPausePhase(newPhase)) {
    return true; // Pausing during coding
  }
  if (isPausePhase(currentPhase) && newPhase === 'coding') {
    return true; // Resuming coding after pause
  }

  // For all other transitions, verify prerequisites are met
  if (prerequisites.length === 0) {
    return true; // No prerequisites needed
  }

  // Check if at least one prerequisite phase has been completed
  const hasCompletedPrerequisite = prerequisites.some(p => completedPhases.includes(p));

  if (!hasCompletedPrerequisite) {
    console.warn(`[isValidPhaseTransition] Blocked transition ${currentPhase} -> ${newPhase}: prerequisite phases not completed`, {
      required: prerequisites,
      completed: completedPhases
    });
    return false;
  }

  return true;
}

/**
 * Get the expected previous phase for a given phase.
 * Used to validate that phase transitions follow the expected workflow.
 *
 * @param phase - The phase to get the prerequisite for
 * @returns The expected previous phase, or null if no prerequisite
 */
export function getExpectedPreviousPhase(phase: ExecutionPhase): ExecutionPhase | null {
  const previousPhases: Record<ExecutionPhase, ExecutionPhase | null> = {
    idle: null,
    planning: 'idle',
    coding: 'planning',
    rate_limit_paused: 'coding',  // Pause from coding
    auth_failure_paused: 'coding',  // Pause from coding
    qa_review: 'coding',
    qa_fixing: 'qa_review',
    complete: 'qa_review',
    failed: null  // Can fail from any phase
  };
  return previousPhases[phase];
}
