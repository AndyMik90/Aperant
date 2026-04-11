/**
 * PR Creator Runner
 * =================
 *
 * Creates GitHub Pull Requests with AI-generated descriptions using Vercel AI SDK.
 * See apps/desktop/src/main/ai/runners/github/pr-creator.ts for the TypeScript implementation.
 *
 * Steps:
 * 1. Push the worktree branch to origin via git
 * 2. Gather diff/commit context from the branch
 * 3. Generate a semantic PR description via generateText
 * 4. Create the PR via `gh pr create`
 * 5. Return the PR URL and metadata
 *
 * Uses `createSimpleClient()` with no tools (single-turn text generation).
 */

import { generateText } from 'ai';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';

// =============================================================================
// Constants
// =============================================================================

const SYSTEM_PROMPT = `You are a senior software engineer writing a GitHub Pull Request description.
Write a clear, professional PR description that explains WHAT was changed, WHY it was changed, and HOW to test it.

Format your response in Markdown with these sections:
## Summary
(1-3 bullet points describing the main changes)

## Changes
(Bulleted list of specific changes made)

## Testing
(How to verify the changes work correctly)

Keep the description concise but informative. Focus on the business value and technical impact.
Do not include any preamble — output only the Markdown body.`;

// =============================================================================
// Types
// =============================================================================

/** Configuration for PR creation */
export interface CreatePRConfig {
  /** Project root directory (main git repo) */
  projectDir: string;
  /** Worktree directory (where the branch lives) */
  worktreePath: string;
  /** Spec ID (e.g., "001-add-feature") */
  specId: string;
  /** Branch name to push and create PR from */
  branchName: string;
  /** Base branch to merge into (e.g., "main", "develop") */
  baseBranch: string;
  /** PR title */
  title: string;
  /** Whether to create as a draft PR */
  draft?: boolean;
  /** Path to the gh CLI executable */
  ghPath: string;
  /** Path to the git CLI executable */
  gitPath: string;
  /** Model shorthand (defaults to 'haiku') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (defaults to 'low') */
  thinkingLevel?: ThinkingLevel;
}

/** Result of PR creation */
export interface CreatePRResult {
  success: boolean;
  prUrl?: string;
  alreadyExists?: boolean;
  error?: string;
}

// =============================================================================
// Context Gathering
// =============================================================================

/**
 * Gather diff and commit log context for the PR.
 * Mirrors Python's _gather_pr_context().
 */
function gatherPRContext(
  worktreePath: string,
  gitPath: string,
  baseBranch: string,
): { diffSummary: string; commitLog: string } {
  let diffSummary = '';
  let commitLog = '';

  try {
    diffSummary = execFileSync(
      gitPath,
      ['diff', '--stat', `origin/${baseBranch}...HEAD`],
      { cwd: worktreePath, encoding: 'utf-8' },
    ).slice(0, 3000);
  } catch {
    try {
      // Fallback without "origin/" prefix
      diffSummary = execFileSync(
        gitPath,
        ['diff', '--stat', `${baseBranch}...HEAD`],
        { cwd: worktreePath, encoding: 'utf-8' },
      ).slice(0, 3000);
    } catch {
      // Not fatal — proceed without diff
    }
  }

  try {
    commitLog = execFileSync(
      gitPath,
      ['log', '--oneline', `origin/${baseBranch}..HEAD`],
      { cwd: worktreePath, encoding: 'utf-8' },
    ).slice(0, 2000);
  } catch {
    try {
      commitLog = execFileSync(
        gitPath,
        ['log', '--oneline', `${baseBranch}..HEAD`],
        { cwd: worktreePath, encoding: 'utf-8' },
      ).slice(0, 2000);
    } catch {
      // Not fatal — proceed without commit log
    }
  }

  return { diffSummary, commitLog };
}

/**
 * Extract a brief summary from the spec file for fallback PR body.
 */
