/**
 * Refactored Linear Task Import Modal
 * Main modal component that orchestrates the import workflow
 * Uses extracted hooks and components for better maintainability
 */

import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useLinearImportModal } from './hooks';
import {
  ImportSuccessBanner,
  ErrorBanner,
  TeamProjectSelector,
  SearchAndFilterBar,
  SelectionControls,
  IssueList
} from './components';
import type { LinearTaskImportModalProps } from './types';

export function LinearTaskImportModalRefactored({
  projectId,
  open,
  onOpenChange,
  onImportComplete
}: LinearTaskImportModalProps) {
  // Use the orchestration hook to manage all state and handlers
  const {
    teams,
    projects,
    issues,
    uniqueStateTypes,
    selectedTeamId,
    selectedProjectId,
    selectedIssueIds,
    selectionControls,
    searchQuery,
    filterState,
    isLoadingTeams,
    isLoadingProjects,
    isLoadingIssues,
    isImporting,
    error,
    importResult,
    setSelectedTeamId,
    setSelectedProjectId,
    setSearchQuery,
    setFilterState,
    handleRefresh,
    handleImport,
    resetState
  } = useLinearImportModal({ projectId, open, onImportComplete });

  // Handle modal open/close with state reset
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Download className="h-5 w-5" />
            Import Linear Tasks
          </DialogTitle>
          <DialogDescription>
            Select tasks from Linear to import into AutoBuild
          </DialogDescription>
        </DialogHeader>

        {/* Import Success Banner */}
        {importResult?.success && (
          <ImportSuccessBanner
            importResult={importResult}
            onClose={() => handleOpenChange(false)}
          />
        )}

        {/* Error Banner */}
        {error && <ErrorBanner error={error} />}

        {/* Main Content - Only show when not in success state */}
        {!importResult?.success && (
          <>
            {/* Team and Project Selection */}
            <TeamProjectSelector
              teams={teams}
              projects={projects}
              selectedTeamId={selectedTeamId}
              selectedProjectId={selectedProjectId}
              isLoadingTeams={isLoadingTeams}
              isLoadingProjects={isLoadingProjects}
              onTeamChange={setSelectedTeamId}
              onProjectChange={setSelectedProjectId}
            />

            {/* Search and Filter Bar */}
            <SearchAndFilterBar
              searchQuery={searchQuery}
              filterState={filterState}
              uniqueStateTypes={uniqueStateTypes}
              onSearchChange={setSearchQuery}
              onFilterChange={setFilterState}
            />

            {/* Selection Controls */}
            {issues.length > 0 && (
              <SelectionControls
                isAllSelected={selectionControls.isAllSelected}
                isSomeSelected={selectionControls.isSomeSelected}
                selectedCount={selectedIssueIds.size}
                filteredCount={issues.length}
                isLoadingIssues={isLoadingIssues}
                onSelectAll={selectionControls.selectAll}
                onDeselectAll={selectionControls.deselectAll}
                onRefresh={handleRefresh}
              />
            )}

            {/* Issue List */}
            <IssueList
              issues={issues}
              selectedIssueIds={selectedIssueIds}
              isLoadingIssues={isLoadingIssues}
              selectedTeamId={selectedTeamId}
              searchQuery={searchQuery}
              filterState={filterState}
              onToggleIssue={selectionControls.toggleIssue}
            />
          </>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {importResult?.success ? 'Done' : 'Cancel'}
          </Button>
          {!importResult?.success && (
            <Button
              onClick={handleImport}
              disabled={selectedIssueIds.size === 0 || isImporting}
            >
              {isImporting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="me-2 h-4 w-4" />
                  Import {selectedIssueIds.size} Task
                  {selectedIssueIds.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
