/**
 * Auth Utils - Authentication helper functions
 *
 * Shared utilities for checking authentication status across different
 * authentication methods (OAuth, API profiles, etc.).
 */

import { loadProfilesFile } from '../profile/profile-manager';

/**
 * Check if there's an active API profile configured.
 *
 * API profiles (custom API keys) are stored in profiles.json and used
 * for Anthropic-compatible API endpoints. This function checks if an
 * API profile is active and has valid credentials.
 *
 * @returns true if an active API profile exists, false otherwise
 */
export async function hasValidAPIProfile(): Promise<boolean> {
  try {
    const file = await loadProfilesFile();

    // Check if there's an active profile ID set
    if (!file.activeProfileId || file.activeProfileId === '') {
      return false;
    }

    // Verify the active profile exists in the profiles list
    const activeProfile = file.profiles.find((p) => p.id === file.activeProfileId);
    return !!activeProfile;
  } catch (error) {
    console.error('[hasValidAPIProfile] Error checking API profile:', error);
    return false;
  }
}
