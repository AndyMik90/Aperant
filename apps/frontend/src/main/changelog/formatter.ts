import type {
  ChangelogGenerationRequest,
  TaskSpecContent,
  GitCommit
} from '../../shared/types';
import { extractSpecOverview } from './parser';

/**
 * Format instructions for different changelog styles
 */
const FORMAT_TEMPLATES = {
  'keep-a-changelog': (version: string, date: string) => `## [${version}] - ${date}

### Added
- [New features]

### Changed
- [Modifications]

### Fixed
- [Bug fixes]`,

  'simple-list': (version: string, date: string) => `# Release v${version} (${date})

**New Features:**
- [List features]

**Improvements:**
- [List improvements]

**Bug Fixes:**
- [List fixes]`,

  'github-release': (version: string, date: string) => `## ${version} - ${date}

### New Features

- Feature description

### Improvements

- Improvement description

### Bug Fixes

- Fix description

---

## What's Changed

- type: description by @contributor in commit-hash

## Thanks to all contributors

@contributor1, @contributor2`
};

/**
 * Audience-specific writing instructions
 */
const AUDIENCE_INSTRUCTIONS = {
  'technical': 'You are a technical documentation specialist creating a changelog for developers. Use precise technical language.',
  'user-facing': 'You are a product manager writing release notes for end users. Use clear, non-technical language focusing on user benefits.',
  'marketing': 'You are a marketing specialist writing release notes. Focus on outcomes and user impact with compelling language.'
};

/**
 * Get emoji usage instructions based on level and format
 */
function getEmojiInstructions(emojiLevel?: string, format?: string): string {
  if (!emojiLevel || emojiLevel === 'none') {
    return '';
  }

  // GitHub Release format uses specific emoji style matching Gemini CLI pattern
  if (format === 'github-release') {
    const githubInstructions: Record<string, string> = {
      'little': `Add emojis ONLY to section headings. Use these specific emoji-heading pairs:
- "### ✨ New Features"
- "### 🛠️ Improvements"
- "### 🐛 Bug Fixes"
- "### 📚 Documentation"
- "### 🔧 Other Changes"
Do NOT add emojis to individual line items.`,
      'medium': `Add emojis to section headings AND to notable/important items only.
Section headings MUST use these specific emoji-heading pairs:
- "### ✨ New Features"
- "### 🛠️ Improvements"
- "### 🐛 Bug Fixes"
- "### 📚 Documentation"
- "### 🔧 Other Changes"
Add emojis to 2-3 highlighted items per section that are particularly significant.`,
      'high': `Add emojis to section headings AND every line item.
Section headings MUST use these specific emoji-heading pairs:
- "### ✨ New Features"
- "### 🛠️ Improvements"
- "### 🐛 Bug Fixes"
- "### 📚 Documentation"
- "### 🔧 Other Changes"
Every line item should start with a contextual emoji.`
    };
    return githubInstructions[emojiLevel] || '';
  }

  // Default instructions for other formats
  const instructions: Record<string, string> = {
    'little': `Add emojis ONLY to section headings. Each heading should have one contextual emoji at the start.
Examples:
- "### ✨ New Features" or "### 🚀 New Features"
- "### 🐛 Bug Fixes"
- "### 🔧 Improvements" or "### ⚡ Improvements"
- "### 📚 Documentation"
Do NOT add emojis to individual line items.`,
    'medium': `Add emojis to section headings AND to notable/important items only.
Section headings should have one emoji (e.g., "### ✨ New Features", "### 🐛 Bug Fixes").
Add emojis to 2-3 highlighted items per section that are particularly significant.
Examples of highlighted items:
- "- 🎉 **Major Feature**: Description"
- "- 🔒 **Security Fix**: Description"
Most regular line items should NOT have emojis.`,
    'high': `Add emojis to section headings AND every line item for maximum visual appeal.
Section headings: "### ✨ New Features", "### 🐛 Bug Fixes", "### ⚡ Improvements"
Every line item should start with a contextual emoji:
- "- ✨ Added new feature..."
- "- 🐛 Fixed bug where..."
- "- 🔧 Improved performance of..."
- "- 📝 Updated documentation for..."
- "- 🎨 Refined UI styling..."
Use diverse, contextually appropriate emojis for each item.`
  };

  return instructions[emojiLevel] || '';
}

/**
 * Build changelog prompt from task specs
 */
