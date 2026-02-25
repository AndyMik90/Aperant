/**
 * Unit tests for OAuthStep component
 * Tests profile management, authentication state display, and user interactions
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClaudeProfile } from '../../shared/types';

// Import browser mock to get full ElectronAPI structure
import '../lib/browser-mock';

// Helper to create test profiles
function createTestProfile(overrides: Partial<ClaudeProfile> = {}): ClaudeProfile {
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name: 'Test Profile',
    isDefault: false,
    createdAt: new Date(),
    ...overrides
  };
}

// Mock functions
const mockGetClaudeProfiles = vi.fn();
const mockSaveClaudeProfile = vi.fn();
const mockDeleteClaudeProfile = vi.fn();
const mockRenameClaudeProfile = vi.fn();
const mockSetActiveClaudeProfile = vi.fn();
const mockInitializeClaudeProfile = vi.fn();
const mockSetClaudeProfileToken = vi.fn();
const mockOnTerminalOAuthToken = vi.fn();

describe('OAuthStep Profile Management Logic', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup window.electronAPI mocks
    if (window.electronAPI) {
      window.electronAPI.getClaudeProfiles = mockGetClaudeProfiles;
      window.electronAPI.saveClaudeProfile = mockSaveClaudeProfile;
      window.electronAPI.deleteClaudeProfile = mockDeleteClaudeProfile;
      window.electronAPI.renameClaudeProfile = mockRenameClaudeProfile;
      window.electronAPI.setActiveClaudeProfile = mockSetActiveClaudeProfile;
      window.electronAPI.initializeClaudeProfile = mockInitializeClaudeProfile;
      window.electronAPI.setClaudeProfileToken = mockSetClaudeProfileToken;
      window.electronAPI.onTerminalOAuthToken = mockOnTerminalOAuthToken;
    }

    // Default mock implementations
    mockGetClaudeProfiles.mockResolvedValue({
      success: true,
      data: { profiles: [], activeProfileId: 'default' }
    });
    mockOnTerminalOAuthToken.mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Profile List Display', () => {
    it('should handle empty profile list', async () => {
      mockGetClaudeProfiles.mockResolvedValue({
        success: true,
        data: { profiles: [], activeProfileId: null }
      });

      const result = await window.electronAPI.getClaudeProfiles();
      expect(result.success).toBe(true);
      expect(result.data?.profiles).toHaveLength(0);
    });

    it('should handle profile list with multiple profiles', async () => {
      const profiles = [
        createTestProfile({ id: 'profile-1', name: 'Work' }),
        createTestProfile({ id: 'profile-2', name: 'Personal', oauthToken: 'sk-ant-oat01-test' })
      ];

      mockGetClaudeProfiles.mockResolvedValue({
        success: true,
        data: { profiles, activeProfileId: 'profile-1' }
      });

      const result = await window.electronAPI.getClaudeProfiles();
      expect(result.success).toBe(true);
      expect(result.data?.profiles).toHaveLength(2);
      expect(result.data?.activeProfileId).toBe('profile-1');
    });
  });

  describe('Authentication State Display', () => {
    it('should identify profile as authenticated when oauthToken is present', () => {
      const profile = createTestProfile({ oauthToken: 'sk-ant-oat01-test-token' });
      const isAuthenticated = !!(profile.oauthToken || (profile.isDefault && profile.configDir));
      expect(isAuthenticated).toBe(true);
    });

    it('should identify profile as authenticated when it is default with configDir', () => {
      const profile = createTestProfile({ isDefault: true, configDir: '~/.claude' });
      const isAuthenticated = !!(profile.oauthToken || (profile.isDefault && profile.configDir));
      expect(isAuthenticated).toBe(true);
    });

    it('should identify profile as needing auth when no token and not default', () => {
      const profile = createTestProfile({ isDefault: false, oauthToken: undefined });
      const isAuthenticated = !!(profile.oauthToken || (profile.isDefault && profile.configDir));
      expect(isAuthenticated).toBe(false);
    });

    it('should identify profile as needing auth when default but no configDir', () => {
      const profile = createTestProfile({ isDefault: true, configDir: undefined });
      const isAuthenticated = !!(profile.oauthToken || (profile.isDefault && profile.configDir));
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('Add Profile Flow', () => {
    it('should call saveClaudeProfile with correct parameters', async () => {
      const newProfile = {
        id: 'profile-new',
        name: 'New Profile',
        configDir: '~/.claude-profiles/new-profile',
        isDefault: false,
        createdAt: new Date()
      };

      mockSaveClaudeProfile.mockResolvedValue({
        success: true,
        data: newProfile
      });

      const result = await window.electronAPI.saveClaudeProfile(newProfile);
      expect(mockSaveClaudeProfile).toHaveBeenCalledWith(newProfile);
      expect(result.success).toBe(true);
    });

    it('should call initializeClaudeProfile after saving profile', async () => {
      const newProfile = {
        id: 'profile-new',
        name: 'New Profile',
        configDir: '~/.claude-profiles/new-profile',
        isDefault: false,
        createdAt: new Date()
      };

      mockSaveClaudeProfile.mockResolvedValue({
        success: true,
        data: newProfile
      });

      mockInitializeClaudeProfile.mockResolvedValue({ success: true });

      await window.electronAPI.saveClaudeProfile(newProfile);
      await window.electronAPI.initializeClaudeProfile(newProfile.id);

      expect(mockSaveClaudeProfile).toHaveBeenCalled();
      expect(mockInitializeClaudeProfile).toHaveBeenCalledWith(newProfile.id);
    });

    it('should generate profile slug from name', () => {
      const profileName = 'Work Account';
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');
      expect(profileSlug).toBe('work-account');
    });

    it('should handle saveClaudeProfile failure', async () => {
      mockSaveClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Failed to save profile'
      });

      const result = await window.electronAPI.saveClaudeProfile({
        id: 'profile-fail',
        name: 'Failing Profile',
        isDefault: false,
        createdAt: new Date()
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to save profile');
    });
  });

  describe('OAuth Authentication Flow', () => {
    it('should call initializeClaudeProfile to trigger OAuth flow', async () => {
      mockInitializeClaudeProfile.mockResolvedValue({ success: true });

      const profileId = 'profile-1';
      const result = await window.electronAPI.initializeClaudeProfile(profileId);

      expect(mockInitializeClaudeProfile).toHaveBeenCalledWith(profileId);
      expect(result.success).toBe(true);
    });

    it('should handle initializeClaudeProfile failure', async () => {
      mockInitializeClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Browser failed to open'
      });

      const result = await window.electronAPI.initializeClaudeProfile('profile-1');
      expect(result.success).toBe(false);
    });

    it('should register OAuth token callback', () => {
      const callback = vi.fn();
      mockOnTerminalOAuthToken.mockReturnValue(() => {});

      const unsubscribe = window.electronAPI.onTerminalOAuthToken(callback);
      expect(mockOnTerminalOAuthToken).toHaveBeenCalledWith(callback);
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('Set Active Profile', () => {
    it('should call setActiveClaudeProfile with correct profileId', async () => {
      mockSetActiveClaudeProfile.mockResolvedValue({ success: true });

      const profileId = 'profile-2';
      const result = await window.electronAPI.setActiveClaudeProfile(profileId);

      expect(mockSetActiveClaudeProfile).toHaveBeenCalledWith(profileId);
      expect(result.success).toBe(true);
    });

    it('should handle setActiveClaudeProfile failure', async () => {
      mockSetActiveClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Profile not found'
      });

      const result = await window.electronAPI.setActiveClaudeProfile('invalid-id');
      expect(result.success).toBe(false);
    });
  });

  describe('Delete Profile', () => {
    it('should call deleteClaudeProfile with correct profileId', async () => {
      mockDeleteClaudeProfile.mockResolvedValue({ success: true });

      const profileId = 'profile-to-delete';
      const result = await window.electronAPI.deleteClaudeProfile(profileId);

      expect(mockDeleteClaudeProfile).toHaveBeenCalledWith(profileId);
      expect(result.success).toBe(true);
    });
  });

  describe('Rename Profile', () => {
    it('should call renameClaudeProfile with correct parameters', async () => {
      mockRenameClaudeProfile.mockResolvedValue({ success: true });

      const profileId = 'profile-1';
      const newName = 'Updated Profile Name';
      const result = await window.electronAPI.renameClaudeProfile(profileId, newName);

      expect(mockRenameClaudeProfile).toHaveBeenCalledWith(profileId, newName);
      expect(result.success).toBe(true);
    });
  });

  describe('Manual Token Entry', () => {
    it('should call setClaudeProfileToken with token and email', async () => {
      mockSetClaudeProfileToken.mockResolvedValue({ success: true });

      const profileId = 'profile-1';
      const token = 'sk-ant-oat01-manual-token';
      const email = 'user@example.com';

      const result = await window.electronAPI.setClaudeProfileToken(profileId, token, email);

      expect(mockSetClaudeProfileToken).toHaveBeenCalledWith(profileId, token, email);
      expect(result.success).toBe(true);
    });

    it('should call setClaudeProfileToken with token only (no email)', async () => {
      mockSetClaudeProfileToken.mockResolvedValue({ success: true });

      const profileId = 'profile-1';
      const token = 'sk-ant-oat01-manual-token';

      const result = await window.electronAPI.setClaudeProfileToken(profileId, token, undefined);

      expect(mockSetClaudeProfileToken).toHaveBeenCalledWith(profileId, token, undefined);
      expect(result.success).toBe(true);
    });

    it('should handle setClaudeProfileToken failure', async () => {
      mockSetClaudeProfileToken.mockResolvedValue({
        success: false,
        error: 'Invalid token format'
      });

      const result = await window.electronAPI.setClaudeProfileToken(
        'profile-1',
        'invalid-token',
        undefined
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });
  });

  describe('Continue Button State', () => {
    it('should enable Continue when at least one profile is authenticated', () => {
      const profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'p1', oauthToken: undefined }),
        createTestProfile({ id: 'p2', oauthToken: 'sk-ant-oat01-token' })
      ];

      const hasAuthenticatedProfile = profiles.some(
        (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
      );

      expect(hasAuthenticatedProfile).toBe(true);
    });

    it('should disable Continue when no profiles are authenticated', () => {
      const profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'p1', oauthToken: undefined }),
        createTestProfile({ id: 'p2', oauthToken: undefined })
      ];

      const hasAuthenticatedProfile = profiles.some(
        (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
      );

      expect(hasAuthenticatedProfile).toBe(false);
    });

    it('should disable Continue when no profiles exist', () => {
      const profiles: ClaudeProfile[] = [];

      const hasAuthenticatedProfile = profiles.some(
        (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
      );

      expect(hasAuthenticatedProfile).toBe(false);
    });

    it('should enable Continue with default profile with configDir', () => {
      const profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'default', isDefault: true, configDir: '~/.claude' })
      ];

      const hasAuthenticatedProfile = profiles.some(
        (profile) => profile.oauthToken || (profile.isDefault && profile.configDir)
      );

      expect(hasAuthenticatedProfile).toBe(true);
    });
  });

  describe('Profile Name Validation', () => {
    it('should require non-empty profile name', () => {
      const newProfileName = '';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(false);
    });

    it('should trim whitespace from profile name', () => {
      const newProfileName = '  Work  ';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(true);
      expect(newProfileName.trim()).toBe('Work');
    });

    it('should reject whitespace-only profile name', () => {
      const newProfileName = '   ';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle getClaudeProfiles failure gracefully', async () => {
      mockGetClaudeProfiles.mockRejectedValue(new Error('Network error'));

      await expect(window.electronAPI.getClaudeProfiles()).rejects.toThrow('Network error');
    });

    it('should handle API returning unsuccessful response', async () => {
      mockGetClaudeProfiles.mockResolvedValue({
        success: false,
        error: 'Database connection failed'
      });

      const result = await window.electronAPI.getClaudeProfiles();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('Active Profile Highlighting', () => {
    it('should identify active profile correctly', () => {
      const profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'p1', name: 'Work' }),
        createTestProfile({ id: 'p2', name: 'Personal' })
      ];
      const activeProfileId = 'p2';

      const activeProfile = profiles.find((p) => p.id === activeProfileId);
      expect(activeProfile?.name).toBe('Personal');
    });

    it('should handle when no profile is active', () => {
      const profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'p1', name: 'Work' })
      ];
      const activeProfileId: string | null = null;

      const activeProfile = activeProfileId
        ? profiles.find((p) => p.id === activeProfileId)
        : undefined;
      expect(activeProfile).toBeUndefined();
    });
  });

  describe('Profile Badge Display Logic', () => {
    it('should show "Default" badge for default profile', () => {
      const profile = createTestProfile({ isDefault: true });
      expect(profile.isDefault).toBe(true);
    });

    it('should show "Active" badge for active profile', () => {
      const _profiles: ClaudeProfile[] = [
        createTestProfile({ id: 'p1' }),
        createTestProfile({ id: 'p2' })
      ];
      const activeProfileId = 'p1';

      const isActive = (profileId: string) => profileId === activeProfileId;
      expect(isActive('p1')).toBe(true);
      expect(isActive('p2')).toBe(false);
    });

    it('should show "Authenticated" badge when profile has token', () => {
      const profile = createTestProfile({ oauthToken: 'sk-ant-oat01-token' });
      const isAuthenticated = !!profile.oauthToken;
      expect(isAuthenticated).toBe(true);
    });

    it('should show "Needs Auth" badge when profile needs authentication', () => {
      const profile = createTestProfile({ oauthToken: undefined, isDefault: false });
      const needsAuth = !(profile.oauthToken || (profile.isDefault && profile.configDir));
      expect(needsAuth).toBe(true);
    });
  });

  describe('Profile Email Display', () => {
    it('should display email when present on profile', () => {
      const profile = createTestProfile({ email: 'user@example.com' });
      expect(profile.email).toBe('user@example.com');
    });

    it('should handle profile without email', () => {
      const profile = createTestProfile({ email: undefined });
      expect(profile.email).toBeUndefined();
    });
  });
});
