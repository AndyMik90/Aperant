/**
 * Tests for atomic-file module - atomic file operations with retry logic.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import path from 'path';
import {
  writeFileAtomic,
  writeFileAtomicSync,
  writeFileWithRetry,
  readFileWithRetry,
  writeJsonAtomic,
  writeJsonWithRetry,
  AtomicFileError,
} from '../atomic-file';

// Import fs/promises to use in tests
import * as fsPromises from 'fs/promises';
const { mkdir, readFile, writeFile, rm } = fsPromises;

// Test directory for isolated tests
const TEST_DIR = path.join(__dirname, '.test-atomic-file');

describe('writeFileAtomic', () => {
  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('basic operations', () => {
    it('should write a new file atomically', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      const content = 'Hello, World!';

      await writeFileAtomic(filePath, content);

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should overwrite an existing file atomically', async () => {
      const filePath = path.join(TEST_DIR, 'existing.txt');
      const initialContent = 'Initial content';
      const newContent = 'New content';

      await writeFile(filePath, initialContent, 'utf-8');
      await writeFileAtomic(filePath, newContent);

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(newContent);
    });

    it('should create parent directories if they do not exist', async () => {
      const filePath = path.join(TEST_DIR, 'nested', 'dir', 'file.txt');
      const content = 'Nested file content';

      await writeFileAtomic(filePath, content);

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should write Buffer data', async () => {
      const filePath = path.join(TEST_DIR, 'buffer.bin');
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      await writeFileAtomic(filePath, buffer);

      const result = await readFile(filePath);
      expect(result).toEqual(buffer);
    });

    it('should respect encoding option', async () => {
      const filePath = path.join(TEST_DIR, 'utf8.txt');
      const content = 'UTF-8 content: 你好';

      await writeFileAtomic(filePath, content, { encoding: 'utf-8' });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });
  });

  describe('temp file cleanup', () => {
    it('should not leave temp files after successful write', async () => {
      const filePath = path.join(TEST_DIR, 'no-temp.txt');

      await writeFileAtomic(filePath, 'content');

      const files = await fsPromises.readdir(TEST_DIR);
      const tempFiles = files.filter(f => f.includes('.tmp.'));

      expect(tempFiles).toHaveLength(0);
    });

    it('should not leave temp files after multiple writes', async () => {
      const filePath = path.join(TEST_DIR, 'multiple-writes.txt');

      for (let i = 0; i < 5; i++) {
        await writeFileAtomic(filePath, `content ${i}`);
      }

      const files = await fsPromises.readdir(TEST_DIR);
      const tempFiles = files.filter(f => f.includes('.tmp.'));

      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should throw error when write fails', async () => {
      // Create a regular file where mkdir would need to create a directory.
      // This fails cross-platform because you can't mkdir inside a file.
      const blockingFile = path.join(TEST_DIR, 'blocker');
      await writeFile(blockingFile, 'not a directory');
      const invalidPath = path.join(blockingFile, 'sub', 'file.txt');

      await expect(
        writeFileAtomic(invalidPath, 'content')
      ).rejects.toThrow();
    });
  });
});

describe('writeFileWithRetry', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('retry logic', () => {
    it('should succeed on first attempt when no errors occur', async () => {
      const filePath = path.join(TEST_DIR, 'retry-success.txt');
      const content = 'First attempt success';

      await writeFileWithRetry(filePath, content);

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should write file successfully with retry enabled', async () => {
      const filePath = path.join(TEST_DIR, 'retry-enabled.txt');
      const content = 'Content with retry';

      await writeFileWithRetry(filePath, content, { maxRetries: 5, retryDelay: 10 });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should handle Buffer data with retry', async () => {
      const filePath = path.join(TEST_DIR, 'retry-buffer.bin');
      const buffer = Buffer.from('Binary content');

      await writeFileWithRetry(filePath, buffer, { maxRetries: 3 });

      const result = await readFile(filePath);
      expect(result).toEqual(buffer);
    });

    it('should create parent directories with retry logic', async () => {
      const filePath = path.join(TEST_DIR, 'nested', 'retry', 'file.txt');
      const content = 'Nested with retry';

      await writeFileWithRetry(filePath, content, { maxRetries: 3 });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });
  });

  describe('options handling', () => {
    it('should accept custom maxRetries option', async () => {
      const filePath = path.join(TEST_DIR, 'custom-retries.txt');
      const content = 'Custom retries';

      await writeFileWithRetry(filePath, content, { maxRetries: 10 });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should accept custom retryDelay option', async () => {
      const filePath = path.join(TEST_DIR, 'custom-delay.txt');
      const content = 'Custom delay';

      await writeFileWithRetry(filePath, content, { retryDelay: 50 });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should accept all options combined', async () => {
      const filePath = path.join(TEST_DIR, 'all-options.txt');
      const content = 'All options';

      await writeFileWithRetry(filePath, content, {
        encoding: 'utf-8',
        maxRetries: 5,
        retryDelay: 100,
      });

      const result = await readFile(filePath, 'utf-8');
      expect(result).toBe(content);
    });
  });
});

describe('readFileWithRetry', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('basic operations', () => {
    it('should read file successfully', async () => {
      const filePath = path.join(TEST_DIR, 'read.txt');
      const content = 'Read me!';

      await writeFile(filePath, content, 'utf-8');
      const result = await readFileWithRetry(filePath, { encoding: 'utf-8' });

      expect(result).toBe(content);
    });

    it('should return Buffer when encoding not specified', async () => {
      const filePath = path.join(TEST_DIR, 'read-buffer.bin');
      const buffer = Buffer.from('Binary data');

      await writeFile(filePath, buffer);
      const result = await readFileWithRetry(filePath);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(buffer);
    });
  });

  describe('retry logic', () => {
    it('should read file with retry enabled', async () => {
      const filePath = path.join(TEST_DIR, 'read-retry.txt');
      const content = 'Retry content';
      await writeFile(filePath, content, 'utf-8');

      const result = await readFileWithRetry(filePath, { encoding: 'utf-8', retryDelay: 10 });

      expect(result).toBe(content);
    });

    it('should handle different retry options for reads', async () => {
      const filePath = path.join(TEST_DIR, 'read-options.txt');
      const content = 'Options test';
      await writeFile(filePath, content, 'utf-8');

      const result = await readFileWithRetry(filePath, {
        encoding: 'utf-8',
        maxRetries: 5,
        retryDelay: 50,
      });

      expect(result).toBe(content);
    });

    it('should throw error for non-existent file after retries', async () => {
      const filePath = path.join(TEST_DIR, 'non-existent.txt');

      await expect(
        readFileWithRetry(filePath, { maxRetries: 2, retryDelay: 10 })
      ).rejects.toThrow(AtomicFileError);
    });
  });
});

describe('writeJsonAtomic', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('JSON operations', () => {
    it('should write JSON data atomically', async () => {
      const filePath = path.join(TEST_DIR, 'data.json');
      const data = { key: 'value', nested: { prop: 123 } };

      await writeJsonAtomic(filePath, data);

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });

    it('should use default indent of 2 spaces', async () => {
      const filePath = path.join(TEST_DIR, 'indented.json');
      const data = { key: 'value' };

      await writeJsonAtomic(filePath, data);

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('  "key"'); // 2 spaces
    });

    it('should respect custom indent option', async () => {
      const filePath = path.join(TEST_DIR, 'custom-indent.json');
      const data = { key: 'value' };

      await writeJsonAtomic(filePath, data, { indent: 4 });

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('    "key"'); // 4 spaces
    });

    it('should handle complex nested objects', async () => {
      const filePath = path.join(TEST_DIR, 'complex.json');
      const data = {
        string: 'text',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { deep: { value: 'deep' } },
      };

      await writeJsonAtomic(filePath, data);

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });

    it('should handle arrays', async () => {
      const filePath = path.join(TEST_DIR, 'array.json');
      const data = [1, 2, 3, { key: 'value' }];

      await writeJsonAtomic(filePath, data);

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });
  });
});

describe('writeJsonWithRetry', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('JSON operations with retry', () => {
    it('should write JSON data with retry logic', async () => {
      const filePath = path.join(TEST_DIR, 'retry.json');
      const data = { status: 'success' };

      await writeJsonWithRetry(filePath, data);

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });

    it('should write complex JSON with retry enabled', async () => {
      const filePath = path.join(TEST_DIR, 'complex-retry.json');
      const data = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        boolean: true,
      };

      await writeJsonWithRetry(filePath, data, { maxRetries: 3, retryDelay: 10 });

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });

    it('should use custom indent for JSON formatting', async () => {
      const filePath = path.join(TEST_DIR, 'json-indent.json');
      const data = { formatted: true };

      await writeJsonWithRetry(filePath, data, { indent: 4 });

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('    "formatted"'); // 4 spaces
    });

    it('should respect all retry options', async () => {
      const filePath = path.join(TEST_DIR, 'json-options.json');
      const data = { options: 'test' };

      await writeJsonWithRetry(filePath, data, {
        indent: 2,
        maxRetries: 5,
        retryDelay: 50,
      });

      const result = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(result).toEqual(data);
    });
  });
});

describe('writeFileAtomicSync', () => {
  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('basic operations', () => {
    it('should write a new file atomically', () => {
      const filePath = path.join(TEST_DIR, 'sync-test.txt');
      const content = 'Hello, sync!';

      writeFileAtomicSync(filePath, content);

      const result = readFileSync(filePath, 'utf-8');
      expect(result).toBe(content);
    });

    it('should overwrite an existing file atomically', () => {
      const filePath = path.join(TEST_DIR, 'sync-existing.txt');
      writeFileSync(filePath, 'Initial content', 'utf-8');

      writeFileAtomicSync(filePath, 'New content');

      const result = readFileSync(filePath, 'utf-8');
      expect(result).toBe('New content');
    });

    it('should write Buffer data', () => {
      const filePath = path.join(TEST_DIR, 'sync-buffer.bin');
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);

      writeFileAtomicSync(filePath, buffer);

      const result = readFileSync(filePath);
      expect(result).toEqual(buffer);
    });

    it('should resolve relative paths', () => {
      const absolutePath = path.join(TEST_DIR, 'sync-resolve.txt');
      // Use a relative path that resolves to the same location
      const relativePath = path.relative(process.cwd(), absolutePath);

      writeFileAtomicSync(relativePath, 'resolved content');

      const result = readFileSync(absolutePath, 'utf-8');
      expect(result).toBe('resolved content');
    });
  });

  describe('temp file cleanup', () => {
    it('should not leave temp files after successful write', () => {
      const filePath = path.join(TEST_DIR, 'sync-no-temp.txt');

      writeFileAtomicSync(filePath, 'content');

      const files = readdirSync(TEST_DIR);
      const tempFiles = files.filter(name => name.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should clean up temp file when rename fails', () => {
      // Create a subdirectory as the "target" — renameSync will fail because
      // you can't atomically replace a directory with a file
      const dirTarget = path.join(TEST_DIR, 'is-a-dir');
      mkdirSync(dirTarget);

      expect(() => writeFileAtomicSync(dirTarget, 'content')).toThrow();

      // Verify temp file was cleaned up (it was created in TEST_DIR)
      const files = readdirSync(TEST_DIR);
      const tempFiles = files.filter(name => name.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should throw when directory does not exist', () => {
      const filePath = path.join(TEST_DIR, 'no', 'such', 'dir', 'file.txt');

      expect(() => writeFileAtomicSync(filePath, 'content')).toThrow();
    });
  });
});

describe('AtomicFileError', () => {
  it('should be an instance of Error', () => {
    const error = new AtomicFileError('Test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct name', () => {
    const error = new AtomicFileError('Test error');
    expect(error.name).toBe('AtomicFileError');
  });

  it('should preserve error message', () => {
    const message = 'Custom error message';
    const error = new AtomicFileError(message);
    expect(error.message).toBe(message);
  });
});
