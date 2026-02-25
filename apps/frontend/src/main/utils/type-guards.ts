/**
 * Type Guards Utility
 *
 * Shared type guard functions for common type checking patterns.
 */

/**
 * Type guard to check if an error is a NodeJS.ErrnoException with a code property.
 * Useful for checking error codes like 'ENOENT', 'EEXIST', etc.
 */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
