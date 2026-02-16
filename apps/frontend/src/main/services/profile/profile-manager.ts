/**
 * Profile Manager - File I/O for API profiles
 *
 * Handles loading and saving profiles.json from the auto-claude directory.
 * Provides graceful handling for missing or corrupted files.
 * Uses file locking to prevent race conditions in concurrent operations.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
// @ts-expect-error - no types available for proper-lockfile
import * as lockfile from 'proper-lockfile';
import type { APIProfile, ProfilesFile } from '@shared/types/profile';

/**
 * Get the path to profiles.json in the auto-claude directory
 */
export function getProfilesFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'auto-claude', 'profiles.json');
}

/**
 * Check if a value is a valid profile object with required fields
 */
function isValidProfile(value: unknown): value is APIProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    typeof profile.baseUrl === 'string' &&
    typeof profile.apiKey === 'string' &&
    typeof profile.createdAt === 'number' &&
    typeof profile.updatedAt === 'number'
  );
}

/**
 * Validate the structure of parsed profiles data
 */
function isValidProfilesFile(data: unknown): data is ProfilesFile {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;

  // Check profiles is an array
  if (!Array.isArray(obj.profiles)) {
    return false;
  }

  // Check each profile has required fields
  for (const profile of obj.profiles) {
    if (!isValidProfile(profile)) {
      return false;
    }
  }

  // Check activeProfileId is string or null
  if (obj.activeProfileId !== null && typeof obj.activeProfileId !== 'string') {
    return false;
  }

  // Check version is a number
  if (typeof obj.version !== 'number') {
    return false;
  }

  return true;
}

/**
 * Default profiles file structure for fallback
 */
function getDefaultProfilesFile(): ProfilesFile {
  return {
    profiles: [],
    activeProfileId: null,
    version: 1
  };
}

/**
 * Load profiles.json from disk
 * Returns default empty profiles file if file doesn't exist or is corrupted
 */
export async function loadProfilesFile(): Promise<ProfilesFile> {
  const filePath = getProfilesFilePath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Validate parsed data structure
    if (isValidProfilesFile(data)) {
      return data;
    }

    // Validation failed - return default
    return getDefaultProfilesFile();
  } catch {
    // File doesn't exist or read/parse error - return default
    return getDefaultProfilesFile();
  }
}

/**
 * Save profiles.json to disk
 * Creates the auto-claude directory if it doesn't exist
 * Ensures secure file permissions (user read/write only)
 */
export async function saveProfilesFile(data: ProfilesFile): Promise<void> {
  const filePath = getProfilesFilePath();
  const dir = path.dirname(filePath);

  // Ensure directory exists
  // mkdir with recursive: true resolves successfully if dir already exists
  await fs.mkdir(dir, { recursive: true });

  // Write file with formatted JSON
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');

  // Set secure file permissions (user read/write only - 0600)
  const permissionsValid = await validateFilePermissions(filePath);
  if (!permissionsValid) {
    throw new Error('Failed to set secure file permissions on profiles file');
  }
}

/**
 * Generate a unique UUID v4 for a new profile
 */
export function generateProfileId(): string {
  // Use crypto.randomUUID() if available (Node.js 16+ and modern browsers)
  // Fall back to hand-rolled implementation for older environments
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: hand-rolled UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validate and set file permissions to user-readable only
 * Returns true if successful, false otherwise
 */
export async function validateFilePermissions(filePath: string): Promise<boolean> {
  try {
    // Set file permissions to user-readable only (0600)
    await fs.chmod(filePath, 0o600);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a function with exclusive file lock to prevent race conditions
 * This ensures atomic read-modify-write operations on the profiles file
 *
 * @param fn Function to execute while holding the lock
 * @returns Result of the function execution
 */
export async function withProfilesLock<T>(fn: () => Promise<T>): Promise<T> {
  const filePath = getProfilesFilePath();
  const dir = path.dirname(filePath);

  // Ensure directory and file exist before trying to lock
  await fs.mkdir(dir, { recursive: true });

  // Create file if it doesn't exist (needed for lockfile to work)
  try {
    await fs.access(filePath);
  } catch {
    // File doesn't exist, create it atomically with exclusive flag
    const defaultData = getDefaultProfilesFile();
    try {
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), { encoding: 'utf-8', flag: 'wx' });
    } catch (err: unknown) {
      // If file was created by another process (race condition), that's fine
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      // EEXIST means another process won the race, proceed normally
    }
  }

  // Acquire lock with reasonable timeout
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, {
      retries: {
        retries: 10,
        minTimeout: 50,
        maxTimeout: 500
      }
    });

    // Execute the function while holding the lock
    return await fn();
  } finally {
    // Always release the lock
    if (release) {
      await release();
    }
  }
}

/**
 * Set the active API profile by ID
 * This atomically updates the activeProfileId in profiles.json
 *
 * @param profileId - The profile ID to set as active, or null to clear
 * @returns The updated ProfilesFile
 */
export async function setActiveAPIProfile(profileId: string | null): Promise<ProfilesFile> {
  return await atomicModifyProfiles((file) => {
    // Validate that the profile exists if setting an ID
    if (profileId !== null) {
      const profile = file.profiles.find(p => p.id === profileId);
      if (!profile) {
        throw new Error(`API profile not found: ${profileId}`);
      }
    }
    return {
      ...file,
      activeProfileId: profileId
    };
  });
}

/**
 * Atomically modify the profiles file
 * Loads, modifies, and saves the file within an exclusive lock
 *
 * @param modifier Function that modifies the ProfilesFile
 * @returns The modified ProfilesFile
 */
export async function atomicModifyProfiles(
  modifier: (file: ProfilesFile) => ProfilesFile | Promise<ProfilesFile>
): Promise<ProfilesFile> {
  return await withProfilesLock(async () => {
    // Load current state
    const file = await loadProfilesFile();

    // Apply modification
    const modifiedFile = await modifier(file);

    // Save atomically (write to temp file and rename)
    const filePath = getProfilesFilePath();
    const tempPath = `${filePath}.tmp`;

    try {
      // Write to temp file
      const content = JSON.stringify(modifiedFile, null, 2);
      await fs.writeFile(tempPath, content, 'utf-8');

      // Set permissions on temp file
      await fs.chmod(tempPath, 0o600);

      // Atomically replace original file
      await fs.rename(tempPath, filePath);

      return modifiedFile;
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  });
}
