/**
 * Electron App Auto-Updater
 *
 * Manages automatic updates for the packaged Electron application using electron-updater.
 * Updates are published through GitHub Releases and automatically downloaded and installed.
 *
 * Update flow:
 * 1. Check for updates 3 seconds after app launch
 * 2. Download updates automatically when available
 * 3. Notify user when update is downloaded
 * 4. Install and restart when user confirms
 *
 * Events sent to renderer:
 * - APP_UPDATE_AVAILABLE: New update available (with version info)
 * - APP_UPDATE_DOWNLOADED: Update downloaded and ready to install
 * - APP_UPDATE_PROGRESS: Download progress updates
 * - APP_UPDATE_ERROR: Error during update process
 */

import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { app, net } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { AppUpdateInfo } from '../shared/types';
import { compareVersions } from './updater/version-manager';

// GitHub repo info for API calls
const GITHUB_OWNER = 'AndyMik90';
const GITHUB_REPO = 'Auto-Claude';

// Debug mode - DEBUG_UPDATER=true or development mode
const DEBUG_UPDATER = process.env.DEBUG_UPDATER === 'true' || process.env.NODE_ENV === 'development';

// Configure electron-updater
autoUpdater.autoDownload = true;  // Automatically download updates when available
autoUpdater.autoInstallOnAppQuit = true;  // Automatically install on app quit

// Update channels: 'latest' for stable, 'beta' for pre-release
type UpdateChannel = 'latest' | 'beta';

// Store interval ID for cleanup during shutdown
let periodicCheckIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Convert releaseNotes from electron-updater to a markdown string.
 * releaseNotes can be:
 * - string: Return as-is
 * - ReleaseNoteInfo[]: Convert to markdown with version headers
 * - null/undefined: Return undefined
 */
function formatReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string | undefined {
  if (!releaseNotes) {
    return undefined;
  }

  // If it's already a string, return as-is
  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }

  // It's an array of ReleaseNoteInfo objects
  // Format: [{ version: "1.0.0", note: "changes..." }, ...]
  if (Array.isArray(releaseNotes)) {
    // Return undefined for empty arrays for consistency with null/undefined handling
    if (releaseNotes.length === 0) {
      return undefined;
    }

    const formattedNotes = releaseNotes
      .filter(item => item.note) // Filter out entries with null/undefined notes
      .map(item => {
        // Each item has version and note properties
        const versionHeader = item.version ? `## ${item.version}\n` : '';
        return `${versionHeader}${item.note}`;
      })
      .join('\n\n');

    return formattedNotes || undefined;
  }

  return undefined;
}

/**
 * Set the update channel for electron-updater.
 * - 'latest': Only receive stable releases (default)
 * - 'beta': Receive pre-release/beta versions
 *
 * @param channel - The update channel to use
 */
export function setUpdateChannel(channel: UpdateChannel): void {
  autoUpdater.channel = channel;
  // Clear any downloaded update info when channel changes to prevent showing
  // an Install button for an update from a different channel
  downloadedUpdateInfo = null;
  console.warn(`[app-updater] Update channel set to: ${channel}`);
}

// Enable more verbose logging in debug mode
if (DEBUG_UPDATER) {
  autoUpdater.logger = {
    info: (msg: string) => console.warn('[app-updater:debug]', msg),
    warn: (msg: string) => console.warn('[app-updater:debug]', msg),
    error: (msg: string) => console.error('[app-updater:debug]', msg),
    debug: (msg: string) => console.warn('[app-updater:debug]', msg)
  };
}

let mainWindow: BrowserWindow | null = null;

// Track downloaded update state so it persists across Settings page navigations
let downloadedUpdateInfo: AppUpdateInfo | null = null;

/**
 * Initialize the app updater system
 *
 * Sets up event handlers and starts periodic update checks.
 * Should only be called in production (app.isPackaged).
 *
 * @param window - The main BrowserWindow for sending update events
 * @param betaUpdates - Whether to receive beta/pre-release updates
 */
