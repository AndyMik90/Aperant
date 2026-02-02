import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Separator } from '../ui/separator';
import { AVAILABLE_MODELS } from '../../../shared/constants';
import { playNotificationSound } from '../../lib/notification-sounds';
import type {
  Project,
  ProjectSettings as ProjectSettingsType,
  AutoBuildVersionInfo,
  NotificationSoundType
} from '../../../shared/types';

const SOUND_TYPE_OPTIONS: NotificationSoundType[] = ['chime', 'ping', 'pulse', 'blip', 'soft'];

interface GeneralSettingsProps {
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  versionInfo: AutoBuildVersionInfo | null;
  isCheckingVersion: boolean;
  isUpdating: boolean;
  handleInitialize: () => Promise<void>;
}

export function GeneralSettings({
  project,
  settings,
  setSettings,
  versionInfo,
  isCheckingVersion,
  isUpdating,
  handleInitialize
}: GeneralSettingsProps) {
  const { t } = useTranslation(['settings']);

  return (
    <>
      {/* Auto-Build Integration */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Auto-Build Integration</h3>
        {!project.autoBuildPath ? (
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Not Initialized</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Initialize Auto-Build to enable task creation and agent workflows.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={handleInitialize}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Initializing...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Initialize Auto-Build
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-foreground">Initialized</span>
              </div>
              <code className="text-xs bg-background px-2 py-1 rounded">
                {project.autoBuildPath}
              </code>
            </div>
            {isCheckingVersion ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking status...
              </div>
            ) : versionInfo && (
              <div className="text-xs text-muted-foreground">
                {versionInfo.isInitialized ? 'Initialized' : 'Not initialized'}
              </div>
            )}
          </div>
        )}
      </section>

      {project.autoBuildPath && (
        <>
          <Separator />

          {/* Agent Settings */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Agent Configuration</h3>
            <div className="space-y-2">
              <Label htmlFor="model" className="text-sm font-medium text-foreground">Model</Label>
              <Select
                value={settings.model}
                onValueChange={(value) => setSettings({ ...settings, model: value })}
              >
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">
                  {t('projectSections.general.useClaudeMd')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('projectSections.general.useClaudeMdDescription')}
                </p>
              </div>
              <Switch
                checked={settings.useClaudeMd ?? true}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, useClaudeMd: checked })
                }
              />
            </div>
          </section>

          <Separator />

          {/* Notifications */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{t('notifications.title')}</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">{t('notifications.onTaskComplete')}</Label>
                <Switch
                  checked={settings.notifications.onTaskComplete}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onTaskComplete: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">{t('notifications.onTaskFailed')}</Label>
                <Switch
                  checked={settings.notifications.onTaskFailed}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onTaskFailed: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">{t('notifications.onReviewNeeded')}</Label>
                <Switch
                  checked={settings.notifications.onReviewNeeded}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        onReviewNeeded: checked
                      }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-normal text-foreground">{t('notifications.sound')}</Label>
                <Switch
                  checked={settings.notifications.sound}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        sound: checked
                      }
                    })
                  }
                />
              </div>
              {settings.notifications.sound && (
                <div className="flex items-center justify-between">
                  <Label className="font-normal text-foreground">{t('notifications.soundType')}</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={settings.notifications.soundType || 'chime'}
                      onValueChange={(value: NotificationSoundType) =>
                        setSettings({
                          ...settings,
                          notifications: {
                            ...settings.notifications,
                            soundType: value
                          }
                        })
                      }
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
                    <button
                      type="button"
                      onClick={() => playNotificationSound(settings.notifications.soundType || 'chime')}
                      className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('notifications.test')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
