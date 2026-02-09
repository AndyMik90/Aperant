/**
 * Output Parser Module
 * Handles parsing and pattern detection in terminal output
 */

/**
 * Regex patterns to capture Claude session ID from output
 */
const CLAUDE_SESSION_PATTERNS = [
  /Session(?:\s+ID)?:\s*([a-zA-Z0-9_-]+)/i,
  /session[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i,
  /Resuming session:\s*([a-zA-Z0-9_-]+)/i,
  /conversation[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i,
];

/**
 * Regex pattern to detect Claude Code rate limit messages
 * Matches: "Limit reached · resets Dec 17 at 6am (Europe/Oslo)"
 */
const RATE_LIMIT_PATTERN = /Limit reached\s*[·•]\s*resets\s+(.+?)$/m;

/**
 * Regex pattern to capture OAuth token from Claude CLI output
 * Token is displayed when authentication completes via /login or setup-token
 */
const OAUTH_TOKEN_PATTERN = /(sk-ant-oat01-[A-Za-z0-9_-]+)/;

/**
 * Regex pattern to capture OAuth authorization URL from Claude CLI /login output
 * The URL is displayed when /login is run and needs to be opened in browser
 * Uses \x1b to exclude ANSI escape sequences from URL matching
 */
// eslint-disable-next-line no-control-regex -- Intentionally matches ANSI escape sequences to exclude them from URLs
const OAUTH_URL_PATTERN = /https:\/\/claude\.ai\/oauth\/authorize\?[^\s\x1b\]]+/;

/**
 * Patterns to detect email in Claude output
 * Multiple patterns to handle different output formats:
 * - "Authenticated as user@example.com" or "Logged in as user@example.com"
 * - "email: user@example.com"
 * - "user@example.com's Organization" (Claude Code welcome screen)
 * - Fallback: any email-like pattern in the context of Claude Max/Pro/Team
 */
const EMAIL_PATTERNS = [
  /(?:Authenticated as |Logged in as |email[:\s]+)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,  // Note: space after "as"
  /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['\u2019]s\s*Organization/i,  // "user@example.com's Organization" (ASCII and curly apostrophes)
  /Claude\s+(?:Max|Pro|Team|Enterprise)\s*[·•]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,  // "Claude Max · user@example.com"
  /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['\u2019]s/i,  // Just "user@example.com's" (broader match)
];

/**
 * Pattern to detect successful login in Claude CLI output
 * Matches: "Login successful" or "Logged in as X"
 */
const LOGIN_SUCCESS_PATTERN = /(?:Login successful|Successfully logged in|Logged in as\s+\S+@\S+)/i;

/**
 * Extract Claude session ID from output
 */
export function extractClaudeSessionId(data: string): string | null {
  for (const pattern of CLAUDE_SESSION_PATTERNS) {
    const match = data.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract rate limit reset time from output
 */
export function extractRateLimitReset(data: string): string | null {
  const match = data.match(RATE_LIMIT_PATTERN);
  return match ? match[1].trim() : null;
}

/**
 * Extract OAuth token from output
 */
export function extractOAuthToken(data: string): string | null {
  const match = data.match(OAUTH_TOKEN_PATTERN);
  return match ? match[1] : null;
}

/**
 * Extract OAuth authorization URL from output
 * Returns the URL that needs to be opened in browser for /login flow
 */
export function extractOAuthUrl(data: string): string | null {
  const match = data.match(OAUTH_URL_PATTERN);
  return match ? match[0] : null;
}

/**
 * Check if output contains an OAuth authorization URL
 */
export function hasOAuthUrl(data: string): boolean {
  return OAUTH_URL_PATTERN.test(data);
}

/**
 * Strip ANSI escape codes from a string
 *
 * Handles comprehensive escape sequences including:
 * - CSI sequences: \x1b[...X (colors, cursor movement, SGR, etc.)
 * - OSC sequences: \x1b]...BEL or \x1b]...ST (hyperlinks, window title, etc.)
 *   - OSC 8 hyperlinks wrap text like: \x1b]8;;url\x07text\x1b]8;;\x07
 *   - These are used by modern terminals to make emails/URLs clickable
 * - DCS sequences: \x1bP...ST (device control)
 * - Other single-character escape sequences
 *
 * This comprehensive stripping is critical for email extraction because terminals
 * often wrap emails in OSC 8 hyperlink sequences, which would otherwise corrupt
 * the email address during regex matching.
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERNS = [
  // CSI sequences: \x1b[ followed by optional private mode indicator (?, >, !),
  // then parameters (numbers and semicolons), then a command letter
  // Examples: \x1b[0m (reset), \x1b[1;32m (bold green), \x1b[?25h (show cursor)
  /\x1b\[[?!>]?[0-9;]*[a-zA-Z]/g,

  // OSC sequences: \x1b] followed by content, terminated by BEL (\x07) or ST (\x1b\\)
  // Examples: \x1b]0;title\x07 (set window title), \x1b]8;;url\x07 (hyperlink)
  // The [^\x07]* matches any chars except BEL, allowing nested content
  /\x1b\][^\x07]*(?:\x07|\x1b\\)/g,

  // DCS sequences: \x1bP followed by content, terminated by ST (\x1b\\)
  // Used for device control strings (less common but should be handled)
  /\x1bP[^\x1b]*\x1b\\/g,

  // Single-character escapes: \x1b followed by specific characters
  // Examples: \x1b= (keypad mode), \x1b> (normal keypad), \x1bM (reverse index)
  /\x1b[=>ABCDEFGHIJKLMNOPQRSTUVWXYZ\\^_`abcdefghijklmnopqrstuvwxyz{|}~]/g,

  // APC, PM, SOS sequences (Application Program Command, Privacy Message, Start of String)
  // Format: \x1b_ or \x1b^ or \x1bX followed by content, terminated by ST
  /\x1b[_X^][^\x1b]*\x1b\\/g,
];

function stripAnsi(str: string): string {
  let result = str;
  for (const pattern of ANSI_ESCAPE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Extract email from output
 * Tries multiple patterns to handle different output formats
 * Automatically strips ANSI escape codes before matching
 */
export function extractEmail(data: string): string | null {
  // Strip ANSI escape codes - terminal output often contains formatting
  // that can break regex matching (e.g., color codes within the email text)
  const cleanData = stripAnsi(data);

  for (const pattern of EMAIL_PATTERNS) {
    const match = cleanData.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if output contains a rate limit message
 */
export function hasRateLimitMessage(data: string): boolean {
  return RATE_LIMIT_PATTERN.test(data);
}

/**
 * Check if output contains an OAuth token
 */
export function hasOAuthToken(data: string): boolean {
  return OAUTH_TOKEN_PATTERN.test(data);
}

/**
 * Check if output indicates successful login
 * This catches the localhost callback flow where no token is displayed
 */
export function hasLoginSuccess(data: string): boolean {
  return LOGIN_SUCCESS_PATTERN.test(data);
}

/**
 * Patterns indicating Claude Code is busy/processing
 * These appear when Claude is actively thinking or working
 *
 * IMPORTANT: These must be universal patterns that work for ALL users,
 * not just custom terminal configurations with progress bars.
 */
const CLAUDE_BUSY_PATTERNS = [
  // Universal Claude Code indicators
  /^●/m,                            // Claude's response bullet point (appears when Claude is responding)
  /\u25cf/,                         // Unicode bullet point (●)

  // Tool execution indicators (Claude is running tools)
  /^(Read|Write|Edit|Bash|Grep|Glob|Task|WebFetch|WebSearch|TodoWrite)\(/m,
  /^\s*\d+\s*[│|]\s*/m,            // Line numbers in file output (Claude reading/showing files)

  // Streaming/thinking indicators
  /Loading\.\.\./i,
  /Thinking\.\.\./i,
  /Analyzing\.\.\./i,
  /Processing\.\.\./i,
  /Working\.\.\./i,
  /Searching\.\.\./i,
  /Creating\.\.\./i,
  /Updating\.\.\./i,
  /Running\.\.\./i,

  // Custom progress bar patterns (for users who have them)
  /\[Opus\s*\d*\.?\d*\].*\d+%/i,   // Opus model progress
  /\[Sonnet\s*\d*\.?\d*\].*\d+%/i, // Sonnet model progress
  /\[Haiku\s*\d*\.?\d*\].*\d+%/i,  // Haiku model progress
  /\[Claude\s*\d*\.?\d*\].*\d+%/i, // Generic Claude progress
  /░+/,                             // Progress bar characters
  /▓+/,                             // Progress bar characters
  /█+/,                             // Progress bar characters (filled)
];

/**
 * Patterns indicating Claude Code is idle/ready for input
 * The prompt character at the start of a line indicates Claude is waiting
 */
const CLAUDE_IDLE_PATTERNS = [
  /^>\s*$/m,                        // Just "> " prompt on its own line
  /\n>\s*$/,                        // "> " at end after newline
  /^\s*>\s+$/m,                     // "> " with possible whitespace
];

/**
 * Patterns indicating Claude Code onboarding/login is complete
 * These patterns detect the welcome screen that appears after successful login
 */
const ONBOARDING_COMPLETE_PATTERNS = [
  /Welcome back\s+\w+/i,            // "Welcome back André!" or similar
  /Claude Code v\d+\.\d+/i,         // "Claude Code v2.1.12" version header
  /Claude\s+(Max|Pro|Team|Enterprise)/i,  // Subscription tier indicator
];

/**
 * Check if output indicates Claude is busy (processing)
 */
export function isClaudeBusyOutput(data: string): boolean {
  return CLAUDE_BUSY_PATTERNS.some(pattern => pattern.test(data));
}

/**
 * Check if output indicates Claude is idle (ready for input)
 */
export function isClaudeIdleOutput(data: string): boolean {
  return CLAUDE_IDLE_PATTERNS.some(pattern => pattern.test(data));
}

/**
 * Check if output indicates Claude Code onboarding is complete
 * This detects the welcome screen that appears after successful login/onboarding
 */
export function isOnboardingCompleteOutput(data: string): boolean {
  return ONBOARDING_COMPLETE_PATTERNS.some(pattern => pattern.test(data));
}

/**
 * Determine Claude busy state from output
 * Returns: 'busy' | 'idle' | null (no change detected)
 */
export function detectClaudeBusyState(data: string): 'busy' | 'idle' | null {
  // Check for busy indicators FIRST - they're more definitive
  // Progress bars and "Loading..." mean Claude is definitely working,
  // even if there's a ">" prompt visible elsewhere in the output
  if (isClaudeBusyOutput(data)) {
    return 'busy';
  }
  // Only check for idle if no busy indicators found
  // The ">" prompt alone at end of output means Claude is waiting for input
  if (isClaudeIdleOutput(data)) {
    return 'idle';
  }
  return null;
}

/**
 * Patterns indicating Claude Code has exited and returned to shell
 *
 * These patterns detect shell prompts that are distinct from Claude's simple ">" prompt.
 * Shell prompts typically include:
 * - Username and hostname (user@host)
 * - Current directory
 * - Git branch indicators
 * - Shell-specific characters at the end ($, %, #, ❯)
 *
 * We look for these patterns to distinguish between Claude's idle prompt (">")
 * and a proper shell prompt indicating Claude has exited.
 */
const CLAUDE_EXIT_PATTERNS = [
  // Standard shell prompts with path/context (bash/zsh)
  // Matches: "user@hostname:~/path$", "hostname:path %", "[user@host path]$"
  // Must be at line start to avoid matching user@host in Claude's output
  // Requires path indicator after colon to avoid matching emails like "user@example.com:"
  /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[~/$]/m,  // user@hostname:~ or user@hostname:/path

  // Path-based prompts (often in zsh, fish, etc.)
  // Matches: "~/projects $", "/home/user %"
  // Anchored to line start to avoid matching paths in Claude's explanations
  /^[~/][^\s]*\s*[$%#❯]\s*$/m,

  // Prompts with brackets (common in bash)
  // Matches: "[user@host directory]$", "(venv) user@host:~$"
  // Anchored to avoid matching array access like ${arr[0]}
  /^\s*\[[^\]]+\]\s*[$%#]\s*$/m,

  // Virtual environment or conda prompts followed by standard prompt
  // Matches: "(venv) $", "(base) user@host:~$"
  /^\([a-zA-Z0-9_-]+\)\s*.*[$%#❯]\s*$/m,

  // Starship, Oh My Zsh, Powerlevel10k common patterns
  // Matches: "❯", "➜", "λ" at end of line (often colored/styled)
  // Anchored to avoid matching Unicode arrows in Claude's explanations
  /^\s*[❯➜λ]\s*$/m,

  // Fish shell prompt patterns
  // Matches: "user@host ~/path>", "~/path>"
  // Anchored to avoid matching file paths ending with >
  /^~?\/[^\s]*>\s*$/m,

  // Git branch in prompt followed by prompt character
  // Matches: "(main) $", "[git:main] >"
  // Anchored to avoid matching code snippets with brackets
  /^\s*[([a-zA-Z0-9/_-]+[)\]]\s*[$%#>❯]\s*$/m,

  // Simple but distinctive shell prompts with hostname
  // Matches: "hostname$", "hostname %"
  /^[a-zA-Z0-9._-]+[$%#]\s*$/m,

  // Detect Claude exit messages (optional, catches explicit exits)
  /Goodbye!?\s*$/im,
  /Session ended/i,
  /Exiting Claude/i,
];

/**
 * Check if output indicates Claude has exited and returned to shell
 *
 * This is more specific than shell prompt detection - it looks for patterns
 * that indicate we've returned to a shell AFTER being in Claude mode.
 */
export function isClaudeExitOutput(data: string): boolean {
  return CLAUDE_EXIT_PATTERNS.some(pattern => pattern.test(data));
}

/**
 * Detect if Claude has exited based on terminal output
 * Returns true if output indicates Claude has exited and shell is ready
 *
 * This function should be called when the terminal is in Claude mode
 * to detect if Claude has exited (user typed /exit, Ctrl+D, etc.)
 */
export function detectClaudeExit(data: string): boolean {
  // First, make sure this doesn't look like Claude activity
  // If we see Claude busy indicators, Claude hasn't exited
  if (isClaudeBusyOutput(data)) {
    return false;
  }

  // Check for Claude exit patterns (shell prompt return)
  return isClaudeExitOutput(data);
}
