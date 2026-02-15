/**
 * Shared utilities for IPC handlers
 */

import type { BrowserWindow } from "electron";

/**
 * Track last-warn timestamps per channel to prevent log spam.
 * When a renderer frame is disposed, we log once per channel within cooldown period.
 * Uses timestamp-based approach instead of setInterval to avoid timer leaks.
 */
const warnTimestamps = new Map<string, number>();
const WARN_COOLDOWN_MS = 5000; // 5 seconds between warnings per channel

/** Circuit breaker: kill agents after consecutive renderer disposal errors */
const MAX_CONSECUTIVE_DISPOSAL_ERRORS = 10;
let consecutiveDisposalErrors = 0;
let agentManagerRef: { killAll: () => void | Promise<void> } | null = null;
let circuitBreakerTriggered = false;

/** Set agent manager reference for circuit breaker cleanup */
export function setAgentManagerRef(manager: { killAll: () => void | Promise<void> }): void {
  agentManagerRef = manager;
}

/**
 * Check if a channel is within the warning cooldown period.
 * @returns true if within cooldown (should skip warning), false if cooldown expired
 */
function isWithinCooldown(channel: string): boolean {
  const lastWarn = warnTimestamps.get(channel) ?? 0;
  return Date.now() - lastWarn < WARN_COOLDOWN_MS;
}

/**
 * Record a warning timestamp for a channel.
 * Enforces a hard cap of 100 entries to prevent unbounded memory growth.
 */
function recordWarning(channel: string): void {
  warnTimestamps.set(channel, Date.now());

  // Prune if more than 100 entries to free memory
  if (warnTimestamps.size > 100) {
    const now = Date.now();

    // First, remove expired entries
    for (const [ch, ts] of warnTimestamps.entries()) {
      if (now - ts >= WARN_COOLDOWN_MS) {
        warnTimestamps.delete(ch);
      }
    }

    // If still over 100 entries, remove oldest (Map preserves insertion order)
    if (warnTimestamps.size > 100) {
      const entriesToRemove = warnTimestamps.size - 100;
      let removed = 0;
      for (const ch of warnTimestamps.keys()) {
        warnTimestamps.delete(ch);
        if (++removed >= entriesToRemove) {
          break;
        }
      }
    }
  }
}

/**
 * Safely send IPC message to renderer with frame disposal checks
 *
 * This prevents "Render frame was disposed" errors that occur when:
 * 1. Multiple agents are running and producing output
 * 2. The main process tries to send data to renderer windows via webContents.send()
 * 3. The renderer frame has been disposed/gone, but the main process hasn't detected this
 *
 * @param getMainWindow - Function to get the main window reference
 * @param channel - IPC channel to send on
 * @param args - Arguments to send to the renderer
 * @returns true if message was sent, false if window was destroyed or not available
 *
 * @example
 * ```ts
 * // Instead of:
 * mainWindow.webContents.send(IPC_CHANNELS.TASK_LOG, taskId, log);
 *
 * // Use:
 * safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LOG, taskId, log);
 * ```
 */
export function safeSendToRenderer(
  getMainWindow: () => BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): boolean {
  try {
    const mainWindow = getMainWindow();

    if (!mainWindow) {
      return false;
    }

    // Check if window or webContents is destroyed
    // isDestroyed() returns true if the window has been closed and destroyed
    if (mainWindow.isDestroyed()) {
      if (!isWithinCooldown(channel)) {
        console.warn(`[safeSendToRenderer] Skipping send to destroyed window: ${channel}`);
        recordWarning(channel);
      }
      return false;
    }

    // Check if webContents is destroyed (can happen independently of window)
    if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
      if (!isWithinCooldown(channel)) {
        console.warn(`[safeSendToRenderer] Skipping send to destroyed webContents: ${channel}`);
        recordWarning(channel);
      }
      return false;
    }

    // All checks passed - safe to send
    mainWindow.webContents.send(channel, ...args);
    // On successful send, reset circuit breaker state (allow re-trigger after recovery)
    consecutiveDisposalErrors = 0;
    circuitBreakerTriggered = false;
    return true;
  } catch (error) {
    // Catch any disposal errors that might occur between our checks and the actual send
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Only log disposal errors once per channel to avoid log spam
    if (errorMessage.includes("disposed") || errorMessage.includes("destroyed")) {
      // Circuit breaker: track consecutive disposal errors
      consecutiveDisposalErrors++;
      if (consecutiveDisposalErrors >= MAX_CONSECUTIVE_DISPOSAL_ERRORS && !circuitBreakerTriggered && agentManagerRef) {
        circuitBreakerTriggered = true;
        console.error('[safeSendToRenderer] Circuit breaker triggered: killing all agents after renderer death');
        Promise.resolve(agentManagerRef.killAll()).catch((err) => {
          console.error('[safeSendToRenderer] Error killing agents:', err);
        });
      }

      if (!isWithinCooldown(channel)) {
        console.warn(`[safeSendToRenderer] Frame disposed, skipping send: ${channel}`);
        recordWarning(channel);
      }
    } else {
      console.error(`[safeSendToRenderer] Error sending to renderer:`, error);
    }
    return false;
  }
}

/**
 * Clear the warning timestamps Map (for testing only)
 */
export function _clearWarnTimestampsForTest(): void {
  warnTimestamps.clear();
}

/**
 * Parse .env file into key-value object
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Use /\r?\n/ to handle both \n (Unix) and \r\n (Windows) line endings
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex > 0) {
      const key = trimmed.substring(0, equalsIndex).trim();
      let value = trimmed.substring(equalsIndex + 1).trim();
      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}
