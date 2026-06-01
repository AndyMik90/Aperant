import { Radio, Import, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
  if (!envConfig) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">Enable Linear Sync</Label>
          <p className="text-xs text-muted-foreground">
            Create and update Linear issues automatically
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
            <Label className="text-sm font-medium text-foreground">API Key</Label>
            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                Linear Settings
              </a>
            </p>
            <div className="relative">
              <Input
                type={showLinearKey ? 'text' : 'password'}
                placeholder="lin_api_xxxxxxxx"
                value={envConfig.linearApiKey || ''}
                onChange={(e) => updateEnvConfig({ linearApiKey: e.target.value })}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowLinearKey(!showLinearKey)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showLinearKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {envConfig.linearApiKey && (
            <ConnectionStatus
              isChecking={isCheckingLinear}
              connectionStatus={linearConnectionStatus}
            />
          )}

          {linearConnectionStatus?.connected && (
            <ImportTasksPrompt onOpenLinearImport={onOpenLinearImport} />
          )}

          <Separator />

          <RealtimeSyncToggle
            enabled={envConfig.linearRealtimeSync || false}
            onToggle={(checked) => updateEnvConfig({ linearRealtimeSync: checked })}
          />

          {envConfig.linearRealtimeSync && <RealtimeSyncWarning />}

          <Separator />

          <TeamProjectIds
            teamId={envConfig.linearTeamId || ''}
            projectId={envConfig.linearProjectId || ''}
            onTeamIdChange={(value) => updateEnvConfig({ linearTeamId: value })}
            onProjectIdChange={(value) => updateEnvConfig({ linearProjectId: value })}
          />
        </>
      )}
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: LinearSyncStatus | null;
}

function ConnectionStatus({ isChecking, connectionStatus }: ConnectionStatusProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Connection Status</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? 'Checking...' :
              connectionStatus?.connected
                ? `Connected${connectionStatus.teamName ? ` to ${connectionStatus.teamName}` : ''}`
                : connectionStatus?.error || 'Not connected'}
          </p>
          {connectionStatus?.connected && connectionStatus.issueCount !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">
              {connectionStatus.issueCount}+ tasks available to import
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
}

function ImportTasksPrompt({ onOpenLinearImport }: ImportTasksPromptProps) {
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-3">
        <Import className="h-5 w-5 text-info mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Import Existing Tasks</p>
          <p className="text-xs text-muted-foreground mt-1">
            Select which Linear issues to import into AutoBuild as tasks.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={onOpenLinearImport}
          >
            <Import className="h-4 w-4 me-2" />
            Import Tasks from Linear
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RealtimeSyncToggleProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

function RealtimeSyncToggle({ enabled, onToggle }: RealtimeSyncToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-info" />
          <Label className="font-normal text-foreground">Real-time Sync</Label>
        </div>
        <p className="text-xs text-muted-foreground ps-6">
          Automatically import new tasks created in Linear
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

function RealtimeSyncWarning() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 ms-6">
      <p className="text-xs text-warning">
        When enabled, new Linear issues will be automatically imported into AutoBuild.
        Make sure to configure your team/project filters below to control which issues are imported.
      </p>
    </div>
  );
}

interface TeamProjectIdsProps {
  teamId: string;
  projectId: string;
  onTeamIdChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
}

function TeamProjectIds({ teamId, projectId, onTeamIdChange, onProjectIdChange }: TeamProjectIdsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">Team ID (Optional)</Label>
        <Input
          placeholder="Auto-detected"
          value={teamId}
          onChange={(e) => onTeamIdChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">Project ID (Optional)</Label>
        <Input
          placeholder="Auto-created"
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value)}
        />
      </div>
    </div>
  );
}
