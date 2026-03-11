import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { restampExecutionPhase } from '../subtask-iterator';

// =============================================================================
// restampExecutionPhase
// =============================================================================

describe('restampExecutionPhase', () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'restamp-test-'));
    planPath = join(tmpDir, 'implementation_plan.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('updates a stale executionPhase and writes the file back', async () => {
    const plan = {
      feature: 'test',
      executionPhase: 'planning',
      phases: [],
    };
    await writeFile(planPath, JSON.stringify(plan, null, 2));

    await restampExecutionPhase(tmpDir, 'coding');

    const written = JSON.parse(await readFile(planPath, 'utf-8')) as Record<string, unknown>;
    expect(written.executionPhase).toBe('coding');
  });

  it('does not rewrite the file when executionPhase is already correct', async () => {
    const plan = {
      feature: 'test',
      executionPhase: 'coding',
      phases: [],
    };
    await writeFile(planPath, JSON.stringify(plan, null, 2));

    // Snapshot content before calling the function
    const contentBefore = await readFile(planPath, 'utf-8');

    await restampExecutionPhase(tmpDir, 'coding');

    // Verify file was not modified — content should be byte-identical
    const contentAfter = await readFile(planPath, 'utf-8');
    expect(contentAfter).toBe(contentBefore);

    const written = JSON.parse(contentAfter) as Record<string, unknown>;
    expect(written.executionPhase).toBe('coding');
  });

  it('handles a missing file gracefully without throwing', async () => {
    // planPath does NOT exist — the function should swallow the error
    await expect(restampExecutionPhase(tmpDir, 'coding')).resolves.toBeUndefined();
  });

  it('handles corrupt JSON gracefully without throwing', async () => {
    await writeFile(planPath, '{ this is not valid json }{{{');

    await expect(restampExecutionPhase(tmpDir, 'coding')).resolves.toBeUndefined();
  });
});
