import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { prFixLoopMachine, type PRFixLoopEvent } from '../pr-fix-loop-machine';

function runEvents(events: PRFixLoopEvent[]) {
  const actor = createActor(prFixLoopMachine);
  actor.start();

  for (const event of events) {
    actor.send(event);
  }

  const snapshot = actor.getSnapshot();
  actor.stop();
  return snapshot;
}

const mockProgress = {
  phase: 'fixing' as const,
  prNumber: 42,
  iteration: 1,
  maxIterations: 3,
  progress: 50,
  message: 'Applying fixes...'
};

const mockResult = {
  state: 'done' as const,
  prNumber: 42,
  projectId: 'proj-1',
  iteration: 1,
  maxIterations: 3,
  completedAt: new Date().toISOString(),
  reason: 'Converged successfully'
};

describe('prFixLoopMachine', () => {
  it('starts in idle state', () => {
    const actor = createActor(prFixLoopMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('transitions into validating on START_FIX_LOOP', () => {
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1', options: { maxIterations: 3 } }
    ]);

    expect(snapshot.value).toBe('validating');
    expect(snapshot.context.prNumber).toBe(42);
    expect(snapshot.context.maxIterations).toBe(3);
  });

  it('tracks phase transitions through active fix loop states', () => {
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'SET_PHASE_PROGRESS', phase: 'fixing', progress: mockProgress, iteration: 1, maxIterations: 3 },
      {
        type: 'SET_PHASE_PROGRESS',
        phase: 'followup_reviewing',
        progress: { ...mockProgress, phase: 'followup_reviewing', progress: 85, message: 'Running follow-up review...' }
      },
      {
        type: 'SET_PHASE_PROGRESS',
        phase: 'judging',
        progress: { ...mockProgress, phase: 'judging', progress: 95, message: 'Judging result...' }
      }
    ]);

    expect(snapshot.value).toBe('judging');
    expect(snapshot.context.progress?.phase).toBe('judging');
  });

  it('transitions to done on FIX_COMPLETE', () => {
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'FIX_COMPLETE', result: mockResult }
    ]);

    expect(snapshot.value).toBe('done');
    expect(snapshot.context.result).toEqual(mockResult);
  });

  it('transitions to handoff_required on FIX_HANDOFF', () => {
    const handoffResult = { ...mockResult, state: 'handoff_required' as const, reason: 'Needs human review' };
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'FIX_HANDOFF', result: handoffResult }
    ]);

    expect(snapshot.value).toBe('handoff_required');
    expect(snapshot.context.result?.state).toBe('handoff_required');
  });

  it('transitions to failed on FIX_FAILED_RESULT', () => {
    const failedResult = {
      ...mockResult,
      state: 'failed' as const,
      reason: 'No convergence',
      error: 'push failed'
    };
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'FIX_FAILED_RESULT', result: failedResult }
    ]);

    expect(snapshot.value).toBe('failed');
    expect(snapshot.context.result?.state).toBe('failed');
    expect(snapshot.context.error).toBe('push failed');
  });

  it('transitions to failed on FIX_ERROR', () => {
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'FIX_ERROR', error: 'runner failed' }
    ]);

    expect(snapshot.value).toBe('failed');
    expect(snapshot.context.error).toBe('runner failed');
  });

  it('transitions to cancelled on FIX_CANCELLED', () => {
    const snapshot = runEvents([
      { type: 'START_FIX_LOOP', prNumber: 42, projectId: 'proj-1' },
      { type: 'FIX_CANCELLED' }
    ]);

    expect(snapshot.value).toBe('cancelled');
    expect(snapshot.context.error).toBe('Fix loop cancelled by user');
  });
});
