/**
 * Profile Service - Validation and profile creation
 *
 * Provides validation functions for URL, API key, and profile name uniqueness.
 * Handles creating new profiles with validation.
 * Uses atomic operations with file locking to prevent TOCTOU race conditions.
 */

import Anthropic, {
  AuthenticationError,
  NotFoundError,
  APIConnectionError,
  APIConnectionTimeoutError
} from '@anthropic-ai/sdk';

import { loadProfilesFile, generateProfileId, atomicModifyProfiles } from './profile-manager';
import type { APIProfile, TestConnectionResult, ModelInfo, DiscoverModelsResult } from '@shared/types/profile';

/**
 * Input type for creating a profile (without id, createdAt, updatedAt)
 */
export type CreateProfileInput = Omit<APIProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for updating a profile (with id, without createdAt, updatedAt)
 */
export type UpdateProfileInput = Pick<APIProfile, 'id'> & CreateProfileInput;

/**
 * Validate base URL format
 * Accepts HTTP(S) URLs with valid endpoints
 */
export function validateBaseUrl(baseUrl: string): boolean {
  if (!baseUrl || baseUrl.trim() === '') {
    return false;
  }

  try {
    const url = new URL(baseUrl);
    // Only allow http and https protocols
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate API key format
 * Accepts various API key formats (Anthropic, OpenAI, custom)
 */
export function validateApiKey(apiKey: string): boolean {
  if (!apiKey || apiKey.trim() === '') {
    return false;
  }

  const trimmed = apiKey.trim();

  // Too short to be a real API key
  if (trimmed.length < 12) {
    return false;
  }

  // Accept common API key formats
  // Anthropic: sk-ant-...
  // OpenAI: sk-proj-... or sk-...
  // Custom: any reasonable length key with alphanumeric chars
  const hasValidChars = /^[a-zA-Z0-9\-_+.]+$/.test(trimmed);

  return hasValidChars;
}

/**
 * Validate that profile name is unique (case-insensitive, trimmed)
 *
 * WARNING: This is for UX feedback only. Do NOT rely on this for correctness.
 * The actual uniqueness check happens atomically inside create/update operations
 * to prevent TOCTOU race conditions.
 */
export async function validateProfileNameUnique(name: string): Promise<boolean> {
  const trimmed = name.trim().toLowerCase();

  const file = await loadProfilesFile();

  // Check if any profile has the same name (case-insensitive)
  const exists = file.profiles.some(
    (p) => p.name.trim().toLowerCase() === trimmed
  );

  return !exists;
}

/**
 * Delete a profile with validation
 * Throws errors for validation failures
 * Uses atomic operation to prevent race conditions
 */
export async function deleteProfile(id: string): Promise<void> {
  await atomicModifyProfiles((file) => {
    // Find the profile
    const profileIndex = file.profiles.findIndex((p) => p.id === id);
    if (profileIndex === -1) {
      throw new Error('Profile not found');
    }

    // Active Profile Check: Cannot delete active profile (AC3)
    if (file.activeProfileId === id) {
      throw new Error('Cannot delete active profile. Please switch to another profile or OAuth first.');
    }

    // Remove profile
    file.profiles.splice(profileIndex, 1);

    // Last Profile Fallback: If no profiles remain, set activeProfileId to null (AC4)
    if (file.profiles.length === 0) {
      file.activeProfileId = null;
    }

    return file;
  });
}

/**
 * Create a new profile with validation
 * Throws errors for validation failures
 * Uses atomic operation to prevent race conditions in concurrent profile creation
 */
export async function createProfile(input: CreateProfileInput): Promise<APIProfile> {
  // Validate base URL
  if (!validateBaseUrl(input.baseUrl)) {
    throw new Error('Invalid base URL');
  }

  // Validate API key
  if (!validateApiKey(input.apiKey)) {
    throw new Error('Invalid API key');
  }

  // Use atomic operation to ensure uniqueness check and creation happen together
  // This prevents TOCTOU race where another process creates the same profile name
  // between our check and write
  const newProfile = await atomicModifyProfiles((file) => {
    // Re-check uniqueness within the lock (this is the authoritative check)
    const trimmed = input.name.trim().toLowerCase();
    const exists = file.profiles.some(
      (p) => p.name.trim().toLowerCase() === trimmed
    );

    if (exists) {
      throw new Error('A profile with this name already exists');
    }

    // Create new profile
    const now = Date.now();
    const profile: APIProfile = {
      id: generateProfileId(),
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey.trim(),
      models: input.models,
      createdAt: now,
      updatedAt: now
    };

    // Add to profiles list
    file.profiles.push(profile);

    // Set as active if it's the first profile
    if (file.profiles.length === 1) {
      file.activeProfileId = profile.id;
    }

    return file;
  });

  // Find and return the newly created profile
  const createdProfile = newProfile.profiles[newProfile.profiles.length - 1];
  return createdProfile;
}

/**
 * Update an existing profile with validation
 * Throws errors for validation failures
 * Uses atomic operation to prevent race conditions in concurrent profile updates
 */
export async function updateProfile(input: UpdateProfileInput): Promise<APIProfile> {
  // Validate base URL
  if (!validateBaseUrl(input.baseUrl)) {
    throw new Error('Invalid base URL');
  }

  // Validate API key
  if (!validateApiKey(input.apiKey)) {
    throw new Error('Invalid API key');
  }

  // Use atomic operation to ensure uniqueness check and update happen together
  const modifiedFile = await atomicModifyProfiles((file) => {
    // Find the profile
    const profileIndex = file.profiles.findIndex((p) => p.id === input.id);
    if (profileIndex === -1) {
      throw new Error('Profile not found');
    }

    const existingProfile = file.profiles[profileIndex];

    // Validate profile name uniqueness (exclude current profile from check)
    // This check happens atomically within the lock
    if (input.name.trim().toLowerCase() !== existingProfile.name.trim().toLowerCase()) {
      const trimmed = input.name.trim().toLowerCase();
      const nameExists = file.profiles.some(
        (p) => p.id !== input.id && p.name.trim().toLowerCase() === trimmed
      );
      if (nameExists) {
        throw new Error('A profile with this name already exists');
      }
    }

    // Update profile (including name)
    const updated: APIProfile = {
      ...existingProfile,
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey.trim(),
      models: input.models,
      updatedAt: Date.now()
    };

    // Replace in profiles list
    file.profiles[profileIndex] = updated;

    return file;
  });

  // Find and return the updated profile
  const updatedProfile = modifiedFile.profiles.find((p) => p.id === input.id)!;
  return updatedProfile;
}

/**
 * Get environment variables for the active API profile
 *
 * Maps the active API profile to SDK environment variables for injection
 * into Python subprocess. Returns empty object when no profile is active
 * (OAuth mode), allowing CLAUDE_CODE_OAUTH_TOKEN to be used instead.
 *
 * Environment Variable Mapping:
 * - profile.baseUrl → ANTHROPIC_BASE_URL
 * - profile.apiKey → ANTHROPIC_AUTH_TOKEN
 * - profile.models.default → ANTHROPIC_MODEL
 * - profile.models.haiku → ANTHROPIC_DEFAULT_HAIKU_MODEL
 * - profile.models.sonnet → ANTHROPIC_DEFAULT_SONNET_MODEL
 * - profile.models.opus → ANTHROPIC_DEFAULT_OPUS_MODEL
 *
 * Empty string values are filtered out (not set as env vars).
 *
 * @returns Promise<Record<string, string>> Environment variables for active profile
 */
export async function getAPIProfileEnv(): Promise<Record<string, string>> {
  // Load profiles.json
  const file = await loadProfilesFile();

  // If no active profile (null/empty), return empty object (OAuth mode)
  if (!file.activeProfileId || file.activeProfileId === '') {
    return {};
  }

  // Find active profile by activeProfileId
  const profile = file.profiles.find((p) => p.id === file.activeProfileId);

  // If profile not found, return empty object (shouldn't happen with valid data)
  if (!profile) {
    return {};
  }

  // Map profile fields to SDK env vars
  const envVars: Record<string, string> = {
    ANTHROPIC_BASE_URL: profile.baseUrl || '',
    ANTHROPIC_AUTH_TOKEN: profile.apiKey || '',
    ANTHROPIC_API_KEY: profile.apiKey || '',
    ANTHROPIC_MODEL: profile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.models?.opus || '',
    // Clear OAuth token so SDK uses the API key instead of OAuth
    CLAUDE_CODE_OAUTH_TOKEN: '',
  };

  // Filter out empty/whitespace string values (only set env vars that have values)
  // EXCEPT CLAUDE_CODE_OAUTH_TOKEN which MUST be empty to override OAuth mode
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    // Always keep CLAUDE_CODE_OAUTH_TOKEN (even empty) to clear OAuth credentials
    if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
      filteredEnvVars[key] = '';
      continue;
    }
    const trimmedValue = value?.trim();
    if (trimmedValue && trimmedValue !== '') {
      filteredEnvVars[key] = trimmedValue;
    }
  }

  return filteredEnvVars;
}

