import { create } from 'zustand';
import type {
  GitLabMRReviewProgress,
  GitLabMRReviewResult,
  GitLabNewCommitsCheck
} from '../../../shared/types';

/**
 * MR review state for a single MR
 */
interface MRReviewState {
  mrIid: number;
  projectId: string;
  isReviewing: boolean;
  progress: GitLabMRReviewProgress | null;
  result: GitLabMRReviewResult | null;
  error: string | null;
  /** Cached result of new commits check - updated when detail view checks */
  newCommitsCheck: GitLabNewCommitsCheck | null;
}

interface MRReviewStoreState {
  // MR Review state - persists across navigation
  // Key: `${projectId}:${mrIid}`
  mrReviews: Record<string, MRReviewState>;

  // Actions
  startMRReview: (projectId: string, mrIid: number) => void;
  setMRReviewProgress: (projectId: string, progress: GitLabMRReviewProgress) => void;
  setMRReviewResult: (projectId: string, result: GitLabMRReviewResult) => void;
  setMRReviewError: (projectId: string, mrIid: number, error: string) => void;
  setNewCommitsCheck: (projectId: string, mrIid: number, check: GitLabNewCommitsCheck) => void;
  clearMRReview: (projectId: string, mrIid: number) => void;

  // Selectors
  getMRReviewState: (projectId: string, mrIid: number) => MRReviewState | null;
  getActiveMRReviews: (projectId: string) => MRReviewState[];
}

export const useMRReviewStore = create<MRReviewStoreState>((set, get) => ({
  // Initial state
  mrReviews: {},

  // Actions
  startMRReview: (projectId: string, mrIid: number) => set((state) => {
    const key = `${projectId}:${mrIid}`;
    const existing = state.mrReviews[key];
    return {
      mrReviews: {
        ...state.mrReviews,
        [key]: {
          mrIid,
          projectId,
          isReviewing: true,
          progress: null,
          result: null,
          error: null,
          newCommitsCheck: existing?.newCommitsCheck ?? null
        }
      }
    };
  }),

  setMRReviewProgress: (projectId: string, progress: GitLabMRReviewProgress) => set((state) => {
    const key = `${projectId}:${progress.mrIid}`;
    const existing = state.mrReviews[key];
    return {
      mrReviews: {
        ...state.mrReviews,
        [key]: {
          mrIid: progress.mrIid,
          projectId,
          isReviewing: true,
          progress,
          result: existing?.result ?? null,
          error: null,
          newCommitsCheck: existing?.newCommitsCheck ?? null
        }
      }
    };
  }),

  setMRReviewResult: (projectId: string, result: GitLabMRReviewResult) => set((state) => {
    const key = `${projectId}:${result.mrIid}`;
    return {
      mrReviews: {
        ...state.mrReviews,
        [key]: {
          mrIid: result.mrIid,
          projectId,
          isReviewing: false,
          progress: null,
          result,
          error: null,
          // Clear new commits check when review completes (it was just reviewed)
          newCommitsCheck: null
        }
      }
    };
  }),

  setMRReviewError: (projectId: string, mrIid: number, error: string) => set((state) => {
    const key = `${projectId}:${mrIid}`;
    const existing = state.mrReviews[key];
    return {
      mrReviews: {
        ...state.mrReviews,
        [key]: {
          mrIid,
          projectId,
          isReviewing: false,
          progress: null,
          result: existing?.result ?? null,
          error,
          newCommitsCheck: existing?.newCommitsCheck ?? null
        }
      }
    };
  }),

  setNewCommitsCheck: (projectId: string, mrIid: number, check: GitLabNewCommitsCheck) => set((state) => {
    const key = `${projectId}:${mrIid}`;
    const existing = state.mrReviews[key];
    if (!existing) {
      // Create a minimal state if none exists
      return {
        mrReviews: {
          ...state.mrReviews,
          [key]: {
            mrIid,
            projectId,
            isReviewing: false,
            progress: null,
            result: null,
            error: null,
            newCommitsCheck: check
          }
        }
      };
    }
    return {
      mrReviews: {
        ...state.mrReviews,
        [key]: {
          ...existing,
          newCommitsCheck: check
        }
      }
    };
  }),

  clearMRReview: (projectId: string, mrIid: number) => set((state) => {
    const key = `${projectId}:${mrIid}`;
    const { [key]: _, ...rest } = state.mrReviews;
    return { mrReviews: rest };
  }),

  // Selectors
  getMRReviewState: (projectId: string, mrIid: number) => {
    const { mrReviews } = get();
    const key = `${projectId}:${mrIid}`;
    return mrReviews[key] ?? null;
  },

  getActiveMRReviews: (projectId: string) => {
    const { mrReviews } = get();
    return Object.values(mrReviews).filter(
      review => review.projectId === projectId && review.isReviewing
    );
  }
}));

