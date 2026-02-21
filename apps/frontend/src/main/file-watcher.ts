import chokidar, { FSWatcher } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { ImplementationPlan } from '../shared/types';

interface WatcherInfo {
  taskId: string;
  watcher: FSWatcher;
  planPath: string;
}

/**
 * Watches implementation_plan.json files for real-time progress updates
 */
export class FileWatcher extends EventEmitter {
  private watchers: Map<string, WatcherInfo> = new Map();
  // Maps taskId -> specDir for the in-flight watch() call.
  // Allows re-watch calls with a different specDir to proceed while
  // still preventing duplicate calls for the exact same specDir.
  private pendingWatches: Map<string, string> = new Map();
  // Tracks taskIds that had unwatch() called while watch() was in-flight.
  // Checked after each await point in watch() to avoid creating a leaked watcher.
  private cancelledWatches: Set<string> = new Set();

  /**
   * Start watching a task's implementation plan
   */
  async watch(taskId: string, specDir: string): Promise<void> {
    // Prevent overlapping watch() calls for the same taskId + specDir combination.
    // Since watch() is async, rapid-fire callers could enter concurrently
    // before the first call updates state, creating duplicate watchers.
    // A call with a different specDir is a legitimate re-watch and is allowed through.
    const pendingSpecDir = this.pendingWatches.get(taskId);
    if (pendingSpecDir !== undefined && pendingSpecDir === specDir) {
      return;
    }
    this.pendingWatches.set(taskId, specDir);

    try {
      // Close any existing watcher for this task.
      // Delete from the map BEFORE awaiting close so that a concurrent watch()
      // call entering after the await cannot obtain the same FSWatcher reference
      // and attempt a second close() on the same object.
      const existing = this.watchers.get(taskId);
      if (existing) {
        this.watchers.delete(taskId);
        await existing.watcher.close();
      }

      // Check if a newer watch() call has superseded this one while we were awaiting.
      // If the pending specDir changed, another concurrent watch() took over — bail out
      // to avoid overwriting the watcher it is about to create.
      if (this.pendingWatches.get(taskId) !== specDir) {
        return;
      }

      // Check if unwatch() was called while we were awaiting above.
      if (this.cancelledWatches.has(taskId)) {
        this.cancelledWatches.delete(taskId);
        return;
      }

      const planPath = path.join(specDir, 'implementation_plan.json');

      // Check if plan file exists
      if (!existsSync(planPath)) {
        this.emit('error', taskId, `Plan file not found: ${planPath}`);
        return;
      }

      // Create watcher with settings to handle frequent writes
      const watcher = chokidar.watch(planPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      // Check again after the synchronous watcher creation (no await, but defensive).
      if (this.cancelledWatches.has(taskId)) {
        this.cancelledWatches.delete(taskId);
        await watcher.close();
        return;
      }

      // Store watcher info
      this.watchers.set(taskId, {
        taskId,
        watcher,
        planPath
      });

      // Handle file changes
      watcher.on('change', () => {
        try {
          const content = readFileSync(planPath, 'utf-8');
          const plan: ImplementationPlan = JSON.parse(content);
          this.emit('progress', taskId, plan);
        } catch {
          // File might be in the middle of being written
          // Ignore parse errors, next change event will have complete file
        }
      });

      // Handle errors
      watcher.on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('error', taskId, message);
      });

      // Read and emit initial state
      try {
        const content = readFileSync(planPath, 'utf-8');
        const plan: ImplementationPlan = JSON.parse(content);
        this.emit('progress', taskId, plan);
      } catch {
        // Initial read failed - not critical
      }
    } finally {
      // Only clean up if this call still owns the entry. If a superseding
      // concurrent watch() call has already updated pendingWatches with a
      // different specDir, leave that entry intact so the superseding call
      // can proceed correctly.
      if (this.pendingWatches.get(taskId) === specDir) {
        this.pendingWatches.delete(taskId);
        // The delete above guarantees has() is now false, so there is no
        // longer any in-flight watch() for this taskId. Clear the
        // cancellation flag so it doesn't linger for future watch() calls.
        this.cancelledWatches.delete(taskId);
      }
    }
  }

  /**
   * Stop watching a task
   */
  async unwatch(taskId: string): Promise<void> {
    // If watch() is currently in-flight for this taskId, it is already closing the
    // existing watcher. Just set the cancellation flag and return to avoid a
    // double-close of the same FSWatcher.
    if (this.pendingWatches.has(taskId)) {
      this.cancelledWatches.add(taskId);
      return;
    }
    const watcherInfo = this.watchers.get(taskId);
    if (watcherInfo) {
      await watcherInfo.watcher.close();
      this.watchers.delete(taskId);
    }
  }

  /**
   * Stop all watchers
   */
  async unwatchAll(): Promise<void> {
    // Cancel any in-flight watch() calls so they don't create new watchers
    // after this cleanup completes.
    for (const taskId of this.pendingWatches.keys()) {
      this.cancelledWatches.add(taskId);
    }
    this.pendingWatches.clear();
    // Clear cancellation flags now that pendingWatches is empty: the in-flight
    // calls will bail via the supersession check (pendingWatches.get() returns
    // undefined) and will not clean up cancelledWatches themselves. Clearing
    // here ensures the instance is fully reset for subsequent use.
    this.cancelledWatches.clear();
    const closePromises = Array.from(this.watchers.values()).map(
      async (info) => {
        await info.watcher.close();
      }
    );
    await Promise.all(closePromises);
    this.watchers.clear();
  }

  /**
   * Check if a task is being watched
   */
  isWatching(taskId: string): boolean {
    return this.watchers.has(taskId);
  }

  /**
   * Get the spec directory currently being watched for a task
   */
  getWatchedSpecDir(taskId: string): string | null {
    const watcherInfo = this.watchers.get(taskId);
    if (!watcherInfo) return null;
    return path.dirname(watcherInfo.planPath);
  }

  /**
   * Get current plan state for a task
   */
  getCurrentPlan(taskId: string): ImplementationPlan | null {
    const watcherInfo = this.watchers.get(taskId);
    if (!watcherInfo) return null;

    try {
      const content = readFileSync(watcherInfo.planPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const fileWatcher = new FileWatcher();