function extractSpecSummary(projectDir: string, specId: string): string {
  const specFile = join(projectDir, '.auto-claude', 'specs', specId, 'spec.md');
  if (!existsSync(specFile)) {
    return `Implements ${specId}`;
  }

  try {
    const content = readFileSync(specFile, 'utf-8');
    // Extract first ~500 chars after the title
    const withoutTitle = content.replace(/^#+[^\n]+\n/, '').trim();
    return withoutTitle.slice(0, 500) || `Implements ${specId}`;
  } catch {
    return `Implements ${specId}`;
  }
}

// =============================================================================
// AI PR Body Generation
// =============================================================================

/**
 * Generate a PR description using AI.
 * Mirrors Python's _try_ai_pr_body().
 */
async function generatePRBody(
  specId: string,
  title: string,
  baseBranch: string,
  branchName: string,
  diffSummary: string,
  commitLog: string,
  modelShorthand: ModelShorthand,
  thinkingLevel: ThinkingLevel,
): Promise<string | null> {
  const prompt = `Create a GitHub Pull Request description for the following change:

Task: ${title}
Spec ID: ${specId}
Branch: ${branchName}
Base branch: ${baseBranch}

Commit log:
${commitLog || '(no commits listed)'}

Diff summary:
${diffSummary || '(no diff available)'}

Write a professional PR description. Output ONLY the Markdown body — no preamble.`;

  try {
    const client = await createSimpleClient({
      systemPrompt: SYSTEM_PROMPT,
      modelShorthand,
      thinkingLevel,
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt,
    });

    return result.text.trim() || null;
  } catch {
    return null;
  }
}

// =============================================================================
// Auto-Commit Uncommitted Changes
// =============================================================================

/**
 * Stage and commit any uncommitted changes in the worktree.
 * Called before pushing to ensure the branch has commits to push.
 * Returns an error string on failure, or undefined on success (or no changes).
 */
function autoCommitWorktreeChanges(
  worktreePath: string,
  gitPath: string,
  specId: string,
): string | undefined {
  try {
    // Check for uncommitted changes (staged or unstaged, tracked or untracked)
    const status = execFileSync(
      gitPath,
      ['status', '--porcelain'],
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' },
    ).trim();

    if (!status) {
      // No uncommitted changes — nothing to do
      return undefined;
    }

    // Stage all changes
    execFileSync(
      gitPath,
      ['add', '.'],
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' },
    );

    // Commit with a descriptive message
    execFileSync(
      gitPath,
      ['commit', '-m', `auto-claude: implement ${specId}`],
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' },
    );

    return undefined;
  } catch (err: unknown) {
    const stderr = err instanceof Error && 'stderr' in err
      ? String((err as NodeJS.ErrnoException & { stderr?: string }).stderr)
      : String(err);
    return stderr || 'Auto-commit failed';
  }
}

// =============================================================================
// Push Branch
// =============================================================================

/**
 * Push the worktree branch to origin.
 * Returns an error string on failure, or undefined on success.
 */
function pushBranch(
  worktreePath: string,
  gitPath: string,
  branchName: string,
): string | undefined {
  try {
    execFileSync(
      gitPath,
      ['push', '--set-upstream', 'origin', branchName],
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' },
    );
    return undefined;
  } catch (err: unknown) {
    const stderr = err instanceof Error && 'stderr' in err
      ? String((err as NodeJS.ErrnoException & { stderr?: string }).stderr)
      : String(err);
    return stderr || 'Push failed';
  }
}

// =============================================================================
// Get Existing PR URL
// =============================================================================

/**
 * Try to retrieve the URL of an existing PR for the branch.
 */
function getExistingPRUrl(
  projectDir: string,
  ghPath: string,
  branchName: string,
  baseBranch: string,
): string | undefined {
  try {
    const output = execFileSync(
      ghPath,
      ['pr', 'view', branchName, '--json', 'url', '--jq', '.url'],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    return output.startsWith('http') ? output : undefined;
  } catch {
    // Try alternative: list open PRs for this head
    try {
      const listOutput = execFileSync(
        ghPath,
        ['pr', 'list', '--head', branchName, '--base', baseBranch, '--json', 'url', '--jq', '.[0].url'],
        { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' },
      ).trim();
      return listOutput.startsWith('http') ? listOutput : undefined;
    } catch {
      return undefined;
    }
  }
}

// =============================================================================
// Main PR Creator
// =============================================================================

/**
 * Push a worktree branch and create a GitHub PR with an AI-generated description.
 *
 * @param config - PR creation configuration
 * @returns Result with PR URL or error details
 */
export async function createPR(config: CreatePRConfig): Promise<CreatePRResult> {
  const {
    projectDir,
    worktreePath,
    specId,
    branchName,
    baseBranch,
    title,
    draft = false,
    ghPath,
    gitPath,
    modelShorthand = 'haiku',
    thinkingLevel = 'low',
  } = config;

  // Strip remote prefix from base branch once — used in all steps below
  const effectiveBase = baseBranch.startsWith('origin/')
    ? baseBranch.slice('origin/'.length)
    : baseBranch;

  // Step 1a: Auto-commit any uncommitted changes in the worktree before pushing.
  // This handles the case where the agent wrote files but didn't run `git commit`.
  // A failure here is non-fatal — we still attempt the push in case prior commits exist.
  autoCommitWorktreeChanges(worktreePath, gitPath, specId);

  // Step 1b: Push the branch to origin
  const pushError = pushBranch(worktreePath, gitPath, branchName);
  if (pushError) {
    // If it looks like the branch is already up-to-date, don't bail
    const isUpToDate = pushError.includes('Everything up-to-date') ||
                       pushError.includes('up to date');
    if (!isUpToDate) {
      return { success: false, error: `Failed to push branch: ${pushError}` };
    }
  }

  // Step 1c: Verify there is at least one commit ahead of the base branch.
  // Without this check, `gh pr create` fails with a confusing GraphQL error.
  try {
    const commitCount = execFileSync(
      gitPath,
      ['rev-list', '--count', `origin/${effectiveBase}..HEAD`],
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    if (commitCount === '0') {
      return {
        success: false,
        error: `No commits found between '${effectiveBase}' and '${branchName}'. ` +
          'The agent may not have committed any changes. ' +
          'Please verify the implementation completed successfully before creating a PR.',
      };
    }
  } catch {
    // Unable to count commits — proceed and let `gh pr create` surface the error
  }

  // Step 2: Gather context for AI description
  const { diffSummary, commitLog } = gatherPRContext(worktreePath, gitPath, baseBranch);

  // Step 3: Generate AI PR body (falls back to spec summary on failure)
  const aiBody = await generatePRBody(
    specId,
    title,
    baseBranch,
    branchName,
    diffSummary,
    commitLog,
    modelShorthand,
    thinkingLevel,
  );

  const prBody = aiBody || extractSpecSummary(projectDir, specId);

  // Step 4: Build gh pr create command
  const ghArgs = [
    'pr', 'create',
    '--base', effectiveBase,
    '--head', branchName,
    '--title', title,
    '--body', prBody,
  ];

  if (draft) {
    ghArgs.push('--draft');
  }

  // Step 5: Execute gh pr create with retry on network errors
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = execFileSync(ghPath, ghArgs, {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      // Extract PR URL from output
      let prUrl: string | undefined;
      if (output.startsWith('http')) {
        prUrl = output;
      } else {
        const match = output.match(/https:\/\/[^\s]+\/pull\/\d+/);
        prUrl = match ? match[0] : undefined;
      }

      return { success: true, prUrl, alreadyExists: false };
    } catch (err: unknown) {
      const spawnErr = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const stderr = String(spawnErr.stderr ?? '');
      const stdout = String(spawnErr.stdout ?? '');

      // Check "already exists" — not a failure
      if (stderr.toLowerCase().includes('already exists') || stdout.toLowerCase().includes('already exists')) {
        const existingUrl = getExistingPRUrl(projectDir, ghPath, branchName, effectiveBase);
        return { success: true, prUrl: existingUrl, alreadyExists: true };
      }

      // Check if retryable (network / 5xx errors)
      const isNetworkError = /timeout|connection|network|ECONNRESET|ECONNREFUSED/i.test(stderr);
      const isServerError = /5\d\d|server error|internal error/i.test(stderr);

      if ((isNetworkError || isServerError) && attempt < 2) {
        // Exponential backoff before retry
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }

      // Non-retryable error — return failure
      const errorMessage = stderr || stdout || String(spawnErr.message) || 'Failed to create PR';
      return { success: false, error: errorMessage };
    }
  }

  return { success: false, error: 'PR creation failed after 3 attempts' };
}
