import { Zap, Import, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from './CollapsibleSection';
import { StatusBadge } from './StatusBadge';
import { PasswordInput } from './PasswordInput';
import { ConnectionStatus } from './ConnectionStatus';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import type { ProjectEnvConfig, LinearSyncStatus } from '../../../shared/types';

interface LinearIntegrationSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  envConfig: ProjectEnvConfig;
  onUpdateConfig: (updates: Partial<ProjectEnvConfig>) => void;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  onOpenImportModal: () => void;
}

export function LinearIntegrationSection({
  isExpanded,
  onToggle,
  envConfig,
  onUpdateConfig,
  linearConnectionStatus,
  isCheckingLinear,
  onOpenImportModal,
}: LinearIntegrationSectionProps) {
  const { t } = useTranslation('settings');
  const badge = envConfig.linearEnabled ? (
    <StatusBadge status="success" label={t('integrations.common.enabled')} />
  ) : null;

  return (
    <CollapsibleSection
      title={t('integrations.linear.title')}
      icon={<Zap className="h-4 w-4" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={badge}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('integrations.linear.enableSync')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('integrations.linear.enableSyncDescription')}
          </p>
        </div>
        <Switch
          checked={envConfig.linearEnabled}
          onCheckedChange={(checked) => onUpdateConfig({ linearEnabled: checked })}
        />
      </div>

      {envConfig.linearEnabled && (
        <>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{t('integrations.common.apiKey')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('integrations.linear.apiKeyHint')}{' '}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                {t('integrations.linear.linearSettings')}
              </a>
            </p>
            <PasswordInput
              value={envConfig.linearApiKey || ''}
              onChange={(value) => onUpdateConfig({ linearApiKey: value })}
              placeholder="lin_api_xxxxxxxx"
            />
          </div>

          {/* Connection Status */}
          {envConfig.linearApiKey && (
            <ConnectionStatus
              isChecking={isCheckingLinear}
              isConnected={linearConnectionStatus?.connected || false}
              title={t('integrations.connection.status')}
              successMessage={
                linearConnectionStatus?.teamName
                  ? t('integrations.linear.connectedTo', { team: linearConnectionStatus.teamName })
                  : t('integrations.linear.connected')
              }
              errorMessage={linearConnectionStatus?.error || t('integrations.connection.notConnected')}
              additionalInfo={
                linearConnectionStatus?.connected && linearConnectionStatus.issueCount !== undefined
                  ? t('integrations.linear.tasksAvailable', { count: linearConnectionStatus.issueCount })
                  : undefined
              }
            />
          )}

          {/* Import Existing Tasks Button */}
          {linearConnectionStatus?.connected && (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3">
              <div className="flex items-start gap-3">
                <Import className="h-5 w-5 text-info mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{t('integrations.linear.importExistingTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('integrations.linear.importExistingDescription')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={onOpenImportModal}
                  >
                    <Import className="h-4 w-4 me-2" />
                    {t('integrations.linear.importButton')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Real-time Sync Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-info" />
                <Label className="font-normal text-foreground">{t('integrations.linear.realtimeSync')}</Label>
              </div>
              <p className="text-xs text-muted-foreground ps-6">
                {t('integrations.linear.realtimeSyncDescription')}
              </p>
            </div>
            <Switch
              checked={envConfig.linearRealtimeSync || false}
              onCheckedChange={(checked) => onUpdateConfig({ linearRealtimeSync: checked })}
            />
          </div>

          {envConfig.linearRealtimeSync && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 ms-6">
              <p className="text-xs text-warning">
                {t('integrations.linear.realtimeSyncWarning')}
              </p>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('integrations.linear.teamId')}</Label>
              <Input
                placeholder={t('integrations.linear.teamIdPlaceholder')}
                value={envConfig.linearTeamId || ''}
                onChange={(e) => onUpdateConfig({ linearTeamId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('integrations.linear.projectId')}</Label>
              <Input
                placeholder={t('integrations.linear.projectIdPlaceholder')}
                value={envConfig.linearProjectId || ''}
                onChange={(e) => onUpdateConfig({ linearProjectId: e.target.value })}
              />
            </div>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
