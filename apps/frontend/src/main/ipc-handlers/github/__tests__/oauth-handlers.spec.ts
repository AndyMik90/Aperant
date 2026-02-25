/**
 * Unit tests for GitHub OAuth handlers
 * Tests device code parsing, shell.openExternal handling, and error recovery
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process before importing
const mockSpawn = vi.fn();
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
const mockExecFile = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
    execSync: (...args: unknown[]) => mockExecSync(...args),
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
    execFile: (...args: unknown[]) => mockExecFile(...args)
  };
});

// Mock shell.openExternal
const mockOpenExternal = vi.fn();

vi.mock('electron', () => {
  const mockIpcMain = new (class extends EventEmitter {
    private handlers: Map<string, Function> = new Map();

    handle(channel: string, handler: Function): void {
      this.handlers.set(channel, handler);
    }

    removeHandler(channel: string): void {
      this.handlers.delete(channel);
    }

    async invokeHandler(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler) {
        return handler(event, ...args);
      }
      throw new Error(`No handler for channel: ${channel}`);
    }

    getHandler(channel: string): Function | undefined {
      return this.handlers.get(channel);
    }
  })();

  // Mock BrowserWindow for sendDeviceCodeToRenderer
  const mockBrowserWindow = {
    getAllWindows: () => [{
      webContents: {
        send: vi.fn()
      }
    }]
  };

  return {
    ipcMain: mockIpcMain,
    shell: {
      openExternal: (...args: unknown[]) => mockOpenExternal(...args)
    },
    BrowserWindow: mockBrowserWindow
  };
});

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    windows: process.platform === 'win32',
    macos: process.platform === 'darwin',
    linux: process.platform === 'linux'
  }
}));

// Mock env-utils
const mockFindExecutable = vi.fn();
const mockGetAugmentedEnv = vi.fn();

vi.mock('../../../env-utils', () => ({
  findExecutable: mockFindExecutable,
  getAugmentedEnv: mockGetAugmentedEnv,
  isCommandAvailable: vi.fn((cmd: string) => mockFindExecutable(cmd) !== null)
}));

// Mock cli-tool-manager to avoid child_process import issues
vi.mock('../../../cli-tool-manager', () => ({
  getToolPath: vi.fn(() => '/usr/local/bin/gh'),
  detectCLITools: vi.fn(),
  getAllToolStatus: vi.fn()
}));

// Create mock process for spawn
function createMockProcess(): EventEmitter & {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } | null;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } | null;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  return proc;
}

// Helper to wait for async setup (getCurrentGitHubUsername) to complete
// This is needed because the handler now awaits async operations before spawning
const waitForAsyncSetup = () => new Promise(resolve => setTimeout(resolve, 20));

describe('GitHub OAuth Handlers', () => {
  let ipcMain: EventEmitter & {
    handlers: Map<string, Function>;
    invokeHandler: (channel: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
    getHandler: (channel: string) => Function | undefined;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up default env-utils mocks
    mockGetAugmentedEnv.mockReturnValue(process.env as Record<string, string>);
    mockFindExecutable.mockReturnValue(null); // Default: executable not found

    // Set up default execFile mock for getCurrentGitHubUsername (async)
    // This returns null by default (not authenticated)
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _options: unknown,
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        // If callback provided, call it with error to simulate not authenticated
        if (callback) {
          callback(new Error('not authenticated'), '', '');
        }
        // Return a mock ChildProcess-like object
        return { on: vi.fn(), stdout: null, stderr: null };
      }
    );

    // Get mocked ipcMain
    const electron = await import('electron');
    ipcMain = electron.ipcMain as unknown as typeof ipcMain;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Device Code Parsing', () => {
    it('should parse device code from standard gh CLI output format', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      // Start the handler
      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup (getCurrentGitHubUsername) to complete
      await waitForAsyncSetup();

      // Simulate gh CLI output with device code
      mockProcess.stderr?.emit('data', '! First copy your one-time code: ABCD-1234\n');
      mockProcess.stderr?.emit('data', '- Press Enter to open github.com in your browser...\n');

      // Complete the process
      mockProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');
      const data = (result as { data: { deviceCode: string } }).data;
      expect(data.deviceCode).toBe('ABCD-1234');
    });

    it('should parse device code from alternate output format (lowercase "code")', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      // Alternate format: "code: XXXX-XXXX" without "one-time"
      mockProcess.stderr?.emit('data', 'Enter the code: EFGH-5678\n');
      mockProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { deviceCode: string } }).data;
      expect(data.deviceCode).toBe('EFGH-5678');
    });

    it('should parse device code from stdout (not just stderr)', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      // Device code in stdout instead of stderr
      mockProcess.stdout?.emit('data', '! First copy your one-time code: IJKL-9012\n');
      mockProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { deviceCode: string } }).data;
      expect(data.deviceCode).toBe('IJKL-9012');
    });

    it('should handle output without device code gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      // Output without device code
      mockProcess.stderr?.emit('data', 'Some other message\n');
      mockProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { deviceCode?: string } }).data;
      expect(data.deviceCode).toBeUndefined();
    });

    it('should extract URL from output containing https://github.com/login/device', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: MNOP-3456\n');
      mockProcess.stderr?.emit('data', 'Then visit https://github.com/login/device to authenticate\n');
      mockProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { authUrl: string } }).data;
      expect(data.authUrl).toBe('https://github.com/login/device');
    });
  });

  describe('shell.openExternal Handling', () => {
    it('should call shell.openExternal with extracted URL when device code found', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: QRST-7890\n');

      // Wait for async browser opening
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.emit('close', 0);
      await resultPromise;

      expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com/login/device');
    });

    it('should set browserOpened to true when shell.openExternal succeeds', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: UVWX-1234\n');

      // Wait for async browser opening
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.emit('close', 0);
      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { browserOpened: boolean } }).data;
      expect(data.browserOpened).toBe(true);
    });

    it('should set browserOpened to false when shell.openExternal fails', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockRejectedValue(new Error('Failed to open browser'));

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: YZAB-5678\n');

      // Wait for async browser opening to fail
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.emit('close', 0);
      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { browserOpened: boolean } }).data;
      expect(data.browserOpened).toBe(false);
    });

    it('should provide fallbackUrl when browser fails to open', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockRejectedValue(new Error('Failed to open browser'));

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: CDEF-9012\n');

      // Wait for async browser opening to fail
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.emit('close', 0);
      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { fallbackUrl?: string } }).data;
      expect(data.fallbackUrl).toBe('https://github.com/login/device');
    });

    it('should not provide fallbackUrl when browser opens successfully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', '! First copy your one-time code: GHIJ-3456\n');

      // Wait for async browser opening
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.emit('close', 0);
      const result = await resultPromise;

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { fallbackUrl?: string } }).data;
      expect(data.fallbackUrl).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle gh CLI process error', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      // Emit error event
      mockProcess.emit('error', new Error('spawn gh ENOENT'));

      const result = await resultPromise;

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error', 'spawn gh ENOENT');
      const data = (result as { data: { fallbackUrl: string } }).data;
      expect(data.fallbackUrl).toBe('https://github.com/login/device');
    });

    it('should handle non-zero exit code', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.stderr?.emit('data', 'error: some authentication error\n');
      mockProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', false);
      const data = (result as { data: { fallbackUrl: string } }).data;
      expect(data.fallbackUrl).toBe('https://github.com/login/device');
    });

    it('should include device code in error result if it was extracted before failure', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockOpenExternal.mockResolvedValue(undefined);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      // Device code output followed by failure
      mockProcess.stderr?.emit('data', '! First copy your one-time code: KLMN-7890\n');

      // Wait for async browser opening
      await new Promise(resolve => setTimeout(resolve, 10));

      mockProcess.stderr?.emit('data', 'error: authentication failed\n');
      mockProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result).toHaveProperty('success', false);
      const data = (result as { data: { deviceCode: string; fallbackUrl: string } }).data;
      expect(data.deviceCode).toBe('KLMN-7890');
      expect(data.fallbackUrl).toBe('https://github.com/login/device');
    });

    it('should provide user-friendly error message on process spawn failure', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for async setup
      await waitForAsyncSetup();

      mockProcess.emit('error', new Error('spawn gh ENOENT'));

      const result = await resultPromise;

      expect(result).toHaveProperty('success', false);
      const data = (result as { data: { message: string } }).data;
      expect(data.message).toContain('Failed to start GitHub CLI');
    });
  });

  describe('gh CLI Check Handler', () => {
    it('should return installed: true when gh CLI is found', async () => {
      // Mock findExecutable to return gh path
      mockFindExecutable.mockReturnValue('/usr/local/bin/gh');

      // Mock execFileSync for version check
      mockExecFileSync.mockImplementation((_cmd: string, args?: string[]) => {
        if (args && args[0] === '--version') {
          return 'gh version 2.65.0 (2024-01-15)\n';
        }
        return '';
      });

      const { registerCheckGhCli } = await import('../oauth-handlers');
      registerCheckGhCli();

      const result = await ipcMain.invokeHandler('github:checkCli', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { installed: boolean; version: string } }).data;
      expect(data.installed).toBe(true);
      expect(data.version).toContain('gh version');
    });

    it('should return installed: false when gh CLI is not found', async () => {
      // Mock findExecutable to return null (not found)
      mockFindExecutable.mockReturnValue(null);

      const { registerCheckGhCli } = await import('../oauth-handlers');
      registerCheckGhCli();

      const result = await ipcMain.invokeHandler('github:checkCli', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { installed: boolean } }).data;
      expect(data.installed).toBe(false);
    });
  });

  describe('gh Auth Check Handler', () => {
    it('should return authenticated: true with username when logged in', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args?: string[]) => {
        if (args && args[0] === 'auth' && args[1] === 'status') {
          return 'Logged in to github.com as testuser\n';
        }
        if (args && args[0] === 'api' && args[1] === 'user' && args[2] === '--jq' && args[3] === '.login') {
          return 'testuser\n';
        }
        return '';
      });

      const { registerCheckGhAuth } = await import('../oauth-handlers');
      registerCheckGhAuth();

      const result = await ipcMain.invokeHandler('github:checkAuth', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { authenticated: boolean; username: string } }).data;
      expect(data.authenticated).toBe(true);
      expect(data.username).toBe('testuser');
    });

    it('should return authenticated: false when not logged in', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('You are not logged into any GitHub hosts');
      });

      const { registerCheckGhAuth } = await import('../oauth-handlers');
      registerCheckGhAuth();

      const result = await ipcMain.invokeHandler('github:checkAuth', {});

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: { authenticated: boolean } }).data;
      expect(data.authenticated).toBe(false);
    });
  });

  describe('Spawn Arguments', () => {
    it('should spawn gh with correct auth login arguments', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const { registerStartGhAuth } = await import('../oauth-handlers');
      registerStartGhAuth();

      // Start the handler (this is async due to getCurrentGitHubUsername)
      const resultPromise = ipcMain.invokeHandler('github:startAuth', {});

      // Wait for the async getCurrentGitHubUsername to complete and spawn to be called
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['auth', 'login', '--web', '--scopes', 'repo'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe']
        })
      );

      // Complete the process to avoid hanging promise
      mockProcess.emit('close', 0);
      await resultPromise;
    });
  });

  describe('Repository Validation', () => {
    it('should reject invalid repository format', async () => {
      const { registerGetGitHubBranches } = await import('../oauth-handlers');
      registerGetGitHubBranches();

      // Test with injection attempt
      const result = await ipcMain.invokeHandler(
        'github:getBranches',
        {},
        'owner/repo; rm -rf /',
        'token'
      );

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error', 'Invalid repository format. Expected: owner/repo');
    });

    it('should accept valid repository format', async () => {
      mockExecFileSync.mockReturnValue('main\nfeature-branch\n');

      const { registerGetGitHubBranches } = await import('../oauth-handlers');
      registerGetGitHubBranches();

      const result = await ipcMain.invokeHandler(
        'github:getBranches',
        {},
        'valid-owner/valid-repo',
        'token'
      );

      expect(result).toHaveProperty('success', true);
      const data = (result as { data: string[] }).data;
      expect(data).toContain('main');
      expect(data).toContain('feature-branch');
    });
  });
});
