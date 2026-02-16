/**
 * Escape special regex characters in a string.
 * This ensures that strings containing regex metacharacters (e.g., "c++", ".auto-claude")
 * are matched literally when embedded in a RegExp.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in a RegExp
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
