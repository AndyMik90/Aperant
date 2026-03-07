/**
 * Types for Electron app auto-update functionality
 */

export interface AppUpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface AppUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface AppUpdateAvailableEvent {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface AppUpdateDownloadedEvent {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface AppUpdateErrorEvent {
  message: string;
}