export function initializeAppUpdater(window: BrowserWindow, betaUpdates = false): void {
  mainWindow = window;

  // Set update channel based on user preference
  const channel = betaUpdates ? 'beta' : 'latest';
  setUpdateChannel(channel);

  // Log updater configuration
  console.warn('[app-updater] ========================================');
  console.warn('[app-updater] Initializing app auto-updater');
  console.warn('[app-updater] App packaged:', app.isPackaged);
  console.warn('[app-updater] Current version:', autoUpdater.currentVersion.version);
  console.warn('[app-updater] Update channel:', channel);
  console.warn('[app-updater] Auto-download enabled:', autoUpdater.autoDownload);
  console.warn('[app-updater] Debug mode:', DEBUG_UPDATER);
  console.warn('[app-updater] ========================================');

  // ============================================
  // Event Handlers
  // ============================================

  // Update available - new version found
  autoUpdater.on('update-available', (info) => {
    console.warn('[app-updater] Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, {
        version: info.version,
        releaseNotes: formatReleaseNotes(info.releaseNotes),
        releaseDate: info.releaseDate
      });
    }
  });

  // Update downloaded - ready to install
  autoUpdater.on('update-downloaded', (info) => {
    console.warn('[app-updater] Update downloaded:', info.version);
    // Store downloaded update info so it persists across Settings page navigations
    downloadedUpdateInfo = {
      version: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate
    };
    if (mainWindow) {
      // Reuse downloadedUpdateInfo instead of calling formatReleaseNotes again
      mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATE_DOWNLOADED, downloadedUpdateInfo);
    }
  });

  // Download progress
  autoUpdater.on('download-progress', (progress) => {
    console.warn(`[app-updater] Download progress: ${progress.percent.toFixed(2)}%`);
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATE_PROGRESS, {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      });
    }
  });

  // Error handling
  autoUpdater.on('error', (error) => {
    console.error('[app-updater] Update error:', error);
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATE_ERROR, {
        message: error.message,
        stack: error.stack
      });
    }
  });

  // No update available
  autoUpdater.on('update-not-available', (info) => {
    console.warn('[app-updater] No updates available - you are on the latest version');
    console.warn('[app-updater]   Current version:', info.version);
    if (DEBUG_UPDATER) {
      console.warn('[app-updater:debug] Full info:', JSON.stringify(info, null, 2));
    }
  });

  // Checking for updates
  autoUpdater.on('checking-for-update', () => {
    console.warn('[app-updater] Checking for updates...');
  });

  // ============================================
  // Update Check Schedule
  // ============================================

  // Check for updates 3 seconds after launch
  const INITIAL_DELAY = 3000;
  console.warn(`[app-updater] Will check for updates in ${INITIAL_DELAY / 1000} seconds...`);

  setTimeout(() => {
    console.warn('[app-updater] Performing initial update check');
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[app-updater] ❌ Initial update check failed:', error.message);
      if (DEBUG_UPDATER) {
        console.error('[app-updater:debug] Full error:', error);
      }
    });
  }, INITIAL_DELAY);

  // Check for updates every 4 hours
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  console.warn(`[app-updater] Periodic checks scheduled every ${FOUR_HOURS / 1000 / 60 / 60} hours`);

  periodicCheckIntervalId = setInterval(() => {
    console.warn('[app-updater] Performing periodic update check');
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[app-updater] ❌ Periodic update check failed:', error.message);
      if (DEBUG_UPDATER) {
        console.error('[app-updater:debug] Full error:', error);
      }
    });
  }, FOUR_HOURS);

  console.warn('[app-updater] Auto-updater initialized successfully');
}

/**
 * Manually check for updates
 * Called from IPC handler when user requests manual check
 */
export async function checkForUpdates(): Promise<AppUpdateInfo | null> {
  try {
    console.warn('[app-updater] Manual update check requested');
    const result = await autoUpdater.checkForUpdates();

    if (!result) {
      return null;
    }

    const currentVersion = autoUpdater.currentVersion.version;
    const latestVersion = result.updateInfo.version;

    // Use proper semver comparison to detect if update is actually newer
    // This prevents offering downgrades (e.g., v2.7.1 when on v2.7.2-beta.6)
    const isNewer = compareVersions(latestVersion, currentVersion) > 0;

    console.warn(`[app-updater] Version comparison: ${latestVersion} vs ${currentVersion} -> ${isNewer ? 'UPDATE' : 'NO UPDATE'}`);

    if (!isNewer) {
      return null;
    }

    return {
      version: result.updateInfo.version,
      releaseNotes: formatReleaseNotes(result.updateInfo.releaseNotes),
      releaseDate: result.updateInfo.releaseDate
    };
  } catch (error) {
    console.error('[app-updater] Manual update check failed:', error);
    throw error;
  }
}

