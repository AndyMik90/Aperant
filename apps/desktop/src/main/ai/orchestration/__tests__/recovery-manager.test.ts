import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that pull in the mocked modules
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('../../utils/json-repair', () => ({
  safeParseJson: (raw: string) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
}));

import { RecoveryManager } from '../recovery-manager';
import type { BuildCheckpoint, FailureType } from '../recovery-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_DIR = path.join(path.sep, 'project');
const SPEC_DIR = path.join(PROJECT_DIR, '.auto-claude', 'specs', '001-feature');
const MEMORY_DIR = path.join(SPEC_DIR, 'memory');
const ATTEMPT_HISTORY_PATH = path.join(MEMORY_DIR, 'attempt_history.json');

function makeHistory(
  subtasks: Record<string, Array<{ timestamp: string; error: string; failureType: FailureType; errorHash: string }>>,
  stuckSubtasks: string[] = [],
) {
  return JSON.stringify({
    subtasks,
    stuckSubtasks,
    metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
  });
}

function recentTimestamp() {
  return new Date().toISOString();
}

function oldTimestamp() {
  // 3 hours ago — outside the 2-hour window
  return new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString();
}

function createManager() {
  return new RecoveryManager(SPEC_DIR, PROJECT_DIR);
}

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

describe('RecoveryManager.classifyFailure', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    manager = createManager();
  });

  const cases: Array<[string, FailureType]> = [
    ['SyntaxError: Unexpected token', 'broken_build'],
    ['Module not found: react', 'broken_build'],
    ['compilation error in main.ts', 'broken_build'],
    ['cannot find module lodash', 'broken_build'],
    // 'IndentationError' is not in the source's buildErrors list — removed
    ['parse error in config.js', 'broken_build'],

    ['verification failed: response mismatch', 'verification_failed'],
    ['AssertionError: expected 1 to equal 2', 'verification_failed'],
    ['test failed: missing element', 'verification_failed'],
    ['status code 404 received', 'verification_failed'],

    ['context window exceeded', 'context_exhausted'],
    ['token limit reached', 'context_exhausted'],
    ['maximum length of response reached', 'context_exhausted'],

    ['429 too many requests', 'rate_limited'],
    ['rate limit exceeded', 'rate_limited'],
    ['too many requests from your IP', 'rate_limited'],

    ['401 unauthorized access', 'auth_failure'],
    ['auth token expired', 'auth_failure'],

    ['a totally random and obscure crash', 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('classifies "%s" as %s', (error, expected) => {
    expect(manager.classifyFailure(error, 'subtask-1')).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint save / load round-trip
// ---------------------------------------------------------------------------

describe('RecoveryManager checkpoint round-trip', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset();
    manager = createManager();
  });

  it('writes a parseable checkpoint and loads it back', async () => {
    const checkpoint: BuildCheckpoint = {
      specId: '001',
      phase: 'coding',
      lastCompletedSubtaskId: 'subtask-3',
      totalSubtasks: 5,
      completedSubtasks: 3,
      stuckSubtasks: [],
      timestamp: new Date().toISOString(),
      isComplete: false,
    };

    // Save captures what was written
    let writtenContent = '';
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      writtenContent = content;
      return Promise.resolve();
    });

    await manager.saveCheckpoint(checkpoint);

    // Verify writeFile was called with the progress file path
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join(SPEC_DIR, 'build-progress.txt'),
      expect.stringContaining('spec_id: 001'),
      'utf-8',
    );

    // Now load the checkpoint from what was written
    mockReadFile.mockResolvedValueOnce(writtenContent);
    const loaded = await manager.loadCheckpoint();

    expect(loaded).not.toBeNull();
    expect(loaded?.specId).toBe('001');
    expect(loaded?.phase).toBe('coding');
    expect(loaded?.lastCompletedSubtaskId).toBe('subtask-3');
    expect(loaded?.totalSubtasks).toBe(5);
    expect(loaded?.completedSubtasks).toBe(3);
    expect(loaded?.isComplete).toBe(false);
  });

  it('saves lastCompletedSubtaskId=null as "none" and reloads as null', async () => {
    const checkpoint: BuildCheckpoint = {
      specId: '002',
      phase: 'planning',
      lastCompletedSubtaskId: null,
      totalSubtasks: 3,
      completedSubtasks: 0,
      stuckSubtasks: [],
      timestamp: new Date().toISOString(),
      isComplete: false,
    };

    let writtenContent = '';
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      writtenContent = content;
      return Promise.resolve();
    });

    await manager.saveCheckpoint(checkpoint);
    expect(writtenContent).toContain('last_completed_subtask: none');

    mockReadFile.mockResolvedValueOnce(writtenContent);
    const loaded = await manager.loadCheckpoint();
    expect(loaded?.lastCompletedSubtaskId).toBeNull();
  });

  it('returns null when no checkpoint file exists', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    const loaded = await manager.loadCheckpoint();
    expect(loaded).toBeNull();
  });

  it('saves stuckSubtasks correctly', async () => {
    const checkpoint: BuildCheckpoint = {
      specId: '003',
      phase: 'coding',
      lastCompletedSubtaskId: null,
      totalSubtasks: 4,
      completedSubtasks: 1,
      stuckSubtasks: ['subtask-1', 'subtask-2'],
      timestamp: new Date().toISOString(),
      isComplete: false,
    };

    let writtenContent = '';
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      writtenContent = content;
      return Promise.resolve();
    });

    await manager.saveCheckpoint(checkpoint);

    mockReadFile.mockResolvedValueOnce(writtenContent);
    const loaded = await manager.loadCheckpoint();
    expect(loaded?.stuckSubtasks).toEqual(['subtask-1', 'subtask-2']);
  });
});

