import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertCircle, Globe, Key, Building2, Users, FolderKanban } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Button } from '../../ui/button';
import { PasswordInput } from '../../project-settings/PasswordInput';
import type { ProjectEnvConfig, AzureDevOpsSyncStatus } from '../../../../shared/types';

interface AzureDevOpsIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  azureDevOpsConnectionStatus?: AzureDevOpsSyncStatus | null;
  isCheckingAzureDevOps?: boolean;
  projectId?: string;
  projectPath?: string;
  settings?: any;
  setSettings?: any;
}

/**
 * Azure DevOps integration settings component.
 * Manages PAT token, organization URL, project, and team configuration.
 */
export function AzureDevOpsIntegration({
  envConfig,
  updateEnvConfig,
  azureDevOpsConnectionStatus = null,
  isCheckingAzureDevOps = false,
  projectId,
  projectPath: _projectPath
}: AzureDevOpsIntegrationProps) {
  const { t } = useTranslation('azureDevOps');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | null>(null);

  const handleToggleEnabled = (enabled: boolean) => {
    updateEnvConfig({ azureDevOpsEnabled: enabled });
  };

  const handleOrganizationUrlChange = (value: string) => {
    updateEnvConfig({ azureDevOpsOrganizationUrl: value });
  };

  const handleProjectChange = (value: string) => {
    updateEnvConfig({ azureDevOpsProject: value });
  };

  const handleTeamChange = (value: string) => {
    updateEnvConfig({ azureDevOpsTeam: value });
  };

  const handlePatChange = (value: string) => {
    updateEnvConfig({ azureDevOpsPersonalAccessToken: value });
  };

  const handleTestConnection = async () => {
    if (!projectId) return;
    
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    
    try {
      const result = await window.electronAPI.azureDevOps?.checkConnection(projectId);
      if (result?.success && result.data?.connected) {
        setConnectionTestResult('success');
      } else {
        setConnectionTestResult('error');
      }
    } catch {
      setConnectionTestResult('error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const isConnected = azureDevOpsConnectionStatus?.connected ?? false;
  const hasRequiredConfig = !!(
    envConfig?.azureDevOpsOrganizationUrl &&
    envConfig?.azureDevOpsProject &&
    envConfig?.azureDevOpsPersonalAccessToken
  );

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">
            {t('settings.title')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('settings.description')}
          </p>
        </div>
        <Switch
          checked={envConfig?.azureDevOpsEnabled ?? false}
          onCheckedChange={handleToggleEnabled}
        />
      </div>

      <Separator />

      {/* Connection Status */}
      <div className="flex items-center gap-2">
        {isCheckingAzureDevOps ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t('settings.checkingConnection')}</span>
          </>
        ) : isConnected ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600">{t('settings.connected')}</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-600">{t('settings.disconnected')}</span>
          </>
        )}
      </div>

      {/* Organization URL */}
      <div className="space-y-2">
        <Label htmlFor="azure-org-url" className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          {t('settings.organizationUrl')}
        </Label>
        <Input
          id="azure-org-url"
          type="url"
          placeholder={t('settings.organizationUrlPlaceholder')}
          value={envConfig?.azureDevOpsOrganizationUrl ?? ''}
          onChange={(e) => handleOrganizationUrlChange(e.target.value)}
        />
      </div>

      {/* Project */}
      <div className="space-y-2">
        <Label htmlFor="azure-project" className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4" />
          {t('settings.project')}
        </Label>
        <Input
          id="azure-project"
          type="text"
          placeholder={t('settings.projectPlaceholder')}
          value={envConfig?.azureDevOpsProject ?? ''}
          onChange={(e) => handleProjectChange(e.target.value)}
        />
      </div>

      {/* Team (optional) */}
      <div className="space-y-2">
        <Label htmlFor="azure-team" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('settings.team')}
        </Label>
        <Input
          id="azure-team"
          type="text"
          placeholder={t('settings.teamPlaceholder')}
          value={envConfig?.azureDevOpsTeam ?? ''}
          onChange={(e) => handleTeamChange(e.target.value)}
        />
      </div>

      {/* Personal Access Token */}
      <div className="space-y-2">
        <Label htmlFor="azure-pat" className="flex items-center gap-2">
          <Key className="h-4 w-4" />
          {t('settings.personalAccessToken')}
        </Label>
        <PasswordInput
          placeholder={t('settings.personalAccessTokenPlaceholder')}
          value={envConfig?.azureDevOpsPersonalAccessToken ?? ''}
          onChange={(value) => handlePatChange(value)}
        />
        <p className="text-xs text-muted-foreground">
          {t('settings.patHelperText')}
        </p>
      </div>

      <Separator />

      {/* Test Connection Button */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={isTestingConnection || !hasRequiredConfig}
        >
          {isTestingConnection ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings.testing')}
            </>
          ) : (
            <>
              <Building2 className="mr-2 h-4 w-4" />
              {t('settings.testConnection')}
            </>
          )}
        </Button>

        {connectionTestResult === 'success' && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">{t('settings.connectionSuccessful')}</span>
          </div>
        )}

        {connectionTestResult === 'error' && (
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{t('settings.connectionFailed')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
