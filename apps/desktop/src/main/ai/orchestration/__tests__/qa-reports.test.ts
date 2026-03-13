import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

import {
  generateQAReport,
  generateEscalationReport,
  generateManualTestPlan,
  issuesSimilar,
  isNoTestProject,
} from '../qa-reports';
import type { QAIterationRecord, QAIssue } from '../qa-loop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  iteration: number,
  status: 'approved' | 'rejected' | 'error',
  issues: QAIssue[] = [],
  durationMs = 1000,
): QAIterationRecord {
  return {
    iteration,
    status,
    issues,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

function makeIssue(title: string, opts: Partial<QAIssue> = {}): QAIssue {
  return { title, ...opts };
}

// ---------------------------------------------------------------------------
// generateQAReport
// ---------------------------------------------------------------------------

describe('generateQAReport', () => {
  it('produces a report with APPROVED status label', () => {
    const iterations: QAIterationRecord[] = [
      makeRecord(1, 'rejected', [makeIssue('Missing test')], 2000),
      makeRecord(2, 'approved', [], 1500),
    ];

    const report = generateQAReport(iterations, 'approved');

    expect(report).toContain('APPROVED');
    expect(report).toContain('PASSED');
    expect(report).toContain('Total Iterations');
    expect(report).toContain('2');
  });

  it('produces a report with ESCALATED status label', () => {
    const iterations: QAIterationRecord[] = [
      makeRecord(1, 'rejected', [makeIssue('Null pointer')], 500),
    ];

    const report = generateQAReport(iterations, 'escalated');

    expect(report).toContain('ESCALATED');
    expect(report).toContain('FAILED');
    expect(report).toContain('escalated to human review');
  });

  it('produces a report with MAX ITERATIONS REACHED label', () => {
    const iterations: QAIterationRecord[] = [
      makeRecord(1, 'rejected', [], 800),
      makeRecord(2, 'rejected', [], 800),
    ];

    const report = generateQAReport(iterations, 'max_iterations');

    expect(report).toContain('MAX ITERATIONS REACHED');
    expect(report).toContain('FAILED');
    expect(report).toContain('maximum');
  });

  it('handles empty iteration history gracefully', () => {
    const report = generateQAReport([], 'approved');

    expect(report).toContain('No iterations recorded');
    expect(report).toContain('Total Iterations');
  });

  it('includes issue details in iteration history section', () => {
    const issue = makeIssue('Type error in auth.ts', {
      type: 'critical',
      location: 'src/auth.ts:42',
      description: 'Property does not exist',
      fix_required: 'Add null check',
    });

    const report = generateQAReport([makeRecord(1, 'rejected', [issue])], 'escalated');

    expect(report).toContain('Type error in auth.ts');
    expect(report).toContain('[CRITICAL]');
    expect(report).toContain('src/auth.ts:42');
    expect(report).toContain('Property does not exist');
    expect(report).toContain('Add null check');
  });

  it('calculates summary counts correctly', () => {
    const iterations: QAIterationRecord[] = [
      makeRecord(1, 'rejected', [makeIssue('A'), makeIssue('B')]),
      makeRecord(2, 'error', [makeIssue('C')]),
      makeRecord(3, 'approved', []),
    ];

    const report = generateQAReport(iterations, 'approved');

    expect(report).toContain('Approved Iterations');
    expect(report).toContain('Rejected Iterations');
    expect(report).toContain('Error Iterations');
  });
});

// ---------------------------------------------------------------------------
// generateEscalationReport
// ---------------------------------------------------------------------------

describe('generateEscalationReport', () => {
  it('lists recurring issues by title', () => {
    const recurringIssues: QAIssue[] = [
      makeIssue('Database connection leak', {
        type: 'critical',
        location: 'src/db.ts',
        description: 'Connection is never closed',
        fix_required: 'Use try-finally block',
      }),
    ];

    const iterations: QAIterationRecord[] = [
      makeRecord(1, 'rejected', recurringIssues),
      makeRecord(2, 'rejected', recurringIssues),
      makeRecord(3, 'rejected', recurringIssues),
    ];

    const report = generateEscalationReport(iterations, recurringIssues);

    expect(report).toContain('Human Intervention Required');
    expect(report).toContain('Database connection leak');
    expect(report).toContain('src/db.ts');
    expect(report).toContain('Connection is never closed');
    expect(report).toContain('Use try-finally block');
  });

  it('includes summary statistics', () => {
    const issue = makeIssue('Error X');
    const iterations = [
      makeRecord(1, 'rejected', [issue]),
      makeRecord(2, 'rejected', [issue]),
      makeRecord(3, 'rejected', [issue]),
    ];

    const report = generateEscalationReport(iterations, [issue]);

    expect(report).toContain('Total QA Iterations');
    expect(report).toContain('Total Issues Found');
    expect(report).toContain('Unique Issues');
    expect(report).toContain('Fix Success Rate');
  });

  it('includes recommended actions section', () => {
    const report = generateEscalationReport([], []);

    expect(report).toContain('Recommended Actions');
    expect(report).toContain('QA_FIX_REQUEST.md');
  });

  it('includes most common issues when present', () => {
    const issue1 = makeIssue('Common bug');
    const issue2 = makeIssue('Rare bug');

    const iterations = [
      makeRecord(1, 'rejected', [issue1, issue2]),
      makeRecord(2, 'rejected', [issue1]),
      makeRecord(3, 'rejected', [issue1]),
    ];

    const report = generateEscalationReport(iterations, [issue1]);

    expect(report).toContain('Most Common Issues');
    expect(report).toContain('common bug');
  });
});

// ---------------------------------------------------------------------------
// generateManualTestPlan
// ---------------------------------------------------------------------------

describe('generateManualTestPlan', () => {
  const SPEC_DIR = '/project/.auto-claude/specs/001-feature';
  const PROJECT_DIR = '/project';

  beforeEach(() => {
    mockReadFile.mockReset();
    mockExistsSync.mockReset().mockReturnValue(false);
    mockReaddirSync.mockReset().mockReturnValue([]);
  });

  it('generates a basic test plan when spec.md is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const plan = await generateManualTestPlan(SPEC_DIR, PROJECT_DIR);

    expect(plan).toContain('Manual Test Plan');
    expect(plan).toContain('Pre-Test Setup');
    expect(plan).toContain('Functional Tests');
    expect(plan).toContain('Sign-off');
  });

  it('extracts acceptance criteria from spec.md when available', async () => {
    const specContent = `# Feature Spec

## Overview
Some description.

## Acceptance Criteria
- User can log in
- User sees dashboard after login
- Invalid credentials show error

## Technical Details
Not relevant here.
`;

    mockReadFile.mockResolvedValue(specContent);

    const plan = await generateManualTestPlan(SPEC_DIR, PROJECT_DIR);

    expect(plan).toContain('User can log in');
    expect(plan).toContain('User sees dashboard after login');
    expect(plan).toContain('Invalid credentials show error');
  });

  it('notes "no automated test framework" when none is detected', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    // existsSync returns false → no test config found

    const plan = await generateManualTestPlan(SPEC_DIR, PROJECT_DIR);

    expect(plan).toContain('No automated test framework detected');
  });

  it('notes "supplemental manual verification" when a test framework is present', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    // Simulate vitest.config.ts existing
    mockExistsSync.mockImplementation((p: string) => p.endsWith('vitest.config.ts'));

    const plan = await generateManualTestPlan(SPEC_DIR, PROJECT_DIR);

    expect(plan).toContain('supplement to automated tests');
  });
});

