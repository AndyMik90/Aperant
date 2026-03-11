import { describe, it, expect } from 'vitest';

import { sanitizeFilePathArg } from '../define';

// =============================================================================
// sanitizeFilePathArg
// =============================================================================

describe('sanitizeFilePathArg', () => {
  it('leaves a normal path unchanged', () => {
    const input = { file_path: 'src/main/file.ts' };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('src/main/file.ts');
  });

  it('strips trailing JSON artifact sequence', () => {
    const input: Record<string, unknown> = { file_path: "spec.md'}}," };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('spec.md');
  });

  it('strips trailing brace', () => {
    const input: Record<string, unknown> = { file_path: 'file.json}' };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('file.json');
  });

  it('strips trailing quote and brace', () => {
    const input: Record<string, unknown> = { file_path: "file.ts'}" };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('file.ts');
  });

  it('does not modify when file_path is a number', () => {
    const input: Record<string, unknown> = { file_path: 123 };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe(123);
  });

  it('does not modify when file_path key is absent', () => {
    const input: Record<string, unknown> = { other: 'value' };
    sanitizeFilePathArg(input);
    expect(input).toEqual({ other: 'value' });
  });

  it('handles empty string without error', () => {
    const input: Record<string, unknown> = { file_path: '' };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('');
  });

  it('leaves path with dots and extensions unchanged', () => {
    const input: Record<string, unknown> = { file_path: 'src/components/App.tsx' };
    sanitizeFilePathArg(input);
    expect(input.file_path).toBe('src/components/App.tsx');
  });
});
