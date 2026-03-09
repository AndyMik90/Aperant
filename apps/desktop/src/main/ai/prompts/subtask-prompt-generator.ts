/**
 * Subtask Prompt Generator
 * ========================
 *
 * Generates minimal, focused prompts for each subtask and planner invocation.
 * See apps/desktop/src/main/ai/prompts/subtask-prompt-generator.ts for the TypeScript implementation.
 *
 * Instead of a 900-line mega-prompt, each subtask gets a tailored ~100-line
 * prompt with only the context it needs. This reduces token usage by ~80%
 * and keeps the agent focused on ONE task.
 */

import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadPrompt } from './prompt-loader';
import type {
  PlannerPromptConfig,
  SubtaskPromptConfig,
  SubtaskContext,
  SubtaskPromptInfo,
} from './types';

// =============================================================================
// Worktree Detection
// =============================================================================

/** Patterns to detect worktree isolation */
const WORKTREE_PATH_PATTERNS = [
  /[/\\]\.auto-claude[/\\]worktrees[/\\]tasks[/\\]/,
  /[/\\]\.auto-claude[/\\]github[/\\]pr[/\\]worktrees[/\\]/,
  /[/\\]\.worktrees[/\\]/,
];

/**
 * Detect if the project dir is inside an isolated git worktree.
 *
 * @returns Tuple [isWorktree, parentProjectPath]
 */
function detectWorktreeIsolation(projectDir: string): [boolean, string | null] {
  const resolved = resolve(projectDir);

  for (const pattern of WORKTREE_PATH_PATTERNS) {
    const match = pattern.exec(resolved);
    if (match) {
      const parentPath = resolved.slice(0, match.index);
      return [true, parentPath || '/'];
    }
  }

  return [false, null];
}

/**
 * Generate the worktree isolation warning section for prompts.
 * Mirrors generate_worktree_isolation_warning() from Python.
 */
export function generateWorktreeIsolationWarning(
  projectDir: string,
  parentProjectPath: string,
): string {
  return (
    `## ISOLATED WORKTREE - CRITICAL\n\n` +
    `You are in an **ISOLATED GIT WORKTREE** - a complete copy of the project for safe development.\n\n` +
    `**YOUR LOCATION:** \`${projectDir}\`\n` +
    `**FORBIDDEN PATH:** \`${parentProjectPath}\`\n\n` +
    `### Rules:\n` +
    `1. **NEVER** use \`cd ${parentProjectPath}\` or any path starting with \`${parentProjectPath}\`\n` +
    `2. **NEVER** use absolute paths that reference the parent project\n` +
    `3. **ALL** project files exist HERE via relative paths\n\n` +
    `### Why This Matters:\n` +
    `- Git commits made in the parent project go to the WRONG branch\n` +
    `- File changes in the parent project escape isolation\n` +
    `- This defeats the entire purpose of safe, isolated development\n\n` +
    `### Correct Usage:\n` +
    `\`\`\`bash\n` +
    `# CORRECT - Use relative paths from your worktree\n` +
    `./prod/src/file.ts\n` +
    `./apps/desktop/src/component.tsx\n\n` +
    `# WRONG - These escape isolation!\n` +
    `cd ${parentProjectPath}\n` +
    `${parentProjectPath}/prod/src/file.ts\n` +
    `\`\`\`\n\n` +
    `If you see absolute paths in spec.md or context.json that reference \`${parentProjectPath}\`,\n` +
    `convert them to relative paths from YOUR current location.\n\n` +
    `---\n\n`
  );
}

// =============================================================================
// Environment Context
// =============================================================================

/**
 * Get the spec directory path relative to the project directory.
 */
function getRelativeSpecPath(specDir: string, projectDir: string): string {
  const resolvedSpec = resolve(specDir);
  const resolvedProject = resolve(projectDir);

  if (resolvedSpec.startsWith(resolvedProject)) {
    const relative = resolvedSpec.slice(resolvedProject.length + 1);
    return `./${relative}`;
  }

  // Fallback: just use the spec dir name
  const parts = resolvedSpec.split(/[/\\]/);
  return `./auto-claude/specs/${parts[parts.length - 1]}`;
}

