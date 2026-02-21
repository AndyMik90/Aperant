import { create } from 'zustand';
import type {
  PRReviewProgress,
  PRReviewResult,
  NewCommitsCheck,
  PRReviewStatePayload
} from '../../../preload/api/modules/github-api';
import type {
  ChecksStatus,
  ReviewsStatus,
  MergeableState,
  PRStatusUpdate
} from '../../../shared/types/pr-status';

/**
 * PR review state for a single PR
 */
interface PRReviewState {
  prNumber: number;
  projectId: string;
  isReviewing: boolean;
  /** Timestamp when the review was started (ISO 8601 string) */
  startedAt: string | null;
  progress: PRReviewProgress | null;
  result: PRReviewResult | null;
  /** Previous review result - preserved during follow-up review for continuity */
  previousResult: PRReviewResult | null;
  error: string | null;
  /** Cached result of new commits check - updated when detail view checks */
  newCommitsCheck: NewCommitsCheck | null;
  /** CI checks status from polling */
  checksStatus: ChecksStatus | null;
  /** Review status from polling */
  reviewsStatus: ReviewsStatus | null;
  /** Mergeable state from polling */
  mergeableState: MergeableState | null;
  /** Timestamp of last status poll (ISO 8601 string) */
  lastPolled: string | null;
  /** Whether this review was initiated externally (e.g., from PR list) rather than from detail view */
  isExternalReview: boolean;
}

interface PRReviewStoreState {
  // PR Review state - persists across navigation
  // Key: `${projectId}:${prNumber}`
  prReviews: Record<string, PRReviewState>;

  // XState state change handler
  handlePRReviewStateChange: (key: string, payload: PRReviewStatePayload) => void;

  // Kept actions (not managed by XState)
  /** Load a review result from disk into the store (not triggered by XState) */
  setLoadedReviewResult: (projectId: string, result: PRReviewResult, options?: { preserveNewCommitsCheck?: boolean }) => void;
  setNewCommitsCheck: (projectId: string, prNumber: number, check: NewCommitsCheck) => void;
  /** Update PR status from polling (CI checks, reviews, mergeability) */
  setPRStatus: (projectId: string, prNumber: number, status: {
    checksStatus: ChecksStatus;
    reviewsStatus: ReviewsStatus;
    mergeableState: MergeableState;
    lastPolled: string;
  }) => void;
  /** Clear PR status fields for a specific PR */
  clearPRStatus: (projectId: string, prNumber: number) => void;

  // Selectors
  getPRReviewState: (projectId: string, prNumber: number) => PRReviewState | null;
  getActivePRReviews: (projectId: string) => PRReviewState[];

  // Refresh callbacks - called when reviews complete
  registerRefreshCallback: (callback: () => void) => void;
  unregisterRefreshCallback: (callback: () => void) => void;
}

// Store for refresh callbacks outside of Zustand state (to avoid re-renders on registration)
const refreshCallbacks = new Set<() => void>();

