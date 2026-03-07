import { assign, createMachine } from 'xstate';
import type { TaskOutcome, RoadmapFeatureStatus } from '../types/roadmap';

export interface RoadmapFeatureContext {
  linkedSpecId?: string;
  taskOutcome?: TaskOutcome;
  previousStatus?: RoadmapFeatureStatus;
}

export type RoadmapFeatureEvent =
  | { type: 'PLAN' }
  | { type: 'START_PROGRESS' }
  | { type: 'MARK_DONE' }
  | { type: 'LINK_SPEC'; specId: string }
  | { type: 'TASK_COMPLETED' }
  | { type: 'TASK_DELETED' }
  | { type: 'TASK_ARCHIVED' }
  | { type: 'REVERT' }
  | { type: 'MOVE_TO_REVIEW' };

export const roadmapFeatureMachine = createMachine(
  {
    id: 'roadmapFeature',
    initial: 'under_review',
    types: {} as {
      context: RoadmapFeatureContext;
      events: RoadmapFeatureEvent;
    },
    context: {
      linkedSpecId: undefined,
      taskOutcome: undefined,
      previousStatus: undefined
    },
    states: {
      under_review: {
        on: {
          PLAN: 'planned',
          START_PROGRESS: 'in_progress',
          LINK_SPEC: {
            target: 'in_progress',
            actions: 'setLinkedSpec'
          },
          MARK_DONE: {
            target: 'done',
            actions: 'savePreviousUnderReview'
          },
          TASK_COMPLETED: {
            target: 'done',
            actions: ['savePreviousUnderReview', 'setTaskOutcomeCompleted']
          },
          TASK_DELETED: {
            target: 'done',
            actions: ['savePreviousUnderReview', 'setTaskOutcomeDeleted']
          },
          TASK_ARCHIVED: {
            target: 'done',
            actions: ['savePreviousUnderReview', 'setTaskOutcomeArchived']
          }
        }
      },
      planned: {
        on: {
          START_PROGRESS: 'in_progress',
          LINK_SPEC: {
            target: 'in_progress',
            actions: 'setLinkedSpec'
          },
          MARK_DONE: {
            target: 'done',
            actions: 'savePreviousPlanned'
          },
          TASK_COMPLETED: {
            target: 'done',
            actions: ['savePreviousPlanned', 'setTaskOutcomeCompleted']
          },
          TASK_DELETED: {
            target: 'done',
            actions: ['savePreviousPlanned', 'setTaskOutcomeDeleted']
          },
          TASK_ARCHIVED: {
            target: 'done',
            actions: ['savePreviousPlanned', 'setTaskOutcomeArchived']
          },
          MOVE_TO_REVIEW: 'under_review'
        }
      },
      in_progress: {
        on: {
          TASK_COMPLETED: {
            target: 'done',
            actions: ['savePreviousInProgress', 'setTaskOutcomeCompleted']
          },
          TASK_DELETED: {
            target: 'done',
            actions: ['savePreviousInProgress', 'setTaskOutcomeDeleted']
          },
          TASK_ARCHIVED: {
            target: 'done',
            actions: ['savePreviousInProgress', 'setTaskOutcomeArchived']
          },
          MARK_DONE: {
            target: 'done',
            actions: 'savePreviousInProgress'
          },
          MOVE_TO_REVIEW: {
            target: 'under_review',
            actions: 'clearDoneContext'
          },
          PLAN: {
            target: 'planned',
            actions: 'clearDoneContext'
          },
          LINK_SPEC: {
            actions: 'setLinkedSpec'
          }
        }
      },
      done: {
        on: {
          REVERT: [
            {
              target: 'in_progress',
              guard: 'previousWasInProgress',
              actions: 'clearDoneContext'
            },
            {
              target: 'planned',
              guard: 'previousWasPlanned',
              actions: 'clearDoneContext'
            },
            {
              target: 'under_review',
              actions: 'clearDoneContext'
            }
          ],
          MARK_DONE: {
            target: 'done'
          },
          TASK_COMPLETED: {
            target: 'done',
            actions: 'setTaskOutcomeCompleted'
          },
          TASK_DELETED: {
            target: 'done',
            actions: 'setTaskOutcomeDeleted'
          },
          TASK_ARCHIVED: {
            target: 'done',
            actions: 'setTaskOutcomeArchived'
          },
          MOVE_TO_REVIEW: {
            target: 'under_review',
            actions: 'clearDoneContext'
          },
          PLAN: {
            target: 'planned',
            actions: 'clearDoneContext'
          },
          START_PROGRESS: {
            target: 'in_progress',
            actions: 'clearDoneContext'
          }
        }
      }
    }
  },
  {
    guards: {
      previousWasInProgress: ({ context }) => context.previousStatus === 'in_progress',
      previousWasPlanned: ({ context }) => context.previousStatus === 'planned'
    },
    actions: {
      setLinkedSpec: assign({
        linkedSpecId: ({ event }) =>
          event.type === 'LINK_SPEC' ? event.specId : undefined
      }),
      savePreviousUnderReview: assign({ previousStatus: () => 'under_review' as const }),
      savePreviousPlanned: assign({ previousStatus: () => 'planned' as const }),
      savePreviousInProgress: assign({ previousStatus: () => 'in_progress' as const }),
      setTaskOutcomeCompleted: assign({ taskOutcome: () => 'completed' as const }),
      setTaskOutcomeDeleted: assign({ taskOutcome: () => 'deleted' as const }),
      setTaskOutcomeArchived: assign({ taskOutcome: () => 'archived' as const }),
      clearDoneContext: assign({
        taskOutcome: () => undefined,
        previousStatus: () => undefined
      })
    }
  }
);
