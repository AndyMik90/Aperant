import { useEffect, useCallback } from 'react';
import {
  loadProjectContext,
  refreshProjectIndex,
  searchMemories,
  useContextStore
} from '../../stores/context-store';

export function useProjectContext(projectId: string) {
  useEffect(() => {
    if (projectId) {
      loadProjectContext(projectId);
    }
  }, [projectId]);
}

export function useRefreshIndex(projectId: string) {
  return useCallback(async (force?: boolean) => {
    await refreshProjectIndex(projectId, force);
  }, [projectId]);
}

export function useMemorySearch(projectId: string) {
  return async (query: string) => {
    if (query.trim()) {
      await searchMemories(projectId, query);
    }
  };
}

/**
 * Listen for index progress events from main process
 */
export function useIndexProgress() {
  const setIndexProgress = useContextStore((s) => s.setIndexProgress);

  useEffect(() => {
    const cleanup = window.electronAPI.onIndexProgress((data) => {
      setIndexProgress(data.message || null, data.current, data.total);
    });
    return cleanup;
  }, [setIndexProgress]);
}
