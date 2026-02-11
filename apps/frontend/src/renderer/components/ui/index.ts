// Re-export all UI primitives from shared @auto-claude/ui package
export * from '@auto-claude/ui/primitives';

// Override base ErrorBoundary with Sentry-integrated version
export { ErrorBoundary } from './error-boundary';
