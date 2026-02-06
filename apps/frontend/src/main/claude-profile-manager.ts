/**
 * Claude Profile Manager
 * Main coordinator for multi-account profile management
 *
 * This class delegates to specialized modules:
 * - token-encryption: OAuth token encryption/decryption
 * - usage-parser: Usage data parsing and reset time calculations
 * - rate-limit-manager: Rate limit event tracking
 * - profile-storage: Disk persistence
 * - profile-scorer: Profile availability scoring and auto-switch logic
 * - profile-utils: Helper utilities
 */

import { app } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { homedir } from 'os';
import type {
  ClaudeProfile,
  ClaudeProfileSettings,
  ClaudeUsageData,
  ClaudeRateLimitEvent,
  ClaudeAutoSwitchSettings
} from '../shared/types';

// Module imports
import { encryptToken, decryptToken } from './claude-profile/token-encryption';
import { parseUsageOutput } from './claude-profile/usage-parser';
import {
  recordRateLimitEvent as recordRateLimitEventImpl,
  isProfileRateLimited as isProfileRateLimitedImpl,
  clearRateLimitEvents as clearRateLimitEventsImpl
} from './claude-profile/rate-limit-manager';
import {
  loadProfileStoreAsync,
  saveProfileStore,
  ProfileStoreData,
  DEFAULT_AUTO_SWITCH_SETTINGS
} from './claude-profile/profile-storage';
import {
  getBestAvailableProfile,
  shouldProactivelySwitch as shouldProactivelySwitchImpl,
  getProfilesSortedByAvailability as getProfilesSortedByAvailabilityImpl
} from './claude-profile/profile-scorer';
import { getCredentialsFromKeychain, normalizeWindowsPath, updateProfileSubscriptionMetadata } from './claude-profile/credential-utils';
import {
  CLAUDE_PROFILES_DIR,
  generateProfileId as generateProfileIdImpl,
  createProfileDirectory as createProfileDirectoryImpl,
  isProfileAuthenticated as isProfileAuthenticatedImpl,
  hasValidToken,
  expandHomePath,
  getEmailFromConfigDir
} from './claude-profile/profile-utils';

/**
 * Manages Claude Code profiles for multi-account support.
 * Profiles are stored in the app's userData directory.
 * Each profile points to a separate Claude config directory.
 */
export class ClaudeProfileManager {
  private storePath: string;
  private configDir: string;
  private data: ProfileStoreData;
  private initialized: boolean = false;

  constructor() {
    this.configDir = join(app.getPath('userData'), 'config');
    this.storePath = join(this.configDir, 'claude-profiles.json');

    // DON'T do file I/O here - defer to async initialize()
    // Start with default data until initialized
    this.data = this.createDefaultData();
  }

  /**
   * Initialize the profile manager asynchronously (non-blocking)
   * This should be called at app startup via initializeClaudeProfileManager()
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure directory exists (async) - mkdir with recursive:true is idempotent
    await mkdir(this.configDir, { recursive: true });

    // Load existing data asynchronously
    const loadedData = await loadProfileStoreAsync(this.storePath);
    if (loadedData) {
      this.data = loadedData;
    }

    // Run one-time migration to fix corrupted emails
    // This repairs emails that were truncated due to ANSI escape codes in terminal output
    this.migrateCorruptedEmails();

    // Populate missing subscription metadata for existing profiles
    // This reads subscriptionType and rateLimitTier from Keychain credentials
    this.populateSubscriptionMetadata();

    this.initialized = true;
  }

  /**
   * One-time migration to fix emails that were corrupted by ANSI escape codes
   * during terminal output parsing.
   *
   * This reads the authoritative email from Claude's config file (.claude.json)
   * for each profile and updates any that differ from what we have stored.
   */
  private migrateCorruptedEmails(): void {
    let needsSave = false;

    for (const profile of this.data.profiles) {
      if (!profile.configDir) {
        continue;
      }

      const configEmail = getEmailFromConfigDir(profile.configDir);

      if (configEmail && profile.email !== configEmail) {
        console.warn('[ClaudeProfileManager] Migrating corrupted email for profile:', {
          profileId: profile.id,
          oldEmail: profile.email,
          newEmail: configEmail
        });
        profile.email = configEmail;
        needsSave = true;
      }
    }

    if (needsSave) {
      this.save();
      console.warn('[ClaudeProfileManager] Email migration complete');
    }
  }

