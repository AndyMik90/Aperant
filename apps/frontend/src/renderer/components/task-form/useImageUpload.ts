/**
 * useImageUpload - Shared hook for handling image paste and drag-drop in task forms
 *
 * Extracts the duplicated image handling logic from TaskCreationWizard and TaskEditDialog
 * into a reusable hook.
 */
import { useState, useCallback, useRef, useEffect, useMemo, type ClipboardEvent, type DragEvent } from 'react';
import {
  generateImageId,
  blobToBase64,
  createThumbnail,
  isValidImageMimeType,
  resolveFilename
} from '../ImageUpload';
import type { ImageAttachment } from '../../../shared/types';
import {
  MAX_IMAGES_PER_TASK,
  MAX_IMAGE_SIZE,
  ALLOWED_IMAGE_TYPES_DISPLAY
} from '../../../shared/constants';

/** Data structure for file reference drops from FileTreeItem */
export interface FileReferenceData {
  type: 'file-reference';
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Error messages that can be customized/translated by callers */
interface ImageUploadErrorMessages {
  maxImagesReached?: string;
  invalidImageType?: string;
  imageTooLarge?: string;
  processPasteFailed?: string;
  processDropFailed?: string;
}

interface UseImageUploadOptions {
  /** Current images array */
  images: ImageAttachment[];
  /** Callback when images change */
  onImagesChange: (images: ImageAttachment[]) => void;
  /** Whether the form is disabled (e.g., during submission) */
  disabled?: boolean;
  /** Callback to set error message */
  onError?: (error: string | null) => void;
  /** Custom error messages for i18n support */
  errorMessages?: ImageUploadErrorMessages;
  /** Callback when a file reference is dropped (from FileTreeItem drag) */
  onFileReferenceDrop?: (reference: string, data: FileReferenceData) => void;
}

interface UseImageUploadReturn {
  /** Whether user is dragging over the textarea */
  isDragOver: boolean;
  /** Whether an image was just successfully added */
  pasteSuccess: boolean;
  /** Handle paste event on textarea */
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
  /** Handle drag over event on textarea */
  handleDragOver: (e: DragEvent<HTMLTextAreaElement>) => void;
  /** Handle drag leave event on textarea */
  handleDragLeave: (e: DragEvent<HTMLTextAreaElement>) => void;
  /** Handle drop event on textarea */
  handleDrop: (e: DragEvent<HTMLTextAreaElement>) => Promise<void>;
  /** Remove an image by ID */
  removeImage: (imageId: string) => void;
  /** Whether more images can be added */
  canAddMore: boolean;
  /** Number of remaining image slots */
  remainingSlots: number;
}

// Default error messages (English fallbacks)
const DEFAULT_ERROR_MESSAGES: Required<ImageUploadErrorMessages> = {
  maxImagesReached: `Maximum of ${MAX_IMAGES_PER_TASK} images allowed`,
  invalidImageType: `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES_DISPLAY}`,
  imageTooLarge: `Image exceeds maximum size of ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB`,
  processPasteFailed: 'Failed to process pasted image',
  processDropFailed: 'Failed to process dropped image'
};

export function useImageUpload({
  images,
  onImagesChange,
  disabled = false,
  onError,
  errorMessages = {},
  onFileReferenceDrop
}: UseImageUploadOptions): UseImageUploadReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge custom error messages with defaults (memoized to prevent useCallback invalidation)
  const errors = useMemo<Required<ImageUploadErrorMessages>>(() => ({
    ...DEFAULT_ERROR_MESSAGES,
    ...errorMessages
  }), [errorMessages]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
  const canAddMore = remainingSlots > 0;

  /**
   * Process image items and add them to the images array
   */
  const processImageItems = useCallback(
    async (
      items: DataTransferItem[] | File[],
      options: { isFromPaste?: boolean } = {}
    ) => {
      if (disabled) return;

      if (remainingSlots <= 0) {
        onError?.(errors.maxImagesReached);
        return;
      }

      onError?.(null);

      const newImages: ImageAttachment[] = [];
      const existingFilenames = images.map((img) => img.filename);

      // Process items up to remaining slots
      const itemsToProcess = items.slice(0, remainingSlots);

      for (const item of itemsToProcess) {
        let file: File | null = null;

        if (item instanceof File) {
          file = item;
        } else if ('getAsFile' in item) {
          file = item.getAsFile();
        }

        if (!file) continue;

        // Validate image type
        if (!isValidImageMimeType(file.type)) {
          onError?.(errors.invalidImageType);
          continue;
        }

        // Validate file size
        if (file.size > MAX_IMAGE_SIZE) {
          onError?.(errors.imageTooLarge);
          continue;
        }

        try {
          const dataUrl = await blobToBase64(file);
          const thumbnail = await createThumbnail(dataUrl);

          // Generate filename based on source
          let baseFilename: string;
          if (options.isFromPaste || !file.name || file.name === 'image.png') {
            const extension = file.type.split('/')[1] || 'png';
            baseFilename = `screenshot-${Date.now()}.${extension}`;
          } else {
            baseFilename = file.name;
          }

          const resolvedFilename = resolveFilename(baseFilename, [
            ...existingFilenames,
            ...newImages.map((img) => img.filename)
          ]);

          newImages.push({
            id: generateImageId(),
            filename: resolvedFilename,
            mimeType: file.type,
            size: file.size,
            data: dataUrl.split(',')[1], // Store base64 without data URL prefix
            thumbnail
          });
        } catch (error) {
          console.error('Image processing error:', error);
          onError?.(options.isFromPaste ? errors.processPasteFailed : errors.processDropFailed);
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
        // Show success feedback (clear any existing timeout first)
        if (successTimeoutRef.current) {
          clearTimeout(successTimeoutRef.current);
        }
        setPasteSuccess(true);
        successTimeoutRef.current = setTimeout(() => setPasteSuccess(false), 2000);
      }
    },
    [images, onImagesChange, disabled, remainingSlots, onError, errors]
  );

  /**
   * Handle paste event for screenshot support
   */
  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;

      // Find image items in clipboard
      const imageItems: DataTransferItem[] = [];
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type.startsWith('image/')) {
          imageItems.push(item);
        }
      }

