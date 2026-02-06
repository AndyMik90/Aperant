/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for useXterm keyboard handlers
 * Tests terminal copy/paste keyboard shortcuts and platform detection
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { Mock } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { useXterm } from '../useXterm';

// Mock xterm.js
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    loadAddon: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    paste: vi.fn(),
    input: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    dispose: vi.fn(),
    write: vi.fn(),
    cols: 80,
    rows: 24,
    options: {
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'monospace',
      fontWeight: 'normal',
      lineHeight: 1,
      letterSpacing: 0,
      theme: { cursorAccent: '#000000' },
      scrollback: 1000
    },
    refresh: vi.fn()
  }))
}));

// Mock xterm addons
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}));

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn().mockImplementation(() => ({
    serialize: vi.fn(() => ''),
    dispose: vi.fn()
  }))
}));

// Mock terminal buffer manager
vi.mock('../../../../lib/terminal-buffer-manager', () => ({
  terminalBufferManager: {
    get: vi.fn(() => ''),
    set: vi.fn(),
    clear: vi.fn()
  }
}));

// Mock navigator.platform for platform detection
const originalNavigatorPlatform = navigator.platform;

// Store original requestAnimationFrame for restoration after tests
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;

/**
 * Helper function to set up XTerm mocks and render the hook
 * Reduces test boilerplate from ~100 lines to ~20 lines per test
 */
async function setupMockXterm(overrides: {
  hasSelection?: () => boolean;
  getSelection?: () => string;
  paste?: ReturnType<typeof vi.fn>;
  input?: ReturnType<typeof vi.fn>;
} = {}) {
  let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;

  // Override XTerm mock to be constructable
  (XTerm as unknown as Mock).mockImplementation(function() {
    return {
      open: vi.fn(),
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        keyEventHandler = handler;
      }),
      hasSelection: overrides.hasSelection ?? vi.fn(() => false),
      getSelection: overrides.getSelection ?? vi.fn(() => ''),
      paste: overrides.paste ?? vi.fn(),
      input: overrides.input ?? vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      cols: 80,
      rows: 24,
      options: {
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: 'monospace',
        fontWeight: 'normal',
        lineHeight: 1,
        letterSpacing: 0,
        theme: { cursorAccent: '#000000' },
        scrollback: 1000
      },
      refresh: vi.fn()
    };
  });

  // Setup addon mocks
  const { FitAddon } = await import('@xterm/addon-fit');
  (FitAddon as unknown as Mock).mockImplementation(function() {
    return { fit: vi.fn() };
  });

  const { WebLinksAddon } = await import('@xterm/addon-web-links');
  (WebLinksAddon as unknown as Mock).mockImplementation(function() {
    return {};
  });

  const { SerializeAddon } = await import('@xterm/addon-serialize');
  (SerializeAddon as unknown as Mock).mockImplementation(function() {
    return {
      serialize: vi.fn(() => ''),
      dispose: vi.fn()
    };
  });

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(function() {
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };
  });

  // Create and render test wrapper component
  const TestWrapper = () => {
    const { terminalRef } = useXterm({ terminalId: 'test-terminal' });
    return React.createElement('div', { ref: terminalRef });
  };

  render(React.createElement(TestWrapper));

  // After rendering, keyEventHandler is guaranteed to be set by attachCustomKeyEventHandler
  // Use non-null assertion since we know the hook will set it
  return {
    keyEventHandler: keyEventHandler!,
    mockInstance: {
      hasSelection: overrides.hasSelection,
      getSelection: overrides.getSelection,
      paste: overrides.paste,
      input: overrides.input
    }
  };
}

