import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../stores/project-store";
import { useTaskStore } from "../stores/task-store";
import { useIssuesStore } from "../stores/github/issues-store";
import {
  useInvestigationStore,
  startIssueInvestigation,
  cancelIssueInvestigation,
  cancelAllIssueInvestigations,
  loadPersistedInvestigations,
} from "../stores/github";
import { loadTasks } from "../stores/task-store";
import {
  useGitHubIssues,
  useIssueListFiltering,
  useBulkOperations,
  useMutations,
  useDependencies,
} from "./github-issues/hooks";
import { useAnalyzePreview } from "./github-issues/hooks/useAnalyzePreview";
import {
  NotConnectedState,
  EmptyState,
  IssueListHeader,
  IssueList,
  IssueDetail,
  IssueFilterBar,
  BatchReviewWizard,
  BulkActionBar,
  BulkResultsPanel,
} from "./github-issues/components";
import { GitHubSetupModal } from "./GitHubSetupModal";
import { ResizablePanels } from "./ui/resizable-panels";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import { useMutationStore } from "../stores/github/mutation-store";
import { useToast } from "../hooks/use-toast";
import type { GitHubIssue, InvestigationState, InvestigationDismissReason, } from "../../shared/types";
import type { GitHubIssuesProps } from "./github-issues/types";

