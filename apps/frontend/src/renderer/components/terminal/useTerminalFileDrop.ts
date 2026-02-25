/**
 * Custom hook for handling native HTML5 file drop events in Terminal.
 *
 * This hook encapsulates the file drop handling logic from FileTreeItem drag events,
 * making it testable in isolation using renderHook() from React Testing Library.
 *
 * The hook handles:
 * - Native drag over detection for application/json data
 * - File reference parsing and validation
 * - Shell argument escaping for safe command execution
 * - Terminal input insertion via electronAPI
 */
import { useState, useCallback, type DragEvent } from 'react';
import { parseFileReferenceDrop, escapeShellArg } from '../../../shared/utils/shell-escape';

export interface UseTerminalFileDropOptions {
  /** Terminal ID for sending input */
  terminalId: string;
  /** Callback to send input to terminal - defaults to window.electronAPI.sendTerminalInput */
  sendTerminalInput?: (terminalId: string, input: string) => void;
}

export interface UseTerminalFileDropResult {
  /** Whether a native file drag is currently over the drop zone */
  isNativeDragOver: boolean;
  /** Handler for native dragover events */
  handleNativeDragOver: (e: DragEvent<HTMLDivElement>) => void;
  /** Handler for native dragleave events */
  handleNativeDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  /** Handler for native drop events */
  handleNativeDrop: (e: DragEvent<HTMLDivElement>) => void;
}

/**
 * Hook for handling native file drag-and-drop in Terminal components.
 *
 * This hook is extracted from Terminal.tsx to enable proper unit testing
 * using renderHook() rather than duplicating implementation logic in tests.
 *
 * @example
 * ```tsx
 * const { isNativeDragOver, handleNativeDragOver, handleNativeDragLeave, handleNativeDrop } =
 *   useTerminalFileDrop({ terminalId: 'term-1' });
 *
 * return (
 *   <div
 *     onDragOver={handleNativeDragOver}
 *     onDragLeave={handleNativeDragLeave}
 *     onDrop={handleNativeDrop}
 *   >
 *     {isNativeDragOver && <DropOverlay />}
 *   </div>
 * );
 * ```
 */
export function useTerminalFileDrop({
  terminalId,
  sendTerminalInput = (id, input) => window.electronAPI.sendTerminalInput(id, input)
}: UseTerminalFileDropOptions): UseTerminalFileDropResult {
  // Native HTML5 drag state for files dragged from FileTreeItem
  // This is needed because FileTreeItem uses native HTML5 drag events,
  // not @dnd-kit, so we must handle native drop events separately
  const [isNativeDragOver, setIsNativeDragOver] = useState(false);

  // Handle native drag over (for files from FileTreeItem)
  const handleNativeDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Check if it's a file reference drag (from FileTreeItem)
    if (e.dataTransfer.types.includes('application/json')) {
      e.preventDefault();
      e.stopPropagation();
      setIsNativeDragOver(true);
    }
  }, []);

  // Handle native drag leave
  const handleNativeDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only reset if actually leaving the container, not just moving to a child element
    // HTML5 drag events fire dragleave when moving from parent to child
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    // Note: dragleave is not cancelable, so preventDefault() has no effect
    // We only call stopPropagation to prevent event bubbling
    e.stopPropagation();
    setIsNativeDragOver(false);
  }, []);

  // Handle native drop (for files from FileTreeItem)
  const handleNativeDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    setIsNativeDragOver(false);
    // Use parseFileReferenceDrop utility to validate and extract file reference data
    const fileRef = parseFileReferenceDrop(e.dataTransfer);
    if (fileRef) {
      e.preventDefault();
      e.stopPropagation();
      // Use escapeShellArg to safely escape path for shell execution
      // This handles all shell metacharacters (quotes, $, backticks, etc.)
      const escapedPath = escapeShellArg(fileRef.path);
      // Insert the file path into the terminal with a trailing space
      sendTerminalInput(terminalId, escapedPath + ' ');
    }
  }, [terminalId, sendTerminalInput]);

  return {
    isNativeDragOver,
    handleNativeDragOver,
    handleNativeDragLeave,
    handleNativeDrop
  };
}
