import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

vi.mock('../cli-tool-manager', () => ({
  getToolPath: vi.fn(() => 'git'),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

let testDir: string;
let projectPath: string;
let gitRepo = false;
let hasCommits = false;
let commitError: Error | null = null;
let recordedCommands: string[][] = [];

function setupGitMock(): void {
  recordedCommands = [];
  vi.mocked(execFileSync).mockImplementation((_, args) => {
    const normalizedArgs = Array.isArray(args) ? [...args] : [];
    recordedCommands.push(normalizedArgs);

    if (normalizedArgs[0] === 'rev-parse' && normalizedArgs[1] === '--git-dir') {
      if (!gitRepo) {
        throw new Error('fatal: not a git repository');
      }
      return '.git\n';
    }

    if (normalizedArgs[0] === 'rev-parse' && normalizedArgs[1] === 'HEAD') {
      if (!hasCommits) {
        throw new Error('fatal: ambiguous argument HEAD');
      }
      return 'abc123\n';
    }

    if (
      normalizedArgs[0] === 'rev-parse'
      && normalizedArgs[1] === '--abbrev-ref'
      && normalizedArgs[2] === 'HEAD'
    ) {
      return 'main\n';
    }

    if (normalizedArgs[0] === 'init') {
      gitRepo = true;
      return 'Initialized empty Git repository\n';
    }

    if (normalizedArgs[0] === 'status' && normalizedArgs[1] === '--porcelain') {
      return '';
    }

    if (normalizedArgs[0] === 'add' && normalizedArgs[1] === '-A') {
      return '';
    }

    if (normalizedArgs[0] === 'commit') {
      if (commitError) {
        throw commitError;
      }
      hasCommits = true;
      return '[main (root-commit) abc123] Initial commit\n';
    }

    return '';
  });
}

describe('project-initializer automation bootstrap', () => {
  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'project-initializer-test-'));
    projectPath = path.join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    gitRepo = false;
    hasCommits = false;
    commitError = null;
    setupGitMock();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it('bootstraps a plain folder with git, initial commit, and .auto-claude', async () => {
    const { ensureProjectReadyForAutomation } = await import('../project-initializer');

    const result = ensureProjectReadyForAutomation(projectPath);

    expect(result).toEqual({ success: true });
    expect(gitRepo).toBe(true);
    expect(hasCommits).toBe(true);
    expect(existsSync(path.join(projectPath, '.auto-claude', 'specs'))).toBe(true);
    expect(existsSync(path.join(projectPath, '.auto-claude', 'ideation'))).toBe(true);
    expect(readFileSync(path.join(projectPath, '.gitignore'), 'utf-8')).toContain('.auto-claude/');
    expect(recordedCommands.some((args) => args[0] === 'init')).toBe(true);
    expect(recordedCommands.some((args) => args[0] === 'commit')).toBe(true);
  });

  it('bootstraps an existing git repo without commits before initializing .auto-claude', async () => {
    gitRepo = true;
    hasCommits = false;
    const { ensureProjectReadyForAutomation } = await import('../project-initializer');

    const result = ensureProjectReadyForAutomation(projectPath);

    expect(result).toEqual({ success: true });
    expect(hasCommits).toBe(true);
    expect(existsSync(path.join(projectPath, '.auto-claude', 'specs'))).toBe(true);
    expect(recordedCommands.some((args) => args[0] === 'init')).toBe(false);
    expect(recordedCommands.some((args) => args[0] === 'commit')).toBe(true);
  });

  it('returns success without reinitializing an already ready project', async () => {
    gitRepo = true;
    hasCommits = true;
    mkdirSync(path.join(projectPath, '.auto-claude'), { recursive: true });
    const { ensureProjectReadyForAutomation } = await import('../project-initializer');

    const result = ensureProjectReadyForAutomation(projectPath);

    expect(result).toEqual({ success: true });
    expect(recordedCommands.some((args) => args[0] === 'init')).toBe(false);
    expect(recordedCommands.some((args) => args[0] === 'commit')).toBe(false);
  });

  it('returns a clear bootstrap error and does not create .auto-claude when git commit fails', async () => {
    commitError = new Error('Author identity unknown');
    const { ensureProjectReadyForAutomation } = await import('../project-initializer');

    const result = ensureProjectReadyForAutomation(projectPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Git bootstrap failed');
    expect(result.error).toContain('Author identity unknown');
    expect(existsSync(path.join(projectPath, '.auto-claude'))).toBe(false);
  });
});
