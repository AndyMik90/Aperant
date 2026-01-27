import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import type { ImageAttachment } from '../../shared/types';
import {
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_TASK,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_IMAGE_TYPES_DISPLAY
} from '../../shared/constants';

interface ImageUploadProps {
  images: ImageAttachment[];
  onImagesChange: (images: ImageAttachment[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Generate a unique ID for images
 */
export function generateImageId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a file is a valid image type
 */
export function isValidImageType(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]);
}

/**
 * Check if a MIME type is a valid image type
 */
export function isValidImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_TYPES)[number]);
}

/**
 * Convert a File to base64 data URL
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a Blob to base64 data URL
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Create a thumbnail from an image data URL
 */
export async function createThumbnail(dataUrl: string, maxSize = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Scale down to maxSize while maintaining aspect ratio
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl); // Return original if thumbnail fails
    img.src = dataUrl;
  });
}

/**
 * Resolve duplicate filenames by adding timestamp
 */
export function resolveFilename(filename: string, existingFiles: string[]): string {
  if (!existingFiles.includes(filename)) {
    return filename;
  }

  const lastDot = filename.lastIndexOf('.');
  const name = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
  const ext = lastDot !== -1 ? filename.substring(lastDot) : '';
  const timestamp = Date.now();

  return `${name}-${timestamp}${ext}`;
}

export function ImageUpload({
  images,
  onImagesChange,
  disabled = false,
  className
}: ImageUploadProps) {
  const { t } = useTranslation('common');
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAddMore = images.length < MAX_IMAGES_PER_TASK;

  /**
   * Process files and add them to the images array
   */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(files);

      // Check how many more images we can add
      const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
      if (remainingSlots <= 0) {
        setError(t('imageUpload.maxImages', { count: MAX_IMAGES_PER_TASK }));
        return;
      }

      // Limit files to remaining slots
      const filesToProcess = fileArray.slice(0, remainingSlots);
      if (fileArray.length > remainingSlots) {
        setError(t('imageUpload.remainingSlots', { count: remainingSlots }));
      }

      const newImages: ImageAttachment[] = [];
      const existingFilenames = images.map((img) => img.filename);
      const errors: string[] = [];

      for (const file of filesToProcess) {
        // Validate file type
        if (!isValidImageType(file)) {
          errors.push(t('imageUpload.invalidType', { filename: file.name, allowedTypes: ALLOWED_IMAGE_TYPES_DISPLAY }));
          continue;
        }

        // Warn about large files
        if (file.size > MAX_IMAGE_SIZE) {
          errors.push(t('imageUpload.largeFile', { filename: file.name }));
          // Still allow the upload, just warn
        }

        try {
          const dataUrl = await fileToBase64(file);
          const thumbnail = await createThumbnail(dataUrl);
          const resolvedFilename = resolveFilename(file.name, [
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
        } catch {
          errors.push(t('imageUpload.processFailed', { filename: file.name }));
        }
      }

      if (errors.length > 0) {
        setError(errors.join(' '));
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
      }
    },
    [images, onImagesChange]
  );

  /**
   * Handle file input change
   */
  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [processFiles]
  );

  /**
   * Handle drag events
   */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
    },
    [disabled, processFiles]
  );

  /**
   * Remove an image
   */
  const handleRemove = useCallback(
    (imageId: string) => {
      onImagesChange(images.filter((img) => img.id !== imageId));
      setError(null);
    },
    [images, onImagesChange]
  );

  /**
   * Open file picker
   */
  const handleClick = useCallback(() => {
    if (!disabled && canAddMore) {
      fileInputRef.current?.click();
    }
  }, [disabled, canAddMore]);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-6 transition-all cursor-pointer',
          'flex flex-col items-center justify-center gap-2 text-center',
          isDragOver && !disabled
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50',
          disabled && 'opacity-50 cursor-not-allowed',
          !canAddMore && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          multiple
          onChange={handleFileChange}
          disabled={disabled || !canAddMore}
          className="hidden"
        />

        <div
          className={cn(
            'p-3 rounded-full transition-colors',
            isDragOver && !disabled ? 'bg-primary/10' : 'bg-muted'
          )}
        >
          <Upload className={cn('h-6 w-6', isDragOver && !disabled ? 'text-primary' : 'text-muted-foreground')} />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {canAddMore ? t('imageUpload.dropPrompt') : t('imageUpload.maxImagesReached', { max: MAX_IMAGES_PER_TASK })}
          </p>
          <p className="text-xs text-muted-foreground">
            {canAddMore
              ? t('imageUpload.sizeLimit', { allowedTypes: ALLOWED_IMAGE_TYPES_DISPLAY, current: images.length, max: MAX_IMAGES_PER_TASK })
              : t('imageUpload.maxImagesReached', { max: MAX_IMAGES_PER_TASK })}
          </p>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative group rounded-lg border border-border bg-card overflow-hidden"
            >
              {/* Thumbnail or placeholder */}
              <div className="aspect-square flex items-center justify-center bg-muted">
                {image.thumbnail ? (
                  <img
                    src={image.thumbnail}
                    alt={image.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                )}
              </div>

              {/* File info overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-xs text-white font-medium truncate">{image.filename}</p>
                <p className="text-[10px] text-white/70">{formatFileSize(image.size)}</p>
              </div>

              {/* Remove button */}
              {!disabled && (
                <Button
                  variant="destructive"
                  size="icon"
                  className={cn(
                    'absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity',
                    'rounded-full'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(image.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}

              {/* Large file warning indicator */}
              {image.size > MAX_IMAGE_SIZE && (
                <div
                  className="absolute top-1 left-1 p-1 rounded-full bg-warning/90"
                  title={t('imageUpload.largeFileWarning')}
                >
                  <AlertCircle className="h-3 w-3 text-warning-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
