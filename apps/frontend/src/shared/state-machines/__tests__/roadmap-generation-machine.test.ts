import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActor } from 'xstate';
import {
  roadmapGenerationMachine,
  type RoadmapGenerationEvent,
} from '../roadmap-generation-machine';

/**
 * Helper to run a sequence of events and get the final state
 */
function runEvents(events: RoadmapGenerationEvent[]) {
  const actor = createActor(roadmapGenerationMachine);
  actor.start();

  for (const event of events) {
    actor.send(event);
  }

  const snapshot = actor.getSnapshot();
  actor.stop();
  return snapshot;
}

describe('roadmapGenerationMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in idle state', () => {
      const actor = createActor(roadmapGenerationMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      actor.stop();
    });

    it('should have default context initially', () => {
      const actor = createActor(roadmapGenerationMachine);
      actor.start();
      const snapshot = actor.getSnapshot();
      expect(snapshot.context.progress).toBe(0);
      expect(snapshot.context.message).toBeUndefined();
      expect(snapshot.context.error).toBeUndefined();
      expect(snapshot.context.startedAt).toBeUndefined();
      expect(snapshot.context.completedAt).toBeUndefined();
      actor.stop();
    });
  });

  describe('happy path: idle → analyzing → discovering → generating → complete', () => {
    it('should transition through the standard workflow', () => {
      const events: RoadmapGenerationEvent[] = [
        { type: 'START_GENERATION' },
        { type: 'PROGRESS_UPDATE', progress: 20, message: 'Analyzing...' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'PROGRESS_UPDATE', progress: 50, message: 'Discovering...' },
        { type: 'GENERATION_STARTED' },
        { type: 'PROGRESS_UPDATE', progress: 80, message: 'Generating...' },
        { type: 'GENERATION_COMPLETE' },
      ];

      const snapshot = runEvents(events);
      expect(snapshot.value).toBe('complete');
      expect(snapshot.context.progress).toBe(100);
      expect(snapshot.context.completedAt).toBeDefined();
    });

    it('should transition from idle to analyzing on START_GENERATION', () => {
      const snapshot = runEvents([{ type: 'START_GENERATION' }]);
      expect(snapshot.value).toBe('analyzing');
    });

    it('should transition from analyzing to discovering on DISCOVERY_STARTED', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
      ]);
      expect(snapshot.value).toBe('discovering');
    });

    it('should transition from discovering to generating on GENERATION_STARTED', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
      ]);
      expect(snapshot.value).toBe('generating');
    });

    it('should transition from generating to complete on GENERATION_COMPLETE', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
      ]);
      expect(snapshot.value).toBe('complete');
    });
  });

  describe('PROGRESS_UPDATE updates context in all active states', () => {
    it('should update progress in analyzing state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'PROGRESS_UPDATE', progress: 25, message: 'Analyzing codebase' },
      ]);
      expect(snapshot.value).toBe('analyzing');
      expect(snapshot.context.progress).toBe(25);
      expect(snapshot.context.message).toBe('Analyzing codebase');
    });

    it('should update progress in discovering state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'PROGRESS_UPDATE', progress: 50, message: 'Discovering features' },
      ]);
      expect(snapshot.value).toBe('discovering');
      expect(snapshot.context.progress).toBe(50);
      expect(snapshot.context.message).toBe('Discovering features');
    });

    it('should update progress in generating state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'PROGRESS_UPDATE', progress: 80, message: 'Generating roadmap' },
      ]);
      expect(snapshot.value).toBe('generating');
      expect(snapshot.context.progress).toBe(80);
      expect(snapshot.context.message).toBe('Generating roadmap');
    });
  });

  describe('error flow: GENERATION_ERROR from any active state → error', () => {
    it('should transition to error from analyzing', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'Analysis failed' },
      ]);
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('Analysis failed');
    });

    it('should transition to error from discovering', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_ERROR', error: 'Discovery failed' },
      ]);
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('Discovery failed');
    });

    it('should transition to error from generating', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_ERROR', error: 'Generation failed' },
      ]);
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('Generation failed');
    });

    it('should preserve progress when transitioning to error', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'PROGRESS_UPDATE', progress: 60, message: 'Processing...' },
        { type: 'GENERATION_ERROR', error: 'Something went wrong' },
      ]);
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.progress).toBe(60);
      expect(snapshot.context.error).toBe('Something went wrong');
    });
  });

  describe('stop flow: STOP from analyzing/discovering/generating → idle', () => {
    it('should transition to idle from analyzing on STOP', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'STOP' },
      ]);
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.progress).toBe(0);
      expect(snapshot.context.startedAt).toBeUndefined();
    });

    it('should transition to idle from discovering on STOP', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'STOP' },
      ]);
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.progress).toBe(0);
    });

    it('should transition to idle from generating on STOP', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'STOP' },
      ]);
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.progress).toBe(0);
    });
  });

  describe('RESET from complete/error → idle', () => {
    it('should transition from complete to idle on RESET', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'RESET' },
      ]);
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.progress).toBe(0);
      expect(snapshot.context.completedAt).toBeUndefined();
    });

    it('should transition from error to idle on RESET', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'Some error' },
        { type: 'RESET' },
      ]);
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.error).toBeUndefined();
      expect(snapshot.context.progress).toBe(0);
    });
  });

  describe('guard: START_GENERATION rejected when not idle', () => {
    it('should ignore START_GENERATION in analyzing state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'START_GENERATION' },
      ]);
      expect(snapshot.value).toBe('analyzing');
    });

    it('should ignore START_GENERATION in discovering state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'START_GENERATION' },
      ]);
      expect(snapshot.value).toBe('discovering');
    });

    it('should ignore START_GENERATION in generating state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'START_GENERATION' },
      ]);
      expect(snapshot.value).toBe('generating');
    });

    it('should ignore START_GENERATION in complete state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'START_GENERATION' },
      ]);
      expect(snapshot.value).toBe('complete');
    });

    it('should ignore START_GENERATION in error state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'err' },
        { type: 'START_GENERATION' },
      ]);
      expect(snapshot.value).toBe('error');
    });
  });

  describe('stale events ignored after complete/error', () => {
    it('should ignore PROGRESS_UPDATE in complete state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'PROGRESS_UPDATE', progress: 50, message: 'stale' },
      ]);
      expect(snapshot.value).toBe('complete');
      expect(snapshot.context.progress).toBe(100);
    });

    it('should ignore PROGRESS_UPDATE in error state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'err' },
        { type: 'PROGRESS_UPDATE', progress: 50, message: 'stale' },
      ]);
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.progress).toBe(0);
    });

    it('should ignore STOP in complete state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'STOP' },
      ]);
      expect(snapshot.value).toBe('complete');
    });

    it('should ignore STOP in error state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'err' },
        { type: 'STOP' },
      ]);
      expect(snapshot.value).toBe('error');
    });

    it('should ignore GENERATION_ERROR in complete state', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'GENERATION_ERROR', error: 'late error' },
      ]);
      expect(snapshot.value).toBe('complete');
      expect(snapshot.context.error).toBeUndefined();
    });
  });

  describe('timestamp tracking', () => {
    it('should set startedAt on START_GENERATION', () => {
      const snapshot = runEvents([{ type: 'START_GENERATION' }]);
      expect(snapshot.context.startedAt).toBe(Date.now());
    });

    it('should clear startedAt when returning to idle via STOP', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'STOP' },
      ]);
      expect(snapshot.context.startedAt).toBeUndefined();
    });

    it('should clear startedAt when returning to idle via RESET', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'GENERATION_ERROR', error: 'err' },
        { type: 'RESET' },
      ]);
      expect(snapshot.context.startedAt).toBeUndefined();
    });

    it('should set completedAt on GENERATION_COMPLETE', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
      ]);
      expect(snapshot.context.completedAt).toBe(Date.now());
    });

    it('should clear completedAt on RESET from complete', () => {
      const snapshot = runEvents([
        { type: 'START_GENERATION' },
        { type: 'DISCOVERY_STARTED' },
        { type: 'GENERATION_STARTED' },
        { type: 'GENERATION_COMPLETE' },
        { type: 'RESET' },
      ]);
      expect(snapshot.context.completedAt).toBeUndefined();
    });

    it('should reset startedAt on new START_GENERATION', () => {
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      const actor = createActor(roadmapGenerationMachine);
      actor.start();

      actor.send({ type: 'START_GENERATION' });
      const firstStartedAt = actor.getSnapshot().context.startedAt;

      actor.send({ type: 'GENERATION_ERROR', error: 'err' });
      actor.send({ type: 'RESET' });

      vi.setSystemTime(new Date('2025-01-01T01:00:00Z'));
      actor.send({ type: 'START_GENERATION' });

      const secondStartedAt = actor.getSnapshot().context.startedAt;
      expect(firstStartedAt).toBeDefined();
      expect(secondStartedAt).toBeDefined();
      if (firstStartedAt && secondStartedAt) {
        expect(secondStartedAt).toBeGreaterThan(firstStartedAt);
      }
      actor.stop();
    });
  });

  describe('state restoration from snapshot', () => {
    it('should restore to correct state from snapshot', () => {
      const testStates = ['idle', 'analyzing', 'discovering', 'generating', 'complete', 'error'];

      for (const state of testStates) {
        const actor = createActor(roadmapGenerationMachine, {
          snapshot: roadmapGenerationMachine.resolveState({
            value: state,
            context: {
              progress: 0,
              message: undefined,
              error: undefined,
              startedAt: undefined,
              completedAt: undefined,
            },
          }),
        });
        actor.start();
        expect(actor.getSnapshot().value).toBe(state);
        actor.stop();
      }
    });

    it('should restore context from snapshot', () => {
      const actor = createActor(roadmapGenerationMachine, {
        snapshot: roadmapGenerationMachine.resolveState({
          value: 'generating',
          context: {
            progress: 75,
            message: 'Almost done',
            error: undefined,
            startedAt: 1000,
            completedAt: undefined,
          },
        }),
      });
      actor.start();
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('generating');
      expect(snapshot.context.progress).toBe(75);
      expect(snapshot.context.message).toBe('Almost done');
      expect(snapshot.context.startedAt).toBe(1000);
      actor.stop();
    });
  });
});