/**
 * Generate the environment context header for prompts.
 * Mirrors generate_environment_context() from Python.
 */
function generateEnvironmentContext(projectDir: string, specDir: string): string {
  const relativeSpec = getRelativeSpecPath(specDir, projectDir);
  const [isWorktree, parentProjectPath] = detectWorktreeIsolation(projectDir);

  const sections: string[] = [];

  if (isWorktree && parentProjectPath) {
    sections.push(generateWorktreeIsolationWarning(projectDir, parentProjectPath));
  }

  sections.push(
    `## YOUR ENVIRONMENT\n\n` +
    `**Working Directory:** \`${projectDir}\`\n` +
    `**Spec Location:** \`${relativeSpec}/\`\n` +
    `${isWorktree ? '**Isolation Mode:** WORKTREE (changes are isolated from main project)\n' : ''}` +
    `\n` +
    `Your filesystem is restricted to your working directory. All file paths should be\n` +
    `relative to this location. Do NOT use absolute paths.\n\n` +
    `**CRITICAL:** Before ANY git command or file operation, run \`pwd\` to verify your current\n` +
    `directory. If you've used \`cd\` to change directories, you MUST use paths relative to your\n` +
    `NEW location, not the working directory.\n\n` +
    `**Important Files:**\n` +
    `- Spec: \`${relativeSpec}/spec.md\`\n` +
    `- Plan: \`${relativeSpec}/implementation_plan.json\`\n` +
    `- Progress: \`${relativeSpec}/build-progress.txt\`\n` +
    `- Context: \`${relativeSpec}/context.json\`\n\n` +
    `---\n\n`
  );

  return sections.join('');
}

// =============================================================================
// Planner Prompt Generator
// =============================================================================

/**
 * Generate the planner prompt (used once at start of planning phase).
 * Mirrors generate_planner_prompt() from Python.
 *
 * @param config - Planner prompt configuration
 * @returns Assembled planner prompt
 */
export async function generatePlannerPrompt(config: PlannerPromptConfig): Promise<string> {
  const { specDir, projectDir, projectInstructions, planningRetryContext } = config;

  // Load base prompt from planner.md
  const basePlannerPrompt = loadPrompt('planner');

  const relativeSpec = getRelativeSpecPath(specDir, projectDir);
  const sections: string[] = [];

  // 1. Environment context (worktree isolation + location info)
  sections.push(generateEnvironmentContext(projectDir, specDir));

  // 2. Spec location header with critical write instructions
  sections.push(
    `## SPEC LOCATION\n\n` +
    `Your spec file is located at: \`${relativeSpec}/spec.md\`\n\n` +
    `Store all build artifacts in this spec directory:\n` +
    `- \`${relativeSpec}/implementation_plan.json\` - Subtask-based implementation plan\n` +
    `- \`${relativeSpec}/build-progress.txt\` - Progress notes\n` +
    `- \`${relativeSpec}/init.sh\` - Environment setup script\n\n` +
    `The project root is your current working directory. Implement code in the project root,\n` +
    `not in the spec directory.\n\n` +
    `---\n\n`
  );

  // 3. Project instructions injection
  if (projectInstructions) {
    sections.push(
      `## PROJECT INSTRUCTIONS\n\n` +
      `${projectInstructions}\n\n` +
      `---\n\n`
    );
  }

  // 4. Planning retry context (if replanning after validation failure)
  if (planningRetryContext) {
    sections.push(planningRetryContext + '\n\n---\n\n');
  }

  // 5. Base planner prompt
  sections.push(basePlannerPrompt);

  return sections.join('');
}

// =============================================================================
// Subtask Prompt Generator
// =============================================================================

