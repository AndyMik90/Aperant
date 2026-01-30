/**
 * Screenshot capture types
 *
 * Shared types for screenshot functionality across main, preload, and renderer processes.
 */

/**
 * Represents a screenshot source (screen or window) available for capture
 */
export interface ScreenshotSource {
  /** Unique identifier for the source */
  id: string;
  /** Display name of the source (e.g., "Screen 1", "Chrome") */
  name: string;
  /** Base64 encoded PNG thumbnail preview */
  thumbnail: string;
}

/**
 * Options for capturing a screenshot
 */
export interface ScreenshotCaptureOptions {
  /** The ID of the source to capture */
  sourceId: string;
}

/**
 * Represents an image extracted from the clipboard
 */
export interface ClipboardImage {
  /** Unique identifier for the clipboard image */
  id: string;
  /** Base64 encoded data URL (data:image/png;base64,... or data:image/jpeg;base64,...) */
  dataUrl: string;
  /** MIME type of the image (image/png or image/jpeg) */
  mimeType: string;
  /** Size of the image data in bytes */
  size: number;
}

/**
 * Represents clipboard content (text + images)
 */
export interface ClipboardContent {
  /** Plain text content from clipboard */
  text: string;
  /** Array of images extracted from clipboard */
  images: ClipboardImage[];
}

