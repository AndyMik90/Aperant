/**
 * Linear Stores - Focused state management for Linear integration
 *
 * This module exports all Linear-related stores and their utilities.
 * Mirrors the GitHub stores pattern with:
 * - Issues Store: Issue data and filtering
 * - Investigation Store: Issue investigation workflow
 * - Sync Status Store: Linear connection status
 */

// Issues Store
export {
  useLinearIssuesStore,
  loadLinearIssues,
  importLinearIssues,
  type LinearIssueFilterState
} from './issues-store';

// Investigation Store
export {
  useLinearInvestigationStore,
  investigateLinearIssue
} from './investigation-store';

// Sync Status Store
export {
  useLinearSyncStatusStore,
  checkLinearConnection
} from './sync-status-store';

// Re-export types for convenience
export type {
  LinearIssue,
  LinearSyncStatus,
  LinearSyncEvent,
  LinearInvestigationStatus,
  LinearInvestigationResult
} from '../../../shared/types';
