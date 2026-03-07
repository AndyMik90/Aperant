import path from 'path';

/**
 * Ensures a path is absolute. If it's already absolute, returns it as-is.
 * If relative, resolves it against the current working directory.
 * Throws if the input is empty or blank.
 */
export function ensureAbsolutePath(p: string): string {
  if (!p || p.trim() === '') {
    throw new Error('Path cannot be empty');
  }
  return path.isAbsolute(p) ? p : path.resolve(p);
}
