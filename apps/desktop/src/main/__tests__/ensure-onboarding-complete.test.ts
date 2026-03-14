/**
 * Tests for ensureOnboardingComplete function in cli-integration-handler.ts
 *
 * Tests the exported ensureOnboardingComplete() which reads/writes .claude.json
 * to set hasCompletedOnboarding: true, suppressing Claude's onboarding wizard
 * for already-authenticated profiles.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// ---- fs mock (sync only — the function uses fs, not fs/promises) ----
const mockFiles: Map<string, string | Error> = new Map();

vi.mock('fs', () => {
  const readFileSync = vi.fn((filePath: string, _encoding?: string): string => {
    const entry = mockFiles.get(filePath);
    if (entry === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    if (entry instanceof Error) {
      throw entry;
    }
    return entry;
  });

  const writeFileSync = vi.fn();
  const renameSync = vi.fn();

  return { default: { readFileSync, writeFileSync, renameSync }, readFileSync, writeFileSync, renameSync };
});

// ---- stubs for heavy transitive dependencies ----
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => os.tmpdir()), getAppPath: vi.fn(() => os.tmpdir()) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }));

vi.mock('../../shared/constants', async () => {
  const actual = await vi.importActual<typeof import('../../shared/constants')>('../../shared/constants');
  return { ...actual };
});

vi.mock('../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(),
  initializeClaudeProfileManager: vi.fn(),
}));

vi.mock('../claude-profile/credential-utils', () => ({
  getFullCredentialsFromKeychain: vi.fn(),
  clearKeychainCache: vi.fn(),
  updateProfileSubscriptionMetadata: vi.fn(),
}));

vi.mock('../claude-profile/usage-monitor', () => ({
  getUsageMonitor: vi.fn(),
}));

vi.mock('../claude-profile/profile-utils', () => ({
  getEmailFromConfigDir: vi.fn(),
}));

vi.mock('../terminal/output-parser', () => ({}));
vi.mock('../terminal/session-handler', () => ({}));

vi.mock('./pty-manager', () => ({
  writeToPty: vi.fn(),
  resizePty: vi.fn(),
}));

vi.mock('../ipc-handlers/utils', () => ({
  safeSendToRenderer: vi.fn(),
}));

vi.mock('../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

vi.mock('../../shared/utils/shell-escape', () => ({
  escapeShellArg: vi.fn((s: string) => s),
  escapeForWindowsDoubleQuote: vi.fn((s: string) => s),
  buildCdCommand: vi.fn((cwd: string) => `cd ${cwd}`),
}));

vi.mock('../cli-utils', () => ({
  getClaudeCliInvocation: vi.fn(() => 'claude'),
  getClaudeCliInvocationAsync: vi.fn(async () => 'claude'),
}));

vi.mock('../platform', () => ({
  isWindows: vi.fn(() => false),
}));

vi.mock('../settings-utils', () => ({
  readSettingsFileAsync: vi.fn(async () => ({})),
  readSettingsFile: vi.fn(() => ({})),
}));

// ---- import the function under test ----
import { ensureOnboardingComplete } from '../terminal/cli-integration-handler';
import * as fs from 'fs';

// ---- helpers ----
function claudeJsonPath(configDir: string): string {
  const expanded = configDir.startsWith('~')
    ? configDir.replace(/^~/, os.homedir())
    : configDir;
  return path.join(path.resolve(expanded), '.claude.json');
}

const TEST_DIR = '/tmp/test-profile';

describe('ensureOnboardingComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
  });

  // ---- ENOENT: file does not exist ----
  test('returns early (no write) when .claude.json does not exist', () => {
    // mockFiles is empty → readFileSync will throw ENOENT
    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // ---- already set ----
  test('returns early (no write) when hasCompletedOnboarding is already true', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify({ hasCompletedOnboarding: true }));

    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // ---- missing flag → should write ----
  test('writes hasCompletedOnboarding: true when flag is absent', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify({ someOtherField: 'value' }));

    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse((fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(written.hasCompletedOnboarding).toBe(true);
    expect(written.someOtherField).toBe('value');
  });

  // ---- flag is false → should write ----
  test('writes hasCompletedOnboarding: true when flag is false', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify({ hasCompletedOnboarding: false }));

    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse((fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(written.hasCompletedOnboarding).toBe(true);
  });

  // ---- non-object JSON (string) → should return silently ----
  test('returns early (no write) when .claude.json contains a JSON string', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify('just a string'));

    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // ---- array JSON → should return silently ----
  test('returns early (no write) when .claude.json contains a JSON array', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify([1, 2, 3]));

    ensureOnboardingComplete(TEST_DIR);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // ---- corrupted / invalid JSON → outer catch swallows error ----
  test('handles corrupted JSON gracefully without throwing', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, '{ invalid json }');

    expect(() => ensureOnboardingComplete(TEST_DIR)).not.toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // ---- tilde expansion ----
  test('expands leading tilde to home directory', () => {
    const tildeDir = '~/myprofile';
    const resolvedDir = path.resolve(tildeDir.replace(/^~/, os.homedir()));
    const filePath = path.join(resolvedDir, '.claude.json');

    mockFiles.set(filePath, JSON.stringify({}));

    ensureOnboardingComplete(tildeDir);

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    // Writes to a temp file (claudeJsonPath + UUID + .tmp), then renames to target
    const writtenPath = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writtenPath).toMatch(new RegExp(`^${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\..*\\.tmp$`));
    expect(fs.renameSync).toHaveBeenCalledWith(writtenPath, filePath);
  });

  // ---- write error → outer catch swallows error ----
  test('handles write error gracefully without throwing', () => {
    const filePath = claudeJsonPath(TEST_DIR);
    mockFiles.set(filePath, JSON.stringify({}));

    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => ensureOnboardingComplete(TEST_DIR)).not.toThrow();
  });
});
