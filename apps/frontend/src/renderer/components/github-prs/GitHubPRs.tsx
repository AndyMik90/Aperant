import { useCallback, useEffect, useMemo } from "react";
import { GitPullRequest, RefreshCw, ExternalLink, Settings, User, Clock, FileDiff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../../stores/project-store";
import { useGitHubPRs, usePRFiltering } from "./hooks";
import { useMultiRepoGitHubPRs, makePRId, parsePRId } from "./hooks/useMultiRepoGitHubPRs";
import { PRList, PRDetail, PRFilterBar } from "./components";
import { RepoFilterDropdown } from "../github-issues/components/RepoFilterDropdown";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { ResizablePanels } from "../ui/resizable-panels";
import { cn } from "../../lib/utils";
import type { MultiRepoPRData } from "../../../shared/types";

interface GitHubPRsProps {
  onOpenSettings?: () => void;
  isActive?: boolean;
}

function NotConnectedState({
  error,
  onOpenSettings,
  t,
}: {
  error: string | null;
  onOpenSettings?: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <GitPullRequest className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-medium mb-2">{t("prReview.notConnected")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{error || t("prReview.connectPrompt")}</p>
        {onOpenSettings && (
          <Button onClick={onOpenSettings} variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            {t("prReview.openSettings")}
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <GitPullRequest className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>{message}</p>
      </div>
    </div>
  );
}

function formatRelativeDate(dateString: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(dateString);
  const now = new Date();
  // Clamp negative diff to zero to handle future timestamps gracefully
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return t('time.minutesAgo', { count: diffMins });
    }
    return t('time.hoursAgo', { count: diffHours });
  }
  if (diffDays === 1) return t('time.yesterday');
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  if (diffDays < 30) return t('time.weeksAgo', { count: Math.floor(diffDays / 7) });
  return date.toLocaleDateString();
}

/** Simplified PR detail for multi-repo read-only mode */
function MultiRepoPRDetail({ pr }: { pr: MultiRepoPRData }) {
  const { t } = useTranslation("common");
  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <GitPullRequest className="h-5 w-5 mt-1 text-success shrink-0" />
          <div>
            <h2 className="text-lg font-semibold">{pr.title}</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <span>#{pr.number}</span>
              <span>&middot;</span>
              <Badge variant="secondary" className="text-xs">{pr.repoFullName}</Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {pr.author.login}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatRelativeDate(pr.updatedAt, t)}
          </span>
          <span className="flex items-center gap-1">
            <FileDiff className="h-3.5 w-3.5" />
            <span className="text-success">+{pr.additions}</span>
            <span className="text-destructive">-{pr.deletions}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{pr.headRefName}</Badge>
          <span className="text-xs text-muted-foreground">&rarr;</span>
          <Badge variant="outline" className="text-xs">{pr.baseRefName}</Badge>
        </div>

        {pr.body && (
          <div className="mt-4 prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg">
              {pr.body}
            </pre>
          </div>
        )}

        <a
          href={pr.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("prReview.viewOnGitHub")}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </ScrollArea>
  );
}

