/**
 * Shell Escape Utilities
 *
 * Provides safe escaping for shell command arguments to prevent command injection.
 * IMPORTANT: Always use these utilities when interpolating user-controlled values into shell commands.
 */

import { isWindows } from '../platform';
import type { WindowsShellType } from '../types/terminal';

// Re-export for convenience
export type { WindowsShellType };

/**
 * Escape a string for safe use as a shell argument.
 *
 * Uses single quotes which prevent all shell expansion (variables, command substitution, etc.)
 * except for single quotes themselves, which are escaped as '\''
 *
 * Examples:
 * - "hello" → 'hello'
 * - "hello world" → 'hello world'
 * - "it's" → 'it'\''s'
 * - "$(rm -rf /)" → '$(rm -rf /)'
 * - 'test"; rm -rf / #' → 'test"; rm -rf / #'
 *
 * @param arg - The argument to escape
 * @returns The escaped argument wrapped in single quotes
 */
export function escapeShellArg(arg: string): string {
  // Replace single quotes with: end quote, escaped quote, start quote
  // This is the standard POSIX-safe way to handle single quotes
  const escaped = arg.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

/**
 * Escape a path for use in a cd command.
 *
 * @param path - The path to escape
 * @returns The escaped path safe for use in shell commands
 */
export function escapeShellPath(path: string): string {
  return escapeShellArg(path);
}

/**
 * Build a safe cd command from a path.
 * Uses platform-appropriate quoting (double quotes on Windows, single quotes on Unix).
 *
 * On Windows, uses the /d flag to allow changing drives (e.g., from C: to D:)
 * and uses escapeForWindowsDoubleQuote for proper escaping inside double quotes.
 *
 * @param path - The directory path
 * @param shellType - On Windows, specify 'powershell' or 'cmd' for correct command chaining.
 *                    PowerShell 5.1 doesn't support '&&', so ';' is used instead.
 * @returns A safe "cd '<path>' && " or "cd '<path>'; " string, or empty string if path is undefined
 */
export function buildCdCommand(path: string | undefined, shellType?: WindowsShellType): string {
  if (!path) {
    return '';
  }

  // Windows cmd.exe uses double quotes, Unix shells use single quotes
  if (isWindows()) {
    // On Windows, use cd /d to change drives and directories simultaneously.
    // For values inside double quotes, use escapeForWindowsDoubleQuote() because
    // caret is literal inside double quotes in cmd.exe (only double quotes need escaping).
    const escaped = escapeForWindowsDoubleQuote(path);
    // PowerShell 5.1 doesn't support '&&' - use ';' instead
    // cmd.exe uses '&&' for conditional execution
    const separator = shellType === 'powershell' ? '; ' : ' && ';
    return `cd /d "${escaped}"${separator}`;
  }

  return `cd ${escapeShellPath(path)} && `;
}

/**
 * Escape a string for safe use as a Windows cmd.exe argument.
 *
 * Windows cmd.exe uses different escaping rules than POSIX shells.
 * This function escapes special characters that could break out of strings
 * or execute additional commands.
 *
 * @param arg - The argument to escape
 * @returns The escaped argument safe for use in cmd.exe
 */
export function escapeShellArgWindows(arg: string): string {
  // Escape characters that have special meaning in cmd.exe:
  // ^ is the escape character in cmd.exe
  // " & | < > ^ need to be escaped
  // % is used for variable expansion
  // \n and \r terminate commands and must be removed
  const escaped = arg
    .replace(/\r/g, '')        // Remove carriage returns (command terminators)
    .replace(/\n/g, '')        // Remove newlines (command terminators)
    .replace(/\^/g, '^^')     // Escape carets first (escape char itself)
    .replace(/"/g, '^"')      // Escape double quotes
    .replace(/&/g, '^&')      // Escape ampersand (command separator)
    .replace(/\|/g, '^|')     // Escape pipe
    .replace(/</g, '^<')      // Escape less than
    .replace(/>/g, '^>')      // Escape greater than
    .replace(/%/g, '%%');     // Escape percent (variable expansion)

  return escaped;
}

/**
 * Escape a string for safe use inside Windows cmd.exe double-quoted strings.
 *
 * Inside double quotes in cmd.exe, the escaping rules are different:
 * - Caret (^) is a LITERAL character, not an escape character
 * - Only double quotes need escaping, done by doubling them ("")
 * - Percent signs (%) must be escaped as %% to prevent variable expansion
 * - Newlines/carriage returns still need removal (command terminators)
 *
 * Use this for values in set commands like: set "VAR=value"
 *
 * Examples:
 * - "hello" → "hello"
 * - "it's" → "it's"
 * - 'path with "quotes"' → 'path with ""quotes""'
 * - "C:\Company & Co" → "C:\Company & Co" (ampersand protected by quotes)
 * - "%PATH%" → "%%PATH%%" (percent escaped)
 *
 * @param arg - The argument to escape
 * @returns The escaped argument (caller should wrap in double quotes)
 */
export function escapeForWindowsDoubleQuote(arg: string): string {
  // Inside double quotes, only escape embedded double quotes by doubling them.
  // Also escape percent signs to prevent variable expansion.
  // Also remove newlines/carriage returns as they terminate commands.
  const escaped = arg
    .replace(/\r/g, '')        // Remove carriage returns (command terminators)
    .replace(/\n/g, '')        // Remove newlines (command terminators)
    .replace(/%/g, '%%')       // Escape percent (variable expansion in cmd.exe)
    .replace(/"/g, '""');      // Escape double quotes by doubling

  return escaped;
}

/**
 * Validate that a path doesn't contain obviously malicious patterns.
 * This is a defense-in-depth measure - escaping should handle all cases,
 * but this can catch obvious attack attempts early.
 *
 * @param path - The path to validate
 * @returns true if the path appears safe, false if it contains suspicious patterns
 */
export function isPathSafe(path: string): boolean {
  // Check for obvious shell metacharacters that shouldn't appear in paths
  // Note: This is defense-in-depth; escaping handles these, but we can log/reject
  const suspiciousPatterns = [
    /\$\(/, // Command substitution $(...)
    /`/,   // Backtick command substitution
    /\|/,  // Pipe
    /;/,   // Command separator
    /&&/,  // AND operator
    /\|\|/, // OR operator
    />/,   // Output redirection
    /</,   // Input redirection
    /\n/,  // Newlines
    /\r/,  // Carriage returns
  ];

  return !suspiciousPatterns.some(pattern => pattern.test(path));
}

/**
 * File reference data structure from FileTreeItem drag events.
 * This is the JSON payload set in dataTransfer by FileTreeItem components.
 */
export interface FileReferenceDropData {
  type: 'file-reference';
  path: string;
  name: string;
  isDirectory: boolean;
}

/**
 * Parse file reference data from a drag event's DataTransfer.
 * Extracts and validates the JSON payload set by FileTreeItem components.
 *
 * This function is used by Terminal drop handlers to safely extract file paths
 * from drag-and-drop events originating from the file tree.
 *
 * @param dataTransfer - The DataTransfer object from a drag event
 * @returns The parsed FileReferenceDropData if valid, null otherwise
 */
export function parseFileReferenceDrop(dataTransfer: DataTransfer): FileReferenceDropData | null {
  const jsonData = dataTransfer.getData('application/json');
  if (!jsonData) {
    return null;
  }

  try {
    const data = JSON.parse(jsonData) as Record<string, unknown>;
    // Validate required fields
    if (
      data.type === 'file-reference' &&
      typeof data.path === 'string' &&
      data.path.length > 0
    ) {
      return {
        type: 'file-reference',
        path: data.path,
        name: typeof data.name === 'string' ? data.name : '',
        isDirectory: typeof data.isDirectory === 'boolean' ? data.isDirectory : false
      };
    }
  } catch {
    // Invalid JSON, return null
  }

  return null;
}
