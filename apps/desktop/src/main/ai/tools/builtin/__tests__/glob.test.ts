import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { globTool } from '../glob';
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
vi.mock('../../truncation', () => ({
  truncateToolOutput: vi.fn((output: string) => ({
    content: output,
    wasTruncated: false,
    originalSize: Buffer.byteLength(output, 'utf-8'),
  })),
}));

import * as fs from 'node:fs';
import { assertPathContained } from '../../../security/path-containment';
import { truncateToolOutput } from '../../truncation';

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
 * Configure fs mocks for a glob run that returns the given absolute paths.
 * Each path gets a fake mtime so sorting can be tested.
 */
function setupGlobMatches(absolutePaths: string[], mtimes?: number[]) {
  // existsSync for the search dir
  vi.mocked(fs.existsSync).mockReturnValue(true);

  // globSync returns relative filenames that the tool will resolve
  const relPaths = absolutePaths.map((p) => p.replace('/test/project/', ''));
  vi.mocked(fs.globSync).mockReturnValue(relPaths);

  // statSync used twice: once to check isFile, once to get mtime
  let callIdx = 0;
  vi.mocked(fs.statSync).mockImplementation((_p) => {
    const mtime = mtimes ? mtimes[callIdx % mtimes.length] : 1000;
    callIdx++;
    return {
      isFile: () => true,
      mtimeMs: mtime,
    } as unknown as fs.Stats;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Glob Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPathContained).mockImplementation((_filePath: string, _projectDir: string) => ({
      contained: true,
      resolvedPath: _filePath,
    }));
    vi.mocked(truncateToolOutput).mockImplementation((output: string) => ({
      content: output,
      wasTruncated: false,
      originalSize: Buffer.byteLength(output, 'utf-8'),
    }));
  });

  it('should have correct metadata', () => {
    expect(globTool.metadata.name).toBe('Glob');
    expect(globTool.metadata.permission).toBe('read_only');
  });

  it('should return matching file paths', async () => {
    setupGlobMatches([
      '/test/project/src/index.ts',
      '/test/project/src/utils.ts',
    ]);

    const result = await globTool.config.execute(
      { pattern: '**/*.ts' },
      baseContext,
    ) as string;

    expect(result).toContain('index.ts');
    expect(result).toContain('utils.ts');
  });

  it('should return "No files found" when pattern matches nothing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.globSync).mockReturnValue([]);

    const result = await globTool.config.execute(
      { pattern: '**/*.nonexistent' },
      baseContext,
    );

    expect(result).toBe('No files found');
  });

  it('should return error when search directory does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await globTool.config.execute(
      { pattern: '*.ts', path: '/test/project/missing-dir' },
      baseContext,
    );

    expect(result).toContain('Error: Directory not found');
  });

  it('should sort results by mtime (most recent first)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.globSync).mockReturnValue(['old.ts', 'new.ts', 'middle.ts']);

    // Return different mtimes for isFile check vs mtime check
    // statSync is called once per file for isFile and once per file for mtime
    const mtimes: Record<string, number> = {
      [path.resolve('/test/project', 'old.ts')]: 1000,
      [path.resolve('/test/project', 'new.ts')]: 3000,
      [path.resolve('/test/project', 'middle.ts')]: 2000,
    };

    vi.mocked(fs.statSync).mockImplementation((p) => ({
      isFile: () => true,
      mtimeMs: mtimes[p as string] ?? 1000,
    } as unknown as fs.Stats));

    const result = await globTool.config.execute(
      { pattern: '*.ts' },
      baseContext,
    ) as string;

    const lines = result.split('\n');
    const newIdx = lines.findIndex((l) => l.includes('new.ts'));
    const middleIdx = lines.findIndex((l) => l.includes('middle.ts'));
    const oldIdx = lines.findIndex((l) => l.includes('old.ts'));

    expect(newIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(oldIdx);
  });

  it('should use provided path instead of cwd when given', async () => {
    setupGlobMatches(['/test/project/sub/file.ts']);

    await globTool.config.execute(
      { pattern: '*.ts', path: '/test/project/sub' },
      baseContext,
    );

    expect(fs.globSync).toHaveBeenCalledWith('*.ts', expect.objectContaining({
      cwd: '/test/project/sub',
    }));
  });

  it('should exclude node_modules and .git from results', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.globSync).mockReturnValue(['src/index.ts']);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      mtimeMs: 1000,
    } as unknown as fs.Stats);

    await globTool.config.execute(
      { pattern: '**/*.ts' },
      baseContext,
    );

    // The exclude function passed to globSync should exclude node_modules/.git
    const globSyncCall = vi.mocked(fs.globSync).mock.calls[0];
    const opts = globSyncCall[1] as { exclude?: (name: string) => boolean };
    expect(opts.exclude).toBeDefined();
    expect(opts.exclude?.('node_modules')).toBe(true);
    expect(opts.exclude?.('.git')).toBe(true);
    expect(opts.exclude?.('src')).toBe(false);
  });

  it('should call assertPathContained for path security', async () => {
    setupGlobMatches([]);
    vi.mocked(fs.globSync).mockReturnValue([]);

    await globTool.config.execute(
      { pattern: '*.ts' },
      baseContext,
    );

    expect(assertPathContained).toHaveBeenCalledWith('/test/project', '/test/project');
  });

  it('should pass output through truncateToolOutput', async () => {
    setupGlobMatches(['/test/project/a.ts']);

    await globTool.config.execute(
      { pattern: '*.ts' },
      baseContext,
    );

    expect(truncateToolOutput).toHaveBeenCalled();
  });
});
