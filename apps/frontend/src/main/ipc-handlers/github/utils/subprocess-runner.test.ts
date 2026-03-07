
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPythonSubprocess } from './subprocess-runner';
import * as childProcess from 'child_process';
import EventEmitter from 'events';

// Mock child_process with importOriginal to preserve all exports
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    exec: vi.fn(),
  };
});

// Mock parsePythonCommand
vi.mock('../../../python-detector', () => ({
  parsePythonCommand: vi.fn((path) => {
    // specific behavior for spaced paths can be mocked here or overwridden in tests
    if (path.includes(' ')) {
        return [path, []]; // Simple pass-through for test
    }
    return [path, []];
  }),
}));

// Mock rate-limit-detector for auth failure tests
vi.mock('../../../rate-limit-detector', () => ({
  detectAuthFailure: vi.fn(() => ({ isAuthFailure: false })),
}));

// Mock claude-profile-manager
vi.mock('../../../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => ({
    getProfile: vi.fn(() => ({ id: 'test-profile', name: 'Test Profile' })),
    getActiveProfile: vi.fn(() => ({ id: 'test-profile', name: 'Test Profile' })),
  })),
}));

// Mock platform module
vi.mock('../../../platform', () => ({
  isWindows: vi.fn(() => false),
}));

import { parsePythonCommand } from '../../../python-detector';
import { detectAuthFailure } from '../../../rate-limit-detector';
import { isWindows } from '../../../platform';

