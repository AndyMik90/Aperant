import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../stores/project-store";
import { useTaskStore } from "../stores/task-store";
import {
  useLinearIssues,
  useLinearInvestigation,
  useIssueFiltering,
} from "./linear-issues/hooks";
import {
  NotConnectedState,
  EmptyState,
  IssueListHeader,
  IssueList,
  IssueDetail,
  InvestigationDialog,
} from "./linear-issues/components";
import type { LinearIssue } from "../../shared/types";
import type { LinearIssuesProps } from "./linear-issues/types";

export function LinearIssues({
  onOpenSettings,
  onNavigateToTask,
}: LinearIssuesProps) {
  const { t } = useTranslation("common");
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const tasks = useTaskStore((state) => state.tasks);

  const {
    syncStatus,
    isLoading,
    error,
    selectedIssueId,
    selectedIssue,
    newIssues,
    clearNewIssues,
    filterState,
    selectIssue,
    getFilteredIssues,
    getActiveIssuesCount,
    handleRefresh,
    handleFilterChange,
    handleSearchStart,
    handleSearchClear,
  } = useLinearIssues(selectedProject?.id);

  const {
    investigationStatus,
    lastInvestigationResult,
    startInvestigation,
    resetInvestigationStatus,
  } = useLinearInvestigation(selectedProject?.id);

  const { searchQuery, setSearchQuery, filteredIssues } = useIssueFiltering(
    getFilteredIssues(),
    {
      onSearchStart: handleSearchStart,
      onSearchClear: handleSearchClear,
    },
  );

  const [showInvestigateDialog, setShowInvestigateDialog] = useState(false);
  const [selectedIssueForInvestigation, setSelectedIssueForInvestigation] =
    useState<LinearIssue | null>(null);

  // Build a map of Linear issue IDs to task IDs for quick lookup
  const issueToTaskMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (task.metadata?.linearIssueId) {
        map.set(task.metadata.linearIssueId, task.specId || task.id);
      }
    }
    return map;
  }, [tasks]);

  const handleInvestigate = useCallback((issue: LinearIssue) => {
    setSelectedIssueForInvestigation(issue);
    setShowInvestigateDialog(true);
  }, []);

  const handleStartInvestigation = useCallback(
    (selectedCommentIds: string[]) => {
      if (selectedIssueForInvestigation) {
        startInvestigation(selectedIssueForInvestigation, selectedCommentIds);
      }
    },
    [selectedIssueForInvestigation, startInvestigation],
  );

  const handleCloseDialog = useCallback(() => {
    setShowInvestigateDialog(false);
    resetInvestigationStatus();
  }, [resetInvestigationStatus]);

  // Auto-investigate new issues that don't already have linked tasks
  const autoInvestigateQueueRef = useRef<LinearIssue[]>([]);
  const isAutoInvestigatingRef = useRef(false);

  useEffect(() => {
    if (newIssues.length === 0) return;

    // Filter out issues that already have linked tasks
    const unlinked = newIssues.filter((issue) => !issueToTaskMap.has(issue.id));
    clearNewIssues();

    if (unlinked.length === 0) return;

    // Add to queue
    autoInvestigateQueueRef.current.push(...unlinked);

    // Process queue sequentially
    const processQueue = () => {
      if (isAutoInvestigatingRef.current) return;
      const next = autoInvestigateQueueRef.current.shift();
      if (!next) return;

      isAutoInvestigatingRef.current = true;
      // Auto-investigate with all comments included (empty array = include all)
      startInvestigation(next);
    };

    processQueue();
  }, [newIssues, issueToTaskMap, clearNewIssues, startInvestigation]);

  // When an investigation completes, process the next queued issue
  useEffect(() => {
    if (
      investigationStatus.phase === "complete" ||
      investigationStatus.phase === "error"
    ) {
      isAutoInvestigatingRef.current = false;
      const next = autoInvestigateQueueRef.current.shift();
      if (next) {
        isAutoInvestigatingRef.current = true;
        startInvestigation(next);
      }
    }
  }, [investigationStatus.phase, startInvestigation]);

  // Not connected state
  if (!syncStatus?.connected) {
    return (
      <NotConnectedState
        error={syncStatus?.error || null}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <IssueListHeader
        teamName={syncStatus.teamName ?? ""}
        activeIssuesCount={getActiveIssuesCount()}
        isLoading={isLoading}
        searchQuery={searchQuery}
        filterState={filterState}
        onSearchChange={setSearchQuery}
        onFilterChange={handleFilterChange}
        onRefresh={handleRefresh}
      />

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Issue List */}
        <div className="w-1/2 border-r border-border flex flex-col">
          <IssueList
            issues={filteredIssues}
            selectedIssueId={selectedIssueId}
            isLoading={isLoading}
            error={error}
            onSelectIssue={selectIssue}
            onInvestigate={handleInvestigate}
            onRetry={handleRefresh}
            onOpenSettings={onOpenSettings}
          />
        </div>

        {/* Issue Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              onInvestigate={() => handleInvestigate(selectedIssue)}
              investigationResult={
                lastInvestigationResult?.issueId === selectedIssue.id
                  ? lastInvestigationResult
                  : null
              }
              linkedTaskId={issueToTaskMap.get(selectedIssue.id)}
              onViewTask={onNavigateToTask}
              projectId={selectedProject?.id}
            />
          ) : (
            <EmptyState
              message={t(
                "linear.selectIssue",
                "Select an issue to view details",
              )}
            />
          )}
        </div>
      </div>

      {/* Investigation Dialog */}
      <InvestigationDialog
        open={showInvestigateDialog}
        onOpenChange={setShowInvestigateDialog}
        selectedIssue={selectedIssueForInvestigation}
        investigationStatus={investigationStatus}
        onStartInvestigation={handleStartInvestigation}
        onClose={handleCloseDialog}
        projectId={selectedProject?.id}
      />
    </div>
  );
}
