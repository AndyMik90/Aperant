import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settings-store';
import { COLOR_THEMES, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT } from '@shared/constants';
import { applyCustomTheme, clearAllCustomVariables } from '@/lib/theme-utils';
import type { ColorTheme } from '@shared/types';

/**
 * Handles theme application (dark/light/system), color themes, UI scale,
 * language sync, and spellcheck sync. Pure side-effect hook.
 */
export function useAppTheme() {
  const settings = useSettingsStore((state) => state.settings);
  const { i18n } = useTranslation();

  // Apply theme on load
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      if (settings.theme === 'dark') {
        root.classList.add('dark');
      } else if (settings.theme === 'light') {
        root.classList.remove('dark');
      } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    applyTheme();

    const rawColorTheme = settings.colorTheme ?? 'default';

    if (rawColorTheme.startsWith('custom:')) {
      root.removeAttribute('data-theme');
      const customName = rawColorTheme.slice('custom:'.length);
      const isDark = root.classList.contains('dark');
      applyCustomTheme(customName, isDark);
    } else {
      clearAllCustomVariables();
      const validThemeIds = COLOR_THEMES.map((t) => t.id);
      const colorTheme: ColorTheme = validThemeIds.includes(rawColorTheme as ColorTheme)
        ? (rawColorTheme as ColorTheme)
        : 'default';

      if (colorTheme === 'default') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', colorTheme);
      }
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (settings.theme === 'system') {
        applyTheme();
        if (rawColorTheme.startsWith('custom:')) {
          const customName = rawColorTheme.slice('custom:'.length);
          const isDarkNow = root.classList.contains('dark');
          applyCustomTheme(customName, isDarkNow);
        }
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [settings.theme, settings.colorTheme]);

  // Apply UI scale
  useEffect(() => {
    const root = document.documentElement;
    const scale = settings.uiScale ?? UI_SCALE_DEFAULT;
    const clampedScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale));
    root.setAttribute('data-ui-scale', clampedScale.toString());
  }, [settings.uiScale]);

  // Sync i18n language with settings
  useEffect(() => {
    if (settings.language && settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run when settings.language changes, not on every i18n object change.
    // i18n.changeLanguage is a stable reference provided by react-i18next (bound to the i18n instance),
    // so including it in the dep array does not cause unnecessary re-runs.
  }, [settings.language, i18n.language, i18n.changeLanguage]);

  // Sync spell check language with i18n language
  useEffect(() => {
    const syncSpellCheck = async () => {
      try {
        const result = await window.electronAPI.setSpellCheckLanguages(i18n.language);
        if (!result.success) {
          console.warn('[App] Failed to set spell check language:', result.error);
        }
      } catch (error) {
        console.warn('[App] Error syncing spell check language:', error);
      }
    };

    syncSpellCheck();
  }, [i18n.language]);
}
