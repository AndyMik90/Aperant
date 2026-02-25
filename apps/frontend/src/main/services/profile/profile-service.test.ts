/**
 * Tests for profile-service.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateBaseUrl,
  validateApiKey,
  validateProfileNameUnique,
  createProfile,
  updateProfile,
  getAPIProfileEnv,
  testConnection,
  discoverModels
} from './profile-service';
import type { ProfilesFile, } from '@shared/types/profile';

// Mock Anthropic SDK - use vi.hoisted to properly hoist the mock variable
const { mockModelsList, mockMessagesCreate } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
  mockMessagesCreate: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => {
  // Create mock error classes
  class APIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }
  class AuthenticationError extends APIError {
    constructor(message: string) {
      super(message, 401);
      this.name = 'AuthenticationError';
    }
  }
  class NotFoundError extends APIError {
    constructor(message: string) {
      super(message, 404);
      this.name = 'NotFoundError';
    }
  }
  class APIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }
  class APIConnectionTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }
  class BadRequestError extends APIError {
    constructor(message: string) {
      super(message, 400);
      this.name = 'BadRequestError';
    }
  }

  return {
    default: class Anthropic {
      models = {
        list: mockModelsList
      };
      messages = {
        create: mockMessagesCreate
      };
    },
    APIError,
    AuthenticationError,
    NotFoundError,
    APIConnectionError,
    APIConnectionTimeoutError,
    BadRequestError
  };
});

// Mock profile-manager
vi.mock('./profile-manager', () => ({
  loadProfilesFile: vi.fn(),
  saveProfilesFile: vi.fn(),
  generateProfileId: vi.fn(() => 'mock-uuid-1234'),
  validateFilePermissions: vi.fn().mockResolvedValue(true),
  getProfilesFilePath: vi.fn(() => '/mock/profiles.json'),
  atomicModifyProfiles: vi.fn(async (modifier: (file: ProfilesFile) => ProfilesFile) => {
    // Get the current mock file from loadProfilesFile
    const { loadProfilesFile, saveProfilesFile } = await import('./profile-manager');
    const file = await loadProfilesFile();
    const modified = modifier(file);
    await saveProfilesFile(modified);
    return modified;
  })
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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
        await import('./profile-manager');
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
      const { loadProfilesFile } = await import('./profile-manager');
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
      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile, saveProfilesFile } = await import('./profile-manager');
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
      expect(result.updatedAt).toBeGreaterThan(1000000);
      expect(result.createdAt).toBe(1000000);
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

      const { loadProfilesFile, saveProfilesFile } = await import('./profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);
      vi.mocked(saveProfilesFile).mockResolvedValue(undefined);

      const input = {
        id: 'existing-id',
        name: 'my profile',
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

      const { loadProfilesFile } = await import('./profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const input = {
        id: 'profile-1',
        name: 'Profile Two',
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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
        activeProfileId: null,
        version: 1
      };

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
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

      const { loadProfilesFile } = await import('./profile-manager');
      vi.mocked(loadProfilesFile).mockResolvedValue(mockFile);

      const result = await getAPIProfileEnv();

      expect(result).not.toHaveProperty('ANTHROPIC_BASE_URL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
      expect(result).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL');
      expect(result).toEqual({
        ANTHROPIC_AUTH_TOKEN: 'sk-test-key-12345678',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929'
      });
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      mockModelsList.mockReset();
      mockMessagesCreate.mockReset();
    });

    // Helper to create mock errors with proper name property
    const createMockError = (name: string, message: string) => {
      const error = new Error(message);
      error.name = name;
      return error;
    };

    it('should return success for valid credentials (200 response)', async () => {
      mockModelsList.mockResolvedValue({ data: [] });

      const result = await testConnection('https://api.anthropic.com', 'sk-ant-test-key-12');

      expect(result).toEqual({
        success: true,
        message: 'Connection successful'
      });
    });

    it('should return auth error for invalid API key (401 response)', async () => {
      mockModelsList.mockRejectedValue(createMockError('AuthenticationError', 'Unauthorized'));

      const result = await testConnection('https://api.anthropic.com', 'sk-invalid-key-12');

      expect(result).toEqual({
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      });
    });

    it('should return network error for connection refused', async () => {
      mockModelsList.mockRejectedValue(createMockError('APIConnectionError', 'ECONNREFUSED'));

      const result = await testConnection('https://unreachable.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'network',
        message: 'Network error. Please check your internet connection.'
      });
    });

    it('should return timeout error for AbortError', async () => {
      mockModelsList.mockRejectedValue(createMockError('APIConnectionTimeoutError', 'Timeout'));

      const result = await testConnection('https://slow.example.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      });
    });

    it('should auto-prepend https:// if missing', async () => {
      mockModelsList.mockResolvedValue({ data: [] });

      const result = await testConnection('api.anthropic.com', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: true,
        message: 'Connection successful'
      });
    });

    it('should return error for empty baseUrl', async () => {
      const result = await testConnection('', 'sk-test-key-12chars');

      expect(result).toEqual({
        success: false,
        errorType: 'endpoint',
        message: 'Invalid endpoint. Please check the Base URL.'
      });
      expect(mockModelsList).not.toHaveBeenCalled();
    });

    it('should return error for invalid API key format', async () => {
      const result = await testConnection('https://api.anthropic.com', 'short');

      expect(result).toEqual({
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      });
      expect(mockModelsList).not.toHaveBeenCalled();
    });
  });

  describe('discoverModels', () => {
    beforeEach(() => {
      mockModelsList.mockReset();
    });

    // Helper to create mock errors with proper name property
    const createMockError = (name: string, message: string) => {
      const error = new Error(message);
      error.name = name;
      return error;
    };

    it('should return list of models for successful response', async () => {
      mockModelsList.mockResolvedValue({
        data: [
          { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5', created_at: '2024-10-22', type: 'model' },
          { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2024-10-22', type: 'model' }
        ]
      });

      const result = await discoverModels('https://api.anthropic.com', 'sk-ant-test-key-12');

      expect(result).toEqual({
        models: [
          { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
        ]
      });
    });

    it('should throw auth error for 401 response', async () => {
      mockModelsList.mockRejectedValue(createMockError('AuthenticationError', 'Unauthorized'));

      const error = await discoverModels('https://api.anthropic.com', 'sk-invalid-key')
        .catch(e => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { errorType?: string }).errorType).toBe('auth');
    });

    it('should throw not_supported error for 404 response', async () => {
      mockModelsList.mockRejectedValue(createMockError('NotFoundError', 'Not Found'));

      const error = await discoverModels('https://custom-api.com', 'sk-test-key-12345678')
        .catch(e => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { errorType?: string }).errorType).toBe('not_supported');
    });

    it('should auto-prepend https:// if missing', async () => {
      mockModelsList.mockResolvedValue({ data: [] });

      const result = await discoverModels('api.anthropic.com', 'sk-test-key-12chars');

      expect(result).toEqual({ models: [] });
    });
  });
});