/** Multi-repo PR list item */
function MultiRepoPRListItem({
  pr,
  isSelected,
  onClick,
}: {
  pr: MultiRepoPRData;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full p-4 text-left transition-colors hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
    >
      <div className="flex items-start gap-3">
        <GitPullRequest className="h-5 w-5 mt-0.5 text-success shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm text-muted-foreground">#{pr.number}</span>
            <Badge variant="outline" className="text-xs">
              {pr.headRefName}
            </Badge>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
              {pr.repoFullName}
            </Badge>
          </div>
          <h3 className="font-medium text-sm truncate">{pr.title}</h3>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {pr.author.login}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeDate(pr.updatedAt, t)}
            </span>
            {(pr.additions > 0 || pr.deletions > 0) && (
              <span className="flex items-center gap-1">
                <FileDiff className="h-3 w-3" />
                <span className="text-success">+{pr.additions}</span>
                <span className="text-destructive">-{pr.deletions}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/** Multi-repo Customer PR view */
function MultiRepoPRView({
  multiRepo,
  onOpenSettings,
  t,
  fullPRDetail,
}: {
  multiRepo: ReturnType<typeof useMultiRepoGitHubPRs>;
  onOpenSettings?: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  fullPRDetail?: React.ReactNode;
}) {
  const { prs, isLoading, error, selectedPRId, selectedPR, isConnected, selectPR, refresh, repos, selectedRepo, setSelectedRepo } = multiRepo;

  if (!isConnected) {
    return <NotConnectedState error={error} onOpenSettings={onOpenSettings} t={t} />;
  }

  const headerRepoName = repos.length > 0
    ? (selectedRepo === 'all' ? t('prReview.reposCount', { count: repos.length }) : selectedRepo)
    : '';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            {t("prReview.pullRequests")}
          </h2>
          {headerRepoName && (
            <span className="text-xs text-muted-foreground">{headerRepoName}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {prs.length} {t("prReview.open")}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Repo filter dropdown */}
      {repos.length > 1 && (
        <div className="shrink-0 px-4 pb-3 pt-3 border-b border-border">
          <RepoFilterDropdown
            repos={repos}
            selectedRepo={selectedRepo}
            onRepoChange={setSelectedRepo}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* PR List */}
        <div className="w-1/2 border-r border-border flex flex-col">
          {isLoading && prs.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <GitPullRequest className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                <p>{t('prReview.loadingPRs')}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center text-destructive">
                <p className="text-sm">{error}</p>
              </div>
            </div>
          ) : prs.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <GitPullRequest className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t('prReview.noOpenPRs')}</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="divide-y divide-border">
                {prs.map((pr) => {
                  const prCompositeId = makePRId(pr.repoFullName, pr.number);
                  return (
                    <MultiRepoPRListItem
                      key={`${pr.repoFullName}-${pr.number}`}
                      pr={pr}
                      isSelected={selectedPRId === prCompositeId}
                      onClick={() => selectPR(prCompositeId)}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* PR Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedPR ? (
            fullPRDetail || <MultiRepoPRDetail pr={selectedPR} />
          ) : (
            <EmptyState message={t("prReview.selectPRToView")} />
          )}
        </div>
      </div>
    </div>
  );
}

export function GitHubPRs({ onOpenSettings, isActive = false }: GitHubPRsProps) {
  const { t } = useTranslation("common");
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const isCustomer = selectedProject?.type === 'customer';

  // Multi-repo hook (active when IS a customer)
  const multiRepo = useMultiRepoGitHubPRs(isCustomer ? selectedProject?.id : undefined);

  // Resolve child project ID from selected PR's repoFullName (for multi-repo)
  const resolvedChildProjectId = useMemo(() => {
    if (!isCustomer || !multiRepo.selectedPR || !multiRepo.syncStatus?.repos) return undefined;
    const match = multiRepo.syncStatus.repos.find(r => r.repoFullName === multiRepo.selectedPR?.repoFullName);
    return match?.projectId;
  }, [isCustomer, multiRepo.selectedPR, multiRepo.syncStatus?.repos]);

  // Single-repo hook: activated with resolved child project for customer mode
  const singleRepo = useGitHubPRs(isCustomer ? resolvedChildProjectId : selectedProject?.id, { isActive });

  const {
    prs,
    isLoading,
    isLoadingMore,
    isLoadingPRDetails,
    error,
    selectedPRNumber,
    reviewResult,
    reviewProgress,
    startedAt,
    isReviewing,
    isExternalReview,
    previousReviewResult,
    reviewError,
    hasMore,
    selectPR,
    runReview,
    runFollowupReview,
    checkNewCommits,
    cancelReview,
    postReview,
    postComment,
    mergePR,
    assignPR,
    markReviewPosted,
    refresh,
    loadMore,
    isConnected,
    repoFullName,
    getReviewStateForPR,
    selectedPR,
  } = singleRepo;

  // Get newCommitsCheck for the selected PR (other values come from hook to ensure consistency)
  const selectedPRReviewState = selectedPRNumber ? getReviewStateForPR(selectedPRNumber) : null;
  const storedNewCommitsCheck = selectedPRReviewState?.newCommitsCheck ?? null;

  // PR filtering
  const {
    filteredPRs,
    contributors,
    filters,
    setSearchQuery,
    setContributors,
    setStatuses,
    setSortBy,
    clearFilters,
    hasActiveFilters,
  } = usePRFiltering(prs, getReviewStateForPR);

  // Sync UI state when PR list updates (e.g., after auto-refresh from review completion)
  useEffect(() => {
    if (isCustomer) return;
    if (selectedPRNumber && prs.length > 0) {
      const selectedStillExists = prs.some(pr => pr.number === selectedPRNumber);
      if (!selectedStillExists) {
        selectPR(null);
      }
    }
  }, [prs, selectedPRNumber, selectPR, isCustomer]);

  // Sync PR selection from multi-repo to single-repo for customer mode.
  // The multi-repo hook stores a composite ID (repo#number), but the single-repo
  // hook needs the plain PR number to load details from that specific repo.
  const multiRepoSelectedNumber = useMemo(() => {
    if (!multiRepo.selectedPRId) return null;
    return parsePRId(multiRepo.selectedPRId).number;
  }, [multiRepo.selectedPRId]);

  useEffect(() => {
    if (!isCustomer || !resolvedChildProjectId || !multiRepoSelectedNumber) return;
    if (prs.length > 0) {
      const prExists = prs.some(pr => pr.number === multiRepoSelectedNumber);
      if (prExists && selectedPRNumber !== multiRepoSelectedNumber) {
        selectPR(multiRepoSelectedNumber);
      }
    }
  }, [isCustomer, resolvedChildProjectId, multiRepoSelectedNumber, prs, selectedPRNumber, selectPR]);

  const handleRunReview = useCallback(() => {
    if (selectedPRNumber) {
      runReview(selectedPRNumber);
    }
  }, [selectedPRNumber, runReview]);

  const handleRunFollowupReview = useCallback(() => {
    if (selectedPRNumber) {
      runFollowupReview(selectedPRNumber);
    }
  }, [selectedPRNumber, runFollowupReview]);

  const handleCheckNewCommits = useCallback(async () => {
    if (selectedPRNumber) {
      return await checkNewCommits(selectedPRNumber);
    }
    return { hasNewCommits: false, newCommitCount: 0 };
  }, [selectedPRNumber, checkNewCommits]);

  const handleCancelReview = useCallback(() => {
    if (selectedPRNumber) {
      cancelReview(selectedPRNumber);
    }
  }, [selectedPRNumber, cancelReview]);

  const handlePostReview = useCallback(
    async (
      selectedFindingIds?: string[],
      options?: { forceApprove?: boolean }
    ): Promise<boolean> => {
      if (selectedPRNumber && reviewResult) {
        return await postReview(selectedPRNumber, selectedFindingIds, options);
      }
      return false;
    },
    [selectedPRNumber, reviewResult, postReview]
  );

  const handlePostComment = useCallback(
    async (body: string): Promise<boolean> => {
      if (selectedPRNumber) {
        return await postComment(selectedPRNumber, body);
      }
      return false;
    },
    [selectedPRNumber, postComment]
  );

  const handleMergePR = useCallback(
    async (mergeMethod?: "merge" | "squash" | "rebase") => {
      if (selectedPRNumber) {
        await mergePR(selectedPRNumber, mergeMethod);
      }
    },
    [selectedPRNumber, mergePR]
  );

  const handleAssignPR = useCallback(
    async (username: string) => {
      if (selectedPRNumber) {
        await assignPR(selectedPRNumber, username);
      }
    },
    [selectedPRNumber, assignPR]
  );

  const handleGetLogs = useCallback(async () => {
    const effectiveProjectId = isCustomer ? resolvedChildProjectId : selectedProjectId;
    if (effectiveProjectId && selectedPRNumber) {
      return await window.electronAPI.github.getPRLogs(effectiveProjectId, selectedPRNumber);
    }
    return null;
  }, [isCustomer, resolvedChildProjectId, selectedProjectId, selectedPRNumber]);

  const handleMarkReviewPosted = useCallback(async (prNumber: number) => {
    await markReviewPosted(prNumber);
  }, [markReviewPosted]);

  // Customer multi-repo view
  if (isCustomer) {
    return (
      <MultiRepoPRView
        multiRepo={multiRepo}
        onOpenSettings={onOpenSettings}
        t={t}
        fullPRDetail={
          resolvedChildProjectId && selectedPR && multiRepoSelectedNumber === selectedPR.number ? (
            <PRDetail
              pr={selectedPR}
              projectId={resolvedChildProjectId}
              reviewResult={reviewResult}
              previousReviewResult={previousReviewResult}
              reviewProgress={reviewProgress}
              startedAt={startedAt}
              isReviewing={isReviewing}
              isExternalReview={isExternalReview}
              reviewError={reviewError}
              initialNewCommitsCheck={storedNewCommitsCheck}
              isActive={isActive}
              isLoadingFiles={isLoadingPRDetails}
              onRunReview={handleRunReview}
              onRunFollowupReview={handleRunFollowupReview}
              onCheckNewCommits={handleCheckNewCommits}
              onCancelReview={handleCancelReview}
              onPostReview={handlePostReview}
              onPostComment={handlePostComment}
              onMergePR={handleMergePR}
              onAssignPR={handleAssignPR}
              onGetLogs={handleGetLogs}
              onMarkReviewPosted={handleMarkReviewPosted}
            />
          ) : undefined
        }
      />
    );
  }

  // Not connected state
  if (!isConnected) {
    return <NotConnectedState error={error} onOpenSettings={onOpenSettings} t={t} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            {t("prReview.pullRequests")}
          </h2>
          {repoFullName && (
            <a
              href={`https://github.com/${repoFullName}/pulls`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {repoFullName}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className="text-xs text-muted-foreground">
            {prs.length} {t("prReview.open")}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content - Resizable split panels */}
      <ResizablePanels
        defaultLeftWidth={50}
        minLeftWidth={30}
        maxLeftWidth={70}
        storageKey="github-prs-panel-width"
        leftPanel={
          <div className="flex flex-col h-full">
            <PRFilterBar
              filters={filters}
              contributors={contributors}
              hasActiveFilters={hasActiveFilters}
              onSearchChange={setSearchQuery}
              onContributorsChange={setContributors}
              onStatusesChange={setStatuses}
              onSortChange={setSortBy}
              onClearFilters={clearFilters}
            />
            <PRList
              prs={filteredPRs}
              selectedPRNumber={selectedPRNumber}
              isLoading={isLoading}
              hasMore={hasMore}
              error={error}
              getReviewStateForPR={getReviewStateForPR}
              onSelectPR={selectPR}
              onLoadMore={loadMore}
              isLoadingMore={isLoadingMore}
            />
          </div>
        }
        rightPanel={
          selectedPR ? (
            <PRDetail
              pr={selectedPR}
              projectId={selectedProjectId || ""}
              reviewResult={reviewResult}
              previousReviewResult={previousReviewResult}
              reviewProgress={reviewProgress}
              startedAt={startedAt}
              isReviewing={isReviewing}
              isExternalReview={isExternalReview}
              reviewError={reviewError}
              initialNewCommitsCheck={storedNewCommitsCheck}
              isActive={isActive}
              isLoadingFiles={isLoadingPRDetails}
              onRunReview={handleRunReview}
              onRunFollowupReview={handleRunFollowupReview}
              onCheckNewCommits={handleCheckNewCommits}
              onCancelReview={handleCancelReview}
              onPostReview={handlePostReview}
              onPostComment={handlePostComment}
              onMergePR={handleMergePR}
              onAssignPR={handleAssignPR}
              onGetLogs={handleGetLogs}
              onMarkReviewPosted={handleMarkReviewPosted}
            />
          ) : (
            <EmptyState message={t("prReview.selectPRToView")} />
          )
        }
      />
    </div>
  );
}
