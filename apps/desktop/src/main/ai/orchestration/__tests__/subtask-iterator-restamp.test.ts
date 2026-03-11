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

    // Record the mtime before calling the function
    const { mtimeMs: beforeMs } = await (await import('node:fs/promises')).stat(planPath);

    await restampExecutionPhase(tmpDir, 'coding');

    const { mtimeMs: afterMs } = await (await import('node:fs/promises')).stat(planPath);

    // File should not have been touched (mtime unchanged on most systems within a tight window)
    // We verify by content — executionPhase is still 'coding' and no extra write occurred
    // Use try/catch instead of relying on the preceding stat for existence (avoids TOCTOU)
    const rawContent = await readFile(planPath, 'utf-8');
    const written = JSON.parse(rawContent) as Record<string, unknown>;
    expect(written.executionPhase).toBe('coding');

    // The mtime should not have advanced (no write occurred).
    // Allow a tiny epsilon for filesystem resolution differences.
    expect(afterMs).toBe(beforeMs);
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
