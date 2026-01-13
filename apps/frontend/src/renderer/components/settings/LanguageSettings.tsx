import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Label } from '../ui/label';
import { SettingsSection } from './SettingsSection';
import { useSettingsStore } from '../../stores/settings-store';
import { AVAILABLE_LANGUAGES, type SupportedLanguage } from '../../../shared/constants/i18n';
import type { AppSettings } from '../../../shared/types';

interface LanguageSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * Language settings section for interface language selection
 * Changes apply immediately for live preview, saved on "Save Settings"
 */
export function LanguageSettings({ settings, onSettingsChange }: LanguageSettingsProps) {
  const { t, i18n } = useTranslation('settings');
  const updateStoreSettings = useSettingsStore((state) => state.updateSettings);

  const currentLanguage = settings.language ?? 'en';

  const handleLanguageChange = (newLanguage: SupportedLanguage) => {
    // Update local draft state
    onSettingsChange({ ...settings, language: newLanguage });

    // Apply immediately to store for live preview
    updateStoreSettings({ language: newLanguage });

    // Change i18n language immediately for live preview
    i18n.changeLanguage(newLanguage);
  };

  return (
    <SettingsSection
      title={t('sections.language.title')}
      description={t('sections.language.description')}
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            {t('language.label')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('language.description')}
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md pt-1">
            {AVAILABLE_LANGUAGES.map((lang) => {
              const isSelected = currentLanguage === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-lg border-2 transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  )}
                >
                  <Globe className="h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium">{lang.nativeLabel}</div>
                    <div className="text-xs text-muted-foreground">{lang.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