/**
 * Manually download update
 * Called from IPC handler when user requests manual download
 */
export async function downloadUpdate(): Promise<void> {
  try {
    console.warn('[app-updater] Manual update download requested');
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('[app-updater] Manual update download failed:', error);
    throw error;
  }
}

/**
 * Quit and install update
 * Called from IPC handler when user confirms installation
 */
export function quitAndInstall(): void {
  console.warn('[app-updater] Quitting and installing update');
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Get current app version
 */
export function getCurrentVersion(): string {
  return autoUpdater.currentVersion.version;
}

/**
 * Get downloaded update info if an update has been downloaded and is ready to install.
 * This allows the UI to show "Install and Restart" even if the user opens Settings
 * after the download completed in the background.
 */
export function getDownloadedUpdateInfo(): AppUpdateInfo | null {
  return downloadedUpdateInfo;
}

/**
 * Check if a version string represents a prerelease (beta, alpha, rc, etc.)
 */
export function isPrerelease(version: string): boolean {
  return /-(alpha|beta|rc|dev|canary)\.\d+$/i.test(version) || version.includes('-');
}

// Timeout for GitHub API requests (10 seconds)
const GITHUB_API_TIMEOUT = 10000;

/**
 * Fetch the latest stable release from GitHub API
 * Returns the latest non-prerelease version
 */
async function fetchLatestStableRelease(): Promise<AppUpdateInfo | null> {
  const fetchPromise = new Promise<AppUpdateInfo | null>((resolve) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
    console.warn('[app-updater] Fetching releases from:', url);

    const request = net.request({
      url,
      method: 'GET'
    });

    request.setHeader('Accept', 'application/vnd.github.v3+json');
    request.setHeader('User-Agent', `Auto-Claude/${getCurrentVersion()}`);

    let data = '';

    request.on('response', (response) => {
      // Validate HTTP status code
      const statusCode = response.statusCode;
      if (statusCode !== 200) {
        // Sanitize statusCode to prevent log injection
        // Convert to number and validate range to ensure it's a valid HTTP status code
        const numericCode = Number(statusCode);
        const safeStatusCode = (Number.isInteger(numericCode) && numericCode >= 100 && numericCode < 600)
          ? String(numericCode)
          : 'unknown';
        console.error(`[app-updater] GitHub API error: HTTP ${safeStatusCode}`);
        if (statusCode === 403) {
          console.error('[app-updater] Rate limit may have been exceeded');
        } else if (statusCode === 404) {
          console.error('[app-updater] Repository or releases not found');
        }
        resolve(null);
        return;
      }

      response.on('data', (chunk) => {
        data += chunk.toString('utf-8');
      });

      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          // Validate response is an array
          if (!Array.isArray(parsed)) {
            console.error('[app-updater] Unexpected response format - expected array, got:', typeof parsed);
            resolve(null);
            return;
          }

          const releases = parsed as Array<{
            tag_name: string;
            prerelease: boolean;
            draft: boolean;
            body?: string;
            published_at?: string;
            html_url?: string;
          }>;

          // Find the first non-prerelease, non-draft release
          const latestStable = releases.find(r => !r.prerelease && !r.draft);

          if (!latestStable) {
            console.warn('[app-updater] No stable release found');
            resolve(null);
            return;
          }

          const version = latestStable.tag_name.replace(/^v/, '');
          // Sanitize version string for logging (remove control characters and limit length)
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control chars for sanitization
          const safeVersion = String(version).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 50);
          console.warn('[app-updater] Found latest stable release:', safeVersion);

          resolve({
            version,
            releaseNotes: latestStable.body,
            releaseDate: latestStable.published_at
          });
        } catch (e) {
          // Sanitize error message for logging (prevent log injection from malformed JSON)
          const safeError = e instanceof Error ? e.message : 'Unknown parse error';
          console.error('[app-updater] Failed to parse releases JSON:', safeError);
          resolve(null);
        }
      });
    });

    request.on('error', (error) => {
      // Sanitize error message for logging (use only the message property)
      const safeErrorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[app-updater] Failed to fetch releases:', safeErrorMessage);
      resolve(null);
    });

    request.end();
  });

  // Add timeout to prevent hanging indefinitely
  const timeoutPromise = new Promise<AppUpdateInfo | null>((resolve) => {
    setTimeout(() => {
      console.error(`[app-updater] GitHub API request timed out after ${GITHUB_API_TIMEOUT}ms`);
      resolve(null);
    }, GITHUB_API_TIMEOUT);
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * Check if we should offer a downgrade to stable
 * Called when user disables beta updates while on a prerelease version
 *
 * Returns the latest stable version if:
 * 1. Current version is a prerelease
 * 2. A stable version exists
 */
export async function checkForStableDowngrade(): Promise<AppUpdateInfo | null> {
  const currentVersion = getCurrentVersion();

  // Only check for downgrade if currently on a prerelease
  if (!isPrerelease(currentVersion)) {
    console.warn('[app-updater] Current version is not a prerelease, no downgrade needed');
    return null;
  }

  console.warn('[app-updater] Current version is prerelease:', currentVersion);
  console.warn('[app-updater] Checking for stable version to downgrade to...');

  const latestStable = await fetchLatestStableRelease();

  if (!latestStable) {
    console.warn('[app-updater] No stable release available for downgrade');
    return null;
  }

  console.warn('[app-updater] Stable downgrade available:', latestStable.version);
  return latestStable;
}

/**
 * Set update channel with optional downgrade check
 * When switching from beta to stable, checks if user should be offered a downgrade
 *
 * @param channel - The update channel to switch to
 * @param triggerDowngradeCheck - Whether to check for stable downgrade (when disabling beta)
 */
export async function setUpdateChannelWithDowngradeCheck(
  channel: UpdateChannel,
  triggerDowngradeCheck = false
): Promise<AppUpdateInfo | null> {
  autoUpdater.channel = channel;
  // Clear any downloaded update info when channel changes to prevent showing
  // an Install button for an update from a different channel
  downloadedUpdateInfo = null;
  console.warn(`[app-updater] Update channel set to: ${channel}`);

  // If switching to stable and downgrade check requested, look for stable version
  if (channel === 'latest' && triggerDowngradeCheck) {
    const stableVersion = await checkForStableDowngrade();

    if (stableVersion && mainWindow) {
      // Notify the renderer about the available stable downgrade
      mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATE_STABLE_DOWNGRADE, stableVersion);
    }

    return stableVersion;
  }

  return null;
}

/**
 * Download a specific version (for downgrade)
 * Uses electron-updater with allowDowngrade enabled to download older stable versions
 */
export async function downloadStableVersion(): Promise<void> {
  // Switch to stable channel
  autoUpdater.channel = 'latest';
  // Enable downgrade to allow downloading older versions (e.g., stable when on beta)
  autoUpdater.allowDowngrade = true;
  console.warn('[app-updater] Downloading stable version (allowDowngrade=true)...');

  try {
    // Force a fresh check on the stable channel, then download
    const result = await autoUpdater.checkForUpdates();
    if (result) {
      await autoUpdater.downloadUpdate();
    } else {
      throw new Error('No stable version available for download');
    }
  } catch (error) {
    console.error('[app-updater] Failed to download stable version:', error);
    throw error;
  } finally {
    // Reset allowDowngrade to prevent unintended downgrades in normal update checks
    autoUpdater.allowDowngrade = false;
  }
}

/**
 * Stop periodic update checks - called during app shutdown
 */
export function stopPeriodicUpdates(): void {
  if (periodicCheckIntervalId) {
    clearInterval(periodicCheckIntervalId);
    periodicCheckIntervalId = null;
    console.warn('[app-updater] Periodic update checks stopped');
  }
}
