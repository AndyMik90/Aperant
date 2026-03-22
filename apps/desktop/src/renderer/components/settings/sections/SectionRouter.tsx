import { useTranslation } from 'react-i18next';
import type { Project, ProjectSettings as ProjectSettingsType, AutoBuildVersionInfo, ProjectEnvConfig, LinearSyncStatus, GitHubSyncStatus, GitLabSyncStatus } from '../../../../shared/types';
import { SettingsSection } from '../SettingsSection';
import { GeneralSettings } from '../../project-settings/GeneralSettings';
import { SecuritySettings } from '../../project-settings/SecuritySettings';
import { SourceControlSection } from '../integrations/SourceControlSection';
import { IssueTrackingSection } from '../integrations/IssueTrackingSection';
import { VaultIntegration } from '../integrations/VaultIntegration';
import { InitializationGuard } from '../common/InitializationGuard';
import { useSettings } from '../hooks/useSettings';
import type { ProjectSettingsSection } from '../ProjectSettingsContent';

interface SectionRouterProps {
  activeSection: ProjectSettingsSection;
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  versionInfo: AutoBuildVersionInfo | null;
  isCheckingVersion: boolean;
  isUpdating: boolean;
  envConfig: ProjectEnvConfig | null;
  isLoadingEnv: boolean;
  envError: string | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showLinearKey: boolean;
  setShowLinearKey: React.Dispatch<React.SetStateAction<boolean>>;
  showOpenAIKey: boolean;
  setShowOpenAIKey: React.Dispatch<React.SetStateAction<boolean>>;
  showGitHubToken: boolean;
  setShowGitHubToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitHubConnectionStatus: GitHubSyncStatus | null;
  isCheckingGitHub: boolean;
  showGitLabToken: boolean;
  setShowGitLabToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitLabConnectionStatus: GitLabSyncStatus | null;
  isCheckingGitLab: boolean;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  handleInitialize: () => Promise<void>;
  onOpenLinearImport: () => void;
}

/**
 * Routes to the appropriate settings section based on activeSection.
 * Uses consolidated tabbed sections: Source Control, Issue Tracking, Memory & Context.
 */
export function SectionRouter({
  activeSection,
  project,
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
  gitHubConnectionStatus,
  isCheckingGitHub,
  showGitLabToken,
  setShowGitLabToken,
  gitLabConnectionStatus,
  isCheckingGitLab,
  linearConnectionStatus,
  isCheckingLinear,
  handleInitialize,
  onOpenLinearImport
}: SectionRouterProps) {
  const { t } = useTranslation('settings');
  const { settings: appSettings, setSettings: setAppSettings } = useSettings();

  switch (activeSection) {
    case 'general':
      return (
        <SettingsSection
          title="General"
          description={`Configure Auto-Build, agent model, and notifications for ${project.name}`}
        >
          <GeneralSettings
            project={project}
            settings={settings}
            setSettings={setSettings}
            versionInfo={versionInfo}
            isCheckingVersion={isCheckingVersion}
            isUpdating={isUpdating}
            handleInitialize={handleInitialize}
          />
        </SettingsSection>
      );

    case 'source-control':
      return (
        <SettingsSection
          title={t('projectSections.source-control.integrationTitle')}
          description={t('projectSections.source-control.integrationDescription')}
        >
          <InitializationGuard
            initialized={!!project.autoBuildPath}
            title={t('projectSections.source-control.integrationTitle')}
            description={t('projectSections.source-control.syncDescription')}
          >
            <SourceControlSection
              envConfig={envConfig}
              updateEnvConfig={updateEnvConfig}
              showGitHubToken={showGitHubToken}
              setShowGitHubToken={setShowGitHubToken}
              gitHubConnectionStatus={gitHubConnectionStatus}
              isCheckingGitHub={isCheckingGitHub}
              showGitLabToken={showGitLabToken}
              setShowGitLabToken={setShowGitLabToken}
              gitLabConnectionStatus={gitLabConnectionStatus}
              isCheckingGitLab={isCheckingGitLab}
              projectPath={project.path}
              settings={settings}
              setSettings={setSettings}
            />
          </InitializationGuard>
        </SettingsSection>
      );

    case 'issue-tracking':
      return (
        <SettingsSection
          title={t('projectSections.issue-tracking.integrationTitle')}
          description={t('projectSections.issue-tracking.integrationDescription')}
        >
          <InitializationGuard
            initialized={!!project.autoBuildPath}
            title={t('projectSections.issue-tracking.integrationTitle')}
            description={t('projectSections.issue-tracking.syncDescription')}
          >
            <IssueTrackingSection
              envConfig={envConfig}
              updateEnvConfig={updateEnvConfig}
              showLinearKey={showLinearKey}
              setShowLinearKey={setShowLinearKey}
              linearConnectionStatus={linearConnectionStatus}
              isCheckingLinear={isCheckingLinear}
              onOpenLinearImport={onOpenLinearImport}
              gitHubConnectionStatus={gitHubConnectionStatus}
              gitLabConnectionStatus={gitLabConnectionStatus}
            />
          </InitializationGuard>
        </SettingsSection>
      );

    case 'memory-context':
      return (
        <SettingsSection
          title={t('projectSections.memory-context.integrationTitle')}
          description={t('projectSections.memory-context.integrationDescription')}
        >
          <InitializationGuard
            initialized={!!project.autoBuildPath}
            title={t('projectSections.memory-context.integrationTitle')}
            description={t('projectSections.memory-context.syncDescription')}
          >
            <div className="space-y-6">
              <SecuritySettings
                envConfig={envConfig}
                settings={settings}
                setSettings={setSettings}
                updateEnvConfig={updateEnvConfig}
                showOpenAIKey={showOpenAIKey}
                setShowOpenAIKey={setShowOpenAIKey}
                expanded={true}
                onToggle={() => {}}
              />
              <div className="border-t border-border pt-6">
                <h3 className="text-sm font-medium text-foreground mb-4">{t('vault.title')}</h3>
                <VaultIntegration
                  settings={appSettings}
                  onSettingsChange={setAppSettings}
                />
              </div>
            </div>
          </InitializationGuard>
        </SettingsSection>
      );

    default:
      return null;
  }
}
