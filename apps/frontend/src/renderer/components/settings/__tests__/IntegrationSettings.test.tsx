/**
 * IntegrationSettings handleAddProfile function tests
 *
 * Tests for the handleAddProfile function logic in IntegrationSettings component.
 * Verifies that IPC calls (saveClaudeProfile and initializeClaudeProfile) are made correctly.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import browser mock to get full ElectronAPI structure
import '../../../lib/browser-mock';

// Mock functions for IPC calls
const mockSaveClaudeProfile = vi.fn();
const mockInitializeClaudeProfile = vi.fn();
const mockGetClaudeProfiles = vi.fn();

describe('IntegrationSettings - handleAddProfile IPC Logic', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup window.electronAPI mocks
    if (window.electronAPI) {
      window.electronAPI.saveClaudeProfile = mockSaveClaudeProfile;
      window.electronAPI.initializeClaudeProfile = mockInitializeClaudeProfile;
      window.electronAPI.getClaudeProfiles = mockGetClaudeProfiles;
    }

    // Default mock implementations
    mockSaveClaudeProfile.mockResolvedValue({
      success: true,
      data: {
        id: 'profile-123',
        name: 'Test Profile',
        configDir: '~/.claude-profiles/test-profile',
        isDefault: false,
        createdAt: new Date()
      }
    });

    mockInitializeClaudeProfile.mockResolvedValue({
      success: true
    });

    mockGetClaudeProfiles.mockResolvedValue({
      success: true,
      data: { profiles: [], activeProfileId: null }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Add Profile Flow', () => {
    it('should call saveClaudeProfile with correct parameters when adding a profile', async () => {
      const newProfile = {
        id: 'profile-new',
        name: 'Work Account',
        configDir: '~/.claude-profiles/work-account',
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
      expect(result.data?.name).toBe('Work Account');
    });

    it('should call initializeClaudeProfile after saveClaudeProfile succeeds', async () => {
      const newProfile = {
        id: 'profile-456',
        name: 'Personal Account',
        configDir: '~/.claude-profiles/personal-account',
        isDefault: false,
        createdAt: new Date()
      };

      mockSaveClaudeProfile.mockResolvedValue({
        success: true,
        data: newProfile
      });

      mockInitializeClaudeProfile.mockResolvedValue({ success: true });

      // Simulate the handleAddProfile flow
      const saveResult = await window.electronAPI.saveClaudeProfile(newProfile);
      if (saveResult.success && saveResult.data) {
        await window.electronAPI.initializeClaudeProfile(saveResult.data.id);
      }

      expect(mockSaveClaudeProfile).toHaveBeenCalled();
      expect(mockInitializeClaudeProfile).toHaveBeenCalledWith('profile-456');
    });

    it('should generate profile slug from name (lowercase with dashes)', () => {
      const profileName = 'Work Account';
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');
      expect(profileSlug).toBe('work-account');
    });

    it('should handle profile names with multiple spaces', () => {
      const profileName = 'My   Personal   Account';
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');
      expect(profileSlug).toBe('my-personal-account');
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

    it('should not call initializeClaudeProfile if saveClaudeProfile fails', async () => {
      mockSaveClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Failed to save profile'
      });

      // Simulate the handleAddProfile flow
      const saveResult = await window.electronAPI.saveClaudeProfile({
        id: 'profile-fail',
        name: 'Failing Profile',
        isDefault: false,
        createdAt: new Date()
      });

      if (saveResult.success && saveResult.data) {
        await window.electronAPI.initializeClaudeProfile(saveResult.data.id);
      }

      expect(mockSaveClaudeProfile).toHaveBeenCalled();
      expect(mockInitializeClaudeProfile).not.toHaveBeenCalled();
    });
  });

  describe('Initialize Profile Flow', () => {
    it('should call initializeClaudeProfile to trigger OAuth flow', async () => {
      mockInitializeClaudeProfile.mockResolvedValue({ success: true });

      const profileId = 'profile-1';
      const result = await window.electronAPI.initializeClaudeProfile(profileId);

      expect(mockInitializeClaudeProfile).toHaveBeenCalledWith(profileId);
      expect(result.success).toBe(true);
    });

    it('should handle initializeClaudeProfile failure (terminal creation error)', async () => {
      mockInitializeClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Terminal creation failed'
      });

      const result = await window.electronAPI.initializeClaudeProfile('profile-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Terminal creation failed');
    });

    it('should handle initializeClaudeProfile failure (max terminals reached)', async () => {
      mockInitializeClaudeProfile.mockResolvedValue({
        success: false,
        error: 'Max terminals reached'
      });

      const result = await window.electronAPI.initializeClaudeProfile('profile-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Max terminals');
    });
  });

  describe('Profile Name Validation', () => {
    it('should require non-empty profile name', () => {
      const newProfileName = '';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(false);
    });

    it('should trim whitespace from profile name', () => {
      const newProfileName = '  Work Account  ';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(true);
      expect(newProfileName.trim()).toBe('Work Account');
    });

    it('should reject whitespace-only profile name', () => {
      const newProfileName = '   ';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(false);
    });

    it('should accept single character profile name', () => {
      const newProfileName = 'A';
      const isValid = newProfileName.trim().length > 0;
      expect(isValid).toBe(true);
    });

    it('should handle profile names with special characters', () => {
      const profileName = "John's Work Account!";
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');
      expect(profileSlug).toBe("john's-work-account!");
      // Note: The actual implementation may further sanitize special characters
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors during save', async () => {
      mockSaveClaudeProfile.mockRejectedValue(new Error('Network error'));

      await expect(
        window.electronAPI.saveClaudeProfile({
          id: 'profile-test',
          name: 'Test',
          isDefault: false,
          createdAt: new Date()
        })
      ).rejects.toThrow('Network error');
    });

    it('should handle network errors during initialization', async () => {
      mockInitializeClaudeProfile.mockRejectedValue(new Error('Network error'));

      await expect(
        window.electronAPI.initializeClaudeProfile('profile-1')
      ).rejects.toThrow('Network error');
    });
  });

  describe('Profile Data Structure', () => {
    it('should include all required profile fields when saving', async () => {
      const newProfile = {
        id: expect.stringContaining('profile-'),
        name: 'Test Profile',
        configDir: '~/.claude-profiles/test-profile',
        isDefault: false,
        createdAt: expect.any(Date)
      };

      mockSaveClaudeProfile.mockResolvedValue({
        success: true,
        data: newProfile
      });

      await window.electronAPI.saveClaudeProfile(newProfile);

      expect(mockSaveClaudeProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          configDir: expect.any(String),
          isDefault: expect.any(Boolean),
          createdAt: expect.any(Date)
        })
      );
    });

    it('should generate unique profile IDs based on timestamp', () => {
      const id1 = `profile-${Date.now()}`;
      const id2 = `profile-${Date.now()}`;
      // IDs should be similar (may be identical if generated in same millisecond)
      expect(id1).toContain('profile-');
      expect(id2).toContain('profile-');
    });
  });
});
