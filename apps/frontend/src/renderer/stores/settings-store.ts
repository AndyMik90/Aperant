import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';
import type { APIProfile, ProfileFormData, TestConnectionResult, DiscoverModelsResult, ModelInfo } from '@shared/types/profile';
import { DEFAULT_APP_SETTINGS } from '../../shared/constants';
import { toast } from '../hooks/use-toast';
import { markSettingsLoaded } from '../lib/sentry';

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;

  // API Profile state
  profiles: APIProfile[];
  activeProfileId: string | null;
  profilesLoading: boolean;
  profilesError: string | null;

  // Test connection state
  isTestingConnection: boolean;
  testConnectionResult: TestConnectionResult | null;

  // Model discovery state
  modelsLoading: boolean;
  modelsError: string | null;
  discoveredModels: Map<string, ModelInfo[]>; // Cache key -> models mapping

  // Actions
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Profile actions
  setProfiles: (profiles: APIProfile[], activeProfileId: string | null) => void;
  setProfilesLoading: (loading: boolean) => void;
  setProfilesError: (error: string | null) => void;
  saveProfile: (profile: ProfileFormData) => Promise<boolean>;
  updateProfile: (profile: APIProfile) => Promise<boolean>;
  deleteProfile: (profileId: string) => Promise<boolean>;
  setActiveProfile: (profileId: string | null) => Promise<boolean>;
  testConnection: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<TestConnectionResult | null>;
  discoverModels: (baseUrl: string, apiKey: string, signal?: AbortSignal) => Promise<ModelInfo[] | null>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_APP_SETTINGS as AppSettings,
  isLoading: true,  // Start as true since we load settings on app init
  error: null,

  // API Profile state
  profiles: [],
  activeProfileId: null,
  profilesLoading: false,
  profilesError: null,

  // Test connection state
  isTestingConnection: false,
  testConnectionResult: null,

  // Model discovery state
  modelsLoading: false,
  modelsError: null,
  discoveredModels: new Map<string, ModelInfo[]>(),

  setSettings: (settings) => set({ settings }),

  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates }
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  // Profile actions
  setProfiles: (profiles, activeProfileId) => set({ profiles, activeProfileId }),

  setProfilesLoading: (profilesLoading) => set({ profilesLoading }),

  setProfilesError: (profilesError) => set({ profilesError }),

  saveProfile: async (profile: ProfileFormData): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.saveAPIProfile(profile);
      if (result.success && result.data) {
        // Re-fetch profiles from backend to get authoritative activeProfileId
        // (backend only auto-activates the first profile)
        try {
          const profilesResult = await window.electronAPI.getAPIProfiles();
          if (profilesResult.success && profilesResult.data) {
            set({
              profiles: profilesResult.data.profiles,
              activeProfileId: profilesResult.data.activeProfileId,
              profilesLoading: false
            });
          } else {
            // Fallback: add profile locally but don't assume activeProfileId
            set((state) => ({
              profiles: [...state.profiles, result.data!],
              profilesLoading: false
            }));
          }
        } catch {
          // Fallback on fetch error: add profile locally
          set((state) => ({
            profiles: [...state.profiles, result.data!],
            profilesLoading: false
          }));
        }
        return true;
      }
      set({
        profilesError: result.error || 'Failed to save profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to save profile',
        profilesLoading: false
      });
      return false;
    }
  },

  updateProfile: async (profile: APIProfile): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.updateAPIProfile(profile);
      if (result.success && result.data) {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === result.data!.id ? result.data! : p
          ),
          profilesLoading: false
        }));
        return true;
      }
      set({
        profilesError: result.error || 'Failed to update profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to update profile',
        profilesLoading: false
      });
      return false;
    }
  },

  deleteProfile: async (profileId: string): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.deleteAPIProfile(profileId);
      if (result.success) {
        set((state) => ({
          profiles: state.profiles.filter((p) => p.id !== profileId),
          activeProfileId: state.activeProfileId === profileId ? null : state.activeProfileId,
          profilesLoading: false
        }));
        return true;
      }
      set({
        profilesError: result.error || 'Failed to delete profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to delete profile',
        profilesLoading: false
      });
      return false;
    }
  },

  setActiveProfile: async (profileId: string | null): Promise<boolean> => {
    set({ profilesLoading: true, profilesError: null });
    try {
      const result = await window.electronAPI.setActiveAPIProfile(profileId);
      if (result.success) {
        set({ activeProfileId: profileId, profilesLoading: false });
        return true;
      }
      set({
        profilesError: result.error || 'Failed to set active profile',
        profilesLoading: false
      });
      return false;
    } catch (error) {
      set({
        profilesError: error instanceof Error ? error.message : 'Failed to set active profile',
        profilesLoading: false
      });
      return false;
    }
  },

  testConnection: async (baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<TestConnectionResult | null> => {
    set({ isTestingConnection: true, testConnectionResult: null });
    try {
      const result = await window.electronAPI.testConnection(baseUrl, apiKey, signal);

      // Type narrowing pattern
      if (result.success && result.data) {
        set({ testConnectionResult: result.data, isTestingConnection: false });

        // Show toast on success
        // TODO: Use i18n translation keys (settings:connection.successTitle, settings:connection.successDescription)
        // Note: Zustand stores can't use useTranslation() hook - need to pass t() or use i18n.t()
        if (result.data.success) {
          toast({
            title: 'Connection successful',
            description: 'Your API credentials are valid.'
          });
        }
        return result.data;
      }

      // Error from IPC layer - set testConnectionResult for inline display
      const errorResult: TestConnectionResult = {
        success: false,
        errorType: 'unknown',
        message: result.error || 'Failed to test connection'
      };
      set({ testConnectionResult: errorResult, isTestingConnection: false });
      toast({
        variant: 'destructive',
        title: 'Connection test failed',
        description: result.error || 'Failed to test connection'
      });
      return errorResult;
    } catch (error) {
      // Unexpected error - set testConnectionResult for inline display
      const errorResult: TestConnectionResult = {
        success: false,
        errorType: 'unknown',
        message: error instanceof Error ? error.message : 'Failed to test connection'
      };
      set({ testConnectionResult: errorResult, isTestingConnection: false });
      toast({
        variant: 'destructive',
        title: 'Connection test failed',
        description: error instanceof Error ? error.message : 'Failed to test connection'
      });
      return errorResult;
    }
  },

  discoverModels: async (baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[] | null> => {
    console.log('[settings-store] discoverModels called with:', { baseUrl, apiKey: `${apiKey.slice(-4)}` });
    // Generate cache key from baseUrl and apiKey (last 4 chars)
    const cacheKey = `${baseUrl}::${apiKey.slice(-4)}`;

    // Check cache first
    const state = useSettingsStore.getState();
    const cached = state.discoveredModels.get(cacheKey);
    if (cached) {
      console.log('[settings-store] Returning cached models');
      return cached;
    }

    // Fetch from API
    set({ modelsLoading: true, modelsError: null });
    try {
      console.log('[settings-store] Calling window.electronAPI.discoverModels...');
      const result = await window.electronAPI.discoverModels(baseUrl, apiKey, signal);
      console.log('[settings-store] discoverModels result:', result);

      if (result.success && result.data) {
        const models = result.data.models;
        // Cache the results
        set((state) => ({
          discoveredModels: new Map(state.discoveredModels).set(cacheKey, models),
          modelsLoading: false
        }));
        return models;
      }

      // Error from IPC layer
      set({ modelsError: result.error || 'Failed to discover models', modelsLoading: false });
      return null;
    } catch (error) {
      set({
        modelsError: error instanceof Error ? error.message : 'Failed to discover models',
        modelsLoading: false
      });
      return null;
    }
  }
}));

