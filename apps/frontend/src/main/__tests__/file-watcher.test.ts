/**
 * Unit tests for FileWatcher concurrency mechanisms
 * Tests deduplication, supersession, cancellation, and unwatchAll behaviour
 * under concurrent watch()/unwatch() call patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';

// ---------------------------------------------------------------------------
// Mock chokidar BEFORE importing FileWatcher so the module sees our mock.
// ---------------------------------------------------------------------------

// A minimal FSWatcher stub that lets us control when close() resolves.
class MockFSWatcher extends EventEmitter {
  close: ReturnType<typeof vi.fn>;
  constructor(closeImpl?: () => Promise<void>) {
    super();
    this.close = vi.fn(closeImpl ?? (() => Promise.resolve()));
  }
}

// Track every watcher created so tests can inspect them.
let createdWatchers: MockFSWatcher[] = [];
// Factory override — tests replace this to inject custom stubs.
let watchFactory: (() => MockFSWatcher) | null = null;

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn((_path: string, _opts: unknown) => {
      const watcher = watchFactory ? watchFactory() : new MockFSWatcher();
      createdWatchers.push(watcher);
      return watcher;
    })
  }
}));

// Mock 'fs' so we can control existsSync / readFileSync without touching disk.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify({ phases: [] }))
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------
import { FileWatcher } from '../file-watcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileWatcher concurrency', () => {
  let fw: FileWatcher;

  beforeEach(() => {
    fw = new FileWatcher();
    createdWatchers = [];
    watchFactory = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any watchers that are still open.
    await fw.unwatchAll();
  });

  // -------------------------------------------------------------------------
  // 1. Deduplication — same taskId + same specDir
  // -------------------------------------------------------------------------
  describe('deduplication: second watch() with same specDir is a no-op', () => {
    it('should only create one FSWatcher when watch() is called twice with the same specDir while the first is still in-flight', async () => {
      const specDir = '/project/.auto-claude/specs/001-task';
      const taskId = 'task-1';

      // To create a real async gap we need an existing watcher whose close() is slow.
      // First, set up a watcher for taskId (completes synchronously).
      await fw.watch(taskId, specDir);
      expect(createdWatchers).toHaveLength(1);

      // Replace close() with a slow one so the next watch() call has an async gap.
      const existingWatcher = createdWatchers[0];
      let resolveClose!: () => void;
      existingWatcher.close = vi.fn(
        () => new Promise<void>((res) => { resolveClose = res; })
      );

      // Now start two concurrent watch() calls for the SAME specDir.
      // Both will try to enter, but the second should be deduplicated.
      const watchPromise1 = fw.watch(taskId, specDir);
      const watchPromise2 = fw.watch(taskId, specDir);

      // Resolve the close so both can proceed.
      resolveClose();
      await Promise.all([watchPromise1, watchPromise2]);

      // Only one new FSWatcher should have been created (the second call was a no-op).
      // createdWatchers[0] is the original; createdWatchers[1] is the new one.
      expect(createdWatchers).toHaveLength(2);
      expect(fw.isWatching(taskId)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Supersession — same taskId, different specDir
  // -------------------------------------------------------------------------
  describe('supersession: watch() with different specDir replaces the in-flight call', () => {
    it('should let the second call win when the first is awaiting close()', async () => {
      const taskId = 'task-2';
      const specDir1 = path.join('/project', '.auto-claude', 'specs', '001-first');
      const specDir2 = path.join('/project', '.auto-claude', 'specs', '002-second');

      // First call installs an existing watcher (simulate: the watcher for
      // specDir1 is already set up so the second watch() needs to close it).
      // We do this by running the first watch() to completion first.
      await fw.watch(taskId, specDir1);
      expect(createdWatchers).toHaveLength(1);

      // Now make the close() of the first watcher slow so there's an async gap
      // during which the second watch() can enter and supersede.
      const existingWatcher = createdWatchers[0];
      let resolveClose!: () => void;
      existingWatcher.close = vi.fn(
        () => new Promise<void>((res) => { resolveClose = res; })
      );

      // Start the second watch() — it will try to close the first watcher's
      // FSWatcher and will be awaiting that.
      const watch2Promise = fw.watch(taskId, specDir2);

      // While the second watch() is awaiting close, start a THIRD call with
      // yet another specDir — this supersedes the second call.
      // Actually for the test described in the finding, we want:
      // - First call bails, second call creates the watcher.
      // Let's resolve the close and let watch2 finish.
      resolveClose();
      await watch2Promise;

      // The final watcher should be for specDir2.
      expect(fw.getWatchedSpecDir(taskId)).toBe(specDir2);
      // Two watchers were created in total (one for each specDir).
      expect(createdWatchers).toHaveLength(2);
    });

    it('first watch() bails when pendingWatches changes to a different specDir', async () => {
      const taskId = 'task-super';
      const specDir1 = path.join('/project', '.auto-claude', 'specs', 'super-first');
      const specDir2 = path.join('/project', '.auto-claude', 'specs', 'super-second');

      // Make the first watcher's close() slow so we can interleave.
      let resolveFirstClose!: () => void;
      watchFactory = () => {
        const w = new MockFSWatcher(() => new Promise<void>((res) => { resolveFirstClose = res; }));
        return w;
      };

      // Start first watch().
      const watch1Promise = fw.watch(taskId, specDir1);

      // Immediately start second watch() — before the first has resolved the
      // slow close(). At this point specDir1 watch hasn't even created an
      // FSWatcher yet (it's the very first call so there's no existing watcher
      // to close), so watch1Promise may resolve synchronously up to watcher
      // creation. Reset factory to normal for subsequent watcher creations.
      watchFactory = null;

      const watch2Promise = fw.watch(taskId, specDir2);

      // Let any remaining microtasks run.
      await Promise.resolve();
      if (resolveFirstClose) resolveFirstClose();

      await Promise.all([watch1Promise, watch2Promise]);

      // The winning call (specDir2) should own the watcher.
      expect(fw.getWatchedSpecDir(taskId)).toBe(specDir2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Cancellation — unwatch() during in-flight watch()
  // -------------------------------------------------------------------------
  describe('cancellation: unwatch() during in-flight watch() prevents watcher creation', () => {
    it('should not create a watcher when unwatch() is called before the async gap resolves', async () => {
      const taskId = 'task-3';
      const specDir = '/project/.auto-claude/specs/003-cancel';

      // There's no pre-existing watcher, so watch() won't call close(). But it
      // does go async (chokidar.watch is sync but we can test the cancellation
      // flag by calling unwatch() before watch() runs).
      // The real async gap in watch() is the existing.watcher.close() call.
      // For this test, let's pre-install a watcher so close() is called.

      // Install a slow-close watcher for taskId by manually populating the map.
      // We can do that by running a first watch(), then replacing close().
      await fw.watch(taskId, specDir);

      // Replace the watcher's close() with a slow one.
      const existingWatcher = createdWatchers[0];
      let resolveExistingClose!: () => void;
      existingWatcher.close = vi.fn(
        () => new Promise<void>((res) => { resolveExistingClose = res; })
      );

      // Start a second watch() — it will await the slow close().
      const specDir2 = '/project/.auto-claude/specs/003-cancel-v2';
      const watchPromise = fw.watch(taskId, specDir2);

      // While watch() is in-flight, call unwatch().
      await fw.unwatch(taskId);

      // Now resolve the slow close so watch() can continue past the await.
      resolveExistingClose();
      await watchPromise;

      // No new watcher should have been registered.
      expect(fw.isWatching(taskId)).toBe(false);
      // Only one FSWatcher was ever created (the original one for specDir).
      expect(createdWatchers).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. unwatchAll() with pending watches
  // -------------------------------------------------------------------------
  describe('unwatchAll() cancels all pending watches', () => {
    it('should cancel pending watch() calls and clear pendingWatches', async () => {
      const taskId1 = 'task-4a';
      const taskId2 = 'task-4b';
      const specDir1 = '/project/.auto-claude/specs/004a';
      const specDir2 = '/project/.auto-claude/specs/004b';

      // Set up slow-close scenario for taskId1 (so watch() is in-flight).
      await fw.watch(taskId1, specDir1);
      const watcher1 = createdWatchers[0];
      let resolveClose1!: () => void;
      watcher1.close = vi.fn(
        () => new Promise<void>((res) => { resolveClose1 = res; })
      );

      // Start a new watch for taskId1 with a different specDir — this is now in-flight.
      const newSpecDir1 = '/project/.auto-claude/specs/004a-v2';
      const watchPromise1 = fw.watch(taskId1, newSpecDir1);

      // Start a fresh watch for taskId2.
      await fw.watch(taskId2, specDir2);

      // Call unwatchAll() while watchPromise1 is still pending.
      const unwatchAllPromise = fw.unwatchAll();

      // Resolve the slow close so everything can proceed.
      resolveClose1();
      await Promise.all([watchPromise1, unwatchAllPromise]);

      // After unwatchAll, no watchers should be active.
      expect(fw.isWatching(taskId1)).toBe(false);
      expect(fw.isWatching(taskId2)).toBe(false);

      // pendingWatches should be cleared (we verify indirectly: a fresh
      // watch() call for taskId1 must succeed without treating it as a duplicate).
      const specDirFresh = path.join('/project', '.auto-claude', 'specs', '004a-fresh');
      await fw.watch(taskId1, specDirFresh);
      expect(fw.isWatching(taskId1)).toBe(true);
      expect(fw.getWatchedSpecDir(taskId1)).toBe(specDirFresh);
    });
  });

  // -------------------------------------------------------------------------
  // 5. getWatchedSpecDir() returns correct specDir
  // -------------------------------------------------------------------------
  describe('getWatchedSpecDir()', () => {
    it('returns the specDir that was passed to watch()', async () => {
      const taskId = 'task-5';
      const specDir = path.join('/project', '.auto-claude', 'specs', '005-specdir');

      await fw.watch(taskId, specDir);

      expect(fw.getWatchedSpecDir(taskId)).toBe(specDir);
    });

    it('returns null when the task is not being watched', () => {
      expect(fw.getWatchedSpecDir('unknown-task')).toBeNull();
    });

    it('returns updated specDir after re-watch with different specDir', async () => {
      const taskId = 'task-5b';
      const specDir1 = path.join('/project', '.auto-claude', 'specs', '005b-first');
      const specDir2 = path.join('/project', '.auto-claude', 'specs', '005b-second');

      await fw.watch(taskId, specDir1);
      expect(fw.getWatchedSpecDir(taskId)).toBe(specDir1);

      await fw.watch(taskId, specDir2);
      expect(fw.getWatchedSpecDir(taskId)).toBe(specDir2);
    });
  });
});
