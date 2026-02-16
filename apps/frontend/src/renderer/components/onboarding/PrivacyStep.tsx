import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Info, Check, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { useSettingsStore } from '../../stores/settings-store';
import { notifySentryStateChanged } from '../../lib/sentry';

interface PrivacyStepProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Onboarding step for anonymous error reporting opt-in.
 * Explains what data is collected and what is never collected.
 * Enabled by default to help improve the app.
 */
export function PrivacyStep({ onNext, onBack }: PrivacyStepProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const { settings, updateSettings } = useSettingsStore();
  const [sentryEnabled, setSentryEnabled] = useState(settings.sentryEnabled ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (checked: boolean) => {
    setSentryEnabled(checked);
    setError(null); // Clear error when user interacts
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.saveSettings({ sentryEnabled });
      if (result?.success) {
        updateSettings({ sentryEnabled });
        notifySentryStateChanged(sentryEnabled);
        onNext();
      } else {
        setError(t('onboarding:privacy.saveFailed', 'Failed to save privacy settings. Please try again.'));
      }
    } catch (_err) {
      setError(t('onboarding:privacy.saveFailed', 'Failed to save privacy settings. Please try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Shield className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('onboarding:privacy.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('onboarding:privacy.subtitle')}
          </p>
        </div>

        <div className="space-y-6">
          {/* What we collect */}
          <Card className="border border-info/30 bg-info/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    {t('onboarding:privacy.whatWeCollect.title')}
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                    <li>{t('onboarding:privacy.whatWeCollect.crashReports')}</li>
                    <li>{t('onboarding:privacy.whatWeCollect.errorMessages')}</li>
                    <li>{t('onboarding:privacy.whatWeCollect.appVersion')}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* What we never collect */}
          <Card className="border border-success/30 bg-success/10">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <Check className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    {t('onboarding:privacy.whatWeNeverCollect.title')}
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                    <li>{t('onboarding:privacy.whatWeNeverCollect.code')}</li>
                    <li>{t('onboarding:privacy.whatWeNeverCollect.filenames')}</li>
                    <li>{t('onboarding:privacy.whatWeNeverCollect.apiKeys')}</li>
                    <li>{t('onboarding:privacy.whatWeNeverCollect.personalData')}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toggle */}
          <Card className="border border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label htmlFor="sentry-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                      {t('onboarding:privacy.toggle.label')}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('onboarding:privacy.toggle.description')}
                    </p>
                  </div>
                </div>
                <Switch
                  id="sentry-toggle"
                  checked={sentryEnabled}
                  onCheckedChange={handleToggle}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 p-3 mt-6 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button variant="ghost" onClick={onBack}>
            {t('common:back', 'Back')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('common:saving', 'Saving...') : t('common:continue', 'Continue')}
          </Button>
        </div>
      </div>
    </div>
  );
}
