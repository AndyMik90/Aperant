import { create } from 'zustand';
import type { IssueDependencies } from '@shared/types/dependencies';
import type { TriageMetrics, MetricsTimeWindow } from '@shared/types/metrics';
import { createEmptyDependencies } from '@shared/types/dependencies';
import { createEmptyMetrics } from '@shared/types/metrics';

interface Phase4State {
  // Dependencies (per-issue cache)
  dependencies: Record<number, IssueDependencies>;
  dependencyLoading: Record<number, boolean>;
  dependencyErrors: Record<number, string>;

  // Metrics
  metrics: TriageMetrics;
  metricsTimeWindow: MetricsTimeWindow;
  metricsLoading: boolean;
  metricsError: string | null;

  // Triage mode
  triageModeEnabled: boolean;

  // Dependency actions
  setDependencies: (issueNumber: number, deps: IssueDependencies) => void;
  setDependencyLoading: (issueNumber: number, loading: boolean) => void;
  setDependencyError: (issueNumber: number, error: string) => void;
  clearDependencies: () => void;

  // Metrics actions
  setMetrics: (metrics: TriageMetrics) => void;
  setMetricsTimeWindow: (window: MetricsTimeWindow) => void;
  setMetricsLoading: (loading: boolean) => void;
  setMetricsError: (error: string | null) => void;

  // Triage mode actions
  setTriageModeEnabled: (enabled: boolean) => void;

  // Selectors
  getDependencies: (issueNumber: number) => IssueDependencies;
  isDependencyLoading: (issueNumber: number) => boolean;
}

export const usePhase4Store = create<Phase4State>((set, get) => ({
  // Initial state
  dependencies: {},
  dependencyLoading: {},
  dependencyErrors: {},
  metrics: createEmptyMetrics(),
  metricsTimeWindow: '30d',
  metricsLoading: false,
  metricsError: null,
  triageModeEnabled: false,

  // Dependency actions
  setDependencies: (issueNumber, deps) =>
    set((state) => {
      const { [issueNumber]: _removedError, ...remainingErrors } = state.dependencyErrors;
      return {
        dependencies: { ...state.dependencies, [issueNumber]: deps },
        dependencyLoading: { ...state.dependencyLoading, [issueNumber]: false },
        dependencyErrors: remainingErrors,
      };
    }),

  setDependencyLoading: (issueNumber, loading) =>
    set((state) => ({
      dependencyLoading: { ...state.dependencyLoading, [issueNumber]: loading },
    })),

  setDependencyError: (issueNumber, error) =>
    set((state) => ({
      dependencyErrors: { ...state.dependencyErrors, [issueNumber]: error },
      dependencyLoading: { ...state.dependencyLoading, [issueNumber]: false },
    })),

  clearDependencies: () => set({ dependencies: {}, dependencyLoading: {}, dependencyErrors: {} }),

  // Metrics actions
  setMetrics: (metrics) => set({ metrics, metricsLoading: false, metricsError: null }),
  setMetricsTimeWindow: (metricsTimeWindow) => set({ metricsTimeWindow }),
  setMetricsLoading: (metricsLoading) => set({ metricsLoading }),
  setMetricsError: (metricsError) => set({ metricsError, metricsLoading: false }),

  // Triage mode actions
  setTriageModeEnabled: (triageModeEnabled) => set({ triageModeEnabled }),

  // Selectors
  getDependencies: (issueNumber) => get().dependencies[issueNumber] ?? createEmptyDependencies(),
  isDependencyLoading: (issueNumber) => get().dependencyLoading[issueNumber] ?? false,
}));