// Debounce hook for high-frequency updates
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function GitHubIssues({ onOpenSettings, onNavigateToTask }: GitHubIssuesProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const allTasks = useTaskStore((state) => state.tasks);

  // Memoize filtered tasks to avoid creating new array references
  const tasks = useMemo(() => {
    return allTasks.filter(t => t.metadata?.githubIssueNumber);
  }, [allTasks]);

  const debouncedTasks = useDebounce(tasks, 300); // Debounce by 300ms

  const {
    syncStatus,
    isLoading,
    isLoadingMore,
    error,
    selectedIssueNumber,
    selectedIssue,
    hasMore,
    selectIssue,
    getOpenIssuesCount,
    handleRefresh,
    handleLoadMore,
    handleSearchStart,
    handleSearchClear,
  } = useGitHubIssues(selectedProject?.id);

  // Investigation store — multi-issue keyed state
  // Subscribe only to the investigations object for state, use store for methods
  const investigations = useInvestigationStore((s) => s.investigations);
  const getInvestigationState = useInvestigationStore((s) => s.getInvestigationState);
  const syncTaskState = useInvestigationStore((s) => s.syncTaskState);
  const clearLinkedTask = useInvestigationStore((s) => s.clearLinkedTask);
  const getInvestigationSettings = useInvestigationStore((s) => s.getSettings);
  const setInvestigationSettings = useInvestigationStore((s) => s.setSettings);
  const markStaleInvestigations = useInvestigationStore((s) => s.markStaleInvestigations);
  const setInvestigationSpecId = useInvestigationStore((s) => s.setSpecId);
  const dismissInvestigation = useInvestigationStore((s) => s.dismiss);
  const setInvestigationGithubCommentId = useInvestigationStore((s) => s.setGithubCommentId);
  const getDerivedInvestigationState = useInvestigationStore((s) => s.getDerivedState);

  const storeIssues = useIssuesStore((s) => s.issues);

  // useIssueListFiltering handles search, reporter, status, and sort client-side
  const {
    filteredIssues,
    reporters,
    filters: issueFilters,
    setSearchQuery,
    setReporters,
    setStatuses,
    setSortBy,
    clearFilters,
    hasActiveFilters,
  } = useIssueListFiltering(storeIssues);

  const isSearchActive = issueFilters.searchQuery.length > 0;

  // Trigger full issue load when search becomes active
  useEffect(() => {
    if (issueFilters.searchQuery.length > 0) {
      handleSearchStart();
    } else {
      handleSearchClear();
    }
  }, [issueFilters.searchQuery, handleSearchStart, handleSearchClear]);

  // Analyze & Group Issues (proactive workflow)
  const {
    isWizardOpen,
    isAnalyzing,
    isApproving,
    analysisProgress,
    analysisResult,
    analysisError,
    openWizard,
    closeWizard,
    startAnalysis,
    approveBatches,
  } = useAnalyzePreview({ projectId: selectedProject?.id || "" });

  // Investigation state filter
  const [investigationStateFilter, setInvestigationStateFilter] = useState<InvestigationState[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);

  // Label consent dialog state
  const [showLabelConsent, setShowLabelConsent] = useState(false);
  const pendingInvestigationRef = useRef<{ type: 'single'; issue: GitHubIssue } | { type: 'bulk' } | null>(null);

  // Apply investigation state filter to issues
  const investigationFilteredIssues = useMemo(() => {
    const projectId = selectedProject?.id;
    // Early return if no filters active
    if (investigationStateFilter.length === 0 && !showDismissed) return filteredIssues;

    const projectPrefix = projectId ? `${projectId}:` : '';

    return filteredIssues.filter((issue) => {
      if (!projectId) return true;

      // Direct O(1) lookup instead of calling getInvestigationState
      const entry = investigations[projectPrefix + issue.number];

      // Filter out dismissed unless showDismissed is on
      if (entry?.dismissReason && !showDismissed) return false;

      // If no investigation state filter, show all non-dismissed
      if (investigationStateFilter.length === 0) return true;

      // Compute derived state inline to avoid store method call
      let state: InvestigationState = 'new';
      if (entry) {
        if (entry.isInvestigating && entry.progress?.phase === 'queued') state = 'queued';
        else if (entry.isInvestigating) state = 'investigating';
        else if (entry.error === 'investigation.interrupted' && !entry.specId) state = 'interrupted';
        else if (entry.error && !entry.specId) state = 'failed';
        else if (entry.report?.likelyResolved && !entry.specId) state = 'resolved';
        else if (entry.report && !entry.specId) state = 'findings_ready';
        else if (entry.specId) {
          if (entry.linkedTaskStatus === 'done') state = 'done';
          else if (entry.linkedTaskStatus === 'building') state = 'building';
          else state = 'task_created';
        }
      }
      return investigationStateFilter.includes(state);
    });
  }, [filteredIssues, investigationStateFilter, showDismissed, investigations, selectedProject?.id]);

  // Build investigation state counts
  const investigationStateCounts = useMemo(() => {
    const counts: Partial<Record<InvestigationState, number>> = {};
    const projectId = selectedProject?.id;
    if (!projectId) return counts;

    const projectPrefix = `${projectId}:`;

    for (const issue of filteredIssues) {
      // Direct O(1) lookup and inline state computation
      const entry = investigations[projectPrefix + issue.number];

      let state: InvestigationState = 'new';
      if (entry) {
        if (entry.isInvestigating && entry.progress?.phase === 'queued') state = 'queued';
        else if (entry.isInvestigating) state = 'investigating';
        else if (entry.error === 'investigation.interrupted' && !entry.specId) state = 'interrupted';
        else if (entry.error && !entry.specId) state = 'failed';
        else if (entry.report?.likelyResolved && !entry.specId) state = 'resolved';
        else if (entry.report && !entry.specId) state = 'findings_ready';
        else if (entry.specId) {
          if (entry.linkedTaskStatus === 'done') state = 'done';
          else if (entry.linkedTaskStatus === 'building') state = 'building';
          else state = 'task_created';
        }
      }
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return counts;
  }, [filteredIssues, investigations, selectedProject?.id]);

  // Active investigation count
  const activeInvestigations = useMemo(() => {
    if (!selectedProject?.id) return [];
    // Filter active investigations from the investigations object
    const _projectPrefix = `${selectedProject.id}:`;
    return Object.values(investigations)
      .filter(inv => inv.projectId === selectedProject.id && inv.isInvestigating);
  }, [investigations, selectedProject?.id]);

  // Build investigation states map for IssueList
  const investigationStatesMap = useMemo(() => {
    const map: Record<string, { state: InvestigationState; progress?: number; linkedTaskId?: string; isStale?: boolean }> = {};
    const projectId = selectedProject?.id;
    if (!projectId) return map;

    const projectPrefix = `${projectId}:`;

    for (const issue of investigationFilteredIssues) {
      // Direct O(1) lookup instead of calling getInvestigationState
      const entry = investigations[projectPrefix + issue.number];

      // Compute derived state inline
      let state: InvestigationState = 'new';
      if (entry) {
        if (entry.isInvestigating && entry.progress?.phase === 'queued') state = 'queued';
        else if (entry.isInvestigating) state = 'investigating';
        else if (entry.error === 'investigation.interrupted' && !entry.specId) state = 'interrupted';
        else if (entry.error && !entry.specId) state = 'failed';
        else if (entry.report?.likelyResolved && !entry.specId) state = 'resolved';
        else if (entry.report && !entry.specId) state = 'findings_ready';
        else if (entry.specId) {
          if (entry.linkedTaskStatus === 'done') state = 'done';
          else if (entry.linkedTaskStatus === 'building') state = 'building';
          else state = 'task_created';
        }
      }

      const issueKey = String(issue.number);
      map[issueKey] = {
        state,
        progress: entry?.progress?.progress,
        linkedTaskId: entry?.specId ?? undefined,
        isStale: entry?.isStale,
      };
    }
    return map;
  }, [investigationFilteredIssues, investigations, selectedProject?.id]);

  // Bulk operations
  const { executeBulk, isOperating: isBulkOperating } = useBulkOperations(selectedProject?.id ?? '');
  const [selectedIssueNumbers, setSelectedIssueNumbers] = useState<Set<number>>(new Set());

  const handleToggleSelect = useCallback((issueNumber: number) => {
    setSelectedIssueNumbers(prev => {
      const next = new Set(prev);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  }, []);

  const handleBulkAction = useCallback(
    (action: Parameters<typeof executeBulk>[0], payload?: Parameters<typeof executeBulk>[2]) => {
      executeBulk(action, [...selectedIssueNumbers], payload);
    },
    [executeBulk, selectedIssueNumbers],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIssueNumbers(new Set(investigationFilteredIssues.map((i) => i.number)));
  }, [investigationFilteredIssues]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIssueNumbers(new Set());
  }, []);

  // Clear selection when bulk operation completes
  const wasBulkOperating = useRef(false);
  useEffect(() => {
    if (wasBulkOperating.current && !isBulkOperating) {
      setSelectedIssueNumbers(new Set());
    }
    wasBulkOperating.current = isBulkOperating;
  }, [isBulkOperating]);

  // Bulk operation results
  const bulkResult = useMutationStore((s) => s.bulkResult);
  const clearBulkResult = useMutationStore((s) => s.clearBulkResult);

  // Dependencies for selected issue
  const { dependencies, isLoading: isDepsLoading, error: depsError } = useDependencies(selectedIssue?.number ?? null);

  // Issue mutations (edit, close, reopen, comment, labels, assignees)
  const mutations = useMutations(selectedProject?.id ?? '');

  // Wrapped mutation callbacks bound to selected issue
  const handleEditTitle = useCallback(
    async (title: string) => { if (selectedIssue) await mutations.editTitle(selectedIssue.number, title); },
    [selectedIssue, mutations],
  );
  const handleEditBody = useCallback(
    async (body: string) => { if (selectedIssue) await mutations.editBody(selectedIssue.number, body); },
    [selectedIssue, mutations],
  );
  const handleCloseIssue = useCallback(
    async (comment?: string) => {
      if (!selectedIssue) return;
      if (comment) await mutations.addComment(selectedIssue.number, comment);
      await mutations.closeIssue(selectedIssue.number);
    },
    [selectedIssue, mutations],
  );
  const handleReopenIssue = useCallback(
    async () => { if (selectedIssue) await mutations.reopenIssue(selectedIssue.number); },
    [selectedIssue, mutations],
  );
  const handleAddComment = useCallback(
    async (body: string) => { if (selectedIssue) await mutations.addComment(selectedIssue.number, body); },
    [selectedIssue, mutations],
  );
  const handleAddLabels = useCallback(
    async (labels: string[]) => { if (selectedIssue) await mutations.addLabels(selectedIssue.number, labels); },
    [selectedIssue, mutations],
  );
  const handleRemoveLabels = useCallback(
    async (labels: string[]) => { if (selectedIssue) await mutations.removeLabels(selectedIssue.number, labels); },
    [selectedIssue, mutations],
  );
  const handleAddAssignees = useCallback(
    async (logins: string[]) => { if (selectedIssue) await mutations.addAssignees(selectedIssue.number, logins); },
    [selectedIssue, mutations],
  );
  const handleRemoveAssignees = useCallback(
    async (logins: string[]) => { if (selectedIssue) await mutations.removeAssignees(selectedIssue.number, logins); },
    [selectedIssue, mutations],
  );

  // Fetch repo labels & collaborators for mutation UI
  const [repoLabels, setRepoLabels] = useState<Array<{ name: string; color: string }>>([]);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const repoMetaLoadedProjectRef = useRef<string | null>(null);

  // Reset repo metadata cache on project change
  useEffect(() => {
    repoMetaLoadedProjectRef.current = null;
    setRepoLabels([]);
    setCollaborators([]);
  }, [selectedProject?.id]);

  // Lazily load labels/collaborators only when an issue is selected.
  useEffect(() => {
    if (!selectedProject?.id || !selectedIssue) return;
    if (repoMetaLoadedProjectRef.current === selectedProject.id) return;
    repoMetaLoadedProjectRef.current = selectedProject.id;

    let cancelled = false;
    Promise.all([
      window.electronAPI.github.getRepoLabels(selectedProject.id),
      window.electronAPI.github.getRepoCollaborators(selectedProject.id),
    ]).then(([labelsRes, collaboratorsRes]) => {
      if (cancelled) return;
      if (labelsRes.success && labelsRes.data) setRepoLabels(labelsRes.data);
      if (collaboratorsRes.success && collaboratorsRes.data) setCollaborators(collaboratorsRes.data);
    }).catch(() => {
      // Non-critical metadata loading failure
      repoMetaLoadedProjectRef.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id, selectedIssue]);

  // Load persisted investigation state and settings from disk on project change
  useEffect(() => {
    if (!selectedProject?.id) return;
    loadPersistedInvestigations(selectedProject.id);
    // Hydrate investigation settings (including labelConsentGiven) into the store
    window.electronAPI?.github?.getInvestigationSettings?.(selectedProject.id).then((res) => {
      if (res?.success && res.data) {
        setInvestigationSettings(selectedProject.id, res.data);
      }
    }).catch(() => { /* non-critical */ });
  }, [selectedProject?.id, setInvestigationSettings]);

  // Mark stale investigations: cross-reference investigations with fetched issues
  useEffect(() => {
    if (!selectedProject?.id || storeIssues.length === 0) return;
    const activeIssueNumbers = new Set(storeIssues.map((issue) => issue.number));
    markStaleInvestigations(selectedProject.id, activeIssueNumbers);
  }, [storeIssues, selectedProject?.id, markStaleInvestigations]);

  // Clear selection when filters change
    useEffect(() => {
    setSelectedIssueNumbers(new Set());
  }, [investigationStateFilter, issueFilters]);

  const [showGitHubSetup, setShowGitHubSetup] = useState(false);

  // Show GitHub setup modal when module is not installed
  useEffect(() => {
    if (analysisError?.includes("GitHub automation module not installed")) {
      setShowGitHubSetup(true);
    }
  }, [analysisError]);

  // Build a map of GitHub issue numbers to task IDs for quick lookup
  const issueToTaskMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const task of tasks) {
      if (task.metadata?.githubIssueNumber) {
        map.set(task.metadata.githubIssueNumber, task.specId || task.id);
      }
    }
    return map;
  }, [tasks]);

  // Sync investigation state with linked task status changes
  // When a task linked to an issue changes status, update the investigation store
  // Also detect deleted tasks and revert investigations to findings_ready
  useEffect(() => {
    if (!selectedProject?.id) return;
    const projectId = selectedProject.id;

    // Build a set of specIds from current tasks for fast lookup
    const taskSpecIds = new Set<string>();
    for (const task of debouncedTasks) {
      const specId = task.specId || task.id;
      if (specId) taskSpecIds.add(specId);
    }

    for (const task of debouncedTasks) {
      const issueNumber = task.metadata?.githubIssueNumber;
      if (!issueNumber || !task.status) continue;

      // Only sync if there's a corresponding investigation with a specId
      const inv = getInvestigationState(projectId, issueNumber);
      if (!inv?.specId) continue;

      // Sync task state to investigation store
      syncTaskState(projectId, issueNumber, task.status);
    }

    // Detect deleted tasks: if an investigation has a specId but no matching task exists
    const { investigations } = useInvestigationStore.getState();
    for (const inv of Object.values(investigations)) {
      if (inv.projectId !== projectId || !inv.specId) continue;
      if (!taskSpecIds.has(inv.specId)) {
        clearLinkedTask(projectId, inv.issueNumber);
      }
    }
  }, [debouncedTasks, selectedProject?.id, getInvestigationState, syncTaskState, clearLinkedTask]);

  // Auto-close GitHub issues when linked task reaches "done" and autoCloseIssues is enabled
  const autoClosedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!selectedProject?.id) return;
    const projectId = selectedProject.id;
    const settings = getInvestigationSettings(projectId);
    if (!settings?.autoCloseIssues) return;

    for (const task of tasks) {
      const issueNumber = task.metadata?.githubIssueNumber;
      if (!issueNumber) continue;

      // Only auto-close when task reaches done/pr_created
      if (task.status !== 'done' && task.status !== 'pr_created') continue;

      // Skip if already auto-closed in this session
      if (autoClosedRef.current.has(issueNumber)) continue;

      // Check that there's an investigation for this issue (auto-close only applies to investigated issues)
      const state = getDerivedInvestigationState(projectId, issueNumber);
      if (state !== 'done') continue;

      // Mark as auto-closed to prevent duplicate close attempts
      autoClosedRef.current.add(issueNumber);

      // Close the issue via GitHub API
      window.electronAPI.github.closeIssue(projectId, issueNumber).then((result) => {
        if (result.success) {
          // Update the local issue state to reflect closure
          useIssuesStore.getState().updateIssue(issueNumber, { state: 'closed' });
        } else {
          // Remove from auto-closed set so it can be retried
          autoClosedRef.current.delete(issueNumber);
          console.warn(`[GitHubIssues] Failed to auto-close issue #${issueNumber}:`, result.error);
        }
      });
    }
  }, [tasks, selectedProject?.id, getInvestigationSettings, getDerivedInvestigationState]);

  // Clear auto-closed tracking on project change
  useEffect(() => {
    autoClosedRef.current = new Set();
  }, [selectedProject?.id]);

  // Reset local state on project change
  useEffect(() => {
    setSelectedIssueNumbers(new Set());
    setInvestigationStateFilter([]);
    setShowDismissed(false);
    useMutationStore.getState().clearBulkResult();
  }, [selectedProject?.id]);

  // Helper: check if label consent is needed before investigating
  const needsLabelConsent = useCallback(() => {
    if (!selectedProject?.id) return false;
    const settings = getInvestigationSettings(selectedProject.id);
    return !settings?.labelConsentGiven;
  }, [selectedProject?.id, getInvestigationSettings]);

  // Helper: grant label consent and persist
  const grantLabelConsent = useCallback(() => {
    if (!selectedProject?.id) return;
    const current = getInvestigationSettings(selectedProject.id);
    const updated = { ...(current ?? { autoCreateTasks: false, autoStartTasks: false, pipelineMode: 'full' as const, phase1ExecutionMode: 'sequential' as const, autoPostToGitHub: false, autoCloseIssues: false, maxParallelInvestigations: 3, labelIncludeFilter: [] as string[], labelExcludeFilter: [] as string[] }), labelConsentGiven: true };
    setInvestigationSettings(selectedProject.id, updated);
    if (window.electronAPI?.github?.saveInvestigationSettings) {
      window.electronAPI.github.saveInvestigationSettings(selectedProject.id, updated).catch((err) => console.warn('Failed to persist label consent:', err));
    }
  }, [selectedProject?.id, getInvestigationSettings, setInvestigationSettings]);

  // Investigation callbacks for selected issue
  const handleInvestigate = useCallback((issue: GitHubIssue) => {
    if (!selectedProject?.id) return;
    if (needsLabelConsent()) {
      pendingInvestigationRef.current = { type: 'single', issue };
      setShowLabelConsent(true);
      return;
    }
    startIssueInvestigation(selectedProject.id, issue.number);
  }, [selectedProject?.id, needsLabelConsent]);

  // Bulk investigate: queue all selected issues for investigation
  const handleBulkInvestigate = useCallback(() => {
    if (!selectedProject?.id) return;
    if (needsLabelConsent()) {
      pendingInvestigationRef.current = { type: 'bulk' };
      setShowLabelConsent(true);
      return;
    }
    for (const issueNumber of selectedIssueNumbers) {
      startIssueInvestigation(selectedProject.id, issueNumber);
    }
  }, [selectedProject?.id, selectedIssueNumbers, needsLabelConsent]);

  // Handle consent dialog confirm
  const handleConsentConfirm = useCallback(() => {
    grantLabelConsent();
    setShowLabelConsent(false);
    if (!selectedProject?.id) return;
    const pending = pendingInvestigationRef.current;
    pendingInvestigationRef.current = null;
    if (!pending) return;
    if (pending.type === 'single') {
      startIssueInvestigation(selectedProject.id, pending.issue.number);
    } else {
      for (const issueNumber of selectedIssueNumbers) {
        startIssueInvestigation(selectedProject.id, issueNumber);
      }
    }
  }, [grantLabelConsent, selectedProject?.id, selectedIssueNumbers]);

  const handleCancelInvestigation = useCallback(() => {
    if (selectedProject?.id && selectedIssue) {
      cancelIssueInvestigation(selectedProject.id, selectedIssue.number);
    }
  }, [selectedProject?.id, selectedIssue]);

  const handleCreateTask = useCallback(async () => {
    if (!selectedProject?.id || !selectedIssue) return;
    const result = await window.electronAPI.github.createTaskFromInvestigation(
      selectedProject.id, selectedIssue.number
    );
    if (result.success && result.data?.specId) {
      // Load tasks FIRST so the new task is in the list when we update the store
      // This prevents the tasks-changed effect from clearing the specId due to race condition
      await loadTasks(selectedProject.id);
      // Update the investigation store with the specId so the UI knows a task was created
      setInvestigationSpecId(selectedProject.id, selectedIssue.number, result.data.specId);
    } else if (!result.success) {
      toast({
        title: t('errors.taskCreationFailed'),
        description: result?.error ?? t('errors.unknownError'),
        variant: 'destructive',
      });
    }
  }, [selectedProject?.id, selectedIssue, setInvestigationSpecId, toast]);

  const handleDismissIssue = useCallback(async (reason: InvestigationDismissReason) => {
    if (!selectedProject?.id || !selectedIssue) return;
    await window.electronAPI.github.dismissIssue(selectedProject.id, selectedIssue.number, reason);
    dismissInvestigation(selectedProject.id, selectedIssue.number, reason);
  }, [selectedProject?.id, selectedIssue, dismissInvestigation]);

  const handlePostToGitHub = useCallback(async () => {
    if (!selectedProject?.id || !selectedIssue) return;
    const result = await window.electronAPI.github.postInvestigationToGitHub(selectedProject.id, selectedIssue.number);
    if (result?.success) {
      // Track that we posted — use the comment ID if available, or a timestamp marker
      const commentId = result.data?.commentId ?? Date.now();
      setInvestigationGithubCommentId(selectedProject.id, selectedIssue.number, commentId);
      toast({
        title: t('investigation.toast.postedToGitHub', { issueNumber: selectedIssue.number }),
      });
    } else {
      toast({
        title: t('investigation.toast.postToGitHubFailed'),
        description: result?.error ?? t('errors.unknownError'),
        variant: 'destructive',
      });
    }
  }, [selectedProject?.id, selectedIssue, setInvestigationGithubCommentId, toast, t]);

  const [isPostingToGitHub, setIsPostingToGitHub] = useState(false);
  const handlePostToGitHubWrapped = useCallback(async () => {
    setIsPostingToGitHub(true);
    try {
      await handlePostToGitHub();
    } finally {
      setIsPostingToGitHub(false);
    }
  }, [handlePostToGitHub]);

  // Get per-issue investigation state for the selected issue
  // Subscribe to investigation entry directly from store state - this ensures reactivity
  // when setSpecId() updates the store, the component will re-render immediately
  const selectedIssueEntry = useInvestigationStore((state) => {
    if (!selectedProject?.id || !selectedIssue) return null;
    return state.investigations[`${selectedProject.id}:${selectedIssue.number}`] ?? null;
  });

  // Derive the state machine value from the entry
  const selectedIssueInvestigationState = useMemo(() => {
    if (!selectedProject?.id || !selectedIssue) return undefined;
    return getDerivedInvestigationState(selectedProject.id, selectedIssue.number);
  }, [selectedProject?.id, selectedIssue, getDerivedInvestigationState]);

  // Not connected state
  if (!syncStatus?.connected) {
    return <NotConnectedState error={syncStatus?.error || null} onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <IssueListHeader
        repoFullName={syncStatus.repoFullName ?? ""}
        openIssuesCount={getOpenIssuesCount()}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        investigationStateFilter={investigationStateFilter}
        onInvestigationStateFilterChange={setInvestigationStateFilter}
        investigationStateCounts={investigationStateCounts}
        showDismissed={showDismissed}
        onToggleShowDismissed={() => setShowDismissed(!showDismissed)}
        activeInvestigationCount={activeInvestigations.length}
        onCancelAllInvestigations={selectedProject?.id ? () => cancelAllIssueInvestigations(selectedProject.id) : undefined}
      >
        <BulkActionBar
          selectedCount={selectedIssueNumbers.size}
          onBulkAction={handleBulkAction}
          isOperating={isBulkOperating}
          onInvestigateSelected={handleBulkInvestigate}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
        />
      </IssueListHeader>

      {/* Bulk Results Panel */}
      {bulkResult && (
        <BulkResultsPanel
          result={bulkResult}
          onRetry={() => { /* retry logic handled externally */ }}
          onDismiss={clearBulkResult}
        />
      )}

      {/* Content — 2-panel layout (investigation panel is inline in detail view) */}
      <ResizablePanels
        storageKey="github-issues-panel-2"
        defaultLeftWidth={50}
        minLeftWidth={25}
        maxLeftWidth={75}
        leftPanel={
          <section className="flex flex-col h-full border-r border-border" aria-label={t('panels.issueList')} tabIndex={-1}>
            <IssueFilterBar
              filters={issueFilters}
              reporters={reporters}
              hasActiveFilters={hasActiveFilters}
              onSearchChange={setSearchQuery}
              onReportersChange={setReporters}
              onStatusesChange={setStatuses}
              onSortChange={setSortBy}
              onClearFilters={clearFilters}
            />
            <IssueList
              issues={investigationFilteredIssues}
              selectedIssueNumber={selectedIssueNumber}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMore && !isSearchActive}
              error={error}
              onSelectIssue={selectIssue}
              onInvestigate={handleInvestigate}
              onLoadMore={!isSearchActive ? handleLoadMore : undefined}
              selectedIssueNumbers={selectedIssueNumbers}
              onToggleSelect={handleToggleSelect}
              investigationStates={investigationStatesMap}
              onViewTask={onNavigateToTask}
            />
          </section>
        }
        rightPanel={
          <section className="flex flex-col h-full min-w-0 overflow-hidden" aria-label={t('panels.issueDetail')} tabIndex={-1}>
            {selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onInvestigate={() => handleInvestigate(selectedIssue)}
                linkedTaskId={issueToTaskMap.get(selectedIssue.number)}
                onViewTask={onNavigateToTask}
                projectId={selectedProject?.id}
                onEditTitle={handleEditTitle}
                onEditBody={handleEditBody}
                onClose={handleCloseIssue}
                onReopen={handleReopenIssue}
                onComment={handleAddComment}
                onAddLabels={handleAddLabels}
                onRemoveLabels={handleRemoveLabels}
                repoLabels={repoLabels}
                onAddAssignees={handleAddAssignees}
                onRemoveAssignees={handleRemoveAssignees}
                collaborators={collaborators}
                dependencies={dependencies}
                isDepsLoading={isDepsLoading}
                depsError={depsError}
                onNavigateDependency={selectIssue}
                // Investigation system
                investigationState={selectedIssueInvestigationState}
                investigationReport={selectedIssueEntry?.report ?? null}
                investigationProgress={selectedIssueEntry?.progress?.progress}
                investigationProgressData={selectedIssueEntry?.progress ?? null}
                isInvestigating={selectedIssueEntry?.isInvestigating ?? false}
                investigationError={selectedIssueEntry?.error ?? null}
                investigationStartedAt={selectedIssueEntry?.startedAt ?? null}
                investigationCompletedAt={selectedIssueEntry?.completedAt ?? null}
                investigationSpecId={selectedIssueEntry?.specId ?? null}
                onCancelInvestigation={handleCancelInvestigation}
                onCreateTask={handleCreateTask}
                onDismissIssue={handleDismissIssue}
                onPostToGitHub={handlePostToGitHubWrapped}
                isPostingToGitHub={isPostingToGitHub}
                githubCommentId={selectedIssueEntry?.githubCommentId ?? null}
                postedAt={selectedIssueEntry?.postedAt ?? null}
                investigationActivityLog={selectedIssueEntry?.activityLog}
                investigationHasResumeSessions={selectedIssueEntry?.hasResumeSessions ?? false}
              />
            ) : (
              <EmptyState message={t('issues.selectToView')} />
            )}
          </section>
        }
      />

      {/* Batch Review Wizard (Proactive workflow) */}
      <BatchReviewWizard
        isOpen={isWizardOpen}
        onClose={closeWizard}
        projectId={selectedProject?.id || ""}
        onStartAnalysis={startAnalysis}
        onApproveBatches={approveBatches}
        analysisProgress={analysisProgress}
        analysisResult={analysisResult}
        analysisError={analysisError}
        isAnalyzing={isAnalyzing}
        isApproving={isApproving}
      />

      {/* GitHub Setup Modal */}
      {selectedProject && (
        <GitHubSetupModal
          open={showGitHubSetup}
          onOpenChange={setShowGitHubSetup}
          project={selectedProject}
          onComplete={() => {
            setShowGitHubSetup(false);
            openWizard();
            startAnalysis();
          }}
          onSkip={() => setShowGitHubSetup(false)}
        />
      )}

      {/* Label Creation Consent Dialog */}
      <AlertDialog open={showLabelConsent} onOpenChange={setShowLabelConsent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('investigation.labelConsent.title', 'Label Creation Notice')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('investigation.labelConsent.body', 'The first investigation will create up to 5 auto-claude:* labels on your GitHub repository to categorize investigation results. These labels are used for filtering and organization.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { pendingInvestigationRef.current = null; }}>
              {t('buttons.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConsentConfirm}>
              {t('investigation.labelConsent.confirm', 'Continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