  /**
   * Populate missing subscription metadata (subscriptionType, rateLimitTier) for existing profiles.
   *
   * This reads from Keychain credentials and updates profiles that don't have this metadata.
   * Runs on initialization to ensure existing profiles get the subscription info for UI display.
   */
  private populateSubscriptionMetadata(): void {
    let needsSave = false;

    for (const profile of this.data.profiles) {
      if (!profile.configDir) {
        continue;
      }

      // Skip if profile already has subscription metadata
      if (profile.subscriptionType && profile.rateLimitTier) {
        continue;
      }

      // Expand ~ to home directory
      const expandedConfigDir = normalizeWindowsPath(
        profile.configDir.startsWith('~')
          ? profile.configDir.replace(/^~/, homedir())
          : profile.configDir
      );

      // Use helper with onlyIfMissing option to preserve existing values
      const result = updateProfileSubscriptionMetadata(profile, expandedConfigDir, { onlyIfMissing: true });

      if (result.subscriptionTypeUpdated) {
        needsSave = true;
        console.warn('[ClaudeProfileManager] Populated subscriptionType for profile:', {
          profileId: profile.id,
          subscriptionType: result.subscriptionType
        });
      }

      if (result.rateLimitTierUpdated) {
        needsSave = true;
        console.warn('[ClaudeProfileManager] Populated rateLimitTier for profile:', {
          profileId: profile.id,
          rateLimitTier: result.rateLimitTier
        });
      }
    }

    if (needsSave) {
      this.save();
      console.warn('[ClaudeProfileManager] Subscription metadata population complete');
    }
  }

  /**
   * Check if the profile manager has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Create default profile data
   *
   * IMPORTANT: New profiles use isolated directories (~/.claude-profiles/{name})
   * to prevent interference with external Claude Code CLI usage.
   * The profile name is used as the directory name (sanitized to lowercase).
   */
  private createDefaultData(): ProfileStoreData {
    // Use an isolated directory for the initial profile
    // This prevents interference with external Claude Code CLI which uses ~/.claude
    const initialProfileName = 'Primary';
    const sanitizedName = initialProfileName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const isolatedConfigDir = join(CLAUDE_PROFILES_DIR, sanitizedName);

    const defaultProfile: ClaudeProfile = {
      id: sanitizedName,  // Use sanitized name as ID (e.g., 'primary')
      name: initialProfileName,
      configDir: isolatedConfigDir,
      isDefault: true,  // First profile is the default
      description: 'Primary Claude account',
      createdAt: new Date()
    };

    return {
      version: 3,
      profiles: [defaultProfile],
      activeProfileId: sanitizedName,
      autoSwitch: DEFAULT_AUTO_SWITCH_SETTINGS
    };
  }

  /**
   * Save profiles to disk
   */
  private save(): void {
    saveProfileStore(this.storePath, this.data);
  }

  /**
   * Get all profiles and settings
   * Computes isAuthenticated for each profile by checking configDir credentials
   */
  getSettings(): ClaudeProfileSettings {
    // Compute isAuthenticated for each profile
    const profilesWithAuth = this.data.profiles.map(profile => ({
      ...profile,
      isAuthenticated: this.isProfileAuthenticated(profile) || hasValidToken(profile)
    }));

    return {
      profiles: profilesWithAuth,
      activeProfileId: this.data.activeProfileId,
      autoSwitch: this.data.autoSwitch || DEFAULT_AUTO_SWITCH_SETTINGS
    };
  }

  /**
   * Get auto-switch settings
   */
  getAutoSwitchSettings(): ClaudeAutoSwitchSettings {
    return this.data.autoSwitch || DEFAULT_AUTO_SWITCH_SETTINGS;
  }

  /**
   * Update auto-switch settings
   */
  updateAutoSwitchSettings(settings: Partial<ClaudeAutoSwitchSettings>): void {
    this.data.autoSwitch = {
      ...(this.data.autoSwitch || DEFAULT_AUTO_SWITCH_SETTINGS),
      ...settings
    };
    this.save();
  }

  /**
   * Get unified account priority order
   * Returns array of account IDs in priority order (first = highest priority)
   * IDs are prefixed: 'oauth-{profileId}' for OAuth, 'api-{profileId}' for API profiles
   */
  getAccountPriorityOrder(): string[] {
    return this.data.accountPriorityOrder || [];
  }

