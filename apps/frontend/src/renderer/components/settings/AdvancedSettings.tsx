import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  CheckCircle2,
  Download,
  Sparkles,
  ArrowDownToLine,
  X
} from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Progress } from '../ui/progress';
import { SettingsSection } from './SettingsSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { playNotificationSound } from '../../lib/notification-sounds';
import type {
  AppSettings,
  AppUpdateAvailableEvent,
  AppUpdateProgress,
  AppUpdateInfo,
  NotificationSettings,
  NotificationSoundType
} from '../../../shared/types';

/**
 * Simple markdown renderer for release notes
 * Handles: headers, bold, lists, line breaks
 */
function ReleaseNotesRenderer({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    const result = markdown
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers (### Header -> <h3>)
      .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">$1</h3>')
      // Bold (**text** -> <strong>)
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-foreground font-medium">$1</strong>')
      // Inline code (`code` -> <code>)
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-xs">$1</code>')
      // List items (- item -> <li>)
      .replace(/^- (.+)$/gm, '<li class="ml-4 text-muted-foreground before:content-[\'•\'] before:mr-2 before:text-muted-foreground/60">$1</li>')
      // Wrap consecutive list items
      .replace(/(<li[^>]*>.*?<\/li>\n?)+/g, '<ul class="space-y-1 my-2">$&</ul>')
      // Line breaks for remaining lines
      .replace(/\n\n/g, '<div class="h-2"></div>')
      .replace(/\n/g, '<br/>');

    return result;
  }, [markdown]);

  return (
    <div
      className="text-sm text-muted-foreground leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface AdvancedSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  section: 'updates' | 'notifications';
  version: string;
}

/**
 * Advanced settings for updates and notifications
 */
export function AdvancedSettings({ settings, onSettingsChange, section, version }: AdvancedSettingsProps) {
  const { t } = useTranslation('settings');

  // Electron app update state
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateAvailableEvent | null>(null);
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false);
  const [isDownloadingAppUpdate, setIsDownloadingAppUpdate] = useState(false);
  const [appDownloadProgress, setAppDownloadProgress] = useState<AppUpdateProgress | null>(null);
  const [isAppUpdateDownloaded, setIsAppUpdateDownloaded] = useState(false);
  // Stable downgrade state (shown when user turns off beta while on prerelease)
  const [stableDowngradeInfo, setStableDowngradeInfo] = useState<AppUpdateInfo | null>(null);

  // Check for updates on mount, including any already-downloaded updates
  useEffect(() => {
    if (section !== 'updates') {
      return;
    }

    let isCancelled = false;

    // First check if an update was already downloaded, then check for new updates
    (async () => {
      // Check if an update was already downloaded (e.g., auto-downloaded in background)
      try {
        const result = await window.electronAPI.getDownloadedAppUpdate();

        // Skip state updates if component unmounted or section changed
        if (isCancelled) return;

        if (result.success && result.data) {
          // An update was already downloaded - show "Install and Restart" button
          setAppUpdateInfo(result.data);
          setIsAppUpdateDownloaded(true);
          console.log('[AdvancedSettings] Found already-downloaded update:', result.data.version);
          return; // Don't check for new updates if we already have one downloaded
        }
      } catch (err) {
        console.error('Failed to check for downloaded update:', err);
        if (isCancelled) return;
      }

      // Only check for available updates if no update is already downloaded
      // (electron-updater reports no available update when one is already downloaded,
      // which would clear our appUpdateInfo and lose the version metadata)
      // Inline the update check with cancellation support
      setIsCheckingAppUpdate(true);
      try {
        const result = await window.electronAPI.checkAppUpdate();
        if (isCancelled) return;
        if (result.success && result.data) {
          setAppUpdateInfo(result.data);
        } else {
          setAppUpdateInfo(null);
        }
      } catch (err) {
        console.error('Failed to check for app updates:', err);
      } finally {
        if (!isCancelled) {
          setIsCheckingAppUpdate(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [section]);

  // Listen for app update events
  useEffect(() => {
    const cleanupAvailable = window.electronAPI.onAppUpdateAvailable((info) => {
      setAppUpdateInfo(info);
      setIsCheckingAppUpdate(false);
    });

    const cleanupDownloaded = window.electronAPI.onAppUpdateDownloaded((info) => {
      setAppUpdateInfo(info);
      setIsDownloadingAppUpdate(false);
      setIsAppUpdateDownloaded(true);
      setAppDownloadProgress(null);
      // Clear downgrade info if any update downloaded
      setStableDowngradeInfo(null);
    });

    const cleanupProgress = window.electronAPI.onAppUpdateProgress((progress) => {
      setAppDownloadProgress(progress);
    });

    // Listen for stable downgrade available (when user turns off beta while on prerelease)
    const cleanupStableDowngrade = window.electronAPI.onAppUpdateStableDowngrade((info) => {
      setStableDowngradeInfo(info);
    });

    return () => {
      cleanupAvailable();
      cleanupDownloaded();
      cleanupProgress();
      cleanupStableDowngrade();
    };
  }, []);

  const checkForAppUpdates = async () => {
    setIsCheckingAppUpdate(true);
    try {
      const result = await window.electronAPI.checkAppUpdate();
      if (result.success && result.data) {
        setAppUpdateInfo(result.data);
      } else {
        // No update available
        setAppUpdateInfo(null);
      }
    } catch (err) {
      console.error('Failed to check for app updates:', err);
    } finally {
      setIsCheckingAppUpdate(false);
    }
  };

  const handleDownloadAppUpdate = async () => {
    setIsDownloadingAppUpdate(true);
    try {
      const result = await window.electronAPI.downloadAppUpdate();
      if (!result.success) {
        console.error('Failed to download app update:', result.error);
        setIsDownloadingAppUpdate(false);
      }
      // Note: Success case is handled by the onAppUpdateDownloaded event listener
    } catch (err) {
      console.error('Failed to download app update:', err);
      setIsDownloadingAppUpdate(false);
    }
  };

  const handleInstallAppUpdate = () => {
    window.electronAPI.installAppUpdate();
  };

  const handleDownloadStableVersion = async () => {
    setIsDownloadingAppUpdate(true);
    try {
      // Use dedicated stable download API with allowDowngrade enabled
      const result = await window.electronAPI.downloadStableUpdate();
      if (!result.success) {
        console.error('Failed to download stable version:', result.error);
        setIsDownloadingAppUpdate(false);
      }
      // Note: Success case is handled by the onAppUpdateDownloaded event listener
    } catch (err) {
      console.error('Failed to download stable version:', err);
      setIsDownloadingAppUpdate(false);
    }
  };

  const dismissStableDowngrade = () => {
    setStableDowngradeInfo(null);
  };

  if (section === 'updates') {
    return (
      <SettingsSection
        title={t('updates.title')}
        description={t('updates.description')}
      >
        <div className="space-y-6">
          {/* Current Version Display */}
          <div className="rounded-lg border border-border bg-muted/50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('updates.version')}</p>
                <p className="text-base font-medium text-foreground">
                  {version || t('updates.loading')}
                </p>
              </div>
              {isCheckingAppUpdate ? (
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : appUpdateInfo ? (
                <Download className="h-6 w-6 text-info" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-success" />
              )}
            </div>

            {/* Update status */}
            {!appUpdateInfo && !isCheckingAppUpdate && (
              <p className="text-sm text-muted-foreground">
                {t('updates.latestVersion')}
              </p>
            )}

            <div className="pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={checkForAppUpdates}
                disabled={isCheckingAppUpdate}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isCheckingAppUpdate ? 'animate-spin' : ''}`} />
                {t('updates.checkForUpdates')}
              </Button>
            </div>
          </div>

          {/* Electron App Update Section - shows when update available */}
          {(appUpdateInfo || isAppUpdateDownloaded) && (
            <div className="rounded-lg border-2 border-info/50 bg-info/5 p-5 space-y-4">
              <div className="flex items-center gap-2 text-info">
                <Sparkles className="h-5 w-5" />
                <h3 className="font-semibold">{t('updates.appUpdateReady')}</h3>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                    {t('updates.newVersion')}
                  </p>
                  <p className="text-base font-medium text-foreground">
                    {appUpdateInfo?.version || 'Unknown'}
                  </p>
                  {appUpdateInfo?.releaseDate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('updates.released')} {new Date(appUpdateInfo.releaseDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {isAppUpdateDownloaded ? (
                  <CheckCircle2 className="h-6 w-6 text-success" />
                ) : isDownloadingAppUpdate ? (
                  <RefreshCw className="h-6 w-6 animate-spin text-info" />
                ) : (
                  <Download className="h-6 w-6 text-info" />
                )}
              </div>

              {/* Release Notes */}
              {appUpdateInfo?.releaseNotes && (
                <div className="bg-background rounded-lg p-4 max-h-48 overflow-y-auto border border-border/50">
                  <ReleaseNotesRenderer markdown={appUpdateInfo.releaseNotes} />
                </div>
              )}

              {/* Download Progress */}
              {isDownloadingAppUpdate && appDownloadProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('updates.downloading')}</span>
                    <span className="text-foreground font-medium">
                      {Math.round(appDownloadProgress.percent)}%
                    </span>
                  </div>
                  <Progress value={appDownloadProgress.percent} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">
                    {(appDownloadProgress.transferred / 1024 / 1024).toFixed(2)} MB / {(appDownloadProgress.total / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}

              {/* Downloaded Success */}
              {isAppUpdateDownloaded && (
                <div className="flex items-center gap-3 text-sm text-success bg-success/10 border border-success/30 rounded-lg p-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>{t('updates.updateDownloaded')}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {isAppUpdateDownloaded ? (
                  <Button onClick={handleInstallAppUpdate}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('updates.installAndRestart')}
                  </Button>
                ) : (
                  <Button
                    onClick={handleDownloadAppUpdate}
                    disabled={isDownloadingAppUpdate}
                  >
                    {isDownloadingAppUpdate ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        {t('updates.downloading')}
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        {t('updates.downloadUpdate')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="space-y-1">
              <Label className="font-medium text-foreground">{t('updates.autoUpdateProjects')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('updates.autoUpdateProjectsDescription')}
              </p>
            </div>
            <Switch
              checked={settings.autoUpdateAutoBuild}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, autoUpdateAutoBuild: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="space-y-1">
              <Label className="font-medium text-foreground">{t('updates.betaUpdates')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('updates.betaUpdatesDescription')}
              </p>
            </div>
            <Switch
              checked={settings.betaUpdates ?? false}
              onCheckedChange={(checked) => {
                onSettingsChange({ ...settings, betaUpdates: checked });
                if (checked) {
                  // Clear downgrade info when enabling beta again
                  setStableDowngradeInfo(null);
                } else {
                  // Clear beta update info when disabling beta, so stable downgrade UI can show
                  setAppUpdateInfo(null);
                }
              }}
            />
          </div>

          {/* Stable Downgrade Section - shown when user turns off beta while on prerelease */}
          {stableDowngradeInfo && !appUpdateInfo && (
            <div className="rounded-lg border-2 border-warning/50 bg-warning/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-warning">
                  <ArrowDownToLine className="h-5 w-5" />
                  <h3 className="font-semibold">{t('updates.stableDowngradeAvailable')}</h3>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={dismissStableDowngrade}
                  aria-label={t('common:accessibility.dismissAriaLabel')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('updates.stableDowngradeDescription')}
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                    {t('updates.stableVersion')}
                  </p>
                  <p className="text-base font-medium text-foreground">
                    {stableDowngradeInfo.version}
                  </p>
                  {stableDowngradeInfo.releaseDate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('updates.released')} {new Date(stableDowngradeInfo.releaseDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {isDownloadingAppUpdate ? (
                  <RefreshCw className="h-6 w-6 animate-spin text-warning" />
                ) : (
                  <ArrowDownToLine className="h-6 w-6 text-warning" />
                )}
              </div>

              {/* Release Notes */}
              {stableDowngradeInfo.releaseNotes && (
                <div className="bg-background rounded-lg p-4 max-h-48 overflow-y-auto border border-border/50">
                  <ReleaseNotesRenderer markdown={stableDowngradeInfo.releaseNotes} />
                </div>
              )}

              {/* Download Progress */}
              {isDownloadingAppUpdate && appDownloadProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('updates.downloading')}</span>
                    <span className="text-foreground font-medium">
                      {Math.round(appDownloadProgress.percent)}%
                    </span>
                  </div>
                  <Progress value={appDownloadProgress.percent} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">
                    {(appDownloadProgress.transferred / 1024 / 1024).toFixed(2)} MB / {(appDownloadProgress.total / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={handleDownloadStableVersion}
                  disabled={isDownloadingAppUpdate}
                  variant="outline"
                >
                  {isDownloadingAppUpdate ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      {t('updates.downloading')}
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine className="mr-2 h-4 w-4" />
                      {t('updates.downloadStableVersion')}
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={dismissStableDowngrade}
                >
                  {t('common:actions.dismiss')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>
    );
  }

  // notifications section
  // Only include boolean notification settings (not soundType which is NotificationSoundType)
  const notificationItems: Array<{
    key: 'onTaskComplete' | 'onTaskFailed' | 'onReviewNeeded' | 'sound';
    labelKey: string;
    descriptionKey: string;
  }> = [
    { key: 'onTaskComplete', labelKey: 'notifications.onTaskComplete', descriptionKey: 'notifications.onTaskCompleteDescription' },
    { key: 'onTaskFailed', labelKey: 'notifications.onTaskFailed', descriptionKey: 'notifications.onTaskFailedDescription' },
    { key: 'onReviewNeeded', labelKey: 'notifications.onReviewNeeded', descriptionKey: 'notifications.onReviewNeededDescription' },
    { key: 'sound', labelKey: 'notifications.sound', descriptionKey: 'notifications.soundDescription' }
  ];

  const SOUND_TYPE_OPTIONS: NotificationSoundType[] = ['chime', 'ping', 'pulse', 'blip', 'soft'];

  const handleSoundTypeChange = (value: NotificationSoundType) => {
    onSettingsChange({
      ...settings,
      notifications: {
        ...settings.notifications,
        soundType: value
      }
    });
  };

  return (
    <SettingsSection
      title={t('notifications.title')}
      description={t('notifications.description')}
    >
      <div className="space-y-4">
        {notificationItems.map((item) => (
          <div key={item.key} className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="space-y-1">
              <Label className="font-medium text-foreground">{t(item.labelKey)}</Label>
              <p className="text-sm text-muted-foreground">{t(item.descriptionKey)}</p>
            </div>
            <Switch
              checked={settings.notifications[item.key]}
              onCheckedChange={(checked) =>
                onSettingsChange({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    [item.key]: checked
                  }
                })
              }
            />
          </div>
        ))}
        {settings.notifications.sound && (
          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="space-y-1">
              <Label className="font-medium text-foreground">{t('notifications.soundType')}</Label>
              <p className="text-sm text-muted-foreground">{t('notifications.soundTypeDescription')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={settings.notifications.soundType || 'chime'}
                onValueChange={handleSoundTypeChange}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOUND_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`notifications.soundTypes.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => playNotificationSound(settings.notifications.soundType || 'chime')}
              >
                {t('notifications.test')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
