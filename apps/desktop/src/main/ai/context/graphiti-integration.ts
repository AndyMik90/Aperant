/**
 * Memory Knowledge Graph Integration (stub)
 *
 * Provides historical hints from the memory system when available.
 * The memory system is now implemented in apps/desktop/src/main/ai/memory/.
 *
 * This is a no-op stub for the initial TypeScript port.
 * A future implementation can wire this to the memory MCP call.
 */

/**
 * Returns whether the memory system is currently enabled.
 * For now this always returns false; can be wired to an env/setting later.
 */
export function isMemoryEnabled(): boolean {
  return false;
}

/** @deprecated Use isMemoryEnabled instead */
export const isGraphitiEnabled = isMemoryEnabled;

/**
 * Fetch historical hints for a query from the memory knowledge graph.
 *
 * @param _query       Task description or search query.
 * @param _projectId   Project identifier (typically the project root path).
 * @param _maxResults  Maximum number of hints to return.
 * @returns Empty array until memory integration is implemented.
 */
export async function fetchGraphHints(
  _query: string,
  _projectId: string,
  _maxResults = 5,
): Promise<Record<string, unknown>[]> {
  if (!isMemoryEnabled()) return [];

  // Future: call memory MCP server here
  return [];
}
