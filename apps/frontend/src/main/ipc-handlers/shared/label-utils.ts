/**
 * Shared label matching utilities
 * Used by both GitHub and GitLab spec-utils for category detection
 */

import { escapeRegExp } from '@shared/utils/string-utils';

/**
 * Check if a label contains a whole-word match for a term.
 * Uses word boundaries to prevent false positives (e.g., 'acid' matching 'ci').
 *
 * The term is escaped to handle regex metacharacters safely, so terms like
 * "c++" or "c#" are matched literally rather than being interpreted as regex.
 *
 * @param label - The label to check (already lowercased)
 * @param term - The term to search for (will be escaped for regex safety)
 * @returns true if the label contains the term as a whole word
 */
export function labelMatchesWholeWord(label: string, term: string): boolean {
  // Escape regex metacharacters in the term to match literally
  const escapedTerm = escapeRegExp(term);
  // Use word boundary regex to match whole words only
  const regex = new RegExp(`\\b${escapedTerm}\\b`);
  return regex.test(label);
}