/**
 * Check if settings need migration for onboardingCompleted flag.
 * Existing users (with tokens or projects configured) should have
 * onboardingCompleted set to true to skip the onboarding wizard.
 *
 * This function now also checks Claude Code's ~/.claude.json for
 * hasCompletedOnboarding to respect Claude Code's onboarding status.
 */
async function migrateOnboardingCompleted(settings: AppSettings): Promise<AppSettings> {
  // Only migrate if onboardingCompleted is undefined (not explicitly set)
  if (settings.onboardingCompleted !== undefined) {
    return settings;
  }

  // NEW: Check ~/.claude.json for hasCompletedOnboarding
  // This allows Auto-Claude to respect Claude Code's onboarding status
  try {
    const claudeCodeResult = await window.electronAPI.getClaudeCodeOnboardingStatus();
    if (claudeCodeResult.success && claudeCodeResult.data?.hasCompletedOnboarding) {
      // Claude Code says onboarding is complete, respect that
      return { ...settings, onboardingCompleted: true };
    }
  } catch (error) {
    // If checking Claude Code onboarding fails, log and continue with existing logic
    console.warn('[settings-store] Failed to check Claude Code onboarding status:', error);
  }

  // Check for signs of an existing user:
  // - Has a Claude OAuth token configured
  // - Has the auto-build source path configured
  const hasOAuthToken = Boolean(settings.globalClaudeOAuthToken);
  const hasAutoBuildPath = Boolean(settings.autoBuildPath);

  const isExistingUser = hasOAuthToken || hasAutoBuildPath;

  if (isExistingUser) {
    // Mark onboarding as completed for existing users
    return { ...settings, onboardingCompleted: true };
  }

  // New user - set to false to trigger onboarding wizard
  return { ...settings, onboardingCompleted: false };
}

