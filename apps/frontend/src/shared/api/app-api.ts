/**
 * Shared AppAPI interface for platform abstraction
 *
 * This interface defines the contract that both Electron and Web adapters must implement.
 * It abstracts away the platform-specific details of how the frontend communicates with
 * the backend (IPC for Electron, HTTP/WebSocket for Web).
 */

import type { ElectronAPI } from '../types/ipc';

/**
 * Platform capabilities that differ between Electron and Web
 */
export interface PlatformCapabilities {
  /** Whether the platform supports local terminal/PTY */
  supportsLocalTerminal: boolean;
  /** Whether the platform supports native file dialogs */
  supportsNativeDialogs: boolean;
  /** Whether the platform supports app updates */
  supportsAppUpdates: boolean;
  /** Whether the platform supports filesystem access */
  supportsFilesystemAccess: boolean;
  /** Whether the platform supports native shell integration */
  supportsShellIntegration: boolean;
  /** Whether the platform supports offline operation */
  supportsOfflineMode: boolean;
}

/**
 * AppAPI extends ElectronAPI to maintain full compatibility
 * while allowing platform-specific implementations
 */
export type AppAPI = ElectronAPI;

/**
 * Default capabilities for Electron (full native support)
 */
export const ELECTRON_CAPABILITIES: PlatformCapabilities = {
  supportsLocalTerminal: true,
  supportsNativeDialogs: true,
  supportsAppUpdates: true,
  supportsFilesystemAccess: true,
  supportsShellIntegration: true,
  supportsOfflineMode: true,
};

/**
 * Default capabilities for Web (limited native support)
 */
export const WEB_CAPABILITIES: PlatformCapabilities = {
  supportsLocalTerminal: false,
  supportsNativeDialogs: false,
  supportsAppUpdates: false,
  supportsFilesystemAccess: false,
  supportsShellIntegration: false,
  supportsOfflineMode: false,
};

export type { ElectronAPI };