      // If no images, allow normal paste behavior
      if (imageItems.length === 0) return;

      // Prevent default paste when we have images
      e.preventDefault();

      await processImageItems(imageItems, { isFromPaste: true });
    },
    [processImageItems]
  );

  /**
   * Handle drag over textarea
   */
  const handleDragOver = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  /**
   * Handle drag leave from textarea
   */
  const handleDragLeave = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  /**
   * Parse file reference data from drag event dataTransfer
   * Returns the parsed data if valid, null otherwise
   */
  const parseFileReferenceData = useCallback((dataTransfer: DataTransfer): FileReferenceData | null => {
    // Check for application/json data (set by FileTreeItem)
    const jsonData = dataTransfer.getData('application/json');
    if (!jsonData) return null;

    try {
      const data = JSON.parse(jsonData) as Record<string, unknown>;
      // Validate required fields - path and name must be non-empty strings
      // isDirectory is optional and defaults to false if missing or not a boolean
      // This aligns with parseFileReferenceDrop in shell-escape.ts
      if (
        data.type === 'file-reference' &&
        typeof data.path === 'string' &&
        data.path.length > 0 &&
        typeof data.name === 'string' &&
        data.name.length > 0
      ) {
        return {
          type: 'file-reference',
          path: data.path,
          name: data.name,
          isDirectory: typeof data.isDirectory === 'boolean' ? data.isDirectory : false
        };
      }
    } catch {
      // Invalid JSON, not a file reference
    }
    return null;
  }, []);

  /**
   * Handle drop on textarea for image files and file references
   * File references from FileTreeItem (drag from file tree) are detected and handled
   * via the onFileReferenceDrop callback. Image files are processed as attachments.
   */
  const handleDrop = useCallback(
    async (e: DragEvent<HTMLTextAreaElement>) => {
      // Check disabled state first, before any state changes or preventDefault calls
      // This ensures drops are properly rejected when the component is disabled
      if (disabled) {
        setIsDragOver(false);
        return;
      }

      setIsDragOver(false);

      // First, check for file reference drops from FileTreeItem
      // These have 'application/json' with type: 'file-reference' and 'text/plain' with @filename
      const fileRefData = parseFileReferenceData(e.dataTransfer);
      if (fileRefData) {
        e.preventDefault();
        e.stopPropagation();

        // Get the @filename reference text
        const reference = e.dataTransfer.getData('text/plain') || `@${fileRefData.name}`;

        // Call the callback if provided
        if (onFileReferenceDrop) {
          onFileReferenceDrop(reference, fileRefData);
        }
        return;
      }

      const files = e.dataTransfer?.files;

      // Filter for image files
      const imageFiles: File[] = [];
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            imageFiles.push(file);
          }
        }
      }

      // Only prevent default if we have image files to process
      // This allows other drops to work via default behavior
      if (imageFiles.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      await processImageItems(imageFiles, { isFromPaste: false });
    },
    [disabled, processImageItems, parseFileReferenceData, onFileReferenceDrop]
  );

  /**
   * Remove an image by ID
   */
  const removeImage = useCallback(
    (imageId: string) => {
      onImagesChange(images.filter((img) => img.id !== imageId));
    },
    [images, onImagesChange]
  );

  return {
    isDragOver,
    pasteSuccess,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    canAddMore,
    remainingSlots
  };
}
