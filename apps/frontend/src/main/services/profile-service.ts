/**
 * Profile Service - Validation and profile creation
 *
 * Provides validation functions for URL, API key, and profile name uniqueness.
 * Handles creating new profiles with validation.
 */

import { loadProfilesFile, saveProfilesFile, generateProfileId } from '../utils/profile-manager';
import type { APIProfile, TestConnectionResult } from '../../shared/types/profile';

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
 * Input type for creating a profile (without id, createdAt, updatedAt)
 */
export type CreateProfileInput = Omit<APIProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for updating a profile (with id, without createdAt, updatedAt)
 */
export type UpdateProfileInput = Pick<APIProfile, 'id'> & CreateProfileInput;

/**
 * Delete a profile with validation
 * Throws errors for validation failures
 */
export async function deleteProfile(id: string): Promise<void> {
  const file = await loadProfilesFile();

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

  // Save to disk
  await saveProfilesFile(file);
}

/**
 * Create a new profile with validation
 * Throws errors for validation failures
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

  // Validate profile name uniqueness
  const isUnique = await validateProfileNameUnique(input.name);
  if (!isUnique) {
    throw new Error('A profile with this name already exists');
  }

  // Load existing profiles
  const file = await loadProfilesFile();

  // Create new profile
  const now = Date.now();
  const newProfile: APIProfile = {
    id: generateProfileId(),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    models: input.models,
    createdAt: now,
    updatedAt: now
  };

  // Add to profiles list
  file.profiles.push(newProfile);

  // Set as active if it's the first profile
  if (file.profiles.length === 1) {
    file.activeProfileId = newProfile.id;
  }

  // Save to disk
  await saveProfilesFile(file);

  return newProfile;
}

/**
 * Update an existing profile with validation
 * Throws errors for validation failures
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

  // Load existing profiles
  const file = await loadProfilesFile();

  // Find the profile
  const profileIndex = file.profiles.findIndex((p) => p.id === input.id);
  if (profileIndex === -1) {
    throw new Error('Profile not found');
  }

  const existingProfile = file.profiles[profileIndex];

  // Validate profile name uniqueness (exclude current profile from check)
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
  const updatedProfile: APIProfile = {
    ...existingProfile,
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    models: input.models,
    updatedAt: Date.now()
  };

  // Replace in profiles list
  file.profiles[profileIndex] = updatedProfile;

  // Save to disk
  await saveProfilesFile(file);

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
    ANTHROPIC_MODEL: profile.models?.default || '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.models?.haiku || '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.models?.sonnet || '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.models?.opus || '',
  };

  // Filter out empty/whitespace string values (only set env vars that have values)
  // This handles empty strings, null, undefined, and whitespace-only values
  const filteredEnvVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
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
 * Returns detailed error information for different failure types.
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
  // Check if URL already has a protocol (contains ://)
  if (!normalizedUrl.includes('://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Helper function to generate URL suggestions
  const getUrlSuggestions = (url: string): string[] => {
    const suggestions: string[] = [];

    // Check if URL lacks https://
    if (!url.includes('://')) {
      suggestions.push('Ensure URL starts with https://');
    }

    // Check for trailing slash
    if (url.endsWith('/')) {
      suggestions.push('Remove trailing slashes from URL');
    }

    // Check for suspicious domain patterns (common typos)
    const domainMatch = url.match(/:\/\/([^/]+)/);
    if (domainMatch) {
      const domain = domainMatch[1];
      // Check for common typos like anthropiic, ap, etc.
      if (domain.includes('anthropiic') || domain.includes('anthhropic') ||
          domain.includes('anhtropic') || domain.length < 10) {
        suggestions.push('Check for typos in domain name');
      }
    }

    return suggestions;
  };

  // Validate the normalized baseUrl
  if (!validateBaseUrl(normalizedUrl)) {
    // Generate suggestions based on original URL
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

  // Set timeout to 10 seconds (NFR-P3 compliance)
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 10000);

  // Create a combined controller that aborts when either timeout or external signal aborts
  const combinedController = new AbortController();

  // Cleanup function for event listeners
  const cleanup = () => {
    clearTimeout(timeoutId);
  };

  // Listen to timeout abort
  const onTimeoutAbort = () => {
    cleanup();
    combinedController.abort();
  };
  timeoutController.signal.addEventListener('abort', onTimeoutAbort);

  // Listen to external signal abort (if provided)
  let onExternalAbort: (() => void) | undefined;
  if (signal) {
    // If external signal already aborted, abort immediately
    if (signal.aborted) {
      cleanup();
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
      return {
        success: false,
        errorType: 'timeout',
        message: 'Connection timeout. The endpoint did not respond.'
      };
    }

    // Listen to external signal abort
    onExternalAbort = () => {
      cleanup();
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
      combinedController.abort();
    };
    signal.addEventListener('abort', onExternalAbort);
  }

  const combinedSignal = combinedController.signal;

  try {
    // Make minimal API request
    const response = await fetch(`${normalizedUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      signal: combinedSignal
    });

    // Clear timeout on successful response
    cleanup();
    if (onTimeoutAbort) {
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
    if (signal && onExternalAbort) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    // Parse response and determine error type
    if (response.status === 200 || response.status === 201) {
      return {
        success: true,
        message: 'Connection successful'
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key.'
      };
    }

    if (response.status === 404) {
      // Generate URL suggestions for 404 errors
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

    // Other HTTP errors
    return {
      success: false,
      errorType: 'unknown',
      message: 'Connection test failed. Please try again.'
    };
  } catch (error) {
    // Cleanup event listeners and timeout
    cleanup();
    if (onTimeoutAbort) {
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    }
    if (signal && onExternalAbort) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    // Determine error type from error object
    if (error instanceof Error) {
      // AbortError → timeout
      if (error.name === 'AbortError') {
        return {
          success: false,
          errorType: 'timeout',
          message: 'Connection timeout. The endpoint did not respond.'
        };
      }

      // TypeError with ECONNREFUSED/ENOTFOUND → network error
      if (error instanceof TypeError) {
        const errorCode = (error as any).code;
        if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
          return {
            success: false,
            errorType: 'network',
            message: 'Network error. Please check your internet connection.'
          };
        }
      }
    }

    // Other errors
    return {
      success: false,
      errorType: 'unknown',
      message: 'Connection test failed. Please try again.'
    };
  }
}
