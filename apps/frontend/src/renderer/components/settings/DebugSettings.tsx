import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, FolderOpen, Copy, FileText, RefreshCw, Loader2, Check, AlertCircle, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { SettingsSection } from './SettingsSection';
import { useSettingsStore } from '../../stores/settings-store';
import { notifySentryStateChanged } from '../../lib/sentry';

interface DebugInfo {
  systemInfo: Record<string, string>;
  recentErrors: string[];
  logsPath: string;
  debugReport: string;
}

/**
 * Debug settings component for accessing logs and debug information
 */
export function DebugSettings() {
  const { t } = useTranslation('settings');
  const { settings, updateSettings } = useSettingsStore();
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle Sentry toggle
  const handleSentryToggle = async (checked: boolean) => {
    setError(null);
    try {
      const result = await window.electronAPI.saveSettings({ sentryEnabled: checked });
      if (result.success) {
        updateSettings({ sentryEnabled: checked });
        notifySentryStateChanged(checked);
      } else {
        setError(t('debug.errorReporting.saveFailed', 'Failed to save error reporting setting'));
      }
    } catch (_err) {
      setError(t('debug.errorReporting.saveFailed', 'Failed to save error reporting setting'));
    }
  };

  const loadDebugInfo = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const info = await window.electronAPI.getDebugInfo();
      setDebugInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load debug info');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenLogsFolder = async () => {
    try {
      const result = await window.electronAPI.openLogsFolder();
      if (!result.success) {
        setError(result.error || 'Failed to open logs folder');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open logs folder');
    }
  };

  const handleCopyDebugInfo = async () => {
    try {
      const result = await window.electronAPI.copyDebugInfo();
      if (result.success) {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        setError(result.error || 'Failed to copy debug info');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy debug info');
    }
  };

  return (
    <SettingsSection
      title={t('debug.title', 'Debug & Logs')}
      description={t('debug.description', 'Access logs and debug information for troubleshooting')}
    >
      <div className="space-y-6">
        {/* Error Reporting Toggle */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label htmlFor="sentry-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                  {t('debug.errorReporting.label', 'Anonymous Error Reporting')}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('debug.errorReporting.description', 'Send crash reports to help improve Auto Claude. No personal data or code is collected.')}
                </p>
              </div>
            </div>
            <Switch
              id="sentry-toggle"
              checked={settings.sentryEnabled ?? true}
              onCheckedChange={handleSentryToggle}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={handleOpenLogsFolder}
            className="flex items-center gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            {t('debug.openLogsFolder', 'Open Logs Folder')}
          </Button>

          <Button
            variant="outline"
            onClick={handleCopyDebugInfo}
            className="flex items-center gap-2"
            disabled={copySuccess}
          >
            {copySuccess ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                {t('debug.copied', 'Copied!')}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                {t('debug.copyDebugInfo', 'Copy Debug Info')}
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={loadDebugInfo}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('debug.loadInfo', 'Load Debug Info')}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Debug Info Display */}
        {debugInfo && (
          <div className="space-y-4">
            {/* System Information */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                <Bug className="h-4 w-4" />
                {t('debug.systemInfo', 'System Information')}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(debugInfo.systemInfo).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{key}:</span>
                    <span className="font-mono text-right truncate" title={value}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Logs Path */}
            <div className="rounded-lg border border-border p-4">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t('debug.logsLocation', 'Logs Location')}
              </h4>
              <code className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded block truncate">
                {debugInfo.logsPath}
              </code>
            </div>

            {/* Recent Errors */}
            {debugInfo.recentErrors.length > 0 && (
              <div className="rounded-lg border border-border p-4">
                <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  {t('debug.recentErrors', 'Recent Errors')} ({debugInfo.recentErrors.length})
                </h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {debugInfo.recentErrors.map((error, index) => (
                    <div key={index} className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-1 rounded">
                      {error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {debugInfo.recentErrors.length === 0 && (
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-green-500" />
                  {t('debug.noRecentErrors', 'No recent errors')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Help Text */}
        <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
          <p className="font-medium mb-1">{t('debug.helpTitle', 'Reporting Issues')}</p>
          <p>
            {t('debug.helpText', 'When reporting bugs, click "Copy Debug Info" to get system information and recent errors that help us diagnose the issue.')}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