  /**
   * Set unified account priority order
   * @param order Array of account IDs in priority order
   */
  setAccountPriorityOrder(order: string[]): void {
    this.data.accountPriorityOrder = order;
    this.save();
  }

  /**
   * Get a specific profile by ID
   */
  getProfile(profileId: string): ClaudeProfile | undefined {
    return this.data.profiles.find(p => p.id === profileId);
  }

  /**
   * Get the active profile
   */
  getActiveProfile(): ClaudeProfile {
    const active = this.data.profiles.find(p => p.id === this.data.activeProfileId);
    if (!active) {
      // Fallback to default
      const defaultProfile = this.data.profiles.find(p => p.isDefault);
      if (defaultProfile) {
        if (process.env.DEBUG === 'true') {
          console.warn('[ClaudeProfileManager] getActiveProfile - using default:', {
            id: defaultProfile.id,
            name: defaultProfile.name,
            email: defaultProfile.email
          });
        }
        return defaultProfile;
      }
      // If somehow no default exists, return first profile
      const fallback = this.data.profiles[0];
      if (process.env.DEBUG === 'true') {
        console.warn('[ClaudeProfileManager] getActiveProfile - using fallback:', {
          id: fallback.id,
          name: fallback.name,
          email: fallback.email
        });
      }
      return fallback;
    }

    if (process.env.DEBUG === 'true') {
      console.warn('[ClaudeProfileManager] getActiveProfile:', {
        id: active.id,
        name: active.name,
        email: active.email
      });
    }

    return active;
  }

  /**
   * Save or update a profile
   */
  saveProfile(profile: ClaudeProfile): ClaudeProfile {
    // Expand ~ in configDir path
    if (profile.configDir) {
      profile.configDir = expandHomePath(profile.configDir);
    }

    const index = this.data.profiles.findIndex(p => p.id === profile.id);

    if (index >= 0) {
      // Update existing
      this.data.profiles[index] = profile;
    } else {
      // Add new
      this.data.profiles.push(profile);
    }

    this.save();
    return profile;
  }

  /**
   * Delete a profile (cannot delete default or last profile)
   */
  deleteProfile(profileId: string): boolean {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return false;
    }

    // Cannot delete default profile
    if (profile.isDefault) {
      return false;
    }

    // Cannot delete if it's the only profile
    if (this.data.profiles.length <= 1) {
      return false;
    }

    // Remove the profile
    this.data.profiles = this.data.profiles.filter(p => p.id !== profileId);

    // If we deleted the active profile, switch to default
    if (this.data.activeProfileId === profileId) {
      const defaultProfile = this.data.profiles.find(p => p.isDefault);
      this.data.activeProfileId = defaultProfile?.id || this.data.profiles[0].id;
    }