/**
 * Load settings from main process
 */
export async function loadSettings(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setLoading(true);

  try {
    const result = await window.electronAPI.getSettings();
    if (result.success && result.data) {
      // Apply migration for onboardingCompleted flag
      // This is now async since it needs to read ~/.claude.json
      const migratedSettings = await migrateOnboardingCompleted(result.data);
      store.setSettings(migratedSettings);

      // If migration changed the settings, persist them
      if (migratedSettings.onboardingCompleted !== result.data.onboardingCompleted) {
        await window.electronAPI.saveSettings({
          onboardingCompleted: migratedSettings.onboardingCompleted
        });
      }

      // Only mark settings as loaded on SUCCESS
      // This ensures Sentry respects user's opt-out preference even if settings fail to load
      // (If settings fail to load, Sentry's beforeSend drops all events until successful load)
      markSettingsLoaded();
    }
    // Note: If result.success is false, we intentionally do NOT mark settings as loaded.
    // This means Sentry will drop events, which is the safe default for privacy.
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load settings');
    // Note: On exception, we intentionally do NOT mark settings as loaded.
    // Sentry's beforeSend will drop events, respecting potential user opt-out.
  } finally {
    store.setLoading(false);
  }
}

/**
 * Save settings to main process
 */
export async function saveSettings(updates: Partial<AppSettings>): Promise<boolean> {
  const store = useSettingsStore.getState();

  try {
    const result = await window.electronAPI.saveSettings(updates);
    if (result.success) {
      store.updateSettings(updates);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Load API profiles from main process
 */
export async function loadProfiles(): Promise<void> {
  const store = useSettingsStore.getState();
  store.setProfilesLoading(true);

  try {
    const result = await window.electronAPI.getAPIProfiles();
    if (result.success && result.data) {
      store.setProfiles(result.data.profiles, result.data.activeProfileId);
    }
  } catch (error) {
    store.setProfilesError(error instanceof Error ? error.message : 'Failed to load profiles');
  } finally {
    store.setProfilesLoading(false);
  }
}
