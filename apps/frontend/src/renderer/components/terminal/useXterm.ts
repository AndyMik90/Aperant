import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import { terminalBufferManager } from '../../lib/terminal-buffer-manager';
import { registerOutputCallback, unregisterOutputCallback } from '../../stores/terminal-store';

// Type augmentation for navigator.userAgentData (modern User-Agent Client Hints API)
interface NavigatorUAData {
  platform: string;
}
declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

interface UseXtermOptions {
  terminalId: string;
  onCommandEnter?: (command: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onDimensionsReady?: (cols: number, rows: number) => void;
}

// Debounce helper function
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function useXterm({ terminalId, onCommandEnter, onResize, onDimensionsReady }: UseXtermOptions) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const commandBufferRef = useRef<string>('');
  const isDisposedRef = useRef<boolean>(false);
  const dimensionsReadyCalledRef = useRef<boolean>(false);
  const [dimensions, setDimensions] = useState<{ cols: number; rows: number }>({ cols: 80, rows: 24 });

  // Initialize xterm.js UI
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'var(--font-mono), "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: '#0B0B0F',
        foreground: '#E8E6E3',
        cursor: '#D6D876',
        cursorAccent: '#0B0B0F',
        selectionBackground: '#D6D87640',
        selectionForeground: '#E8E6E3',
        black: '#1A1A1F',
        red: '#FF6B6B',
        green: '#87D687',
        yellow: '#D6D876',
        blue: '#6BB3FF',
        magenta: '#C792EA',
        cyan: '#89DDFF',
        white: '#E8E6E3',
        brightBlack: '#4A4A50',
        brightRed: '#FF8A8A',
        brightGreen: '#A5E6A5',
        brightYellow: '#E8E87A',
        brightBlue: '#8AC4FF',
        brightMagenta: '#DEB3FF',
        brightCyan: '#A6E8FF',
        brightWhite: '#FFFFFF',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.electronAPI?.openExternal?.(uri).catch((error) => {
        console.warn('[useXterm] Failed to open URL:', uri, error);
      });
    });
    const serializeAddon = new SerializeAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.loadAddon(serializeAddon);

    xterm.open(terminalRef.current);

    // Platform detection for copy/paste shortcuts
    // macOS uses system Cmd+V, no custom handler needed
    const getPlatform = (): string => {
      // Prefer navigator.userAgentData.platform (modern, non-deprecated)
      if (navigator.userAgentData?.platform) {
        return navigator.userAgentData.platform.toLowerCase();
      }
      // Fallback to navigator.platform (deprecated but widely supported)
      return navigator.platform.toLowerCase();
    };
    const platform = getPlatform();
    const isWindows = platform.includes('win');
    const isLinux = platform.includes('linux');

    // Helper function to handle copy to clipboard
    // Returns true if selection exists and copy was attempted, false if no selection
    // Note: return value does not reflect actual clipboard write success/failure
    const handleCopyToClipboard = (): boolean => {
      if (xterm.hasSelection()) {
        const selection = xterm.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.error('[useXterm] Failed to copy selection:', err);
          });
          return true; // Copy attempted (has selection)
        }
      }
      return false; // No selection or nothing to copy
    };

    // Helper function to handle paste from clipboard
    const handlePasteFromClipboard = (): void => {
      navigator.clipboard.readText()
        .then((text) => {
          if (text) {
            xterm.paste(text);
          }
        })
        .catch((err) => {
          console.error('[useXterm] Failed to read clipboard:', err);
        });
    };

    // Allow certain key combinations to bubble up to window-level handlers
    // This enables global shortcuts like Cmd/Ctrl+1-9 for project switching
    xterm.attachCustomKeyEventHandler((event) => {
      const isMod = event.metaKey || event.ctrlKey;

      // Handle SHIFT+Enter for multi-line input (send newline character)
      // This matches VS Code/Cursor behavior for multi-line input in Claude Code
      if (event.key === 'Enter' && event.shiftKey && !isMod && event.type === 'keydown') {
        // Send ESC + newline - same as OPTION+Enter which works for multi-line
        xterm.input('\x1b\n');
        return false; // Prevent default xterm handling
      }

      // Handle CMD+Backspace (Mac) or Ctrl+Backspace (Windows/Linux) to delete line
      // Sends Ctrl+U which is the terminal standard for "kill line backward"
      const isDeleteLine = event.key === 'Backspace' && event.type === 'keydown' && isMod;
      if (isDeleteLine) {
        xterm.input('\x15'); // Ctrl+U
        return false;
      }

      // Let Cmd/Ctrl + number keys pass through for project tab switching
      if (isMod && event.key >= '1' && event.key <= '9') {
        return false; // Don't handle in xterm, let it bubble up
      }

      // Let Cmd/Ctrl + Tab pass through for tab navigation
      if (isMod && event.key === 'Tab') {
        return false;
      }

      // Let Cmd/Ctrl + T pass through for new terminal shortcut
      // Let Cmd/Ctrl + W pass through for close terminal shortcut
      if (isMod && (event.key === 't' || event.key === 'T' || event.key === 'w' || event.key === 'W')) {
        return false;
      }

      // Handle CTRL+SHIFT+C copy (Linux only - alternative to CTRL+C)
      // NOTE: Check Linux-specific shortcuts BEFORE regular shortcuts to prevent unreachable code
      const isLinuxCopyShortcut = event.ctrlKey && event.shiftKey && (event.key === 'C' || event.key === 'c') && event.type === 'keydown';
      if (isLinuxCopyShortcut && isLinux) {
        if (handleCopyToClipboard()) {
          return false; // Prevent xterm from handling (copy performed)
        }
        // No selection - consume event (CTRL+SHIFT+C won't send proper interrupt signal)
        return false;
      }

      // Handle CTRL+SHIFT+V paste (Linux only - alternative to CTRL+V)
      const isLinuxPasteShortcut = event.ctrlKey && event.shiftKey && (event.key === 'V' || event.key === 'v') && event.type === 'keydown';
      if (isLinuxPasteShortcut && isLinux) {
        event.preventDefault(); // Prevent browser's default paste behavior
        handlePasteFromClipboard();
        return false; // Prevent xterm from sending literal ^V
      }

      // Handle CMD/Ctrl+C - Smart copy (copy if text selected, send ^C if not)
      // NOTE: Only trigger when shiftKey is NOT pressed (Linux CTRL+SHIFT+C handled above)
      const isCopyShortcut = isMod && !event.shiftKey && (event.key === 'c' || event.key === 'C') && event.type === 'keydown';
      if (isCopyShortcut) {
        if (handleCopyToClipboard()) {
          return false; // Prevent xterm from handling (copy performed)
        }
        // No selection - let ^C pass through to terminal (sends interrupt signal)
        return true;
      }

      // Handle CTRL+V paste (Windows and Linux only)
      // NOTE: Only trigger when shiftKey is NOT pressed (Linux CTRL+SHIFT+V handled above)
      const isPasteShortcut = event.ctrlKey && !event.shiftKey && (event.key === 'v' || event.key === 'V') && event.type === 'keydown';
      if (isPasteShortcut && (isWindows || isLinux)) {
        event.preventDefault(); // Prevent browser's default paste behavior
        handlePasteFromClipboard();
        return false; // Prevent xterm from sending literal ^V
      }

      // Handle all other keys in xterm
      return true;
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;

    // Use requestAnimationFrame to wait for layout, then fit
    // This is more reliable than a fixed timeout
    // Fallback to setTimeout for test environments where requestAnimationFrame may not be defined
    const raf = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;

    const performInitialFit = () => {
      raf(() => {
        if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
          // Check if container has valid dimensions
          const rect = terminalRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            fitAddonRef.current.fit();
            const cols = xtermRef.current.cols;
            const rows = xtermRef.current.rows;
            setDimensions({ cols, rows });
            // Call onDimensionsReady once when we have valid dimensions
            if (!dimensionsReadyCalledRef.current && cols > 0 && rows > 0) {
              dimensionsReadyCalledRef.current = true;
              onDimensionsReady?.(cols, rows);
            }
          } else {
            // Container not ready yet, retry after a short delay
            setTimeout(performInitialFit, 50);
          }
        }
      });
    };
    performInitialFit();

    // Replay buffered output if this is a remount or restored session
    // This now includes ANSI codes for proper formatting/colors/prompt
    const bufferedOutput = terminalBufferManager.get(terminalId);
    if (bufferedOutput && bufferedOutput.length > 0) {
      xterm.write(bufferedOutput);
      // Clear buffer after replay to avoid duplicate output
      terminalBufferManager.clear(terminalId);
    }

    // Handle terminal input
    xterm.onData((data) => {
      window.electronAPI.sendTerminalInput(terminalId, data);

      // Track commands for auto-naming
      if (data === '\r' || data === '\n') {
        const command = commandBufferRef.current;
        commandBufferRef.current = '';
        if (onCommandEnter) {
          onCommandEnter(command);
        }
      } else if (data === '\x7f' || data === '\b') {
        commandBufferRef.current = commandBufferRef.current.slice(0, -1);
      } else if (data === '\x03') {
        commandBufferRef.current = '';
      } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
        commandBufferRef.current += data;
      }
    });

    // Handle resize
    xterm.onResize(({ cols, rows }) => {
      if (onResize) {
        onResize(cols, rows);
      }
    });

    return () => {
      // Cleanup handled by parent component
    };
  }, [terminalId, onCommandEnter, onResize, onDimensionsReady]);

  // Register xterm write callback with terminal-store for global output listener
  // This allows the global listener to write directly to xterm when terminal is visible
  useEffect(() => {
    // Only register if xterm is ready
    if (!xtermRef.current) return;

    // Create a write function that writes directly to this xterm instance
    const writeCallback = (data: string) => {
      if (xtermRef.current && !isDisposedRef.current) {
        xtermRef.current.write(data);
      }
    };

    // Register the callback so global listener can write to this terminal
    registerOutputCallback(terminalId, writeCallback);

    // Cleanup: unregister callback when component unmounts
    return () => {
      unregisterOutputCallback(terminalId);
    };
  }, [terminalId]);

  // Handle resize on container resize with debouncing
  useEffect(() => {
    const handleResize = debounce(() => {
      if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
        // Check if container has valid dimensions before fitting
        const rect = terminalRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fitAddonRef.current.fit();
          const cols = xtermRef.current.cols;
          const rows = xtermRef.current.rows;
          setDimensions({ cols, rows });
          // Notify when dimensions become valid (for late PTY creation)
          if (!dimensionsReadyCalledRef.current && cols > 0 && rows > 0) {
            dimensionsReadyCalledRef.current = true;
            onDimensionsReady?.(cols, rows);
          }
        }
      }
    }, 100); // 100ms debounce to prevent layout thrashing

    // Observe the terminalRef directly (not parent) for accurate resize detection
    const container = terminalRef.current;
    if (container) {
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }
  }, [onDimensionsReady]);

  // Listen for terminal refit events (triggered after drag-drop reorder)
  useEffect(() => {
    const handleRefitAll = () => {
      if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
        const rect = terminalRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fitAddonRef.current.fit();
          const cols = xtermRef.current.cols;
          const rows = xtermRef.current.rows;
          setDimensions({ cols, rows });
        }
      }
    };

    window.addEventListener('terminal-refit-all', handleRefitAll);
    return () => window.removeEventListener('terminal-refit-all', handleRefitAll);
  }, []);

  const fit = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();
    }
  }, []);

  const write = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  }, []);

  const writeln = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.writeln(data);
    }
  }, []);

  const focus = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  }, []);

  /**
   * Serialize the terminal buffer before disposal.
   * This preserves ANSI escape codes for colors, formatting, and the prompt.
   */
  const serializeBuffer = useCallback(() => {
    if (xtermRef.current && serializeAddonRef.current) {
      try {
        const serialized = serializeAddonRef.current.serialize();
        if (serialized && serialized.length > 0) {
          terminalBufferManager.set(terminalId, serialized);
        }
      } catch (error) {
        console.error('[useXterm] Failed to serialize terminal buffer:', error);
      }
    }
  }, [terminalId]);

  const dispose = useCallback(() => {
    // Guard against double dispose (can happen in React StrictMode or rapid unmount)
    if (isDisposedRef.current) return;
    isDisposedRef.current = true;

    // Serialize buffer before disposing to preserve ANSI formatting
    serializeBuffer();

    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    if (serializeAddonRef.current) {
      serializeAddonRef.current.dispose();
      serializeAddonRef.current = null;
    }
    fitAddonRef.current = null;
  }, [serializeBuffer]);

  return {
    terminalRef,
    xtermRef,
    fitAddonRef,
    fit,
    write,
    writeln,
    focus,
    dispose,
    cols: dimensions.cols,
    rows: dimensions.rows,
    dimensionsReady: dimensionsReadyCalledRef.current,
  };
}
