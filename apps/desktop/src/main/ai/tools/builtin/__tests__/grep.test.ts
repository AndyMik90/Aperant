import { describe, it, expect, vi, beforeEach } from 'vitest';

import { grepTool } from '../grep';
import type { ToolContext } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockFindExecutable = vi.fn(() => '/usr/bin/rg');

vi.mock('../../../../platform/index', () => ({
  findExecutable: (_name: string, _additionalPaths?: string[]) => mockFindExecutable(),
}));

vi.mock('../../../security/path-containment', () => ({
  assertPathContained: vi.fn((_filePath: string, _projectDir: string) => ({
    contained: true,
    resolvedPath: _filePath,
  })),
}));

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
 * Set up mockExecFile to invoke the callback with the provided rg output values.
 */
function setupRg(stdout: string, stderr: string, exitCode: number) {
  mockExecFile.mockImplementation(
    (
      _rgPath: unknown,
      _args: unknown,
      _opts: unknown,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const err = exitCode !== 0 ? Object.assign(new Error('exit'), { code: exitCode }) : null;
      callback(err, stdout, stderr);
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Grep Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set after clearAllMocks wipes the return value
    mockFindExecutable.mockReturnValue('/usr/bin/rg');
    vi.mocked(assertPathContained).mockImplementation((_filePath: string, _projectDir: string) => ({
      contained: true,
      resolvedPath: _filePath,
    }));
  });

  it('should have correct metadata', () => {
    expect(grepTool.metadata.name).toBe('Grep');
    expect(grepTool.metadata.permission).toBe('read_only');
  });

  it('should return matching files in files_with_matches mode (default)', async () => {
    setupRg('/test/project/src/index.ts\n/test/project/src/utils.ts\n', '', 0);

    const result = await grepTool.config.execute(
      { pattern: 'myFunction' },
      baseContext,
    ) as string;

    expect(result).toContain('/test/project/src/index.ts');
    expect(result).toContain('/test/project/src/utils.ts');
  });

  it('should return "No matches found" when rg exits with code 1 and no stderr', async () => {
    setupRg('', '', 1);

    const result = await grepTool.config.execute(
      { pattern: 'nonexistent_pattern_xyz' },
      baseContext,
    );

    expect(result).toBe('No matches found');
  });

  it('should return "No matches found" when stdout is empty', async () => {
    setupRg('   \n', '', 0);

    const result = await grepTool.config.execute(
      { pattern: 'something' },
      baseContext,
    );

    expect(result).toBe('No matches found');
  });

  it('should return error message when rg exits with code > 1 and stderr', async () => {
    setupRg('', 'rg: error: unknown file type\n', 2);

    const result = await grepTool.config.execute(
      { pattern: 'test', type: 'unknowntype' },
      baseContext,
    ) as string;

    expect(result).toContain('Error:');
    expect(result).toContain('unknown file type');
  });

  it('should return error when ripgrep is not installed', async () => {
    mockFindExecutable.mockReturnValue(null as unknown as string);

    const result = await grepTool.config.execute(
      { pattern: 'test' },
      baseContext,
    ) as string;

    expect(result).toContain('Error:');
    expect(result).toContain('ripgrep');
  });

  it('should include --files-with-matches flag in default mode', async () => {
    setupRg('/test/project/a.ts\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--files-with-matches');
  });

  it('should include --line-number flag in content mode', async () => {
    setupRg('src/a.ts:10:const hello = 1;\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', output_mode: 'content' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--line-number');
    expect(args).not.toContain('--files-with-matches');
    expect(args).not.toContain('--count');
  });

  it('should include --count flag in count mode', async () => {
    setupRg('src/a.ts:5\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', output_mode: 'count' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--count');
  });

  it('should add -C flag when context lines are specified in content mode', async () => {
    setupRg('match output\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', output_mode: 'content', context: 3 },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('-C');
    expect(args).toContain('3');
  });

  it('should add --type flag when type is specified', async () => {
    setupRg('/test/project/a.ts\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', type: 'ts' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--type');
    expect(args).toContain('ts');
  });

  it('should add --glob flag when glob is specified', async () => {
    setupRg('/test/project/src/a.ts\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', glob: '*.{ts,tsx}' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--glob');
    expect(args).toContain('*.{ts,tsx}');
  });

  it('should truncate output exceeding MAX_OUTPUT_LENGTH', async () => {
    const longOutput = '/test/project/file.ts\n'.repeat(2000);
    setupRg(longOutput, '', 0);

    const result = await grepTool.config.execute(
      { pattern: 'test' },
      baseContext,
    ) as string;

    expect(result).toContain('[Output truncated');
    expect(result.length).toBeLessThan(longOutput.length);
  });

  it('should call assertPathContained for path security', async () => {
    setupRg('/test/project/a.ts\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello' },
      baseContext,
    );

    expect(assertPathContained).toHaveBeenCalledWith('/test/project', '/test/project');
  });

  it('should throw when search path is outside project boundary', async () => {
    vi.mocked(assertPathContained).mockImplementation(() => {
      throw new Error("Path '/etc' is outside the project directory");
    });

    await expect(
      grepTool.config.execute(
        { pattern: 'root', path: '/etc' },
        baseContext,
      ),
    ).rejects.toThrow('outside the project directory');
  });

  it('should use provided path for search instead of cwd', async () => {
    setupRg('/test/project/sub/a.ts\n', '', 0);

    await grepTool.config.execute(
      { pattern: 'hello', path: '/test/project/sub' },
      baseContext,
    );

    const args = mockExecFile.mock.calls[0][1] as string[];
    // The resolved search path should be the last argument before the pattern
    expect(args).toContain('/test/project/sub');
  });
});
