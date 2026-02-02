import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { playNotificationSound } from '../../lib/notification-sounds';
import type { ProjectSettings, NotificationSoundType } from '../../../shared/types';

interface NotificationsSectionProps {
  settings: ProjectSettings;
  onUpdateSettings: (updates: Partial<ProjectSettings>) => void;
}

const SOUND_TYPE_OPTIONS: NotificationSoundType[] = ['chime', 'ping', 'pulse', 'blip', 'soft'];

export function NotificationsSection({ settings, onUpdateSettings }: NotificationsSectionProps) {
  const { t } = useTranslation(['settings']);

  const handleSoundTypeChange = (value: NotificationSoundType) => {
    onUpdateSettings({
      notifications: {
        ...settings.notifications,
        soundType: value
      }
    });
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{t('notifications.title')}</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="font-normal text-foreground">{t('notifications.onTaskComplete')}</Label>
          <Switch
            checked={settings.notifications.onTaskComplete}
            onCheckedChange={(checked) =>
              onUpdateSettings({
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
              onUpdateSettings({
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
              onUpdateSettings({
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
              onUpdateSettings({
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
  );
}
