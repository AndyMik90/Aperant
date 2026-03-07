/**
 * Tests for profile-manager.ts
 *
 * Red phase - write failing tests first
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import {
  loadProfilesFile,
  saveProfilesFile,
  generateProfileId,
  validateFilePermissions
} from './profile-manager';
import type { ProfilesFile } from '../../shared/types/profile';

// Mock Electron app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return '/mock/userdata';
      }
      return '/mock/path';
    })
  }
}));

// Mock fs module - mock the promises export which is used by profile-manager.ts
vi.mock('fs', () => {
  const promises = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    chmod: vi.fn()
  };
  return {
    default: { promises }, // Default export contains promises
    promises, // Named export for promises
    existsSync: vi.fn(),
    constants: {
      O_RDONLY: 0,
      S_IRUSR: 0o400
    }
  };
});

describe('profile-manager', () => {
  const _mockProfilesPath = '/mock/userdata/profiles.json';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadProfilesFile', () => {
    it('should return default profiles file when file does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await loadProfilesFile();

      expect(result).toEqual({
        profiles: [],
        activeProfileId: null,
        version: 1
      });
    });

    it('should return default profiles file when file is corrupted JSON', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('invalid json{'));

      const result = await loadProfilesFile();

      expect(result).toEqual({
        profiles: [],
        activeProfileId: null,
        version: 1
      });
    });

    it('should load valid profiles file', async () => {
      const mockData: ProfilesFile = {
        profiles: [
          {
            id: 'test-id-1',
            name: 'Test Profile',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'test-id-1',
        version: 1
      };

      vi.mocked(fsPromises.readFile).mockResolvedValue(
        Buffer.from(JSON.stringify(mockData))
      );

      const result = await loadProfilesFile();

      expect(result).toEqual(mockData);
    });

    it('should use auto-claude directory for profiles.json path', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('ENOENT'));

      await loadProfilesFile();

      // Verify the file path includes auto-claude
      const readFileCalls = vi.mocked(fsPromises.readFile).mock.calls;
      const filePath = readFileCalls[0]?.[0];
      expect(filePath).toContain('auto-claude');
      expect(filePath).toContain('profiles.json');
    });
  });

  describe('saveProfilesFile', () => {
    it('should write profiles file to disk', async () => {
      const mockData: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await saveProfilesFile(mockData);

      expect(fsPromises.writeFile).toHaveBeenCalled();
      const writeFileCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
      const filePath = writeFileCall?.[0];
      const content = writeFileCall?.[1];

      expect(filePath).toContain('auto-claude');
      expect(filePath).toContain('profiles.json');
      expect(content).toBe(JSON.stringify(mockData, null, 2));
    });

    it('should throw error when write fails', async () => {
      const mockData: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      vi.mocked(fsPromises.writeFile).mockRejectedValue(new Error('Write failed'));

      await expect(saveProfilesFile(mockData)).rejects.toThrow('Write failed');
    });
  });

  describe('generateProfileId', () => {
    it('should generate unique UUID v4 format IDs', () => {
      const id1 = generateProfileId();
      const id2 = generateProfileId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // IDs should be unique
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs on consecutive calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateProfileId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('validateFilePermissions', () => {
    it('should validate user-readable only file permissions', async () => {
      // Mock successful chmod
      vi.mocked(fsPromises.chmod).mockResolvedValue(undefined);

      const result = await validateFilePermissions('/mock/path/to/file.json');

      expect(result).toBe(true);
    });

    it('should return false if chmod fails', async () => {
      vi.mocked(fsPromises.chmod).mockRejectedValue(new Error('Permission denied'));

      const result = await validateFilePermissions('/mock/path/to/file.json');

      expect(result).toBe(false);
    });
  });
});
