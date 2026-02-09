import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  GitLabMergeRequest,
  GitLabMRReviewResult,
  GitLabMRReviewProgress,
  GitLabNewCommitsCheck
} from '../../../../shared/types';
import {
  useMRReviewStore,
  startMRReview as storeStartMRReview,
  startFollowupReview as storeStartFollowupReview
} from '../../../stores/gitlab';

// Re-export types for consumers
export type { GitLabMergeRequest, GitLabMRReviewResult, GitLabMRReviewProgress };
export type { GitLabMRReviewFinding } from '../../../../shared/types';

interface UseGitLabMRsOptions {
  /** Filter MRs by state */
  stateFilter?: 'opened' | 'closed' | 'merged' | 'all';
}

interface UseGitLabMRsResult {
  mergeRequests: GitLabMergeRequest[];
  isLoading: boolean;
  error: string | null;
  selectedMR: GitLabMergeRequest | null;
  selectedMRIid: number | null;
  reviewResult: GitLabMRReviewResult | null;
  reviewProgress: GitLabMRReviewProgress | null;
  isReviewing: boolean;
  isConnected: boolean;
  projectPath: string | null;
  activeMRReviews: number[]; // MR iids currently being reviewed
  selectMR: (mrIid: number | null) => void;
  refresh: () => Promise<void>;
  runReview: (mrIid: number) => Promise<void>;
  runFollowupReview: (mrIid: number) => Promise<void>;
  checkNewCommits: (mrIid: number) => Promise<GitLabNewCommitsCheck>;
  cancelReview: (mrIid: number) => Promise<boolean>;
  postReview: (mrIid: number, selectedFindingIds?: string[]) => Promise<boolean>;
  postNote: (mrIid: number, body: string) => Promise<boolean>;
  mergeMR: (mrIid: number, mergeMethod?: 'merge' | 'squash' | 'rebase') => Promise<boolean>;
  assignMR: (mrIid: number, userIds: number[]) => Promise<boolean>;
  approveMR: (mrIid: number) => Promise<boolean>;
  getReviewStateForMR: (mrIid: number) => {
    isReviewing: boolean;
    progress: GitLabMRReviewProgress | null;
    result: GitLabMRReviewResult | null;
    error: string | null;
    newCommitsCheck: GitLabNewCommitsCheck | null;
  } | null;
}

