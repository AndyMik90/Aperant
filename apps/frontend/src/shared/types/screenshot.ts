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