/**
 * Global IPC listener setup for MR reviews.
 * Call this once at app startup to ensure MR review events are captured
 * regardless of which component is mounted.
 */
let mrReviewListenersInitialized = false;
let cleanupFunctions: (() => void)[] = [];

export function initializeMRReviewListeners(): void {
  if (mrReviewListenersInitialized) {
    return;
  }

  const store = useMRReviewStore.getState();

  // Check if GitLab MR Review API is available
  if (!window.electronAPI?.onGitLabMRReviewProgress) {
    console.warn('[GitLab MR Store] GitLab MR Review API not available, skipping listener setup');
    return;
  }

  // Listen for MR review progress events
  const progressHandler = (projectId: string, progress: GitLabMRReviewProgress) => {
    store.setMRReviewProgress(projectId, progress);
  };
  const progressUnsubscribe = window.electronAPI.onGitLabMRReviewProgress(progressHandler);
  if (typeof progressUnsubscribe === 'function') {
    cleanupFunctions.push(progressUnsubscribe);
  }

  // Listen for MR review completion events
  const completeHandler = (projectId: string, result: GitLabMRReviewResult) => {
    store.setMRReviewResult(projectId, result);
  };
  const completeUnsubscribe = window.electronAPI.onGitLabMRReviewComplete(completeHandler);
  if (typeof completeUnsubscribe === 'function') {
    cleanupFunctions.push(completeUnsubscribe);
  }

  // Listen for MR review error events
  const errorHandler = (projectId: string, data: { mrIid: number; error: string }) => {
    store.setMRReviewError(projectId, data.mrIid, data.error);
  };
  const errorUnsubscribe = window.electronAPI.onGitLabMRReviewError(errorHandler);
  if (typeof errorUnsubscribe === 'function') {
    cleanupFunctions.push(errorUnsubscribe);
  }

  // Fallback: Store cleanup functions if the API supports removeListener methods
  // Note: These are optional methods that may not exist in the ElectronAPI
  const api = window.electronAPI as unknown as Record<string, unknown>;
  if (typeof api.removeGitLabMRReviewProgress === 'function') {
    cleanupFunctions.push(() => (api.removeGitLabMRReviewProgress as (handler: unknown) => void)?.(progressHandler));
  }
  if (typeof api.removeGitLabMRReviewComplete === 'function') {
    cleanupFunctions.push(() => (api.removeGitLabMRReviewComplete as (handler: unknown) => void)?.(completeHandler));
  }
  if (typeof api.removeGitLabMRReviewError === 'function') {
    cleanupFunctions.push(() => (api.removeGitLabMRReviewError as (handler: unknown) => void)?.(errorHandler));
  }

  mrReviewListenersInitialized = true;
}

/**
 * Cleanup MR review listeners.
 * Call this when the app is being unmounted or during hot-reload.
 */
export function cleanupMRReviewListeners(): void {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupFunctions = [];
  mrReviewListenersInitialized = false;
}

/**
 * Start an MR review and track it in the store
 */
export function startMRReview(projectId: string, mrIid: number): void {
  const store = useMRReviewStore.getState();
  store.startMRReview(projectId, mrIid);
  window.electronAPI.runGitLabMRReview(projectId, mrIid);
}

/**
 * Start a follow-up MR review and track it in the store
 */
export function startFollowupReview(projectId: string, mrIid: number): void {
  const store = useMRReviewStore.getState();
  store.startMRReview(projectId, mrIid);
  window.electronAPI.runGitLabMRFollowupReview(projectId, mrIid);
}
