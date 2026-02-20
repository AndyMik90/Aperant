import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  PRData,
  PRReviewResult,
  PRReviewProgress,
  NewCommitsCheck,
} from "../../../../preload/api/modules/github-api";
import {
  usePRReviewStore,
  startPRReview as storeStartPRReview,
  startFollowupReview as storeStartFollowupReview,
} from "../../../stores/github";

// Re-export types for consumers
export type { PRData, PRReviewResult, PRReviewProgress };
export type { PRReviewFinding } from "../../../../preload/api/modules/github-api";

interface UseGitHubPRsOptions {
  /** Whether the component is currently active/visible */
  isActive?: boolean;
}

interface UseGitHubPRsResult {
  prs: PRData[];
  isLoading: boolean;
  isLoadingMore: boolean; // Loading additional PRs via pagination
  isLoadingPRDetails: boolean; // Loading full PR details including files
  error: string | null;
  selectedPR: PRData | null;
  selectedPRNumber: number | null;
  reviewResult: PRReviewResult | null;
  reviewProgress: PRReviewProgress | null;
  startedAt: string | null;
  isReviewing: boolean;
  isExternalReview: boolean;
  previousReviewResult: PRReviewResult | null;
  reviewError: string | null;
  isConnected: boolean;
  repoFullName: string | null;
  activePRReviews: number[]; // PR numbers currently being reviewed
  hasMore: boolean; // True when 100 PRs returned (GitHub limit) - more may exist
  selectPR: (prNumber: number | null) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>; // Load next page of PRs
  runReview: (prNumber: number) => void;
  runFollowupReview: (prNumber: number) => void;
  checkNewCommits: (prNumber: number) => Promise<NewCommitsCheck>;
  cancelReview: (prNumber: number) => Promise<boolean>;
  postReview: (
    prNumber: number,
    selectedFindingIds?: string[],
    options?: { forceApprove?: boolean }
  ) => Promise<boolean>;
  postComment: (prNumber: number, body: string) => Promise<boolean>;
  mergePR: (prNumber: number, mergeMethod?: "merge" | "squash" | "rebase") => Promise<boolean>;
  assignPR: (prNumber: number, username: string) => Promise<boolean>;
  markReviewPosted: (prNumber: number) => Promise<void>;
  getReviewStateForPR: (prNumber: number) => {
    isReviewing: boolean;
    startedAt: string | null;
    progress: PRReviewProgress | null;
    result: PRReviewResult | null;
    previousResult: PRReviewResult | null;
    error: string | null;
    newCommitsCheck?: NewCommitsCheck | null;
  } | null;
}

