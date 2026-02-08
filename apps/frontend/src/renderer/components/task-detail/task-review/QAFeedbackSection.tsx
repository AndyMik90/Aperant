import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RotateCcw, RefreshCw, Loader2, Image as ImageIcon, X, BookOpen } from 'lucide-react';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { Checkbox } from '../../ui/checkbox';
import { Label } from '../../ui/label';
import {
  generateImageId,
  blobToBase64,
  createThumbnail,
  isValidImageMimeType,
  resolveFilename
} from '../../ImageUpload';
import { cn } from '../../../lib/utils';
import type { ImageAttachment } from '../../../../shared/types';
import {
  MAX_IMAGES_PER_TASK,
  ALLOWED_IMAGE_TYPES_DISPLAY
} from '../../../../shared/constants';

interface QAFeedbackSectionProps {
  feedback: string;
  isSubmitting: boolean;
  onFeedbackChange: (value: string) => void;
  onReject: () => void;
  /** Callback to restart the task from planning phase */
  onRestartFromPlanning?: () => void;
  /** Whether a restart from planning is in progress */
  isRestarting?: boolean;
  /** Image attachments for visual feedback - optional for backward compatibility */
  images?: ImageAttachment[];
  /** Callback when images change - optional for backward compatibility */
  onImagesChange?: (images: ImageAttachment[]) => void;
  /** SUG-23: Save feedback as learning for future tasks */
  saveAsLearning?: boolean;
  /** SUG-23: Callback when save as learning changes */
  onSaveAsLearningChange?: (value: boolean) => void;
}

/**
 * Displays the QA feedback section where users can request changes
 * Supports image paste and drag-drop for visual feedback
 */