export function buildChangelogPrompt(
  request: ChangelogGenerationRequest,
  specs: TaskSpecContent[]
): string {
  const audienceInstruction = AUDIENCE_INSTRUCTIONS[request.audience];
  const formatInstruction = FORMAT_TEMPLATES[request.format](request.version, request.date);
  const emojiInstruction = getEmojiInstructions(request.emojiLevel, request.format);

  // Build CONCISE task summaries (key to avoiding timeout)
  const taskSummaries = specs.map(spec => {
    const parts: string[] = [`- **${spec.specId}**`];

    // Get workflow type if available
    if (spec.implementationPlan?.workflow_type) {
      parts.push(`(${spec.implementationPlan.workflow_type})`);
    }

    // Extract just the overview/purpose
    if (spec.spec) {
      const overview = extractSpecOverview(spec.spec);
      if (overview) {
        parts.push(`: ${overview}`);
      }
    }

    return parts.join('');
  }).join('\n');

  // Format-specific instructions for tasks mode
  let formatSpecificInstructions = '';
  if (request.format === 'github-release') {
    formatSpecificInstructions = `
For GitHub Release format:

RELEASE TITLE (CRITICAL):
- First, analyze all completed tasks to identify the main theme or focus of this release
- Create a concise, descriptive title (2-5 words) that captures what this release is about
- Examples of good titles:
  * "Improved Terminal Experience" (for terminal-related improvements)
  * "Enhanced Security Features" (for security updates)
  * "UI/UX Refinements" (for interface changes)
  * "Agent Performance Boost" (for performance improvements)
- The version header MUST be: "## ${request.version} - [Your Thematic Title]"
- Focus on the USER BENEFIT or FUNCTIONAL AREA, not technical implementation details
- The title should be what the release is "about" in layman's terms
`;
  }

  return `${audienceInstruction}

Format:
${formatInstruction}
${emojiInstruction ? `\nEmoji Usage:\n${emojiInstruction}` : ''}
${formatSpecificInstructions}

Completed tasks:
${taskSummaries}

${request.customInstructions ? `Note: ${request.customInstructions}` : ''}

CRITICAL: Output ONLY the raw changelog content. Do NOT include ANY introductory text, analysis, or explanation. Start directly with the changelog heading (## or #). No "Here's the changelog" or similar phrases.

DO NOT ask questions or request clarifications. Work with the information provided and make reasonable assumptions if needed. Generate the changelog immediately based on the completed tasks listed above.`;
}

/**
 * Build changelog prompt from git commits
 */
