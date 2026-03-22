import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import { GitHubIntegration } from './GitHubIntegration';
import { GitLabIntegration } from './GitLabIntegration';
import type { ProjectEnvConfig, GitHubSyncStatus, GitLabSyncStatus, ProjectSettings } from '../../../../shared/types';

interface SourceControlSectionProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showGitHubToken: boolean;
  setShowGitHubToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitHubConnectionStatus: GitHubSyncStatus | null;
  isCheckingGitHub: boolean;
  showGitLabToken: boolean;
  setShowGitLabToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitLabConnectionStatus: GitLabSyncStatus | null;
  isCheckingGitLab: boolean;
  projectPath?: string;
  settings?: ProjectSettings;
  setSettings?: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}

/**
 * Source control integration section.
 * Groups GitHub and GitLab source control configuration in a tabbed layout.
 */
export function SourceControlSection(props: SourceControlSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <Tabs defaultValue="github" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="github" className="flex-1">GitHub</TabsTrigger>
        <TabsTrigger value="gitlab" className="flex-1">GitLab</TabsTrigger>
      </TabsList>
      <TabsContent value="github" className="mt-4">
        <GitHubIntegration
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
          showGitHubToken={props.showGitHubToken}
          setShowGitHubToken={props.setShowGitHubToken}
          gitHubConnectionStatus={props.gitHubConnectionStatus}
          isCheckingGitHub={props.isCheckingGitHub}
          projectPath={props.projectPath}
          settings={props.settings}
          setSettings={props.setSettings}
        />
      </TabsContent>
      <TabsContent value="gitlab" className="mt-4">
        <GitLabIntegration
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
          showGitLabToken={props.showGitLabToken}
          setShowGitLabToken={props.setShowGitLabToken}
          gitLabConnectionStatus={props.gitLabConnectionStatus}
          isCheckingGitLab={props.isCheckingGitLab}
          projectPath={props.projectPath}
          settings={props.settings}
          setSettings={props.setSettings}
        />
      </TabsContent>
    </Tabs>
  );
}
