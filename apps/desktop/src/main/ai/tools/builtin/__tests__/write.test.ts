import { describe, it, expect, vi, beforeEach } from 'vitest';

import { writeTool } from '../write';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Write Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPathContained).mockImplementation((_filePath: string, _projectDir: string) => ({
      contained: true,
      resolvedPath: _filePath,
    }));
    // Parent directory exists by default
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  });

  it('should have correct metadata', () => {
    expect(writeTool.metadata.name).toBe('Write');
    expect(writeTool.metadata.permission).toBe('requires_approval');
  });

  it('should write a new file and report line count', async () => {
    const content = 'line one\nline two\nline three';

    const result = await writeTool.config.execute(
      { file_path: '/test/project/new-file.ts', content },
      baseContext,
    );

    expect(result).toContain('Successfully wrote 3 lines');
    expect(result).toContain('/test/project/new-file.ts');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/project/new-file.ts',
      content,
      'utf-8',
    );
  });

  it('should overwrite an existing file', async () => {
    const content = 'updated content';

    const result = await writeTool.config.execute(
      { file_path: '/test/project/existing.ts', content },
      baseContext,
    );

    expect(result).toContain('Successfully wrote');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/project/existing.ts',
      content,
      'utf-8',
    );
  });

  it('should create parent directories when they do not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    await writeTool.config.execute(
      { file_path: '/test/project/new/deep/file.ts', content: 'content' },
      baseContext,
    );

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      '/test/project/new/deep',
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should not create directories when parent already exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await writeTool.config.execute(
      { file_path: '/test/project/file.ts', content: 'content' },
      baseContext,
    );

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('should count lines correctly for single-line content', async () => {
    const result = await writeTool.config.execute(
      { file_path: '/test/project/file.ts', content: 'single line' },
      baseContext,
    );

    expect(result).toContain('Successfully wrote 1 lines');
  });

  it('should count CRLF lines correctly', async () => {
    const content = 'line1\r\nline2\r\nline3';

    const result = await writeTool.config.execute(
      { file_path: '/test/project/file.ts', content },
      baseContext,
    );

    // split(/\r?\n/) yields 3 parts
    expect(result).toContain('Successfully wrote 3 lines');
  });

  it('should call assertPathContained for path security', async () => {
    await writeTool.config.execute(
      { file_path: '/test/project/file.ts', content: 'hello' },
      baseContext,
    );

    expect(assertPathContained).toHaveBeenCalledWith('/test/project/file.ts', '/test/project');
  });

  it('should throw when path is outside project boundary', async () => {
    vi.mocked(assertPathContained).mockImplementation(() => {
      throw new Error("Path '/etc/hosts' is outside the project directory");
    });

    await expect(
      writeTool.config.execute(
        { file_path: '/etc/hosts', content: 'malicious' },
        baseContext,
      ),
    ).rejects.toThrow('outside the project directory');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
