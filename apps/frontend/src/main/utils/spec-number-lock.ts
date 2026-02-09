/**
 * Spec Number Lock - Distributed locking for spec number coordination
 *
 * Prevents race conditions when creating specs by:
 * 1. Acquiring an exclusive file lock
 * 2. Scanning ALL spec locations (main + worktrees)
 * 3. Finding global maximum spec number
 * 4. Allowing atomic spec directory creation
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync
} from 'fs';
import path from 'path';

export class SpecNumberLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecNumberLockError';
  }
}

export class SpecNumberLock {
  private projectDir: string;
  private lockDir: string;
  private lockFile: string;
  private acquired: boolean = false;
  private globalMax: number | null = null;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.lockDir = path.join(projectDir, '.auto-claude', '.locks');
    this.lockFile = path.join(this.lockDir, 'spec-numbering.lock');
  }

  /**
   * Acquire the spec numbering lock
   */
  async acquire(): Promise<void> {
    // Ensure lock directory exists
    if (!existsSync(this.lockDir)) {
      mkdirSync(this.lockDir, { recursive: true });
    }

    const maxWait = 30000; // 30 seconds in ms
    const startTime = Date.now();

    while (true) {
      try {
        // Try to create lock file exclusively using 'wx' flag
        // This will throw if file already exists
        if (!existsSync(this.lockFile)) {
          writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' });
          this.acquired = true;
          return;
        }
      } catch (error: unknown) {
        // EEXIST means file was created by another process between check and create
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }

      // Lock file exists - check if holder is still running
      if (existsSync(this.lockFile)) {
        try {
          const pidStr = readFileSync(this.lockFile, 'utf-8').trim();
          const pid = parseInt(pidStr, 10);

          if (!Number.isNaN(pid) && !this.isProcessRunning(pid)) {
            // Stale lock - remove it
            try {
              unlinkSync(this.lockFile);
              continue;
            } catch {
              // Another process may have removed it
            }
          }
        } catch {
          // Invalid lock file - try to remove
          try {
            unlinkSync(this.lockFile);
            continue;
          } catch {
            // Ignore removal errors
          }
        }
      }

      // Check timeout
      if (Date.now() - startTime >= maxWait) {
        throw new SpecNumberLockError(
          `Could not acquire spec numbering lock after ${maxWait / 1000}s`
        );
      }

      // Wait before retry (100ms for quick turnaround)
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Release the spec numbering lock
   */
  release(): void {
    if (this.acquired && existsSync(this.lockFile)) {
      try {
        unlinkSync(this.lockFile);
      } catch {
        // Best effort cleanup
      }
      this.acquired = false;
    }
  }

  /**
   * Check if a process is still running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the next available spec number (must be called while lock is held)
   */
  getNextSpecNumber(autoBuildPath?: string): number {
    if (!this.acquired) {
      throw new SpecNumberLockError(
        'Lock must be acquired before getting next spec number'
      );
    }

    if (this.globalMax !== null) {
      return this.globalMax + 1;
    }

    let maxNumber = 0;

    // Determine specs directory base path
    const specsBase = autoBuildPath || '.auto-claude';

    // 1. Scan main project specs
    const mainSpecsDir = path.join(this.projectDir, specsBase, 'specs');
    maxNumber = Math.max(maxNumber, this.scanSpecsDir(mainSpecsDir));

    // 2. Scan all worktree specs
    const worktreesDir = path.join(this.projectDir, '.auto-claude', 'worktrees', 'tasks');
    if (existsSync(worktreesDir)) {
      try {
        const worktrees = readdirSync(worktreesDir, { withFileTypes: true });
        for (const worktree of worktrees) {
          if (worktree.isDirectory()) {
            const worktreeSpecsDir = path.join(
              worktreesDir,
              worktree.name,
              specsBase,
              'specs'
            );
            maxNumber = Math.max(maxNumber, this.scanSpecsDir(worktreeSpecsDir));
          }
        }
      } catch {
        // Ignore errors scanning worktrees
      }
    }

    this.globalMax = maxNumber;
    return maxNumber + 1;
  }

  /**
   * Scan a specs directory and return the highest spec number found
   */
  private scanSpecsDir(specsDir: string): number {
    if (!existsSync(specsDir)) {
      return 0;
    }

    let maxNum = 0;
    try {
      const entries = readdirSync(specsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const match = entry.name.match(/^(\d{3})-/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!Number.isNaN(num)) {
              maxNum = Math.max(maxNum, num);
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return maxNum;
  }
}

/**
 * Helper function to create a spec with coordinated numbering
 */
export async function withSpecNumberLock<T>(
  projectDir: string,
  callback: (lock: SpecNumberLock) => T | Promise<T>
): Promise<T> {
  const lock = new SpecNumberLock(projectDir);
  try {
    await lock.acquire();
    return await callback(lock);
  } finally {
    lock.release();
  }
}