/**
 * Generate a minimal, focused prompt for implementing a single subtask.
 * Mirrors generate_subtask_prompt() from Python.
 *
 * @param config - Subtask prompt configuration
 * @returns Focused subtask prompt (~100 lines instead of 900)
 */
export async function generateSubtaskPrompt(config: SubtaskPromptConfig): Promise<string> {
  const {
    specDir,
    projectDir,
    subtask,
    phase,
    attemptCount = 0,
    recoveryHints,
    projectInstructions,
  } = config;

  const sections: string[] = [];

  // 1. Environment context
  sections.push(generateEnvironmentContext(projectDir, specDir));

  // 2. Header
  sections.push(
    `# Subtask Implementation Task\n\n` +
    `**Subtask ID:** \`${subtask.id}\`\n` +
    `**Phase:** ${phase?.name ?? subtask.phaseName ?? 'Implementation'}\n` +
    `**Service:** ${subtask.service ?? 'all'}\n\n` +
    `## Description\n\n` +
    `${subtask.description}\n`
  );

  // 3. Retry context
  if (attemptCount > 0) {
    sections.push(
      `\n## RETRY ATTEMPT (${attemptCount + 1})\n\n` +
      `This subtask has been attempted ${attemptCount} time(s) before without success.\n` +
      `You MUST use a DIFFERENT approach than previous attempts.\n`
    );
    if (recoveryHints && recoveryHints.length > 0) {
      sections.push('**Previous attempt insights:**');
      for (const hint of recoveryHints) {
        sections.push(`- ${hint}`);
      }
      sections.push('');
    }
  }

  // 4. Files section
  sections.push('## Files\n');

  if (subtask.filesToModify && subtask.filesToModify.length > 0) {
    sections.push('**Files to Modify:**');
    for (const f of subtask.filesToModify) {
      sections.push(`- \`${f}\``);
    }
    sections.push('');
  }

  if (subtask.filesToCreate && subtask.filesToCreate.length > 0) {
    sections.push('**Files to Create:**');
    for (const f of subtask.filesToCreate) {
      sections.push(`- \`${f}\``);
    }
    sections.push('');
  }

  if (subtask.patternsFrom && subtask.patternsFrom.length > 0) {
    sections.push('**Pattern Files (study these first):**');
    for (const f of subtask.patternsFrom) {
      sections.push(`- \`${f}\``);
    }
    sections.push('');
  }

  // 5. Verification
  sections.push('## Verification\n');
  const verification = subtask.verification;

  if (verification?.type === 'command') {
    sections.push(
      `Run this command to verify:\n` +
      `\`\`\`bash\n${verification.command ?? 'echo "No command specified"'}\n\`\`\`\n` +
      `Expected: ${verification.expected ?? 'Success'}\n`
    );
  } else if (verification?.type === 'api') {
    const method = verification.method ?? 'GET';
    const url = verification.url ?? 'http://localhost';
    const body = verification.body;
    sections.push(
      `Test the API endpoint:\n` +
      `\`\`\`bash\n` +
      `curl -X ${method} ${url} -H "Content-Type: application/json"` +
      `${body ? ` -d '${JSON.stringify(body)}'` : ''}\n` +
      `\`\`\`\n` +
      `Expected status: ${verification.expected_status ?? 200}\n`
    );
  } else if (verification?.type === 'browser') {
    const url = verification.url ?? 'http://localhost:3000';
    const checks = verification.checks ?? [];
    sections.push(`Open in browser: ${url}\n\nVerify:`);
    for (const check of checks) {
      sections.push(`- [ ] ${check}`);
    }
    sections.push('');
  } else if (verification?.type === 'e2e') {
    const steps = verification.steps ?? [];
    sections.push('End-to-end verification steps:');
    steps.forEach((step, i) => sections.push(`${i + 1}. ${step}`));
    sections.push('');
  } else {
    const instructions = verification?.instructions ?? 'Manual verification required';
    sections.push(`**Manual Verification:**\n${instructions}\n`);
  }

  // 6. Instructions
  sections.push(
    `## Instructions\n\n` +
    `1. **Read the pattern files** to understand code style and conventions\n` +
    `2. **Read the files to modify** (if any) to understand current implementation\n` +
    `3. **Implement the subtask** following the patterns exactly\n` +
    `4. **Run verification** and fix any issues\n` +
    `5. **Commit your changes:**\n` +
    `   \`\`\`bash\n` +
    `   git add .\n` +
    `   git commit -m "auto-claude: ${subtask.id} - ${subtask.description.slice(0, 50)}"\n` +
    `   \`\`\`\n` +
    `6. **Update the plan** - set this subtask's status to "completed" in implementation_plan.json\n\n` +
    `## Quality Checklist\n\n` +
    `Before marking complete, verify:\n` +
    `- [ ] Follows patterns from reference files\n` +
    `- [ ] No console.log/print debugging statements\n` +
    `- [ ] Error handling in place\n` +
    `- [ ] Verification passes\n` +
    `- [ ] Clean commit with descriptive message\n\n` +
    `## Important\n\n` +
    `- Focus ONLY on this subtask - don't modify unrelated code\n` +
    `- If verification fails, FIX IT before committing\n` +
    `- If you encounter a blocker, document it in build-progress.txt\n`
  );

  // 7. Project instructions injection
  if (projectInstructions) {
    sections.push(
      `\n## PROJECT INSTRUCTIONS\n\n` +
      `${projectInstructions}\n`
    );
  }

  // 8. Load file context (patterns + files_to_modify) and append
  try {
    const context = await loadSubtaskContext(specDir, projectDir, subtask);
    const contextStr = formatContextForPrompt(context);
    if (contextStr) {
      sections.push(`\n${contextStr}`);
    }
  } catch {
    // Non-fatal: context loading is best-effort
  }

  return sections.join('\n');
}