    this.save();
    return true;
  }

  /**
   * Rename a profile
   */
  renameProfile(profileId: string, newName: string): boolean {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return false;
    }

    // Cannot rename to empty name
    if (!newName.trim()) {
      return false;
    }

    profile.name = newName.trim();
    this.save();
    return true;
  }

  /**
   * Set the active profile
   */
  setActiveProfile(profileId: string): boolean {
    const previousProfileId = this.data.activeProfileId;
    const profile = this.getProfile(profileId);
    if (!profile) {
      console.warn('[ClaudeProfileManager] setActiveProfile failed - profile not found:', { profileId });
      return false;
    }

    if (process.env.DEBUG === 'true') {
      console.warn('[ClaudeProfileManager] setActiveProfile:', {
        from: previousProfileId,
        to: profileId,
        profileName: profile.name
      });
    }

    this.data.activeProfileId = profileId;
    profile.lastUsedAt = new Date();
    this.save();
    return true;
  }

  /**
   * Update last used timestamp for a profile
   */
  markProfileUsed(profileId: string): void {
    const profile = this.getProfile(profileId);
    if (profile) {
      profile.lastUsedAt = new Date();
      this.save();
    }
  }

  /**
   * Get the OAuth token for the active profile (decrypted).
   * Returns undefined if no token is set (profile needs authentication).
   */
  getActiveProfileToken(): string | undefined {
    const profile = this.getActiveProfile();
    if (!profile?.oauthToken) {
      return undefined;
    }
    // Decrypt the token before returning
    return decryptToken(profile.oauthToken);
  }

  /**
   * Get the decrypted OAuth token for a specific profile.
   */
  getProfileToken(profileId: string): string | undefined {
    const profile = this.getProfile(profileId);
    if (!profile?.oauthToken) {
      return undefined;
    }
    return decryptToken(profile.oauthToken);
  }

  /**
   * Set the OAuth token for a profile (encrypted storage).
   * Used when capturing token from `claude setup-token` output.
   */
  setProfileToken(profileId: string, token: string, email?: string): boolean {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return false;
    }

    // Encrypt the token before storing
    profile.oauthToken = encryptToken(token);
    profile.tokenCreatedAt = new Date();
    if (email) {
      profile.email = email;
    }

    // Clear any rate limit events since this might be a new account
    profile.rateLimitEvents = [];

    this.save();
    return true;
  }

  /**
   * Check if a profile has a valid OAuth token.
   * Token is valid for 1 year from creation.
   */
  hasValidToken(profileId: string): boolean {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return false;
    }
    return hasValidToken(profile);
  }

  /**
   * Get environment variables for spawning processes with the active profile.
   *
   * IMPORTANT: Always uses CLAUDE_CONFIG_DIR to let Claude CLI read fresh tokens from Keychain.
   * We NEVER use cached OAuth tokens (CLAUDE_CODE_OAUTH_TOKEN) because:
   * 1. OAuth tokens expire in 8-12 hours
   * 2. Claude CLI's token refresh mechanism works (updates Keychain)
   * 3. Cached tokens don't benefit from Claude CLI's automatic refresh
   * 4. CLAUDE_CODE_OAUTH_TOKEN doesn't include subscription tier info
   *
   * By using CLAUDE_CONFIG_DIR, Claude CLI reads fresh tokens from Keychain each time,
   * which includes any refreshed tokens and full credential metadata.
   *
   * See: docs/LONG_LIVED_AUTH_PLAN.md for full context.
   */
  getActiveProfileEnv(): Record<string, string> {
    const profile = this.getActiveProfile();
    const env: Record<string, string> = {};

    // All profiles now use explicit CLAUDE_CONFIG_DIR for isolation
    // This prevents interference with external Claude Code CLI usage
    if (profile?.configDir) {
      // Expand ~ to home directory for the environment variable
      const expandedConfigDir = normalizeWindowsPath(
        profile.configDir.startsWith('~')
          ? profile.configDir.replace(/^~/, homedir())
          : profile.configDir
      );

      env.CLAUDE_CONFIG_DIR = expandedConfigDir;
      if (process.env.DEBUG === 'true') {
        console.warn('[ClaudeProfileManager] Using CLAUDE_CONFIG_DIR for profile:', profile.name, expandedConfigDir);
      }
    } else {
      console.warn('[ClaudeProfileManager] Profile has no configDir configured:', profile?.name);
    }

    return env;
  }

  /**
   * Update usage data for a profile (parsed from /usage output)
   */
  updateProfileUsage(profileId: string, usageOutput: string): ClaudeUsageData | null {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return null;
    }

    const usage = parseUsageOutput(usageOutput);
    profile.usage = usage;
    this.save();
    return usage;
  }

  /**
   * Update usage data for a profile from API response (percentages directly)
   * This is called by the usage monitor after fetching usage via the API
   */
  updateProfileUsageFromAPI(profileId: string, sessionPercent: number, weeklyPercent: number): ClaudeUsageData | null {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return null;
    }

    // Preserve existing reset times if available, otherwise use empty string
    const existingUsage = profile.usage;
    const usage: ClaudeUsageData = {
      sessionUsagePercent: sessionPercent,
      sessionResetTime: existingUsage?.sessionResetTime ?? '',
      weeklyUsagePercent: weeklyPercent,
      weeklyResetTime: existingUsage?.weeklyResetTime ?? '',
      opusUsagePercent: existingUsage?.opusUsagePercent,
      lastUpdated: new Date()
    };
    profile.usage = usage;
    this.save();
    return usage;
  }

  /**
   * Batch update usage data for multiple profiles from API responses.
   * Updates all profiles in memory first, then saves once to avoid race conditions.
   *
   * @param updates - Array of { profileId, sessionPercent, weeklyPercent } objects
   * @returns Number of profiles successfully updated
   */
  batchUpdateProfileUsageFromAPI(
    updates: Array<{ profileId: string; sessionPercent: number; weeklyPercent: number }>
  ): number {
    let updatedCount = 0;

    for (const { profileId, sessionPercent, weeklyPercent } of updates) {
      const profile = this.getProfile(profileId);
      if (!profile) {
        continue;
      }

      // Preserve existing reset times if available
      const existingUsage = profile.usage;
      const usage: ClaudeUsageData = {
        sessionUsagePercent: sessionPercent,
        sessionResetTime: existingUsage?.sessionResetTime ?? '',
        weeklyUsagePercent: weeklyPercent,
        weeklyResetTime: existingUsage?.weeklyResetTime ?? '',
        opusUsagePercent: existingUsage?.opusUsagePercent,
        lastUpdated: new Date()
      };
      profile.usage = usage;
      updatedCount++;
    }

    // Single save after all updates
    if (updatedCount > 0) {
      this.save();
    }

    return updatedCount;
  }

  /**
   * Record a rate limit event for a profile
   */
  recordRateLimitEvent(profileId: string, resetTimeStr: string): ClaudeRateLimitEvent {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    const event = recordRateLimitEventImpl(profile, resetTimeStr);
    this.save();
    return event;
  }

  /**
   * Check if a profile is currently rate-limited
   */
  isProfileRateLimited(profileId: string): { limited: boolean; type?: 'session' | 'weekly'; resetAt?: Date } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return { limited: false };
    }
    return isProfileRateLimitedImpl(profile);
  }

  /**
   * Get the best profile to switch to based on priority order and availability
   * Returns null if no good alternative is available
   *
   * Selection logic:
   * 1. Respects user's configured account priority order
   * 2. Filters by availability (authenticated, not rate-limited, below thresholds)
   * 3. Returns first available profile in priority order
   * 4. Falls back to "least bad" option if no profile meets all criteria
   */
  getBestAvailableProfile(excludeProfileId?: string): ClaudeProfile | null {
    const settings = this.getAutoSwitchSettings();
    const priorityOrder = this.getAccountPriorityOrder();
    return getBestAvailableProfile(this.data.profiles, settings, excludeProfileId, priorityOrder);
  }

  /**
   * Determine if we should proactively switch profiles based on current usage
   */
  shouldProactivelySwitch(profileId: string): { shouldSwitch: boolean; reason?: string; suggestedProfile?: ClaudeProfile } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return { shouldSwitch: false };
    }

    const settings = this.getAutoSwitchSettings();
    const priorityOrder = this.getAccountPriorityOrder();
    return shouldProactivelySwitchImpl(profile, this.data.profiles, settings, priorityOrder);
  }

  /**
   * Generate a unique ID for a new profile
   */
  generateProfileId(name: string): string {
    return generateProfileIdImpl(name, this.data.profiles);
  }

  /**
   * Create a new profile directory and initialize it
   */
  async createProfileDirectory(profileName: string): Promise<string> {
    return createProfileDirectoryImpl(profileName);
  }

  /**
   * Check if a profile has valid authentication
   * (checks if the config directory has credential files)
   */
  isProfileAuthenticated(profile: ClaudeProfile): boolean {
    return isProfileAuthenticatedImpl(profile);
  }

  /**
   * Check if a profile has valid authentication for starting tasks.
   * A profile is considered authenticated if:
   * 1) It has a valid OAuth token (not expired), OR
   * 2) It has an authenticated configDir (credential files exist)
   *
   * @param profileId - Optional profile ID to check. If not provided, checks active profile.
   * @returns true if the profile can authenticate, false otherwise
   */
  hasValidAuth(profileId?: string): boolean {
    const profile = profileId ? this.getProfile(profileId) : this.getActiveProfile();
    if (!profile) {
      return false;
    }

    // Check 1: Profile has a valid OAuth token
    if (hasValidToken(profile)) {
      return true;
    }

    // Check 2 & 3: Profile has authenticated configDir (works for both default and non-default)
    if (this.isProfileAuthenticated(profile)) {
      return true;
    }

    return false;
  }

  /**
   * Get environment variables for invoking Claude with a specific profile.
   *
   * IMPORTANT: Always returns CLAUDE_CONFIG_DIR for the profile, even for the default profile.
   * This ensures that when we switch to a specific profile for rate limit recovery,
   * we use that profile's exact configDir credentials, not just whatever happens to be
   * at ~/.claude (which might belong to a different profile).
   *
   * The ~ path is expanded to the full home directory path.
   */
  getProfileEnv(profileId: string): Record<string, string> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return {};
    }

    // If no configDir is defined, fall back to default
    if (!profile.configDir) {
      return {};
    }

    // Expand ~ to home directory for the environment variable
    const expandedConfigDir = normalizeWindowsPath(
      profile.configDir.startsWith('~')
        ? profile.configDir.replace(/^~/, require('os').homedir())
        : profile.configDir
    );

    if (process.env.DEBUG === 'true') {
      console.warn('[ClaudeProfileManager] getProfileEnv:', {
        profileId,
        profileName: profile.name,
        isDefault: profile.isDefault,
        configDir: profile.configDir,
        expandedConfigDir
      });
    }

    // Retrieve OAuth token from Keychain and pass it to subprocess
    // This ensures the backend Python agent can authenticate even when
    // there's no .credentials.json file in the profile directory
    const env: Record<string, string> = {
      CLAUDE_CONFIG_DIR: expandedConfigDir
    };

    try {
      const credentials = getCredentialsFromKeychain(expandedConfigDir);
      if (credentials.token) {
        env.CLAUDE_CODE_OAUTH_TOKEN = credentials.token;
        if (process.env.DEBUG === 'true') {
          console.warn('[ClaudeProfileManager] Retrieved OAuth token from Keychain for profile:', profile.name);
        }
      }
    } catch (error) {
      console.error('[ClaudeProfileManager] Failed to retrieve credentials from Keychain:', error);
      // Continue without token - backend will fall back to other auth methods
    }

    return env;
  }

  /**
   * Clear rate limit events for a profile (e.g., when they've reset)
   */
  clearRateLimitEvents(profileId: string): void {
    const profile = this.getProfile(profileId);
    if (profile) {
      clearRateLimitEventsImpl(profile);
      this.save();
    }
  }

  /**
   * Get profiles sorted by availability (best first)
   */
  getProfilesSortedByAvailability(): ClaudeProfile[] {
    return getProfilesSortedByAvailabilityImpl(this.data.profiles);
  }

  /**
   * Get the list of profile IDs that were migrated from shared ~/.claude to isolated directories.
   * These profiles need re-authentication since their credentials are in the old location.
   */
  getMigratedProfileIds(): string[] {
    return this.data.migratedProfileIds || [];
  }

  /**
   * Clear a profile from the migrated list after successful re-authentication.
   * Called when the user completes re-authentication for a migrated profile.
   *
   * @param profileId - The profile ID to clear from the migrated list
   */
  clearMigratedProfile(profileId: string): void {
    if (!this.data.migratedProfileIds) {
      return;
    }

    this.data.migratedProfileIds = this.data.migratedProfileIds.filter(id => id !== profileId);

    // If list is empty, remove the property entirely
    if (this.data.migratedProfileIds.length === 0) {
      delete this.data.migratedProfileIds;
    }

    this.save();
    console.warn('[ClaudeProfileManager] Cleared migrated profile:', profileId);
  }

  /**
   * Check if a profile was migrated and needs re-authentication.
   *
   * @param profileId - The profile ID to check
   * @returns true if the profile was migrated and needs re-auth
   */
  isProfileMigrated(profileId: string): boolean {
    return this.data.migratedProfileIds?.includes(profileId) ?? false;
  }
}

