/**
 * Settings Service
 *
 * Manages application settings and API profiles.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  colorTheme: string;
  language: string;
  uiScale: number;
  onboardingCompleted: boolean;
  autoBuildPath?: string;
  seenVersionWarnings?: string[];
  [key: string]: unknown;
}

export interface APIProfile {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  isDefault?: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  colorTheme: 'default',
  language: 'en',
  uiScale: 1,
  onboardingCompleted: false
};

export class SettingsService {
  private dataDir: string;
  private settingsFile: string;
  private profilesFile: string;
  private settings: AppSettings;
  private profiles: APIProfile[] = [];

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.settingsFile = join(dataDir, 'settings.json');
    this.profilesFile = join(dataDir, 'profiles.json');

    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Load settings
    this.settings = this.loadSettings();
    this.profiles = this.loadProfiles();
  }

  private loadSettings(): AppSettings {
    if (existsSync(this.settingsFile)) {
      try {
        const data = JSON.parse(readFileSync(this.settingsFile, 'utf-8'));
        return { ...DEFAULT_SETTINGS, ...data };
      } catch (error) {
        console.error('[SettingsService] Failed to load settings:', error);
      }
    }
    return { ...DEFAULT_SETTINGS };
  }

  private loadProfiles(): APIProfile[] {
    if (existsSync(this.profilesFile)) {
      try {
        const data = JSON.parse(readFileSync(this.profilesFile, 'utf-8'));
        return data.profiles || [];
      } catch (error) {
        console.error('[SettingsService] Failed to load profiles:', error);
      }
    }
    return [];
  }

  private saveSettings(): void {
    writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  private saveProfiles(): void {
    writeFileSync(this.profilesFile, JSON.stringify({ profiles: this.profiles }, null, 2));
  }

  async getSettings(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
    return { ...this.settings };
  }

  async getProfiles(): Promise<APIProfile[]> {
    return [...this.profiles];
  }

  async addProfile(profile: Omit<APIProfile, 'id'>): Promise<APIProfile> {
    const newProfile: APIProfile = {
      ...profile,
      id: `profile-${Date.now()}`
    };

    // If this is the first profile or marked as default, set it as default
    if (this.profiles.length === 0 || profile.isDefault) {
      // Remove default from other profiles
      this.profiles = this.profiles.map(p => ({ ...p, isDefault: false }));
      newProfile.isDefault = true;
    }

    this.profiles.push(newProfile);
    this.saveProfiles();

    return newProfile;
  }

  async updateProfile(profileId: string, updates: Partial<APIProfile>): Promise<APIProfile | null> {
    const index = this.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      return null;
    }

    // If setting as default, remove default from others
    if (updates.isDefault) {
      this.profiles = this.profiles.map(p => ({ ...p, isDefault: false }));
    }

    this.profiles[index] = { ...this.profiles[index], ...updates };
    this.saveProfiles();

    return this.profiles[index];
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    const index = this.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      return false;
    }

    const wasDefault = this.profiles[index].isDefault;
    this.profiles.splice(index, 1);

    // If deleted profile was default, make first profile default
    if (wasDefault && this.profiles.length > 0) {
      this.profiles[0].isDefault = true;
    }

    this.saveProfiles();
    return true;
  }

  async getDefaultProfile(): Promise<APIProfile | null> {
    return this.profiles.find(p => p.isDefault) || this.profiles[0] || null;
  }

  getAppVersion(): string {
    return process.env.npm_package_version || '2.7.5';
  }
}
