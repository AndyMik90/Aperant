import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { SettingsSection } from '../SettingsSection';
import type { AppSettings } from '../../../../shared/types';

interface VaultIntegrationProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Vault (external knowledge vault / Obsidian) integration settings component.
 * Manages vault path configuration, validation, and sync preferences.
 * This is an app-level setting, not project-level.
 */
export function VaultIntegration({ settings, onSettingsChange }: VaultIntegrationProps) {
  const { t } = useTranslation('settings');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleValidatePath = async () => {
    const path = settings.globalVaultPath;
    if (!path) {
      setValidationResult({ valid: false, error: t('vault.pathRequired') });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const result = await window.electronAPI.vaultValidatePath(path);
      if (result.success) {
        setValidationResult({ valid: true });
      } else {
        setValidationResult({ valid: false, error: result.error || t('vault.invalidPath') });
      }
    } catch (error) {
      setValidationResult({
        valid: false,
        error: error instanceof Error ? error.message : t('vault.validationFailed'),
      });
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <SettingsSection
      title={t('vault.title')}
      description={t('vault.description')}
    >
      <div className="space-y-4">
        {/* Vault Enabled Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="font-normal text-foreground">{t('vault.enabled')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('vault.enabledDescription')}
            </p>
          </div>
          <Switch
            checked={settings.vaultEnabled || false}
            onCheckedChange={(checked) => updateSetting('vaultEnabled', checked)}
          />
        </div>

        {settings.vaultEnabled && (
          <>
            {/* Vault Path Input */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium text-foreground">{t('vault.path')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('vault.pathDescription')}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="/path/to/vault"
                  value={settings.globalVaultPath || ''}
                  onChange={(e) => {
                    updateSetting('globalVaultPath', e.target.value);
                    setValidationResult(null);
                  }}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidatePath}
                  disabled={isValidating || !settings.globalVaultPath}
                  className="gap-2 shrink-0"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('vault.validating')}
                    </>
                  ) : (
                    t('vault.validate')
                  )}
                </Button>
              </div>

              {/* Validation Status */}
              {validationResult && (
                <div
                  className={`flex items-center gap-2 text-xs ${
                    validationResult.valid
                      ? 'text-success'
                      : 'text-destructive'
                  }`}
                >
                  {validationResult.valid ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      {t('vault.pathValid')}
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3" />
                      {validationResult.error}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Sync Learnings Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">{t('vault.syncLearnings')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('vault.syncLearningsDescription')}
                </p>
              </div>
              <Switch
                checked={settings.vaultSyncLearnings || false}
                onCheckedChange={(checked) => updateSetting('vaultSyncLearnings', checked)}
              />
            </div>

            {/* Auto-Load Context Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">{t('vault.autoLoad')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('vault.autoLoadDescription')}
                </p>
              </div>
              <Switch
                checked={settings.vaultAutoLoad || false}
                onCheckedChange={(checked) => updateSetting('vaultAutoLoad', checked)}
              />
            </div>

            {/* Allow Write Operations Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">{t('vault.writeEnabled')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('vault.writeEnabledDescription')}
                </p>
              </div>
              <Switch
                checked={settings.vaultWriteEnabled || false}
                onCheckedChange={(checked) => updateSetting('vaultWriteEnabled', checked)}
              />
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
