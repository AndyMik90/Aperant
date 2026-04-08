import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { SettingsSection } from './SettingsSection';
import type { AppSettings } from '../../../shared/types';

interface ProxySettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

export function ProxySettings({ settings, onSettingsChange }: ProxySettingsProps) {
  const { t } = useTranslation('settings');

  const handleToggle = (checked: boolean) => {
    const newSettings = { ...settings, proxyEnabled: checked };
    
    if (checked) {
      if (!newSettings.proxyHttpUrl) {
        newSettings.proxyHttpUrl = 'http://127.0.0.1:7890';
      }
      if (!newSettings.proxyHttpsUrl) {
        newSettings.proxyHttpsUrl = 'http://127.0.0.1:7890';
      }
    }
    
    onSettingsChange(newSettings);
  };

  return (
    <SettingsSection
      title={t('proxy.title')}
      description={t('proxy.description')}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between max-w-md">
          <div className="space-y-1">
            <Label htmlFor="proxyEnabled" className="text-sm font-medium text-foreground">
              {t('proxy.enabled.label')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('proxy.enabled.description')}
            </p>
          </div>
          <Switch
            id="proxyEnabled"
            checked={settings.proxyEnabled || false}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="space-y-3">
          <Label htmlFor="proxyHttpUrl" className="text-sm font-medium text-foreground">
            {t('proxy.httpUrl.label')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('proxy.httpUrl.description')}
          </p>
          <Input
            id="proxyHttpUrl"
            placeholder={t('proxy.httpUrl.placeholder')}
            className="w-full max-w-lg"
            value={settings.proxyHttpUrl || ''}
            onChange={(e) => onSettingsChange({ ...settings, proxyHttpUrl: e.target.value })}
          />
        </div>

        <div className="space-y-3">
          <Label htmlFor="proxyHttpsUrl" className="text-sm font-medium text-foreground">
            {t('proxy.httpsUrl.label')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('proxy.httpsUrl.description')}
          </p>
          <Input
            id="proxyHttpsUrl"
            placeholder={t('proxy.httpsUrl.placeholder')}
            className="w-full max-w-lg"
            value={settings.proxyHttpsUrl || ''}
            onChange={(e) => onSettingsChange({ ...settings, proxyHttpsUrl: e.target.value })}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
