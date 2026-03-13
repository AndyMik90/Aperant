import { describe, it, expect, vi } from 'vitest';

import { executeParallel } from '../parallel-executor';
import type { ParallelExecutorConfig, SubtaskSessionRunner } from '../parallel-executor';
import type { SubtaskInfo } from '../build-orchestrator';
import type { SessionResult } from '../../session/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubtask(id: string): SubtaskInfo {
  return {
    id,
    description: `Subtask ${id}`,
    status: 'pending',
  };
}

function makeResult(outcome: SessionResult['outcome']): SessionResult {
  return {
    outcome,
    error: outcome === 'error' ? new Error('session error') : undefined,
    totalSteps: 1,
    lastMessage: '',
  } as unknown as SessionResult;
}

// ---------------------------------------------------------------------------
// Helper: run executeParallel with fake timers advanced automatically
// ---------------------------------------------------------------------------

async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = fn();
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeParallel', () => {
  // -------------------------------------------------------------------------
  // Empty task list
  // -------------------------------------------------------------------------

  it('returns empty results for an empty subtask list', async () => {
    const runner = vi.fn() as unknown as SubtaskSessionRunner;
    const result = await executeParallel([], runner);

    expect(result.results).toHaveLength(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.rateLimitedCount).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // All succeed
  // -------------------------------------------------------------------------

  it('returns successCount equal to number of subtasks when all succeed', async () => {
    const subtasks = [makeSubtask('t1'), makeSubtask('t2'), makeSubtask('t3')];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10 }),
    );

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.rateLimitedCount).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.results).toHaveLength(3);
    for (const r of result.results) {
      expect(r.success).toBe(true);
      expect(r.rateLimited).toBe(false);
    }
  });

  it('maps subtaskIds correctly in results', async () => {
    const subtasks = [makeSubtask('alpha'), makeSubtask('beta')];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10 }),
    );
    const ids = result.results.map((r) => r.subtaskId);

    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });

  // -------------------------------------------------------------------------
  // Partial failure
  // -------------------------------------------------------------------------

  it('handles partial failure — some succeed, some fail', async () => {
    const subtasks = [makeSubtask('s1'), makeSubtask('s2'), makeSubtask('s3')];

    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult('completed'))
      .mockResolvedValueOnce(makeResult('error'))
      .mockResolvedValueOnce(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10 }),
    );

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.rateLimitedCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // All fail
  // -------------------------------------------------------------------------

  it('handles all-fail scenario gracefully', async () => {
    const subtasks = [makeSubtask('f1'), makeSubtask('f2')];
    const runner = vi.fn().mockResolvedValue(makeResult('error')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10 }),
    );

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(2);
    expect(result.cancelled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  it('tracks rate-limited subtasks separately', async () => {
    const subtasks = [makeSubtask('r1'), makeSubtask('r2')];

    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult('rate_limited'))
      .mockResolvedValueOnce(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10 }),
    );

    expect(result.rateLimitedCount).toBe(1);
    expect(result.successCount).toBe(1);
  });

  it('calls onRateLimited callback when rate-limited result is detected in first batch', async () => {
    // Single-item batches (maxConcurrency=1) so back-off delay fires between batches
    const subtasks = [makeSubtask('rl1'), makeSubtask('rl2')];

    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult('rate_limited'))
      .mockResolvedValueOnce(makeResult('completed')) as SubtaskSessionRunner;

    const onRateLimited = vi.fn();
    const config: ParallelExecutorConfig = { maxConcurrency: 1, onRateLimited };

    await runWithFakeTimers(() => executeParallel(subtasks, runner, config));

    expect(onRateLimited).toHaveBeenCalledWith(expect.any(Number));
  });

  // -------------------------------------------------------------------------
  // Concurrency limit batching
  // -------------------------------------------------------------------------

  it('respects maxConcurrency and processes all tasks in batches', async () => {
    const subtasks = [
      makeSubtask('b1'), makeSubtask('b2'), makeSubtask('b3'),
      makeSubtask('b4'), makeSubtask('b5'),
    ];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 3 }),
    );

    expect(result.successCount).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(runner).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  // Callbacks — onSubtaskStart / onSubtaskComplete / onSubtaskFailed
  // -------------------------------------------------------------------------

  it('calls onSubtaskStart for each subtask', async () => {
    const subtasks = [makeSubtask('c1'), makeSubtask('c2')];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;
    const onSubtaskStart = vi.fn();

    await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, { maxConcurrency: 10, onSubtaskStart }),
    );

    expect(onSubtaskStart).toHaveBeenCalledTimes(2);
    expect(onSubtaskStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(onSubtaskStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
  });

  it('calls onSubtaskComplete for successful subtasks — single task (no stagger)', async () => {
    const subtasks = [makeSubtask('ok1')];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;
    const onSubtaskComplete = vi.fn();

    // Single item at index 0 → stagger = 0ms → no fake timers needed
    const result = await executeParallel(subtasks, runner, { maxConcurrency: 1, onSubtaskComplete });

    expect(onSubtaskComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ok1' }),
      expect.objectContaining({ outcome: 'completed' }),
    );
    expect(result.successCount).toBe(1);
  });

  it('calls onSubtaskFailed for error outcomes — single task', async () => {
    const subtasks = [makeSubtask('fail1')];
    const runner = vi.fn().mockResolvedValue(makeResult('error')) as SubtaskSessionRunner;
    const onSubtaskFailed = vi.fn();

    const result = await executeParallel(subtasks, runner, { maxConcurrency: 1, onSubtaskFailed });

    expect(onSubtaskFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fail1' }),
      expect.any(Error),
    );
    expect(result.failureCount).toBe(1);
  });

  it('calls onSubtaskFailed when runner throws — single task', async () => {
    const subtasks = [makeSubtask('throw1')];
    const runner = vi.fn().mockRejectedValue(new Error('Unexpected crash')) as SubtaskSessionRunner;
    const onSubtaskFailed = vi.fn();

    const result = await executeParallel(subtasks, runner, { maxConcurrency: 1, onSubtaskFailed });

    expect(result.failureCount).toBe(1);
    expect(onSubtaskFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'throw1' }),
      expect.any(Error),
    );
  });

  // -------------------------------------------------------------------------
  // Cancellation via AbortSignal
  // -------------------------------------------------------------------------

  it('marks cancelled=true when aborted before execution starts', async () => {
    const controller = new AbortController();
    controller.abort();

    const subtasks = [makeSubtask('x1'), makeSubtask('x2')];
    const runner = vi.fn().mockResolvedValue(makeResult('completed')) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, {
        maxConcurrency: 10,
        abortSignal: controller.signal,
      }),
    );

    expect(result.cancelled).toBe(true);
  });

  it('returns cancelled=true when aborted after first batch completes', async () => {
    const controller = new AbortController();
    const subtasks = [makeSubtask('a1'), makeSubtask('a2')];

    const runner = vi.fn().mockImplementation(async (subtask: SubtaskInfo) => {
      if (subtask.id === 'a1') {
        controller.abort();
      }
      return makeResult('completed');
    }) as SubtaskSessionRunner;

    const result = await runWithFakeTimers(() =>
      executeParallel(subtasks, runner, {
        maxConcurrency: 1,
        abortSignal: controller.signal,
      }),
    );

    expect(result.cancelled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Rate-limited error from thrown exception — single task, no stagger
  // -------------------------------------------------------------------------

  it('marks rateLimited=true when thrown error contains 429', async () => {
    const subtasks = [makeSubtask('rl-throw')];
    const runner = vi.fn().mockRejectedValue(new Error('HTTP 429 too many requests')) as SubtaskSessionRunner;

    const result = await executeParallel(subtasks, runner, { maxConcurrency: 1 });

    expect(result.results[0].rateLimited).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Result structure — single task, no stagger
  // -------------------------------------------------------------------------

  it('includes session result in ParallelSubtaskResult when session ran', async () => {
    const subtasks = [makeSubtask('struct1')];
    const sessionResult = makeResult('completed');
    const runner = vi.fn().mockResolvedValue(sessionResult) as SubtaskSessionRunner;

    const result = await executeParallel(subtasks, runner);

    expect(result.results[0].result).toBeDefined();
    expect(result.results[0].result?.outcome).toBe('completed');
  });

  it('includes error string when runner throws', async () => {
    const subtasks = [makeSubtask('err-str')];
    const runner = vi.fn().mockRejectedValue(new Error('crash detail')) as SubtaskSessionRunner;

    const result = await executeParallel(subtasks, runner);

    expect(result.results[0].error).toContain('crash detail');
    expect(result.results[0].success).toBe(false);
  });
});
