/**
 * Integration tests for Claude Profile IPC handlers
 * Tests CLAUDE_PROFILE_SAVE and CLAUDE_PROFILE_INITIALIZE IPC handlers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ClaudeProfile, IPCResult, } from '../../shared/types';

// Test directories - use secure temp directory with random suffix
let TEST_DIR: string;
let TEST_CONFIG_DIR: string;

function initTestDirectories(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'claude-profile-ipc-test-'));
  TEST_CONFIG_DIR = path.join(TEST_DIR, 'claude-config');
}

// Mock electron
const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  send: vi.fn()
};

const mockBrowserWindow = {
  webContents: {
    send: vi.fn()
  }
};

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: vi.fn()
}));

// Mock config path validator to allow test temp directories
vi.mock('../../main/utils/config-path-validator', () => ({
  isValidConfigDir: vi.fn().mockReturnValue(true),
}));

// Mock ClaudeProfileManager
const mockProfileManager = {
  generateProfileId: vi.fn((name: string) => `profile-${name.toLowerCase().replace(/\s+/g, '-')}`),
  saveProfile: vi.fn((profile: ClaudeProfile) => profile),
  getProfile: vi.fn(),
  setProfileToken: vi.fn(() => true),
  getSettings: vi.fn(),
  getActiveProfile: vi.fn(),
  setActiveProfile: vi.fn(() => true),
  deleteProfile: vi.fn(() => true),
  renameProfile: vi.fn(() => true),
  getAutoSwitchSettings: vi.fn(),
  updateAutoSwitchSettings: vi.fn(() => true),
  isInitialized: vi.fn(() => true)
};

vi.mock('../../main/claude-profile-manager', () => ({
  getClaudeProfileManager: () => mockProfileManager
}));

// Mock TerminalManager
const mockTerminalManager = {
  create: vi.fn(),
  write: vi.fn(),
  destroy: vi.fn(),
  isClaudeMode: vi.fn(() => false),
  getActiveTerminalIds: vi.fn(() => []),
  switchClaudeProfile: vi.fn(),
  setTitle: vi.fn(),
  setWorktreeConfig: vi.fn()
};

// Mock projectStore
vi.mock('../../main/project-store', () => ({
  projectStore: {}
}));

// Mock terminalNameGenerator
vi.mock('../../main/terminal-name-generator', () => ({
  terminalNameGenerator: {
    generateName: vi.fn()
  }
}));

// Mock shell escape utilities
vi.mock('../../shared/utils/shell-escape', () => ({
  escapeShellArg: (arg: string) => `'${arg}'`,
  escapeShellArgWindows: (arg: string) => `"${arg}"`
}));

// Mock claude CLI utils
vi.mock('../../main/claude-cli-utils', () => ({
  getClaudeCliInvocationAsync: vi.fn(async () => ({
    command: '/usr/local/bin/claude'
  }))
}));

// Mock settings utils
vi.mock('../../main/settings-utils', () => ({
  readSettingsFileAsync: vi.fn(async () => ({}))
}));

// Mock usage monitor
vi.mock('../../main/claude-profile/usage-monitor', () => ({
  getUsageMonitor: vi.fn(() => ({}))
}));

// Sample profile
function createTestProfile(overrides: Partial<ClaudeProfile> = {}): ClaudeProfile {
  return {
    id: 'test-profile-id',
    name: 'Test Profile',
    isDefault: false,
    configDir: path.join(TEST_CONFIG_DIR, 'test-profile'),
    createdAt: new Date(),
    ...overrides
  };
}

// Setup test directories
function setupTestDirs(): void {
  initTestDirectories();
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Claude Profile IPC Integration', () => {
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.clearAllMocks();
    handlers = new Map();

    // Capture IPC handlers
    mockIpcMain.handle.mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    });

    mockIpcMain.on.mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    });

    // Import and call the registration function
    const { registerTerminalHandlers } = await import('../../main/ipc-handlers/terminal-handlers');
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types don't match production types
    registerTerminalHandlers(mockTerminalManager as any, () => mockBrowserWindow as any);
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('CLAUDE_PROFILE_SAVE', () => {
    it('should save a new profile with generated ID', async () => {
      // Get the handler
      const handleProfileSave = handlers.get('claude:profileSave');
      expect(handleProfileSave).toBeDefined();

      const newProfile = createTestProfile({
        id: '', // No ID - should be generated
        name: 'New Account'
      });

      const result = await handleProfileSave?.(null, newProfile) as IPCResult<ClaudeProfile>;

      expect(result.success).toBe(true);
      expect(mockProfileManager.generateProfileId).toHaveBeenCalledWith('New Account');
      expect(mockProfileManager.saveProfile).toHaveBeenCalled();

      const savedProfile = mockProfileManager.saveProfile.mock.calls[0][0];
      expect(savedProfile.id).toBe('profile-new-account');
    });

    it('should save profile with existing ID', async () => {
      const handleProfileSave = handlers.get('claude:profileSave');
      expect(handleProfileSave).toBeDefined();

      const existingProfile = createTestProfile({
        id: 'existing-id',
        name: 'Existing Account'
      });

      const result = await handleProfileSave?.(null, existingProfile) as IPCResult<ClaudeProfile>;

      expect(result.success).toBe(true);
      expect(mockProfileManager.generateProfileId).not.toHaveBeenCalled();
      expect(mockProfileManager.saveProfile).toHaveBeenCalledWith(existingProfile);
    });

    it('should create config directory for non-default profiles', async () => {
      const handleProfileSave = handlers.get('claude:profileSave');
      expect(handleProfileSave).toBeDefined();

      const profile = createTestProfile({
        isDefault: false,
        configDir: path.join(TEST_DIR, 'new-profile-config')
      });

      await handleProfileSave?.(null, profile);

      // biome-ignore lint/style/noNonNullAssertion: Test file - configDir is set in createTestProfile
      expect(existsSync(profile.configDir!)).toBe(true);
    });

    it('should not create config directory for default profile', async () => {
      const handleProfileSave = handlers.get('claude:profileSave');
      expect(handleProfileSave).toBeDefined();

      const profile = createTestProfile({
        isDefault: true,
        configDir: path.join(TEST_DIR, 'should-not-exist')
      });

      await handleProfileSave?.(null, profile);

      // biome-ignore lint/style/noNonNullAssertion: Test file - configDir is set in createTestProfile
      expect(existsSync(profile.configDir!)).toBe(false);
    });

    it('should handle save errors gracefully', async () => {
      const handleProfileSave = handlers.get('claude:profileSave');
      expect(handleProfileSave).toBeDefined();

      mockProfileManager.saveProfile.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const profile = createTestProfile();
      const result = await handleProfileSave?.(null, profile) as IPCResult;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  // Note: CLAUDE_PROFILE_INITIALIZE tests were removed.
  // The handler was deprecated as part of the migration from setup-token to the
  // new /login OAuth flow. Profile initialization now happens automatically
  // during the /login flow in claude-code-handlers.ts.

  describe('IPC handler registration', () => {
    it('should register CLAUDE_PROFILE_SAVE handler', () => {
      expect(handlers.has('claude:profileSave')).toBe(true);
    });

    // Note: CLAUDE_PROFILE_INITIALIZE handler was removed as part of the
    // OAuth /login flow migration. Profile initialization now happens
    // automatically during the /login flow in claude-code-handlers.ts
  });
});
