import { useEffect } from 'react';
import { useSettingsStore, saveSettings } from '../stores/settings-store';
import { useDialogStore } from '../stores/dialog-store';

const VERSION_WARNING_275 = '2.7.5';

/**
 * Shows a one-time version warning for specific versions (e.g., 2.7.5 reauthentication notice).
 * Also exports the close handler that persists the seen-warning state.
 */
export function useVersionWarning(settingsHaveLoaded: boolean) {
  const seenVersionWarnings = useSettingsStore((state) => state.settings.seenVersionWarnings);

  useEffect(() => {
    const checkVersionWarning = async () => {
      if (!settingsHaveLoaded) return;

      try {
        const version = await window.electronAPI.getAppVersion();
        const seenWarnings = seenVersionWarnings || [];

        if (version === VERSION_WARNING_275 && !seenWarnings.includes(VERSION_WARNING_275)) {
          useDialogStore.getState().openVersionWarning();
        }
      } catch (error) {
        console.error('Failed to check version warning:', error);
      }
    };

    checkVersionWarning();
  }, [settingsHaveLoaded, seenVersionWarnings]);
}

/**
 * Handles version warning dismissal — persists that user has seen this warning.
 */
export function handleVersionWarningClose() {
  useDialogStore.getState().closeVersionWarning();
  const settings = useSettingsStore.getState().settings;
  const seenWarnings = settings.seenVersionWarnings || [];
  if (!seenWarnings.includes(VERSION_WARNING_275)) {
    saveSettings({
      seenVersionWarnings: [...seenWarnings, VERSION_WARNING_275]
    });
  }
}
