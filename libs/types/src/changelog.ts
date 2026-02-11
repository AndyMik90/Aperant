/**
 * Changelog-related types
 */

import type { ImplementationPlan } from './task';

// ============================================
// Changelog Types
// ============================================

export type ChangelogFormat = 'keep-a-changelog' | 'simple-list' | 'github-release';
export type ChangelogAudience = 'technical' | 'user-facing' | 'marketing';
export type ChangelogEmojiLevel = 'none' | 'little' | 'medium' | 'high';

export interface ChangelogTask {
  id: string;
  specId: string;
  title: string;
  description: string;
  completedAt: Date;
  hasSpecs: boolean;
}

export interface TaskSpecContent {
  taskId: string;
  specId: string;
  spec?: string; // Content of spec.md
  requirements?: Record<string, unknown>; // Parsed requirements.json
  qaReport?: string; // Content of qa_report.md
  implementationPlan?: ImplementationPlan; // Parsed implementation_plan.json
  error?: string; // Error message if loading failed
}

// Source mode for changelog generation
export type ChangelogSourceMode = 'tasks' | 'git-history' | 'branch-diff';

// Git history options for changelog generation
export interface GitHistoryOptions {
  type: 'recent' | 'since-date' | 'tag-range' | 'since-version';
  count?: number;           // For 'recent' - number of commits
  sinceDate?: string;       // For 'since-date' - ISO date
  fromTag?: string;         // For 'tag-range' and 'since-version' (the version/tag to start from)
  toTag?: string;           // For 'tag-range' (optional, defaults to HEAD)
  includeMergeCommits?: boolean;
}

// Branch diff options for changelog generation
export interface BranchDiffOptions {
  baseBranch: string;       // e.g., 'main'
  compareBranch: string;    // e.g., 'feature/auth'
}

// Git commit representation
export interface GitCommit {
  hash: string;             // Short hash (7 chars)
  fullHash: string;         // Full hash
  subject: string;          // First line of commit message
  body?: string;            // Rest of commit message
  author: string;
  authorEmail: string;
  date: string;             // ISO date
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

// Git branch information for UI dropdowns
export interface GitBranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

// Git tag information for UI dropdowns
export interface GitTagInfo {
  name: string;
  date?: string;
  commit?: string;
}

export interface ChangelogGenerationRequest {
  projectId: string;
  sourceMode: ChangelogSourceMode;

  // For tasks mode (original behavior)
  taskIds?: string[];

  // For git-history mode
  gitHistory?: GitHistoryOptions;

  // For branch-diff mode
  branchDiff?: BranchDiffOptions;

  // Common options
  version: string;
  date: string; // ISO format
  format: ChangelogFormat;
  audience: ChangelogAudience;
  emojiLevel?: ChangelogEmojiLevel; // Optional emoji usage level
  customInstructions?: string;
}

export interface ChangelogGenerationResult {
  success: boolean;
  changelog: string;
  version: string;
  tasksIncluded: number;
  error?: string;
}

export interface ChangelogSaveRequest {
  projectId: string;
  content: string;
  filePath?: string; // Optional custom path, defaults to CHANGELOG.md
  mode: 'prepend' | 'overwrite' | 'append';
}

export interface ChangelogSaveResult {
  filePath: string;
  bytesWritten: number;
}

export interface ChangelogGenerationProgress {
  stage: 'loading_specs' | 'loading_commits' | 'generating' | 'formatting' | 'complete' | 'error';
  progress: number; // 0-100
  message: string;
  error?: string;
}

export interface ExistingChangelog {
  exists: boolean;
  content?: string;
  lastVersion?: string;
  error?: string;
}

// ============================================
// Release Types
// ============================================

export interface ReleaseableVersion {
  version: string;
  tagName: string;
  date: string;
  content: string;
  taskSpecIds: string[];
  isReleased: boolean;
  releaseUrl?: string;
}

export interface ReleasePreflightCheck {
  passed: boolean;
  message: string;
  uncommittedFiles?: string[];
  unpushedCount?: number;
  unmergedWorktrees?: UnmergedWorktreeInfo[];
}

export interface ReleasePreflightStatus {
  canRelease: boolean;
  checks: {
    gitClean: ReleasePreflightCheck;
    commitsPushed: ReleasePreflightCheck;
    tagAvailable: ReleasePreflightCheck;
    githubConnected: ReleasePreflightCheck;
    worktreesMerged: ReleasePreflightCheck;
  };
  blockers: string[];
}

export interface UnmergedWorktreeInfo {
  specId: string;
  taskTitle: string;
  worktreePath: string;
  branch: string;
  taskStatus: import('./task').TaskStatus;
}

export interface CreateReleaseRequest {
  projectId: string;
  version: string;
  title?: string;
  body: string;
  draft?: boolean;
  prerelease?: boolean;
  /** Main branch to push version bump to (uses project setting if not specified) */
  mainBranch?: string;
  /** Whether to bump version in package.json before release (default: true) */
  bumpVersion?: boolean;
}

export interface CreateReleaseResult {
  success: boolean;
  releaseUrl?: string;
  tagName?: string;
  error?: string;
}

export interface ReleaseProgress {
  stage: 'bumping_version' | 'checking' | 'tagging' | 'pushing' | 'creating_release' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
}

/**
 * AI-powered version suggestion result
 */
export interface VersionSuggestion {
  suggestedVersion: string;
  currentVersion: string;
  bumpType: 'major' | 'minor' | 'patch';
  reason: string;
  commitCount: number;
}
