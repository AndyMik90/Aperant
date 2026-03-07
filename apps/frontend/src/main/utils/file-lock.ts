/**
 * In-process file lock for serializing read-modify-write operations.
 * Prevents concurrent IPC calls from causing lost updates on the same file.
 *
 * Shared across all modules to ensure a single lock map coordinates access.
 */

const fileLocks = new Map<string, Promise<void>>();

export async function withFileLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
  while (fileLocks.has(filepath)) {
    await fileLocks.get(filepath);
  }

  let resolve: (() => void) | undefined;
  const lockPromise = new Promise<void>((r) => {
    resolve = r;
  });
  fileLocks.set(filepath, lockPromise);

  try {
    return await fn();
  } finally {
    fileLocks.delete(filepath);
    resolve?.();
  }
}