export const usePRReviewStore = create<PRReviewStoreState>((set, get) => ({
  // Initial state
  prReviews: {},

  // XState state change handler — maps XState state/context back to PRReviewState shape
  handlePRReviewStateChange: (key: string, payload: PRReviewStatePayload) => {
    const isCompleted = payload.state === 'completed';

    set((state) => {
      const existing = state.prReviews[key];

      const updated: PRReviewState = {
        prNumber: payload.prNumber,
        projectId: payload.projectId,
        isReviewing: payload.state === 'reviewing' || payload.state === 'externalReview',
        startedAt: payload.startedAt,
        progress: payload.progress,
        result: payload.result,
        previousResult: payload.previousResult,
        error: payload.error,
        isExternalReview: payload.isExternalReview,
        // Preserve polling data — not managed by XState
        checksStatus: existing?.checksStatus ?? null,
        reviewsStatus: existing?.reviewsStatus ?? null,
        mergeableState: existing?.mergeableState ?? null,
        lastPolled: existing?.lastPolled ?? null,
        // Preserve newCommitsCheck unless review completed (it was just reviewed)
        newCommitsCheck: isCompleted ? null : (existing?.newCommitsCheck ?? null),
      };

      return {
        prReviews: {
          ...state.prReviews,
          [key]: updated,
        },
      };
    });

    // Trigger registered refresh callbacks when review completes
    if (isCompleted) {
      refreshCallbacks.forEach(callback => {
        Promise.resolve(callback()).catch(error => {
          console.error('[PRReviewStore] Error in refresh callback:', error);
        });
      });
    }
  },

  setLoadedReviewResult: (projectId: string, result: PRReviewResult, options?: { preserveNewCommitsCheck?: boolean }) => set((state) => {
    const key = `${projectId}:${result.prNumber}`;
    const existing = state.prReviews[key];
    // Don't overwrite active review state from XState
    if (existing?.isReviewing) {
      return state;
    }
    return {
      prReviews: {
        ...state.prReviews,
        [key]: {
          prNumber: result.prNumber,
          projectId,
          isReviewing: false,
          startedAt: null,
          progress: null,
          result,
          previousResult: existing?.previousResult ?? null,
          error: null,
          newCommitsCheck: options?.preserveNewCommitsCheck ? (existing?.newCommitsCheck ?? null) : null,
          checksStatus: existing?.checksStatus ?? null,
          reviewsStatus: existing?.reviewsStatus ?? null,
          mergeableState: existing?.mergeableState ?? null,
          lastPolled: existing?.lastPolled ?? null,
          isExternalReview: false,
        },
      },
    };
  }),

  setNewCommitsCheck: (projectId: string, prNumber: number, check: NewCommitsCheck) => set((state) => {
    const key = `${projectId}:${prNumber}`;
    const existing = state.prReviews[key];
    if (!existing) {
      // Create a minimal state if none exists
      return {
        prReviews: {
          ...state.prReviews,
          [key]: {
            prNumber,
            projectId,
            isReviewing: false,
            startedAt: null,
            progress: null,
            result: null,
            previousResult: null,
            error: null,
            newCommitsCheck: check,
            checksStatus: null,
            reviewsStatus: null,
            mergeableState: null,
            lastPolled: null,
            isExternalReview: false
          }
        }
      };
    }
    return {
      prReviews: {
        ...state.prReviews,
        [key]: {
          ...existing,
          newCommitsCheck: check
        }
      }
    };
  }),


  setPRStatus: (projectId: string, prNumber: number, status: {
    checksStatus: ChecksStatus;
    reviewsStatus: ReviewsStatus;
    mergeableState: MergeableState;
    lastPolled: string;
  }) => set((state) => {
    const key = `${projectId}:${prNumber}`;
    const existing = state.prReviews[key];
    if (!existing) {
      // Create a minimal state if none exists
      return {
        prReviews: {
          ...state.prReviews,
          [key]: {
            prNumber,
            projectId,
            isReviewing: false,
            startedAt: null,
            progress: null,
            result: null,
            previousResult: null,
            error: null,
            newCommitsCheck: null,
            checksStatus: status.checksStatus,
            reviewsStatus: status.reviewsStatus,
            mergeableState: status.mergeableState,
            lastPolled: status.lastPolled,
            isExternalReview: false
          }
        }
      };
    }
    return {
      prReviews: {
        ...state.prReviews,
        [key]: {
          ...existing,
          checksStatus: status.checksStatus,
          reviewsStatus: status.reviewsStatus,
          mergeableState: status.mergeableState,
          lastPolled: status.lastPolled
        }
      }
    };
  }),

  clearPRStatus: (projectId: string, prNumber: number) => set((state) => {
    const key = `${projectId}:${prNumber}`;
    const existing = state.prReviews[key];
    if (!existing) {
      return state;
    }
    return {
      prReviews: {
        ...state.prReviews,
        [key]: {
          ...existing,
          checksStatus: null,
          reviewsStatus: null,
          mergeableState: null,
          lastPolled: null
        }
      }
    };
  }),

  // Selectors
  getPRReviewState: (projectId: string, prNumber: number) => {
    const { prReviews } = get();
    const key = `${projectId}:${prNumber}`;
    return prReviews[key] ?? null;
  },

  getActivePRReviews: (projectId: string) => {
    const { prReviews } = get();
    return Object.values(prReviews).filter(
      review => review.projectId === projectId && review.isReviewing
    );
  },

  // Refresh callbacks - called when reviews complete
  registerRefreshCallback: (callback: () => void) => {
    refreshCallbacks.add(callback);
  },

  unregisterRefreshCallback: (callback: () => void) => {
    refreshCallbacks.delete(callback);
  }
}));

/**
 * Global IPC listener setup for PR reviews.
 * Call this once at app startup to ensure PR review events are captured
 * regardless of which component is mounted.
 */
let prReviewListenersInitialized = false;
let cleanupFunctions: (() => void)[] = [];

export function initializePRReviewListeners(): void {
  if (prReviewListenersInitialized) {
    return;
  }

  const store = usePRReviewStore.getState();

  // Check if GitHub PR Review API is available
  if (!window.electronAPI?.github?.onPRReviewStateChange) {
    console.warn('[GitHub PR Store] GitHub PR Review API not available, skipping listener setup');
    return;
  }

  // Listen for XState state changes — single handler replaces progress/complete/error listeners
  const cleanupStateChange = window.electronAPI.github.onPRReviewStateChange(
    (key: string, payload: PRReviewStatePayload) => {
      store.handlePRReviewStateChange(key, payload);
    }
  );
  cleanupFunctions.push(cleanupStateChange);

  // Listen for GitHub auth changes - clear all PR review state when account changes
  const cleanupAuthChanged = window.electronAPI.github.onGitHubAuthChanged(
    (data: { oldUsername: string | null; newUsername: string }) => {
      console.warn(
        `[PRReviewStore] GitHub auth changed from "${data.oldUsername ?? 'none'}" to "${data.newUsername}". ` +
        `Clearing all PR review state.`
      );
      // Clear all PR review state since the token has changed
      usePRReviewStore.setState({ prReviews: {} });
    }
  );
  cleanupFunctions.push(cleanupAuthChanged);

  // Listen for PR status polling updates (CI checks, reviews, mergeability)
  const cleanupStatusUpdate = window.electronAPI.github.onPRStatusUpdate(
    (update: PRStatusUpdate) => {
      const { projectId, statuses } = update;
      for (const status of statuses) {
        store.setPRStatus(projectId, status.prNumber, {
          checksStatus: status.checksStatus,
          reviewsStatus: status.reviewsStatus,
          mergeableState: status.mergeableState,
          lastPolled: status.lastPolled ?? new Date().toISOString()
        });
      }
    }
  );
  cleanupFunctions.push(cleanupStatusUpdate);

  prReviewListenersInitialized = true;
}

/**
 * Cleanup PR review listeners.
 * Call this when the app is being unmounted or during hot-reload.
 */
export function cleanupPRReviewListeners(): void {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupFunctions = [];
  refreshCallbacks.clear();
  prReviewListenersInitialized = false;
}
