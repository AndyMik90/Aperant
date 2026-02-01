import striptags from 'striptags';
/**
 * Strip HTML tags from a string
 */
export function stripHtmlTags(html: string | undefined): string {
  if (!html) return '';
  return striptags(html).trim();
}
