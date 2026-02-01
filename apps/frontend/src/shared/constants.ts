/**
 * Shared constants for Jerry UI
 *
 * This file has been refactored for better organization and maintainability.
 * All constants are now organized in domain-specific modules in the constants/ directory.
 *
 * This file re-exports all constants for backwards compatibility.
 * You can import from this file or directly from the domain-specific modules:
 *
 * Example:
 *   import { IPC_CHANNELS } from '@/shared/constants';
 *   // OR
 *   import { IPC_CHANNELS } from '@/shared/constants/ipc';
 *
 * Domain-specific modules:
 *   - constants/ipc.ts - IPC channel names
 *   - constants/task.ts - Task status, categories, complexity, priority
 *   - constants/roadmap.ts - Roadmap priority, complexity, impact
 *   - constants/ideation.ts - Ideation types, categories, configuration
 *   - constants/changelog.ts - Changelog formats, audiences, configuration
 *   - constants/models.ts - Claude models, thinking levels, agent profiles
 *   - constants/github.ts - GitHub integration constants
 *   - constants/config.ts - App settings, project settings, file paths
 */

// Re-export all constants from domain-specific modules
export * from './constants/index';
