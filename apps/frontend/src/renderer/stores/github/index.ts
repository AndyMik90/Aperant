/**
 * GitHub Stores - Focused state management for GitHub integration
 *
 * This module exports all GitHub-related stores and their utilities.
 * Previously managed by a single monolithic store, now split into:
 * - Issues Store: Issue data and filtering
 * - PR Review Store: Pull request review state and progress
 * - Investigation Store: Issue investigation workflow (new multi-issue system + legacy compat)
 * - Sync Status Store: GitHub connection status
 */

// Issues Store
export {
  useIssuesStore,
  loadGitHubIssues,
  loadMoreGitHubIssues,
  loadAllGitHubIssues,
  importGitHubIssues,
  type IssueFilterState
} from './issues-store';

// PR Review Store
export {
  usePRReviewStore,
  initializePRReviewListeners,
  cleanupPRReviewListeners
} from './pr-review-store';
import { initializePRReviewListeners as _initPRReviewListeners } from './pr-review-store';
import { cleanupPRReviewListeners as _cleanupPRReviewListeners } from './pr-review-store';

// Investigation Store
export {
  useInvestigationStore,
  initializeInvestigationListeners,
  cleanupInvestigationListeners,
  startIssueInvestigation,
  cancelIssueInvestigation,
  cancelAllIssueInvestigations,
  investigateGitHubIssue,
  loadPersistedInvestigations,
  type IssueInvestigationState
} from './investigation-store';
import { initializeInvestigationListeners as _initInvestigationListeners } from './investigation-store';
import { cleanupInvestigationListeners as _cleanupInvestigationListeners } from './investigation-store';

// Sync Status Store
export {
  useSyncStatusStore,
  checkGitHubConnection
} from './sync-status-store';

/**
 * Initialize all global GitHub listeners.
 * Call this once at app startup.
 */
export function initializeGitHubListeners(): void {
  _initPRReviewListeners();
  _initInvestigationListeners();
}

/**
 * Cleanup all global GitHub listeners.
 * Call this during app unmount or hot-reload.
 */
export function cleanupGitHubListeners(): void {
  _cleanupPRReviewListeners();
  _cleanupInvestigationListeners();
}

// Re-export types for convenience
export type {
  PRReviewProgress,
  PRReviewResult
} from '../../../preload/api/modules/github-api';

export type {
  GitHubIssue,
  GitHubSyncStatus,
  GitHubInvestigationStatus,
  GitHubInvestigationResult,
  InvestigationState,
  InvestigationProgress,
  InvestigationResult,
  InvestigationReport,
  InvestigationSettings
} from '@shared/types';
