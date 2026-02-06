/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for useGlobalTerminalListeners hook
 * Tests global terminal output listener registration and cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock terminal-store module
vi.mock('../../stores/terminal-store', () => ({
  writeToTerminal: vi.fn(),
}));

// Mock terminal-buffer-manager module
vi.mock('../../lib/terminal-buffer-manager', () => ({
  terminalBufferManager: {
    getSize: vi.fn(() => 100),
  },
}));

// Mock debug-logger module
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

describe('useGlobalTerminalListeners', () => {
  let mockOnTerminalOutput: ReturnType<typeof vi.fn>;
  let mockCleanupFn: ReturnType<typeof vi.fn>;
  let terminalOutputCallback: ((terminalId: string, data: string) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the module-level globalCleanup by re-importing
    // This ensures tests don't interfere with each other
    terminalOutputCallback = null;
    mockCleanupFn = vi.fn();

    // Mock window.electronAPI.onTerminalOutput
    mockOnTerminalOutput = vi.fn((callback: (terminalId: string, data: string) => void) => {
      terminalOutputCallback = callback;
      return mockCleanupFn;
    });

    // Ensure window and electronAPI exist
    if (typeof window === 'undefined') {
      (global as { window: unknown }).window = {};
    }

    (window as unknown as { electronAPI: { onTerminalOutput: typeof mockOnTerminalOutput } }).electronAPI = {
      onTerminalOutput: mockOnTerminalOutput,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    terminalOutputCallback = null;
  });

  describe('listener registration', () => {
    it('should register global terminal output listener on mount', async () => {
      // Need to reset the module to clear globalCleanup state
      vi.resetModules();

      // Re-mock after reset - use vi.fn() directly
      const mockWriteToTerminal = vi.fn();
      const mockGetSize = vi.fn(() => 100);
      const mockDebugLog = vi.fn();
      const mockDebugWarn = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: mockGetSize },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog,
        debugWarn: mockDebugWarn,
      }));

      // Re-import the hook after mocking
      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      expect(mockOnTerminalOutput).toHaveBeenCalledTimes(1);
      expect(mockOnTerminalOutput).toHaveBeenCalledWith(expect.any(Function));
      expect(mockDebugLog).toHaveBeenCalledWith(
        '[GlobalTerminalListeners] Registering global terminal output listener'
      );
    });

    it('should skip registration if listener already registered', async () => {
      vi.resetModules();

      const mockDebugLog = vi.fn();
      const mockDebugWarn = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: vi.fn(),
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog,
        debugWarn: mockDebugWarn,
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      // First mount
      const { unmount: unmount1 } = renderHook(() => freshHook());

      // Second mount without unmounting first - should skip registration
      renderHook(() => freshHook());

      // Should only register once
      expect(mockOnTerminalOutput).toHaveBeenCalledTimes(1);
      expect(mockDebugWarn).toHaveBeenCalledWith(
        '[GlobalTerminalListeners] Listener already registered, skipping'
      );

      // Cleanup
      unmount1();
    });
  });

  describe('terminal output handling', () => {
    it('should call writeToTerminal when output is received', async () => {
      vi.resetModules();

      const mockWriteToTerminal = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate terminal output
      expect(terminalOutputCallback).not.toBeNull();
      terminalOutputCallback?.('terminal-123', 'Hello, World!');

      expect(mockWriteToTerminal).toHaveBeenCalledWith('terminal-123', 'Hello, World!');
    });

    it('should log output processing with buffer size', async () => {
      vi.resetModules();

      const mockDebugLog = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: vi.fn(),
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog,
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate terminal output
      terminalOutputCallback?.('terminal-456', 'Test output');

      expect(mockDebugLog).toHaveBeenCalledWith(
        '[GlobalTerminalListeners] Processed output for terminal-456, buffer size: 100'
      );
    });

    it('should handle multiple terminals', async () => {
      vi.resetModules();

      const mockWriteToTerminal = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate output from multiple terminals
      terminalOutputCallback?.('terminal-1', 'Output 1');
      terminalOutputCallback?.('terminal-2', 'Output 2');
      terminalOutputCallback?.('terminal-3', 'Output 3');

      expect(mockWriteToTerminal).toHaveBeenCalledTimes(3);
      expect(mockWriteToTerminal).toHaveBeenNthCalledWith(1, 'terminal-1', 'Output 1');
      expect(mockWriteToTerminal).toHaveBeenNthCalledWith(2, 'terminal-2', 'Output 2');
      expect(mockWriteToTerminal).toHaveBeenNthCalledWith(3, 'terminal-3', 'Output 3');
    });
  });

  describe('cleanup', () => {
    it('should cleanup listener on unmount', async () => {
      vi.resetModules();

      const mockDebugLog = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: vi.fn(),
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog,
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      const { unmount } = renderHook(() => freshHook());

      // Unmount
      unmount();

      expect(mockCleanupFn).toHaveBeenCalledTimes(1);
      expect(mockDebugLog).toHaveBeenCalledWith(
        '[GlobalTerminalListeners] Cleaning up global terminal output listener'
      );
    });

    it('should allow re-registration after cleanup', async () => {
      vi.resetModules();

      const mockDebugLog1 = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: vi.fn(),
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog1,
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      // First mount and unmount
      const { unmount: unmount1 } = renderHook(() => freshHook());
      unmount1();

      // Clear call counts
      mockOnTerminalOutput.mockClear();

      // Need to reset modules again to clear the globalCleanup state
      vi.resetModules();

      const mockDebugLog2 = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: vi.fn(),
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: mockDebugLog2,
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook2 } = await import('../useGlobalTerminalListeners');

      // Second mount should register successfully
      renderHook(() => freshHook2());

      expect(mockOnTerminalOutput).toHaveBeenCalledTimes(1);
      expect(mockDebugLog2).toHaveBeenCalledWith(
        '[GlobalTerminalListeners] Registering global terminal output listener'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty data string', async () => {
      vi.resetModules();

      const mockWriteToTerminal = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate empty output
      terminalOutputCallback?.('terminal-123', '');

      expect(mockWriteToTerminal).toHaveBeenCalledWith('terminal-123', '');
    });

    it('should handle special characters in terminal output', async () => {
      vi.resetModules();

      const mockWriteToTerminal = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate output with ANSI escape codes and special characters
      const specialOutput = '\x1b[32mGreen text\x1b[0m\nNew line\t\ttabs';
      terminalOutputCallback?.('terminal-123', specialOutput);

      expect(mockWriteToTerminal).toHaveBeenCalledWith('terminal-123', specialOutput);
    });

    it('should handle rapid successive outputs', async () => {
      vi.resetModules();

      const mockWriteToTerminal = vi.fn();

      vi.doMock('../../stores/terminal-store', () => ({
        writeToTerminal: mockWriteToTerminal,
      }));
      vi.doMock('../../lib/terminal-buffer-manager', () => ({
        terminalBufferManager: { getSize: vi.fn(() => 100) },
      }));
      vi.doMock('../../../shared/utils/debug-logger', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
      }));

      const { useGlobalTerminalListeners: freshHook } = await import('../useGlobalTerminalListeners');

      renderHook(() => freshHook());

      // Simulate rapid outputs
      for (let i = 0; i < 100; i++) {
        terminalOutputCallback?.('terminal-123', `Line ${i}\n`);
      }

      expect(mockWriteToTerminal).toHaveBeenCalledTimes(100);
    });
  });
});