describe('useXterm keyboard handlers', () => {
  let mockClipboard: {
    writeText: ReturnType<typeof vi.fn>;
    readText: ReturnType<typeof vi.fn>;
  };

  // Mock requestAnimationFrame for jsdom environment (not provided by default)
  // Isolated to this test file to prevent affecting other tests
  beforeAll(() => {
    global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number);
    global.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  beforeEach(() => {
    // Use fake timers to control async behavior and prevent timer leaks
    vi.useFakeTimers();

    // Clear all mocks before each test
    vi.clearAllMocks();

    // Ensure window and navigator exist in test environment
    if (typeof window === 'undefined') {
      (global as { window: unknown }).window = {};
    }
    if (typeof navigator === 'undefined') {
      (global as { navigator: unknown }).navigator = {};
    }

    // Mock navigator.clipboard
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('test clipboard content')
    };

    Object.defineProperty(global.navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
      configurable: true
    });

    // Mock window.electronAPI
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      sendTerminalInput: vi.fn()
    };
  });

  afterEach(() => {
    // Clear all pending timers before restoring mocks to prevent
    // "requestAnimationFrame is not defined" errors from delayed callbacks
    vi.clearAllTimers();
    vi.useRealTimers();

    vi.restoreAllMocks();
    // Reset navigator.platform to original value
    Object.defineProperty(navigator, 'platform', {
      value: originalNavigatorPlatform,
      writable: true
    });
  });

  describe('Platform detection', () => {
    it('should enable paste shortcuts on Windows (CTRL+V)', async () => {
      const mockPaste = vi.fn();

      // Mock Windows platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Windows should enable CTRL+V paste
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should enable paste shortcuts on Linux (both CTRL+V and CTRL+SHIFT+V)', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      // Test CTRL+V
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockPaste).toHaveBeenCalledTimes(1);

      // Test CTRL+SHIFT+V (Linux-specific)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          ctrlKey: true,
          shiftKey: true
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockPaste).toHaveBeenCalledTimes(2);
    });

    it('should enable copy shortcuts on Linux (both CTRL+C and CTRL+SHIFT+C)', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock Linux platform
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      // Test CTRL+C (should copy)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);

      // Test CTRL+SHIFT+C (Linux-specific, should also copy)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockClipboard.writeText).toHaveBeenCalledTimes(2);
    });

    it('should NOT enable custom paste handler on macOS (uses system Cmd+V)', async () => {
      const mockPaste = vi.fn();

      // Mock macOS platform
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true,
          shiftKey: false
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      // macOS should NOT use custom CTRL+V handler (uses system Cmd+V instead)
      expect(mockPaste).not.toHaveBeenCalled();
    });
  });

  describe('Smart CTRL+C behavior', () => {
    it('should copy to clipboard when text is selected', async () => {
      // Create mock functions that will be shared between the mock instance and our assertions
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        // Simulate CTRL+C keydown event
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false); // Should prevent xterm handling

        // Wait for clipboard write
        await vi.advanceTimersByTimeAsync(0);
      });

      // Verify the xterm instance methods were called
      expect(mockHasSelection).toHaveBeenCalled();
      expect(mockGetSelection).toHaveBeenCalled();

      // Verify clipboard.writeText was called with selected text
      expect(mockClipboard.writeText).toHaveBeenCalledWith('selected text');
    });

    it('should send ^C interrupt when no text is selected', async () => {
      const mockHasSelection = vi.fn(() => false);
      const mockGetSelection = vi.fn(() => '');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        // Simulate CTRL+C keydown event with no selection
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(true); // Should let ^C pass through to terminal
      });

      // Verify clipboard.writeText was NOT called
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should handle both ctrlKey (Windows/Linux) and metaKey (Mac)', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      // Test ctrlKey (Windows/Linux)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler?.(event);
          // Wait for clipboard write
          await vi.advanceTimersByTimeAsync(0);
        }
      });

      // Test metaKey (Mac)
      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: false,
          metaKey: true
        });

        if (keyEventHandler) {
          keyEventHandler?.(event);
          // Wait for clipboard write
          await vi.advanceTimersByTimeAsync(0);
        }
      });

      // Both should trigger clipboard write
      expect(mockClipboard.writeText).toHaveBeenCalledTimes(2);
    });
  });

  describe('CTRL+V paste behavior', () => {
    it('should paste clipboard content on Windows', async () => {
      const mockPaste = vi.fn();

      // Mock Windows platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        if (keyEventHandler) {
          const handled = keyEventHandler?.(event);
          expect(handled).toBe(false); // Should prevent literal ^V

          // Wait for clipboard read and paste
          await vi.advanceTimersByTimeAsync(0);
        }
      });

      // Verify clipboard read and paste
      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should paste clipboard content on Linux', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });

    it('should NOT paste on macOS (Cmd+V should work through existing handlers)', async () => {
      const mockPaste = vi.fn();

      // Mock macOS platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        // On Mac, this would be Cmd+V which is metaKey
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true, // ctrlKey, not metaKey
          metaKey: false
        });

        // On Mac, ctrlKey+V should NOT trigger paste (only Cmd+V works)
        keyEventHandler(event);
      });

      // Should not paste for ctrlKey+V on Mac
      expect(mockClipboard.readText).not.toHaveBeenCalled();
      expect(mockPaste).not.toHaveBeenCalled();
    });
  });

  describe('Linux CTRL+SHIFT+C copy shortcut', () => {
    it('should copy on Linux when CTRL+SHIFT+C is pressed', async () => {
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockClipboard.writeText).toHaveBeenCalledWith('selected text');
    });

    it('should not trigger CTRL+SHIFT+C on Windows', async () => {
      // Mock Windows platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: vi.fn(() => false),
        getSelection: vi.fn(() => '')
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'C',
          ctrlKey: true,
          shiftKey: true
        });

        if (keyEventHandler) {
          keyEventHandler?.(event);
        }
      });

      // Should not copy on Windows
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('Linux CTRL+SHIFT+V paste shortcut', () => {
    it('should paste on Linux when CTRL+SHIFT+V is pressed', async () => {
      const mockPaste = vi.fn();

      // Mock Linux platform (navigator)
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux',
        writable: true
      });

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          ctrlKey: true,
          shiftKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);

        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockClipboard.readText).toHaveBeenCalled();
      expect(mockPaste).toHaveBeenCalledWith('test clipboard content');
    });
  });

  describe('Clipboard error handling', () => {
    it('should handle clipboard write errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockHasSelection = vi.fn(() => true);
      const mockGetSelection = vi.fn(() => 'selected text');

      // Mock clipboard write failure
      mockClipboard.writeText = vi.fn().mockRejectedValue(new Error('Clipboard write failed'));

      const { keyEventHandler } = await setupMockXterm({
        hasSelection: mockHasSelection,
        getSelection: mockGetSelection
      });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should log error but not throw
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useXterm] Failed to copy selection:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle clipboard read errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockPaste = vi.fn();

      // Mock Windows platform to enable custom paste handler
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true
      });

      // Mock clipboard read failure
      mockClipboard.readText = vi.fn().mockRejectedValue(new Error('Clipboard read failed'));

      const { keyEventHandler } = await setupMockXterm({ paste: mockPaste });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'v',
          ctrlKey: true
        });

        keyEventHandler(event);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should log error but not throw
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useXterm] Failed to read clipboard:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Existing shortcuts preservation', () => {
    it('should let SHIFT+Enter pass through', async () => {
      const mockInput = vi.fn();

      const { keyEventHandler } = await setupMockXterm({ input: mockInput });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          ctrlKey: false,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler?.(event);
        }
      });

      // Should send ESC+newline for multi-line input
      expect(mockInput).toHaveBeenCalledWith('\x1b\n');
    });

    it('should let Ctrl+Backspace pass through', async () => {
      const mockInput = vi.fn();

      const { keyEventHandler } = await setupMockXterm({ input: mockInput });

      await act(async () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Backspace',
          ctrlKey: true,
          metaKey: false
        });

        if (keyEventHandler) {
          keyEventHandler?.(event);
        }
      });

      // Should send Ctrl+U for delete line
      expect(mockInput).toHaveBeenCalledWith('\x15');
    });

    it('should let Ctrl+1-9 pass through for project tab switching', async () => {
      const { keyEventHandler } = await setupMockXterm();

      // Test all number keys 1-9
      for (let i = 1; i <= 9; i++) {
        act(() => {
          const event = new KeyboardEvent('keydown', {
            key: i.toString(),
            ctrlKey: true
          });

          if (keyEventHandler) {
            const handled = keyEventHandler?.(event);
            expect(handled).toBe(false); // Should bubble to window handler
          }
        });
      }
    });

    it('should let Ctrl+T and Ctrl+W pass through', async () => {
      const { keyEventHandler } = await setupMockXterm();

      // Test Ctrl+T
      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 't',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);
      });

      // Test Ctrl+W
      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'w',
          ctrlKey: true
        });

        const handled = keyEventHandler(event);
        expect(handled).toBe(false);
      });
    });
  });

  describe('Event type checking', () => {
    it('should only handle keydown events, not keyup', async () => {
      const { keyEventHandler } = await setupMockXterm({
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => 'selected text')
      });

      act(() => {
        // Test keyup event (should be ignored)
        const keyupEvent = new KeyboardEvent('keyup', {
          key: 'c',
          ctrlKey: true
        });

        keyEventHandler(keyupEvent);
      });

      // Clipboard should not be called for keyup events
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });
  });
});
