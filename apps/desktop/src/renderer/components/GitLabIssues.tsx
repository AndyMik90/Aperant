import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../stores/project-store";
import { useTaskStore } from "../stores/task-store";
import { useGitLabIssues, useGitLabInvestigation, useIssueFiltering } from "./gitlab-issues/hooks";
import {
  NotConnectedState,
  EmptyState,
  IssueListHeader,
  IssueList,
  IssueDetail,
  InvestigationDialog,
} from "./gitlab-issues/components";
import type { GitLabIssue } from "../../shared/types";
import type { GitLabIssuesProps } from "./gitlab-issues/types";

export function GitLabIssues({ onOpenSettings, onNavigateToTask }: GitLabIssuesProps) {
  const { t } = useTranslation("gitlab");
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const tasks = useTaskStore((state) => state.tasks);

  const {
    syncStatus,
    isLoading,
    error,
    selectedIssueIid,
    selectedIssue,
    filterState,
    selectIssue,
    getFilteredIssues,
    getOpenIssuesCount,
    handleRefresh,
    handleFilterChange,
  } = useGitLabIssues(selectedProject?.id);

  const {
    investigationStatus,
    lastInvestigationResult,
    startInvestigation,
    resetInvestigationStatus,
  } = useGitLabInvestigation(selectedProject?.id);

  const { searchQuery, setSearchQuery, filteredIssues } = useIssueFiltering(getFilteredIssues());

  const [showInvestigateDialog, setShowInvestigateDialog] = useState(false);
  const [selectedIssueForInvestigation, setSelectedIssueForInvestigation] =
    useState<GitLabIssue | null>(null);

  // Build a map of GitLab issue IIDs to task IDs for quick lookup
  const issueToTaskMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const task of tasks) {
      if (task.metadata?.gitlabIssueIid) {
        map.set(task.metadata.gitlabIssueIid, task.specId || task.id);
      }
    }
    return map;
  }, [tasks]);

  const handleInvestigate = useCallback((issue: GitLabIssue) => {
    setSelectedIssueForInvestigation(issue);
    setShowInvestigateDialog(true);
  }, []);

  const handleStartInvestigation = useCallback(
    (selectedNoteIds: number[]) => {
      if (selectedIssueForInvestigation) {
        startInvestigation(selectedIssueForInvestigation, selectedNoteIds);
      }
    },
    [selectedIssueForInvestigation, startInvestigation]
  );

  const handleCloseDialog = useCallback(() => {
    setShowInvestigateDialog(false);
    resetInvestigationStatus();
  }, [resetInvestigationStatus]);

  // Not connected state
  if (!syncStatus?.connected) {
    return <NotConnectedState error={syncStatus?.error || null} onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <IssueListHeader
        projectPath={syncStatus.projectPathWithNamespace ?? ""}
        openIssuesCount={getOpenIssuesCount()}
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
        <div className="w-1/2 border-e border-border flex flex-col">
          <IssueList
            issues={filteredIssues}
            selectedIssueIid={selectedIssueIid}
            isLoading={isLoading}
            error={error}
            onSelectIssue={selectIssue}
            onInvestigate={handleInvestigate}
          />
        </div>

        {/* Issue Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              onInvestigate={() => handleInvestigate(selectedIssue)}
              investigationResult={
                lastInvestigationResult?.issueIid === selectedIssue.iid
                  ? lastInvestigationResult
                  : null
              }
              linkedTaskId={issueToTaskMap.get(selectedIssue.iid)}
              onViewTask={onNavigateToTask}
            />
          ) : (
            <EmptyState message={t("empty.selectIssue")} />
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
