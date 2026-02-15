import { useState, useCallback, useRef, type ClipboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserCheck,
  RotateCcw,
  RefreshCw,
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Image as ImageIcon,
  X,
  GitMerge,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import {
  generateImageId,
  blobToBase64,
  createThumbnail,
  isValidImageMimeType,
  resolveFilename,
} from '../../ImageUpload';
import type { Task, ImageAttachment } from '../../../../shared/types';
import {
  MAX_IMAGES_PER_TASK,
  ALLOWED_IMAGE_TYPES_DISPLAY,
} from '../../../../shared/constants';

interface HumanReviewPhaseBannerProps {
  task: Task;
  feedback: string;
  isSubmitting: boolean;
  onFeedbackChange: (value: string) => void;
  onReject: () => void;
  onMerge: () => void;
  isMerging: boolean;
  onRestartFromPlanning?: () => void;
  onRestartFromCoding?: () => void;
  isRestarting?: boolean;
  isRestartingCoding?: boolean;
  images?: ImageAttachment[];
  onImagesChange?: (images: ImageAttachment[]) => void;
}

/**
 * Banner shown above tabs for the human review phase.
 * Follows the same layout pattern as PlanningReview:
 * [Icon] Status Title  Description    [Action Buttons]
 * Expandable section for feedback textarea + restart buttons.
 */
export function HumanReviewPhaseBanner({
  task,
  feedback,
  isSubmitting,
  onFeedbackChange,
  onReject,
  onMerge,
  isMerging,
  onRestartFromPlanning,
  onRestartFromCoding,
  isRestarting = false,
  isRestartingCoding = false,
  images = [],
  onImagesChange,
}: HumanReviewPhaseBannerProps) {
  const { t } = useTranslation(['tasks']);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSubmitFeedback = feedback.trim() || images.length > 0;

  // Get review reason badge
  const reviewReason = task.reviewReason || 'completed';
  const reviewBadgeVariant = reviewReason === 'errors' ? 'destructive'
    : reviewReason === 'qa_rejected' ? 'warning'
    : 'success';

  // Image paste handler
  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onImagesChange) return;
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < clipboardItems.length; i++) {
      if (clipboardItems[i].type.startsWith('image/')) {
        imageItems.push(clipboardItems[i]);
      }
    }
    if (imageItems.length === 0) return;
    e.preventDefault();

    const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
    if (remainingSlots <= 0) {
      setError(t('feedback.maxImagesError', { count: MAX_IMAGES_PER_TASK }));
      return;
    }
    setError(null);

    const newImages: ImageAttachment[] = [];
    const existingFilenames = images.map(img => img.filename);
    const mimeToExt: Record<string, string> = { 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

    for (const item of imageItems.slice(0, remainingSlots)) {
      const file = item.getAsFile();
      if (!file) continue;
      if (!isValidImageMimeType(file.type)) {
        setError(t('feedback.invalidTypeError', { types: ALLOWED_IMAGE_TYPES_DISPLAY }));
        continue;
      }
      try {
        const dataUrl = await blobToBase64(file);
        const thumbnail = await createThumbnail(dataUrl);
        const ext = mimeToExt[file.type] || file.type.split('/')[1] || 'png';
        const baseFilename = `screenshot-${Date.now()}.${ext}`;
        const resolvedFilename = resolveFilename(baseFilename, [...existingFilenames, ...newImages.map(img => img.filename)]);
        newImages.push({ id: generateImageId(), filename: resolvedFilename, mimeType: file.type, size: file.size, data: dataUrl.split(',')[1], thumbnail });
      } catch {
        setError(t('feedback.processingError', 'Failed to process pasted image'));
      }
    }
    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2000);
    }
  }, [images, onImagesChange, t]);

  // Image drop handler
  const handleDrop = useCallback(async (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!onImagesChange || isSubmitting) return;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) imageFiles.push(files[i]);
    }
    if (imageFiles.length === 0) return;

    const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
    if (remainingSlots <= 0) {
      setError(t('feedback.maxImagesError', { count: MAX_IMAGES_PER_TASK }));
      return;
    }
    setError(null);

    const newImages: ImageAttachment[] = [];
    const existingFilenames = images.map(img => img.filename);
    const mimeToExt: Record<string, string> = { 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

    for (const file of imageFiles.slice(0, remainingSlots)) {
      if (!isValidImageMimeType(file.type)) {
        setError(t('feedback.invalidTypeError', { types: ALLOWED_IMAGE_TYPES_DISPLAY }));
        continue;
      }
      try {
        const dataUrl = await blobToBase64(file);
        const thumbnail = await createThumbnail(dataUrl);
        const ext = mimeToExt[file.type] || file.type.split('/')[1] || 'png';
        const baseFilename = file.name || `dropped-image-${Date.now()}.${ext}`;
        const resolvedFilename = resolveFilename(baseFilename, [...existingFilenames, ...newImages.map(img => img.filename)]);
        newImages.push({ id: generateImageId(), filename: resolvedFilename, mimeType: file.type, size: file.size, data: dataUrl.split(',')[1], thumbnail });
      } catch {
        setError(t('feedback.processingError', 'Failed to process dropped image'));
      }
    }
    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2000);
    }
  }, [images, isSubmitting, onImagesChange, t]);

  const handleRemoveImage = useCallback((imageId: string) => {
    if (!onImagesChange) return;
    onImagesChange(images.filter(img => img.id !== imageId));
    setError(null);
  }, [images, onImagesChange]);

  return (
    <div className="border-b border-purple-500/30 bg-purple-500/5">
      {/* Banner header with actions */}
      <div className="px-5 py-3 flex items-center gap-3">
        <UserCheck className="h-4 w-4 text-purple-500 flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {t('phaseBanners.humanReview.title', { defaultValue: 'Ready for Review' })}
          </span>
          <Badge variant={reviewBadgeVariant} className="text-xs">
            {t(`tasks:reviewReason.${reviewReason}`, { defaultValue: reviewReason })}
          </Badge>
        </div>

        {/* Toggle feedback section */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-muted-foreground"
          onClick={() => setShowFeedback(!showFeedback)}
        >
          <MessageSquare className="h-3 w-3" />
          {showFeedback ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>

        {/* Request Changes button */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => {
            if (!showFeedback) setShowFeedback(true);
            else if (canSubmitFeedback) onReject();
          }}
          disabled={isSubmitting || isMerging}
        >
          {isSubmitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          {t('feedback.requestChanges', { defaultValue: 'Request Changes' })}
        </Button>

        {/* Approve & Merge button */}
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1.5"
          onClick={onMerge}
          disabled={isMerging || isSubmitting}
        >
          {isMerging ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <GitMerge className="h-3 w-3" />
          )}
          {t('phaseBanners.humanReview.approve', { defaultValue: 'Approve & Merge' })}
        </Button>
      </div>

      {/* Expandable feedback section */}
      {showFeedback && (
        <div className="px-5 pb-3 space-y-2">
          <textarea
            ref={textareaRef}
            value={feedback}
            onChange={(e) => onFeedbackChange(e.target.value)}
            onPaste={handlePaste}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
            onDrop={handleDrop}
            placeholder={t('feedback.placeholder', { defaultValue: 'Describe the issues or changes needed...' })}
            className={cn(
              'w-full min-h-[60px] max-h-[100px] text-sm resize-none rounded-md border border-input bg-background px-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              isDragOver && !isSubmitting && 'border-primary bg-primary/5 ring-2 ring-primary/20'
            )}
            disabled={isSubmitting}
          />

          {/* Image thumbnails */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="relative group rounded-md border border-border overflow-hidden"
                  style={{ width: '48px', height: '48px' }}
                  title={image.filename}
                >
                  {image.thumbnail ? (
                    <img src={image.thumbnail} alt={image.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  {!isSubmitting && (
                    <button
                      type="button"
                      className="absolute top-0.5 right-0.5 h-3.5 w-3.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); handleRemoveImage(image.id); }}
                      aria-label={t('feedback.removeImage', 'Remove image')}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Paste/drop success + error indicators */}
          {pasteSuccess && (
            <div className="flex items-center gap-2 text-xs text-success">
              <ImageIcon className="h-3 w-3" />
              {t('feedback.imageAdded', 'Image added!')}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Restart buttons row */}
          {(onRestartFromCoding || onRestartFromPlanning) && (
            <div className="flex items-center gap-2 pt-1">
              {onRestartFromCoding && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={onRestartFromCoding}
                  disabled={isRestartingCoding || isRestarting || isSubmitting}
                >
                  {isRestartingCoding ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('feedback.restartFromCoding', { defaultValue: 'Restart from Coding' })}
                </Button>
              )}
              {onRestartFromPlanning && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={onRestartFromPlanning}
                  disabled={isRestarting || isRestartingCoding || isSubmitting}
                >
                  {isRestarting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('feedback.restartFromPlanning', { defaultValue: 'Restart from Planning' })}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
