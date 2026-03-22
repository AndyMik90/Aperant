import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { LinearIntegration } from './LinearIntegration';
import { JiraIntegration } from './JiraIntegration';
import type { ProjectEnvConfig, LinearSyncStatus, GitHubSyncStatus, GitLabSyncStatus } from '../../../../shared/types';

interface IssueTrackingSectionProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showLinearKey: boolean;
  setShowLinearKey: React.Dispatch<React.SetStateAction<boolean>>;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  onOpenLinearImport: () => void;
  // Connection status from Source Control (read-only here)
  gitHubConnectionStatus: GitHubSyncStatus | null;
  gitLabConnectionStatus: GitLabSyncStatus | null;
}

/**
 * Lightweight issue-only toggle for GitHub/GitLab.
 * Uses the connection configured in Source Control - doesn't duplicate that config here.
 */
function SourceControlIssuesToggle({ provider, envConfig, updateEnvConfig, connectionStatus }: {
  provider: 'github' | 'gitlab';
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  connectionStatus: GitHubSyncStatus | GitLabSyncStatus | null;
}) {
  const { t } = useTranslation('settings');
  // Use independent issue tracking flags (separate from source control)
  const isEnabled = provider === 'github'
    ? envConfig?.githubIssuesEnabled ?? false
    : envConfig?.gitlabIssuesEnabled ?? false;
  // Source control is connected if the main enabled flag is on
  const isSourceControlConnected = provider === 'github'
    ? envConfig?.githubEnabled ?? false
    : envConfig?.gitlabEnabled ?? false;
  const isConnected = isSourceControlConnected || (connectionStatus?.connected ?? false);
  const autoSync = provider === 'github'
    ? envConfig?.githubAutoSync ?? false
    : envConfig?.gitlabAutoSync ?? false;

  const label = provider === 'github' ? 'GitHub' : 'GitLab';

  return (
    <div className="space-y-4">
      {/* Connection status from Source Control */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {label} {t('jira.connectionStatus', 'Connection')}
            </p>
            <p className="text-xs text-muted-foreground">
              {isConnected
                ? `Connected via Source Control settings`
                : `Configure ${label} in Source Control first`}
            </p>
          </div>
          {isConnected ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Enable issue sync toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="space-y-1">
          <Label className="font-medium text-foreground">
            Enable {label} Issues
          </Label>
          <p className="text-sm text-muted-foreground">
            Sync and import issues from {label}
          </p>
        </div>
        <Switch
          checked={isEnabled}
          disabled={!isConnected}
          onCheckedChange={(checked) => {
            if (provider === 'github') {
              updateEnvConfig({ githubIssuesEnabled: checked });
            } else {
              updateEnvConfig({ gitlabIssuesEnabled: checked });
            }
          }}
        />
      </div>

      {/* Auto-sync toggle (only when enabled) */}
      {isEnabled && isConnected && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label className="font-medium text-foreground">
              Auto-sync on load
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically sync issues when the project opens
            </p>
          </div>
          <Switch
            checked={autoSync}
            onCheckedChange={(checked) => {
              if (provider === 'github') {
                updateEnvConfig({ githubAutoSync: checked });
              } else {
                updateEnvConfig({ gitlabAutoSync: checked });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Issue tracking integration section.
 * All 4 providers are independently configurable.
 * GitHub/GitLab issue tracking uses the connection from Source Control.
 */
export function IssueTrackingSection(props: IssueTrackingSectionProps) {
  const { t } = useTranslation('settings');

  // Determine default tab based on what's currently enabled
  const defaultTab = props.envConfig?.jiraEnabled ? 'jira' :
                     props.envConfig?.linearEnabled ? 'linear' :
                     props.envConfig?.githubEnabled ? 'github' :
                     props.envConfig?.gitlabEnabled ? 'gitlab' : 'jira';

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="github" className="flex-1">GitHub</TabsTrigger>
        <TabsTrigger value="gitlab" className="flex-1">GitLab</TabsTrigger>
        <TabsTrigger value="linear" className="flex-1">Linear</TabsTrigger>
        <TabsTrigger value="jira" className="flex-1">JIRA</TabsTrigger>
      </TabsList>
      <TabsContent value="github" className="mt-4">
        <SourceControlIssuesToggle
          provider="github"
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
          connectionStatus={props.gitHubConnectionStatus}
        />
      </TabsContent>
      <TabsContent value="gitlab" className="mt-4">
        <SourceControlIssuesToggle
          provider="gitlab"
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
          connectionStatus={props.gitLabConnectionStatus}
        />
      </TabsContent>
      <TabsContent value="linear" className="mt-4">
        <LinearIntegration
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
          showLinearKey={props.showLinearKey}
          setShowLinearKey={props.setShowLinearKey}
          linearConnectionStatus={props.linearConnectionStatus}
          isCheckingLinear={props.isCheckingLinear}
          onOpenLinearImport={props.onOpenLinearImport}
        />
      </TabsContent>
      <TabsContent value="jira" className="mt-4">
        <JiraIntegration
          envConfig={props.envConfig}
          updateEnvConfig={props.updateEnvConfig}
        />
      </TabsContent>
    </Tabs>
  );
}
