/**
 * Shared time and duration formatting utilities.
 *
 * Consolidates duplicate formatting logic from TaskCard and ActivityFeed.
 */

/**
 * Format a duration in milliseconds as a short human-readable string.
 * @param ms Duration in milliseconds
 * @param includeSeconds Whether to include seconds in the output when minutes > 0 (default: false)
 * @returns Formatted string like "5s", "2m", "1h 30m", "2m 15s"
 */
export function formatDurationShort(ms: number, includeSeconds = false): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    if (includeSeconds && remainingSeconds > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
