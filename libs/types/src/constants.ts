/**
 * Inline type definitions for constants that originally live in the frontend.
 * These are defined as string union types (not const arrays) to keep the types
 * package free of runtime dependencies.
 *
 * Source of truth:
 * - ExecutionPhase, CompletablePhase → apps/frontend/src/shared/constants/phase-protocol.ts
 * - SupportedLanguage → apps/frontend/src/shared/constants/i18n.ts
 */

/**
 * All execution phases in order of progression.
 * Matches apps/frontend/src/shared/constants/phase-protocol.ts
 */
export type ExecutionPhase =
  | 'idle'
  | 'planning'
  | 'coding'
  | 'rate_limit_paused'
  | 'auth_failure_paused'
  | 'qa_review'
  | 'qa_fixing'
  | 'complete'
  | 'failed';

/**
 * Phases that can be completed and tracked in completedPhases array.
 * Matches apps/frontend/src/shared/constants/phase-protocol.ts
 */
export type CompletablePhase = 'planning' | 'coding' | 'qa_review' | 'qa_fixing';

/**
 * Supported UI languages.
 * Matches apps/frontend/src/shared/constants/i18n.ts
 */
export type SupportedLanguage = 'en' | 'fr';
