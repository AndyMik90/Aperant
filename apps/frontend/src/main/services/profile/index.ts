/**
 * Profile Service - Barrel Export
 *
 * Re-exports all profile-related functionality for convenient importing.
 * Main process code should import from this index file.
 */

// Profile Manager utilities
export {
  loadProfilesFile,
  saveProfilesFile,
  generateProfileId,
  validateFilePermissions,
  getProfilesFilePath,
  withProfilesLock,
  atomicModifyProfiles
} from './profile-manager';

// Profile Service
export {
  validateBaseUrl,
  validateApiKey,
  validateProfileNameUnique,
  createProfile,
  updateProfile,
  deleteProfile,
  getAPIProfileEnv,
  getAPIProfileEnvById,
  testConnection,
  discoverModels
} from './profile-service';

export type { CreateProfileInput, UpdateProfileInput } from './profile-service';

// Re-export types from shared for convenience
export type {
  APIProfile,
  ProfilesFile,
  ProfileFormData,
  TestConnectionResult,
  ModelInfo,
  DiscoverModelsResult,
  DiscoverModelsError
} from '@shared/types/profile';
