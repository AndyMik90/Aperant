
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { ImageAttachment } from '../../../shared/types';

interface ImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: ImageAttachment | null;
}

export function ImagePreviewModal({ open, onOpenChange, image }: ImagePreviewModalProps) {
  const { t } = useTranslation(['tasks', 'common']);

  if (!image) return null;

  // Determine the image source - prefer full-resolution data for enlarged preview, fall back to thumbnail
  const imageSrc = image.data ? `data:${image.mimeType};base64,${image.data}` : image.thumbnail || null;
  const isThumbnailFallback = !image.data && image.thumbnail;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay with dark background and backdrop blur */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/80 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />

        {/* Content container */}
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-8 z-50 flex flex-col items-center justify-center',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200'
          )}
        >
          {/* Header with title and close button */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4">
            <DialogPrimitive.Title className="text-lg font-medium text-white truncate max-w-[calc(100%-60px)]">
              {image.filename}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className={cn(
                'rounded-lg p-2',
                'text-white/70 hover:text-white',
                'hover:bg-white/10 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-white/50',
                'disabled:pointer-events-none'
              )}
              aria-label={t('tasks:imagePreview.close')}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">{t('tasks:imagePreview.close')}</span>
            </DialogPrimitive.Close>
          </div>

          {/* Image display */}
          <div className="flex flex-col items-center justify-center w-full h-full p-8 gap-4">
            {imageSrc ? (
              <>
                <img
                  src={imageSrc}
                  alt={image.filename}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                />
                {/* Show indicator when displaying thumbnail fallback */}
                {isThumbnailFallback && (
                  <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm">
                    <p className="text-xs text-white/70">{t('tasks:imagePreview.lowResolution')}</p>
                  </div>
                )}
              </>
            ) : (
              // Fallback when no image data is available
              <div className="flex flex-col items-center justify-center text-white/50">
                <ImageIcon className="h-24 w-24 mb-4" />
                <p className="text-sm">{t('tasks:imagePreview.unavailable')}</p>
              </div>
            )}
          </div>

          {/* Hidden description for accessibility */}
          <DialogPrimitive.Description className="sr-only">
            {t('tasks:imagePreview.description', { filename: image.filename })}
          </DialogPrimitive.Description>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