// ---------------------------------------------------------------------------
// Circular fix detection
// ---------------------------------------------------------------------------

describe('RecoveryManager.isCircularFix', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    manager = createManager();
  });

  it('returns false when fewer than 3 identical errors exist', async () => {
    // Produce a real hash by calling classifyFailure indirectly
    // We need the same hash that simpleHash("same error") would produce.
    // We'll record 2 attempts with the same error, then check.
    const sameError = 'same error message';

    // Build a history with 2 records that share the same errorHash
    // We compute the hash the same way the source does: via recordAttempt
    // Here we mock the file system to return a pre-built history.
    // For simplicity, we simulate 2 identical hashes manually.
    const history = {
      subtasks: {
        'task-1': [
          { timestamp: recentTimestamp(), error: sameError, failureType: 'unknown', errorHash: 'aaa' },
          { timestamp: recentTimestamp(), error: sameError, failureType: 'unknown', errorHash: 'aaa' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(history));
    const result = await manager.isCircularFix('task-1');
    expect(result).toBe(false);
  });

  it('returns true when 3 or more identical error hashes exist within the window', async () => {
    const history = {
      subtasks: {
        'task-1': [
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'bbb' },
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'bbb' },
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'bbb' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(history));
    const result = await manager.isCircularFix('task-1');
    expect(result).toBe(true);
  });

  it('ignores attempts outside the 2-hour window', async () => {
    const history = {
      subtasks: {
        'task-1': [
          // Two old entries — outside window
          { timestamp: oldTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'ccc' },
          { timestamp: oldTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'ccc' },
          { timestamp: oldTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'ccc' },
          // One recent entry
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'ccc' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(history));
    const result = await manager.isCircularFix('task-1');
    // Only 1 recent entry → not circular
    expect(result).toBe(false);
  });

  it('returns false for a subtask with no attempt history', async () => {
    mockReadFile.mockResolvedValue(makeHistory({}));
    const result = await manager.isCircularFix('no-such-task');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attempt window filtering via getAttemptCount
// ---------------------------------------------------------------------------

describe('RecoveryManager.getAttemptCount', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    manager = createManager();
  });

  it('counts only recent attempts within the 2-hour window', async () => {
    const history = {
      subtasks: {
        'task-x': [
          { timestamp: oldTimestamp(), error: 'old error', failureType: 'unknown', errorHash: 'h1' },
          { timestamp: recentTimestamp(), error: 'new error 1', failureType: 'unknown', errorHash: 'h2' },
          { timestamp: recentTimestamp(), error: 'new error 2', failureType: 'unknown', errorHash: 'h3' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(history));
    const count = await manager.getAttemptCount('task-x');
    expect(count).toBe(2);
  });

  it('returns 0 for unknown subtask', async () => {
    mockReadFile.mockResolvedValue(makeHistory({}));
    const count = await manager.getAttemptCount('ghost-task');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// determineRecoveryAction
// ---------------------------------------------------------------------------

describe('RecoveryManager.determineRecoveryAction', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    manager = createManager();
  });

  it('escalates immediately when circular fix detected', async () => {
    // 3 identical error hashes → circular
    const history = {
      subtasks: {
        'task-circ': [
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'xyz' },
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'xyz' },
          { timestamp: recentTimestamp(), error: 'err', failureType: 'unknown', errorHash: 'xyz' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(history));

    const action = await manager.determineRecoveryAction('task-circ', 'err', 5);
    expect(action.action).toBe('escalate');
    expect(action.reason).toMatch(/circular/i);
  });

  it('skips when attempt count >= maxRetries', async () => {
    const history = {
      subtasks: {
        'task-skip': [
          { timestamp: recentTimestamp(), error: 'fail', failureType: 'unknown', errorHash: 'a1' },
          { timestamp: recentTimestamp(), error: 'fail', failureType: 'unknown', errorHash: 'a2' },
          { timestamp: recentTimestamp(), error: 'fail', failureType: 'unknown', errorHash: 'a3' },
        ],
      },
      stuckSubtasks: [],
      metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(history));

    const action = await manager.determineRecoveryAction('task-skip', 'fail', 3);
    expect(action.action).toBe('skip');
    expect(action.reason).toMatch(/max retries/i);
  });

  it('escalates on auth failure', async () => {
    mockReadFile.mockResolvedValue(makeHistory({ 'task-auth': [] }));
    const action = await manager.determineRecoveryAction('task-auth', '401 unauthorized', 5);
    expect(action.action).toBe('escalate');
    expect(action.reason).toMatch(/auth/i);
  });

  it('retries on rate limit', async () => {
    mockReadFile.mockResolvedValue(makeHistory({ 'task-rl': [] }));
    const action = await manager.determineRecoveryAction('task-rl', '429 rate limit exceeded', 5);
    expect(action.action).toBe('retry');
    expect(action.reason).toMatch(/rate limit/i);
  });

  it('retries on context exhaustion', async () => {
    mockReadFile.mockResolvedValue(makeHistory({ 'task-ctx': [] }));
    const action = await manager.determineRecoveryAction('task-ctx', 'context window exceeded', 5);
    expect(action.action).toBe('retry');
    expect(action.reason).toMatch(/context/i);
  });

  it('defaults to retry for unknown failure types', async () => {
    mockReadFile.mockResolvedValue(makeHistory({ 'task-unk': [] }));
    const action = await manager.determineRecoveryAction('task-unk', 'something weird', 5);
    expect(action.action).toBe('retry');
    expect(action.target).toBe('task-unk');
  });
});

// ---------------------------------------------------------------------------
// init — directory creation and history bootstrap
// ---------------------------------------------------------------------------

describe('RecoveryManager.init', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    manager = createManager();
  });

  it('creates memory directory with recursive flag', async () => {
    // Simulate history file already existing
    mockReadFile.mockResolvedValueOnce(makeHistory({}));
    await manager.init();
    expect(mockMkdir).toHaveBeenCalledWith(MEMORY_DIR, { recursive: true });
  });

  it('writes an empty history when no history file exists', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    await manager.init();
    expect(mockWriteFile).toHaveBeenCalledWith(
      ATTEMPT_HISTORY_PATH,
      expect.stringContaining('"subtasks"'),
      'utf-8',
    );
  });
});

// ---------------------------------------------------------------------------
// markStuck / isStuck
// ---------------------------------------------------------------------------

describe('RecoveryManager stuck tracking', () => {
  let manager: RecoveryManager;

  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    manager = createManager();
  });

  it('marks a subtask as stuck and detects it', async () => {
    let storedHistory = makeHistory({}, []);

    mockReadFile.mockImplementation(() => Promise.resolve(storedHistory));
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      storedHistory = content;
      return Promise.resolve();
    });

    await manager.markStuck('task-stuck');

    expect(await manager.isStuck('task-stuck')).toBe(true);
    expect(await manager.isStuck('task-fine')).toBe(false);
  });

  it('does not duplicate a subtask when marked stuck twice', async () => {
    let storedHistory = makeHistory({}, []);

    mockReadFile.mockImplementation(() => Promise.resolve(storedHistory));
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      storedHistory = content;
      return Promise.resolve();
    });

    await manager.markStuck('task-dup');
    await manager.markStuck('task-dup');

    const parsed = JSON.parse(storedHistory) as { stuckSubtasks: string[] };
    expect(parsed.stuckSubtasks.filter((id) => id === 'task-dup')).toHaveLength(1);
  });
});
