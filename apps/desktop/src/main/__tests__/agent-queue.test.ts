import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runRoadmapGenerationMock,
  writeFileWithRetryMock,
} = vi.hoisted(() => ({
  runRoadmapGenerationMock: vi.fn(),
  writeFileWithRetryMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ai/runners/roadmap', () => ({
  runRoadmapGeneration: runRoadmapGenerationMock,
}));

vi.mock('../utils/atomic-file', () => ({
  writeFileWithRetry: writeFileWithRetryMock,
}));

vi.mock('../utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => ({
    fn,
    cancel: vi.fn(),
  }),
}));

import { AgentQueueManager } from '../agent/agent-queue';
import { AgentState } from '../agent/agent-state';

describe('AgentQueueManager roadmap progress mapping', () => {
  let projectPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectPath = mkdtempSync(join(tmpdir(), 'agent-queue-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('maps runner phase names to frontend roadmap phases', async () => {
    runRoadmapGenerationMock.mockImplementation(
      async (
        _config: unknown,
        onStream?: (event: { type: string; phase?: string }) => void,
      ) => {
        onStream?.({ type: 'phase-start', phase: 'discovery' });
        onStream?.({ type: 'phase-start', phase: 'features' });

        return {
          success: false,
          phases: [],
          error: 'boom',
        };
      },
    );

    const emitter = new EventEmitter();
    const progressUpdates: Array<{ phase: string; progress: number; message: string }> = [];
    emitter.on('roadmap-progress', (_projectId, status) => {
      progressUpdates.push(status);
    });

    const queue = new AgentQueueManager(
      new AgentState(),
      {} as never,
      { killProcess: vi.fn() } as never,
      emitter,
    );

    await queue.startRoadmapGeneration('project-1', projectPath);

    expect(progressUpdates.map((status) => status.phase)).toEqual([
      'analyzing',
      'discovering',
      'generating',
    ]);
    expect(progressUpdates[1]?.message).toContain('discovery');
    expect(progressUpdates[2]?.message).toContain('features');
  });
});