export function useGitHubPRs(
  projectId?: string,
  options: UseGitHubPRsOptions = {}
): UseGitHubPRsResult {
  const { isActive = true } = options;
  const [prs, setPrs] = useState<PRData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPRDetails, setIsLoadingPRDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPRNumber, setSelectedPRNumber] = useState<number | null>(null);
  const [selectedPRDetails, setSelectedPRDetails] = useState<PRData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);

  // Track previous isActive state to detect tab navigation
  const wasActiveRef = useRef(isActive);
  // Track if initial load has happened
  const hasLoadedRef = useRef(false);
  // Track the current PR being fetched (for race condition prevention)
  const currentFetchPRNumberRef = useRef<number | null>(null);
  // AbortController for cancelling pending checkNewCommits calls on rapid PR switching
  const checkNewCommitsAbortRef = useRef<AbortController | null>(null);
  // Track current projectId for staleness checks in async operations
  const currentProjectIdRef = useRef(projectId);
  // Counter to detect stale loadMore responses after a refresh
  const fetchGenerationRef = useRef(0);

  // Get PR review state from the global store
  const prReviews = usePRReviewStore((state) => state.prReviews);
  const getPRReviewState = usePRReviewStore((state) => state.getPRReviewState);
  const setNewCommitsCheckAction = usePRReviewStore((state) => state.setNewCommitsCheck);
  const registerRefreshCallback = usePRReviewStore((state) => state.registerRefreshCallback);
  const unregisterRefreshCallback = usePRReviewStore((state) => state.unregisterRefreshCallback);

  // Get review state for the selected PR from the store - optimized with targeted selector
  // Only subscribes to changes for this specific PR, not all PRs
  const selectedPRReviewState = usePRReviewStore((state) => {
    if (!projectId || selectedPRNumber === null) return null;
    const key = `${projectId}:${selectedPRNumber}`;
    return state.prReviews[key] || null;
  });

  // Derive values from store state - all from the same source to ensure consistency
  const reviewResult = selectedPRReviewState?.result ?? null;
  const reviewProgress = selectedPRReviewState?.progress ?? null;
  const isReviewing = selectedPRReviewState?.isReviewing ?? false;
  const isExternalReview = selectedPRReviewState?.isExternalReview ?? false;
  const previousReviewResult = selectedPRReviewState?.previousResult ?? null;
  const startedAt = selectedPRReviewState?.startedAt ?? null;
  const reviewError = selectedPRReviewState?.error ?? null;

  // Get list of PR numbers currently being reviewed
  const activePRReviews = useMemo(() => {
    if (!projectId) return [];
    return Object.values(prReviews)
      .filter((review) => review.projectId === projectId && review.isReviewing)
      .map((review) => review.prNumber);
  }, [projectId, prReviews]);

  // Helper to get review state for any PR
  // Reads directly from prReviews so the callback invalidates when any review state changes,
  // which is needed for usePRFiltering's memoized filteredPRs to recompute correctly
  const getReviewStateForPR = useCallback(
    (prNumber: number) => {
      if (!projectId) return null;
      const key = `${projectId}:${prNumber}`;
      const state = prReviews[key];
      if (!state) return null;
      return {
        isReviewing: state.isReviewing,
        startedAt: state.startedAt,
        progress: state.progress,
        result: state.result,
        previousResult: state.previousResult,
        error: state.error,
        newCommitsCheck: state.newCommitsCheck,
        checksStatus: state.checksStatus,
        reviewsStatus: state.reviewsStatus,
        mergeableState: state.mergeableState,
      };
    },
    [projectId, prReviews]
  );

  // Use detailed PR data if available (includes files), otherwise fall back to list data
  // Validate that selectedPRDetails matches selectedPRNumber to avoid showing stale data
  const selectedPR = useMemo(() => {
    const matchingDetails =
      selectedPRDetails?.number === selectedPRNumber ? selectedPRDetails : null;
    return matchingDetails || prs.find((pr) => pr.number === selectedPRNumber) || null;
  }, [selectedPRDetails, prs, selectedPRNumber]);

  // Check connection and fetch PRs
  const fetchPRs = useCallback(
    async () => {
      if (!projectId) return;

      // Increment generation to invalidate any in-flight loadMore requests
      fetchGenerationRef.current += 1;

      setIsLoading(true);
      setError(null);

      try {
        // First check connection
        const connectionResult = await window.electronAPI.github.checkGitHubConnection(projectId);
        if (connectionResult.success && connectionResult.data) {
          setIsConnected(connectionResult.data.connected);
          setRepoFullName(connectionResult.data.repoFullName || null);

          if (connectionResult.data.connected) {
            // Fetch PRs (returns up to 100 open PRs at once - GitHub GraphQL limit)
            const result = await window.electronAPI.github.listPRs(projectId);
            if (result) {
              // Use hasNextPage from API to determine if more PRs exist
              setHasMore(result.hasNextPage);
              // Store endCursor for pagination
              setEndCursor(result.endCursor ?? null);
              setPrs(result.prs);

              // Batch preload review results for PRs not in store (single IPC call)
              // Skip PRs that are currently being reviewed - their state is managed by IPC listeners
              const prsNeedingPreload = result.prs.filter((pr) => {
                const existingState = getPRReviewState(projectId, pr.number);
                return !existingState?.result && !existingState?.isReviewing;
              });

              if (prsNeedingPreload.length > 0) {
                const prNumbers = prsNeedingPreload.map((pr) => pr.number);
                const batchReviews = await window.electronAPI.github.getPRReviewsBatch(
                  projectId,
                  prNumbers
                );

                // Update store with loaded results
                for (const reviewResult of Object.values(batchReviews)) {
                  if (reviewResult) {
                    usePRReviewStore.getState().setPRReviewResult(projectId, reviewResult, {
                      preserveNewCommitsCheck: true,
                    });
                  }
                }
              }

              // Note: New commits check is now lazy - only done when user selects a PR
              // or explicitly triggers a check. This significantly speeds up list loading.
            }
          }
        } else {
          setIsConnected(false);
          setRepoFullName(null);
          setError(connectionResult.error || "Failed to check connection");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch PRs");
        setIsConnected(false);
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, getPRReviewState]
  );

  // Initial load
  useEffect(() => {
    if (projectId && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      fetchPRs();
    }
  }, [projectId, fetchPRs]);

  // Auto-refresh when tab becomes active (navigating to GitHub PRs tab)
  useEffect(() => {
    // Only refresh if transitioning from inactive to active AND we've loaded before
    if (isActive && !wasActiveRef.current && hasLoadedRef.current) {
      fetchPRs();
    }
    wasActiveRef.current = isActive;
  }, [isActive, fetchPRs]);

  // Reset state and selected PR when project changes
  useEffect(() => {
    currentProjectIdRef.current = projectId;
    fetchGenerationRef.current += 1;
    hasLoadedRef.current = false;
    setHasMore(false);
    setEndCursor(null);
    setPrs([]);
    setSelectedPRNumber(null);
    setSelectedPRDetails(null);
    setIsLoadingMore(false);
    currentFetchPRNumberRef.current = null;
    // Cancel any pending checkNewCommits request
    if (checkNewCommitsAbortRef.current) {
      checkNewCommitsAbortRef.current.abort();
      checkNewCommitsAbortRef.current = null;
    }
  }, [projectId]);

  // Cleanup abort controller on unmount to prevent memory leaks
  // and avoid state updates on unmounted components
  useEffect(() => {
    return () => {
      if (checkNewCommitsAbortRef.current) {
        checkNewCommitsAbortRef.current.abort();
      }
    };
  }, []);

  // Stable PR numbers reference - only changes when actual PR numbers change
  const prNumbersKey = useMemo(() => prs.map((pr) => pr.number).join(','), [prs]);

  // Start/stop PR status polling based on connection state and PRs
  useEffect(() => {
    // Only start polling when connected and we have PRs to poll
    if (!projectId || !isConnected || !prNumbersKey || !isActive) {
      return;
    }

    const prNumbers = prNumbersKey.split(',').map(Number);

    // Start polling for PR status (CI checks, reviews, mergeability)
    window.electronAPI.github.startStatusPolling(projectId, prNumbers).catch((err) => {
      console.warn("Failed to start PR status polling:", err);
    });

    // Cleanup: stop polling when unmounting or when conditions change
    return () => {
      window.electronAPI.github.stopStatusPolling(projectId).catch((err) => {
        console.warn("Failed to stop PR status polling:", err);
      });
    };
  }, [projectId, isConnected, prNumbersKey, isActive]);

  // Register refresh callback to auto-refresh PR list when reviews complete
  useEffect(() => {
    if (!projectId) return;

    // Register fetchPRs to be called when any PR review completes
    registerRefreshCallback(fetchPRs);

    // Unregister on unmount or when dependencies change
    return () => {
      unregisterRefreshCallback(fetchPRs);
    };
  }, [projectId, fetchPRs, registerRefreshCallback, unregisterRefreshCallback]);

  // No need for local IPC listeners - they're handled globally in github-store

  const selectPR = useCallback(
    (prNumber: number | null) => {
      // Abort any pending checkNewCommits request from previous PR selection
      // This prevents stale data from appearing when user switches PRs rapidly
      if (checkNewCommitsAbortRef.current) {
        checkNewCommitsAbortRef.current.abort();
        checkNewCommitsAbortRef.current = null;
      }

      setSelectedPRNumber(prNumber);
      // Note: Don't reset review result - it comes from the store now
      // and persists across navigation

      // Clear previous detailed PR data when deselecting
      if (prNumber === null) {
        setSelectedPRDetails(null);
        currentFetchPRNumberRef.current = null;
        return;
      }

      if (prNumber && projectId) {
        // Track the current PR being fetched (for race condition prevention)
        currentFetchPRNumberRef.current = prNumber;

        // Fetch full PR details including files
        setIsLoadingPRDetails(true);
        window.electronAPI.github
          .getPR(projectId, prNumber)
          .then((prDetails) => {
            // Only update if this response is still for the current PR (prevents race condition)
            if (prDetails && prNumber === currentFetchPRNumberRef.current) {
              setSelectedPRDetails(prDetails);
            }
          })
          .catch((err) => {
            console.warn(`Failed to fetch PR details for #${prNumber}:`, err);
          })
          .finally(() => {
            // Only clear loading state if this was the last fetch
            if (prNumber === currentFetchPRNumberRef.current) {
              setIsLoadingPRDetails(false);
            }
          });

        // Helper function to check for new commits with race condition protection
        // This is called after review state is available (from store or disk)
        // Uses AbortController pattern to cancel pending checks when user switches PRs rapidly
        const checkNewCommitsForPR = (reviewedCommitSha: string | undefined) => {
          // Skip if no commit SHA to compare against
          if (!reviewedCommitSha) {
            return;
          }

          // Skip if user has already switched to a different PR (race condition prevention)
          if (prNumber !== currentFetchPRNumberRef.current) {
            return;
          }

          // Cancel any pending checkNewCommits request before starting a new one
          if (checkNewCommitsAbortRef.current) {
            checkNewCommitsAbortRef.current.abort();
          }
          checkNewCommitsAbortRef.current = new AbortController();
          const currentAbortController = checkNewCommitsAbortRef.current;

          window.electronAPI.github
            .checkNewCommits(projectId, prNumber)
            .then((newCommitsResult) => {
              // Check if request was aborted (user switched PRs)
              if (currentAbortController.signal.aborted) {
                return;
              }

              // Final race condition check before updating store
              if (prNumber !== currentFetchPRNumberRef.current) {
                return;
              }

              setNewCommitsCheckAction(projectId, prNumber, newCommitsResult);
            })
            .catch((err) => {
              // Don't log errors for aborted requests
              if (currentAbortController.signal.aborted) {
                return;
              }
              console.warn(`Failed to check new commits for PR #${prNumber}:`, err);
            });
        };

        // Load existing review from disk if not already in store
        const existingState = getPRReviewState(projectId, prNumber);

        // Only fetch from disk if we don't have a result in the store AND no review is running
        // If a review is in progress, the state is managed by IPC listeners - don't overwrite it
        if (!existingState?.result && !existingState?.isReviewing) {
          window.electronAPI.github.getPRReview(projectId, prNumber).then((result) => {
            // Race condition check: skip if user switched PRs
            if (prNumber !== currentFetchPRNumberRef.current) {
              return;
            }

            if (result) {
              // Update store with the loaded result
              // Preserve newCommitsCheck when loading existing review from disk
              usePRReviewStore
                .getState()
                .setPRReviewResult(projectId, result, { preserveNewCommitsCheck: true });

              // Always check for new commits when selecting a reviewed PR
              // This ensures fresh data even if we have a cached check from earlier in the session
              // CRITICAL: This runs AFTER store is updated with review result
              checkNewCommitsForPR(result.reviewedCommitSha);
            }
          });
        } else if (existingState?.result) {
          // Review already in store - always check for new commits to get fresh status
          // CRITICAL: Review state is already available, check for new commits immediately
          checkNewCommitsForPR(existingState.result.reviewedCommitSha);
        }
        // If existingState?.isReviewing, state is managed by IPC listeners - do nothing
      }
    },
    [projectId, getPRReviewState, setNewCommitsCheckAction]
  );

  const refresh = useCallback(async () => {
    await fetchPRs();
  }, [fetchPRs]);

  // Load more PRs using cursor-based pagination
  const loadMore = useCallback(async () => {
    if (!projectId || !endCursor || !hasMore || isLoadingMore) return;

    // Capture current state for staleness checks
    const requestProjectId = projectId;
    const requestGeneration = fetchGenerationRef.current;

    setIsLoadingMore(true);
    setError(null);

    try {
      const result = await window.electronAPI.github.listMorePRs(projectId, endCursor);

      // Discard response if project changed or a refresh happened while loading
      if (
        requestProjectId !== currentProjectIdRef.current ||
        requestGeneration !== fetchGenerationRef.current
      ) {
        return;
      }

      if (result) {
        // Check if this is a failure response (empty result with no next page)
        // In this case, preserve existing pagination state to allow retry
        const isFailureResponse = result.prs.length === 0 && !result.hasNextPage && !result.endCursor;

        if (!isFailureResponse) {
          // Update pagination state only on successful response
          setHasMore(result.hasNextPage);
          setEndCursor(result.endCursor ?? null);

          // Append new PRs to existing list, deduplicating by PR number
          // (handles edge case where PR shifts position between pagination requests)
          setPrs((prevPrs) => {
            const existingNumbers = new Set(prevPrs.map((pr) => pr.number));
            const newPrs = result.prs.filter((pr) => !existingNumbers.has(pr.number));
            return [...prevPrs, ...newPrs];
          });
        }

        // Batch preload review results for new PRs not in store
        const prsNeedingPreload = result.prs.filter((pr) => {
          const existingState = getPRReviewState(requestProjectId, pr.number);
          return !existingState?.result && !existingState?.isReviewing;
        });

        if (prsNeedingPreload.length > 0) {
          const prNumbers = prsNeedingPreload.map((pr) => pr.number);
          const batchReviews = await window.electronAPI.github.getPRReviewsBatch(
            requestProjectId,
            prNumbers
          );

          // Check staleness again after async batch fetch
          if (
            requestProjectId !== currentProjectIdRef.current ||
            requestGeneration !== fetchGenerationRef.current
          ) {
            return;
          }

          // Update store with loaded results
          for (const reviewResult of Object.values(batchReviews)) {
            if (reviewResult) {
              usePRReviewStore.getState().setPRReviewResult(requestProjectId, reviewResult, {
                preserveNewCommitsCheck: true,
              });
            }
          }
        }
      }
    } catch (err) {
      // Only show error if still relevant
      if (
        requestProjectId === currentProjectIdRef.current &&
        requestGeneration === fetchGenerationRef.current
      ) {
        setError(err instanceof Error ? err.message : "Failed to load more PRs");
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [projectId, endCursor, hasMore, isLoadingMore, getPRReviewState]);

  const runReview = useCallback(
    (prNumber: number) => {
      if (!projectId) return;

      // Use the store function which handles both state and IPC
      storeStartPRReview(projectId, prNumber);
    },
    [projectId]
  );

  const runFollowupReview = useCallback(
    (prNumber: number) => {
      if (!projectId) return;

      // Use the store function which handles both state and IPC
      storeStartFollowupReview(projectId, prNumber);
    },
    [projectId]
  );

  const checkNewCommits = useCallback(
    async (prNumber: number): Promise<NewCommitsCheck> => {
      if (!projectId) {
        return { hasNewCommits: false, newCommitCount: 0 };
      }

      try {
        const result = await window.electronAPI.github.checkNewCommits(projectId, prNumber);
        // Cache the result in the store so the list view can use it
        // Use the action from the hook subscription to ensure proper React re-renders
        setNewCommitsCheckAction(projectId, prNumber, result);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to check for new commits");
        return { hasNewCommits: false, newCommitCount: 0 };
      }
    },
    [projectId, setNewCommitsCheckAction]
  );

  const cancelReview = useCallback(
    async (prNumber: number): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const success = await window.electronAPI.github.cancelPRReview(projectId, prNumber);
        // Always update store state to exit the "reviewing" state
        // Use different messages based on whether the process was found and killed
        const message = success
          ? "Review cancelled by user"
          : "Review stopped - process not found";
        usePRReviewStore
          .getState()
          .setPRReviewError(projectId, prNumber, message);
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to cancel review");
        return false;
      }
    },
    [projectId]
  );

  const postReview = useCallback(
    async (
      prNumber: number,
      selectedFindingIds?: string[],
      options?: { forceApprove?: boolean }
    ): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const success = await window.electronAPI.github.postPRReview(
          projectId,
          prNumber,
          selectedFindingIds,
          options
        );
        if (success) {
          // Reload review result to get updated postedAt and finding status
          const result = await window.electronAPI.github.getPRReview(projectId, prNumber);
          if (result) {
            // Preserve newCommitsCheck - posting doesn't change whether there are new commits
            usePRReviewStore
              .getState()
              .setPRReviewResult(projectId, result, { preserveNewCommitsCheck: true });
          }
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post review");
        return false;
      }
    },
    [projectId]
  );

  const postComment = useCallback(
    async (prNumber: number, body: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        return await window.electronAPI.github.postPRComment(projectId, prNumber, body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post comment");
        return false;
      }
    },
    [projectId]
  );

  const mergePR = useCallback(
    async (
      prNumber: number,
      mergeMethod: "merge" | "squash" | "rebase" = "squash"
    ): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const success = await window.electronAPI.github.mergePR(projectId, prNumber, mergeMethod);
        if (success) {
          // Refresh PR list after merge
          await fetchPRs();
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to merge PR");
        return false;
      }
    },
    [projectId, fetchPRs]
  );

  const assignPR = useCallback(
    async (prNumber: number, username: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const success = await window.electronAPI.github.assignPR(projectId, prNumber, username);
        if (success) {
          // Refresh PR list to update assignees
          await fetchPRs();
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to assign user");
        return false;
      }
    },
    [projectId, fetchPRs]
  );

  const markReviewPosted = useCallback(
    async (prNumber: number): Promise<void> => {
      if (!projectId) return;

      // Persist to disk first
      const success = await window.electronAPI.github.markReviewPosted(projectId, prNumber);
      if (!success) return;

      // Get the current timestamp for consistent update
      const postedAt = new Date().toISOString();

      // Update the in-memory store
      const existingState = getPRReviewState(projectId, prNumber);
      if (existingState?.result) {
        // If we have the result loaded, update it with hasPostedFindings and postedAt
        usePRReviewStore.getState().setPRReviewResult(
          projectId,
          { ...existingState.result, hasPostedFindings: true, postedAt },
          { preserveNewCommitsCheck: true }
        );
      } else {
        // If result not loaded yet (race condition), reload from disk to get updated state
        const result = await window.electronAPI.github.getPRReview(projectId, prNumber);
        if (result) {
          usePRReviewStore.getState().setPRReviewResult(
            projectId,
            result,
            { preserveNewCommitsCheck: true }
          );
        }
      }
    },
    [projectId, getPRReviewState]
  );

  return {
    prs,
    isLoading,
    isLoadingMore,
    isLoadingPRDetails,
    error,
    selectedPR,
    selectedPRNumber,
    reviewResult,
    reviewProgress,
    startedAt,
    isReviewing,
    isExternalReview,
    previousReviewResult,
    reviewError,
    isConnected,
    repoFullName,
    activePRReviews,
    hasMore,
    selectPR,
    refresh,
    loadMore,
    runReview,
    runFollowupReview,
    checkNewCommits,
    cancelReview,
    postReview,
    postComment,
    mergePR,
    assignPR,
    markReviewPosted,
    getReviewStateForPR,
  };
}