/**
 * Get API profile environment variables for a SPECIFIC profile by ID.
 * Used for per-task provider selection when a task has a providerId set.
 */
export async function getAPIProfileEnvById(profileId: string): Promise<Record<string, string>> {
  const file = await loadProfilesFile();
  const profile = file.profiles.find((p) => p.id === profileId);

  if (!profile) {
    return {};
  }

  const envVars: Record<string, string> = {
    ANTHROPIC_BASE_URL: profile.baseUrl || '',
    ANTHROPIC_AUTH_TOKEN: profile.apiKey || '',
    ANTHROPIC_API_KEY: profile.apiKey || '',
    ANTHROPIC_MODEL: profile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.models?.opus || '',
    // Clear OAuth token so SDK uses the API key instead of OAuth
    CLAUDE_CODE_OAUTH_TOKEN: '',
  };

  // Filter out empty values EXCEPT CLAUDE_CODE_OAUTH_TOKEN which must be empty to clear OAuth
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
      filteredEnvVars[key] = '';
      continue;
    }
    const trimmedValue = value?.trim();
    if (trimmedValue && trimmedValue !== '') {
      filteredEnvVars[key] = trimmedValue;
    }
  }

  return filteredEnvVars;
}

/**
 * Test API profile connection
 *
 * Validates credentials by making a minimal API request to the /v1/models endpoint.
 * Uses the Anthropic SDK for built-in timeout, retry, and error handling.
 *
 * @param baseUrl - API base URL (will be normalized)
 * @param apiKey - API key for authentication
 * @param signal - Optional AbortSignal for cancelling the request
 * @returns Promise<TestConnectionResult> Result of connection test
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<TestConnectionResult> {
  // Validate API key first (key format doesn't depend on URL normalization)
  if (!validateApiKey(apiKey)) {
    return {
      success: false,
      errorType: 'auth',
      message: 'Authentication failed. Please check your API key.'
    };
  }

  // Normalize baseUrl BEFORE validation (allows auto-prepending https://)
  let normalizedUrl = baseUrl.trim();

  // Store original URL for error suggestions
  const originalUrl = normalizedUrl;

  // If empty, return error
  if (!normalizedUrl) {
    return {
      success: false,
      errorType: 'endpoint',
      message: 'Invalid endpoint. Please check the Base URL.'
    };
  }

  // Ensure https:// prefix (auto-prepend if NO protocol exists)
  if (!normalizedUrl.includes('://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Helper function to generate URL suggestions
  const getUrlSuggestions = (url: string): string[] => {
    const suggestions: string[] = [];

    if (!url.includes('://')) {
      suggestions.push('Ensure URL starts with https://');
    }

    if (url.endsWith('/')) {
      suggestions.push('Remove trailing slashes from URL');
    }

    const domainMatch = url.match(/:\/\/([^/]+)/);
    if (domainMatch) {
      const domain = domainMatch[1];
      if (domain.includes('anthropiic') || domain.includes('anthhropic') ||
          domain.includes('anhtropic') || domain.length < 10) {
        suggestions.push('Check for typos in domain name');
      }
    }

    return suggestions;
  };

  // Validate the normalized baseUrl
  if (!validateBaseUrl(normalizedUrl)) {
    const suggestions = getUrlSuggestions(originalUrl);
    const message = suggestions.length > 0
      ? `Invalid endpoint. Please check the Base URL.${suggestions.map(s => ' ' + s).join('')}`
      : 'Invalid endpoint. Please check the Base URL.';

    return {
      success: false,
      errorType: 'endpoint',
      message
    };
  }

  // Check if signal already aborted
  if (signal?.aborted) {
    return {
      success: false,
      errorType: 'timeout',
      message: 'Connection timeout. The endpoint did not respond.'
    };
  }

  try {
    // Create Anthropic client with SDK
    const client = new Anthropic({
      apiKey,
      baseURL: normalizedUrl,
      timeout: 10000, // 10 seconds
      maxRetries: 0, // Disable retries for immediate feedback
    });

    console.log('[testConnection] Testing connection to:', normalizedUrl);

    // Make minimal request to test connection (pass signal for cancellation)
    // Try models.list first, but some Anthropic-compatible APIs don't support it
    try {
      console.log('[testConnection] Trying /v1/models endpoint...');
      await client.models.list({ limit: 1 }, { signal: signal ?? undefined });
      console.log('[testConnection] /v1/models endpoint succeeded');
    } catch (modelsError) {
      console.log('[testConnection] /v1/models failed, checking error type:', modelsError instanceof Error ? modelsError.name : 'unknown');
      // If models endpoint returns 404, try messages endpoint instead
      // Many Anthropic-compatible APIs (e.g., MiniMax) only support /v1/messages
      const modelsErrorName = modelsError instanceof Error ? modelsError.name : '';
      if (modelsErrorName === 'NotFoundError' || modelsError instanceof NotFoundError) {
        console.log('[testConnection] 404 received, trying /v1/messages endpoint...');
        // Fall back to messages endpoint with minimal request
        // This will fail with 400 (invalid request) but proves the endpoint is reachable
        try {
          await client.messages.create({
            model: 'test',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          }, { signal: signal ?? undefined });
        } catch (messagesError) {
          const messagesErrorName = messagesError instanceof Error ? messagesError.name : '';
          const messagesStatus = messagesError instanceof Error && 'status' in messagesError 
            ? (messagesError as { status?: number }).status 
            : undefined;
          console.log('[testConnection] /v1/messages error:', messagesErrorName, 'status:', messagesStatus);
          // 400/422 errors mean the endpoint is valid, just our test request was invalid
          // This is expected - we're just testing connectivity
          if (messagesErrorName === 'BadRequestError' ||
              messagesErrorName === 'InvalidRequestError' ||
              messagesStatus === 400 ||
              messagesStatus === 422) {
            // Endpoint is valid, connection successful
            console.log('[testConnection] Connection successful (400/422 on /v1/messages means endpoint is valid)');
            return {
              success: true,
              message: 'Connection successful'
            };
          }
          // Re-throw other errors to be handled by outer catch
          throw messagesError;
        }
        // If messages.create somehow succeeded, connection is valid
        console.log('[testConnection] /v1/messages succeeded');
        return {
          success: true,
          message: 'Connection successful'
        };
      }
      // Re-throw non-404 errors to be handled by outer catch
      throw modelsError;
    }

    console.log('[testConnection] Connection test passed');
    return {
      success: true,
      message: 'Connection successful'
    };
  } catch (error) {
    console.error('[testConnection] Final error:', error instanceof Error ? error.message : String(error));
    // Map SDK errors to TestConnectionResult error types
    // Use error.name for instanceof-like checks (works with mocks that set this.name)
    const errorName = error instanceof Error ? error.name : '';

    if (errorName === 'AuthenticationError' || error instanceof AuthenticationError) {
      return {
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      };
    }

    if (errorName === 'NotFoundError' || error instanceof NotFoundError) {
      const suggestions = getUrlSuggestions(baseUrl.trim());
      const message = suggestions.length > 0
        ? `Invalid endpoint. Please check the Base URL.${suggestions.map(s => ' ' + s).join('')}`
        : 'Invalid endpoint. Please check the Base URL.';

      return {
        success: false,
        errorType: 'endpoint',
        message
      };
    }

    if (errorName === 'APIConnectionTimeoutError' || error instanceof APIConnectionTimeoutError) {
      return {
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      };
    }

    if (errorName === 'APIConnectionError' || error instanceof APIConnectionError) {
      return {
        success: false,
        errorType: 'network',
        message: 'Network error. Please check your internet connection.'
      };
    }

    // APIError or other errors
    return {
      success: false,
      errorType: 'unknown',
      message: 'Connection test failed. Please try again.'
    };
  }
}

/**
 * Discover available models from API endpoint
 *
 * Fetches the list of available models from the Anthropic-compatible /v1/models endpoint.
 * Uses the Anthropic SDK for built-in timeout, retry, and error handling.
 *
 * @param baseUrl - API base URL (will be normalized)
 * @param apiKey - API key for authentication
 * @param signal - Optional AbortSignal for cancelling the request (checked before request)
 * @returns Promise<DiscoverModelsResult> List of available models
 * @throws Error with errorType for auth/network/endpoint/timeout/not_supported failures
 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<DiscoverModelsResult> {
  // Validate API key first
  if (!validateApiKey(apiKey)) {
    const error: Error & { errorType?: string } = new Error('Authentication failed. Please check your API key.');
    error.errorType = 'auth';
    throw error;
  }

  // Normalize baseUrl BEFORE validation
  let normalizedUrl = baseUrl.trim();

  // If empty, throw error
  if (!normalizedUrl) {
    const error: Error & { errorType?: string } = new Error('Invalid endpoint. Please check the Base URL.');
    error.errorType = 'endpoint';
    throw error;
  }

  // Ensure https:// prefix (auto-prepend if NO protocol exists)
  if (!normalizedUrl.includes('://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Validate the normalized baseUrl
  if (!validateBaseUrl(normalizedUrl)) {
    const error: Error & { errorType?: string } = new Error('Invalid endpoint. Please check the Base URL.');
    error.errorType = 'endpoint';
    throw error;
  }

  // Check if signal already aborted
  if (signal?.aborted) {
    const error: Error & { errorType?: string } = new Error('Connection timeout. The endpoint did not respond.');
    error.errorType = 'timeout';
    throw error;
  }

  try {
    // Create Anthropic client with SDK
    const client = new Anthropic({
      apiKey,
      baseURL: normalizedUrl,
      timeout: 10000, // 10 seconds
      maxRetries: 0, // Disable retries for immediate feedback
    });

    console.log('[discoverModels] Fetching models from:', normalizedUrl);

    // Fetch models with pagination (1000 limit to get all), pass signal for cancellation
    const response = await client.models.list({ limit: 1000 }, { signal: signal ?? undefined });

    console.log('[discoverModels] Response received, model count:', response.data.length);

    // Extract model information from SDK response
    const models: ModelInfo[] = response.data
      .map((model) => ({
        id: model.id || '',
        display_name: model.display_name || model.id || ''
      }))
      .filter((model) => model.id.length > 0);

    console.log('[discoverModels] Parsed models:', models.slice(0, 5).map(m => m.id));

    return { models };
  } catch (error) {
    // Log detailed error info for debugging
    console.error('[discoverModels] Error details:', {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'unknown',
      baseUrl: normalizedUrl,
      apiKeyPrefix: apiKey.substring(0, 10) + '...'
    });
    // Map SDK errors to thrown errors with errorType property
    // Use error.name for instanceof-like checks (works with mocks that set this.name)
    const errorName = error instanceof Error ? error.name : '';

    if (errorName === 'AuthenticationError' || error instanceof AuthenticationError) {
      const authError: Error & { errorType?: string } = new Error('Authentication failed. Please check your API key.');
      authError.errorType = 'auth';
      throw authError;
    }

    if (errorName === 'NotFoundError' || error instanceof NotFoundError) {
      const notSupportedError: Error & { errorType?: string } = new Error('This API endpoint does not support model listing. Please enter the model name manually.');
      notSupportedError.errorType = 'not_supported';
      throw notSupportedError;
    }

    if (errorName === 'APIConnectionTimeoutError' || error instanceof APIConnectionTimeoutError) {
      const timeoutError: Error & { errorType?: string } = new Error('Connection timeout. The endpoint did not respond.');
      timeoutError.errorType = 'timeout';
      throw timeoutError;
    }

    if (errorName === 'APIConnectionError' || error instanceof APIConnectionError) {
      const networkError: Error & { errorType?: string } = new Error('Network error. Please check your internet connection.');
      networkError.errorType = 'network';
      throw networkError;
    }

    // APIError or other errors
    const unknownError: Error & { errorType?: string } = new Error('Connection test failed. Please try again.');
    unknownError.errorType = 'unknown';
    throw unknownError;
  }
}
