/**
 * Unit tests for Terminal file drop handling via useTerminalFileDrop hook
 *
 * Tests file drag-and-drop from FileTreeItem to insert file paths into terminal.
 * Uses renderHook() from React Testing Library to test actual component behavior
 * rather than duplicating implementation logic in test helpers.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalFileDrop } from '../terminal/useTerminalFileDrop';
import { escapeShellArg, parseFileReferenceDrop, type FileReferenceDropData } from '../../../shared/utils/shell-escape';

// Mock sendTerminalInput for testing
const mockSendTerminalInput = vi.fn();

// Setup before tests
beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTerminalFileDrop Hook', () => {
  // Helper to create mock DragEvent with file reference data
  function createMockDragEvent(
    fileRefData: FileReferenceDropData | null,
    options: {
      types?: string[];
      relatedTarget?: Node | null;
      currentTarget?: { contains: (node: Node | null) => boolean };
    } = {}
  ): React.DragEvent<HTMLDivElement> {
    const types = options.types ?? (fileRefData ? ['application/json'] : []);
    const getData = vi.fn((type: string): string => {
      if (type === 'application/json' && fileRefData) {
        return JSON.stringify(fileRefData);
      }
      return '';
    });

    return {
      dataTransfer: {
        types,
        getData,
        setData: vi.fn(),
        effectAllowed: 'none' as DataTransfer['effectAllowed'],
        dropEffect: 'none' as DataTransfer['dropEffect']
      } as unknown as DataTransfer,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      relatedTarget: options.relatedTarget ?? null,
      currentTarget: options.currentTarget ?? { contains: () => false }
    } as unknown as React.DragEvent<HTMLDivElement>;
  }

  // Helper to create file reference drag data (matches FileTreeItem format)
  function createFileReferenceDragData(path: string, name: string, isDirectory = false): FileReferenceDropData {
    return {
      type: 'file-reference',
      path,
      name,
      isDirectory
    };
  }

  describe('handleNativeDrop - File Path Insertion', () => {
    it('should call sendTerminalInput with escaped file path when dropping valid file reference', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-1',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/file.ts', 'file.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-1', "'/path/to/file.ts' ");
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should escape file path with spaces using single quotes', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-2',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/my file.ts', 'my file.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-2', "'/path/to/my file.ts' ");
    });

    it('should add trailing space after file path', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-3',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/file.ts', 'file.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      const callArg = mockSendTerminalInput.mock.calls[0][1];
      expect(callArg.endsWith(' ')).toBe(true);
    });

    it('should handle directory paths the same as file paths', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-4',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/directory', 'directory', true);
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-4', "'/path/to/directory' ");
    });

    it('should handle directory paths with spaces', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-5',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/my directory', 'my directory', true);
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-5', "'/path/to/my directory' ");
    });
  });

  describe('handleNativeDrop - Invalid Data Handling', () => {
    it('should not call sendTerminalInput when drag data is not file-reference type', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-6',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const invalidData = { type: 'other-type', path: '/path/to/file.ts' } as unknown as FileReferenceDropData;
      const mockEvent = createMockDragEvent(invalidData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).not.toHaveBeenCalled();
    });

    it('should not call sendTerminalInput when drag data has no path property', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-7',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const invalidData = { type: 'file-reference', name: 'file.ts' } as unknown as FileReferenceDropData;
      const mockEvent = createMockDragEvent(invalidData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).not.toHaveBeenCalled();
    });

    it('should not call sendTerminalInput when JSON data is empty', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-8',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const mockEvent = createMockDragEvent(null);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully without throwing', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-9',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const mockEvent = {
        dataTransfer: {
          types: ['application/json'],
          getData: vi.fn(() => 'not valid json'),
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { contains: () => false }
      } as unknown as React.DragEvent<HTMLDivElement>;

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleNativeDrop(mockEvent);
        });
      }).not.toThrow();
      expect(mockSendTerminalInput).not.toHaveBeenCalled();
    });
  });

  describe('handleNativeDragOver', () => {
    it('should set isNativeDragOver to true when dataTransfer contains application/json type', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-10',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      expect(result.current.isNativeDragOver).toBe(false);

      const mockEvent = createMockDragEvent(
        createFileReferenceDragData('/test/path', 'file.ts'),
        { types: ['application/json'] }
      );

      act(() => {
        result.current.handleNativeDragOver(mockEvent);
      });

      expect(result.current.isNativeDragOver).toBe(true);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should not set isNativeDragOver when dataTransfer does not contain application/json type', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-11',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const mockEvent = createMockDragEvent(null, { types: ['text/plain'] });

      act(() => {
        result.current.handleNativeDragOver(mockEvent);
      });

      expect(result.current.isNativeDragOver).toBe(false);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('handleNativeDragLeave', () => {
    it('should set isNativeDragOver to false when leaving the container', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-12',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      // First set drag over state
      const dragOverEvent = createMockDragEvent(
        createFileReferenceDragData('/test/path', 'file.ts'),
        { types: ['application/json'] }
      );

      act(() => {
        result.current.handleNativeDragOver(dragOverEvent);
      });
      expect(result.current.isNativeDragOver).toBe(true);

      // Then leave the container (relatedTarget is not contained)
      const leaveEvent = createMockDragEvent(null, {
        relatedTarget: null,
        currentTarget: { contains: () => false }
      });

      act(() => {
        result.current.handleNativeDragLeave(leaveEvent);
      });

      expect(result.current.isNativeDragOver).toBe(false);
    });

    it('should not reset isNativeDragOver when moving to a child element', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-13',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      // First set drag over state
      const dragOverEvent = createMockDragEvent(
        createFileReferenceDragData('/test/path', 'file.ts'),
        { types: ['application/json'] }
      );

      act(() => {
        result.current.handleNativeDragOver(dragOverEvent);
      });
      expect(result.current.isNativeDragOver).toBe(true);

      // Move to a child element (relatedTarget is contained)
      const childNode = {} as Node;
      const leaveEvent = createMockDragEvent(null, {
        relatedTarget: childNode,
        currentTarget: { contains: (node: Node | null) => node === childNode }
      });

      act(() => {
        result.current.handleNativeDragLeave(leaveEvent);
      });

      // Should still be true - moving to child doesn't reset state
      expect(result.current.isNativeDragOver).toBe(true);
    });
  });

  describe('Drop State Reset', () => {
    it('should set isNativeDragOver to false on drop', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-14',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      // First set drag over state
      const dragOverEvent = createMockDragEvent(
        createFileReferenceDragData('/test/path', 'file.ts'),
        { types: ['application/json'] }
      );

      act(() => {
        result.current.handleNativeDragOver(dragOverEvent);
      });
      expect(result.current.isNativeDragOver).toBe(true);

      // Drop
      const dropEvent = createMockDragEvent(
        createFileReferenceDragData('/path/to/file.ts', 'file.ts')
      );

      act(() => {
        result.current.handleNativeDrop(dropEvent);
      });

      expect(result.current.isNativeDragOver).toBe(false);
    });

    it('should reset isNativeDragOver even when drop data is invalid', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-15',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      // First set drag over state
      const dragOverEvent = createMockDragEvent(
        createFileReferenceDragData('/test/path', 'file.ts'),
        { types: ['application/json'] }
      );

      act(() => {
        result.current.handleNativeDragOver(dragOverEvent);
      });
      expect(result.current.isNativeDragOver).toBe(true);

      // Drop with invalid data
      const dropEvent = createMockDragEvent(null);

      act(() => {
        result.current.handleNativeDrop(dropEvent);
      });

      // Should still reset drag state
      expect(result.current.isNativeDragOver).toBe(false);
      expect(mockSendTerminalInput).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long file paths', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-long',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const longPath = '/path/' + 'a'.repeat(200) + '/file.ts';
      const dragData = createFileReferenceDragData(longPath, 'file.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-long', `'${longPath}' `);
    });

    it('should handle paths with unicode characters', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-unicode',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const unicodePath = '/path/to/文件.ts';
      const dragData = createFileReferenceDragData(unicodePath, '文件.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-unicode', `'${unicodePath}' `);
    });

    it('should handle paths with unicode characters and spaces', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-unicode-space',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const unicodePath = '/path/to/我的 文件.ts';
      const dragData = createFileReferenceDragData(unicodePath, '我的 文件.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-unicode-space', `'${unicodePath}' `);
    });

    it('should handle relative paths', () => {
      const { result } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'test-terminal-relative',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const relativePath = './relative/path/file.ts';
      const dragData = createFileReferenceDragData(relativePath, 'file.ts');
      const mockEvent = createMockDragEvent(dragData);

      act(() => {
        result.current.handleNativeDrop(mockEvent);
      });

      expect(mockSendTerminalInput).toHaveBeenCalledWith('test-terminal-relative', `'${relativePath}' `);
    });

    it('should handle multiple drops with different terminal IDs', () => {
      const { result: result1 } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'terminal-a',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const { result: result2 } = renderHook(() =>
        useTerminalFileDrop({
          terminalId: 'terminal-b',
          sendTerminalInput: mockSendTerminalInput
        })
      );

      const dragData = createFileReferenceDragData('/path/to/file.ts', 'file.ts');

      act(() => {
        result1.current.handleNativeDrop(createMockDragEvent(dragData));
      });

      act(() => {
        result2.current.handleNativeDrop(createMockDragEvent(dragData));
      });

      expect(mockSendTerminalInput).toHaveBeenCalledTimes(2);
      expect(mockSendTerminalInput).toHaveBeenNthCalledWith(1, 'terminal-a', "'/path/to/file.ts' ");
      expect(mockSendTerminalInput).toHaveBeenNthCalledWith(2, 'terminal-b', "'/path/to/file.ts' ");
    });
  });
});

describe('parseFileReferenceDrop Utility', () => {
  // Helper to create mock DataTransfer
  function createMockDataTransfer(jsonData: object | null): DataTransfer {
    return {
      types: ['application/json'],
      getData: vi.fn((type: string) => {
        if (type === 'application/json' && jsonData) {
          return JSON.stringify(jsonData);
        }
        return '';
      }),
      setData: vi.fn(),
      effectAllowed: 'none'
    } as unknown as DataTransfer;
  }

  it('should parse valid file reference data', () => {
    const dataTransfer = createMockDataTransfer({
      type: 'file-reference',
      path: '/path/to/file.ts',
      name: 'file.ts',
      isDirectory: false
    });

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result).toEqual({
      type: 'file-reference',
      path: '/path/to/file.ts',
      name: 'file.ts',
      isDirectory: false
    });
  });

  it('should return null for non-file-reference type', () => {
    const dataTransfer = createMockDataTransfer({ type: 'other-type', path: '/test' });

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result).toBeNull();
  });

  it('should return null when path is missing', () => {
    const dataTransfer = createMockDataTransfer({ type: 'file-reference', name: 'file.ts' });

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result).toBeNull();
  });

  it('should return null for empty JSON data', () => {
    const dataTransfer = createMockDataTransfer(null);
    dataTransfer.getData = vi.fn(() => '');

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const dataTransfer = createMockDataTransfer(null);
    dataTransfer.getData = vi.fn(() => 'not valid json');

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result).toBeNull();
  });

  it('should handle directory flag', () => {
    const dataTransfer = createMockDataTransfer({
      type: 'file-reference',
      path: '/path/to/dir',
      name: 'dir',
      isDirectory: true
    });

    const result = parseFileReferenceDrop(dataTransfer);

    expect(result?.isDirectory).toBe(true);
  });
});

describe('escapeShellArg Utility', () => {
  it('should wrap paths in single quotes', () => {
    const path = '/path/to/file.ts';
    const escaped = escapeShellArg(path);
    expect(escaped).toBe("'/path/to/file.ts'");
  });

  it('should handle paths with spaces', () => {
    const path = '/path/to my special file.ts';
    const escaped = escapeShellArg(path);
    expect(escaped).toBe("'/path/to my special file.ts'");
  });

  it('should handle empty path', () => {
    const path = '';
    const escaped = escapeShellArg(path);
    expect(escaped).toBe("''");
  });

  it('should handle paths with special characters', () => {
    const path = '/path/to/file@2.0.ts';
    const escaped = escapeShellArg(path);
    expect(escaped).toBe("'/path/to/file@2.0.ts'");
  });

  // Shell-unsafe character tests
  it('should properly escape paths with double quotes', () => {
    const path = '/path/to/"quoted"file.ts';
    const escaped = escapeShellArg(path);
    // Single-quoted strings don't need double quotes escaped
    expect(escaped).toBe('\'/path/to/"quoted"file.ts\'');
  });

  it('should properly escape paths with dollar signs', () => {
    const path = '/path/to/$HOME/file.ts';
    const escaped = escapeShellArg(path);
    // Single-quoted strings prevent shell expansion
    expect(escaped).toBe("'/path/to/$HOME/file.ts'");
  });

  it('should properly escape paths with backticks', () => {
    const path = '/path/to/`command`/file.ts';
    const escaped = escapeShellArg(path);
    // Single-quoted strings prevent command substitution
    expect(escaped).toBe("'/path/to/`command`/file.ts'");
  });

  it('should properly escape paths with single quotes', () => {
    const path = "/path/to/it's/file.ts";
    const escaped = escapeShellArg(path);
    // Single quotes within single quotes need special handling: '\''
    expect(escaped).toBe("'/path/to/it'\\''s/file.ts'");
  });

  it('should properly escape paths with backslashes', () => {
    const path = '/path/to/file\\name.ts';
    const escaped = escapeShellArg(path);
    // Backslashes are literal inside single quotes
    expect(escaped).toBe("'/path/to/file\\name.ts'");
  });

  it('should handle complex paths with multiple shell metacharacters', () => {
    const path = '/path/to/$USER\'s "files"`cmd`/test.ts';
    const escaped = escapeShellArg(path);
    // Only single quotes need special escaping
    expect(escaped).toBe("'/path/to/$USER'\\''s \"files\"`cmd`/test.ts'");
  });

  it('should handle paths with newlines', () => {
    const path = '/path/to/file\nwith\nnewlines.ts';
    const escaped = escapeShellArg(path);
    // Newlines are literal inside single quotes
    expect(escaped).toBe("'/path/to/file\nwith\nnewlines.ts'");
  });
});

/**
 * Integration test using a minimal component wrapper
 *
 * This verifies that the useTerminalFileDrop hook works correctly when used
 * in a component context with actual DOM event handlers attached.
 *
 * Note: Testing the full Terminal component would require extensive mocking
 * of xterm.js, @dnd-kit, zustand stores, and electron APIs. Instead, we:
 * 1. Test the hook directly using renderHook() (above)
 * 2. Test a minimal component that uses the hook to verify DOM integration
 *
 * This approach follows the same pattern as useImageUpload.fileref.test.ts
 * and ensures the actual drop handling logic is tested, not duplicated.
 */
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

