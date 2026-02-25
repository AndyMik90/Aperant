/**
 * Process Kill Utility Tests
 *
 * Tests the killProcessGracefully utility for cross-platform process termination.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock getTaskkillExePath to return a predictable path for testing
vi.mock('../../utils/windows-paths', () => ({
  getTaskkillExePath: () => 'C:\\Windows\\System32\\taskkill.exe',
}));

// Mock child_process.spawn before importing the module
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => ({ unref: vi.fn() }))
  };
});

// Import after mocking
import { killProcessGracefully, GRACEFUL_KILL_TIMEOUT_MS } from '../index';
import { spawn } from 'child_process';

// Mock process.platform
const originalPlatform = process.platform;

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true
  });
}

describe('killProcessGracefully', () => {
  let mockProcess: ChildProcess;
  const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create a mock ChildProcess with EventEmitter capabilities
    mockProcess = Object.assign(new EventEmitter(), {
      pid: 12345,
      killed: false,
      kill: vi.fn(),
      stdin: null,
      stdout: null,
      stderr: null,
      stdio: [null, null, null, null, null],
      connected: false,
      exitCode: null,
      signalCode: null,
      spawnargs: [],
      spawnfile: '',
      send: vi.fn(),
      disconnect: vi.fn(),
      unref: vi.fn(),
      ref: vi.fn(),
      [Symbol.dispose]: vi.fn()
    }) as unknown as ChildProcess;
  });

  afterEach(() => {
    mockPlatform(originalPlatform);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('GRACEFUL_KILL_TIMEOUT_MS constant', () => {
    it('is defined and equals 5000', () => {
      expect(GRACEFUL_KILL_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      mockPlatform('win32');
    });

    it('calls process.kill() without signal argument', () => {
      killProcessGracefully(mockProcess);
      expect(mockProcess.kill).toHaveBeenCalledWith();
    });

    it('schedules taskkill as fallback after timeout', () => {
      killProcessGracefully(mockProcess);

      // Verify taskkill not called yet
      expect(mockSpawn).not.toHaveBeenCalled();

      // Advance past the timeout
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // Verify taskkill was called with correct arguments
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\taskkill.exe',
        ['/pid', '12345', '/f', '/t'],
        expect.objectContaining({
          stdio: 'ignore',
          detached: true
        })
      );
    });

    it('skips taskkill if process exits before timeout', () => {
      killProcessGracefully(mockProcess);

      // Simulate process exit before timeout
      mockProcess.emit('exit', 0);

      // Advance past the timeout
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // Verify taskkill was NOT called
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('runs taskkill even if .kill() throws (Issue #1 fix)', () => {
      // Make .kill() throw an error
      (mockProcess.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Process already dead');
      });

      // Should not throw
      expect(() => killProcessGracefully(mockProcess)).not.toThrow();

      // Advance past the timeout
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // taskkill should still be called - this is the key assertion for Issue #1
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\taskkill.exe',
        ['/pid', '12345', '/f', '/t'],
        expect.any(Object)
      );
    });

    it('does not schedule taskkill if pid is undefined', () => {
      const noPidProcess = Object.assign(new EventEmitter(), {
        pid: undefined,
        killed: false,
        kill: vi.fn()
      }) as unknown as ChildProcess;

      killProcessGracefully(noPidProcess);
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('on Unix (macOS/Linux)', () => {
    beforeEach(() => {
      mockPlatform('darwin');
    });

    it('calls process.kill(SIGTERM)', () => {
      killProcessGracefully(mockProcess);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('sends SIGKILL after timeout if process not killed', () => {
      killProcessGracefully(mockProcess);

      // First call should be SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);

      // Advance past the timeout
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // Second call should be SIGKILL
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockProcess.kill).toHaveBeenCalledTimes(2);
    });

    it('skips SIGKILL if process exits before timeout', () => {
      killProcessGracefully(mockProcess);

      // Simulate process exit before timeout
      mockProcess.emit('exit', 0);

      // Advance past the timeout
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // Only SIGTERM should have been called
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('skips SIGKILL if process.killed is true', () => {
      // Simulate process already killed
      Object.defineProperty(mockProcess, 'killed', { value: true });

      killProcessGracefully(mockProcess);
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);

      // Only initial SIGTERM call
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);
    });

    it('handles SIGKILL failure gracefully', () => {
      // Make SIGKILL throw
      let callCount = 0;
      (mockProcess.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Cannot kill dead process');
        }
      });

      killProcessGracefully(mockProcess);

      // Should not throw when SIGKILL fails
      expect(() => vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS)).not.toThrow();
    });
  });

  describe('options', () => {
    beforeEach(() => {
      mockPlatform('win32');
    });

    it('uses custom timeout when provided', () => {
      const customTimeout = 1000;
      killProcessGracefully(mockProcess, { timeoutMs: customTimeout });

      // Should not trigger at default timeout
      vi.advanceTimersByTime(customTimeout - 1);
      expect(mockSpawn).not.toHaveBeenCalled();

      // Should trigger at custom timeout
      vi.advanceTimersByTime(1);
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('logs debug messages when debug is enabled', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      killProcessGracefully(mockProcess, {
        debug: true,
        debugPrefix: '[TestPrefix]'
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[TestPrefix]',
        'Graceful kill signal sent'
      );

      warnSpy.mockRestore();
    });

    it('does not log when debug is disabled', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      killProcessGracefully(mockProcess, { debug: false });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('logs warning when process.once is unavailable (Issue #6 fix)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create process without .once method
      const processWithoutOnce = {
        pid: 12345,
        killed: false,
        kill: vi.fn()
      } as unknown as ChildProcess;

      killProcessGracefully(processWithoutOnce, {
        debug: true,
        debugPrefix: '[Test]'
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[Test]',
        'process.once unavailable, cannot track exit state'
      );

      warnSpy.mockRestore();
    });
  });

  describe('Linux-specific behavior', () => {
    beforeEach(() => {
      mockPlatform('linux');
    });

    it('behaves the same as macOS', () => {
      killProcessGracefully(mockProcess);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('timer cleanup (memory leak prevention)', () => {
    beforeEach(() => {
      mockPlatform('win32');
    });

    it('clears timeout when process exits before timeout fires', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      killProcessGracefully(mockProcess);

      // Simulate process exit before timeout
      mockProcess.emit('exit', 0);

      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('clears timeout when process emits error', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      killProcessGracefully(mockProcess);

      // Simulate process error before timeout
      mockProcess.emit('error', new Error('spawn failed'));

      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Advance past timeout - should not call taskkill
      vi.advanceTimersByTime(GRACEFUL_KILL_TIMEOUT_MS);
      expect(mockSpawn).not.toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('unrefs timer to not block Node.js exit', () => {
      // Create a mock timer with unref
      const mockUnref = vi.fn();
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
        const timer = originalSetTimeout(fn, ms);
        timer.unref = mockUnref;
        return timer;
      });

      killProcessGracefully(mockProcess);

      // Timer should have been unref'd
      expect(mockUnref).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
