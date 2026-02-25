/**
 * Profile IPC Handlers
 *
 * IPC handlers for API profile management:
 * - profiles:get - Get all profiles
 * - profiles:save - Save/create a profile
 * - profiles:update - Update an existing profile
 * - profiles:delete - Delete a profile
 * - profiles:setActive - Set active profile
 * - profiles:test-connection - Test API profile connection
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { APIProfile, ProfileFormData, ProfilesFile, TestConnectionResult, DiscoverModelsResult } from '@shared/types/profile';
import {
  loadProfilesFile,
  validateFilePermissions,
  getProfilesFilePath,
  atomicModifyProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  testConnection,
  discoverModels
} from '../services/profile';

// Track active test connection requests for cancellation
const activeTestConnections = new Map<number, AbortController>();

// Track active discover models requests for cancellation
const activeDiscoverModelsRequests = new Map<number, AbortController>();

/**
 * Register all profile-related IPC handlers
 */
export function registerProfileHandlers(): void {
  /**
   * Get all profiles
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_GET,
    async (): Promise<IPCResult<ProfilesFile>> => {
      try {
        const profiles = await loadProfilesFile();
        return { success: true, data: profiles };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load profiles'
        };
      }
    }
  );

  /**
   * Save/create a profile
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_SAVE,
    async (
      _,
      profileData: ProfileFormData
    ): Promise<IPCResult<APIProfile>> => {
      try {
        // Use createProfile from service layer (handles validation)
        const newProfile = await createProfile(profileData);

        // Set file permissions to user-readable only
        await validateFilePermissions(getProfilesFilePath()).catch((err) => {
          console.warn('[profile-handlers] Failed to set secure file permissions:', err);
        });

        return { success: true, data: newProfile };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save profile'
        };
      }
    }
  );

  /**
   * Update an existing profile
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_UPDATE,
    async (_, profileData: APIProfile): Promise<IPCResult<APIProfile>> => {
      try {
        // Use updateProfile from service layer (handles validation)
        const updatedProfile = await updateProfile({
          id: profileData.id,
          name: profileData.name,
          baseUrl: profileData.baseUrl,
          apiKey: profileData.apiKey,
          models: profileData.models
        });

        // Set file permissions to user-readable only
        await validateFilePermissions(getProfilesFilePath()).catch((err) => {
          console.warn('[profile-handlers] Failed to set secure file permissions:', err);
        });

        return { success: true, data: updatedProfile };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update profile'
        };
      }
    }
  );

  /**
   * Delete a profile
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_DELETE,
    async (_, profileId: string): Promise<IPCResult> => {
      try {
        // Use deleteProfile from service layer (handles validation)
        await deleteProfile(profileId);

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete profile'
        };
      }
    }
  );

  /**
   * Set active profile
   * - If profileId is provided, set that profile as active
   * - If profileId is null, clear active profile (switch to OAuth)
   * Uses atomic operation to prevent race conditions
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_SET_ACTIVE,
    async (_, profileId: string | null): Promise<IPCResult> => {
      try {
        await atomicModifyProfiles((file) => {
          // If switching to OAuth (null), clear active profile
          if (profileId === null) {
            file.activeProfileId = null;
            return file;
          }

          // Check if profile exists
          const profileExists = file.profiles.some((p) => p.id === profileId);
          if (!profileExists) {
            throw new Error('Profile not found');
          }

          // Set active profile
          file.activeProfileId = profileId;
          return file;
        });

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set active profile'
        };
      }
    }
  );

  /**
   * Test API profile connection
   * - Tests credentials by making a minimal API request
   * - Returns detailed error information for different failure types
   * - Includes configurable timeout (defaults to 15 seconds)
   * - Supports cancellation via PROFILES_TEST_CONNECTION_CANCEL
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_TEST_CONNECTION,
    async (_event, baseUrl: string, apiKey: string, requestId: number): Promise<IPCResult<TestConnectionResult>> => {
      // Create AbortController for timeout and cancellation
      const controller = new AbortController();
      const timeoutMs = 15000; // 15 seconds

      // Track this request for cancellation
      activeTestConnections.set(requestId, controller);

      // Set timeout to abort the request
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        // Validate inputs (null/empty checks)
        if (!baseUrl || baseUrl.trim() === '') {
          clearTimeout(timeoutId);
          activeTestConnections.delete(requestId);
          return {
            success: false,
            error: 'Base URL is required'
          };
        }

        if (!apiKey || apiKey.trim() === '') {
          clearTimeout(timeoutId);
          activeTestConnections.delete(requestId);
          return {
            success: false,
            error: 'API key is required'
          };
        }

        // Call testConnection from service layer with abort signal
        const result = await testConnection(baseUrl, apiKey, controller.signal);

        // Clear timeout on success
        clearTimeout(timeoutId);
        activeTestConnections.delete(requestId);

        return { success: true, data: result };
      } catch (error) {
        // Clear timeout on error
        clearTimeout(timeoutId);
        activeTestConnections.delete(requestId);

        // Handle abort errors (timeout or explicit cancellation)
        if (error instanceof Error && error.name === 'AbortError') {
          return {
            success: false,
            error: 'Connection timeout. The request took too long to complete.'
          };
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test connection'
        };
      }
    }
  );

  /**
   * Cancel an active test connection request
   */
  ipcMain.on(
    IPC_CHANNELS.PROFILES_TEST_CONNECTION_CANCEL,
    (_event, requestId: number) => {
      const controller = activeTestConnections.get(requestId);
      if (controller) {
        controller.abort();
        activeTestConnections.delete(requestId);
      }
    }
  );

  /**
   * Discover available models from API endpoint
   * - Fetches list of models from /v1/models endpoint
   * - Returns model IDs and display names for dropdown selection
   * - Supports cancellation via PROFILES_DISCOVER_MODELS_CANCEL
   */
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_DISCOVER_MODELS,
    async (_event, baseUrl: string, apiKey: string, requestId: number): Promise<IPCResult<DiscoverModelsResult>> => {
      console.log('[discoverModels] Called with:', { baseUrl, requestId });

      // Create AbortController for timeout and cancellation
      const controller = new AbortController();
      const timeoutMs = 15000; // 15 seconds

      // Track this request for cancellation
      activeDiscoverModelsRequests.set(requestId, controller);

      // Set timeout to abort the request
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        // Validate inputs (null/empty checks)
        if (!baseUrl || baseUrl.trim() === '') {
          clearTimeout(timeoutId);
          activeDiscoverModelsRequests.delete(requestId);
          return {
            success: false,
            error: 'Base URL is required'
          };
        }

        if (!apiKey || apiKey.trim() === '') {
          clearTimeout(timeoutId);
          activeDiscoverModelsRequests.delete(requestId);
          return {
            success: false,
            error: 'API key is required'
          };
        }

        // Call discoverModels from service layer with abort signal
        const result = await discoverModels(baseUrl, apiKey, controller.signal);

        // Clear timeout on success
        clearTimeout(timeoutId);
        activeDiscoverModelsRequests.delete(requestId);

        return { success: true, data: result };
      } catch (error) {
        // Clear timeout on error
        clearTimeout(timeoutId);
        activeDiscoverModelsRequests.delete(requestId);

        // Handle abort errors (timeout or explicit cancellation)
        if (error instanceof Error && error.name === 'AbortError') {
          return {
            success: false,
            error: 'Connection timeout. The request took too long to complete.'
          };
        }

        // Extract error type if available
        const errorType = (error as any).errorType;
        const errorMessage = error instanceof Error ? error.message : 'Failed to discover models';

        // Log for debugging
        console.error('[discoverModels] Error:', {
          name: error instanceof Error ? error.name : 'unknown',
          message: errorMessage,
          errorType,
          originalError: error
        });

        // Include error type in error message for UI to handle appropriately
        return {
          success: false,
          error: errorMessage
        };
      }
    }
  );

  /**
   * Cancel an active discover models request
   */
  ipcMain.on(
    IPC_CHANNELS.PROFILES_DISCOVER_MODELS_CANCEL,
    (_event, requestId: number) => {
      const controller = activeDiscoverModelsRequests.get(requestId);
      if (controller) {
        controller.abort();
        activeDiscoverModelsRequests.delete(requestId);
      }
    }
  );
}
