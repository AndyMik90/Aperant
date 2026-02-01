import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearTaskImportModal } from '../LinearTaskImportModal';
import { SettingsSection } from './SettingsSection';
import { useProjectSettings, UseProjectSettingsReturn } from '../project-settings/hooks/useProjectSettings';
import { loadTasks } from '../../stores/task-store';
import { EmptyProjectState } from './common/EmptyProjectState';
import { ErrorDisplay } from './common/ErrorDisplay';
import { SectionRouter } from './sections/SectionRouter';
import { createHookProxy } from './utils/hookProxyFactory';
import type { Project } from '../../../shared/types';

export type ProjectSettingsSection = 'general' | 'linear' | 'github' | 'gitlab' | 'azure-devops' | 'memory';

interface ProjectSettingsContentProps {
  project: Project | undefined;
  activeSection: ProjectSettingsSection;
  isOpen: boolean;
  onHookReady: (hook: UseProjectSettingsReturn | null) => void;
}

/**
 * Renders project settings content based on the active section.
 * Exposes hook state to parent for save coordination.
 */
export function ProjectSettingsContent({
  project,
  activeSection,
  isOpen,
  onHookReady
}: ProjectSettingsContentProps) {
  const { t } = useTranslation('settings');

  // Show empty state if no project selected
  if (!project) {
    return (
      <SettingsSection
        title={t('projectSettings.noProjectSelected.title')}
        description={t('projectSettings.noProjectSelected.description')}
      >
        <EmptyProjectState />
      </SettingsSection>
    );
  }

  return (
    <ProjectSettingsContentInner
      project={project}
      activeSection={activeSection}
      isOpen={isOpen}
      onHookReady={onHookReady}
    />
  );
}

/**
 * Inner component that uses the project settings hook.
 * Separated to ensure the hook is only called when a project is selected.
 */
function ProjectSettingsContentInner({
  project,
  activeSection,
  isOpen,
  onHookReady
}: {
  project: Project;
  activeSection: ProjectSettingsSection;
  isOpen: boolean;
  onHookReady: (hook: UseProjectSettingsReturn | null) => void;
}) {
  const hook = useProjectSettings(project, isOpen);

  // Keep a stable ref to the hook for the parent
  const hookRef = useRef(hook);
  hookRef.current = hook;

  const {
    settings,
    setSettings,
    versionInfo,
    isCheckingVersion,
    isUpdating,
    envConfig,
    isLoadingEnv,
    envError,
    updateEnvConfig,
    showLinearKey,
    setShowLinearKey,
    showOpenAIKey,
    setShowOpenAIKey,
    showGitHubToken,
    setShowGitHubToken,
    expandedSections: _expandedSections,
    toggleSection: _toggleSection,
    gitHubConnectionStatus,
    isCheckingGitHub,
    showGitLabToken,
    setShowGitLabToken,
    gitLabConnectionStatus,
    isCheckingGitLab,
    showLinearImportModal,
    setShowLinearImportModal,
    linearConnectionStatus,
    isCheckingLinear,
    handleInitialize,
    error
  } = hook;

  // Expose hook to parent for save coordination - only once when dialog opens
  // We use hookRef to avoid infinite loops (hook object is recreated each render)
  useEffect(() => {
    if (isOpen) {
      const hookProxy = createHookProxy(hookRef);
      onHookReady(hookProxy);
    }
    return () => {
      onHookReady(null);
    };
  }, [isOpen, onHookReady]);

  return (
    <>
      <SectionRouter
        activeSection={activeSection}
        project={project}
        settings={settings}
        setSettings={setSettings}
        versionInfo={versionInfo}
        isCheckingVersion={isCheckingVersion}
        isUpdating={isUpdating}
        envConfig={envConfig}
        isLoadingEnv={isLoadingEnv}
        envError={envError}
        updateEnvConfig={updateEnvConfig}
        showLinearKey={showLinearKey}
        setShowLinearKey={setShowLinearKey}
        showOpenAIKey={showOpenAIKey}
        setShowOpenAIKey={setShowOpenAIKey}
        showGitHubToken={showGitHubToken}
        setShowGitHubToken={setShowGitHubToken}
        gitHubConnectionStatus={gitHubConnectionStatus}
        isCheckingGitHub={isCheckingGitHub}
        showGitLabToken={showGitLabToken}
        setShowGitLabToken={setShowGitLabToken}
        gitLabConnectionStatus={gitLabConnectionStatus}
        isCheckingGitLab={isCheckingGitLab}
        linearConnectionStatus={linearConnectionStatus}
        isCheckingLinear={isCheckingLinear}
        handleInitialize={handleInitialize}
        onOpenLinearImport={() => setShowLinearImportModal(true)}
      />

      <ErrorDisplay error={error} envError={envError} />

      {/* Linear Task Import Modal */}
      <LinearTaskImportModal
        projectId={project.id}
        open={showLinearImportModal}
        onOpenChange={setShowLinearImportModal}
        onImportComplete={async (result) => {
          // Refresh task list to show imported tasks (even on partial success)
          if (result.imported > 0) {
            await loadTasks(project.id);
          }
        }}
      />
    </>
  );
}
