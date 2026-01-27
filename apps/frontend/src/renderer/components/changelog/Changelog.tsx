import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '../ui/tooltip';
import { ChangelogHeader } from './ChangelogHeader';
import { ChangelogFilters } from './ChangelogFilters';
import { ChangelogList } from './ChangelogList';
import { Step2ConfigureGenerate, Step3ReleaseArchive } from './ChangelogDetails';
import { useChangelog } from './hooks/useChangelog';

export function Changelog() {
  const { t } = useTranslation('changelog');
  const {
    // State
    selectedProjectId,
    doneTasks,
    selectedTaskIds,
    existingChangelog,
    sourceMode,
    branches,
    tags,
    currentBranch: _currentBranch,
    defaultBranch,
    previewCommits,
    isLoadingGitData,
    isLoadingCommits,
    gitHistoryType,
    gitHistoryCount,
    gitHistorySinceDate,
    gitHistoryFromTag,
    gitHistoryToTag,
    gitHistorySinceVersion,
    includeMergeCommits,
    baseBranch,
    compareBranch,
    version,
    date,
    format,
    audience,
    emojiLevel,
    customInstructions,
    generationProgress,
    generatedChangelog,
    isGenerating,
    error,
    step,
    showAdvanced,
    saveSuccess,
    copySuccess,
    versionReason,
    canGenerate,
    canSave,
    canContinue,
    // Actions
    toggleTaskSelection,
    selectAllTasks,
    deselectAllTasks,
    setSourceMode,
    setGitHistoryType,
    setGitHistoryCount,
    setGitHistorySinceDate,
    setGitHistoryFromTag,
    setGitHistoryToTag,
    setGitHistorySinceVersion,
    setIncludeMergeCommits,
    setBaseBranch,
    setCompareBranch,
    setVersion,
    setDate,
    setFormat,
    setAudience,
    setEmojiLevel,
    setCustomInstructions,
    updateGeneratedChangelog,
    setShowAdvanced,
    handleLoadCommitsPreview,
    handleGenerate,
    handleSave,
    handleCopy,
    handleContinue,
    handleBack,
    handleDone,
    handleRefresh
  } = useChangelog();

  if (!selectedProjectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">{t('list.noProjectSelected')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('list.noProjectSelectedDescription')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Header */}
        <ChangelogHeader step={step} onRefresh={handleRefresh} />

        {/* Content */}
        {step === 1 && (
          <div className="flex flex-1 overflow-hidden">
            <ChangelogFilters
              sourceMode={sourceMode}
              onSourceModeChange={setSourceMode}
              doneTasksCount={doneTasks.length}
              branches={branches}
              tags={tags}
              defaultBranch={defaultBranch}
              isLoadingGitData={isLoadingGitData}
              isLoadingCommits={isLoadingCommits}
              gitHistoryType={gitHistoryType}
              gitHistoryCount={gitHistoryCount}
              gitHistorySinceDate={gitHistorySinceDate}
              gitHistoryFromTag={gitHistoryFromTag}
              gitHistoryToTag={gitHistoryToTag}
              gitHistorySinceVersion={gitHistorySinceVersion}
              includeMergeCommits={includeMergeCommits}
              onGitHistoryTypeChange={setGitHistoryType}
              onGitHistoryCountChange={setGitHistoryCount}
              onGitHistorySinceDateChange={setGitHistorySinceDate}
              onGitHistoryFromTagChange={setGitHistoryFromTag}
              onGitHistoryToTagChange={setGitHistoryToTag}
              onGitHistorySinceVersionChange={setGitHistorySinceVersion}
              onIncludeMergeCommitsChange={setIncludeMergeCommits}
              baseBranch={baseBranch}
              compareBranch={compareBranch}
              onBaseBranchChange={setBaseBranch}
              onCompareBranchChange={setCompareBranch}
              onLoadCommitsPreview={handleLoadCommitsPreview}
            />
            <ChangelogList
              sourceMode={sourceMode}
              doneTasks={doneTasks}
              selectedTaskIds={selectedTaskIds}
              onToggleTask={toggleTaskSelection}
              onSelectAll={selectAllTasks}
              onDeselectAll={deselectAllTasks}
              previewCommits={previewCommits}
              isLoadingCommits={isLoadingCommits}
              onContinue={handleContinue}
              canContinue={canContinue}
            />
          </div>
        )}
        {step === 2 && (
          <Step2ConfigureGenerate
            sourceMode={sourceMode}
            selectedTaskIds={selectedTaskIds}
            doneTasks={doneTasks}
            previewCommits={previewCommits}
            existingChangelog={existingChangelog}
            version={version}
            versionReason={versionReason}
            date={date}
            format={format}
            audience={audience}
            emojiLevel={emojiLevel}
            customInstructions={customInstructions}
            generationProgress={generationProgress}
            generatedChangelog={generatedChangelog}
            isGenerating={isGenerating}
            error={error}
            showAdvanced={showAdvanced}
            saveSuccess={saveSuccess}
            copySuccess={copySuccess}
            canGenerate={canGenerate}
            canSave={canSave}
            onBack={handleBack}
            onVersionChange={setVersion}
            onDateChange={setDate}
            onFormatChange={setFormat}
            onAudienceChange={setAudience}
            onEmojiLevelChange={setEmojiLevel}
            onCustomInstructionsChange={setCustomInstructions}
            onShowAdvancedChange={setShowAdvanced}
            onGenerate={handleGenerate}
            onSave={handleSave}
            onCopy={handleCopy}
            onChangelogEdit={updateGeneratedChangelog}
          />
        )}
        {step === 3 && selectedProjectId && (
          <Step3ReleaseArchive
            projectId={selectedProjectId}
            version={version}
            selectedTaskIds={selectedTaskIds}
            doneTasks={doneTasks}
            generatedChangelog={generatedChangelog}
            onDone={handleDone}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
