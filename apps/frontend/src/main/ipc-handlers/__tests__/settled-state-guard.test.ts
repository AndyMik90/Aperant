/**
 * Tests for the XState settled-state guard logic used in agent-events-handlers.
 *
 * The guard prevents execution-progress events from overwriting XState's
 * persisted status when the state machine has already settled into a
 * terminal/review state.
 */
import { describe, it, expect } from 'vitest';
import { XSTATE_SETTLED_STATES, XSTATE_TO_PHASE, TASK_STATE_NAMES } from '../../../shared/state-machines';

describe('XSTATE_SETTLED_STATES', () => {
  it('should contain the expected settled states', () => {
    expect(XSTATE_SETTLED_STATES.has('plan_review')).toBe(true);
    expect(XSTATE_SETTLED_STATES.has('human_review')).toBe(true);
    expect(XSTATE_SETTLED_STATES.has('error')).toBe(true);
    expect(XSTATE_SETTLED_STATES.has('creating_pr')).toBe(true);
    expect(XSTATE_SETTLED_STATES.has('pr_created')).toBe(true);
    expect(XSTATE_SETTLED_STATES.has('done')).toBe(true);
  });

  it('should NOT contain active processing states', () => {
    expect(XSTATE_SETTLED_STATES.has('backlog')).toBe(false);
    expect(XSTATE_SETTLED_STATES.has('planning')).toBe(false);
    expect(XSTATE_SETTLED_STATES.has('coding')).toBe(false);
    expect(XSTATE_SETTLED_STATES.has('qa_review')).toBe(false);
    expect(XSTATE_SETTLED_STATES.has('qa_fixing')).toBe(false);
  });

  it('should only contain valid task state names', () => {
    const validNames = new Set(TASK_STATE_NAMES);
    for (const state of XSTATE_SETTLED_STATES) {
      expect(validNames.has(state as typeof TASK_STATE_NAMES[number])).toBe(true);
    }
  });
});

describe('settled state guard behavior', () => {
  /**
   * Simulates the guard logic from agent-events-handlers execution-progress handler.
   * Returns true if the event should be blocked (XState is in a settled state).
   */
  function shouldBlockExecutionProgress(currentXState: string | undefined): boolean {
    return !!(currentXState && XSTATE_SETTLED_STATES.has(currentXState));
  }

  it('should block execution-progress when XState is in plan_review', () => {
    // After PLANNING_COMPLETE with requireReviewBeforeCoding=true,
    // process exits with code 1 emitting phase='failed' — must be blocked
    expect(shouldBlockExecutionProgress('plan_review')).toBe(true);
  });

  it('should block execution-progress when XState is in human_review', () => {
    // After QA_PASSED, any stale events from the dying process must be blocked
    expect(shouldBlockExecutionProgress('human_review')).toBe(true);
  });

  it('should block execution-progress when XState is in error', () => {
    // After PLANNING_FAILED/CODING_FAILED, stale events must not overwrite error status
    expect(shouldBlockExecutionProgress('error')).toBe(true);
  });

  it('should block execution-progress when XState is in done', () => {
    expect(shouldBlockExecutionProgress('done')).toBe(true);
  });

  it('should allow execution-progress when XState is in planning', () => {
    expect(shouldBlockExecutionProgress('planning')).toBe(false);
  });

  it('should allow execution-progress when XState is in coding', () => {
    // After USER_RESUMED from error, XState transitions to coding synchronously.
    // New agent events should flow through normally.
    expect(shouldBlockExecutionProgress('coding')).toBe(false);
  });

  it('should allow execution-progress when XState is in qa_review', () => {
    expect(shouldBlockExecutionProgress('qa_review')).toBe(false);
  });

  it('should allow execution-progress when no XState actor exists', () => {
    // No actor yet (first event for this task) — must not block
    expect(shouldBlockExecutionProgress(undefined)).toBe(false);
  });
});

describe('XSTATE_TO_PHASE', () => {
  it('should have a mapping for every task state', () => {
    for (const state of TASK_STATE_NAMES) {
      expect(XSTATE_TO_PHASE[state]).toBeDefined();
    }
  });

  it('should map settled states to non-active phases', () => {
    // Settled states should map to phases that indicate completion or stoppage
    expect(XSTATE_TO_PHASE['plan_review']).toBe('planning');
    expect(XSTATE_TO_PHASE['human_review']).toBe('complete');
    expect(XSTATE_TO_PHASE['error']).toBe('failed');
    expect(XSTATE_TO_PHASE['done']).toBe('complete');
    expect(XSTATE_TO_PHASE['pr_created']).toBe('complete');
    expect(XSTATE_TO_PHASE['creating_pr']).toBe('complete');
  });

  it('should map active states to processing phases', () => {
    expect(XSTATE_TO_PHASE['planning']).toBe('planning');
    expect(XSTATE_TO_PHASE['coding']).toBe('coding');
    expect(XSTATE_TO_PHASE['qa_review']).toBe('qa_review');
    expect(XSTATE_TO_PHASE['qa_fixing']).toBe('qa_fixing');
  });

  it('should return undefined for unknown states', () => {
    expect(XSTATE_TO_PHASE['nonexistent']).toBeUndefined();
  });
});