describe('runPythonSubprocess', () => {
  let mockSpawn: any;
  let mockChildProcess: any;

  beforeEach(() => {
    mockSpawn = vi.mocked(childProcess.spawn);
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
    mockSpawn.mockReturnValue(mockChildProcess);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle python path with spaces', async () => {
    // Arrange
    const pythonPath = '/path/with spaces/python';
    const mockArgs = ['-c', 'print("hello")'];

    // Mock parsePythonCommand to return the path split logic if needed,
    // or just rely on the mock above.
    // Let's make sure our mock enables the scenario we want.
    vi.mocked(parsePythonCommand).mockReturnValue(['/path/with spaces/python', []]);

    // Act
    runPythonSubprocess({
      pythonPath,
      args: mockArgs,
      cwd: '/tmp',
    });

    // Assert
    expect(parsePythonCommand).toHaveBeenCalledWith(pythonPath);
    expect(mockSpawn).toHaveBeenCalledWith(
      '/path/with spaces/python',
      expect.arrayContaining(mockArgs),
      expect.any(Object)
    );
  });

  it('should pass user arguments AFTER python arguments', async () => {
    // Arrange
    const pythonPath = 'python';
    const pythonBaseArgs = ['-u', '-X', 'utf8'];
    const userArgs = ['script.py', '--verbose'];

    // Setup mock to simulate what parsePythonCommand would return for a standard python path
    vi.mocked(parsePythonCommand).mockReturnValue(['python', pythonBaseArgs]);

    // Act
    runPythonSubprocess({
      pythonPath,
      args: userArgs,
      cwd: '/tmp',
    });

    // Assert
    // The critical check: verify the ORDER of arguments in the second parameter of spawn
    // expect call to be: spawn('python', ['-u', '-X', 'utf8', 'script.py', '--verbose'], ...)
    const expectedArgs = [...pythonBaseArgs, ...userArgs];

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expectedArgs, // Exact array match verifies order
      expect.any(Object)
    );
  });

  describe('environment handling', () => {
    it('should use caller-provided env directly when options.env is set', () => {
      // Arrange
      const customEnv = {
        PATH: '/custom/path',
        PYTHONPATH: '/custom/pythonpath',
        ANTHROPIC_AUTH_TOKEN: 'custom-token',
      };
      vi.mocked(parsePythonCommand).mockReturnValue(['python', []]);

      // Act
      runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        env: customEnv,
      });

      // Assert - should use the exact env provided
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: customEnv,
        })
      );
    });

    it('should create fallback env when options.env is not provided', () => {
      // Arrange
      const originalEnv = process.env;
      try {
        process.env = {
          PATH: '/usr/bin',
          HOME: '/home/user',
          USER: 'testuser',
          SHELL: '/bin/bash',
          LANG: 'en_US.UTF-8',
          CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
          ANTHROPIC_API_KEY: 'api-key',
          SENSITIVE_VAR: 'should-not-leak',
        };

        vi.mocked(parsePythonCommand).mockReturnValue(['python', []]);

        // Act
        runPythonSubprocess({
          pythonPath: 'python',
          args: ['script.py'],
          cwd: '/tmp',
          // No env provided - should use fallback
        });

        // Assert - should only include safe vars
        const spawnCall = mockSpawn.mock.calls[0];
        const envArg = spawnCall[2].env;

        // Safe vars should be included
        expect(envArg.PATH).toBe('/usr/bin');
        expect(envArg.HOME).toBe('/home/user');
        expect(envArg.USER).toBe('testuser');

        // CLAUDE_ and ANTHROPIC_ prefixed vars should be included
        expect(envArg.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token');
        expect(envArg.ANTHROPIC_API_KEY).toBe('api-key');

        // Sensitive vars should NOT be included
        expect(envArg.SENSITIVE_VAR).toBeUndefined();
      } finally {
        // Restore - always runs even if assertions fail
        process.env = originalEnv;
      }
    });

    it('fallback env should include platform-specific vars on Windows', () => {
      // Arrange
      const originalEnv = process.env;
      try {
        process.env = {
          PATH: 'C:\\Windows\\System32',
          SYSTEMROOT: 'C:\\Windows',
          COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
          PATHEXT: '.COM;.EXE;.BAT',
          WINDIR: 'C:\\Windows',
          USERPROFILE: 'C:\\Users\\test',
          APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        };

        vi.mocked(parsePythonCommand).mockReturnValue(['python', []]);

        // Act
        runPythonSubprocess({
          pythonPath: 'python',
          args: ['script.py'],
          cwd: '/tmp',
          // No env provided - should use fallback
        });

        // Assert - Windows-specific vars should be included
        const spawnCall = mockSpawn.mock.calls[0];
        const envArg = spawnCall[2].env;

        expect(envArg.SYSTEMROOT).toBe('C:\\Windows');
        expect(envArg.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
        expect(envArg.PATHEXT).toBe('.COM;.EXE;.BAT');
        expect(envArg.USERPROFILE).toBe('C:\\Users\\test');
        expect(envArg.APPDATA).toBe('C:\\Users\\test\\AppData\\Roaming');
      } finally {
        // Restore - always runs even if assertions fail
        process.env = originalEnv;
      }
    });
  });

  describe('auth failure detection', () => {
    beforeEach(() => {
      vi.mocked(parsePythonCommand).mockReturnValue(['python', []]);
      vi.mocked(isWindows).mockReturnValue(false);
      // Reset detectAuthFailure mock
      vi.mocked(detectAuthFailure).mockReturnValue({ isAuthFailure: false });
    });

    it('should call onAuthFailure callback when auth failure is detected in stdout', async () => {
      // Arrange
      const onAuthFailure = vi.fn();
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'expired',
        message: 'OAuth token has expired',
        profileId: 'test-profile',
      });

      mockChildProcess.pid = 12345;
      // Mock process.kill to prevent ESRCH error
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      // Simulate stdout with auth failure message
      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));

      // Simulate process exit (killed due to auth failure)
      mockChildProcess.emit('close', null);

      const result = await resultPromise;

      // Assert
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(onAuthFailure).toHaveBeenCalledWith(expect.objectContaining({
        profileId: 'test-profile',
        failureType: 'expired',
        message: 'OAuth token has expired',
      }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed. Please re-authenticate.');
    });

    it('should call onAuthFailure callback when auth failure is detected in stderr', async () => {
      // Arrange
      const onAuthFailure = vi.fn();
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'invalid',
        message: '401 Unauthorized',
        profileId: 'test-profile',
      });

      mockChildProcess.pid = 12345;
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      // Simulate stderr with auth failure message
      mockChildProcess.stderr.emit('data', Buffer.from('API Error: 401 Unauthorized\n'));

      // Simulate process exit
      mockChildProcess.emit('close', null);

      const result = await resultPromise;

      // Assert
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('should emit auth failure only once even with multiple auth errors', async () => {
      // Arrange
      const onAuthFailure = vi.fn();
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'expired',
        message: 'OAuth token has expired',
      });

      mockChildProcess.pid = 12345;
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      // Simulate multiple auth failure messages (as might happen in a retry loop)
      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));
      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));
      mockChildProcess.stderr.emit('data', Buffer.from('OAuth token has expired\n'));

      mockChildProcess.emit('close', null);

      await resultPromise;

      // Assert - should only be called once despite multiple auth errors
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('should attempt to kill process on auth failure', async () => {
      // Arrange
      const onAuthFailure = vi.fn();
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'expired',
        message: 'OAuth token has expired',
      });

      mockChildProcess.pid = 12345;
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));
      mockChildProcess.emit('close', null);

      await resultPromise;

      // Assert - should attempt process group kill on Unix (negative PID)
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');

      killSpy.mockRestore();
    });

    it('should not call onAuthFailure when no auth failure is detected', async () => {
      // Arrange
      const onAuthFailure = vi.fn();
      vi.mocked(detectAuthFailure).mockReturnValue({ isAuthFailure: false });

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      // Simulate normal output
      mockChildProcess.stdout.emit('data', Buffer.from('Processing...\n'));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Assert
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle onAuthFailure callback throwing an error gracefully', async () => {
      // Arrange
      const onAuthFailure = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'expired',
        message: 'OAuth token has expired',
      });

      mockChildProcess.pid = 12345;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure,
      });

      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));
      mockChildProcess.emit('close', null);

      const result = await resultPromise;

      // Assert - should still kill the process even if callback throws
      expect(consoleSpy).toHaveBeenCalledWith(
        '[SubprocessRunner] onAuthFailure callback threw:',
        expect.any(Error)
      );
      expect(result.success).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should set result.error when killedDueToAuthFailure is true', async () => {
      // Arrange
      vi.mocked(detectAuthFailure).mockReturnValue({
        isAuthFailure: true,
        failureType: 'expired',
        message: 'OAuth token has expired',
      });

      mockChildProcess.pid = 12345;
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Act
      const { promise: resultPromise } = runPythonSubprocess({
        pythonPath: 'python',
        args: ['script.py'],
        cwd: '/tmp',
        onAuthFailure: vi.fn(),
      });

      mockChildProcess.stdout.emit('data', Buffer.from('OAuth token has expired\n'));
      // Process killed with SIGKILL returns null exit code
      mockChildProcess.emit('close', null);

      const result = await resultPromise;

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed. Please re-authenticate.');
      expect(result.exitCode).toBe(-1); // null coerced to -1
    });
  });
});
