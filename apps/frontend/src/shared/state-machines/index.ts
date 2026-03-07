export { taskMachine } from './task-machine';
export type { TaskContext, TaskEvent } from './task-machine';
export {
  TASK_STATE_NAMES,
  XSTATE_SETTLED_STATES,
  XSTATE_ACTIVE_STATES,
  XSTATE_TO_PHASE,
  mapStateToLegacy,
} from './task-state-utils';
export type { TaskStateName } from './task-state-utils';

export { prReviewMachine } from './pr-review-machine';
export type { PRReviewContext, PRReviewEvent } from './pr-review-machine';
export {
  PR_REVIEW_STATE_NAMES,
  PR_REVIEW_SETTLED_STATES,
  mapPRReviewStateToLegacy,
} from './pr-review-state-utils';
export type { PRReviewStateName } from './pr-review-state-utils';

export { terminalMachine } from './terminal-machine';
export type { TerminalContext, TerminalEvent } from './terminal-machine';

export { roadmapGenerationMachine } from './roadmap-generation-machine';
export type {
  RoadmapGenerationContext,
  RoadmapGenerationEvent,
} from './roadmap-generation-machine';

export { roadmapFeatureMachine } from './roadmap-feature-machine';
export type {
  RoadmapFeatureContext,
  RoadmapFeatureEvent,
} from './roadmap-feature-machine';

export {
  GENERATION_STATE_NAMES,
  FEATURE_STATE_NAMES,
  GENERATION_SETTLED_STATES,
  FEATURE_SETTLED_STATES,
  mapGenerationStateToPhase,
  mapFeatureStateToStatus,
} from './roadmap-state-utils';
export type {
  GenerationStateName,
  FeatureStateName,
} from './roadmap-state-utils';
