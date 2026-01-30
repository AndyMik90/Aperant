import { useState, useEffect } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { MergeRequestList } from './components/MergeRequestList';
import { MRDetail } from './components/MRDetail';
import { CreateMergeRequestDialog } from './components/CreateMergeRequestDialog';
import { useGitLabMRs } from './hooks/useGitLabMRs';
import { initializeMRReviewListeners } from '../../stores/gitlab';

interface GitLabMergeRequestsProps {
  projectId: string;
  onOpenSettings?: () => void;
}

export function GitLabMergeRequests({ projectId, onOpenSettings }: GitLabMergeRequestsProps) {
  const [stateFilter, setStateFilter] = useState<'opened' | 'closed' | 'merged' | 'all'>('opened');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Initialize MR review listeners on mount
  useEffect(() => {
    initializeMRReviewListeners();
  }, []);

  // Use the new hook for MR state management
  const {
    mergeRequests,
    isLoading,
    error,
    selectedMR,
    selectedMRIid,
    reviewResult,
    reviewProgress,
    isReviewing,
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
  } = useGitLabMRs(projectId, { stateFilter });

  const handleCreateSuccess = async (mrIid: number) => {
    // Refresh the list and select the newly created MR
    await refresh();
    selectMR(mrIid);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-sm text-muted-foreground text-center">{error}</p>
        <Button variant="outline" onClick={refresh} className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* List Panel */}
      <div className="w-1/2 border-r border-border flex flex-col">
        <MergeRequestList
          mergeRequests={mergeRequests}
          isLoading={isLoading}
          selectedMrIid={selectedMRIid}
          onSelectMr={(mr) => selectMR(mr.iid)}
          onRefresh={refresh}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
        />
        <div className="p-2 border-t border-border">
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="w-full gap-2"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            New Merge Request
          </Button>
        </div>
      </div>

      {/* Detail Panel */}
      <div className="flex-1 flex flex-col">
        {selectedMR ? (
          <MRDetail
            mr={selectedMR}
            reviewResult={reviewResult}
            reviewProgress={reviewProgress}
            isReviewing={isReviewing}
            onRunReview={() => runReview(selectedMR.iid)}
            onRunFollowupReview={() => runFollowupReview(selectedMR.iid)}
            onCheckNewCommits={() => checkNewCommits(selectedMR.iid)}
            onCancelReview={() => cancelReview(selectedMR.iid)}
            onPostReview={(selectedFindingIds) => postReview(selectedMR.iid, selectedFindingIds)}
            onPostNote={(body) => postNote(selectedMR.iid, body)}
            onMergeMR={(mergeMethod) => mergeMR(selectedMR.iid, mergeMethod)}
            onAssignMR={(userIds) => assignMR(selectedMR.iid, userIds)}
            onApproveMR={() => approveMR(selectedMR.iid)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a merge request to view details
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <CreateMergeRequestDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
