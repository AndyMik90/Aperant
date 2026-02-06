import { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import '@xterm/xterm/css/xterm.css';
import { FileDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTerminalStore } from '../stores/terminal-store';
import { useSettingsStore } from '../stores/settings-store';
import { useToast } from '../hooks/use-toast';
import type { TerminalProps } from './terminal/types';
import type { TerminalWorktreeConfig } from '../../shared/types';
import { TerminalHeader } from './terminal/TerminalHeader';
import { CreateWorktreeDialog } from './terminal/CreateWorktreeDialog';
import { useXterm } from './terminal/useXterm';
import { usePtyProcess } from './terminal/usePtyProcess';
import { useTerminalEvents } from './terminal/useTerminalEvents';
import { useAutoNaming } from './terminal/useAutoNaming';
import { useTerminalFileDrop } from './terminal/useTerminalFileDrop';
import { debugLog } from '../../shared/utils/debug-logger';
import { isWindows as checkIsWindows } from '../lib/os-detection';

// Minimum dimensions to prevent PTY creation with invalid sizes
const MIN_COLS = 10;
const MIN_ROWS = 3;

// Platform detection for platform-specific timing
// Windows ConPTY is slower than Unix PTY, so we need longer grace periods
const platformIsWindows = checkIsWindows();

// Threshold in milliseconds to allow for async PTY resize acknowledgment
// Mismatches within this window after a resize are expected and not logged as warnings
// Windows needs longer grace period due to slower ConPTY resize
const DIMENSION_MISMATCH_GRACE_PERIOD_MS = platformIsWindows ? 500 : 100;

// Cooldown between auto-corrections to prevent rapid-fire corrections
// Windows needs longer cooldown due to slower ConPTY operations
const AUTO_CORRECTION_COOLDOWN_MS = platformIsWindows ? 1000 : 300;

// Auto-correction frequency monitoring
const AUTO_CORRECTION_WARNING_THRESHOLD = 5;  // Warn if > 5 corrections per minute
const AUTO_CORRECTION_WINDOW_MS = 60000;  // 1 minute window

/**
 * Handle interface exposed by Terminal component for external control.
 * Used by parent components (e.g., SortableTerminalWrapper) to trigger operations
 * like refitting the terminal after container size changes.
 */
export interface TerminalHandle {
  /** Refit the terminal to its container size */
  fit: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal({
  id,
  cwd,
  projectPath,
  isActive,
  onClose,
  onActivate,
  tasks = [],
  onNewTaskClick,
  terminalCount = 1,
  dragHandleListeners,
  isDragging,
  isExpanded,
  onToggleExpand,
}, ref) {
  const isMountedRef = useRef(true);
  const isCreatedRef = useRef(false);
  // Track deliberate terminal recreation (e.g., worktree switching)
  // This prevents exit handlers from triggering auto-removal during controlled recreation
  const isRecreatingRef = useRef(false);
  // Store pending worktree config during recreation to sync after PTY creation
  // This fixes a race condition where IPC calls to set worktree config happen before
  // the terminal exists in main process, causing the config to not be persisted
  const pendingWorktreeConfigRef = useRef<TerminalWorktreeConfig | null>(null);
  // Track last sent PTY dimensions to prevent redundant resize calls
  // This ensures terminal.resize() stays in sync with PTY dimensions
  const lastPtyDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  // Track if auto-resume has been attempted to prevent duplicate resume calls
  // This fixes the race condition where isActive and pendingClaudeResume update timing can miss the effect trigger
  const hasAttemptedAutoResumeRef = useRef(false);
  // Track when the last resize was sent to PTY for grace period logic
  // This prevents false positive mismatch warnings during async resize acknowledgment
  const lastResizeTimeRef = useRef<number>(0);
  // Track previous isExpanded state to detect actual expansion changes
  // This prevents forcing PTY resize on initial mount (only on actual state changes)
  const prevIsExpandedRef = useRef<boolean | undefined>(undefined);
  // Track when last auto-correction was performed to implement cooldown
  const lastAutoCorrectionTimeRef = useRef<number>(0);
  // Track auto-correction frequency to detect potential deeper issues
  // If corrections exceed threshold, it may indicate a persistent sync problem
  const autoCorrectionCountRef = useRef<number>(0);
  const autoCorrectionWindowStartRef = useRef<number>(Date.now());
  // Sequence number for resize operations to prevent race conditions
  // When concurrent resize calls complete out-of-order, only the latest result is applied
  const resizeSequenceRef = useRef<number>(0);
  // Track post-creation dimension check timeout for cleanup
  const postCreationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Worktree dialog state
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);

  // Terminal store
  const terminal = useTerminalStore((state) => state.terminals.find((t) => t.id === id));
  const setClaudeMode = useTerminalStore((state) => state.setClaudeMode);
  const updateTerminal = useTerminalStore((state) => state.updateTerminal);
  const setAssociatedTask = useTerminalStore((state) => state.setAssociatedTask);
  const setWorktreeConfig = useTerminalStore((state) => state.setWorktreeConfig);

  // Use cwd from store if available (for worktree), otherwise use prop
  const effectiveCwd = terminal?.cwd || cwd;

  // Settings store for IDE preferences
  const { settings } = useSettingsStore();

  // Toast for user feedback
  const { toast } = useToast();

  const associatedTask = terminal?.associatedTaskId
    ? tasks.find((t) => t.id === terminal.associatedTaskId)
    : undefined;

  // Setup drop zone for file drag-and-drop
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `terminal-${id}`,
    data: { type: 'terminal', terminalId: id }
  });

  // Check if a terminal is being dragged (vs a file)
  const { active } = useDndContext();
  const isDraggingTerminal = active?.data.current?.type === 'terminal-panel';

  // Use custom hook for native HTML5 file drop handling from FileTreeItem
  // This hook is extracted to enable proper unit testing with renderHook()
  const { isNativeDragOver, handleNativeDragOver, handleNativeDragLeave, handleNativeDrop } =
    useTerminalFileDrop({ terminalId: id });

  // Only show file drop overlay when dragging files (via @dnd-kit or native), not terminals
  const showFileDropOverlay = (isOver && !isDraggingTerminal) || isNativeDragOver;

  // Auto-naming functionality
  const { handleCommandEnter, cleanup: cleanupAutoNaming } = useAutoNaming({
    terminalId: id,
    cwd: effectiveCwd,
  });

  // Track when xterm dimensions are ready for PTY creation
  const [readyDimensions, setReadyDimensions] = useState<{ cols: number; rows: number } | null>(null);

  /**
   * Helper function to resize PTY with proper dimension tracking and race condition prevention.
   * Uses sequence numbers to ensure only the latest resize result updates the tracked dimensions.
   * This prevents stale dimension corruption when concurrent resize calls complete out-of-order.
   *
   * @param cols - Target column count
   * @param rows - Target row count
   * @param context - Context string for debug logging (e.g., "onResize", "performFit")
   */
  const resizePtyWithTracking = useCallback((cols: number, rows: number, context: string) => {
    // Increment sequence number for this resize operation
    const sequence = ++resizeSequenceRef.current;
    lastResizeTimeRef.current = Date.now();

    window.electronAPI.resizeTerminal(id, cols, rows).then((result) => {
      // Only update dimensions if this is still the latest resize operation
      // This prevents race conditions where an earlier failed call overwrites a later successful one
      if (sequence !== resizeSequenceRef.current) {
        debugLog(`[Terminal ${id}] ${context}: Ignoring stale resize result (sequence ${sequence} vs current ${resizeSequenceRef.current})`);
        return;
      }

      if (result.success) {
        lastPtyDimensionsRef.current = { cols, rows };
      } else {
        debugLog(`[Terminal ${id}] ${context} resize failed: ${result.error || 'unknown error'}`);
      }
    }).catch((error) => {
      // Only log if this is still the latest operation
      if (sequence === resizeSequenceRef.current) {
        debugLog(`[Terminal ${id}] ${context} resize error: ${error}`);
      }
    });
  }, [id]);

  // Callback when xterm has measured valid dimensions
  const handleDimensionsReady = useCallback((cols: number, rows: number) => {
    // Only set dimensions if they're valid (above minimum thresholds)
    if (cols >= MIN_COLS && rows >= MIN_ROWS) {
      debugLog(`[Terminal ${id}] handleDimensionsReady: cols=${cols}, rows=${rows} - setting readyDimensions`);
      setReadyDimensions({ cols, rows });
    } else {
      debugLog(`[Terminal ${id}] handleDimensionsReady: dimensions below minimum: cols=${cols} (min=${MIN_COLS}), rows=${rows} (min=${MIN_ROWS})`);
    }
  }, [id]);

  /**
   * Check for dimension mismatch between xterm and PTY.
   * Logs a warning if dimensions differ outside the grace period after a resize.
   * This helps diagnose text alignment issues that can occur when xterm and PTY
   * have different ideas about terminal dimensions.
   *
   * @param xtermCols - Current xterm column count
   * @param xtermRows - Current xterm row count
   * @param context - Optional context string for the log message (e.g., "after resize", "on fit")
   * @param autoCorrect - If true, automatically correct mismatches by resizing PTY
   */
  const checkDimensionMismatch = useCallback((
    xtermCols: number,
    xtermRows: number,
    context?: string,
    autoCorrect: boolean = false
  ) => {
    const ptyDims = lastPtyDimensionsRef.current;

    // Skip check if PTY hasn't been created yet (no dimensions to compare)
    if (!ptyDims) {
      return;
    }

    // Skip check if we're within the grace period after a resize
    // This prevents false positives during async PTY resize acknowledgment
    const timeSinceLastResize = Date.now() - lastResizeTimeRef.current;
    if (timeSinceLastResize < DIMENSION_MISMATCH_GRACE_PERIOD_MS) {
      return;
    }

    // Check for mismatch
    const colsMismatch = xtermCols !== ptyDims.cols;
    const rowsMismatch = xtermRows !== ptyDims.rows;

    if (colsMismatch || rowsMismatch) {
      const contextStr = context ? ` (${context})` : '';
      debugLog(
        `[Terminal ${id}] DIMENSION MISMATCH DETECTED${contextStr}: ` +
        `xterm=(cols=${xtermCols}, rows=${xtermRows}) vs PTY=(cols=${ptyDims.cols}, rows=${ptyDims.rows}) - ` +
        `delta=(cols=${xtermCols - ptyDims.cols}, rows=${xtermRows - ptyDims.rows})`
      );

      // Auto-correct if enabled, PTY is created, and cooldown has passed
      const timeSinceAutoCorrect = Date.now() - lastAutoCorrectionTimeRef.current;
      if (
        autoCorrect &&
        isCreatedRef.current &&
        timeSinceAutoCorrect >= AUTO_CORRECTION_COOLDOWN_MS &&
        xtermCols >= MIN_COLS &&
        xtermRows >= MIN_ROWS
      ) {
        // Track auto-correction frequency for monitoring
        const now = Date.now();
        if (now - autoCorrectionWindowStartRef.current >= AUTO_CORRECTION_WINDOW_MS) {
          // Log warning if previous window had excessive corrections
          if (autoCorrectionCountRef.current >= AUTO_CORRECTION_WARNING_THRESHOLD) {
            debugLog(
              `[Terminal ${id}] AUTO-CORRECTION WARNING: ${autoCorrectionCountRef.current} corrections ` +
              `in last minute - this may indicate a persistent sync issue`
            );
          }
          // Reset the window
          autoCorrectionCountRef.current = 0;
          autoCorrectionWindowStartRef.current = now;
        }
        autoCorrectionCountRef.current++;

        debugLog(`[Terminal ${id}] AUTO-CORRECTING (#${autoCorrectionCountRef.current}): resizing PTY to ${xtermCols}x${xtermRows}`);
        lastAutoCorrectionTimeRef.current = Date.now();
        resizePtyWithTracking(xtermCols, xtermRows, 'AUTO-CORRECTION');
      }
    }
  }, [id, resizePtyWithTracking]);

  // Initialize xterm with command tracking
  const {
    terminalRef,
    xtermRef,
    fit,
    write: _write,  // Output now handled by useGlobalTerminalListeners
    writeln,
    focus,
    dispose,
    cols,
    rows,
  } = useXterm({
    terminalId: id,
    onCommandEnter: handleCommandEnter,
    onResize: (cols, rows) => {
      // PTY dimension sync validation:
      // 1. Only resize if PTY is created
      // 2. Validate dimensions are within acceptable range
      // 3. Skip if dimensions haven't changed (prevents redundant IPC calls)
      if (!isCreatedRef.current) {
        return;
      }

      // Validate dimensions are within acceptable range
      if (cols < MIN_COLS || rows < MIN_ROWS) {
        return;
      }

      // Skip redundant resize calls if dimensions haven't changed
      const lastDims = lastPtyDimensionsRef.current;
      if (lastDims && lastDims.cols === cols && lastDims.rows === rows) {
        return;
      }

      // Use helper to resize PTY with proper tracking and race condition prevention
      resizePtyWithTracking(cols, rows, 'onResize');
    },
    onDimensionsReady: handleDimensionsReady,
  });

  // Expose fit method to parent components via ref
  // This allows external triggering of terminal resize (e.g., after drag-drop reorder)
  useImperativeHandle(ref, () => ({
    fit,
  }), [fit]);

  // Use ready dimensions for PTY creation (wait until xterm has measured)
  // This prevents creating PTY with default 80x24 when container is smaller
  const ptyDimensions = useMemo(() => {
    if (readyDimensions) {
      debugLog(`[Terminal ${id}] ptyDimensions memo: using readyDimensions cols=${readyDimensions.cols}, rows=${readyDimensions.rows}`);
      return readyDimensions;
    }
    // Wait for actual measurement via onDimensionsReady callback
    // Do NOT use current cols/rows as they may be initial defaults (80x24)
    debugLog(`[Terminal ${id}] ptyDimensions memo: readyDimensions is null, returning null (skipCreation will be true)`);
    return null;
  }, [readyDimensions, id]);

  // Create PTY process - only when we have valid dimensions
  const { prepareForRecreate, resetForRecreate } = usePtyProcess({
    terminalId: id,
    cwd: effectiveCwd,
    projectPath,
    cols: ptyDimensions?.cols ?? 80,
    rows: ptyDimensions?.rows ?? 24,
    // Only allow PTY creation when dimensions are ready
    skipCreation: !ptyDimensions,
    // Pass recreation ref to coordinate with deliberate terminal destruction/recreation
    isRecreatingRef,
    onCreated: () => {
      isCreatedRef.current = true;
      // ALWAYS force PTY resize on creation/remount
      // This ensures PTY matches xterm even if PTY existed before remount (expand/minimize)
      // The root cause of text alignment issues is that when terminal remounts:
      // 1. PTY persists with old dimensions (e.g., 80x20)
      // 2. New xterm measures new container (e.g., 160x40)
      // 3. Without this force resize, PTY never gets updated
      // Read current dimensions from xterm ref to avoid stale closure values
      const currentCols = xtermRef.current?.cols;
      const currentRows = xtermRef.current?.rows;
      if (currentCols !== undefined && currentRows !== undefined && currentCols >= MIN_COLS && currentRows >= MIN_ROWS) {
        debugLog(`[Terminal ${id}] PTY created - forcing PTY resize to match xterm: cols=${currentCols}, rows=${currentRows}`);
        // Use helper to resize PTY with proper tracking and race condition prevention
        resizePtyWithTracking(currentCols, currentRows, 'PTY creation');

        // Schedule initial dimension mismatch check after PTY creation
        // This helps detect if xterm dimensions drifted during PTY setup
        // Read fresh dimensions inside the timeout to avoid stale closure
        // Store timeout ID for cleanup on unmount
        postCreationTimeoutRef.current = setTimeout(() => {
          const freshCols = xtermRef.current?.cols;
          const freshRows = xtermRef.current?.rows;
          if (freshCols !== undefined && freshRows !== undefined) {
            checkDimensionMismatch(freshCols, freshRows, 'post-PTY creation');
          }
        }, DIMENSION_MISMATCH_GRACE_PERIOD_MS + 100);
      } else {
        debugLog(`[Terminal ${id}] PTY created - no valid dimensions available for tracking (cols=${currentCols}, rows=${currentRows})`);
      }
      // If there's a pending worktree config from a recreation attempt,
      // sync it to main process now that the terminal exists.
      // This fixes the race condition where IPC calls happen before terminal creation.
      if (pendingWorktreeConfigRef.current) {
        const config = pendingWorktreeConfigRef.current;
        try {
          window.electronAPI.setTerminalWorktreeConfig(id, config);
          window.electronAPI.setTerminalTitle(id, config.name);
        } catch (error) {
          console.error('Failed to sync worktree config after PTY creation:', error);
        }
        pendingWorktreeConfigRef.current = null;
      }
    },
    onError: (error) => {
      // Clear pending config on error to prevent stale config from being applied
      // if PTY is recreated later (fixes potential race condition on failed recreation)
      pendingWorktreeConfigRef.current = null;
      writeln(`\r\n\x1b[31mError: ${error}\x1b[0m`);
    },
  });

  // Monitor for dimension mismatches between xterm and PTY
  // This effect runs when xterm dimensions change and checks for mismatches
  // after the grace period to help diagnose text alignment issues
  // Auto-correction is enabled to automatically fix any detected mismatches
  useEffect(() => {
    // Only check if PTY has been created
    if (!isCreatedRef.current) {
      return;
    }

    // Schedule a mismatch check after the grace period
    // This allows time for the PTY resize to be acknowledged
    // Enable auto-correct to automatically fix any detected mismatches
    const timeoutId = setTimeout(() => {
      checkDimensionMismatch(cols, rows, 'periodic dimension sync check', true);
    }, DIMENSION_MISMATCH_GRACE_PERIOD_MS + 100);

    return () => clearTimeout(timeoutId);
  }, [cols, rows, checkDimensionMismatch]);

  // Handle terminal events (output is now handled globally via useGlobalTerminalListeners)
  useTerminalEvents({
    terminalId: id,
    // Pass recreation ref to skip auto-removal during deliberate terminal recreation
    isRecreatingRef,
    onExit: (exitCode) => {
      isCreatedRef.current = false;
      writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`);
    },
  });

  // Focus terminal when it becomes active
  useEffect(() => {
    if (isActive) {
      focus();
    }
  }, [isActive, focus]);

  // Refit terminal when expansion state changes
  // Uses transitionend event listener and RAF-based retry logic instead of fixed timeout
  // for more reliable resizing after CSS transitions complete
  useEffect(() => {
    // Detect if this is an actual expansion state change vs initial mount
    // Only force PTY resize on actual state changes to avoid resizing with invalid dimensions on mount
    const isFirstMount = prevIsExpandedRef.current === undefined;
    const expansionStateChanged = !isFirstMount && prevIsExpandedRef.current !== isExpanded;
    debugLog(`[Terminal ${id}] Expansion effect: isExpanded=${isExpanded}, isFirstMount=${isFirstMount}, expansionStateChanged=${expansionStateChanged}, prevIsExpanded=${prevIsExpandedRef.current}`);
    prevIsExpandedRef.current = isExpanded;

    // RAF fallback for test environments where requestAnimationFrame may not be defined
    const raf = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;

    const cancelRaf = typeof cancelAnimationFrame !== 'undefined'
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id);

    let rafId: number | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCleanedUp = false;
    let fitSucceeded = false;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 50;
    const FALLBACK_TIMEOUT_MS = 300;

    // Perform fit with RAF and retry logic, following the pattern from useXterm.ts performInitialFit
    const performFit = () => {
      if (isCleanedUp) return;

      // Cancel any existing RAF to prevent multiple concurrent fit attempts
      if (rafId !== null) {
        cancelRaf(rafId);
        rafId = null;
      }

      rafId = raf(() => {
        if (isCleanedUp) return;

        // fit() returns boolean indicating success (true if container had valid dimensions)
        const success = fit();
        debugLog(`[Terminal ${id}] performFit: fit returned success=${success}, expansionStateChanged=${expansionStateChanged}, isCreatedRef=${isCreatedRef.current}`);

        if (success) {
          fitSucceeded = true;
          // Force PTY resize only on actual expansion state changes (not initial mount)
          // This ensures PTY stays in sync even when xterm.onResize() doesn't fire
          // Read fresh dimensions from xterm ref after fit() to avoid stale closure values
          const freshCols = xtermRef.current?.cols;
          const freshRows = xtermRef.current?.rows;
          if (expansionStateChanged && isCreatedRef.current && freshCols !== undefined && freshRows !== undefined && freshCols >= MIN_COLS && freshRows >= MIN_ROWS) {
            debugLog(`[Terminal ${id}] performFit: Forcing PTY resize to cols=${freshCols}, rows=${freshRows}`);
            // Use helper to resize PTY with proper tracking and race condition prevention
            resizePtyWithTracking(freshCols, freshRows, 'performFit');
          }
        } else if (retryCount < MAX_RETRIES) {
          // Container not ready yet, retry after a short delay
          retryCount++;
          retryTimeoutId = setTimeout(performFit, RETRY_DELAY_MS);
        }
      });
    };

    // Get terminal container element for transition listening
    const container = terminalRef.current;

    // Handler for transitionend event - fits terminal after CSS transition completes
    const handleTransitionEnd = (e: TransitionEvent) => {
      // Only react to relevant transitions (height, width, flex changes)
      const relevantProps = ['height', 'width', 'flex', 'max-height', 'max-width'];
      if (relevantProps.some(prop => e.propertyName.includes(prop))) {
        // Reset retry count and success flag for new transition
        retryCount = 0;
        fitSucceeded = false;
        performFit();
      }
    };

    // Listen for transitionend on the terminal container and its parent
    // (expansion may trigger transitions on either element)
    if (container) {
      container.addEventListener('transitionend', handleTransitionEnd);
      container.parentElement?.addEventListener('transitionend', handleTransitionEnd);
    }

    // Start the fit process immediately with RAF-based retry
    // This handles cases where expansion is instant (no CSS transition)
    performFit();

    // Fallback timeout to ensure fit happens even if transitionend doesn't fire
    // This is a safety net for edge cases
    fallbackTimeoutId = setTimeout(() => {
      if (!isCleanedUp && !fitSucceeded) {
        retryCount = 0;
        performFit();
      }
    }, FALLBACK_TIMEOUT_MS);

    return () => {
      isCleanedUp = true;

      // Clean up RAF
      if (rafId !== null) {
        cancelRaf(rafId);
      }

      // Clean up retry timeout
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
      }

      // Clean up fallback timeout
      if (fallbackTimeoutId !== null) {
        clearTimeout(fallbackTimeoutId);
      }

      // Remove event listeners
      if (container) {
        container.removeEventListener('transitionend', handleTransitionEnd);
        container.parentElement?.removeEventListener('transitionend', handleTransitionEnd);
      }
    };
  }, [isExpanded, fit, id, resizePtyWithTracking]);

  // Trigger deferred Claude resume when terminal becomes active
  // This ensures Claude sessions are only resumed when the user actually views the terminal,
  // preventing all terminals from resuming simultaneously on app startup (which can crash the app)
  useEffect(() => {
    // Reset resume attempt tracking when terminal is no longer pending
    if (!terminal?.pendingClaudeResume) {
      hasAttemptedAutoResumeRef.current = false;
      return;
    }

    // Only attempt auto-resume once, even if the effect runs multiple times
    if (hasAttemptedAutoResumeRef.current) {
      return;
    }

    // Check if both conditions are met for auto-resume
    if (isActive && terminal?.pendingClaudeResume) {
      // Defer the resume slightly to ensure all React state updates have propagated
      // This fixes the race condition where isActive and pendingClaudeResume might update
      // at different times during the restoration flow
      const timer = setTimeout(() => {
        if (!isMountedRef.current) return;

        // Mark that we've attempted resume INSIDE the callback to prevent duplicates
        // This ensures we only mark as attempted if the timeout actually fires
        // (prevents race condition where effect re-runs before timeout executes)
        if (hasAttemptedAutoResumeRef.current) return;
        hasAttemptedAutoResumeRef.current = true;

        // Double-check conditions before resuming (state might have changed)
        const currentTerminal = useTerminalStore.getState().terminals.find((t) => t.id === id);
        if (currentTerminal?.pendingClaudeResume) {
          // Clear the pending flag and trigger the actual resume
          useTerminalStore.getState().setPendingClaudeResume(id, false);
          window.electronAPI.activateDeferredClaudeResume(id);
        }
      }, 100); // Small delay to let React finish batched updates

      return () => clearTimeout(timer);
    }
  }, [isActive, id, terminal?.pendingClaudeResume]);

  // Handle keyboard shortcuts for this terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this terminal is active
      if (!isActive) return;

      // Cmd/Ctrl+W to close terminal
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }

      // Cmd/Ctrl+Shift+E to toggle expand/collapse
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        onToggleExpand?.();
      }
    };

    // Use capture phase to get the event before xterm
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, onClose, onToggleExpand]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      cleanupAutoNaming();

      // Clear post-creation dimension check timeout to prevent operations on unmounted component
      if (postCreationTimeoutRef.current !== null) {
        clearTimeout(postCreationTimeoutRef.current);
        postCreationTimeoutRef.current = null;
      }

      // Dispose synchronously on unmount to prevent race conditions
      // where a new terminal mounts before the old one is cleaned up.
      // The previous 100ms delay created a window where both terminals existed.
      dispose();
      isCreatedRef.current = false;
    };
  }, [id, dispose, cleanupAutoNaming]);

  const handleInvokeClaude = useCallback(() => {
    setClaudeMode(id, true);
    window.electronAPI.invokeClaudeInTerminal(id, effectiveCwd);
  }, [id, effectiveCwd, setClaudeMode]);

  const handleClick = useCallback(() => {
    onActivate();
    focus();
  }, [onActivate, focus]);

  const handleTitleChange = useCallback((newTitle: string) => {
    updateTerminal(id, { title: newTitle });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, newTitle);
  }, [id, updateTerminal]);

  const handleTaskSelect = useCallback((taskId: string) => {
    const selectedTask = tasks.find((t) => t.id === taskId);
    if (!selectedTask) return;

    setAssociatedTask(id, taskId);
    updateTerminal(id, { title: selectedTask.title });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, selectedTask.title);

    const contextMessage = `I'm working on: ${selectedTask.title}

Description:
${selectedTask.description}

Please confirm you're ready by saying: I'm ready to work on ${selectedTask.title} - Context is loaded.`;

    window.electronAPI.sendTerminalInput(id, contextMessage + '\r');
  }, [id, tasks, setAssociatedTask, updateTerminal]);

  const handleClearTask = useCallback(() => {
    setAssociatedTask(id, undefined);
    updateTerminal(id, { title: 'Claude' });
    // Sync to main process so title persists across hot reloads
    window.electronAPI.setTerminalTitle(id, 'Claude');
  }, [id, setAssociatedTask, updateTerminal]);

  // Worktree handlers
  const handleCreateWorktree = useCallback(() => {
    setShowWorktreeDialog(true);
  }, []);

  const applyWorktreeConfig = useCallback(async (config: TerminalWorktreeConfig) => {
    // IMPORTANT: Set isRecreatingRef BEFORE destruction to signal deliberate recreation
    // This prevents exit handlers from triggering auto-removal during controlled recreation
    isRecreatingRef.current = true;

    // Store pending config to be synced after PTY creation succeeds
    // This fixes race condition where IPC calls happen before terminal exists in main process
    pendingWorktreeConfigRef.current = config;

    // Set isCreatingRef BEFORE updating the store to prevent race condition
    // This prevents the PTY effect from running before destroyTerminal completes
    prepareForRecreate();

    // Update terminal store with worktree config
    setWorktreeConfig(id, config);
    // Try to sync to main process (may be ignored if terminal doesn't exist yet)
    // The onCreated callback will re-sync using pendingWorktreeConfigRef
    window.electronAPI.setTerminalWorktreeConfig(id, config);

    // Update terminal title and cwd to worktree path
    updateTerminal(id, { title: config.name, cwd: config.worktreePath });
    // Try to sync to main process (may be ignored if terminal doesn't exist yet)
    window.electronAPI.setTerminalTitle(id, config.name);

    // Destroy current PTY - a new one will be created in the worktree directory
    if (isCreatedRef.current) {
      await window.electronAPI.destroyTerminal(id);
      isCreatedRef.current = false;
    }

    // Reset PTY dimension tracking for new terminal
    // This ensures the new PTY will receive initial dimensions correctly
    lastPtyDimensionsRef.current = null;

    // Reset refs to allow recreation - effect will now trigger with new cwd
    resetForRecreate();
  }, [id, setWorktreeConfig, updateTerminal, prepareForRecreate, resetForRecreate]);

  const handleWorktreeCreated = useCallback(async (config: TerminalWorktreeConfig) => {
    await applyWorktreeConfig(config);
  }, [applyWorktreeConfig]);

  const handleSelectWorktree = useCallback(async (config: TerminalWorktreeConfig) => {
    await applyWorktreeConfig(config);
  }, [applyWorktreeConfig]);

  const handleOpenInIDE = useCallback(async () => {
    const worktreePath = terminal?.worktreeConfig?.worktreePath;
    if (!worktreePath) return;

    const preferredIDE = settings.preferredIDE || 'vscode';
    try {
      await window.electronAPI.worktreeOpenInIDE(
        worktreePath,
        preferredIDE,
        settings.customIDEPath
      );
    } catch (err) {
      console.error('Failed to open in IDE:', err);
      toast({
        title: 'Failed to open IDE',
        description: err instanceof Error ? err.message : 'Could not launch IDE',
        variant: 'destructive',
      });
    }
  }, [terminal?.worktreeConfig?.worktreePath, settings.preferredIDE, settings.customIDEPath, toast]);

  // Get backlog tasks for worktree dialog
  const backlogTasks = tasks.filter((t) => t.status === 'backlog');

  // Determine border color based on Claude busy state
  // Red (busy) = Claude is actively processing
  // Green (idle) = Claude is ready for input
  const isClaudeBusy = terminal?.isClaudeBusy;
  const showClaudeBusyIndicator = terminal?.isClaudeMode && isClaudeBusy !== undefined;

  return (
    <div
      ref={setDropRef}
      className={cn(
        'flex h-full flex-col rounded-lg border bg-[#0B0B0F] overflow-hidden transition-all relative',
        // Default border states
        isActive ? 'border-primary ring-1 ring-primary/20' : 'border-border',
        // File drop overlay
        showFileDropOverlay && 'ring-2 ring-info border-info',
        // Claude busy state indicator (subtle colored border when in Claude mode)
        showClaudeBusyIndicator && isClaudeBusy && 'border-red-500/60 ring-1 ring-red-500/20',
        showClaudeBusyIndicator && !isClaudeBusy && 'border-green-500/60 ring-1 ring-green-500/20'
      )}
      onClick={handleClick}
      onDragOver={handleNativeDragOver}
      onDragLeave={handleNativeDragLeave}
      onDrop={handleNativeDrop}
    >
      {showFileDropOverlay && (
        <div className="absolute inset-0 bg-info/10 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-info/90 text-info-foreground px-3 py-2 rounded-md">
            <FileDown className="h-4 w-4" />
            <span className="text-sm font-medium">Drop to insert path</span>
          </div>
        </div>
      )}

      <TerminalHeader
        terminalId={id}
        title={terminal?.title || 'Terminal'}
        status={terminal?.status || 'idle'}
        isClaudeMode={terminal?.isClaudeMode || false}
        tasks={tasks}
        associatedTask={associatedTask}
        onClose={onClose}
        onInvokeClaude={handleInvokeClaude}
        onTitleChange={handleTitleChange}
        onTaskSelect={handleTaskSelect}
        onClearTask={handleClearTask}
        onNewTaskClick={onNewTaskClick}
        terminalCount={terminalCount}
        worktreeConfig={terminal?.worktreeConfig}
        projectPath={projectPath}
        onCreateWorktree={handleCreateWorktree}
        onSelectWorktree={handleSelectWorktree}
        onOpenInIDE={handleOpenInIDE}
        dragHandleListeners={dragHandleListeners}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        pendingClaudeResume={terminal?.pendingClaudeResume}
      />

      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ minHeight: 0 }}
      />

      {/* Worktree creation dialog */}
      {projectPath && (
        <CreateWorktreeDialog
          open={showWorktreeDialog}
          onOpenChange={setShowWorktreeDialog}
          terminalId={id}
          projectPath={projectPath}
          backlogTasks={backlogTasks}
          onWorktreeCreated={handleWorktreeCreated}
        />
      )}
    </div>
  );
});
