/**
 * Tests for atomic-file retry behavior with mocked transient errors.
 *
 * Separated from atomic-file.test.ts because vi.mock() is hoisted and
 * would affect the integration tests that use real filesystem operations.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { rename as originalRename, readFile as originalReadFile } from 'fs/promises';

// Track call counts per mock
let renameCallCount = 0;
let readFileCallCount = 0;
// Control mock behavior per test
// biome-ignore lint/suspicious/noExplicitAny: mock functions need flexible types
let renameMockFn: ((...args: any[]) => Promise<void>) | null = null;
// biome-ignore lint/suspicious/noExplicitAny: mock functions need flexible types
let readFileMockFn: ((...args: any[]) => Promise<string | Buffer>) | null = null;

vi.mock('fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return {
    ...original,
    rename: (...args: Parameters<typeof originalRename>) => {
      renameCallCount++;
      if (renameMockFn) return renameMockFn(...args);
      return original.rename(...args);
    },
    readFile: (...args: Parameters<typeof originalReadFile>) => {
      readFileCallCount++;
      if (readFileMockFn) return readFileMockFn(...args);
      return original.readFile(...args);
    },
  };
});

// Import after mock setup
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import path from 'path';
import {
  writeFileWithRetry,
  readFileWithRetry,
  AtomicFileError,
} from '../atomic-file';

const TEST_DIR = path.join(__dirname, '.test-atomic-retry');

describe('transient error retry behavior', () => {
  beforeEach(async () => {
    renameCallCount = 0;
    readFileCallCount = 0;
    renameMockFn = null;
    readFileMockFn = null;

    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  // afterEach handled by beforeEach cleanup of next test, plus:
  // final cleanup not strictly needed since test dir is inside __tests__

  it('should retry on EBUSY and succeed when error clears', async () => {
    const filePath = path.join(TEST_DIR, 'transient-write.txt');

    // Fail with EBUSY on first rename attempt, succeed on second
    renameMockFn = async (...args: unknown[]) => {
      if (renameCallCount === 1) {
        const err = new Error('EBUSY: resource busy') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      }
      renameMockFn = null; // Use real rename for subsequent calls
      const { rename } = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      return rename(args[0] as string, args[1] as string);
    };

    await writeFileWithRetry(filePath, 'retry content', { retryDelay: 1 });

    const result = await readFile(filePath, 'utf-8');
    expect(result).toBe('retry content');
    // rename called at least twice: first fails, second succeeds
    expect(renameCallCount).toBeGreaterThanOrEqual(2);
  });

  it('should throw AtomicFileError after exhausting retries on transient errors', async () => {
    const filePath = path.join(TEST_DIR, 'exhaust-retries.txt');

    // Always fail with EACCES
    renameMockFn = async () => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };

    await expect(
      writeFileWithRetry(filePath, 'content', { maxRetries: 2, retryDelay: 1 })
    ).rejects.toThrow(AtomicFileError);

    // Should have attempted 3 times (initial + 2 retries)
    expect(renameCallCount).toBe(3);
  });

  it('should retry reads on EAGAIN and succeed when error clears', async () => {
    const filePath = path.join(TEST_DIR, 'transient-read.txt');
    await writeFile(filePath, 'readable content', 'utf-8');

    // Fail with EAGAIN on first read attempt
    readFileMockFn = async (...args: unknown[]) => {
      if (readFileCallCount === 1) {
        const err = new Error('EAGAIN: resource temporarily unavailable') as NodeJS.ErrnoException;
        err.code = 'EAGAIN';
        throw err;
      }
      readFileMockFn = null;
      const { readFile: realReadFile } = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      return realReadFile(args[0] as string, args[1] as { encoding: BufferEncoding });
    };

    const result = await readFileWithRetry(filePath, { encoding: 'utf-8', retryDelay: 1 });
    expect(result).toBe('readable content');
    expect(readFileCallCount).toBeGreaterThanOrEqual(2);
  });

  it('should not retry on non-transient errors like ENOENT', async () => {
    const filePath = path.join(TEST_DIR, 'does-not-exist.txt');

    // Reset to track calls - readFile will naturally throw ENOENT
    readFileCallCount = 0;

    await expect(
      readFileWithRetry(filePath, { maxRetries: 3, retryDelay: 1 })
    ).rejects.toThrow(AtomicFileError);

    // ENOENT is not transient, should fail immediately without retrying
    expect(readFileCallCount).toBe(1);
  });
});