// ---------------------------------------------------------------------------
// issuesSimilar
// ---------------------------------------------------------------------------

describe('issuesSimilar', () => {
  it('returns true for identical issues', () => {
    const issue = makeIssue('Null pointer exception', { description: 'Null reference in auth module' });
    expect(issuesSimilar(issue, issue)).toBe(true);
  });

  it('returns true for issues with high token overlap', () => {
    const a = makeIssue('null pointer exception in auth module');
    const b = makeIssue('null pointer exception in auth module');
    expect(issuesSimilar(a, b)).toBe(true);
  });

  it('returns false for completely different issues', () => {
    const a = makeIssue('Database connection timeout', { description: 'MySQL connection drops after 30s' });
    const b = makeIssue('UI button not rendering', { description: 'Submit button disappears on mobile' });
    expect(issuesSimilar(a, b)).toBe(false);
  });

  it('strips common prefixes before comparing', () => {
    const a = makeIssue('error: null pointer exception');
    const b = makeIssue('bug: null pointer exception');
    // Both strip to "null pointer exception" — should be considered similar
    expect(issuesSimilar(a, b)).toBe(true);
  });

  it('uses custom threshold when provided', () => {
    const a = makeIssue('Some issue here', { description: 'partial match description' });
    const b = makeIssue('Some issue here', { description: 'completely different thing' });
    // At very low threshold, should match on title alone
    expect(issuesSimilar(a, b, 0.1)).toBe(true);
    // At very high threshold, partial description overlap may fail
    expect(issuesSimilar(a, b, 0.99)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isNoTestProject
// ---------------------------------------------------------------------------

describe('isNoTestProject', () => {
  const PROJECT_DIR = '/my-project';

  beforeEach(() => {
    mockExistsSync.mockReset().mockReturnValue(false);
    mockReaddirSync.mockReset().mockReturnValue([]);
  });

  it('returns false when vitest.config.ts exists', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('vitest.config.ts'));
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(false);
  });

  it('returns false when jest.config.js exists', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('jest.config.js'));
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(false);
  });

  it('returns false when pytest.ini exists', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('pytest.ini'));
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(false);
  });

  it('returns false when test files are found in __tests__ directory', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('__tests__'));
    mockReaddirSync.mockReturnValue(['auth.test.ts', 'utils.test.ts']);
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(false);
  });

  it('returns true when no test config files and no test directories exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(true);
  });

  it('returns true when test directories exist but contain no test files', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('tests'));
    mockReaddirSync.mockReturnValue(['README.md', 'fixtures.json']);
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(true);
  });

  it('handles readdir errors gracefully and returns true', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('tests'));
    mockReaddirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    expect(isNoTestProject('/spec', PROJECT_DIR)).toBe(true);
  });
});
