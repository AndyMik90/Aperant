/**
 * API Provider
 *
 * This module provides a unified API interface that works in both Electron and web modes.
 * It automatically detects the runtime environment and provides the appropriate API.
 */

import type { ElectronAPI } from '../preload/api';

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  // Check for Electron-specific globals
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
}

/**
 * Check if running in web mode
 */
export function isWeb(): boolean {
  return !isElectron();
}

/**
 * Get the API instance
 *
 * In Electron mode, returns window.electronAPI
 * In web mode, returns the web API client
 */
export function getAPI(): ElectronAPI {
  if (isElectron()) {
    return window.electronAPI;
  }

  // Lazy load web API to avoid bundling it in Electron builds
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webAPI } = require('../web-api');
  return webAPI as ElectronAPI;
}

/**
 * API singleton - use this for most API calls
 */
let _api: ElectronAPI | null = null;

export function api(): ElectronAPI {
  if (!_api) {
    _api = getAPI();
  }
  return _api;
}

// For backwards compatibility, also export as default
export default api;
