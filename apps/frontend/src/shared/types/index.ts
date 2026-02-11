/**
 * Central export point for all shared types
 *
 * Re-exports shared platform types from @auto-claude/types,
 * plus Electron-specific type definitions.
 */

// Shared platform types
export * from '@auto-claude/types';

// Electron-specific types
export * from './terminal';
export * from './terminal-session';
export * from './screenshot';
export * from './app-update';
export * from './cli';
export * from './profile';

// IPC types (must be last to use types from other modules)
export * from './ipc';
