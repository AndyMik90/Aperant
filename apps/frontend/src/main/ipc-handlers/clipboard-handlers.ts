/**
 * Clipboard IPC Handlers
 *
 * Provides clipboard read functionality that extracts both text and images.
 * This is useful for features like AI task splitting where users want to
 * paste content that includes both text and images from the clipboard.
 */
import { ipcMain, clipboard, nativeImage, net } from 'electron';
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
 * Fetch an image from a URL and convert it to a base64 data URL
 */
function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string; size: number } | null> {
  return new Promise((resolve) => {
    console.warn('[Clipboard] Fetching image:', url.substring(0, 100));

    const request = net.request({
      method: 'GET',
      url: url
    });

    // Set user agent to avoid being blocked
    request.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const chunks: Buffer[] = [];

    request.on('response', (response) => {
      const statusCode = response.statusCode;
      console.warn('[Clipboard] Response status:', statusCode);

      // Check if the request was successful
      if (!statusCode || statusCode < 200 || statusCode >= 300) {
        console.warn('[Clipboard] Failed to fetch image, status:', statusCode);
        resolve(null);
        return;
      }

      // Get content type from headers (may be string or string array)
      const contentTypeHeader = response.headers['content-type'];
      const contentType = typeof contentTypeHeader === 'string'
        ? contentTypeHeader
        : Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64}`;

          console.warn('[Clipboard] Image fetched successfully, size:', buffer.length, 'bytes');
          resolve({ dataUrl, mimeType, size: buffer.length });
        } catch (error) {
          console.error('[Clipboard] Error processing image:', error);
          resolve(null);
        }
      });
    });

    request.on('error', (error) => {
      console.error('[Clipboard] Network error fetching image:', error.message);
      resolve(null);
    });

    request.end();
  });
}

/**
 * Check if a URL is likely a content image (not an emoji or UI icon)
 */
function isContentImageUrl(url: string): boolean {
  // Decode HTML entities like &amp;
  const decodedUrl = url.replace(/&amp;/g, '&');

  // Filter out emojis (usually in /images/emoji.php)
  if (decodedUrl.includes('/images/emoji.php')) {
    return false;
  }

  // Filter out small UI icons (usually in /rsrc.php with small dimensions)
  if (decodedUrl.includes('/rsrc.php/v4/')) {
    return false;
  }

  // Look for actual content images - Facebook content photos are in /v/t39.30808-6/
  if (decodedUrl.includes('/v/t39.30808-6/') || decodedUrl.includes('/v/t39.30808')) {
    return true;
  }

  // Generic check: allow images from scontent domains (Facebook content)
  if (decodedUrl.includes('scontent-') && decodedUrl.includes('.fbcdn.net')) {
    return true;
  }

  // Default to false for unknown patterns
  return false;
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

      console.warn('[Clipboard] Available clipboard formats:', formats);

      const result: ClipboardContent = {
        text: '',
        images: []
      };

      // Extract text content
      if (formats.includes('text/plain')) {
        result.text = clipboard.readText();
        console.warn('[Clipboard] Text content length:', result.text.length, 'chars');
        console.warn('[Clipboard] Text preview:', result.text.substring(0, 200));
      }

      // Check for HTML format (Facebook posts often copy as HTML with img tags)
      if (formats.includes('text/html')) {
        const htmlContent = clipboard.readHTML();
        console.warn('[Clipboard] HTML content detected, length:', htmlContent.length);

        // Extract image URLs from HTML img tags
        const imgMatches = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/gi);
        if (imgMatches && imgMatches.length > 0) {
          console.warn('[Clipboard] Found', imgMatches.length, 'img tags in HTML content');

          // Extract unique URLs
          const uniqueUrls = new Set<string>();
          const contentImageUrls: string[] = [];

          for (const match of imgMatches) {
            const src = match.match(/src=["']([^"']+)["']/)?.[1];
            if (src) {
              // Decode HTML entities
              const decodedUrl = src.replace(/&amp;/g, '&');
              if (!uniqueUrls.has(decodedUrl)) {
                uniqueUrls.add(decodedUrl);

                // Check if this is a content image (not emoji/UI icon)
                if (isContentImageUrl(decodedUrl)) {
                  contentImageUrls.push(decodedUrl);
                  console.warn(`[Clipboard]   Content image:`, decodedUrl.substring(0, 100));
                } else {
                  console.warn(`[Clipboard]   Skipped (UI element):`, decodedUrl.substring(0, 100));
                }
              }
            }
          }

          // Fetch content images in parallel
          if (contentImageUrls.length > 0) {
            console.warn('[Clipboard] Fetching', contentImageUrls.length, 'content images...');

            const fetchResults = await Promise.all(
              contentImageUrls.map(url => fetchImageAsDataUrl(url))
            );

            for (let i = 0; i < fetchResults.length; i++) {
              const fetchResult = fetchResults[i];
              if (fetchResult) {
                const imageId = `clipboard-img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                result.images.push({
                  id: imageId,
                  dataUrl: fetchResult.dataUrl,
                  mimeType: fetchResult.mimeType,
                  size: fetchResult.size
                });
                console.warn(`[Clipboard] Successfully fetched image ${i + 1}/${contentImageUrls.length}`);
              } else {
                console.warn(`[Clipboard] Failed to fetch image ${i + 1}/${contentImageUrls.length}`);
              }
            }
          } else {
            console.warn('[Clipboard] No content images found (all were UI elements/emojis)');
          }
        }
      }

      // Extract images if available (single image from clipboard)
      if (formats.includes('image/png') || formats.includes('image/jpeg')) {
        console.warn('[Clipboard] Image format detected in clipboard');

        // Try to read image from clipboard
        const image = clipboard.readImage();

        if (!image.isEmpty()) {
          console.warn('[Clipboard] Image detected, size:', image.getSize());

          // Generate a unique ID for this image
          const imageId = `clipboard-img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          // Convert to base64 data URL
          // Prefer PNG for better quality, fallback to JPEG
          let dataUrl: string;
          let mimeType: string;

          const bufferSize = image.getSize();
          const pngBuffer = image.toPNG();

          console.warn('[Clipboard] PNG buffer size:', pngBuffer.length, 'bytes');

          // If PNG is too large (> 2MB), use JPEG with compression
          if (pngBuffer.length > 2 * 1024 * 1024) {
            const jpegQuality = Math.max(0.1, 1 - (pngBuffer.length / (10 * 1024 * 1024))); // Scale quality based on size
            console.warn('[Clipboard] Compressing to JPEG, quality:', jpegQuality);
            const jpegBuffer = image.toJPEG(jpegQuality);
            dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
            mimeType = 'image/jpeg';
            console.warn('[Clipboard] JPEG compressed size:', jpegBuffer.length, 'bytes');
          } else {
            dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            mimeType = 'image/png';
            console.warn('[Clipboard] PNG size:', pngBuffer.length, 'bytes');
          }

          result.images.push({
            id: imageId,
            dataUrl,
            mimeType,
            size: Buffer.from(dataUrl.split(',')[1], 'base64').length
          });

          console.warn('[Clipboard] Image extracted successfully, total images:', result.images.length);
        } else {
          console.warn('[Clipboard] Image format detected but readImage() returned empty image');
        }
      } else {
        console.warn('[Clipboard] No image formats detected in clipboard. Available formats:', formats);
      }

      console.warn('[Clipboard] Final result:', {
        textLength: result.text.length,
        imageCount: result.images.length,
        totalSize: result.images.reduce((sum, img) => sum + img.size, 0)
      });

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
