/**
 * Shared sanitization utilities for network data before writing to disk.
 * Prevents control character injection and enforces length limits on
 * data from external APIs (GitHub, GitLab, Linear, etc.).
 */

/**
 * Strip control characters from a string.
 * Keeps tabs, newlines, and carriage returns only when allowNewlines is true.
 */
export function stripControlChars(value: string, allowNewlines: boolean): string {
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x0A || code === 0x0D || code === 0x09) {
      if (allowNewlines) {
        sanitized += value[i];
      }
      continue;
    }
    if (code <= 0x1F || code === 0x7F) {
      continue;
    }
    sanitized += value[i];
  }
  return sanitized;
}

/**
 * Sanitize a text value: type-check, strip control chars, enforce max length.
 */
export function sanitizeText(value: unknown, maxLength: number, allowNewlines = false): string {
  if (typeof value !== 'string') return '';
  let sanitized = stripControlChars(value, allowNewlines).trim();
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

/**
 * Sanitize an array of strings: type-check each entry, strip control chars,
 * enforce per-item length and max item count.
 */
export function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const sanitized: string[] = [];
  for (const entry of value) {
    const cleanEntry = sanitizeText(entry, maxLength);
    if (cleanEntry) {
      sanitized.push(cleanEntry);
    }
    if (sanitized.length >= maxItems) {
      break;
    }
  }
  return sanitized;
}

/**
 * Sanitize a URL value: validate format, strip control chars, enforce length.
 * Returns empty string for invalid URLs.
 */
export function sanitizeUrl(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  const cleaned = stripControlChars(value, false).trim();
  if (cleaned.length > maxLength) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}
