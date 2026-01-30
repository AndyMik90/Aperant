/**
 * Clipboard IPC Handlers
 *
 * Provides clipboard read functionality that extracts both text and images.
 * This is useful for features like AI task splitting where users want to
 * paste content that includes both text and images from the clipboard.
 */
import { ipcMain, clipboard, nativeImage } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type { IPCResult } from '../../shared/types';

export interface ClipboardImage {
  id: string;
  dataUrl: string;
  mimeType: string;
  size: number;
}

export interface ClipboardContent {
  text: string;
  images: ClipboardImage[];
}

/**
 * Register clipboard handlers
 */
export function registerClipboardHandlers(): void {
  /**
   * Read clipboard content (text + images)
   *
   * Extracts both text and images from the clipboard.
   * Returns the text content and an array of images as base64 data URLs.
   */
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ_WITH_IMAGES, async (): Promise<IPCResult<ClipboardContent>> => {
    try {
      // Get all available clipboard formats
      const formats = clipboard.availableFormats();

      const result: ClipboardContent = {
        text: '',
        images: []
      };

      // Extract text if available
      if (formats.includes('text/plain')) {
        result.text = clipboard.readText();
      }

      // Extract images if available
      if (formats.includes('image/png') || formats.includes('image/jpeg')) {
        // Try to read image from clipboard
        const image = clipboard.readImage();

        if (!image.isEmpty()) {
          // Generate a unique ID for this image
          const imageId = `clipboard-img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          // Convert to base64 data URL
          // Prefer PNG for better quality, fallback to JPEG
          let dataUrl: string;
          let mimeType: string;

          const bufferSize = image.getSize();
          const pngBuffer = image.toPNG();

          // If PNG is too large (> 2MB), use JPEG with compression
          if (pngBuffer.length > 2 * 1024 * 1024) {
            const jpegQuality = Math.max(0.1, 1 - (pngBuffer.length / (10 * 1024 * 1024))); // Scale quality based on size
            const jpegBuffer = image.toJPEG(jpegQuality);
            dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
            mimeType = 'image/jpeg';
          } else {
            dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            mimeType = 'image/png';
          }

          result.images.push({
            id: imageId,
            dataUrl,
            mimeType,
            size: Buffer.from(dataUrl.split(',')[1], 'base64').length
          });
        }
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[Clipboard] Failed to read clipboard:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read clipboard'
      };
    }
  });

  console.warn('[IPC] Clipboard handlers registered');
}
