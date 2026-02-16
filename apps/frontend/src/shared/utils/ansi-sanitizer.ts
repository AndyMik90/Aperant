/**
 * ANSI escape code sanitization utility.
 *
 * Removes ANSI escape sequences from strings for clean UI display.
 * These sequences are used for terminal coloring/formatting but appear
 * as raw text in UI components.
 *
 * Example:
 * - Input:  "\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m Sending query"
 * - Output: "[21:40:22.196] [DEBUG] Sending query"
 */

/**
 * ANSI CSI (Control Sequence Introducer) escape sequence pattern.
 * Matches the full ANSI/VT100 CSI form: ESC [ parameter-bytes intermediate-bytes final-bytes
 * - Parameter bytes: 0x30-0x3F (digits 0-9, :;<=>?) -> [0-?]* in regex
 * - Intermediate bytes: 0x20-0x2F (space and !"#$%&'()*+,-./) -> [ -/]* in regex
 * - Final bytes: 0x40-0x7E (@ through ~) -> [@-~] in regex
 *
 * Examples: \x1b[31m (red), \x1b[?25l (hide cursor), \x1b[200~ (bracketed paste start)
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes require control characters
const ANSI_CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * OSC (Operating System Command) escape sequences.
 * Two patterns are needed because OSC uses different terminators:
 * - BEL (bell): \x1b]...\x07 - Single character terminator
 * - ST (string terminator): \x1b]...\x1b\\ - Two character terminator (ESC + backslash)
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC sequences use BEL terminator
const ANSI_OSC_BEL_PATTERN = /\x1b\][^\x07]*\x07/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC sequences use ST terminator
const ANSI_OSC_ST_PATTERN = /\x1b\][^\x1b]*\x1b\\/g;

/**
 * Removes ANSI escape codes from a string.
 *
 * @param text - The string potentially containing ANSI escape codes
 * @returns The string with all ANSI escape sequences removed
 *
 * @example
 * ```ts
 * stripAnsiCodes('\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m')
 * // Returns: '[21:40:22.196] [DEBUG]'
 * ```
 */
export function stripAnsiCodes(text: string): string {
  if (!text) return '';

  return text
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_BEL_PATTERN, '')
    .replace(ANSI_OSC_ST_PATTERN, '');
}