export function useGitLabMRs(projectId?: string, options: UseGitLabMRsOptions = {}): UseGitLabMRsResult {
  const { stateFilter = 'opened' } = options;
  const [mergeRequests, setMergeRequests] = useState<GitLabMergeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMRIid, setSelectedMRIid] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);

  // Get MR review state from the global store
  const _mrReviews = useMRReviewStore((state) => state.mrReviews);
  const getMRReviewState = useMRReviewStore((state) => state.getMRReviewState);
  const getActiveMRReviews = useMRReviewStore((state) => state.getActiveMRReviews);

  // Get review state for the selected MR from the store
  const selectedMRReviewState = useMemo(() => {
    if (!projectId || selectedMRIid === null) return null;
    return getMRReviewState(projectId, selectedMRIid);
  }, [projectId, selectedMRIid, getMRReviewState]);

  // Derive values from store state
  const reviewResult = selectedMRReviewState?.result ?? null;
  const reviewProgress = selectedMRReviewState?.progress ?? null;
  const isReviewing = selectedMRReviewState?.isReviewing ?? false;

  // Get list of MR iids currently being reviewed
  const activeMRReviews = useMemo(() => {
    if (!projectId) return [];
    return getActiveMRReviews(projectId).map(review => review.mrIid);
  }, [projectId, getActiveMRReviews]);

  // Helper to get review state for any MR
  const getReviewStateForMR = useCallback((mrIid: number) => {
    if (!projectId) return null;
    const state = getMRReviewState(projectId, mrIid);
    if (!state) return null;
    return {
      isReviewing: state.isReviewing,
      progress: state.progress,
      result: state.result,
      error: state.error,
      newCommitsCheck: state.newCommitsCheck
    };
  }, [projectId, getMRReviewState]);

  const selectedMR = mergeRequests.find(mr => mr.iid === selectedMRIid) || null;

  // Check connection and fetch MRs
  const fetchMRs = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      // First check connection
      const connectionResult = await window.electronAPI.checkGitLabConnection(projectId);
      if (connectionResult.success && connectionResult.data) {
        setIsConnected(connectionResult.data.connected);
        setProjectPath(connectionResult.data.projectPathWithNamespace || null);

        if (connectionResult.data.connected) {
          // Fetch MRs
          const result = await window.electronAPI.getGitLabMergeRequests(projectId, stateFilter);
          if (result.success && result.data) {
            setMergeRequests(result.data);

            // Preload review results for all MRs
            result.data.forEach(mr => {
              const existingState = getMRReviewState(projectId, mr.iid);
              // Only fetch from disk if we don't have a result in the store
              if (!existingState?.result && window.electronAPI.getGitLabMRReview) {
                window.electronAPI.getGitLabMRReview(projectId, mr.iid).then(reviewResult => {
                  if (reviewResult) {
                    // Update store with the loaded result
                    useMRReviewStore.getState().setMRReviewResult(projectId, reviewResult);
                  }
                });
              }
            });
          }
        }
      } else {
        setIsConnected(false);
        setProjectPath(null);
        setError(connectionResult.error || 'Failed to check connection');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch MRs');
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, stateFilter, getMRReviewState]);

  useEffect(() => {
    fetchMRs();
  }, [fetchMRs]);

  const selectMR = useCallback((mrIid: number | null) => {
    setSelectedMRIid(mrIid);

    // Load existing review from disk if not already in store
    if (mrIid && projectId) {
      const existingState = getMRReviewState(projectId, mrIid);
      // Only fetch from disk if we don't have a result in the store
      if (!existingState?.result && window.electronAPI.getGitLabMRReview) {
        window.electronAPI.getGitLabMRReview(projectId, mrIid).then(result => {
          if (result) {
            // Update store with the loaded result
            useMRReviewStore.getState().setMRReviewResult(projectId, result);
          }
        });
      }
    }
  }, [projectId, getMRReviewState]);

  const refresh = useCallback(async () => {
    await fetchMRs();
  }, [fetchMRs]);

  const runReview = useCallback(async (mrIid: number) => {
    if (!projectId) return;
    storeStartMRReview(projectId, mrIid);
  }, [projectId]);

  const runFollowupReview = useCallback(async (mrIid: number) => {
    if (!projectId) return;
    storeStartFollowupReview(projectId, mrIid);
  }, [projectId]);

  const checkNewCommits = useCallback(async (mrIid: number): Promise<GitLabNewCommitsCheck> => {
    if (!projectId || !window.electronAPI.checkGitLabMRNewCommits) {
      return { hasNewCommits: false };
    }

    try {
      const result = await window.electronAPI.checkGitLabMRNewCommits(projectId, mrIid);
      // Cache the result in the store so the list view can use it
      useMRReviewStore.getState().setNewCommitsCheck(projectId, mrIid, result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for new commits');
      return { hasNewCommits: false };
    }
  }, [projectId]);

  const cancelReview = useCallback(async (mrIid: number): Promise<boolean> => {
    if (!projectId || !window.electronAPI.cancelGitLabMRReview) return false;

    try {
      const success = await window.electronAPI.cancelGitLabMRReview(projectId, mrIid);
      if (success) {
        useMRReviewStore.getState().setMRReviewError(projectId, mrIid, 'Review cancelled by user');
      }
      return success;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel review');
      return false;
    }
  }, [projectId]);

  const postReview = useCallback(async (mrIid: number, selectedFindingIds?: string[]): Promise<boolean> => {
    if (!projectId || !window.electronAPI.postGitLabMRReview) return false;

    try {
      return await window.electronAPI.postGitLabMRReview(projectId, mrIid, selectedFindingIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post review');
      return false;
    }
  }, [projectId]);

  const postNote = useCallback(async (mrIid: number, body: string): Promise<boolean> => {
    if (!projectId || !window.electronAPI.postGitLabMRNote) return false;

    try {
      return await window.electronAPI.postGitLabMRNote(projectId, mrIid, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post note');
      return false;
    }
  }, [projectId]);

  const mergeMR = useCallback(async (mrIid: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> => {
    if (!projectId || !window.electronAPI.mergeGitLabMR) return false;

    try {
      const success = await window.electronAPI.mergeGitLabMR(projectId, mrIid, mergeMethod);
      if (success) {
        // Refresh MR list after merge
        await fetchMRs();
      }
      return success;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge MR');
      return false;
    }
  }, [projectId, fetchMRs]);

  const assignMR = useCallback(async (mrIid: number, userIds: number[]): Promise<boolean> => {
    if (!projectId || !window.electronAPI.assignGitLabMR) return false;

    try {
      const success = await window.electronAPI.assignGitLabMR(projectId, mrIid, userIds);
      if (success) {
        // Refresh MR list to update assignees
        await fetchMRs();
      }
      return success;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign users');
      return false;
    }
  }, [projectId, fetchMRs]);

  const approveMR = useCallback(async (mrIid: number): Promise<boolean> => {
    if (!projectId || !window.electronAPI.approveGitLabMR) return false;

    try {
      return await window.electronAPI.approveGitLabMR(projectId, mrIid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve MR');
      return false;
    }
  }, [projectId]);

  return {
    mergeRequests,
    isLoading,
    error,
    selectedMR,
    selectedMRIid,
    reviewResult,
    reviewProgress,
    isReviewing,
    isConnected,
    projectPath,
    activeMRReviews,
    selectMR,
    refresh,
    runReview,
    runFollowupReview,
    checkNewCommits,
    cancelReview,
    postReview,
    postNote,
    mergeMR,
    assignMR,
    approveMR,
    getReviewStateForMR,
  };
}
