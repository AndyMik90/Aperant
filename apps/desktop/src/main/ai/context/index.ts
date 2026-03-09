/**
 * Context System — public entry point
 *
 * Re-exports everything consumers need from the context module.
 */

export { buildContext, buildTaskContext } from './builder.js';
export type { BuildContextConfig } from './builder.js';
export { extractKeywords } from './keyword-extractor.js';
export { searchService } from './search.js';
export { suggestServices } from './service-matcher.js';
export { categorizeMatches } from './categorizer.js';
export { discoverPatterns } from './pattern-discovery.js';
export { isMemoryEnabled, isGraphitiEnabled, fetchGraphHints } from './graphiti-integration.js';
export type {
  ContextFile,
  SubtaskContext,
  ServiceMatch,
  CodePattern,
  FileMatch,
  TaskContext,
  ProjectIndex,
  ServiceInfo,
} from './types.js';
