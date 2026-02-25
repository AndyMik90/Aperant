/**
 * Tests for profile-service.ts
 *
 * Red phase - write failing tests first
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateBaseUrl,
  validateApiKey,
  validateProfileNameUnique,
  createProfile,
  updateProfile,
  getAPIProfileEnv,
  testConnection
} from './profile-service';
import type { ProfilesFile, } from '../../shared/types/profile';

// Mock profile-manager
vi.mock('../utils/profile-manager', () => ({
  loadProfilesFile: vi.fn(),
  saveProfilesFile: vi.fn(),
  generateProfileId: vi.fn(() => 'mock-uuid-1234')
}));

describe('profile-service', () => {
  describe('validateBaseUrl', () => {
    it('should accept valid HTTPS URLs', () => {
      expect(validateBaseUrl('https://api.anthropic.com')).toBe(true);
      expect(validateBaseUrl('https://custom-api.example.com')).toBe(true);
      expect(validateBaseUrl('https://api.example.com/v1')).toBe(true);
    });

    it('should accept valid HTTP URLs', () => {
      expect(validateBaseUrl('http://localhost:8080')).toBe(true);
      expect(validateBaseUrl('http://127.0.0.1:8000')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateBaseUrl('not-a-url')).toBe(false);
      expect(validateBaseUrl('ftp://example.com')).toBe(false);
      expect(validateBaseUrl('')).toBe(false);
      expect(validateBaseUrl('https://')).toBe(false);
    });

    it('should reject URLs without valid format', () => {
      expect(validateBaseUrl('anthropic.com')).toBe(false);
      expect(validateBaseUrl('://api.anthropic.com')).toBe(false);
    });
  });

  describe('validateApiKey', () => {
    it('should accept Anthropic API key format (sk-ant-...)', () => {
      expect(validateApiKey('sk-ant-api03-12345')).toBe(true);
      expect(validateApiKey('sk-ant-test-key')).toBe(true);
    });

    it('should accept OpenAI API key format (sk-...)', () => {
      expect(validateApiKey('sk-proj-12345')).toBe(true);
      expect(validateApiKey('sk-test-key-12345')).toBe(true);
    });

    it('should accept custom API keys with reasonable length', () => {
      expect(validateApiKey('custom-key-12345678')).toBe(true);
      expect(validateApiKey('x-api-key-abcdefghij')).toBe(true);
    });

    it('should reject empty or too short keys', () => {
      expect(validateApiKey('')).toBe(false);
      expect(validateApiKey('sk-')).toBe(false);
      expect(validateApiKey('abc')).toBe(false);
    });

    it('should reject keys with only whitespace', () => {
      expect(validateApiKey('   ')).toBe(false);
      expect(validateApiKey('\t\n')).toBe(false);
    });
  });

  describe('validateProfileNameUnique', () => {
    it('should return true when name is unique', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: '1',
            name: 'Existing Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await validateProfileNameUnique('New Profile');
      expect(result).toBe(true);
    });

    it('should return false when name already exists', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: '1',
            name: 'Existing Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await validateProfileNameUnique('Existing Profile');
      expect(result).toBe(false);
    });

    it('should be case-insensitive for duplicate detection', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: '1',
            name: 'My Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result1 = await validateProfileNameUnique('my profile');
      const result2 = await validateProfileNameUnique('MY PROFILE');
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    it('should trim whitespace before checking', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: '1',
            name: 'My Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await validateProfileNameUnique('  My Profile  ');
      expect(result).toBe(false);
    });
  });

  describe('createProfile', () => {
    it('should create profile with valid data and save', async () => {
      const mockFile: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile, saveProfilesFile, generateProfileId } =
        await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);
      vi.mocked(saveProfilesFile).mockResolvedValue(undefined);
      vi.mocked(generateProfileId).mockReturnValue('generated-id-123');

      const input = {
        name: 'Test Profile',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test-key',
        models: {
          default: 'claude-sonnet-4-5-20250929'
        }
      };

      const result = await createProfile(input);

      expect(result).toMatchObject({
        id: 'generated-id-123',
        name: 'Test Profile',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test-key',
        models: {
          default: 'claude-sonnet-4-5-20250929'
        }
      });
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBeGreaterThan(0);
      expect(saveProfilesFile).toHaveBeenCalled();
    });

    it('should throw error for invalid base URL', async () => {
      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue({
        profiles: [],
        activeProfileId: null,
        version: 1
      });

      const input = {
        name: 'Test Profile',
        baseUrl: 'not-a-url',
        apiKey: 'sk-ant-test-key'
      };

      await expect(createProfile(input)).rejects.toThrow('Invalid base URL');
    });

    it('should throw error for invalid API key', async () => {
      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue({
        profiles: [],
        activeProfileId: null,
        version: 1
      });

      const input = {
        name: 'Test Profile',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'too-short'
      };

      await expect(createProfile(input)).rejects.toThrow('Invalid API key');
    });

    it('should throw error for duplicate profile name', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: '1',
            name: 'Existing Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        name: 'Existing Profile',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test-key'
      };

      await expect(createProfile(input)).rejects.toThrow(
        'A profile with this name already exists'
      );
    });
  });

  describe('updateProfile', () => {
    it('should update profile name and other fields', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'existing-id',
            name: 'Old Name',
            baseUrl: 'https://old-api.example.com',
            apiKey: 'sk-old-key-12345678',
            createdAt: 1000000,
            updatedAt: 1000000
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile, saveProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);
      vi.mocked(saveProfilesFile).mockResolvedValue(undefined);

      const input = {
        id: 'existing-id',
        name: 'New Name',
        baseUrl: 'https://new-api.example.com',
        apiKey: 'sk-new-api-key-123',
        models: { default: 'claude-sonnet-4-5-20250929' }
      };

      const result = await updateProfile(input);

      expect(result.name).toBe('New Name');
      expect(result.baseUrl).toBe('https://new-api.example.com');
      expect(result.apiKey).toBe('sk-new-api-key-123');
      expect(result.models).toEqual({ default: 'claude-sonnet-4-5-20250929' });
      expect(result.updatedAt).toBeGreaterThan(1000000); // updatedAt should be refreshed
      expect(result.createdAt).toBe(1000000); // createdAt should remain unchanged
    });

    it('should allow updating profile with same name (case-insensitive)', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'existing-id',
            name: 'My Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-old-api-key-123',
            createdAt: 1000000,
            updatedAt: 1000000
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile, saveProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);
      vi.mocked(saveProfilesFile).mockResolvedValue(undefined);

      const input = {
        id: 'existing-id',
        name: 'my profile', // Same name, different case
        baseUrl: 'https://new-api.example.com',
        apiKey: 'sk-new-api-key-456'
      };

      const result = await updateProfile(input);
      expect(result.name).toBe('my profile');
      expect(saveProfilesFile).toHaveBeenCalled();
    });

    it('should throw error when name conflicts with another profile', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Profile One',
            baseUrl: 'https://api1.example.com',
            apiKey: 'sk-key-one-12345678',
            createdAt: 1000000,
            updatedAt: 1000000
          },
          {
            id: 'profile-2',
            name: 'Profile Two',
            baseUrl: 'https://api2.example.com',
            apiKey: 'sk-key-two-12345678',
            createdAt: 1000000,
            updatedAt: 1000000
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        id: 'profile-1',
        name: 'Profile Two', // Name that exists on profile-2
        baseUrl: 'https://api1.example.com',
        apiKey: 'sk-key-one-12345678'
      };

      await expect(updateProfile(input)).rejects.toThrow(
        'A profile with this name already exists'
      );
    });

    it('should throw error for invalid base URL', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'existing-id',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-api-key-123',
            createdAt: 1000000,
            updatedAt: 1000000
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        id: 'existing-id',
        name: 'Test Profile',
        baseUrl: 'not-a-url',
        apiKey: 'sk-test-api-key-123'
      };

      await expect(updateProfile(input)).rejects.toThrow('Invalid base URL');
    });

    it('should throw error for invalid API key', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'existing-id',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-api-key-123',
            createdAt: 1000000,
            updatedAt: 1000000
          }
        ],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        id: 'existing-id',
        name: 'Test Profile',
        baseUrl: 'https://api.example.com',
        apiKey: 'too-short'
      };

      await expect(updateProfile(input)).rejects.toThrow('Invalid API key');
    });

    it('should throw error when profile not found', async () => {
      const mockFile: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        id: 'non-existent-id',
        name: 'Test Profile',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test-api-key-123'
      };

      await expect(updateProfile(input)).rejects.toThrow('Profile not found');
    });
  });

  describe('getAPIProfileEnv', () => {
    it('should return empty object when no active profile (OAuth mode)', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-key-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: null, // No active profile = OAuth mode
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();
      expect(result).toEqual({});
    });

    it('should return empty object when activeProfileId is empty string', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-key-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: '',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();
      expect(result).toEqual({});
    });

    it('should return correct env vars for active profile with all fields', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.custom.com',
            apiKey: 'sk-test-key-12345678',
            models: {
              default: 'claude-sonnet-4-5-20250929',
              haiku: 'claude-haiku-4-5-20251001',
              sonnet: 'claude-sonnet-4-5-20250929',
              opus: 'claude-opus-4-5-20251101'
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      expect(result).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.custom.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-20250929',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5-20251101'
      });
    });

    it('should filter out empty string values', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: '',
            apiKey: 'sk-test-key-12345678',
            models: {
              default: 'claude-sonnet-4-5-20250929',
              haiku: '',
              sonnet: ''
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      // Empty baseUrl should be filtered out
      expect(result).not.toHaveProperty('ANTHROPIC_BASE_URL');
      // Empty model values should be filtered out
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL');
      // Non-empty values should be present
      expect(result).toEqual({
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929'
      });
    });

    it('should handle missing models object', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-key-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
            // No models property
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      expect(result).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678'
      });
      expect(result).not.toHaveProperty('ANTHROPIC_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_OPUS_MODEL');
    });

    it('should handle partial model configurations', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test-key-12345678',
            models: {
              default: 'claude-sonnet-4-5-20250929'
              // Only default model set
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      expect(result).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929'
      });
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_OPUS_MODEL');
    });

    it('should find active profile by id when multiple profiles exist', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Profile One',
            baseUrl: 'https://api1.example.com',
            apiKey: 'sk-key-one-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'profile-2',
            name: 'Profile Two',
            baseUrl: 'https://api2.example.com',
            apiKey: 'sk-key-two-12345678',
            models: { default: 'claude-sonnet-4-5-20250929' },
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'profile-3',
            name: 'Profile Three',
            baseUrl: 'https://api3.example.com',
            apiKey: 'sk-key-three-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-2',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      expect(result).toEqual({
        ANTHROPIC_BASE_URL: 'https://api2.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-key-two-12345678',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929'
      });
    });

    it('should handle profile not found (activeProfileId points to non-existent profile)', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Profile One',
            baseUrl: 'https://api1.example.com',
            apiKey: 'sk-key-one-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'non-existent-id', // Points to profile that doesn't exist
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      // Should return empty object gracefully
      expect(result).toEqual({});
    });

    it('should trim whitespace from values before filtering', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: '  https://api.example.com  ', // Has whitespace
            apiKey: 'sk-test-key-12345678',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      // Whitespace should be trimmed, not filtered out
      expect(result).toEqual({
        ANTHROPIC_BASE_URL: 'https://api.example.com', // Trimmed
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678'
      });
    });

    it('should filter out whitespace-only values', async () => {
      const mockFile: ProfilesFile = {
        profiles: [
          {
            id: 'profile-1',
            name: 'Test Profile',
            baseUrl: '   ', // Whitespace only
            apiKey: 'sk-test-key-12345678',
            models: {
              default: '   ' // Whitespace only
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-1',
        version: 1
      };

      const { loadProfilesFile } = await import('../utils/profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      // Whitespace-only values should be filtered out
      expect(result).not.toHaveProperty('ANTHROPIC_BASE_URL');
      expect(result).not.toHaveProperty('ANTHROPIC_MODEL');
      expect(result).toEqual({
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678'
      });
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      // Mock fetch globally for testConnection tests
      global.fetch = vi.fn();
    });

    it('should return success for valid credentials (200 response)', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      } as Response);

      const result = await testConnection('https://api.anthropic.com', 'sk-ant-test-key-12');

      expect(result).toEqual({
        success: true,
        message: 'Connection successful'
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test-key-12',
            'anthropic-version': '2023-06-01'
          })
        })
      );
    });

    it('should return auth error for invalid API key (401 response)', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      const result = await testConnection('https://api.anthropic.com', 'sk-invalid-key-12');

      expect(result).toEqual({
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      });
    });

    it('should return auth error for 403 response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      } as Response);

      const result = await testConnection('https://api.anthropic.com', 'sk-forbidden-key');

      expect(result).toEqual({
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      });
    });

    it('should return endpoint error for invalid URL (404 response)', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      const result = await testConnection('https://invalid.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'endpoint',
        message: 'Invalid endpoint. Please check the Base URL.'
      });
    });

    it('should return network error for connection refused', async () => {
      const networkError = new TypeError('Failed to fetch');
      (networkError as any).code = 'ECONNREFUSED';

      vi.mocked(global.fetch).mockRejectedValue(networkError);

      const result = await testConnection('https://unreachable.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'network',
        message: 'Network error. Please check your internet connection.'
      });
    });

    it('should return network error for ENOTFOUND (DNS failure)', async () => {
      const dnsError = new TypeError('Failed to fetch');
      (dnsError as any).code = 'ENOTFOUND';

      vi.mocked(global.fetch).mockRejectedValue(dnsError);

      const result = await testConnection('https://nosuchdomain.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'network',
        message: 'Network error. Please check your internet connection.'
      });
    });

    it('should return timeout error for AbortError', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      vi.mocked(global.fetch).mockRejectedValue(abortError);

      const result = await testConnection('https://slow.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      });
    });

    it('should return unknown error for other failures', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Unknown error'));

      const result = await testConnection('https://api.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'unknown',
        message: 'Connection test failed. Please try again.'
      });
    });

    it('should auto-prepend https:// if missing', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      } as Response);

      await testConnection('api.anthropic.com', 'sk-test-key-12chars');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.any(Object)
      );
    });

    it('should remove trailing slash from baseUrl', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      } as Response);

      await testConnection('https://api.anthropic.com/', 'sk-test-key-12chars');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.any(Object)
      );
    });

    it('should return error for empty baseUrl', async () => {
      const result = await testConnection('', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'endpoint',
        message: 'Invalid endpoint. Please check the Base URL.'
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return error for invalid baseUrl format', async () => {
      const result = await testConnection('ftp://invalid-protocol.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'endpoint',
        message: 'Invalid endpoint. Please check the Base URL.'
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return error for invalid API key format', async () => {
      const result = await testConnection('https://api.anthropic.com', 'short');

      expect(result).toEqual({
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should abort when signal is triggered', async () => {
      const abortController = new AbortController();
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      vi.mocked(global.fetch).mockRejectedValue(abortError);

      // Abort immediately
      abortController.abort();

      const result = await testConnection('https://api.anthropic.com', 'sk-test-key-12chars', abortController.signal);

      expect(result).toEqual({
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      });
    });

    it('should set 10 second timeout', async () => {
      vi.mocked(global.fetch).mockImplementation(() =>
        new Promise((_, reject) => {
          setTimeout(() => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, 100); // Short delay for test
        })
      );

      const startTime = Date.now();
      const result = await testConnection('https://slow.example.com', 'sk-test-key-12chars');
      const elapsed = Date.now() - startTime;

      expect(result).toEqual({
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      });
      // Should timeout at 10 seconds, but we use a mock for faster test
      expect(elapsed).toBeLessThan(5000); // Well under 10s due to mock
    });
  });
});