export function QAFeedbackSection({
  feedback,
  isSubmitting,
  onFeedbackChange,
  onReject,
  onRestartFromPlanning,
  isRestarting = false,
  images = [],
  onImagesChange,
  saveAsLearning = false,
  onSaveAsLearningChange
}: QAFeedbackSectionProps) {
  const { t } = useTranslation('tasks');

  // Feature is enabled when onImagesChange callback is provided
  const imageUploadEnabled = !!onImagesChange;

  // Ref for the textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Local state for UI feedback
  const [isDragOverTextarea, setIsDragOverTextarea] = useState(false);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Handle paste event for screenshot support
   */
  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // Skip image handling if feature is not enabled
    if (!onImagesChange) return;

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

    // Check if we can add more images
    const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
    if (remainingSlots <= 0) {
      setError(t('feedback.maxImagesError', { count: MAX_IMAGES_PER_TASK }));
      return;
    }

    setError(null);

    // Process image items
    const newImages: ImageAttachment[] = [];
    const existingFilenames = images.map(img => img.filename);

    for (const item of imageItems.slice(0, remainingSlots)) {
      const file = item.getAsFile();
      if (!file) continue;

      // Validate image type
      if (!isValidImageMimeType(file.type)) {
        setError(t('feedback.invalidTypeError', { types: ALLOWED_IMAGE_TYPES_DISPLAY }));
        continue;
      }

      try {
        const dataUrl = await blobToBase64(file);
        const thumbnail = await createThumbnail(dataUrl);

        // Generate filename for pasted images (screenshot-timestamp.ext)
        // Map MIME types to proper file extensions (handles svg+xml -> svg, etc.)
        const mimeToExtension: Record<string, string> = {
          'image/svg+xml': 'svg',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
        };
        const extension = mimeToExtension[file.type] || file.type.split('/')[1] || 'png';
        const baseFilename = `screenshot-${Date.now()}.${extension}`;
        const resolvedFilename = resolveFilename(baseFilename, [
          ...existingFilenames,
          ...newImages.map(img => img.filename)
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
        console.error('[QAFeedbackSection] Failed to process pasted image:', error);
        setError(t('feedback.processingError', 'Failed to process pasted image'));
      }
    }

    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
      // Show success feedback
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2000);
    }
  }, [images, onImagesChange, t]);

  /**
   * Handle drag over textarea for image drops
   */
  const handleTextareaDragOver = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverTextarea(true);
  }, []);

  /**
   * Handle drag leave from textarea
   */
  const handleTextareaDragLeave = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverTextarea(false);
  }, []);

  /**
   * Handle drop on textarea for images
   */
  const handleTextareaDrop = useCallback(
    async (e: DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOverTextarea(false);

      // Skip image handling if feature is not enabled
      if (!onImagesChange) return;
      if (isSubmitting) return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Filter for image files
      const imageFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      // Check if we can add more images
      const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
      if (remainingSlots <= 0) {
        setError(t('feedback.maxImagesError', { count: MAX_IMAGES_PER_TASK }));
        return;
      }

      setError(null);

      // Process image files
      const newImages: ImageAttachment[] = [];
      const existingFilenames = images.map(img => img.filename);

      for (const file of imageFiles.slice(0, remainingSlots)) {
        // Validate image type
        if (!isValidImageMimeType(file.type)) {
          setError(t('feedback.invalidTypeError', { types: ALLOWED_IMAGE_TYPES_DISPLAY }));
          continue;
        }

        try {
          const dataUrl = await blobToBase64(file);
          const thumbnail = await createThumbnail(dataUrl);

          // Use original filename or generate one with proper extension
          // Map MIME types to proper file extensions (handles svg+xml -> svg, etc.)
          const mimeToExtension: Record<string, string> = {
            'image/svg+xml': 'svg',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
          };
          const extension = mimeToExtension[file.type] || file.type.split('/')[1] || 'png';
          const baseFilename = file.name || `dropped-image-${Date.now()}.${extension}`;
          const resolvedFilename = resolveFilename(baseFilename, [
            ...existingFilenames,
            ...newImages.map(img => img.filename)
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
          console.error('[QAFeedbackSection] Failed to process dropped image:', error);
          setError(t('feedback.processingError', 'Failed to process dropped image'));
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...images, ...newImages]);
        // Show success feedback
        setPasteSuccess(true);
        setTimeout(() => setPasteSuccess(false), 2000);
      }
    },
    [images, isSubmitting, onImagesChange, t]
  );

  /**
   * Remove an image from the attachments
   */
  const handleRemoveImage = useCallback((imageId: string) => {
    if (!onImagesChange) return;
    onImagesChange(images.filter(img => img.id !== imageId));
    setError(null);
  }, [images, onImagesChange]);

  // Allow submission with either text feedback or images
  const canSubmit = feedback.trim() || images.length > 0;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
      <h3 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-warning" />
        {t('feedback.requestChanges', 'Request Changes')}
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        {t('feedback.description', 'Found issues? Describe what needs to be fixed and the AI will continue working on it.')}
      </p>

      {/* Textarea with paste/drop support */}
      <Textarea
        ref={textareaRef}
        placeholder={t('feedback.placeholder', 'Describe the issues or changes needed...')}
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        onPaste={handlePaste}
        onDragOver={handleTextareaDragOver}
        onDragLeave={handleTextareaDragLeave}
        onDrop={handleTextareaDrop}
        className={cn(
          "mb-2",
          // Visual feedback when dragging over textarea
          isDragOverTextarea && !isSubmitting && "border-primary bg-primary/5 ring-2 ring-primary/20"
        )}
        rows={3}
        disabled={isSubmitting}
      />

      {/* Drag/paste hint - only show when feature is enabled */}
      {imageUploadEnabled && (
        <p className="text-xs text-muted-foreground mb-2">
          {t('feedback.dragDropHint', 'Drag & drop images or paste screenshots')}
        </p>
      )}

      {/* Paste Success Indicator */}
      {pasteSuccess && (
        <div className="flex items-center gap-2 text-sm text-success mb-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <ImageIcon className="h-4 w-4" />
          {t('feedback.imageAdded', 'Image added successfully!')}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-sm text-destructive mb-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Image Thumbnails - displayed inline below textarea */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative group rounded-md border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              style={{ width: '64px', height: '64px' }}
              title={image.filename}
            >
              {image.thumbnail ? (
                <img
                  src={image.thumbnail}
                  alt={image.filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              {/* Remove button */}
              {!isSubmitting && (
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(image.id);
                  }}
                  aria-label={t('feedback.removeImage', 'Remove image')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* SUG-23: Save as Learning checkbox */}
      {onSaveAsLearningChange && feedback.trim() && (
        <div className="flex items-start gap-2 mb-3 p-2 rounded-lg bg-muted/50 border border-border">
          <Checkbox
            id="save-as-learning"
            checked={saveAsLearning}
            onCheckedChange={(checked) => onSaveAsLearningChange(checked === true)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <div className="flex-1">
            <Label
              htmlFor="save-as-learning"
              className="text-sm font-medium cursor-pointer flex items-center gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              {t('learnings.saveAsLearning', 'Save this feedback as a learning for future tasks')}
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('learnings.saveAsLearningHint', 'This feedback will be remembered and used to improve future task execution.')}
            </p>
          </div>
        </div>
      )}

      <Button
        variant="warning"
        onClick={onReject}
        disabled={isSubmitting || !canSubmit}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('feedback.submitting', 'Submitting...')}
          </>
        ) : (
          <>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('feedback.requestChanges', 'Request Changes')}
          </>
        )}
      </Button>

      {onRestartFromPlanning && (
        <Button
          variant="outline"
          onClick={onRestartFromPlanning}
          disabled={isRestarting || isSubmitting}
          className="w-full text-muted-foreground hover:text-foreground"
        >
          {isRestarting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('feedback.restarting', 'Restarting...')}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('feedback.restartFromPlanning', 'Restart from Planning')}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
