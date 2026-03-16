/**
 * Utility functions for Linear spec creation and management
 */

import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type { Project, TaskMetadata, LinearComment } from '../../../shared/types';
import { withSpecNumberLock } from '../../utils/spec-number-lock';
import { sanitizeText, sanitizeStringArray, sanitizeUrl } from '../shared/sanitize';
import { labelMatchesWholeWord } from '../shared/label-utils';

export interface SpecCreationData {
  specId: string;
  specDir: string;
  taskDescription: string;
  metadata: TaskMetadata;
}

/**
 * Create a slug from a title
 */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Determine task category based on Linear issue labels
 * Maps to TaskCategory type from shared/types/task.ts
 */
function determineCategoryFromLabels(labels: string[]): 'feature' | 'bug_fix' | 'refactoring' | 'documentation' | 'security' | 'performance' | 'ui_ux' | 'infrastructure' | 'testing' {
  const lowerLabels = labels.map(l => l.toLowerCase());

  // Check for bug labels
  if (lowerLabels.some(l => l.includes('bug') || l.includes('defect') || l.includes('error') || l.includes('fix'))) {
    return 'bug_fix';
  }

  // Check for security labels
  if (lowerLabels.some(l => l.includes('security') || l.includes('vulnerability') || l.includes('cve'))) {
    return 'security';
  }

  // Check for performance labels
  if (lowerLabels.some(l => l.includes('performance') || l.includes('optimization') || l.includes('speed'))) {
    return 'performance';
  }

  // Check for UI/UX labels
  if (lowerLabels.some(l => l.includes('ui') || l.includes('ux') || l.includes('design') || l.includes('styling'))) {
    return 'ui_ux';
  }

  // Check for infrastructure labels
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

  // Check for testing labels
  if (lowerLabels.some(l => l.includes('test') || l.includes('testing') || l.includes('qa'))) {
    return 'testing';
  }

  // Check for refactoring labels
  if (lowerLabels.some(l => l.includes('refactor') || l.includes('cleanup') || l.includes('maintenance') || l.includes('chore') || l.includes('tech-debt') || l.includes('technical debt'))) {
    return 'refactoring';
  }

  // Check for documentation labels
  if (lowerLabels.some(l => l.includes('documentation') || l.includes('docs'))) {
    return 'documentation';
  }

  // Default to feature
  return 'feature';
}

/**
 * Create a new spec directory and initial files for a Linear issue
 * Uses coordinated spec numbering to prevent collisions across worktrees
 */
export async function createSpecForLinearIssue(
  project: Project,
  issueId: string,
  issueIdentifier: string,
  issueTitle: string,
  taskDescription: string,
  linearUrl: string,
  labels: string[] = [],
  baseBranch?: string
): Promise<SpecCreationData> {
  const specsBaseDir = getSpecsDir(project.autoBuildPath);
  const specsDir = path.join(project.path, specsBaseDir);

  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }

  // Sanitize network-sourced data before writing to disk
  const safeTitle = sanitizeText(issueTitle, 500);
  const safeDescription = sanitizeText(taskDescription, 50000, true);
  const safeLinearUrl = sanitizeUrl(linearUrl);
  const safeLabels = sanitizeStringArray(labels, 50, 200);
  const safeIdentifier = sanitizeText(issueIdentifier, 50);
  const safeIssueId = sanitizeText(issueId, 100);

  // Use coordinated spec numbering with lock to prevent collisions
  return await withSpecNumberLock(project.path, async (lock) => {
    // Get next spec number from global scan (main + all worktrees)
    const specNumber = lock.getNextSpecNumber(project.autoBuildPath);
    const slugifiedTitle = slugifyTitle(safeTitle);
    const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle}`;

    // Create spec directory (inside lock to ensure atomicity)
    const specDir = path.join(specsDir, specId);
    mkdirSync(specDir, { recursive: true });

    // Create initial files
    const now = new Date().toISOString();

    // implementation_plan.json
    const implementationPlan = {
      feature: safeTitle,
      description: safeDescription,
      created_at: now,
      updated_at: now,
      status: 'pending',
      phases: []
    };
    // lgtm[js/http-to-file-access] - specDir is controlled, slugifiedTitle sanitizes input
    writeFileSync(
      path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
      JSON.stringify(implementationPlan, null, 2),
      'utf-8'
    );

    // requirements.json
    const requirements = {
      task_description: safeDescription,
      workflow_type: 'feature'
    };
    // lgtm[js/http-to-file-access] - specDir is controlled, slugifiedTitle sanitizes input
    writeFileSync(
      path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS),
      JSON.stringify(requirements, null, 2),
      'utf-8'
    );

    // Determine category from Linear issue labels
    const category = determineCategoryFromLabels(safeLabels);

    // task_metadata.json
    const metadata: TaskMetadata = {
      sourceType: 'linear',
      linearIssueId: safeIssueId,
      linearIdentifier: safeIdentifier,
      linearUrl: safeLinearUrl,
      category,
      // Store baseBranch for worktree creation and QA comparison
      ...(baseBranch && { baseBranch })
    };
    // lgtm[js/http-to-file-access] - specDir is controlled, slugifiedTitle sanitizes input
    writeFileSync(
      path.join(specDir, 'task_metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    return {
      specId,
      specDir,
      taskDescription: safeDescription,
      metadata
    };
  });
}

/**
 * Build issue context string with comments for investigation
 */
export function buildLinearIssueContext(
  _issueId: string,
  identifier: string,
  title: string,
  description: string | undefined,
  labels: string[],
  url: string,
  comments: LinearComment[]
): string {
  return `
# Linear Issue ${identifier}: ${title}

${description || 'No description provided.'}

${comments.length > 0 ? `## Comments (${comments.length}):
${comments.map(c => `**${c.author.name}:** ${c.body}`).join('\n\n')}` : ''}

**Labels:** ${labels.join(', ') || 'None'}
**URL:** ${url}
`;
}

/**
 * Build investigation task description for AI agent
 */
export function buildLinearInvestigationTask(
  _issueId: string,
  identifier: string,
  title: string,
  issueContext: string
): string {
  return `Investigate Linear Issue ${identifier}: ${title}

${issueContext}

Please analyze this issue and provide:
1. A brief summary of what the issue is about
2. A proposed solution approach
3. The files that would likely need to be modified
4. Estimated complexity (simple/standard/complex)
5. Acceptance criteria for resolving this issue`;
}
