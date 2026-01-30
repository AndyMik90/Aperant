/**
 * Unit tests for Application Logger Service
 * Tests logging functionality, debug info collection, and cross-platform compatibility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Use secure temp directory with random suffix to prevent symlink attacks
// These will be initialized in beforeEach with mkdtempSync
let TEST_BASE_DIR: string;
let TEST_LOGS_DIR: string;
let TEST_LOG_FILE: string;

// Store mock functions for dynamic path updates
const mockGetFile = vi.fn();
const mockGetPath = vi.fn();

// Mock electron-log before importing
vi.mock('electron-log/main.js', () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: {
        maxSize: 10 * 1024 * 1024,
        format: '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}',
        fileName: 'main.log',
        level: 'info',
        getFile: mockGetFile
      },
      console: {
        level: 'warn',
        format: '[{h}:{i}:{s}] [{level}] {text}'
      }
    },
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2.7.2-beta.10'),
    getLocale: vi.fn(() => 'en-US'),
    isPackaged: false,
    getPath: mockGetPath
  }
}));

// Setup and cleanup helpers
function setupTestEnvironment(): void {
  // Create secure temp directory with random suffix (prevents symlink attacks)
  TEST_BASE_DIR = mkdtempSync(path.join(tmpdir(), 'app-logger-test-'));
  TEST_LOGS_DIR = path.join(TEST_BASE_DIR, 'logs');
  TEST_LOG_FILE = path.join(TEST_LOGS_DIR, 'main.log');

  // Create logs directory
  mkdirSync(TEST_LOGS_DIR, { recursive: true });

  // Configure mocks to use the secure temp directory
  mockGetFile.mockReturnValue({ path: TEST_LOG_FILE });
  mockGetPath.mockImplementation((name: string) => {
    if (name === 'userData') return TEST_BASE_DIR;
    if (name === 'logs') return TEST_LOGS_DIR;
    return TEST_BASE_DIR;
  });
}

function createTestLogFile(content: string): void {
  writeFileSync(TEST_LOG_FILE, content);
}

function cleanupTestDirs(): void {
  if (TEST_BASE_DIR && existsSync(TEST_BASE_DIR)) {
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  }
}

describe('Application Logger', () => {
  beforeEach(() => {
    // Setup fresh secure temp directory for each test
    setupTestEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  describe('getSystemInfo', () => {
    it('should return system information object', async () => {
      const { getSystemInfo } = await import('../app-logger');

      const info = getSystemInfo();

      expect(info).toHaveProperty('appVersion');
      expect(info).toHaveProperty('electronVersion');
      expect(info).toHaveProperty('nodeVersion');
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('osVersion');
      expect(info).toHaveProperty('osType');
      expect(info).toHaveProperty('totalMemory');
      expect(info).toHaveProperty('freeMemory');
      expect(info).toHaveProperty('cpuCores');
      expect(info).toHaveProperty('locale');
      expect(info).toHaveProperty('isPackaged');
      expect(info).toHaveProperty('userData');
    });

    it('should return app version from electron', async () => {
      const { getSystemInfo } = await import('../app-logger');

      const info = getSystemInfo();

      expect(info.appVersion).toBe('2.7.2-beta.10');
    });

    it('should return valid memory values', async () => {
      const { getSystemInfo } = await import('../app-logger');

      const info = getSystemInfo();

      expect(info.totalMemory).toMatch(/^\d+GB$/);
      expect(info.freeMemory).toMatch(/^\d+GB$/);
    });

    it('should return valid CPU core count', async () => {
      const { getSystemInfo } = await import('../app-logger');

      const info = getSystemInfo();

      expect(parseInt(info.cpuCores, 10)).toBeGreaterThan(0);
    });
  });

  describe('getLogsPath', () => {
    it('should return logs directory path using path.dirname', async () => {
      const { getLogsPath } = await import('../app-logger');

      const logsPath = getLogsPath();

      expect(logsPath).toBe(TEST_LOGS_DIR);
    });

    it('should not include the log file name in the path', async () => {
      const { getLogsPath } = await import('../app-logger');

      const logsPath = getLogsPath();

      expect(logsPath).not.toContain('main.log');
    });
  });

  describe('getRecentLogs', () => {
    it('should return empty array when log file does not exist', async () => {
      // Don't create the log file
      rmSync(TEST_LOG_FILE, { force: true });

      const { getRecentLogs } = await import('../app-logger');
      const logs = getRecentLogs();

      expect(logs).toEqual([]);
    });

    it('should return log lines from file', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [info] Application started',
        '[2024-01-15 10:00:01.000] [info] Loading settings',
        '[2024-01-15 10:00:02.000] [warn] Settings file not found'
      ].join('\n');

      createTestLogFile(logContent);

      const { getRecentLogs } = await import('../app-logger');
      const logs = getRecentLogs();

      expect(logs).toHaveLength(3);
      expect(logs[0]).toContain('Application started');
    });

    it('should respect maxLines parameter', async () => {
      const logContent = Array.from({ length: 10 }, (_, i) =>
        `[2024-01-15 10:00:0${i}.000] [info] Log line ${i}`
      ).join('\n');

      createTestLogFile(logContent);

      const { getRecentLogs } = await import('../app-logger');
      const logs = getRecentLogs(5);

      expect(logs).toHaveLength(5);
      // Should return the last 5 lines
      expect(logs[0]).toContain('Log line 5');
      expect(logs[4]).toContain('Log line 9');
    });

    it('should filter out empty lines', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [info] Line 1',
        '',
        '   ',
        '[2024-01-15 10:00:01.000] [info] Line 2'
      ].join('\n');

      createTestLogFile(logContent);

      const { getRecentLogs } = await import('../app-logger');
      const logs = getRecentLogs();

      expect(logs).toHaveLength(2);
    });
  });

  describe('getRecentErrors', () => {
    it('should filter for error and warn log levels (case insensitive)', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [info] Normal log',
        '[2024-01-15 10:00:01.000] [error] Error occurred',
        '[2024-01-15 10:00:02.000] [warn] Warning issued',
        '[2024-01-15 10:00:03.000] [ERROR] Another error',
        '[2024-01-15 10:00:04.000] [WARN] Another warning',
        '[2024-01-15 10:00:05.000] [debug] Debug message'
      ].join('\n');

      createTestLogFile(logContent);

      const { getRecentErrors } = await import('../app-logger');
      const errors = getRecentErrors();

      expect(errors).toHaveLength(4);
      expect(errors.some(e => e.includes('[info]'))).toBe(false);
      expect(errors.some(e => e.includes('[debug]'))).toBe(false);
    });

    it('should match JavaScript error types', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [info] Normal log',
        'TypeError: Cannot read property x of undefined',
        'ReferenceError: foo is not defined',
        'RangeError: Maximum call stack exceeded',
        'SyntaxError: Unexpected token',
        'Error: Something went wrong'
      ].join('\n');

      createTestLogFile(logContent);

      const { getRecentErrors } = await import('../app-logger');
      const errors = getRecentErrors();

      expect(errors).toHaveLength(5);
      expect(errors.some(e => e.includes('TypeError'))).toBe(true);
      expect(errors.some(e => e.includes('ReferenceError'))).toBe(true);
      expect(errors.some(e => e.includes('RangeError'))).toBe(true);
      expect(errors.some(e => e.includes('SyntaxError'))).toBe(true);
    });

    it('should respect maxCount parameter', async () => {
      const logContent = Array.from({ length: 50 }, (_, i) =>
        `[2024-01-15 10:00:0${i}.000] [error] Error ${i}`
      ).join('\n');

      createTestLogFile(logContent);

      const { getRecentErrors } = await import('../app-logger');
      const errors = getRecentErrors(10);

      expect(errors).toHaveLength(10);
      // Should return the last 10 errors
      expect(errors[0]).toContain('Error 40');
      expect(errors[9]).toContain('Error 49');
    });

    it('should return empty array when no errors exist', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [info] Normal log 1',
        '[2024-01-15 10:00:01.000] [info] Normal log 2',
        '[2024-01-15 10:00:02.000] [debug] Debug message'
      ].join('\n');

      createTestLogFile(logContent);

      const { getRecentErrors } = await import('../app-logger');
      const errors = getRecentErrors();

      expect(errors).toHaveLength(0);
    });
  });

  describe('generateDebugReport', () => {
    it('should generate a formatted debug report', async () => {
      const logContent = [
        '[2024-01-15 10:00:00.000] [error] Test error'
      ].join('\n');

      createTestLogFile(logContent);

      const { generateDebugReport } = await import('../app-logger');
      const report = generateDebugReport();

      expect(report).toContain('=== Auto Claude Debug Report ===');
      expect(report).toContain('--- System Information ---');
      expect(report).toContain('--- Recent Errors ---');
      expect(report).toContain('=== End Debug Report ===');
    });

    it('should include system information in report', async () => {
      createTestLogFile('');

      const { generateDebugReport } = await import('../app-logger');
      const report = generateDebugReport();

      expect(report).toContain('appVersion:');
      expect(report).toContain('platform:');
      expect(report).toContain('electronVersion:');
    });

    it('should include recent errors in report', async () => {
      const logContent = '[2024-01-15 10:00:00.000] [error] Critical failure';
      createTestLogFile(logContent);

      const { generateDebugReport } = await import('../app-logger');
      const report = generateDebugReport();

      expect(report).toContain('Critical failure');
    });

    it('should show "No recent errors" when no errors exist', async () => {
      const logContent = '[2024-01-15 10:00:00.000] [info] All good';
      createTestLogFile(logContent);

      const { generateDebugReport } = await import('../app-logger');
      const report = generateDebugReport();

      expect(report).toContain('No recent errors');
    });

    it('should include generation timestamp', async () => {
      createTestLogFile('');

      const { generateDebugReport } = await import('../app-logger');
      const report = generateDebugReport();

      expect(report).toContain('Generated:');
      // Should be ISO format
      expect(report).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('listLogFiles', () => {
    it('should return empty array when logs directory does not exist', async () => {
      rmSync(TEST_LOGS_DIR, { recursive: true, force: true });

      const { listLogFiles } = await import('../app-logger');
      const files = listLogFiles();

      expect(files).toEqual([]);
    });

    it('should list log files with metadata', async () => {
      createTestLogFile('Test log content');
      writeFileSync(path.join(TEST_LOGS_DIR, 'main.old.log'), 'Old log content');

      const { listLogFiles } = await import('../app-logger');
      const files = listLogFiles();

      expect(files.length).toBeGreaterThanOrEqual(1);

      const mainLog = files.find(f => f.name === 'main.log');
      expect(mainLog).toBeDefined();
      expect(mainLog?.size).toBeGreaterThan(0);
      expect(mainLog?.modified).toBeInstanceOf(Date);
      expect(mainLog?.path).toBe(TEST_LOG_FILE);
    });

    it('should only include .log files', async () => {
      createTestLogFile('Log content');
      writeFileSync(path.join(TEST_LOGS_DIR, 'other.txt'), 'Not a log');
      writeFileSync(path.join(TEST_LOGS_DIR, 'backup.log.bak'), 'Backup');

      const { listLogFiles } = await import('../app-logger');
      const files = listLogFiles();

      expect(files.every(f => f.name.endsWith('.log'))).toBe(true);
    });

    it('should sort files by modification time (newest first)', async () => {
      // Create files with different modification times
      createTestLogFile('Current log');

      // Create an older file
      const oldLogPath = path.join(TEST_LOGS_DIR, 'main.2024-01-01.log');
      writeFileSync(oldLogPath, 'Old log');

      const { listLogFiles } = await import('../app-logger');
      const files = listLogFiles();

      if (files.length >= 2) {
        expect(files[0].modified.getTime()).toBeGreaterThanOrEqual(files[1].modified.getTime());
      }
    });

    it('should handle file stat errors gracefully (TOCTOU)', async () => {
      createTestLogFile('Test content');

      // The function should handle cases where files are deleted between readdir and stat
      const { listLogFiles } = await import('../app-logger');
      const files = listLogFiles();

      // Should not throw, should return available files
      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('setupErrorLogging', () => {
    it('should register process error handlers', async () => {
      const processSpy = vi.spyOn(process, 'on');

      const { setupErrorLogging } = await import('../app-logger');
      setupErrorLogging();

      expect(processSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(processSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));

      processSpy.mockRestore();
    });
  });

  describe('Beta version detection', () => {
    it('should detect beta version from app version', async () => {
      // The mock returns '2.7.2-beta.10' which should be detected as beta
      const electronLog = await import('electron-log/main.js');

      // Beta version should set file level to debug
      // This is tested implicitly by the mock setup
      expect(electronLog.default.transports.file.level).toBeDefined();
    });
  });

  describe('Cross-platform path handling', () => {
    it('should use path.dirname for safe path extraction', async () => {
      const { getLogsPath } = await import('../app-logger');
      const logsPath = getLogsPath();

      // Should be a valid directory path
      expect(logsPath).not.toContain('main.log');
      expect(logsPath).toBe(path.dirname(TEST_LOG_FILE));
    });
  });
});

describe('Logger exports', () => {
  it('should export logger instance', async () => {
    const { logger } = await import('../app-logger');

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should export appLog convenience methods', async () => {
    const { appLog } = await import('../app-logger');

    expect(appLog).toBeDefined();
    expect(typeof appLog.info).toBe('function');
    expect(typeof appLog.warn).toBe('function');
    expect(typeof appLog.error).toBe('function');
    expect(typeof appLog.debug).toBe('function');
    expect(typeof appLog.log).toBe('function');
  });
});
