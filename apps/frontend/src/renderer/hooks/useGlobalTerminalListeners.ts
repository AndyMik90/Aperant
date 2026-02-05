import { useEffect } from 'react';
import { writeToTerminal, useTerminalStore } from '../stores/terminal-store';
import { terminalBufferManager } from '../lib/terminal-buffer-manager';
import { debugLog, debugWarn } from '../../shared/utils/debug-logger';
import type { Terminal } from '../stores/terminal-store';
import type { StructuredBlock } from '../../shared/types';
import { ClaudeOutputParser } from '../lib/claude-output-parser';

/**
 * Module-level cleanup function storage.
 *
 * DESIGN NOTE: This module-level variable is intentionally shared across all hook instances.
 * This is acceptable because:
 * 1. There's only one app instance that uses this hook (in App.tsx)
 * 2. The listener needs to persist across component re-renders
 * 3. Having a single global listener ensures all terminal output is captured
 *    regardless of which project is currently active or which terminals are rendered
 *
 * This pattern mirrors useIpc.ts where module-level state is used for IPC batching.
 */
let globalCleanup: (() => void) | null = null;

/**
 * Hook to set up global terminal output listeners that persist across project switches.
 *
 * This hook solves the terminal output freezing issue when switching between projects.
 * The problem was that terminal output listeners were registered in useTerminalEvents.ts
 * per-terminal component - when a terminal component unmounted (user switches project),
 * the listener was removed and output stopped being buffered.
 *
 * By registering the listener at the app level (like useIpcListeners), we ensure:
 * 1. Terminal output is ALWAYS buffered to terminalBufferManager, regardless of which
 *    project is active or which terminal components are mounted
 * 2. When a terminal has a registered callback (visible), output is written to xterm immediately
 * 3. When a terminal becomes visible again, it can replay the buffered output
 * 4. No output is lost during project navigation
 *
 * This hook should be called once in App.tsx alongside useIpcListeners().
 */
export function useGlobalTerminalListeners(): void {
  useEffect(() => {
    // Only register once - prevent duplicate listeners
    if (globalCleanup) {
      debugWarn('[GlobalTerminalListeners] Listener already registered, skipping');
      return;
    }

    debugLog('[GlobalTerminalListeners] Registering global terminal output listener');

    // Register global terminal output listener
    // This listener runs for ALL terminals, regardless of which project is active
    const cleanupOutput = window.electronAPI.onTerminalOutput((terminalId: string, data: string) => {
      // Use writeToTerminal which:
      // 1. Always buffers to terminalBufferManager for persistence
      // 2. Writes to xterm immediately if terminal has a registered callback (visible)
      writeToTerminal(terminalId, data);

      debugLog(
        `[GlobalTerminalListeners] Processed output for ${terminalId}, buffer size: ${terminalBufferManager.getSize(terminalId)}`
      );
    });

    // Register task monitor terminal creation listener
    const cleanupTaskMonitor = window.electronAPI.onTaskMonitorTerminalCreate((terminalData: Partial<Terminal>) => {
      debugLog('[GlobalTerminalListeners] Task monitor terminal created:', terminalData);

      // Check if terminal already exists to prevent duplicates
      const existingTerminal = useTerminalStore.getState().terminals.find(t => t.id === terminalData.id);
      if (existingTerminal) {
        debugLog('[GlobalTerminalListeners] Terminal already exists, skipping:', terminalData.id);
        return;
      }

      // Add terminal to store with rich UI initialized
      const newTerminal: Terminal = {
        id: terminalData.id!,
        title: terminalData.title || 'Task Monitor',
        status: 'running',
        cwd: terminalData.projectPath || '',
        createdAt: new Date(),
        isClaudeMode: false,
        projectPath: terminalData.projectPath,
        isTaskMonitor: true,
        taskId: terminalData.taskId,
        specId: terminalData.specId,
        taskStatus: terminalData.taskStatus || 'running',
        displayOrder: useTerminalStore.getState().terminals.length,
        // Initialize rich chat UI
        viewMode: 'rich',
        messages: [],
        parser: new ClaudeOutputParser(),
        isStreaming: false,
      };

      useTerminalStore.setState((state) => ({
        terminals: [...state.terminals, newTerminal],
      }));
    });

    // Register structured output listener for task monitor UI
    // This receives pre-parsed blocks from main process for efficient rendering
    // IMPORTANT: Always process blocks regardless of view mode so data is always available
    const cleanupStructuredOutput = window.electronAPI.onTerminalStructuredOutput(
      (terminalId: string, block: StructuredBlock) => {
        // Process for ALL task monitor terminals (both raw and rich modes)
        const terminal = useTerminalStore.getState().terminals.find(t => t.id === terminalId);
        if (terminal?.isTaskMonitor) {
          useTerminalStore.getState().appendStructuredBlock(terminalId, block);
          debugLog(
            `[GlobalTerminalListeners] Processed structured block for ${terminalId}: ${block.type}`
          );
        }
      }
    );

    globalCleanup = () => {
      cleanupOutput();
      cleanupTaskMonitor();
      cleanupStructuredOutput();
    };

    // Cleanup on unmount (app shutdown)
    return () => {
      if (globalCleanup) {
        debugLog('[GlobalTerminalListeners] Cleaning up global terminal output listener');
        globalCleanup();
        globalCleanup = null;
      }
    };
  }, []); // Empty deps - only run once on mount
}
