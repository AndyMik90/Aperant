/**
 * Profile Manager - File I/O for API profiles
 *
 * Handles loading and saving profiles.json from the auto-claude directory.
 * Provides graceful handling for missing or corrupted files.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import type { ProfilesFile } from '../../shared/types/profile';

/**
 * Get the path to profiles.json in the auto-claude directory
 */
export function getProfilesFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'auto-claude', 'profiles.json');
}

/**
 * Load profiles.json from disk
 * Returns default empty profiles file if file doesn't exist or is corrupted
 */
export async function loadProfilesFile(): Promise<ProfilesFile> {
  const filePath = getProfilesFilePath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as ProfilesFile;
    return data;
  } catch (_error) {
    // File doesn't exist or is corrupted - return default
    return {
      profiles: [],
      activeProfileId: null,
      version: 1
    };
  }
}

/**
 * Save profiles.json to disk
 * Creates the auto-claude directory if it doesn't exist
 */
export async function saveProfilesFile(data: ProfilesFile): Promise<void> {
  const filePath = getProfilesFilePath();
  const dir = path.dirname(filePath);

  // Ensure directory exists
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // Only ignore EEXIST errors (directory already exists)
    // Rethrow other errors (e.g., permission issues)
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  // Write file with formatted JSON
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Generate a unique UUID v4 for a new profile
 */
export function generateProfileId(): string {
  // Generate UUID v4
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
