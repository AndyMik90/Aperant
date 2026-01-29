/**
 * Worktree Backend Detection
 * ===========================
 *
 * This module MUST be imported before any other modules that might
 * initialize PythonEnvManager or create singletons that use the backend path.
 *
 * When running from a git worktree, we need to use the worktree's backend
 * instead of the main repo's backend. This module detects the worktree and
 * sets a global path that other modules can check.
 */

import { join } from 'path';

export function detectWorktreeBackendSync(): string | undefined {
  const currentPath = process.cwd();
  if (currentPath.includes('/.auto-claude/worktrees/') || currentPath.includes('\\.auto-claude\\worktrees\\')) {
    const worktreeRootMatch = currentPath.match(/(.*\/\.auto-claude\/worktrees\/.+)$/);
    if (worktreeRootMatch) {
      let worktreeRoot = worktreeRootMatch[1];
      if (worktreeRoot.endsWith('/apps/frontend')) {
        worktreeRoot = worktreeRoot.slice(0, -'/apps/frontend'.length);
      }
      const worktreeBackendPath = join(worktreeRoot, 'apps', 'backend');
      console.log('[worktree-backend] Worktree detected at startup, backend:', worktreeBackendPath);
      return worktreeBackendPath;
    }
  }
  return undefined;
}

// Set global worktree backend path IMMEDIATELY when this module is imported
// This happens before any other module imports if this is imported first in index.ts
const worktreeBackend = detectWorktreeBackendSync();
if (worktreeBackend) {
  (globalThis as any).WORKTREE_BACKEND_PATH = worktreeBackend;
  console.log('[worktree-backend] Set global WORKTREE_BACKEND_PATH:', worktreeBackend);
}

export { worktreeBackend };
