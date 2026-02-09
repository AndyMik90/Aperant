import type { ClaudeUsageData, ClaudeRateLimitEvent } from './agent';

/**
 * API Profile Management Types
 *
 * Users can configure custom Anthropic-compatible API endpoints with profiles.
 * Each profile contains name, base URL, API key, and optional model mappings.
 *
 * NOTE: These types are intentionally duplicated from libs/profile-service/src/types/profile.ts
 * because the frontend build (Electron + Vite) doesn't consume the workspace library types directly.
 * Keep these definitions in sync with the library types when making changes.
 */

/**
 * API Profile - represents a custom API endpoint configuration
 * IMPORTANT: Named APIProfile (not Profile) to avoid conflicts with user profiles
 */
export interface APIProfile {
  id: string; // UUID v4
  name: string; // User-friendly name
  baseUrl: string; // API endpoint URL (e.g., https://api.anthropic.com)
  apiKey: string; // Full API key (never display in UI - use maskApiKey())
  models?: {
    // OPTIONAL - only specify models to override
    default?: string; // Maps to ANTHROPIC_MODEL
    haiku?: string; // Maps to ANTHROPIC_DEFAULT_HAIKU_MODEL
    sonnet?: string; // Maps to ANTHROPIC_DEFAULT_SONNET_MODEL
    opus?: string; // Maps to ANTHROPIC_DEFAULT_OPUS_MODEL
  };
  createdAt: number; // Unix timestamp (ms)
  updatedAt: number; // Unix timestamp (ms)
  /** Current usage data from API */
  usage?: ClaudeUsageData;
  /** Recent rate limit events for this profile */
  rateLimitEvents?: ClaudeRateLimitEvent[];
}

/**
 * Profile file structure - stored in profiles.json
 */
export interface ProfilesFile {
  profiles: APIProfile[];
  activeProfileId: string | null;
  version: number;
}

/**
 * Form data type for creating/editing profiles (without id, models optional)
 */
export interface ProfileFormData {
  name: string;
  baseUrl: string;
  apiKey: string;
  models?: {
    default?: string;
    haiku?: string;
    sonnet?: string;
    opus?: string;
  };
}

/**
 * Shared error type for connection-related errors
 * Used by both TestConnectionResult and DiscoverModelsError
 */
export type ConnectionErrorType = 'auth' | 'network' | 'endpoint' | 'timeout' | 'not_supported' | 'unknown';

/**
 * Test connection result - returned by profile:test-connection
 */
export interface TestConnectionResult {
  success: boolean;
  errorType?: ConnectionErrorType;
  message: string;
}

/**
 * Model information from /v1/models endpoint
 */
export interface ModelInfo {
  id: string; // Model ID (e.g., "claude-sonnet-4-5-20250929")
  display_name: string; // Human-readable name (e.g., "Claude Sonnet 4")
}

/**
 * Result from discoverModels operation
 */
export interface DiscoverModelsResult {
  models: ModelInfo[];
}

/**
 * Error from discoverModels operation
 */
export interface DiscoverModelsError {
  errorType: ConnectionErrorType;
  message: string;
}
