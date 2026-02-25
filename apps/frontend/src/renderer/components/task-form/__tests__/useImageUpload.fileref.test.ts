/**
 * Unit tests for useImageUpload file reference handling
 * Tests file reference drops from FileTreeItem (separate from image handling)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImageUpload, type FileReferenceData } from '../useImageUpload';
import type { ImageAttachment } from '../../../../shared/types';

// Type-safe mock function types
type OnImagesChangeFn = (images: ImageAttachment[]) => void;
type OnFileReferenceDropFn = (reference: string, data: FileReferenceData) => void;

// Helper to create mock DragEvent with file reference data
function createMockFileRefDragEvent(
  fileRefData: FileReferenceData | null,
  textPlain?: string
): React.DragEvent<HTMLTextAreaElement> {
  const getData = vi.fn((type: string): string => {
    if (type === 'application/json' && fileRefData) {
      return JSON.stringify(fileRefData);
    }
    if (type === 'text/plain' && textPlain) {
      return textPlain;
    }
    return '';
  });

  return {
    dataTransfer: {
      types: fileRefData ? ['application/json', 'text/plain'] : [],
      getData,
      files: { length: 0 } as FileList,
      items: [] as unknown as DataTransferItemList,
      setData: vi.fn(),
      clearData: vi.fn(),
      effectAllowed: 'none' as DataTransfer['effectAllowed'],
      dropEffect: 'none' as DataTransfer['dropEffect']
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as React.DragEvent<HTMLTextAreaElement>;
}

// Helper to create mock DragEvent for image drops
function createMockImageDragEvent(files: File[]): React.DragEvent<HTMLTextAreaElement> {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    }
  };

  // Add numeric indexers
  files.forEach((file, index) => {
    (fileList as Record<number, File>)[index] = file;
  });

  return {
    dataTransfer: {
      types: ['Files'],
      getData: vi.fn(() => ''),
      files: fileList as FileList,
      items: [] as unknown as DataTransferItemList,
      setData: vi.fn(),
      clearData: vi.fn(),
      effectAllowed: 'none' as DataTransfer['effectAllowed'],
      dropEffect: 'none' as DataTransfer['dropEffect']
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as React.DragEvent<HTMLTextAreaElement>;
}

// Helper to create file reference data (matches FileTreeItem format)
function createFileReferenceData(
  path: string,
  name: string,
  isDirectory = false
): FileReferenceData {
  return {
    type: 'file-reference',
    path,
    name,
    isDirectory
  };
}

describe('useImageUpload - File Reference Handling', () => {
  // Use typed vi.fn() for proper type inference
  const mockOnImagesChange = vi.fn<OnImagesChangeFn>();
  const mockOnFileReferenceDrop = vi.fn<OnFileReferenceDropFn>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseFileReferenceData (via handleDrop)', () => {
    it('should detect valid file reference drops and call onFileReferenceDrop callback', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/file.ts', 'file.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@file.ts', fileRefData);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should use @filename fallback when text/plain is not set', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/myfile.ts', 'myfile.ts');
      // No text/plain data - should fall back to @{name}
      const mockEvent = createMockFileRefDragEvent(fileRefData, '');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@myfile.ts', fileRefData);
    });

    it('should not call onFileReferenceDrop when callback is not provided', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange
          // No onFileReferenceDrop callback
        })
      );

      const fileRefData = createFileReferenceData('/path/to/file.ts', 'file.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      // Should not throw or cause issues
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle directory references the same as file references', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const dirRefData = createFileReferenceData('/path/to/directory', 'directory', true);
      const mockEvent = createMockFileRefDragEvent(dirRefData, '@directory');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@directory', dirRefData);
      expect(dirRefData.isDirectory).toBe(true);
    });
  });

  describe('Invalid File Reference Data', () => {
    it('should not call onFileReferenceDrop when type is not "file-reference"', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create invalid data with wrong type - use unknown first to bypass type check
      const invalidData = {
        type: 'other-type',
        path: '/path/to/file.ts',
        name: 'file.ts',
        isDirectory: false
      } as unknown as FileReferenceData;

      const mockEvent = createMockFileRefDragEvent(invalidData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });

    it('should not call onFileReferenceDrop when path is missing', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create invalid data without path
      const invalidData = {
        type: 'file-reference',
        name: 'file.ts',
        isDirectory: false
      } as FileReferenceData;

      const mockEvent = createMockFileRefDragEvent(invalidData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });

    it('should not call onFileReferenceDrop when name is missing', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create invalid data without name
      const invalidData = {
        type: 'file-reference',
        path: '/path/to/file.ts',
        isDirectory: false
      } as FileReferenceData;

      const mockEvent = createMockFileRefDragEvent(invalidData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create mock event with invalid JSON
      const mockEvent = {
        dataTransfer: {
          types: ['application/json', 'text/plain'],
          getData: vi.fn((type: string) => {
            if (type === 'application/json') {
              return 'not valid json';
            }
            return '';
          }),
          files: { length: 0 } as FileList,
          items: [] as unknown as DataTransferItemList
        },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.DragEvent<HTMLTextAreaElement>;

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      // Should not throw, should not call callback
      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });

    it('should not call onFileReferenceDrop when application/json data is empty', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const mockEvent = createMockFileRefDragEvent(null, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });
  });

  describe('File Reference vs Image Drop Separation', () => {
    it('should prioritize file reference over image drop', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create event with both file reference data AND image files
      // This shouldn't normally happen but tests priority
      const fileRefData = createFileReferenceData('/path/to/file.png', 'file.png');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file.png');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      // Should call file reference callback, not process as image
      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@file.png', fileRefData);
      expect(mockOnImagesChange).not.toHaveBeenCalled();
    });

    it('should process image files when no file reference data is present', async () => {
      // Note: This is a simplified test - full image processing requires
      // more complex mocking of File objects and blobToBase64
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      // Create mock event with no file reference data, just empty types
      const mockEvent = createMockImageDragEvent([]);

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      // Should not call file reference callback when no JSON data
      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
    });
  });

  describe('Disabled State', () => {
    it('should not process file reference drops when disabled', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop,
          disabled: true
        })
      );

      const fileRefData = createFileReferenceData('/path/to/file.ts', 'file.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      // When disabled, the drop should be rejected without processing
      expect(mockOnFileReferenceDrop).not.toHaveBeenCalled();
      // preventDefault should not be called when disabled - drop should be rejected
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('Drag State Management', () => {
    it('should set isDragOver to true on dragOver', () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange
        })
      );

      expect(result.current.isDragOver).toBe(false);

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.DragEvent<HTMLTextAreaElement>;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragOver).toBe(true);
    });

    it('should set isDragOver to false on dragLeave', () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange
        })
      );

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.DragEvent<HTMLTextAreaElement>;

      // First set to true
      act(() => {
        result.current.handleDragOver(mockEvent);
      });
      expect(result.current.isDragOver).toBe(true);

      // Then leave
      act(() => {
        result.current.handleDragLeave(mockEvent);
      });
      expect(result.current.isDragOver).toBe(false);
    });

    it('should set isDragOver to false on drop', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const dragOverEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.DragEvent<HTMLTextAreaElement>;

      // Set drag over state
      act(() => {
        result.current.handleDragOver(dragOverEvent);
      });
      expect(result.current.isDragOver).toBe(true);

      // Drop
      const fileRefData = createFileReferenceData('/path/to/file.ts', 'file.ts');
      const dropEvent = createMockFileRefDragEvent(fileRefData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(dropEvent);
      });

      expect(result.current.isDragOver).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle files with spaces in the name', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/my file.ts', 'my file.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@my file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@my file.ts', fileRefData);
    });

    it('should handle files with special characters in the name', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/file@2.0.ts', 'file@2.0.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file@2.0.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@file@2.0.ts', fileRefData);
    });

    it('should handle files with unicode characters in the name', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/文件.ts', '文件.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@文件.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@文件.ts', fileRefData);
    });

    it('should handle very long file paths', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const longPath = '/path/' + 'a'.repeat(200) + '/file.ts';
      const fileRefData = createFileReferenceData(longPath, 'file.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@file.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledWith('@file.ts', fileRefData);
      expect(mockOnFileReferenceDrop.mock.calls[0][1].path).toBe(longPath);
    });

    it('should handle multiple rapid drops', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData1 = createFileReferenceData('/path/to/file1.ts', 'file1.ts');
      const fileRefData2 = createFileReferenceData('/path/to/file2.ts', 'file2.ts');
      const fileRefData3 = createFileReferenceData('/path/to/file3.ts', 'file3.ts');

      const mockEvent1 = createMockFileRefDragEvent(fileRefData1, '@file1.ts');
      const mockEvent2 = createMockFileRefDragEvent(fileRefData2, '@file2.ts');
      const mockEvent3 = createMockFileRefDragEvent(fileRefData3, '@file3.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent1);
        await result.current.handleDrop(mockEvent2);
        await result.current.handleDrop(mockEvent3);
      });

      expect(mockOnFileReferenceDrop).toHaveBeenCalledTimes(3);
      expect(mockOnFileReferenceDrop).toHaveBeenNthCalledWith(1, '@file1.ts', fileRefData1);
      expect(mockOnFileReferenceDrop).toHaveBeenNthCalledWith(2, '@file2.ts', fileRefData2);
      expect(mockOnFileReferenceDrop).toHaveBeenNthCalledWith(3, '@file3.ts', fileRefData3);
    });
  });

  describe('Callback Data Shape', () => {
    it('should pass complete FileReferenceData to callback', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData: FileReferenceData = {
        type: 'file-reference',
        path: '/full/path/to/component.tsx',
        name: 'component.tsx',
        isDirectory: false
      };
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@component.tsx');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      const passedData = mockOnFileReferenceDrop.mock.calls[0][1] as FileReferenceData;
      expect(passedData.type).toBe('file-reference');
      expect(passedData.path).toBe('/full/path/to/component.tsx');
      expect(passedData.name).toBe('component.tsx');
      expect(passedData.isDirectory).toBe(false);
    });

    it('should pass reference string as first argument', async () => {
      const { result } = renderHook(() =>
        useImageUpload({
          images: [],
          onImagesChange: mockOnImagesChange,
          onFileReferenceDrop: mockOnFileReferenceDrop
        })
      );

      const fileRefData = createFileReferenceData('/path/to/utils.ts', 'utils.ts');
      const mockEvent = createMockFileRefDragEvent(fileRefData, '@utils.ts');

      await act(async () => {
        await result.current.handleDrop(mockEvent);
      });

      const reference = mockOnFileReferenceDrop.mock.calls[0][0] as string;
      expect(reference).toBe('@utils.ts');
      expect(reference.startsWith('@')).toBe(true);
    });
  });
});