// =============================================================================
// Subtask Context Loader
// =============================================================================

/**
 * Load minimal file context needed for a subtask.
 * Mirrors load_subtask_context() from Python.
 *
 * @param specDir - Spec directory
 * @param projectDir - Project root
 * @param subtask - Subtask definition
 * @param maxFileLines - Maximum lines to include per file (default: 200)
 * @returns Loaded context dict
 */
export async function loadSubtaskContext(
  specDir: string,
  projectDir: string,
  subtask: SubtaskPromptInfo,
  maxFileLines = 200,
): Promise<SubtaskContext> {
  const context: SubtaskContext = {
    patterns: {},
    filesToModify: {},
    specExcerpt: null,
  };

  // Load pattern files
  for (const patternPath of (subtask.patternsFrom ?? [])) {
    const fullPath = join(projectDir, patternPath);
    const validPath = validateAndResolvePath(fullPath, projectDir);
    if (!validPath) continue;

    try {
      const content = await readFileTruncated(validPath, maxFileLines);
      context.patterns[patternPath] = content;
    } catch {
      context.patterns[patternPath] = '(Could not read file)';
    }
  }

  // Load files to modify
  for (const filePath of (subtask.filesToModify ?? [])) {
    const fullPath = join(projectDir, filePath);

    // Try fuzzy correction if file doesn't exist
    const resolvedPath = existsSync(fullPath)
      ? fullPath
      : await fuzzyFindFile(projectDir, filePath);

    if (!resolvedPath) continue;

    const validPath = validateAndResolvePath(resolvedPath, projectDir);
    if (!validPath) continue;

    try {
      const content = await readFileTruncated(validPath, maxFileLines);
      context.filesToModify[filePath] = content;
    } catch {
      context.filesToModify[filePath] = '(Could not read file)';
    }
  }

  return context;
}

/**
 * Format loaded context into prompt sections.
 * Mirrors format_context_for_prompt() from Python.
 */
