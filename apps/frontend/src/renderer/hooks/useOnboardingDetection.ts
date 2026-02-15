import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useClaudeProfileStore } from '@/stores/claude-profile-store';
import { useDialogStore } from '@/stores/dialog-store';

/**
 * Detects first-run state and opens onboarding wizard if needed.
 * Only checks after settings have loaded to avoid race conditions.
 */
export function useOnboardingDetection(settingsHaveLoaded: boolean) {
  const settings = useSettingsStore((state) => state.settings);
  const profiles = useSettingsStore((state) => state.profiles);
  const claudeProfiles = useClaudeProfileStore((state) => state.profiles);

  useEffect(() => {
    const hasAPIProfileConfigured = profiles.length > 0;
    const hasOAuthConfigured = claudeProfiles.some(p =>
      p.oauthToken || (p.isDefault && p.configDir)
    );
    const hasAnyAuth = hasAPIProfileConfigured || hasOAuthConfigured;

    if (settingsHaveLoaded &&
        settings.onboardingCompleted === false &&
        !hasAnyAuth) {
      useDialogStore.getState().openOnboarding();
    }
  }, [settingsHaveLoaded, settings.onboardingCompleted, profiles, claudeProfiles]);
}
