import { create } from 'zustand';
import type {
  PRFixLoopState,
  PRFixLoopProgress,
  PRFixLoopResult,
  PRFixLoopStatePayload
} from '../../../preload/api/modules/github-api';

interface StoredPRFixLoopState {
  prNumber: number;
  projectId: string;
  state: PRFixLoopState;
  isRunning: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  iteration: number;
  maxIterations: number;
  progress: PRFixLoopProgress | null;
  result: PRFixLoopResult | null;
  error: string | null;
  lastCommitSha: string | null;
  lastParentSha: string | null;
  lastAttemptSignature: string | null;
}

interface PRFixLoopStoreState {
  prFixLoops: Record<string, StoredPRFixLoopState>;
  handlePRFixLoopStateChange: (key: string, payload: PRFixLoopStatePayload) => void;
  getPRFixLoopState: (projectId: string, prNumber: number) => StoredPRFixLoopState | null;
}

export const usePRFixLoopStore = create<PRFixLoopStoreState>((set, get) => ({
  prFixLoops: {},

  handlePRFixLoopStateChange: (key: string, payload: PRFixLoopStatePayload) => {
    set((state) => ({
      prFixLoops: {
        ...state.prFixLoops,
        [key]: {
          prNumber: payload.prNumber,
          projectId: payload.projectId,
          state: payload.state,
          isRunning: payload.isRunning,
          startedAt: payload.startedAt,
          updatedAt: payload.updatedAt,
          iteration: payload.iteration,
          maxIterations: payload.maxIterations,
          progress: payload.progress,
          result: payload.result,
          error: payload.error,
          lastCommitSha: payload.lastCommitSha,
          lastParentSha: payload.lastParentSha,
          lastAttemptSignature: payload.lastAttemptSignature
        }
      }
    }));
  },

  getPRFixLoopState: (projectId: string, prNumber: number) => {
    const key = `${projectId}:${prNumber}`;
    return get().prFixLoops[key] ?? null;
  }
}));

let prFixLoopListenersInitialized = false;
let cleanupFunctions: Array<() => void> = [];

export function initializePRFixLoopListeners(): void {
  if (prFixLoopListenersInitialized) {
    return;
  }

  const store = usePRFixLoopStore.getState();

  if (!window.electronAPI?.github?.onPRFixLoopStateChange) {
    console.warn('[GitHub PR Fix Loop Store] API not available, skipping listener setup');
    return;
  }

  cleanupFunctions.push(
    window.electronAPI.github.onPRFixLoopStateChange((key, payload) => {
      store.handlePRFixLoopStateChange(key, payload);
    })
  );

  cleanupFunctions.push(
    window.electronAPI.github.onGitHubAuthChanged(() => {
      usePRFixLoopStore.setState({ prFixLoops: {} });
    })
  );

  prFixLoopListenersInitialized = true;
}

export function cleanupPRFixLoopListeners(): void {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors.
    }
  }
  cleanupFunctions = [];
  prFixLoopListenersInitialized = false;
}
