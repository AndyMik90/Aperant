/**
 * Knowledge Graph Module
 *
 * Layer 1: AST-extracted structural code intelligence.
 * Fully TypeScript. Replaces the Python sidecar.
 */

export { TreeSitterLoader } from './tree-sitter-loader';
export { ASTExtractor } from './ast-extractor';
export type { ExtractedNode, ExtractedEdge, ExtractionResult } from './ast-extractor';
export { chunkFileByAST } from './ast-chunker';
// ASTChunk is defined identically in embedding-service.ts — import from there for embedding use
export type { ASTChunk } from './ast-chunker';
export { GraphDatabase, makeNodeId, makeEdgeId } from './graph-database';
export { IncrementalIndexer } from './incremental-indexer';
export { analyzeImpact, formatImpactResult } from './impact-analyzer';
export type { ImpactResult } from './impact-analyzer';
