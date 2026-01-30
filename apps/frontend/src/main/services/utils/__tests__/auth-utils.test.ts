/**
 * Tests for auth-utils.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasValidAPIProfile } from '../auth-utils';
import type { ProfilesFile } from '@shared/types/profile';

// Use vi.hoisted to define mock functions that need to be accessible in vi.mock
const { mockLoadProfilesFile } = vi.hoisted(() => ({
  mockLoadProfilesFile: vi.fn()
}));

vi.mock('../../profile/profile-manager', () => ({
  loadProfilesFile: mockLoadProfilesFile
}));

describe('auth-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasValidAPIProfile', () => {
    it('should return true when an active profile exists', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(true);
      expect(mockLoadProfilesFile).toHaveBeenCalledTimes(1);
    });

    it('should return false when activeProfileId is null', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should return false when activeProfileId is empty string', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: '',
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should return false when activeProfileId does not match any profile', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'non-existent-profile',
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should return false when profiles list is empty', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [],
        activeProfileId: 'some-profile-id',
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should return false when loadProfilesFile throws an error', async () => {
      mockLoadProfilesFile.mockRejectedValue(new Error('Failed to load profiles'));

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should return false when profiles file does not exist (default structure)', async () => {
      // When file doesn't exist, loadProfilesFile returns default structure
      const defaultProfilesFile: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(defaultProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(false);
    });

    it('should handle multiple profiles and correctly identify the active one', async () => {
      const mockProfilesFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Profile 1',
            baseUrl: 'https://api.example1.com',
            apiKey: 'sk-key-1',
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'profile-2',
            name: 'Profile 2',
            baseUrl: 'https://api.example2.com',
            apiKey: 'sk-key-2',
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'profile-3',
            name: 'Profile 3',
            baseUrl: 'https://api.example3.com',
            apiKey: 'sk-key-3',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-2',
        version: 1
      };

      mockLoadProfilesFile.mockResolvedValue(mockProfilesFile);

      const result = await hasValidAPIProfile();

      expect(result).toBe(true);
    });
  });
});
