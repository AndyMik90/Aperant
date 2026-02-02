import { TabsContent } from '../ui/tabs';
import { useTranslation } from 'react-i18next';
import { EnvConfigModal } from '../EnvConfigModal';
import { getIdeationTypeDescriptions } from '../../../shared/constants';
import { IdeationEmptyState } from './IdeationEmptyState';
import { IdeationHeader } from './IdeationHeader';
import { IdeationFilters } from './IdeationFilters';
import { IdeationDialogs } from './IdeationDialogs';
import { GenerationProgressScreen } from './GenerationProgressScreen';
import { IdeaCard } from './IdeaCard';
import { IdeaDetailPanel } from './IdeaDetailPanel';
import { useIdeation } from './hooks/useIdeation';
import { useViewState } from '../../contexts/ViewStateContext';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationProps {
  projectId: string;
  onGoToTask?: (taskId: string) => void;
}

export function Ideation({ projectId, onGoToTask }: IdeationProps) {
  const { t } = useTranslation('ideation');
  // Get showArchived from shared context for cross-page sync
  const { showArchived } = useViewState();

  // Pass showArchived directly to the hook to avoid render lag from useEffect sync
  const {
    session,
    generationStatus,
    isGenerating,
    config,
    logs,
    typeStates,
    selectedIdea,
    activeTab,
    showConfigDialog,
    showDismissed,
    showEnvConfigModal,
    showAddMoreDialog,
    typesToAdd,
    hasToken,
    isCheckingToken,
    summary,
    activeIdeas,
    selectedIds,
    convertingIdeas,
    setSelectedIdea,
    setActiveTab,
    setShowConfigDialog,
    setShowDismissed,
    setShowEnvConfigModal,
    setShowAddMoreDialog,
    setTypesToAdd,
    setConfig,
    handleGenerate,
    handleRefresh,
    handleStop,
    handleDismissAll,
    handleDeleteSelected,
    handleSelectAll,
    handleEnvConfigured,
    getAvailableTypesToAdd,
    handleAddMoreIdeas,
    toggleTypeToAdd,
    handleConvertToTask,
    handleGoToTask,
    handleDismiss,
    toggleIdeationType,
    toggleSelectIdea,
    clearSelection,
    getIdeasByType
  } = useIdeation(projectId, { onGoToTask, showArchived });

  // Show generation progress with streaming ideas (use isGenerating flag for reliable state)
  if (isGenerating) {
    return (
      <GenerationProgressScreen
        generationStatus={generationStatus}
        logs={logs}
        typeStates={typeStates}
        enabledTypes={config.enabledTypes}
        session={session}
        onSelectIdea={setSelectedIdea}
        selectedIdea={selectedIdea}
        onConvert={handleConvertToTask}
        onGoToTask={handleGoToTask}
        onDismiss={handleDismiss}
        onStop={handleStop}
      />
    );
  }

  // Show empty state only when no session exists (first run)
  if (!session) {
    return (
      <>
        <IdeationEmptyState
          config={config}
          hasToken={hasToken}
          isCheckingToken={isCheckingToken}
          onGenerate={handleGenerate}
          onOpenConfig={() => setShowConfigDialog(true)}
          onToggleIdeationType={toggleIdeationType}
        />

        <IdeationDialogs
          showConfigDialog={showConfigDialog}
          showAddMoreDialog={false}
          config={config}
          typesToAdd={[]}
          availableTypesToAdd={[]}
          onToggleIdeationType={toggleIdeationType}
          onToggleTypeToAdd={() => {}}
          onSetConfig={setConfig}
          onCloseConfigDialog={() => setShowConfigDialog(false)}
          onCloseAddMoreDialog={() => {}}
          onConfirmAddMore={() => {}}
        />

        <EnvConfigModal
          open={showEnvConfigModal}
          onOpenChange={setShowEnvConfigModal}
          onConfigured={handleEnvConfigured}
          title={t('auth.title')}
          description={t('auth.description')}
          projectId={projectId}
        />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <IdeationHeader
        totalIdeas={summary.totalIdeas}
        ideaCountByType={summary.byType}
        showDismissed={showDismissed}
        selectedCount={selectedIds.size}
        onToggleShowDismissed={() => setShowDismissed(!showDismissed)}
        onOpenConfig={() => setShowConfigDialog(true)}
        onOpenAddMore={() => {
          setTypesToAdd([]);
          setShowAddMoreDialog(true);
        }}
        onDismissAll={handleDismissAll}
        onDeleteSelected={handleDeleteSelected}
        onSelectAll={() => handleSelectAll(activeIdeas)}
        onClearSelection={clearSelection}
        onRefresh={handleRefresh}
        hasActiveIdeas={activeIdeas.length > 0}
        canAddMore={getAvailableTypesToAdd().length > 0}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <IdeationFilters activeTab={activeTab} onTabChange={setActiveTab}>
          {/* All Ideas View */}
          <TabsContent value="all" className="flex-1 overflow-auto p-4">
            <div className="grid gap-3">
              {activeIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  isSelected={selectedIds.has(idea.id)}
                  onClick={() => setSelectedIdea(selectedIdea?.id === idea.id ? null : idea)}
                  onConvert={handleConvertToTask}
                  onGoToTask={handleGoToTask}
                  onDismiss={handleDismiss}
                  onToggleSelect={toggleSelectIdea}
                />
              ))}
              {activeIdeas.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {t('noIdeasToDisplay')}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Type-specific Views */}
          {ALL_IDEATION_TYPES.map((type) => {
            const typeIdeas = getIdeasByType(type).filter((idea) => {
              if (!showDismissed && idea.status === 'dismissed') return false;
              if (!showArchived && idea.status === 'archived') return false;
              return true;
            });
            return (
              <TabsContent key={type} value={type} className="flex-1 overflow-auto p-4">
                <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {getIdeationTypeDescriptions(t)[type]}
                  </p>
                </div>
                <div className="grid gap-3">
                  {typeIdeas.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      isSelected={selectedIds.has(idea.id)}
                      onClick={() => setSelectedIdea(selectedIdea?.id === idea.id ? null : idea)}
                      onConvert={handleConvertToTask}
                      onGoToTask={handleGoToTask}
                      onDismiss={handleDismiss}
                      onToggleSelect={toggleSelectIdea}
                    />
                  ))}
                </div>
              </TabsContent>
            );
          })}
        </IdeationFilters>
      </div>

      {/* Idea Detail Panel */}
      {selectedIdea && (
        <IdeaDetailPanel
          idea={selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onConvert={handleConvertToTask}
          onGoToTask={handleGoToTask}
          onDismiss={handleDismiss}
          isConverting={convertingIdeas.has(selectedIdea.id)}
        />
      )}

      {/* Dialogs */}
      <IdeationDialogs
        showConfigDialog={showConfigDialog}
        showAddMoreDialog={showAddMoreDialog}
        config={config}
        typesToAdd={typesToAdd}
        availableTypesToAdd={getAvailableTypesToAdd()}
        onToggleIdeationType={toggleIdeationType}
        onToggleTypeToAdd={toggleTypeToAdd}
        onSetConfig={setConfig}
        onCloseConfigDialog={() => setShowConfigDialog(false)}
        onCloseAddMoreDialog={() => setShowAddMoreDialog(false)}
        onConfirmAddMore={handleAddMoreIdeas}
      />

      {/* Environment Configuration Modal */}
      <EnvConfigModal
        open={showEnvConfigModal}
        onOpenChange={setShowEnvConfigModal}
        onConfigured={handleEnvConfigured}
        title={t('auth.title')}
        description={t('auth.description')}
        projectId={projectId}
      />
    </div>
  );
}
