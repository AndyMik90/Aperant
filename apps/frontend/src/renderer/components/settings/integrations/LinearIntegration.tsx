import { Radio, Import, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import type { ProjectEnvConfig, LinearSyncStatus } from '../../../../shared/types';

interface LinearIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showLinearKey: boolean;
  setShowLinearKey: React.Dispatch<React.SetStateAction<boolean>>;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  onOpenLinearImport: () => void;
}

/**
 * Linear integration settings component.
 * Manages Linear API key, connection status, and import functionality.
 */
export function LinearIntegration({
  envConfig,
  updateEnvConfig,
  showLinearKey,
  setShowLinearKey,
  linearConnectionStatus,
  isCheckingLinear,
  onOpenLinearImport
}: LinearIntegrationProps) {
  const { t } = useTranslation('settings');
  if (!envConfig) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('integrationsApp.linear.enableSync')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('integrationsApp.linear.description')}
          </p>
        </div>
        <Switch
          checked={envConfig.linearEnabled}
          onCheckedChange={(checked) => updateEnvConfig({ linearEnabled: checked })}
        />
      </div>

      {envConfig.linearEnabled && (
        <>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{t('integrationsApp.linear.apiKey')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('integrationsApp.linear.getKeyFrom')}{' '}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                {t('integrationsApp.linear.linearSettings')}
              </a>
            </p>
            <div className="relative">
              <Input
                type={showLinearKey ? 'text' : 'password'}
                placeholder={t('integrationsApp.linear.placeholder')}
                value={envConfig.linearApiKey || ''}
                onChange={(e) => updateEnvConfig({ linearApiKey: e.target.value })}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowLinearKey(!showLinearKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showLinearKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {envConfig.linearApiKey && (
            <ConnectionStatus
              isChecking={isCheckingLinear}
              connectionStatus={linearConnectionStatus}
              t={t}
            />
          )}

          {linearConnectionStatus?.connected && (
            <ImportTasksPrompt onOpenLinearImport={onOpenLinearImport} t={t} />
          )}

          <Separator />

          <RealtimeSyncToggle
            enabled={envConfig.linearRealtimeSync || false}
            onToggle={(checked) => updateEnvConfig({ linearRealtimeSync: checked })}
            t={t}
          />

          {envConfig.linearRealtimeSync && <RealtimeSyncWarning t={t} />}

          <Separator />

          <TeamProjectIds
            teamId={envConfig.linearTeamId || ''}
            projectId={envConfig.linearProjectId || ''}
            onTeamIdChange={(value) => updateEnvConfig({ linearTeamId: value })}
            onProjectIdChange={(value) => updateEnvConfig({ linearProjectId: value })}
            t={t}
          />
        </>
      )}
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: LinearSyncStatus | null;
  t: (key: string, opts?: Record<string, string | number>) => string;
}

function ConnectionStatus({ isChecking, connectionStatus, t }: ConnectionStatusProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{t('integrationsApp.linear.connectionStatus')}</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? t('integrationsApp.linear.checking') :
              connectionStatus?.connected
                ? (connectionStatus.teamName ? t('integrationsApp.linear.connectedTo', { name: connectionStatus.teamName }) : t('integrationsApp.linear.connected'))
                : connectionStatus?.error || t('integrationsApp.linear.notConnected')}
          </p>
          {connectionStatus?.connected && connectionStatus.issueCount !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('integrationsApp.linear.tasksAvailableToImport', { count: connectionStatus.issueCount })}
            </p>
          )}
        </div>
        {isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : connectionStatus?.connected ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
      </div>
    </div>
  );
}

interface ImportTasksPromptProps {
  onOpenLinearImport: () => void;
  t: (key: string) => string;
}

function ImportTasksPrompt({ onOpenLinearImport, t }: ImportTasksPromptProps) {
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-3">
        <Import className="h-5 w-5 text-info mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t('integrationsApp.linear.importExistingTasks')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('integrationsApp.linear.importTasksDescription')}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={onOpenLinearImport}
          >
            <Import className="h-4 w-4 mr-2" />
            {t('integrationsApp.linear.importTasksFromLinear')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RealtimeSyncToggleProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  t: (key: string) => string;
}

function RealtimeSyncToggle({ enabled, onToggle, t }: RealtimeSyncToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-info" />
          <Label className="font-normal text-foreground">{t('integrationsApp.linear.realtimeSync')}</Label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          {t('integrationsApp.linear.realtimeSyncDescription')}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

function RealtimeSyncWarning({ t }: { t: (key: string) => string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 ml-6">
      <p className="text-xs text-warning">
        {t('integrationsApp.linear.realtimeSyncWarning')}
      </p>
    </div>
  );
}

interface TeamProjectIdsProps {
  teamId: string;
  projectId: string;
  onTeamIdChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  t: (key: string) => string;
}

function TeamProjectIds({ teamId, projectId, onTeamIdChange, onProjectIdChange, t }: TeamProjectIdsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">{t('integrationsApp.linear.teamIdOptional')}</Label>
        <Input
          placeholder={t('integrationsApp.linear.autoDetected')}
          value={teamId}
          onChange={(e) => onTeamIdChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">{t('integrationsApp.linear.projectIdOptional')}</Label>
        <Input
          placeholder={t('integrationsApp.linear.autoCreated')}
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value)}
        />
      </div>
    </div>
  );
}
