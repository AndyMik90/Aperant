/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for terminal-store callback registration functions
 * Tests registerOutputCallback, unregisterOutputCallback, and writeToTerminal
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock terminal-buffer-manager module
vi.mock('../../lib/terminal-buffer-manager', () => ({
  terminalBufferManager: {
    append: vi.fn(),
    getSize: vi.fn(() => 100),
    get: vi.fn(() => ''),
    set: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  },
}));

// Mock debug-logger module
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

// Mock uuid for zustand store
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Mock @dnd-kit/sortable for zustand store
vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: vi.fn((arr, from, to) => {
    const result = [...arr];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
  }),
}));

describe('terminal-store callback registration functions', () => {
  let registerOutputCallback: typeof import('../terminal-store').registerOutputCallback;
  let unregisterOutputCallback: typeof import('../terminal-store').unregisterOutputCallback;
  let writeToTerminal: typeof import('../terminal-store').writeToTerminal;
  let mockTerminalBufferManager: {
    append: ReturnType<typeof vi.fn>;
    getSize: ReturnType<typeof vi.fn>;
  };
  let mockDebugLog: ReturnType<typeof vi.fn>;
  let mockDebugError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-mock after reset to ensure fresh state
    mockDebugLog = vi.fn();
    mockDebugError = vi.fn();

    vi.doMock('../../../shared/utils/debug-logger', () => ({
      debugLog: mockDebugLog,
      debugError: mockDebugError,
    }));

    mockTerminalBufferManager = {
      append: vi.fn(),
      getSize: vi.fn(() => 100),
    };

    vi.doMock('../../lib/terminal-buffer-manager', () => ({
      terminalBufferManager: {
        ...mockTerminalBufferManager,
        get: vi.fn(() => ''),
        set: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
      },
    }));

    vi.doMock('uuid', () => ({
      v4: vi.fn(() => 'mock-uuid-1234'),
    }));

    vi.doMock('@dnd-kit/sortable', () => ({
      arrayMove: vi.fn((arr: unknown[], from: number, to: number) => {
        const result = [...arr];
        const [item] = result.splice(from, 1);
        result.splice(to, 0, item);
        return result;
      }),
    }));

    // Import fresh module
    const storeModule = await import('../terminal-store');
    registerOutputCallback = storeModule.registerOutputCallback;
    unregisterOutputCallback = storeModule.unregisterOutputCallback;
    writeToTerminal = storeModule.writeToTerminal;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerOutputCallback', () => {
    it('should store callback for terminal ID', async () => {
      const callback = vi.fn();

      registerOutputCallback('terminal-123', callback);

      expect(mockDebugLog).toHaveBeenCalledWith(
        '[TerminalStore] Registered output callback for terminal: terminal-123'
      );
    });

    it('should overwrite existing callback when registering same terminal ID', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registerOutputCallback('terminal-123', callback1);
      registerOutputCallback('terminal-123', callback2);

      // Both registrations should log
      expect(mockDebugLog).toHaveBeenCalledTimes(2);

      // Write should only call the latest callback
      writeToTerminal('terminal-123', 'test');
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('test');
    });

    it('should support multiple terminal callbacks simultaneously', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      registerOutputCallback('terminal-1', callback1);
      registerOutputCallback('terminal-2', callback2);
      registerOutputCallback('terminal-3', callback3);

      // Write to each terminal
      writeToTerminal('terminal-1', 'data1');
      writeToTerminal('terminal-2', 'data2');
      writeToTerminal('terminal-3', 'data3');

      expect(callback1).toHaveBeenCalledWith('data1');
      expect(callback2).toHaveBeenCalledWith('data2');
      expect(callback3).toHaveBeenCalledWith('data3');
    });
  });

  describe('unregisterOutputCallback', () => {
    it('should remove callback for terminal ID', async () => {
      const callback = vi.fn();

      registerOutputCallback('terminal-123', callback);
      unregisterOutputCallback('terminal-123');

      expect(mockDebugLog).toHaveBeenCalledWith(
        '[TerminalStore] Unregistered output callback for terminal: terminal-123'
      );

      // Writing after unregistration should not call callback
      writeToTerminal('terminal-123', 'test');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle unregistering non-existent terminal ID gracefully', async () => {
      // Should not throw
      expect(() => {
        unregisterOutputCallback('non-existent-terminal');
      }).not.toThrow();

      expect(mockDebugLog).toHaveBeenCalledWith(
        '[TerminalStore] Unregistered output callback for terminal: non-existent-terminal'
      );
    });

    it('should only unregister specified terminal ID', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registerOutputCallback('terminal-1', callback1);
      registerOutputCallback('terminal-2', callback2);

      unregisterOutputCallback('terminal-1');

      // terminal-1 callback should not be called
      writeToTerminal('terminal-1', 'data1');
      expect(callback1).not.toHaveBeenCalled();

      // terminal-2 callback should still work
      writeToTerminal('terminal-2', 'data2');
      expect(callback2).toHaveBeenCalledWith('data2');
    });
  });

  describe('writeToTerminal', () => {
    it('should call callback when registered', async () => {
      const callback = vi.fn();

      registerOutputCallback('terminal-123', callback);
      writeToTerminal('terminal-123', 'Hello, World!');

      expect(callback).toHaveBeenCalledWith('Hello, World!');
    });

    it('should always buffer data via terminalBufferManager', async () => {
      const callback = vi.fn();

      // Without callback registered
      writeToTerminal('terminal-no-callback', 'data1');
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-no-callback', 'data1');

      // With callback registered
      registerOutputCallback('terminal-with-callback', callback);
      writeToTerminal('terminal-with-callback', 'data2');
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-with-callback', 'data2');
    });

    it('should buffer but not call callback when not registered', async () => {
      // Write to terminal without registered callback
      writeToTerminal('unregistered-terminal', 'buffered-data');

      // Data should be buffered
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith(
        'unregistered-terminal',
        'buffered-data'
      );
    });

    it('should handle callback errors gracefully', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });

      registerOutputCallback('terminal-error', errorCallback);

      // Should not throw
      expect(() => {
        writeToTerminal('terminal-error', 'test');
      }).not.toThrow();

      // Error should be logged
      expect(mockDebugError).toHaveBeenCalledWith(
        '[TerminalStore] Error writing to terminal terminal-error:',
        expect.any(Error)
      );

      // Data should still be buffered
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-error', 'test');
    });

    it('should handle empty data string', async () => {
      const callback = vi.fn();

      registerOutputCallback('terminal-123', callback);
      writeToTerminal('terminal-123', '');

      expect(callback).toHaveBeenCalledWith('');
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-123', '');
    });

    it('should handle special characters and ANSI codes', async () => {
      const callback = vi.fn();
      const specialData = '\x1b[32mGreen text\x1b[0m\nNew line\t\ttabs\r\nCRLF';

      registerOutputCallback('terminal-123', callback);
      writeToTerminal('terminal-123', specialData);

      expect(callback).toHaveBeenCalledWith(specialData);
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-123', specialData);
    });

    it('should handle large data chunks', async () => {
      const callback = vi.fn();
      const largeData = 'x'.repeat(100000); // 100KB of data

      registerOutputCallback('terminal-123', callback);
      writeToTerminal('terminal-123', largeData);

      expect(callback).toHaveBeenCalledWith(largeData);
      expect(mockTerminalBufferManager.append).toHaveBeenCalledWith('terminal-123', largeData);
    });

    it('should handle rapid successive writes', async () => {
      const callback = vi.fn();

      registerOutputCallback('terminal-123', callback);

      // Simulate rapid writes
      for (let i = 0; i < 100; i++) {
        writeToTerminal('terminal-123', `Line ${i}\n`);
      }

      expect(callback).toHaveBeenCalledTimes(100);
      expect(mockTerminalBufferManager.append).toHaveBeenCalledTimes(100);
    });
  });

  describe('callback lifecycle', () => {
    it('should support register -> write -> unregister -> write flow', async () => {
      const callback = vi.fn();

      // Register callback
      registerOutputCallback('terminal-123', callback);

      // First write should call callback
      writeToTerminal('terminal-123', 'first');
      expect(callback).toHaveBeenCalledWith('first');
      expect(callback).toHaveBeenCalledTimes(1);

      // Unregister callback
      unregisterOutputCallback('terminal-123');

      // Second write should NOT call callback
      writeToTerminal('terminal-123', 'second');
      expect(callback).toHaveBeenCalledTimes(1); // Still 1

      // But data should still be buffered
      expect(mockTerminalBufferManager.append).toHaveBeenCalledTimes(2);
    });

    it('should support re-registration after unregister', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Register first callback
      registerOutputCallback('terminal-123', callback1);
      writeToTerminal('terminal-123', 'first');
      expect(callback1).toHaveBeenCalledWith('first');

      // Unregister
      unregisterOutputCallback('terminal-123');

      // Register new callback
      registerOutputCallback('terminal-123', callback2);
      writeToTerminal('terminal-123', 'second');

      // Only new callback should receive data
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledWith('second');
    });
  });

  describe('concurrent terminal operations', () => {
    it('should handle interleaved operations on multiple terminals', async () => {
      const callbacks = {
        t1: vi.fn(),
        t2: vi.fn(),
        t3: vi.fn(),
      };

      // Register all callbacks
      registerOutputCallback('t1', callbacks.t1);
      registerOutputCallback('t2', callbacks.t2);
      registerOutputCallback('t3', callbacks.t3);

      // Interleaved writes
      writeToTerminal('t1', 'a1');
      writeToTerminal('t2', 'b1');
      writeToTerminal('t1', 'a2');
      writeToTerminal('t3', 'c1');
      writeToTerminal('t2', 'b2');

      // Unregister one in the middle
      unregisterOutputCallback('t2');

      writeToTerminal('t1', 'a3');
      writeToTerminal('t2', 'b3'); // Should not call callback
      writeToTerminal('t3', 'c2');

      expect(callbacks.t1).toHaveBeenCalledTimes(3);
      expect(callbacks.t2).toHaveBeenCalledTimes(2); // b1, b2 only
      expect(callbacks.t3).toHaveBeenCalledTimes(2);

      // All data should be buffered
      expect(mockTerminalBufferManager.append).toHaveBeenCalledTimes(8);
    });
  });
});
