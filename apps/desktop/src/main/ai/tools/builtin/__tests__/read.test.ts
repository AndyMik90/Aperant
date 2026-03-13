import { describe, it, expect, vi, beforeEach } from 'vitest';

import { readTool } from '../read';
import type { ToolContext } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs');
vi.mock('../../../security/path-containment', () => ({
  assertPathContained: vi.fn((_filePath: string, _projectDir: string) => ({
    contained: true,
    resolvedPath: _filePath,
  })),
}));

import * as fs from 'node:fs';
import { assertPathContained } from '../../../security/path-containment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseContext: ToolContext = {
  cwd: '/test/project',
  projectDir: '/test/project',
  specDir: '/test/specs/001',
  securityProfile: {
    baseCommands: new Set(),
    stackCommands: new Set(),
    scriptCommands: new Set(),
    customCommands: new Set(),
    customScripts: { shellScripts: [] },
    getAllAllowedCommands: () => new Set(),
  },
} as unknown as ToolContext;

/**
 * Set up the fs mock sequence for a successful text file read.
 *
 * openSync → fd, fstatSync → stat object, readFileSync → content, closeSync → void
 */
function setupTextFile(content: string, isDir = false) {
  const fakeFd = 42;
  vi.mocked(fs.openSync).mockReturnValue(fakeFd as unknown as number);
  vi.mocked(fs.fstatSync).mockReturnValue({
    isDirectory: () => isDir,
    size: Buffer.byteLength(content),
  } as unknown as fs.Stats);
  vi.mocked(fs.readFileSync).mockReturnValue(content);
  vi.mocked(fs.closeSync).mockImplementation(() => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Read Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPathContained).mockImplementation((_filePath: string, _projectDir: string) => ({
      contained: true,
      resolvedPath: _filePath,
    }));
  });

  it('should have correct metadata', () => {
    expect(readTool.metadata.name).toBe('Read');
    expect(readTool.metadata.permission).toBe('read_only');
  });

  it('should read an entire file with line numbers', async () => {
    setupTextFile('line one\nline two\nline three');

    const result = await readTool.config.execute(
      { file_path: '/test/project/file.ts' },
      baseContext,
    );

    expect(result).toContain('line one');
    expect(result).toContain('line two');
    expect(result).toContain('line three');
    // Line numbers should be present (cat -n style)
    expect(result).toMatch(/\d+\t/);
  });

  it('should format output with correct line numbers', async () => {
    setupTextFile('alpha\nbeta\ngamma');

    const result = await readTool.config.execute(
      { file_path: '/test/project/file.ts' },
      baseContext,
    ) as string;

    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^\s*1\talpha/);
    expect(lines[1]).toMatch(/^\s*2\tbeta/);
    expect(lines[2]).toMatch(/^\s*3\tgamma/);
  });

  it('should respect offset and limit parameters', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    setupTextFile(content);

    const result = await readTool.config.execute(
      { file_path: '/test/project/file.ts', offset: 1, limit: 2 },
      baseContext,
    ) as string;

    // offset=1 means start from line index 1 (line2), limit=2 means two lines
    expect(result).toContain('line2');
    expect(result).toContain('line3');
    expect(result).not.toContain('line1');
    expect(result).not.toContain('line4');
  });

  it('should show truncation notice when there are more lines beyond limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    setupTextFile(lines.join('\n'));

    const result = await readTool.config.execute(
      { file_path: '/test/project/file.ts', offset: 0, limit: 3 },
      baseContext,
    ) as string;

    expect(result).toContain('Showing lines 1-3 of 10 total lines');
  });

  it('should return error when file not found', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(fs.openSync).mockImplementation(() => { throw enoentError; });

    const result = await readTool.config.execute(
      { file_path: '/test/project/missing.ts' },
      baseContext,
    );

    expect(result).toContain('Error: File not found');
  });

  it('should return error when path is a directory (EISDIR)', async () => {
    const eisdirError = Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    vi.mocked(fs.openSync).mockImplementation(() => { throw eisdirError; });

    const result = await readTool.config.execute(
      { file_path: '/test/project/somedir' },
      baseContext,
    );

    expect(result).toContain('is a directory');
  });

  it('should return empty file message when file has no content', async () => {
    setupTextFile('');

    const result = await readTool.config.execute(
      { file_path: '/test/project/empty.ts' },
      baseContext,
    );

    expect(result).toContain('File exists but is empty');
  });

  it('should return image file as base64 data URI', async () => {
    const fakeFd = 42;
    const imageBuffer = Buffer.from('fake-png-data');
    vi.mocked(fs.openSync).mockReturnValue(fakeFd as unknown as number);
    vi.mocked(fs.fstatSync).mockReturnValue({
      isDirectory: () => false,
      size: imageBuffer.length,
    } as unknown as fs.Stats);
    // readFileSync returns Buffer for image files
    vi.mocked(fs.readFileSync).mockReturnValue(imageBuffer);
    vi.mocked(fs.closeSync).mockImplementation(() => undefined);

    const result = await readTool.config.execute(
      { file_path: '/test/project/image.png' },
      baseContext,
    ) as string;

    expect(result).toContain('[Image file:');
    expect(result).toContain('data:image/png;base64,');
  });

  it('should return PDF info without pages parameter', async () => {
    const fakeFd = 42;
    vi.mocked(fs.openSync).mockReturnValue(fakeFd as unknown as number);
    vi.mocked(fs.fstatSync).mockReturnValue({
      isDirectory: () => false,
      size: 102400,
    } as unknown as fs.Stats);
    vi.mocked(fs.closeSync).mockImplementation(() => undefined);

    const result = await readTool.config.execute(
      { file_path: '/test/project/doc.pdf' },
      baseContext,
    ) as string;

    expect(result).toContain('[PDF file:');
    expect(result).toContain('pages');
  });

  it('should call assertPathContained for path security', async () => {
    setupTextFile('content');

    await readTool.config.execute(
      { file_path: '/test/project/file.ts' },
      baseContext,
    );

    expect(assertPathContained).toHaveBeenCalledWith('/test/project/file.ts', '/test/project');
  });

  it('should throw when path is outside project boundary', async () => {
    vi.mocked(assertPathContained).mockImplementation(() => {
      throw new Error("Path '/etc/passwd' is outside the project directory");
    });

    await expect(
      readTool.config.execute(
        { file_path: '/etc/passwd' },
        baseContext,
      ),
    ).rejects.toThrow('outside the project directory');
  });
});
