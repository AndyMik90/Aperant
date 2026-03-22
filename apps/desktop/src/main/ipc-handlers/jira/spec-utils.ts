/**
 * JIRA spec utilities
 * Handles creating task specs from JIRA issues
 */

import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import type { Project } from '../../../shared/types';
import type { JiraAPIIssue, JiraConfig } from './types';
import { labelMatchesWholeWord } from '../shared/label-utils';
import { sanitizeText, sanitizeStringArray } from '../shared/sanitize';

/**
 * Simplified task info returned when creating a spec from a JIRA issue.
 * This is not a full Task object - it's just the basic info needed for the UI.
 */
export interface JiraTaskInfo {
  id: string;
  specId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * JIRA comment structure (from REST API v3)
 */
export interface JiraAPIComment {
  id: string;
  body: unknown; // ADF format or string
  author: {
    accountId: string;
    displayName: string;
  };
  created: string;
  updated: string;
}

/**
 * JIRA comments pagination response
 */
export interface JiraAPICommentsResponse {
  comments: JiraAPIComment[];
  total: number;
  maxResults: number;
  startAt: number;
}

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[JIRA Spec] ${message}`, data);
    } else {
      console.debug(`[JIRA Spec] ${message}`);
    }
  }
}

/**
 * Determine task category based on JIRA issue labels and type
 * Maps to TaskCategory type from shared/types/task.ts
 */
function determineCategoryFromLabelsAndType(
  labels: string[],
  issueType: string
): 'feature' | 'bug_fix' | 'refactoring' | 'documentation' | 'security' | 'performance' | 'ui_ux' | 'infrastructure' | 'testing' {
  const lowerLabels = labels.map(l => l.toLowerCase());
  const lowerType = issueType.toLowerCase();

  // Check issue type first
  if (lowerType.includes('bug') || lowerType.includes('defect')) {
    return 'bug_fix';
  }

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

/**
 * Convert ADF (Atlassian Document Format) to plain text.
 * JIRA API v3 returns descriptions and comments in ADF format.
 */
export function adfToPlainText(adf: unknown): string {
  if (typeof adf === 'string') return adf;
  if (!adf || typeof adf !== 'object') return '';

  const doc = adf as { content?: unknown[] };
  if (!Array.isArray(doc.content)) return '';

  const lines: string[] = [];

  function extractText(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };

    if (n.type === 'text' && typeof n.text === 'string') {
      lines.push(n.text);
      return;
    }

    if (n.type === 'hardBreak') {
      lines.push('\n');
      return;
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        extractText(child);
      }
      // Add newline after block-level elements
      if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'listItem' || n.type === 'codeBlock' || n.type === 'blockquote') {
        lines.push('\n');
      }
    }
  }

  for (const block of doc.content) {
    extractText(block);
  }

  return lines.join('').trim();
}

/**
 * Sanitize a JIRA issue key (e.g., PROJ-123)
 */
function sanitizeIssueKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  // JIRA keys follow pattern: PROJECT-NUMBER
  const match = value.match(/^[A-Z][A-Z0-9_]+-\d+$/);
  return match ? value : '';
}

/**
 * Sanitize a JIRA host URL for spec metadata
 */
function sanitizeHostUrl(value: unknown): string {
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

/**
 * Generate a spec directory name from issue key and title
 */
function generateSpecDirName(issueKey: string, title: string): string {
  // Clean title for directory name
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);

  // Format: PROJ-123-issue-title (using issue key)
  const safeName = issueKey.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${safeName}-${cleanTitle}`;
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
 * Build issue context for spec creation
 */
export function buildIssueContext(
  issueKey: string,
  summary: string,
  description: string,
  issueType: string,
  status: string,
  priority: string | undefined,
  labels: string[],
  assignee: string | undefined,
  created: string,
  jiraUrl: string,
  comments?: JiraAPIComment[]
): string {
  const lines: string[] = [];

  const safeKey = sanitizeText(issueKey, 50);
  const safeSummary = sanitizeText(summary, 200);

  lines.push(`# JIRA Issue ${safeKey}: ${safeSummary}`);
  lines.push('');
  lines.push(`**Issue Type:** ${sanitizeText(issueType, 100)}`);
  lines.push(`**Status:** ${sanitizeText(status, 100)}`);
  lines.push(`**Created:** ${new Date(created).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);

  if (priority) {
    lines.push(`**Priority:** ${sanitizeText(priority, 100)}`);
  }

  if (labels.length > 0) {
    const safeLabels = sanitizeStringArray(labels, 50, 100);
    lines.push(`**Labels:** ${safeLabels.join(', ')}`);
  }

  if (assignee) {
    lines.push(`**Assignee:** ${sanitizeText(assignee, 100)}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(sanitizeText(description, 20000, true) || '_No description provided_');
  lines.push('');
  lines.push(`**JIRA URL:** ${jiraUrl}`);

  // Add comments section if comments are provided
  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(`## Comments (${comments.length})`);
    lines.push('');
    for (const comment of comments) {
      const safeAuthor = sanitizeText(comment.author?.displayName || 'unknown', 100);
      const safeBody = sanitizeText(adfToPlainText(comment.body), 20000, true);
      lines.push(`**${safeAuthor}:** ${safeBody}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Fetches all comments for a JIRA issue with pagination.
 * Handles rate limiting and authentication errors gracefully.
 */
export async function fetchAllIssueComments(
  config: JiraConfig,
  issueKey: string
): Promise<JiraAPIComment[]> {
  const { jiraFetch, JiraAPIError } = await import('./utils');

  const allComments: JiraAPIComment[] = [];
  let startAt = 0;
  const maxResults = 50;
  const MAX_PAGES = 20; // Safety limit: max 1000 comments
  let hasMore = true;
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    try {
      const response = await jiraFetch(
        config,
        `/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=${maxResults}`
      ) as JiraAPICommentsResponse;

      // Runtime validation: ensure we got the expected shape
      if (!response || !Array.isArray(response.comments)) {
        debugLog('JIRA comments API returned unexpected shape, stopping pagination');
        break;
      }

      if (response.comments.length === 0) {
        hasMore = false;
      } else {
        // Extract only needed fields with null-safe defaults
        const commentSummaries: JiraAPIComment[] = response.comments
          .filter((comment: unknown): comment is Record<string, unknown> =>
            comment !== null && typeof comment === 'object' && typeof (comment as Record<string, unknown>).id === 'string'
          )
          .map((comment) => {
            const c = comment as unknown as Record<string, unknown>;
            const author = c.author;
            const displayName = (author !== null && typeof author === 'object' && typeof (author as Record<string, unknown>).displayName === 'string')
              ? (author as Record<string, unknown>).displayName as string
              : 'unknown';
            const accountId = (author !== null && typeof author === 'object' && typeof (author as Record<string, unknown>).accountId === 'string')
              ? (author as Record<string, unknown>).accountId as string
              : '';
            return {
              id: c.id as string,
              body: c.body ?? '',
              author: { displayName, accountId },
              created: (c.created as string) || new Date().toISOString(),
              updated: (c.updated as string) || new Date().toISOString(),
            };
          });
        allComments.push(...commentSummaries);

        if (startAt + response.comments.length >= response.total) {
          hasMore = false;
        } else {
          startAt += response.comments.length;
          page++;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for authentication/rate-limit errors using structured status codes
      const isAuthError = error instanceof JiraAPIError && (error.statusCode === 401 || error.statusCode === 403);
      const isRateLimited = error instanceof JiraAPIError && error.statusCode === 429;

      if (isAuthError || isRateLimited) {
        // Re-throw critical errors to let the caller surface them to the user
        const statusCode = error instanceof JiraAPIError ? error.statusCode : undefined;
        console.warn(`[JIRA Comments] ${isAuthError ? 'Authentication' : 'Rate limit'} error during comments fetch`, { page, error: errorMessage, statusCode });
        throw error;
      }

      // For transient errors on page 1, warn the user but continue
      if (page === 0 && allComments.length === 0) {
        console.warn('[JIRA Comments] Failed to fetch any comments, proceeding without comments context', { error: errorMessage });
      } else {
        // Log pagination failure for subsequent pages
        debugLog('Failed to fetch comments page, using partial comments', { page, error: errorMessage, commentsRetrieved: allComments.length });
      }
      hasMore = false;
    }
  }

  // Warn if we hit the pagination limit
  if (page >= MAX_PAGES && hasMore) {
    debugLog('Pagination limit reached, some comments may be missing', { maxPages: MAX_PAGES, commentsRetrieved: allComments.length });
  }

  return allComments;
}

/**
 * Create a task spec from a JIRA issue
 */
export async function createSpecFromJiraIssue(
  project: Project,
  issueKey: string,
  issueData: JiraAPIIssue,
  config: JiraConfig,
  baseBranch?: string,
  selectedComments?: JiraAPIComment[]
): Promise<JiraTaskInfo | null> {
  try {
    const safeKey = sanitizeIssueKey(issueKey);
    if (!safeKey) {
      debugLog('Skipping issue with invalid key', { key: issueKey });
      return null;
    }

    const safeSummary = sanitizeText(issueData.fields.summary, 200) || `Issue ${safeKey}`;
    const safeDescription = adfToPlainText(issueData.fields.description);
    const safeHost = sanitizeHostUrl(config.host);
    const safeLabels = sanitizeStringArray(issueData.fields.labels, 50, 100);

    const specsDir = path.join(project.path, project.autoBuildPath, 'specs');

    // Ensure specs directory exists
    await mkdir(specsDir, { recursive: true });

    // Generate spec directory name
    const specDirName = generateSpecDirName(safeKey, safeSummary);
    const specDir = path.join(specsDir, specDirName);
    const metadataPath = path.join(specDir, 'metadata.json');

    // Check if spec already exists
    if (await pathExists(specDir)) {
      debugLog('Spec already exists for issue:', { key: safeKey, specDir });

      // Read existing metadata for accurate timestamps
      let createdAt = new Date(issueData.fields.created);
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
        title: safeSummary,
        description: safeDescription,
        createdAt,
        updatedAt
      };
    }

    // Create spec directory
    await mkdir(specDir, { recursive: true });

    // Build JIRA URL for the issue
    const jiraUrl = `${safeHost}/browse/${safeKey}`;

    // Create TASK.md with issue context (including selected comments)
    const taskContent = buildIssueContext(
      safeKey,
      safeSummary,
      safeDescription,
      issueData.fields.issuetype.name,
      issueData.fields.status.name,
      issueData.fields.priority?.name,
      safeLabels,
      issueData.fields.assignee?.displayName,
      issueData.fields.created,
      jiraUrl,
      selectedComments
    );
    await writeFile(path.join(specDir, 'TASK.md'), taskContent, 'utf-8');

    // Create metadata.json (JIRA-specific data)
    const metadata = {
      source: 'jira',
      jira: {
        issueId: issueData.id,
        issueKey: safeKey,
        host: safeHost,
        projectKey: issueData.fields.project.key,
        webUrl: jiraUrl,
        status: issueData.fields.status.name,
        issueType: issueData.fields.issuetype.name,
        labels: safeLabels,
        createdAt: issueData.fields.created
      },
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Create task_metadata.json (consistent format for backend compatibility)
    const taskMetadata = {
      sourceType: 'jira' as const,
      jiraIssueKey: safeKey,
      jiraUrl,
      category: determineCategoryFromLabelsAndType(safeLabels, issueData.fields.issuetype.name),
      // Store baseBranch for worktree creation and QA comparison
      ...(baseBranch && { baseBranch })
    };
    await writeFile(
      path.join(specDir, 'task_metadata.json'),
      JSON.stringify(taskMetadata, null, 2),
      'utf-8'
    );

    // Create requirements.json (needed for task description in Kanban board)
    const requirements = {
      task_description: safeDescription || safeSummary,
      title: safeSummary,
      source: 'jira',
      jiraIssueKey: safeKey,
      jiraUrl
    };
    await writeFile(
      path.join(specDir, 'requirements.json'),
      JSON.stringify(requirements, null, 2),
      'utf-8'
    );

    // Create implementation_plan.json (empty plan, pending status)
    const implementationPlan = {
      title: safeSummary,
      description: safeDescription || safeSummary,
      status: 'pending',
      phases: []
    };
    await writeFile(
      path.join(specDir, 'implementation_plan.json'),
      JSON.stringify(implementationPlan, null, 2),
      'utf-8'
    );

    debugLog('Created spec for issue:', { key: safeKey, specDir });

    // Return task info
    return {
      id: specDirName,
      specId: specDirName,
      title: safeSummary,
      description: safeDescription,
      createdAt: new Date(issueData.fields.created),
      updatedAt: new Date()
    };
  } catch (error) {
    debugLog('Failed to create spec for issue:', { key: issueKey, error });
    return null;
  }
}
