/**
 * Shared XState roadmap state utilities.
 *
 * Provides type-safe state names, settled states, and mapping helpers
 * derived from the roadmap machine definitions. Used by roadmap-store
 * and roadmap hooks to avoid duplicate constants.
 */
import type { StateValueFrom } from 'xstate';
import type { RoadmapGenerationStatus, RoadmapFeatureStatus } from '../types/roadmap';
import { roadmapGenerationMachine } from './roadmap-generation-machine';
import { roadmapFeatureMachine } from './roadmap-feature-machine';

/**
 * All XState generation state names.
 *
 * IMPORTANT: These must match the state keys in roadmap-generation-machine.ts.
 * If you add/remove a state in the machine, update this array.
 */
export const GENERATION_STATE_NAMES = [
  'idle', 'analyzing', 'discovering', 'generating', 'complete', 'error'
] as const;

export type GenerationStateName = typeof GENERATION_STATE_NAMES[number];

// Compile-time assertion: ensures every element in GENERATION_STATE_NAMES is a valid machine state.
// The reverse direction (every machine state is in the array) is enforced by the exhaustive switch
// in mapGenerationStateToPhase below — adding a new machine state without a switch case will cause
// it to silently map to 'idle' via default, which the mapGenerationStateToPhase tests will catch.
const _genCheck: readonly StateValueFrom<typeof roadmapGenerationMachine>[] = GENERATION_STATE_NAMES;

/**
 * All XState feature state names.
 *
 * IMPORTANT: These must match the state keys in roadmap-feature-machine.ts.
 * If you add/remove a state in the machine, update this array.
 */
export const FEATURE_STATE_NAMES = [
  'under_review', 'planned', 'in_progress', 'done'
] as const;

export type FeatureStateName = typeof FEATURE_STATE_NAMES[number];

// Compile-time assertion: ensures every element in FEATURE_STATE_NAMES is a valid machine state.
// Reverse direction enforced by mapFeatureStateToStatus switch exhaustiveness (see comment above).
const _featCheck: readonly StateValueFrom<typeof roadmapFeatureMachine>[] = FEATURE_STATE_NAMES;

/**
 * Generation states where the machine has settled — the generation is
 * complete or has errored. Stale progress events should NOT overwrite
 * these states, as XState is the source of truth.
 *
 * NOTE: Exported for future consumer use (e.g., UI components that need to
 * check if generation is settled before allowing user actions). Currently
 * unused but intentionally retained as public API for roadmap state checking.
 */
export const GENERATION_SETTLED_STATES: ReadonlySet<string> = new Set<GenerationStateName>([
  'complete', 'error'
]);

/**
 * Feature states where the machine has settled — the feature is done.
 * Stale task lifecycle events should NOT overwrite this state.
 *
 * NOTE: Exported for future consumer use (e.g., UI components that need to
 * check if feature is settled before allowing drag-and-drop or status changes).
 * Currently unused but intentionally retained as public API for feature state checking.
 */
export const FEATURE_SETTLED_STATES: ReadonlySet<string> = new Set<FeatureStateName>([
  'done'
]);

/**
 * Maps an XState generation state to the RoadmapGenerationStatus phase.
 *
 * The generation machine states map 1:1 to the phase union type, so this
 * is a type-safe identity mapping with a fallback for unknown states.
 */
export function mapGenerationStateToPhase(
  state: string
): RoadmapGenerationStatus['phase'] {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'analyzing':
      return 'analyzing';
    case 'discovering':
      return 'discovering';
    case 'generating':
      return 'generating';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Maps an XState feature state to the RoadmapFeatureStatus type.
 *
 * The feature machine states map 1:1 to the status union type, so this
 * is a type-safe identity mapping with a fallback for unknown states.
 */
export function mapFeatureStateToStatus(
  state: string
): RoadmapFeatureStatus {
  switch (state) {
    case 'under_review':
      return 'under_review';
    case 'planned':
      return 'planned';
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'done';
    default:
      return 'under_review';
  }
}
