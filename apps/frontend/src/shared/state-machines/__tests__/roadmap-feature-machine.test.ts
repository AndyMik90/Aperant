import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  roadmapFeatureMachine,
  type RoadmapFeatureEvent
} from '../roadmap-feature-machine';

/**
 * Helper to run a sequence of events and get the final snapshot
 */
function runEvents(events: RoadmapFeatureEvent[], initialState?: string) {
  const actor = initialState
    ? createActor(roadmapFeatureMachine, {
        snapshot: roadmapFeatureMachine.resolveState({
          value: initialState,
          context: {}
        })
      })
    : createActor(roadmapFeatureMachine);
  actor.start();

  for (const event of events) {
    actor.send(event);
  }

  const snapshot = actor.getSnapshot();
  actor.stop();
  return snapshot;
}

describe('roadmapFeatureMachine', () => {
  describe('initial state', () => {
    it('should start in under_review state', () => {
      const actor = createActor(roadmapFeatureMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('under_review');
      actor.stop();
    });

    it('should have empty context initially', () => {
      const actor = createActor(roadmapFeatureMachine);
      actor.start();
      const { context } = actor.getSnapshot();
      expect(context.linkedSpecId).toBeUndefined();
      expect(context.taskOutcome).toBeUndefined();
      expect(context.previousStatus).toBeUndefined();
      actor.stop();
    });
  });

  describe('status transitions: under_review → planned → in_progress → done', () => {
    it('should transition under_review → planned via PLAN', () => {
      const snapshot = runEvents([{ type: 'PLAN' }]);
      expect(snapshot.value).toBe('planned');
    });

    it('should transition planned → in_progress via START_PROGRESS', () => {
      const snapshot = runEvents([{ type: 'PLAN' }, { type: 'START_PROGRESS' }]);
      expect(snapshot.value).toBe('in_progress');
    });

    it('should transition in_progress → done via MARK_DONE', () => {
      const snapshot = runEvents([
        { type: 'PLAN' },
        { type: 'START_PROGRESS' },
        { type: 'MARK_DONE' }
      ]);
      expect(snapshot.value).toBe('done');
    });

    it('should transition under_review → in_progress via START_PROGRESS', () => {
      const snapshot = runEvents([{ type: 'START_PROGRESS' }]);
      expect(snapshot.value).toBe('in_progress');
    });

    it('should transition under_review → done via MARK_DONE', () => {
      const snapshot = runEvents([{ type: 'MARK_DONE' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.previousStatus).toBe('under_review');
    });

    it('should transition planned → done via MARK_DONE', () => {
      const snapshot = runEvents([{ type: 'PLAN' }, { type: 'MARK_DONE' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.previousStatus).toBe('planned');
    });

    it('should allow reverse: planned → under_review via MOVE_TO_REVIEW', () => {
      const snapshot = runEvents([{ type: 'PLAN' }, { type: 'MOVE_TO_REVIEW' }]);
      expect(snapshot.value).toBe('under_review');
    });

    it('should allow reverse: in_progress → planned via PLAN', () => {
      const snapshot = runEvents([{ type: 'START_PROGRESS' }, { type: 'PLAN' }]);
      expect(snapshot.value).toBe('planned');
    });

    it('should allow reverse: in_progress → under_review via MOVE_TO_REVIEW', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'MOVE_TO_REVIEW' }
      ]);
      expect(snapshot.value).toBe('under_review');
    });
  });

  describe('LINK_SPEC', () => {
    it('should set linkedSpecId and auto-transition to in_progress from under_review', () => {
      const snapshot = runEvents([{ type: 'LINK_SPEC', specId: 'spec-42' }]);
      expect(snapshot.value).toBe('in_progress');
      expect(snapshot.context.linkedSpecId).toBe('spec-42');
    });

    it('should set linkedSpecId and auto-transition to in_progress from planned', () => {
      const snapshot = runEvents([
        { type: 'PLAN' },
        { type: 'LINK_SPEC', specId: 'spec-99' }
      ]);
      expect(snapshot.value).toBe('in_progress');
      expect(snapshot.context.linkedSpecId).toBe('spec-99');
    });

    it('should update linkedSpecId without changing state when already in_progress', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'LINK_SPEC', specId: 'spec-7' }
      ]);
      expect(snapshot.value).toBe('in_progress');
      expect(snapshot.context.linkedSpecId).toBe('spec-7');
    });

    it('should be ignored from done state (no LINK_SPEC transition defined)', () => {
      const snapshot = runEvents([
        { type: 'MARK_DONE' },
        { type: 'LINK_SPEC', specId: 'spec-1' }
      ]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.linkedSpecId).toBeUndefined();
    });
  });

  describe('TASK_COMPLETED from in_progress', () => {
    it('should transition to done with taskOutcome="completed"', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_COMPLETED' }
      ]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('completed');
      expect(snapshot.context.previousStatus).toBe('in_progress');
    });
  });

  describe('TASK_DELETED from in_progress', () => {
    it('should transition to done with taskOutcome="deleted"', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_DELETED' }
      ]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('deleted');
      expect(snapshot.context.previousStatus).toBe('in_progress');
    });
  });

  describe('TASK_ARCHIVED from in_progress', () => {
    it('should transition to done with taskOutcome="archived"', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_ARCHIVED' }
      ]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('archived');
      expect(snapshot.context.previousStatus).toBe('in_progress');
    });
  });

  describe('REVERT from done', () => {
    it('should revert to in_progress when previousStatus was in_progress', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'MARK_DONE' },
        { type: 'REVERT' }
      ]);
      expect(snapshot.value).toBe('in_progress');
    });

    it('should revert to planned when previousStatus was planned', () => {
      const snapshot = runEvents([
        { type: 'PLAN' },
        { type: 'MARK_DONE' },
        { type: 'REVERT' }
      ]);
      expect(snapshot.value).toBe('planned');
    });

    it('should revert to under_review when previousStatus was under_review', () => {
      const snapshot = runEvents([{ type: 'MARK_DONE' }, { type: 'REVERT' }]);
      expect(snapshot.value).toBe('under_review');
    });

    it('should revert to under_review when no previousStatus is set (fallback)', () => {
      // Use state restoration to put in done without previousStatus
      const actor = createActor(roadmapFeatureMachine, {
        snapshot: roadmapFeatureMachine.resolveState({
          value: 'done',
          context: { previousStatus: undefined }
        })
      });
      actor.start();
      actor.send({ type: 'REVERT' });
      expect(actor.getSnapshot().value).toBe('under_review');
      actor.stop();
    });
  });

  describe('moving away from done clears taskOutcome and previousStatus', () => {
    it('should clear context on REVERT', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_COMPLETED' },
        { type: 'REVERT' }
      ]);
      expect(snapshot.value).toBe('in_progress');
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });

    it('should clear context on MOVE_TO_REVIEW from done', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_COMPLETED' },
        { type: 'MOVE_TO_REVIEW' }
      ]);
      expect(snapshot.value).toBe('under_review');
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });

    it('should clear context on PLAN from done', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_DELETED' },
        { type: 'PLAN' }
      ]);
      expect(snapshot.value).toBe('planned');
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });

    it('should clear context on START_PROGRESS from done', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'TASK_ARCHIVED' },
        { type: 'START_PROGRESS' }
      ]);
      expect(snapshot.value).toBe('in_progress');
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });
  });

  describe('redundant status transitions', () => {
    it('should ignore MOVE_TO_REVIEW when already in under_review (no-op)', () => {
      const actor = createActor(roadmapFeatureMachine);
      actor.start();
      // MOVE_TO_REVIEW is not defined on under_review, so it's ignored
      actor.send({ type: 'MOVE_TO_REVIEW' });
      expect(actor.getSnapshot().value).toBe('under_review');
      actor.stop();
    });

    it('should ignore PLAN when already in planned (no-op)', () => {
      const snapshot = runEvents([{ type: 'PLAN' }, { type: 'PLAN' }]);
      expect(snapshot.value).toBe('planned');
    });

    it('should ignore START_PROGRESS when already in in_progress (no-op)', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'START_PROGRESS' }
      ]);
      expect(snapshot.value).toBe('in_progress');
    });

    it('should handle MARK_DONE in done state (self-transition)', () => {
      const snapshot = runEvents([{ type: 'MARK_DONE' }, { type: 'MARK_DONE' }]);
      expect(snapshot.value).toBe('done');
    });
  });

  describe('task events from various states', () => {
    it('should transition TASK_COMPLETED from under_review to done', () => {
      const snapshot = runEvents([{ type: 'TASK_COMPLETED' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('completed');
      expect(snapshot.context.previousStatus).toBe('under_review');
    });

    it('should transition TASK_DELETED from under_review to done', () => {
      const snapshot = runEvents([{ type: 'TASK_DELETED' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('deleted');
      expect(snapshot.context.previousStatus).toBe('under_review');
    });

    it('should transition TASK_ARCHIVED from under_review to done', () => {
      const snapshot = runEvents([{ type: 'TASK_ARCHIVED' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('archived');
      expect(snapshot.context.previousStatus).toBe('under_review');
    });

    it('should transition TASK_DELETED from planned to done', () => {
      const snapshot = runEvents([{ type: 'PLAN' }, { type: 'TASK_DELETED' }]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('deleted');
      expect(snapshot.context.previousStatus).toBe('planned');
    });

    it('should handle TASK_ARCHIVED from done (update outcome)', () => {
      const snapshot = runEvents([
        { type: 'MARK_DONE' },
        { type: 'TASK_ARCHIVED' }
      ]);
      expect(snapshot.value).toBe('done');
      expect(snapshot.context.taskOutcome).toBe('archived');
    });
  });

  describe('state restoration from snapshot', () => {
    it('should restore to planned state', () => {
      const actor = createActor(roadmapFeatureMachine, {
        snapshot: roadmapFeatureMachine.resolveState({
          value: 'planned',
          context: {}
        })
      });
      actor.start();
      expect(actor.getSnapshot().value).toBe('planned');
      actor.stop();
    });

    it('should restore to in_progress with linkedSpecId', () => {
      const actor = createActor(roadmapFeatureMachine, {
        snapshot: roadmapFeatureMachine.resolveState({
          value: 'in_progress',
          context: { linkedSpecId: 'spec-123' }
        })
      });
      actor.start();
      const { value, context } = actor.getSnapshot();
      expect(value).toBe('in_progress');
      expect(context.linkedSpecId).toBe('spec-123');
      actor.stop();
    });

    it('should restore to done with full context and allow revert', () => {
      const actor = createActor(roadmapFeatureMachine, {
        snapshot: roadmapFeatureMachine.resolveState({
          value: 'done',
          context: {
            linkedSpecId: 'spec-5',
            taskOutcome: 'completed',
            previousStatus: 'in_progress'
          }
        })
      });
      actor.start();
      expect(actor.getSnapshot().value).toBe('done');
      expect(actor.getSnapshot().context.taskOutcome).toBe('completed');

      actor.send({ type: 'REVERT' });
      expect(actor.getSnapshot().value).toBe('in_progress');
      expect(actor.getSnapshot().context.taskOutcome).toBeUndefined();
      actor.stop();
    });
  });

  describe('moving away from in_progress clears context', () => {
    it('should clear taskOutcome and previousStatus when moving to planned', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'PLAN' }
      ]);
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });

    it('should clear taskOutcome and previousStatus when moving to under_review', () => {
      const snapshot = runEvents([
        { type: 'START_PROGRESS' },
        { type: 'MOVE_TO_REVIEW' }
      ]);
      expect(snapshot.context.taskOutcome).toBeUndefined();
      expect(snapshot.context.previousStatus).toBeUndefined();
    });
  });
});
