import { useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { usePhase4Store } from '../../../stores/github/phase4-store';
import type { IssueDependencies } from '@shared/types/dependencies';

const EMPTY_DEPS: IssueDependencies = { tracks: [], trackedBy: [] };

export function useDependencies(issueNumber: number | null) {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const depsMap = usePhase4Store((s) => s.dependencies);
  const loadingMap = usePhase4Store((s) => s.dependencyLoading);
  const errorsMap = usePhase4Store((s) => s.dependencyErrors);

  const dependencies = useMemo(
    () => (issueNumber ? depsMap[issueNumber] ?? EMPTY_DEPS : EMPTY_DEPS),
    [issueNumber, depsMap],
  );

  const isLoading = issueNumber ? loadingMap[issueNumber] ?? false : false;
  const error = issueNumber ? errorsMap[issueNumber] ?? null : null;

  const fetchDependencies = useCallback(async (force = false) => {
    if (!projectId || !issueNumber) return;

    const state = usePhase4Store.getState();
    if (!force) {
      if (state.dependencyLoading[issueNumber]) return;
      if (state.dependencies[issueNumber]) return;
    }

    usePhase4Store.getState().setDependencyLoading(issueNumber, true);
    try {
      const result = await window.electronAPI.github.fetchDependencies(projectId, issueNumber);
      if (result.error) {
        usePhase4Store.getState().setDependencyError(issueNumber, result.error);
      } else {
        usePhase4Store.getState().setDependencies(issueNumber, {
          tracks: result.tracks,
          trackedBy: result.trackedBy,
        });
      }
    } catch (err) {
      usePhase4Store.getState().setDependencyError(
        issueNumber,
        err instanceof Error ? err.message : 'Failed to fetch dependencies',
      );
    }
  }, [projectId, issueNumber]);

  // Auto-fetch when issue changes
  useEffect(() => {
    if (issueNumber && projectId) {
      fetchDependencies();
    }
  }, [issueNumber, projectId, fetchDependencies]);

  return {
    dependencies,
    isLoading,
    error,
    refetch: () => fetchDependencies(true),
  };
}
