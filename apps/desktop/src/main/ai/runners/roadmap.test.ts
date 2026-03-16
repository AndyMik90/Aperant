import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createSimpleClientMock,
  getToolsForAgentMock,
} = vi.hoisted(() => ({
  createSimpleClientMock: vi.fn(),
  getToolsForAgentMock: vi.fn(() => ({})),
}));

vi.mock('../client/factory', () => ({
  createSimpleClient: createSimpleClientMock,
}));

vi.mock('../tools/build-registry', () => ({
  buildToolRegistry: () => ({
    getToolsForAgent: getToolsForAgentMock,
  }),
}));

import { runRoadmapGeneration } from './roadmap';

describe('runRoadmapGeneration client creation', () => {
  let projectDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    projectDir = mkdtempSync(join(tmpdir(), 'roadmap-runner-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('aborts client creation when the auth timeout elapses', async () => {
    let receivedAbortSignal: AbortSignal | undefined;

    createSimpleClientMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
      receivedAbortSignal = abortSignal;

      return new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => {
          reject(abortSignal.reason instanceof Error ? abortSignal.reason : new Error('Aborted'));
        }, { once: true });
      });
    });

    const resultPromise = runRoadmapGeneration({ projectDir });
    const rejection = expect(resultPromise).rejects.toThrow('Client creation timed out');

    await vi.advanceTimersByTimeAsync(120_000);

    await rejection;
    expect(receivedAbortSignal?.aborted).toBe(true);
    expect(createSimpleClientMock).toHaveBeenCalledTimes(1);
  });

  it('propagates user cancellation into client creation', async () => {
    const controller = new AbortController();
    let receivedAbortSignal: AbortSignal | undefined;

    createSimpleClientMock.mockImplementation(({ abortSignal }: { abortSignal?: AbortSignal }) => {
      receivedAbortSignal = abortSignal;

      return new Promise((_, reject) => {
        abortSignal?.addEventListener('abort', () => {
          reject(abortSignal.reason instanceof Error ? abortSignal.reason : new Error('Aborted'));
        }, { once: true });
      });
    });

    const resultPromise = runRoadmapGeneration({
      projectDir,
      abortSignal: controller.signal,
    });
    const rejection = expect(resultPromise).rejects.toThrow('Aborted');

    controller.abort(new Error('Aborted'));
    await vi.runAllTimersAsync();

    await rejection;
    expect(receivedAbortSignal?.aborted).toBe(true);
    expect(createSimpleClientMock).toHaveBeenCalledTimes(1);
  });
});
