import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import path from 'path';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../shared', () => ({
  findTaskAndProject: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { findTaskAndProject } from '../shared';
import { registerTaskInvestigationHandlers } from '../investigation-handlers';
import type { IPCResult } from '../../../../shared/types';
import type { InvestigationData } from '../../../../shared/types/investigation';

type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers: Record<string, HandlerFn> = {};

describe('registerTaskInvestigationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ipcMain.handle as Mock).mockImplementation((channel: string, handler: HandlerFn) => {
      handlers[channel] = handler;
    });
    registerTaskInvestigationHandlers();
  });

  it('returns success with null when task is not GitHub-sourced', async () => {
    (findTaskAndProject as Mock).mockReturnValue({
      task: { id: 't-1', specId: '001', metadata: { sourceType: 'manual' } },
      project: { id: 'p-1', path: '/repo' },
    });

    const handler = handlers['task:getInvestigationData'];
    const result = await handler({}, 't-1') as IPCResult<InvestigationData | null>;

    expect(result).toEqual({ success: true, data: null });
  });

  it('returns success with null when report file is missing', async () => {
    (findTaskAndProject as Mock).mockReturnValue({
      task: { id: 't-2', specId: '002', metadata: { sourceType: 'github' } },
      project: { id: 'p-1', path: '/repo' },
    });
    (existsSync as Mock).mockReturnValue(false);

    const handler = handlers['task:getInvestigationData'];
    const result = await handler({}, 't-2') as IPCResult<InvestigationData | null>;

    expect(result).toEqual({ success: true, data: null });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('returns normalized InvestigationData for snake_case reports', async () => {
    (findTaskAndProject as Mock).mockReturnValue({
      task: { id: 't-3', specId: '003', metadata: { sourceType: 'github' } },
      project: { id: 'p-1', path: '/repo' },
    });
    (existsSync as Mock).mockReturnValue(true);
    (readFileSync as Mock).mockReturnValue(JSON.stringify({
      root_cause: {
        identified_root_cause: 'Race condition in startup',
        code_paths: [{ file: 'src/app.ts', start_line: 10, end_line: 18, description: 'Entry path' }],
        evidence: 'Concurrent writes during init',
      },
      impact: {
        severity: 'high',
        affected_components: [{ component: 'Bootstrap', file: 'src/app.ts' }],
        user_impact: 'Startup can fail intermittently',
        regression_risk: 'Low',
        blast_radius: 'All users during cold start',
      },
      fix_advice: {
        approaches: [
          {
            description: 'Guard initialization with a lock',
            complexity: 'simple',
            files_affected: ['src/app.ts'],
            cons: ['Slight contention'],
          },
        ],
        recommended_approach: 0,
        patterns_to_follow: [{ file: 'src/cache.ts', description: 'Use existing lock helper' }],
      },
      reproduction: {
        reproducible: 'likely',
        reproduction_steps: ['Start app twice quickly'],
        test_coverage: {
          test_files: ['tests/app-start.test.ts'],
          coverage_assessment: 'No concurrency scenario coverage',
        },
        suggested_test_approach: 'Add a concurrency startup test',
      },
      ai_summary: 'Startup race condition causes flaky boot failures.',
      severity: 'high',
      likely_resolved: false,
      suggested_labels: [{ name: 'bug', reason: 'Race condition' }],
      linked_prs: [{ number: 12, title: 'Fix startup lock', status: 'open', url: 'https://example/pr/12' }],
      timestamp: '2026-02-20T13:00:00Z',
    }));

    const handler = handlers['task:getInvestigationData'];
    const result = await handler({}, 't-3') as IPCResult<InvestigationData | null>;

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data?.rootCause.rootCause).toBe('Race condition in startup');
    expect(result.data?.fixAdvice.suggestedApproaches[0]?.description).toBe(
      'Guard initialization with a lock',
    );
    expect(result.data?.summary).toBe('Startup race condition causes flaky boot failures.');
    expect(result.data?.reportPath).toBe(
      path.join('/repo', '.auto-claude', 'specs', '003', 'investigation_report.json'),
    );
  });

  it('returns failed IPCResult on malformed JSON', async () => {
    (findTaskAndProject as Mock).mockReturnValue({
      task: { id: 't-4', specId: '004', metadata: { sourceType: 'github' } },
      project: { id: 'p-1', path: '/repo' },
    });
    (existsSync as Mock).mockReturnValue(true);
    (readFileSync as Mock).mockReturnValue('{bad-json');

    const handler = handlers['task:getInvestigationData'];
    const result = await handler({}, 't-4') as IPCResult<InvestigationData | null>;

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
