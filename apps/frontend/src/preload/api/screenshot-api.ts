/**
 * Screenshot API
 *
 * Provides screenshot capture functionality via IPC to the main process.
 * Uses Electron's desktopCapturer to capture screens and windows.
 */
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { ipcRenderer } from 'electron';
import type { ScreenshotSource, ScreenshotCaptureOptions } from '../../shared/types/screenshot';

// Re-export types for convenience
export type { ScreenshotSource, ScreenshotCaptureOptions };

export interface ScreenshotAPI {
  getSources: () => Promise<{
    success: boolean;
    data?: ScreenshotSource[];
    error?: string;
    /** Indicates the app is running in development mode (screenshot capture unavailable) */
    devMode?: boolean;
  }>;
  capture: (options: ScreenshotCaptureOptions) => Promise<{
    success: boolean;
    data?: string; // base64 encoded PNG
    error?: string;
  }>;
}

export const createScreenshotAPI = (): ScreenshotAPI => ({
  getSources: () => ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_GET_SOURCES),
  capture: (options) => ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE, options)
});