function formatContextForPrompt(context: SubtaskContext): string {
  const sections: string[] = [];

  if (Object.keys(context.patterns).length > 0) {
    sections.push('## Reference Files (Patterns to Follow)\n');
    for (const [path, content] of Object.entries(context.patterns)) {
      sections.push(`### \`${path}\`\n\`\`\`\n${content}\n\`\`\`\n`);
    }
  }

  if (Object.keys(context.filesToModify).length > 0) {
    sections.push('## Current File Contents (To Modify)\n');
    for (const [path, content] of Object.entries(context.filesToModify)) {
      sections.push(`### \`${path}\`\n\`\`\`\n${content}\n\`\`\`\n`);
    }
  }

  return sections.join('\n');
}

// =============================================================================
// File Utilities
// =============================================================================

/**
 * Read a file, truncating if it exceeds maxLines.
 */
async function readFileTruncated(filePath: string, maxLines: number): Promise<string> {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n');

  if (lines.length <= maxLines) {
    return raw;
  }

  return (
    lines.slice(0, maxLines).join('\n') +
    `\n\n... (truncated, ${lines.length - maxLines} more lines)`
  );
}

/**
 * Validate that a path stays within the project root (path traversal guard).
 * Returns the resolved path if safe, null otherwise.
 */
function validateAndResolvePath(filePath: string, projectRoot: string): string | null {
  const resolved = resolve(filePath);
  const root = resolve(projectRoot);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/**
 * Fuzzy file finder with similarity cutoff of 0.6.
 * If a referenced file doesn't exist, try to find the closest match.
 *
 * @param projectDir - Project root to search within
 * @param targetPath - Relative path that doesn't exist
 * @returns Best matching file path, or null if no close match
 */
async function fuzzyFindFile(
  projectDir: string,
  targetPath: string,
): Promise<string | null> {
  try {
    // Get the target filename for comparison
    const targetParts = targetPath.replace(/\\/g, '/').split('/');
    const targetFilename = targetParts[targetParts.length - 1];

    // Build a list of candidate files (limited search for performance)
    const candidates = collectFiles(projectDir, 5000);

    let bestMatch: string | null = null;
    let bestScore = 0.6; // Minimum similarity threshold

    for (const candidate of candidates) {
      const score = stringSimilarity(targetFilename, candidate.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate.path;
      }
    }

    return bestMatch;
  } catch {
    return null;
  }
}

/**
 * Collect files from a directory (breadth-first, limited count).
 */
function collectFiles(
  dir: string,
  maxCount: number,
): Array<{ name: string; path: string }> {
  const results: Array<{ name: string; path: string }> = [];
  const skipDirs = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv',
    'dist', 'build', 'out', '.cache',
  ]);

  function walk(currentDir: string, depth: number): void {
    if (results.length >= maxCount || depth > 8) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxCount) break;

        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
            walk(join(currentDir, entry.name), depth + 1);
          }
        } else if (entry.isFile()) {
          results.push({
            name: entry.name,
            path: join(currentDir, entry.name),
          });
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(dir, 0);
  return results;
}

/**
 * Compute string similarity between two strings (simple ratio).
 * Returns a value between 0 and 1.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0.99;

  // Check if one contains the other
  if (bLower.includes(aLower)) return 0.8;
  if (aLower.includes(bLower)) return 0.7;

  // Levenshtein distance-based similarity
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(aLower, bLower);
  return 1 - distance / maxLen;
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a flat array for the DP table
  const dp = new Array<number>((m + 1) * (n + 1)).fill(0);

  for (let i = 0; i <= m; i++) dp[i * (n + 1)] = i;
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i * (n + 1) + j] = dp[(i - 1) * (n + 1) + (j - 1)];
      } else {
        dp[i * (n + 1) + j] = 1 + Math.min(
          dp[(i - 1) * (n + 1) + j],
          dp[i * (n + 1) + (j - 1)],
          dp[(i - 1) * (n + 1) + (j - 1)],
        );
      }
    }
  }

  return dp[m * (n + 1) + n];
}