export function buildGitPrompt(
  request: ChangelogGenerationRequest,
  commits: GitCommit[]
): string {
  const audienceInstruction = AUDIENCE_INSTRUCTIONS[request.audience];
  const formatInstruction = FORMAT_TEMPLATES[request.format](request.version, request.date);
  const emojiInstruction = getEmojiInstructions(request.emojiLevel, request.format);

  // Format commits for the prompt
  // Include author info for github-release format
  const commitLines = commits.map(commit => {
    const hash = commit.hash;
    const subject = commit.subject;
    const author = commit.author;

    // Detect conventional commit format: type(scope): message
    const conventionalMatch = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    if (conventionalMatch) {
      const [, type, scope, message] = conventionalMatch;
      return `- ${hash} | ${type}${scope ? `(${scope})` : ''}: ${message} | by ${author}`;
    }
    return `- ${hash} | ${subject} | by ${author}`;
  }).join('\n');

  // Add context about branch/range if available
  let sourceContext = '';
  if (request.branchDiff) {
    sourceContext = `These commits are from branch "${request.branchDiff.compareBranch}" that are not in "${request.branchDiff.baseBranch}".`;
  } else if (request.gitHistory) {
    switch (request.gitHistory.type) {
      case 'recent':
        sourceContext = `These are the ${commits.length} most recent commits.`;
        break;
      case 'since-date':
        sourceContext = `These are commits since ${request.gitHistory.sinceDate}.`;
        break;
      case 'tag-range':
        sourceContext = `These are commits between tag "${request.gitHistory.fromTag}" and "${request.gitHistory.toTag || 'HEAD'}".`;
        break;
    }
  }

  // Format-specific instructions
  let formatSpecificInstructions = '';
  if (request.format === 'github-release') {
    formatSpecificInstructions = `
For GitHub Release format, you MUST follow this structure:

RELEASE TITLE (CRITICAL):
- First, analyze all commits to identify the main theme or focus of this release
- Create a concise, descriptive title (2-5 words) that captures what this release is about
- Examples of good titles:
  * "Improved Terminal Experience" (for terminal-related improvements)
  * "Enhanced Security Features" (for security updates)
  * "Performance Optimizations" (for speed improvements)
  * "UI/UX Refinements" (for interface changes)
  * "Agent System Overhaul" (for major architectural changes)
  * "Build Pipeline Enhancements" (for CI/CD improvements)
- The version header MUST be: "## ${request.version} - [Your Thematic Title]"
- Focus on the USER BENEFIT or FUNCTIONAL AREA, not technical implementation details
- The title should be what the release is "about" in layman's terms

PART 1 - Categorized changes (summarized):
- Use category sections: New Features, Improvements, Bug Fixes, Documentation, Other Changes
- ONLY include sections that have actual changes - skip empty sections entirely
- Add a blank line between each bullet point for cleaner formatting
- Summarize and group related commits into clear, readable descriptions
- Do NOT include commit hashes in this section

PART 2 - "What's Changed" (raw commit list):
- Add a horizontal rule (---) before this section
- List each commit in format: "- type: description by @author in hash"
- Example: "- fix: upgrade react to 19.2.3 by @douxc in abc1234"
- Example: "- feat: add dark mode support by @contributor in def5678"
- Include the commit type prefix (feat:, fix:, docs:, etc.)
- Show the author name with @ prefix
- Show the short commit hash at the end

PART 3 - "Thanks to all contributors" (deduplicated list):
- Add this section after "What's Changed"
- Extract all unique contributor names from the commits
- List them in a comma-separated format with @ prefix
- Example: "## Thanks to all contributors\\n\\n@contributor1, @contributor2, @contributor3"
- Only include unique names (no duplicates)
- This acknowledges everyone who contributed to this release`;
  }

  return `${audienceInstruction}

${sourceContext}

Generate a changelog from these git commits. Group related changes together and categorize them appropriately.

Conventional commit types to recognize:
- feat/feature: New features → New Features section
- fix/bugfix: Bug fixes → Bug Fixes section
- docs: Documentation → Documentation section
- style/refactor/perf: Improvements → Improvements section
- chore/build/ci: Other changes → Other Changes section (usually omit unless significant)
- test: Tests → (usually omit unless significant)
${formatSpecificInstructions}

Format:
${formatInstruction}
${emojiInstruction ? `\nEmoji Usage:\n${emojiInstruction}` : ''}

Git commits (${commits.length} total):
${commitLines}

${request.customInstructions ? `Note: ${request.customInstructions}` : ''}

CRITICAL: Output ONLY the raw changelog content. Do NOT include ANY introductory text, analysis, or explanation. Start directly with the changelog heading (## or #). No "Here's the changelog" or similar phrases. Intelligently group and summarize related commits - don't just list each commit individually. Only include sections that have actual changes.

DO NOT ask questions or request clarifications. Work with the information provided and make reasonable assumptions if needed. Generate the changelog immediately based on the git commits listed above.`;
}

/**
 * Create Python script for Claude generation
 *
 * On Windows, .cmd/.bat files require shell=True in subprocess.run() because
 * they are batch scripts that need cmd.exe to execute, not direct executables.
 */
export function createGenerationScript(prompt: string, claudePath: string): string {
  // Convert prompt to base64 to avoid any string escaping issues in Python
  const base64Prompt = Buffer.from(prompt, 'utf-8').toString('base64');

  // Escape the claude path for Python string
  const escapedClaudePath = claudePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Detect if this is a Windows batch file (.cmd or .bat)
  // These require shell=True in subprocess.run() because they need cmd.exe to execute
  const isCmdFile = /\.(cmd|bat)$/i.test(claudePath);

  return `
import subprocess
import sys
import base64

try:
    # Decode the base64 prompt to avoid string escaping issues
    prompt = base64.b64decode('${base64Prompt}').decode('utf-8')

    # Use Claude Code CLI to generate
    # stdin=DEVNULL prevents hanging when claude checks for interactive input
    # shell=${isCmdFile ? 'True' : 'False'} - Windows .cmd files require shell execution
    result = subprocess.run(
        ['${escapedClaudePath}', '-p', prompt, '--output-format', 'text', '--model', 'haiku'],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=300,
        shell=${isCmdFile ? 'True' : 'False'}
    )

    if result.returncode == 0:
        print(result.stdout)
    else:
        # Print more detailed error info
        print(f"Claude CLI error (code {result.returncode}):", file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        if result.stdout:
            print(f"stdout: {result.stdout}", file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f"Python error: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
`;
}
