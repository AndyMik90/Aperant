import { useState, useCallback, useMemo, useEffect } from "react";
import { useProjectStore } from "../stores/project-store";
import { useTaskStore } from "../stores/task-store";
import {
  useGitHubIssues,
  useGitHubInvestigation,
  useIssueFiltering,
  useAutoFix,
} from "./github-issues/hooks";
import { useMultiRepoGitHubIssues } from "./github-issues/hooks/useMultiRepoGitHubIssues";
import { useAnalyzePreview } from "./github-issues/hooks/useAnalyzePreview";
import {
  NotConnectedState,
  EmptyState,
  IssueListHeader,
  IssueList,
  IssueDetail,
  InvestigationDialog,
  BatchReviewWizard,
} from "./github-issues/components";
import { RepoFilterDropdown } from "./github-issues/components/RepoFilterDropdown";
import { GitHubSetupModal } from "./GitHubSetupModal";
import type { GitHubIssue } from "../../shared/types";
import type { GitHubIssuesProps } from "./github-issues/types";

export function GitHubIssues({ onOpenSettings, onNavigateToTask }: GitHubIssuesProps) {
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const tasks = useTaskStore((state) => state.tasks);

  const isCustomer = selectedProject?.type === 'customer';

  // Single-repo hook (active when NOT a customer)
  const singleRepo = useGitHubIssues(isCustomer ? undefined : selectedProject?.id);

  // Multi-repo hook (active when IS a customer)
  const multiRepo = useMultiRepoGitHubIssues(isCustomer ? selectedProject?.id : undefined);

  // Select the active hook's data
  const {
    syncStatus,
    isLoading,
    isLoadingMore,
    error,
    selectedIssueNumber,
    selectedIssue,
    filterState,
    hasMore,
    selectIssue,
    getFilteredIssues,
    getOpenIssuesCount,
    handleRefresh,
    handleFilterChange,
    handleLoadMore,
    handleSearchStart,
    handleSearchClear,
  } = isCustomer ? multiRepo : singleRepo;

  // Resolve child project ID from selected issue's repoFullName (for multi-repo)
  const resolvedChildProjectId = useMemo(() => {
    if (!isCustomer || !selectedIssue || !multiRepo.syncStatus?.repos) return undefined;
    const match = multiRepo.syncStatus.repos.find(r => r.repoFullName === selectedIssue.repoFullName);
    return match?.projectId;
  }, [isCustomer, selectedIssue, multiRepo.syncStatus?.repos]);

  const effectiveProjectId = isCustomer ? resolvedChildProjectId : selectedProject?.id;

  const {
    investigationStatus,
    lastInvestigationResult,
    startInvestigation,
    resetInvestigationStatus,
  } = useGitHubInvestigation(effectiveProjectId);

  const { searchQuery, setSearchQuery, filteredIssues, isSearchActive } = useIssueFiltering(
    getFilteredIssues(),
    {
      onSearchStart: handleSearchStart,
      onSearchClear: handleSearchClear,
    }
  );

  const {
    config: autoFixConfig,
    getQueueItem: getAutoFixQueueItem,
    isBatchRunning,
    batchProgress,
    toggleAutoFix,
    checkForNewIssues,
  } = useAutoFix(effectiveProjectId);

  // Analyze & Group Issues (proactive workflow) - disabled for customer multi-repo
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
  } = useAnalyzePreview({ projectId: isCustomer ? "" : (selectedProject?.id || "") });

  const [showInvestigateDialog, setShowInvestigateDialog] = useState(false);
  const [selectedIssueForInvestigation, setSelectedIssueForInvestigation] =
    useState<GitHubIssue | null>(null);
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

  // Enhanced refresh that also checks for new auto-fix issues
  const handleRefreshWithAutoFix = useCallback(() => {
    handleRefresh();
    // Also check for new auto-fix issues if enabled
    if (autoFixConfig?.enabled) {
      checkForNewIssues();
    }
  }, [handleRefresh, autoFixConfig?.enabled, checkForNewIssues]);

  const handleInvestigate = useCallback((issue: GitHubIssue) => {
    setSelectedIssueForInvestigation(issue);
    setShowInvestigateDialog(true);
  }, []);

  const handleStartInvestigation = useCallback(
    (selectedCommentIds: number[]) => {
      if (selectedIssueForInvestigation) {
        startInvestigation(selectedIssueForInvestigation, selectedCommentIds);
      }
    },
    [selectedIssueForInvestigation, startInvestigation]
  );

  const handleCloseDialog = useCallback(() => {
    setShowInvestigateDialog(false);
    resetInvestigationStatus();
  }, [resetInvestigationStatus]);

  // Derive header repo name
  const headerRepoName = isCustomer
    ? (multiRepo.repos.length > 0
      ? (multiRepo.selectedRepo === 'all'
        ? `${multiRepo.repos.length} repos`
        : multiRepo.selectedRepo)
      : '')
    : (singleRepo.syncStatus?.repoFullName ?? "");

  // Not connected state
  if (!syncStatus?.connected) {
    return <NotConnectedState error={syncStatus?.error || null} onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <IssueListHeader
        repoFullName={headerRepoName}
        openIssuesCount={getOpenIssuesCount()}
        isLoading={isLoading}
        searchQuery={searchQuery}
        filterState={filterState}
        onSearchChange={setSearchQuery}
        onFilterChange={handleFilterChange}
        onRefresh={handleRefreshWithAutoFix}
        autoFixEnabled={isCustomer ? undefined : autoFixConfig?.enabled}
        autoFixRunning={isCustomer ? undefined : isBatchRunning}
        autoFixProcessing={isCustomer ? undefined : batchProgress?.totalIssues}
        onAutoFixToggle={isCustomer ? undefined : toggleAutoFix}
        onAnalyzeAndGroup={isCustomer ? undefined : openWizard}
        isAnalyzing={isCustomer ? undefined : isAnalyzing}
      />

      {/* Repo filter dropdown for multi-repo mode */}
      {isCustomer && multiRepo.repos.length > 1 && (
        <div className="shrink-0 px-4 pb-3 border-b border-border">
          <RepoFilterDropdown
            repos={multiRepo.repos}
            selectedRepo={multiRepo.selectedRepo}
            onRepoChange={multiRepo.setSelectedRepo}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Issue List */}
        <div className="w-1/2 border-r border-border flex flex-col">
          <IssueList
            issues={filteredIssues}
            selectedIssueNumber={selectedIssueNumber}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore && !isSearchActive}
            error={error}
            onSelectIssue={selectIssue}
            onInvestigate={handleInvestigate}
            onLoadMore={!isSearchActive ? handleLoadMore : undefined}
            onRetry={handleRefresh}
            onOpenSettings={onOpenSettings}
            showRepoBadge={isCustomer}
          />
        </div>

        {/* Issue Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedIssue ? (
            <IssueDetail
              issue={selectedIssue}
              onInvestigate={() => handleInvestigate(selectedIssue)}
              investigationResult={
                lastInvestigationResult?.issueNumber === selectedIssue.number
                  ? lastInvestigationResult
                  : null
              }
              linkedTaskId={issueToTaskMap.get(selectedIssue.number)}
              onViewTask={onNavigateToTask}
              projectId={effectiveProjectId}
              autoFixConfig={autoFixConfig}
              autoFixQueueItem={getAutoFixQueueItem(selectedIssue.number)}
            />
          ) : (
            <EmptyState message="Select an issue to view details" />
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
        projectId={effectiveProjectId}
      />

      {/* Batch Review Wizard (Proactive workflow) - not available in multi-repo mode */}
      {!isCustomer && (
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
      )}

      {/* GitHub Setup Modal - shown when GitHub module is not configured */}
      {selectedProject && !isCustomer && (
        <GitHubSetupModal
          open={showGitHubSetup}
          onOpenChange={setShowGitHubSetup}
          project={selectedProject}
          onComplete={() => {
            setShowGitHubSetup(false);
            // Retry the analysis after setup is complete
            openWizard();
            startAnalysis();
          }}
          onSkip={() => setShowGitHubSetup(false)}
        />
      )}
    </div>
  );
}
