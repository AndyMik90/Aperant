/**
 * JSON Repair Utility
 *
 * Repairs common JSON mistakes made by LLMs when editing implementation_plan.json.
 * LLMs sometimes produce syntactically invalid JSON (missing commas, trailing commas, etc.)
 * which causes silent failures throughout the subtask status tracking pipeline.
 */

/**
 * Attempt to repair common JSON mistakes made by LLMs.
 * Returns the repaired JSON string.
 * Throws the original SyntaxError if repair fails.
 */
export function repairJson(raw: string): string {
  // Fast path: valid JSON — no repair needed
  try {
    JSON.parse(raw);
    return raw;
  } catch (originalError) {
    // Continue to repairs
    return applyRepairs(raw, originalError as SyntaxError);
  }
}

/**
 * Parse JSON with automatic repair of common LLM mistakes.
 * Returns the parsed object, or null if both repair and parse fail.
 */
export function safeParseJson<T = unknown>(raw: string): T | null {
  try {
    const repaired = repairJson(raw);
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

/**
 * Apply repair strategies in sequence until one produces valid JSON.
 */
function applyRepairs(raw: string, originalError: SyntaxError): string {
  let text = raw;

  // 1. Strip markdown code fences (```json ... ```)
  text = text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '');

  // 1.5. Strip illegal JSON control characters while preserving valid
  // Unicode, tabs, line feeds, and carriage returns.
  const strippedControlChars = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (strippedControlChars !== text) {
    text = strippedControlChars;
    console.warn('[json-repair] Stripped illegal control characters from JSON');
  }

  // 2. Remove trailing commas before } or ]
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // 3. Add missing commas between array elements / object properties
  // This is the most common LLM mistake: a closing } or ] or " followed by
  // whitespace/newline and then an opening { or [ or " where a comma is required.
  //
  // Pattern: (closing token)(whitespace including newline)(opening token)
  // Closing tokens: } ] " digits true false null
  // Opening tokens: { [ "
  text = text.replace(
    /([}\]"0-9]|true|false|null)\s*\n(\s*[{["])/g,
    '$1,\n$2'
  );

  try {
    JSON.parse(text);
    console.warn('[json-repair] Successfully repaired malformed JSON (applied standard fixes)');
    return text;
  } catch {
    // Standard fixes weren't enough
  }

  // 4. More aggressive: fix missing commas even without newlines
  // e.g., } { on the same line or "value" "key" patterns
  text = text.replace(
    /([}\]"])\s+([{["])/g,
    (match, before: string, after: string) => {
      // Don't add comma after { or [ (that would break empty arrays/objects)
      // Only add between closing and opening tokens
      return `${before}, ${after}`;
    }
  );

  try {
    JSON.parse(text);
    console.warn('[json-repair] Successfully repaired malformed JSON (applied aggressive fixes)');
    return text;
  } catch {
    // All repairs failed — throw original error
    throw originalError;
  }
}