describe('Terminal File Drop - Component Integration', () => {
  const mockSendInput = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Minimal component that uses the hook exactly like Terminal.tsx does
  function TestDropZone({ terminalId }: { terminalId: string }) {
    const { isNativeDragOver, handleNativeDragOver, handleNativeDragLeave, handleNativeDrop } =
      useTerminalFileDrop({
        terminalId,
        sendTerminalInput: mockSendInput
      });

    return (
      <div
        data-testid="drop-zone"
        onDragOver={handleNativeDragOver}
        onDragLeave={handleNativeDragLeave}
        onDrop={handleNativeDrop}
        className={isNativeDragOver ? 'drag-over' : ''}
      >
        Drop files here
      </div>
    );
  }

  // Helper to create a native DragEvent for fireEvent
  function createDropEvent(fileRefData: FileReferenceDropData | null): Partial<DragEvent> {
    const getData = (type: string): string => {
      if (type === 'application/json' && fileRefData) {
        return JSON.stringify(fileRefData);
      }
      return '';
    };

    return {
      dataTransfer: {
        types: fileRefData ? ['application/json'] : [],
        getData,
        setData: vi.fn(),
        effectAllowed: 'none',
        dropEffect: 'none'
      } as unknown as DataTransfer
    };
  }

  it('should call sendTerminalInput when valid file is dropped on component', () => {
    const { getByTestId } = render(<TestDropZone terminalId="test-terminal" />);
    const dropZone = getByTestId('drop-zone');

    const dropEvent = createDropEvent({
      type: 'file-reference',
      path: '/path/to/dropped-file.ts',
      name: 'dropped-file.ts',
      isDirectory: false
    });

    fireEvent.drop(dropZone, dropEvent);

    expect(mockSendInput).toHaveBeenCalledWith('test-terminal', "'/path/to/dropped-file.ts' ");
  });

  it('should not call sendTerminalInput when invalid data is dropped', () => {
    const { getByTestId } = render(<TestDropZone terminalId="test-terminal" />);
    const dropZone = getByTestId('drop-zone');

    const dropEvent = createDropEvent({
      type: 'other-type',
      path: '/path/to/file.ts',
      name: 'file.ts',
      isDirectory: false
    } as unknown as FileReferenceDropData);

    fireEvent.drop(dropZone, dropEvent);

    expect(mockSendInput).not.toHaveBeenCalled();
  });

  it('should escape paths with spaces when dropped on component', () => {
    const { getByTestId } = render(<TestDropZone terminalId="test-terminal" />);
    const dropZone = getByTestId('drop-zone');

    const dropEvent = createDropEvent({
      type: 'file-reference',
      path: '/path/to/my file.ts',
      name: 'my file.ts',
      isDirectory: false
    });

    fireEvent.drop(dropZone, dropEvent);

    expect(mockSendInput).toHaveBeenCalledWith('test-terminal', "'/path/to/my file.ts' ");
  });

  it('should escape paths with single quotes when dropped on component', () => {
    const { getByTestId } = render(<TestDropZone terminalId="test-terminal" />);
    const dropZone = getByTestId('drop-zone');

    const dropEvent = createDropEvent({
      type: 'file-reference',
      path: "/path/to/it's-a-file.ts",
      name: "it's-a-file.ts",
      isDirectory: false
    });

    fireEvent.drop(dropZone, dropEvent);

    // Single quotes are escaped as '\''
    expect(mockSendInput).toHaveBeenCalledWith('test-terminal', "'/path/to/it'\\''s-a-file.ts' ");
  });
});
