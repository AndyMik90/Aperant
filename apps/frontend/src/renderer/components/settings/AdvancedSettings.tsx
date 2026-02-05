import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  CheckCircle2,
  Download,
  Sparkles,
  ArrowDownToLine,
  X,
  AlertTriangle,
  AlertCircle
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Progress } from '../ui/progress';
import { SettingsSection } from './SettingsSection';
import type {
  AppSettings,
  AppUpdateAvailableEvent,
  AppUpdateProgress,
  AppUpdateInfo,
  NotificationSettings
} from '../../../shared/types';

/**
 * Release notes renderer that handles both HTML and markdown input.
 * GitHub release notes come as HTML, so we detect and handle both formats.
 * Uses ReactMarkdown with rehype-sanitize to prevent XSS attacks.
 */
/** Safe link component that opens external URLs in the default browser */
const safeMarkdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
    return (
      <a
        href={href}
        {...props}
        {...(isExternal && { target: '_blank', rel: 'noopener noreferrer' })}
        className="text-primary hover:underline"
      >
        {children}
      </a>
    );
  }
};

function ReleaseNotesRenderer({ content }: { content: string }) {
  return (
    <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_ul]:ml-4 [&_ol]:ml-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={safeMarkdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
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
  // Read-only volume warning (shown when trying to install from DMG)
  const [showReadOnlyWarning, setShowReadOnlyWarning] = useState(false);
  // General update error state
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);

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
      setShowReadOnlyWarning(false);
      setAppUpdateError(null);
    });

    const cleanupDownloaded = window.electronAPI.onAppUpdateDownloaded((info) => {
      setAppUpdateInfo(info);
      setIsDownloadingAppUpdate(false);
      setIsAppUpdateDownloaded(true);
      setAppDownloadProgress(null);
      // Clear downgrade info if any update downloaded
      setStableDowngradeInfo(null);
      // Reset read-only warning when a new update is downloaded
      setShowReadOnlyWarning(false);
      setAppUpdateError(null);
    });

    const cleanupProgress = window.electronAPI.onAppUpdateProgress((progress) => {
      setAppDownloadProgress(progress);
    });

    // Listen for stable downgrade available (when user turns off beta while on prerelease)
    const cleanupStableDowngrade = window.electronAPI.onAppUpdateStableDowngrade((info) => {
      setStableDowngradeInfo(info);
    });

    // Listen for read-only volume warning (when trying to install from DMG)
    const cleanupReadOnlyVolume = window.electronAPI.onAppUpdateReadOnlyVolume(() => {
      setShowReadOnlyWarning(true);
    });

    // Listen for update errors (e.g., install failures)
    const cleanupError = window.electronAPI.onAppUpdateError((error) => {
      setAppUpdateError(error.message);
      setIsDownloadingAppUpdate(false);
      setAppDownloadProgress(null);
    });

    return () => {
      cleanupAvailable();
      cleanupDownloaded();
      cleanupProgress();
      cleanupStableDowngrade();
      cleanupReadOnlyVolume();
      cleanupError();
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
    setAppUpdateError(null);
    try {
      const result = await window.electronAPI.downloadAppUpdate();
      if (!result.success) {
        setAppUpdateError(result.error || t('updates.downloadError'));
        setIsDownloadingAppUpdate(false);
      }
      // Note: Success case is handled by the onAppUpdateDownloaded event listener
    } catch (err) {
      console.error('Failed to download app update:', err);
      setAppUpdateError(t('updates.downloadError'));
      setIsDownloadingAppUpdate(false);
    }
  };

  const handleInstallAppUpdate = () => {
    window.electronAPI.installAppUpdate();
  };

  const handleDownloadStableVersion = async () => {
    setIsDownloadingAppUpdate(true);
    setAppUpdateError(null);
    try {
      // Use dedicated stable download API with allowDowngrade enabled
      const result = await window.electronAPI.downloadStableUpdate();
      if (!result.success) {
        setAppUpdateError(result.error || t('updates.downloadError'));
        setIsDownloadingAppUpdate(false);
      }
      // Note: Success case is handled by the onAppUpdateDownloaded event listener
    } catch (err) {
      console.error('Failed to download stable version:', err);
      setAppUpdateError(t('updates.downloadError'));
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
                  <ReleaseNotesRenderer content={appUpdateInfo.releaseNotes} />
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

              {/* Update Error */}
              {appUpdateError && (
                <div className="flex items-center gap-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <span>{appUpdateError}</span>
                </div>
              )}

              {/* Downloaded Success */}
              {isAppUpdateDownloaded && !showReadOnlyWarning && (
                <div className="flex items-center gap-3 text-sm text-success bg-success/10 border border-success/30 rounded-lg p-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>{t('updates.updateDownloaded')}</span>
                </div>
              )}

              {/* Read-Only Volume Warning */}
              {showReadOnlyWarning && (
                <div className="flex items-start gap-3 text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg p-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-warning">{t('updates.readOnlyVolumeTitle')}</p>
                    <p className="text-muted-foreground">{t('updates.readOnlyVolumeDescription')}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {isAppUpdateDownloaded ? (
                  <Button onClick={handleInstallAppUpdate} disabled={showReadOnlyWarning}>
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
                  <ReleaseNotesRenderer content={stableDowngradeInfo.releaseNotes} />
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
  const notificationItems: Array<{
    key: keyof NotificationSettings;
    labelKey: string;
    descriptionKey: string;
  }> = [
    { key: 'onTaskComplete', labelKey: 'notifications.onTaskComplete', descriptionKey: 'notifications.onTaskCompleteDescription' },
    { key: 'onTaskFailed', labelKey: 'notifications.onTaskFailed', descriptionKey: 'notifications.onTaskFailedDescription' },
    { key: 'onReviewNeeded', labelKey: 'notifications.onReviewNeeded', descriptionKey: 'notifications.onReviewNeededDescription' },
    { key: 'sound', labelKey: 'notifications.sound', descriptionKey: 'notifications.soundDescription' }
  ];

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
      </div>
    </SettingsSection>
  );
}
