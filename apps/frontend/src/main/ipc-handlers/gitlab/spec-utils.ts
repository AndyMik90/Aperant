/**
 * GitLab spec utilities
 * Handles creating task specs from GitLab issues
 */

import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import type { Project } from '../../../shared/types';
import type { GitLabAPIIssue, GitLabAPINoteBasic, GitLabConfig } from './types';
import { labelMatchesWholeWord } from '../shared/label-utils';
import { sanitizeText, sanitizeStringArray } from '../shared/sanitize';

/**
 * Simplified task info returned when creating a spec from a GitLab issue.
 * This is not a full Task object - it's just the basic info needed for the UI.
 */
export interface GitLabTaskInfo {
  id: string;
  specId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

type IssueLike = {
  id: number;
  iid: number;
  title: string;
  description?: string;
  state: 'opened' | 'closed';
  labels: string[];
  assignees: Array<{ username: string }>;
  milestone?: { title: string };
  created_at: string;
  web_url: string;
};

interface SanitizedGitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  labels: string[];
  assignees: Array<{ username: string }>;
  milestone?: { title: string };
  created_at: string;
  web_url: string;
}

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[GitLab Spec] ${message}`, data);
    } else {
      console.debug(`[GitLab Spec] ${message}`);
    }
  }
}

/**
 * Determine task category based on GitLab issue labels
 * Maps to TaskCategory type from shared/types/task.ts
 */
function determineCategoryFromLabels(labels: string[]): 'feature' | 'bug_fix' | 'refactoring' | 'documentation' | 'security' | 'performance' | 'ui_ux' | 'infrastructure' | 'testing' {
  const lowerLabels = labels.map(l => l.toLowerCase());

  if (lowerLabels.some(l => l.includes('bug') || l.includes('defect') || l.includes('error') || l.includes('fix'))) {
    return 'bug_fix';
  }
  if (lowerLabels.some(l => l.includes('security') || l.includes('vulnerability') || l.includes('cve'))) {
    return 'security';
  }
  if (lowerLabels.some(l => l.includes('performance') || l.includes('optimization') || l.includes('speed'))) {
    return 'performance';
  }
  if (lowerLabels.some(l => l.includes('ui') || l.includes('ux') || l.includes('design') || l.includes('styling'))) {
    return 'ui_ux';
  }
  // Use whole-word matching for 'ci' and 'cd' to avoid false positives like 'acid' or 'decide'
  if (lowerLabels.some(l =>
    l.includes('infrastructure') ||
    l.includes('devops') ||
    l.includes('deployment') ||
    labelMatchesWholeWord(l, 'ci') ||
    labelMatchesWholeWord(l, 'cd')
  )) {
    return 'infrastructure';
  }
  if (lowerLabels.some(l => l.includes('test') || l.includes('testing') || l.includes('qa'))) {
    return 'testing';
  }
  if (lowerLabels.some(l => l.includes('refactor') || l.includes('cleanup') || l.includes('maintenance') || l.includes('chore') || l.includes('tech-debt') || l.includes('technical debt'))) {
    return 'refactoring';
  }
  if (lowerLabels.some(l => l.includes('documentation') || l.includes('docs'))) {
    return 'documentation';
  }
  return 'feature';
}

function sanitizeIssueNumber(value: unknown): number {
  const issueId = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    return 0;
  }
  return issueId;
}

function sanitizeIssueState(value: unknown): 'opened' | 'closed' {
  return value === 'closed' ? 'closed' : 'opened';
}

function sanitizeAssignees(value: unknown): Array<{ username: string }> {
  if (!Array.isArray(value)) return [];
  const sanitized: Array<{ username: string }> = [];
  for (const assignee of value) {
    if (!assignee || typeof assignee !== 'object') continue;
    const username = sanitizeText((assignee as { username?: unknown }).username, 100);
    if (username) {
      sanitized.push({ username });
    }
    if (sanitized.length >= 20) {
      break;
    }
  }
  return sanitized;
}

function sanitizeMilestone(value: unknown): { title: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const title = sanitizeText((value as { title?: unknown }).title, 200);
  return title ? { title } : undefined;
}

function sanitizeIsoDate(value: unknown): string {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeIssueUrl(rawUrl: unknown, instanceUrl: string): string {
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsedUrl = new URL(rawUrl);
    const expectedHost = new URL(instanceUrl).host;
    if (parsedUrl.host !== expectedHost) return '';
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return '';
    // Reject URLs with embedded credentials (security risk)
    if (parsedUrl.username || parsedUrl.password) return '';
    return parsedUrl.toString();
  } catch {
    return '';
  }
}

function sanitizeInstanceUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function sanitizeIssueForSpec(issue: IssueLike, instanceUrl: string): SanitizedGitLabIssue {
  const issueIid = sanitizeIssueNumber(issue.iid);
  const title = sanitizeText(issue.title, 200) || `Issue ${issueIid || 'unknown'}`;
  return {
    id: sanitizeIssueNumber(issue.id),
    iid: issueIid,
    title,
    description: sanitizeText(issue.description ?? '', 20000, true),
    state: sanitizeIssueState(issue.state),
    labels: sanitizeStringArray(issue.labels, 50, 100),
    assignees: sanitizeAssignees(issue.assignees),
    milestone: sanitizeMilestone(issue.milestone),
    created_at: sanitizeIsoDate(issue.created_at),
    web_url: sanitizeIssueUrl(issue.web_url, instanceUrl),
  };
}

/**
 * Generate a spec directory name from issue title
 */
function generateSpecDirName(issueIid: number, title: string): string {
  // Clean title for directory name
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);

  // Format: 001-issue-title (padded issue IID)
  const paddedIid = String(issueIid).padStart(3, '0');
  return `${paddedIid}-${cleanTitle}`;
}

/**
 * Build issue context for spec creation
 */
export function buildIssueContext(
  issue: IssueLike,
  projectPath: string,
  instanceUrl: string,
  notes?: GitLabAPINoteBasic[]
): string {
  const lines: string[] = [];
  const safeProjectPath = sanitizeText(projectPath, 200);
  const safeIssue = sanitizeIssueForSpec(issue, instanceUrl);

  lines.push(`# GitLab Issue #${safeIssue.iid}: ${safeIssue.title}`);
  lines.push('');
  lines.push(`**Project:** ${safeProjectPath}`);
  lines.push(`**State:** ${safeIssue.state}`);
  lines.push(`**Created:** ${new Date(safeIssue.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);

  if (safeIssue.labels.length > 0) {
    lines.push(`**Labels:** ${safeIssue.labels.join(', ')}`);
  }

  if (safeIssue.assignees.length > 0) {
    lines.push(`**Assignees:** ${safeIssue.assignees.map(a => a.username).join(', ')}`);
  }

  if (safeIssue.milestone) {
    lines.push(`**Milestone:** ${safeIssue.milestone.title}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(safeIssue.description || '_No description provided_');
  lines.push('');
  lines.push(`**Web URL:** ${safeIssue.web_url}`);

  // Add notes section if notes are provided
  if (notes && notes.length > 0) {
    lines.push('');
    lines.push(`## Notes (${notes.length})`);
    lines.push('');
    for (const note of notes) {
      const safeAuthor = sanitizeText(note.author?.username || 'unknown', 100);
      const safeBody = sanitizeText(note.body, 20000, true);
      lines.push(`**${safeAuthor}:** ${safeBody}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Check if a path exists (async)
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches all notes for a GitLab issue with pagination.
 * Handles rate limiting and authentication errors gracefully.
 *
 * @param config GitLab configuration with token and instance URL
 * @param encodedProject URL-encoded project path
 * @param issueIid Issue IID to fetch notes for
 * @returns Array of basic note objects with id, body, and author
 */
export async function fetchAllIssueNotes(
  config: { token: string; instanceUrl: string },
  encodedProject: string,
  issueIid: number
): Promise<GitLabAPINoteBasic[]> {
  const { gitlabFetch } = await import('./utils');
  const { GitLabAPIError } = await import('./utils');

  const allNotes: GitLabAPINoteBasic[] = [];
  let page = 1;
  const perPage = 100;
  const MAX_PAGES = 50; // Safety limit: max 5000 notes
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    try {
      const notesPage = await gitlabFetch(
        config.token,
        config.instanceUrl,
        `/projects/${encodedProject}/issues/${issueIid}/notes?page=${page}&per_page=${perPage}`
      ) as unknown[];

      // Runtime validation: ensure we got an array
      if (!Array.isArray(notesPage)) {
        debugLog('GitLab notes API returned non-array, stopping pagination');
        break;
      }

      if (notesPage.length === 0) {
        hasMore = false;
      } else {
        // Extract only needed fields with null-safe defaults
        const noteSummaries: GitLabAPINoteBasic[] = notesPage
          .filter((note: unknown): note is Record<string, unknown> =>
            note !== null && typeof note === 'object' && typeof (note as Record<string, unknown>).id === 'number'
          )
          .map((note) => {
            // Validate author structure defensively
            const author = note.author;
            const username = (author !== null && typeof author === 'object' && typeof (author as Record<string, unknown>).username === 'string')
              ? (author as Record<string, unknown>).username as string
              : 'unknown';
            return {
              id: note.id as number,
              body: (note.body as string | undefined) || '',
              author: { username },
            };
          });
        allNotes.push(...noteSummaries);
        if (notesPage.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for authentication/rate-limit errors using structured status codes
      const isAuthError = error instanceof GitLabAPIError && (error.statusCode === 401 || error.statusCode === 403);
      const isRateLimited = error instanceof GitLabAPIError && error.statusCode === 429;

      if (isAuthError || isRateLimited) {
        // Re-throw critical errors to let the caller surface them to the user
        const statusCode = error instanceof GitLabAPIError ? error.statusCode : undefined;
        console.warn(`[GitLab Notes] ${isAuthError ? 'Authentication' : 'Rate limit'} error during notes fetch`, { page, error: errorMessage, statusCode });
        throw error;
      }

      // For transient errors on page 1, warn the user but continue
      if (page === 1 && allNotes.length === 0) {
        console.warn('[GitLab Notes] Failed to fetch any notes, proceeding without notes context', { error: errorMessage });
      } else {
        // Log pagination failure for subsequent pages
        debugLog('Failed to fetch notes page, using partial notes', { page, error: errorMessage, notesRetrieved: allNotes.length });
      }
      hasMore = false;
    }
  }

  // Warn if we hit the pagination limit
  if (page > MAX_PAGES && hasMore) {
    debugLog('Pagination limit reached, some notes may be missing', { maxPages: MAX_PAGES, notesRetrieved: allNotes.length });
  }

  return allNotes;
}

/**
 * Create a task spec from a GitLab issue
 */
export async function createSpecForIssue(
  project: Project,
  issue: GitLabAPIIssue,
  config: GitLabConfig,
  baseBranch?: string,
  notes?: GitLabAPINoteBasic[]
): Promise<GitLabTaskInfo | null> {
  try {
    // Validate and sanitize network data before writing to disk
    const safeIssue = sanitizeIssueForSpec(issue, config.instanceUrl);
    if (!safeIssue.iid) {
      debugLog('Skipping issue with invalid IID', { iid: issue.iid });
      return null;
    }
    const safeProject = sanitizeText(config.project, 200);
    const safeInstanceUrl = sanitizeInstanceUrl(config.instanceUrl);

    const specsDir = path.join(project.path, project.autoBuildPath, 'specs');

    // Ensure specs directory exists
    await mkdir(specsDir, { recursive: true });

    // Generate spec directory name
    const specDirName = generateSpecDirName(safeIssue.iid, safeIssue.title);
    const specDir = path.join(specsDir, specDirName);
    const metadataPath = path.join(specDir, 'metadata.json');

    // Check if spec already exists
    if (await pathExists(specDir)) {
      debugLog('Spec already exists for issue:', { iid: safeIssue.iid, specDir });

      // Read existing metadata for accurate timestamps
      let createdAt = new Date(safeIssue.created_at);
      let updatedAt = createdAt;

      if (await pathExists(metadataPath)) {
        try {
          const metadataContent = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);
          if (metadata.createdAt) {
            createdAt = new Date(metadata.createdAt);
          }
          // Use file modification time for updatedAt
          const stats = await stat(metadataPath);
          updatedAt = new Date(stats.mtimeMs);
        } catch {
          // Fallback to issue dates if metadata read fails
        }
      }

      // Return existing task info
      return {
        id: specDirName,
        specId: specDirName,
        title: safeIssue.title,
        description: safeIssue.description || '',
        createdAt,
        updatedAt
      };
    }

    // Create spec directory
    await mkdir(specDir, { recursive: true });

    // Create TASK.md with issue context (including selected notes)
    const taskContent = buildIssueContext(safeIssue, safeProject, safeInstanceUrl, notes);
    await writeFile(path.join(specDir, 'TASK.md'), taskContent, 'utf-8');

    // Create metadata.json (legacy format for GitLab-specific data)
    const metadata = {
      source: 'gitlab',
      gitlab: {
        issueId: safeIssue.id,
        issueIid: safeIssue.iid,
        instanceUrl: safeInstanceUrl,
        project: safeProject,
        webUrl: safeIssue.web_url,
        state: safeIssue.state,
        labels: safeIssue.labels,
        createdAt: safeIssue.created_at
      },
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Create task_metadata.json (consistent with GitHub format for backend compatibility)
    const taskMetadata = {
      sourceType: 'gitlab' as const,
      gitlabIssueIid: safeIssue.iid,
      gitlabUrl: safeIssue.web_url,
      category: determineCategoryFromLabels(safeIssue.labels || []),
      // Store baseBranch for worktree creation and QA comparison
      ...(baseBranch && { baseBranch })
    };
    await writeFile(
      path.join(specDir, 'task_metadata.json'),
      JSON.stringify(taskMetadata, null, 2),
      'utf-8'
    );

    debugLog('Created spec for issue:', { iid: safeIssue.iid, specDir });

    // Return task info
    return {
      id: specDirName,
      specId: specDirName,
      title: safeIssue.title,
      description: safeIssue.description || '',
      createdAt: new Date(safeIssue.created_at),
      updatedAt: new Date()
    };
  } catch (error) {
    debugLog('Failed to create spec for issue:', { iid: issue.iid, error });
    return null;
  }
}
