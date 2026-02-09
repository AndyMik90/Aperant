/**
 * Tests for profile-manager.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadProfilesFile,
  saveProfilesFile,
  generateProfileId,
  validateFilePermissions
} from './profile-manager';
import type { ProfilesFile } from '@shared/types/profile';

// Use vi.hoisted to define mock functions that need to be accessible in vi.mock
const { fsMocks } = vi.hoisted(() => ({
  fsMocks: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    chmod: vi.fn(),
    access: vi.fn(),
    unlink: vi.fn(),
    rename: vi.fn()
  }
}));

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

// Mock proper-lockfile
vi.mock('proper-lockfile', () => ({
  default: {
    lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined))
  }
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    promises: fsMocks
  },
  promises: fsMocks,
  existsSync: vi.fn(),
  constants: {
    O_RDONLY: 0,
    S_IRUSR: 0o400
  }
}));

describe('profile-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks to resolve
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.chmod.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadProfilesFile', () => {
    it('should return default profiles file when file does not exist', async () => {
      fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await loadProfilesFile();

      expect(result).toEqual({
        profiles: [],
        activeProfileId: null,
        version: 1
      });
    });

    it('should return default profiles file when file is corrupted JSON', async () => {
      fsMocks.readFile.mockResolvedValue(Buffer.from('invalid json{'));

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

      fsMocks.readFile.mockResolvedValue(
        Buffer.from(JSON.stringify(mockData))
      );

      const result = await loadProfilesFile();

      expect(result).toEqual(mockData);
    });

    it('should use ac-jerry directory for profiles.json path', async () => {
      fsMocks.readFile.mockRejectedValue(new Error('ENOENT'));

      await loadProfilesFile();

      // Verify the file path includes ac-jerry
      const readFileCalls = fsMocks.readFile.mock.calls;
      const filePath = readFileCalls[0]?.[0];
      expect(filePath).toContain('ac-jerry');
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

      await saveProfilesFile(mockData);

      expect(fsMocks.writeFile).toHaveBeenCalled();
      const writeFileCall = fsMocks.writeFile.mock.calls[0];
      const filePath = writeFileCall?.[0];
      const content = writeFileCall?.[1];

      expect(filePath).toContain('ac-jerry');
      expect(filePath).toContain('profiles.json');
      expect(content).toBe(JSON.stringify(mockData, null, 2));
    });

    it('should throw error when write fails', async () => {
      const mockData: ProfilesFile = {
        profiles: [],
        activeProfileId: null,
        version: 1
      };

      fsMocks.writeFile.mockRejectedValue(new Error('Write failed'));

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
      fsMocks.chmod.mockResolvedValue(undefined);

      const result = await validateFilePermissions('/mock/path/to/file.json');

      expect(result).toBe(true);
    });

    it('should return false if chmod fails', async () => {
      fsMocks.chmod.mockRejectedValue(new Error('Permission denied'));

      const result = await validateFilePermissions('/mock/path/to/file.json');

      expect(result).toBe(false);
    });
  });
});
