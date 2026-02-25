/**
 * Shared XState PR review state utilities.
 *
 * Provides type-safe state names, settled states, and legacy status conversion
 * derived from the PR review machine definition.
 */

/**
 * All XState PR review state names.
 *
 * IMPORTANT: These must match the state keys in pr-review-machine.ts.
 * If you add/remove a state in the machine, update this array.
 */
export const PR_REVIEW_STATE_NAMES = [
  'idle', 'reviewing', 'externalReview', 'completed', 'error'
] as const;

export type PRReviewStateName = typeof PR_REVIEW_STATE_NAMES[number];

/**
 * XState states where the PR review has "settled" — the review lifecycle
 * has reached a terminal or resting state. Progress events should not
 * overwrite these states.
 */
export const PR_REVIEW_SETTLED_STATES: ReadonlySet<string> = new Set<PRReviewStateName>([
  'completed', 'error'
]);

/**
 * Legacy review status values used by the existing Zustand store.
 */
type LegacyPRReviewStatus = 'idle' | 'reviewing' | 'completed' | 'error';

/**
 * Convert XState PR review state to legacy status for backward compatibility.
 */
export function mapPRReviewStateToLegacy(state: string): LegacyPRReviewStatus {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'reviewing':
      return 'reviewing';
    case 'externalReview':
      return 'reviewing';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}
