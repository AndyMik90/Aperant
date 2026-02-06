import path from 'path';

/**
 * Ensures a path is absolute. If it's already absolute, returns it as-is.
 * If relative, resolves it against the current working directory.
 */
export function ensureAbsolutePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(p);
}