// Singleton instance and initialization promise
let profileManager: ClaudeProfileManager | null = null;
let initPromise: Promise<ClaudeProfileManager> | null = null;

/**
 * Get the singleton Claude profile manager instance
 * Note: For async contexts, prefer initializeClaudeProfileManager() to ensure initialization
 */
export function getClaudeProfileManager(): ClaudeProfileManager {
  if (!profileManager) {
    profileManager = new ClaudeProfileManager();
  }
  return profileManager;
}

/**
 * Initialize and get the singleton Claude profile manager instance (async)
 * This ensures the profile manager is fully initialized before use.
 * Uses promise caching to prevent concurrent initialization.
 * The cached promise is reset on failure to allow retries after transient errors.
 */
export async function initializeClaudeProfileManager(): Promise<ClaudeProfileManager> {
  if (!profileManager) {
    profileManager = new ClaudeProfileManager();
  }

  // If already initialized, return immediately
  if (profileManager.isInitialized()) {
    return profileManager;
  }

  // If initialization is in progress, wait for it (promise caching)
  if (!initPromise) {
    initPromise = profileManager.initialize()
      .then(() => {
        return profileManager!;
      })
      .catch((error) => {
        // Reset cached promise on failure so retries can succeed
        // This allows recovery from transient errors (e.g., disk full, permission issues)
        initPromise = null;
        throw error;
      });
  }

  return initPromise;
}
