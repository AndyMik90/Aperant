/**
 * Application Logger Service
 *
 * Provides persistent, always-on logging for the main process using electron-log.
 * Logs are stored in the standard OS log directory:
 * - macOS: ~/Library/Logs/Auto-Claude/
 * - Windows: %USERPROFILE%\AppData\Roaming\Auto-Claude\logs\
 * - Linux: ~/.config/Auto-Claude/logs/
 *
 * Features:
 * - Automatic file rotation (7 days, max 10MB per file)
 * - Always-on logging (not dependent on DEBUG flag)
 * - Debug info collection for support/bug reports
 * - Beta version detection for enhanced logging
 */

import log from 'electron-log/main.js';
import { app } from 'electron';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

// Configure electron-log (wrapped in try-catch for re-import scenarios in tests)
try {
  log.initialize();
} catch {
  // Already initialized, ignore
}

// File transport configuration
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB max file size
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.fileName = 'main.log';

// Note: We use electron-log's default archiveLogFn which properly rotates logs
// by renaming old files to .old format. Custom implementations were problematic.

// Console transport - always show warnings and errors, debug only in dev mode
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';
// Guard console transport writes so broken stdio streams do not crash the app.
{
  const originalConsoleWriteFn = log.transports.console.writeFn as (...args: unknown[]) => void;
  log.transports.console.writeFn = (...args: unknown[]) => {
    try {
      originalConsoleWriteFn(...args);
    } catch (error) {
      const err = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      safeStderrWrite(`[app-logger] console transport write failed: ${err}`);
    }
  };
}

// Determine if this is a beta version
function isBetaVersion(): boolean {
  try {
    const version = app.getVersion();
    return version.includes('-beta') || version.includes('-alpha') || version.includes('-rc');
  } catch (error) {
    log.warn('Failed to detect beta version:', error);
    return false;
  }
}

// Enhanced logging for beta versions
if (isBetaVersion()) {
  log.transports.file.level = 'debug';
  log.info('Beta version detected - enhanced logging enabled');
} else {
  log.transports.file.level = 'info';
}

/**
 * Get system information for debug reports
 */
export function getSystemInfo(): Record<string, string> {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    osType: os.type(),
    totalMemory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB`,
    freeMemory: `${Math.round(os.freemem() / (1024 * 1024 * 1024))}GB`,
    cpuCores: os.cpus().length.toString(),
    locale: app.getLocale(),
    isPackaged: app.isPackaged.toString(),
    userData: app.getPath('userData'),
  };
}

/**
 * Get the logs directory path
 */
export function getLogsPath(): string {
  try {
    const filePath = log.transports.file.getFile().path;
    if (!filePath) {
      log.warn('Log file path is not available');
      return '';
    }
    return dirname(filePath);
  } catch (error) {
    log.error('Failed to get logs path:', error);
    return '';
  }
}

/**
 * Get recent log entries from the current log file
 */
export function getRecentLogs(maxLines: number = 200): string[] {
  try {
    const logPath = log.transports.file.getFile().path;
    if (!existsSync(logPath)) {
      return [];
    }

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    return lines.slice(-maxLines);
  } catch (error) {
    log.error('Failed to read recent logs:', error);
    return [];
  }
}

/**
 * Get recent errors from logs
 */
export function getRecentErrors(maxCount: number = 20): string[] {
  const logs = getRecentLogs(1000);
  // Use case-insensitive matching for log levels and error types
  const errors = logs.filter(line =>
    /\[(error|warn)\]/i.test(line) ||
    /Error:|TypeError:|ReferenceError:|RangeError:|SyntaxError:/i.test(line)
  );
  return errors.slice(-maxCount);
}

/**
 * Generate a debug info report for bug reports
 */
export function generateDebugReport(): string {
  const systemInfo = getSystemInfo();
  const recentErrors = getRecentErrors(10);

  const lines = [
    '=== Auto Claude Debug Report ===',
    `Generated: ${new Date().toISOString()}`,
    '',
    '--- System Information ---',
    ...Object.entries(systemInfo).map(([key, value]) => `${key}: ${value}`),
    '',
    '--- Recent Errors ---',
    recentErrors.length > 0 ? recentErrors.join('\n') : 'No recent errors',
    '',
    '=== End Debug Report ==='
  ];

  return lines.join('\n');
}

/**
 * List all log files with their metadata
 */
export function listLogFiles(): Array<{ name: string; path: string; size: number; modified: Date }> {
  try {
    const logsDir = getLogsPath();
    if (!logsDir || !existsSync(logsDir)) {
      log.debug('Logs directory not available or does not exist');
      return [];
    }

    const files = readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(name => {
        const filePath = join(logsDir, name);
        try {
          // Wrap statSync in try-catch to handle TOCTOU race condition
          // (file could be deleted between readdirSync and statSync)
          const stats = statSync(filePath);
          return {
            name,
            path: filePath,
            size: stats.size,
            modified: stats.mtime
          };
        } catch (statError) {
          log.warn(`Could not stat log file ${filePath}:`, statError);
          return null;
        }
      })
      .filter((entry): entry is { name: string; path: string; size: number; modified: Date } => entry !== null)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    return files;
  } catch (error) {
    log.error('Failed to list log files:', error);
    return [];
  }
}

// Re-export the logger for use in other modules
export const logger = log;

// Export convenience methods that match console API
export const appLog = {
  debug: (...args: unknown[]) => log.debug(...args),
  info: (...args: unknown[]) => log.info(...args),
  warn: (...args: unknown[]) => log.warn(...args),
  error: (...args: unknown[]) => log.error(...args),
  log: (...args: unknown[]) => log.info(...args),
};

/**
 * Best-effort stderr fallback used when electron-log itself throws (e.g. EIO).
 * Must never throw, especially inside uncaught exception handlers.
 */
function safeStderrWrite(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Ignore - nothing else we can safely do here.
  }
}

/**
 * Log an unhandled error without risking recursive crashes if logger transport fails.
 */
function safeLogUnhandled(prefix: string, value: unknown): void {
  try {
    log.error(prefix, value);
  } catch (loggingError) {
    const loggingFailure = loggingError instanceof Error
      ? `${loggingError.name}: ${loggingError.message}`
      : String(loggingError);
    const original = value instanceof Error
      ? (value.stack || `${value.name}: ${value.message}`)
      : String(value);
    safeStderrWrite(`[app-logger] ${prefix} (logger failed: ${loggingFailure})`);
    safeStderrWrite(original);
  }
}

// Log unhandled errors
export function setupErrorLogging(): void {
  process.on('uncaughtException', (error) => {
    safeLogUnhandled('Uncaught exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    safeLogUnhandled('Unhandled rejection:', reason);
  });

  log.info('Error logging initialized');
}
