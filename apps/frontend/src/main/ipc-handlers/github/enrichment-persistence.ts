/**
 * Enrichment persistence layer.
 * File I/O for enrichment.json and transitions.json with atomic writes and locking.
 */

import path from 'path';
import fs from 'fs';
import { mkdir, readFile, rename, access as fsPromisesAccess } from 'fs/promises';
import { writeJsonWithRetry } from '../../utils/atomic-file';
import { withEnrichmentLock } from './enrichment-lock';
import { ENRICHMENT_SCHEMA_VERSION } from '../../../shared/constants/enrichment';
import { createDefaultEnrichment } from '../../../shared/types/enrichment';
import type {
  EnrichmentFile,
  TransitionsFile,
  TransitionRecord,
  IssueEnrichment,
} from '../../../shared/types/enrichment';
import type { GitHubIssue } from '../../../shared/types/integrations';
import { isWindows } from '../../platform';
import { createContextLogger } from './utils/logger';

const logger = createContextLogger('Enrichment Persistence');

// ============================================
// Path Helpers
// ============================================

export function getEnrichmentDir(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', 'github', 'issues');
}

export function getEnrichmentFilePath(projectPath: string): string {
  return path.join(getEnrichmentDir(projectPath), 'enrichment.json');
}

export function getTransitionsFilePath(projectPath: string): string {
  return path.join(getEnrichmentDir(projectPath), 'transitions.json');
}

function getMigrationMarkerPath(projectPath: string): string {
  return path.join(getEnrichmentDir(projectPath), '.enrichment-migration-complete');
}

// ============================================
// Read / Write Enrichment
// ============================================

function createEmptyEnrichmentFile(): EnrichmentFile {
  return { schemaVersion: ENRICHMENT_SCHEMA_VERSION, issues: {} };
}

export async function readEnrichmentFile(projectPath: string): Promise<EnrichmentFile> {
  const filePath = getEnrichmentFilePath(projectPath);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as EnrichmentFile;

    if (data.schemaVersion && data.schemaVersion !== ENRICHMENT_SCHEMA_VERSION) {
      logger.debug(`Enrichment schema version ${data.schemaVersion} differs from expected ${ENRICHMENT_SCHEMA_VERSION}`);
    }

    return data;
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;

    if (nodeErr.code === 'ENOENT') {
      return createEmptyEnrichmentFile();
    }

    // Corrupt file — rename to .corrupted and return empty
    if (nodeErr instanceof SyntaxError || nodeErr.message?.includes('JSON')) {
      logger.debug(`Corrupt enrichment file detected, recovering: ${nodeErr.message}`);
      try {
        await rename(filePath, `${filePath}.corrupted`);
      } catch {
              // Best effort
      }
      return createEmptyEnrichmentFile();
    }

    // For non-parse filesystem errors (EACCES/EPERM/etc), surface the
    // failure so callers do not accidentally overwrite valid data with
    // an empty file on the next write.
    throw err;
  }
}

export async function writeEnrichmentFile(
  projectPath: string,
  data: EnrichmentFile,
): Promise<void> {
  const filePath = getEnrichmentFilePath(projectPath);
  const dir = path.dirname(filePath);

  await mkdir(dir, { recursive: true });

  await writeJsonWithRetry(filePath, data, {
    indent: 2,
    maxRetries: isWindows() ? 5 : 3,
  });
}

/**
 * Wrap an entire read-modify-write cycle on the enrichment file in a single lock.
 * Callers MUST use this instead of separate read + write calls to prevent lost updates.
 */
export async function withEnrichmentFileLock<T>(
  projectPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const filePath = getEnrichmentFilePath(projectPath);
  return withEnrichmentLock(filePath, operation);
}

// ============================================
// Read / Append Transitions
// ============================================

export async function readTransitionsFile(projectPath: string): Promise<TransitionsFile> {
  const filePath = getTransitionsFilePath(projectPath);

  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as TransitionsFile;
  } catch {
          return { transitions: [] };
  }
}

export async function appendTransition(
  projectPath: string,
  record: TransitionRecord,
): Promise<void> {
  const filePath = getTransitionsFilePath(projectPath);
  const dir = path.dirname(filePath);

  await mkdir(dir, { recursive: true });

  await withEnrichmentLock(filePath, async () => {
    const existing = await readTransitionsFile(projectPath);
    existing.transitions.push(record);
    await writeJsonWithRetry(filePath, existing, {
      indent: 2,
      maxRetries: isWindows() ? 5 : 3,
    });
  });
}

// ============================================
// Migration from Legacy Triage Files
// ============================================

export async function migrateFromTriageFiles(projectPath: string): Promise<EnrichmentFile> {
  const markerPath = getMigrationMarkerPath(projectPath);
  const enrichmentPath = getEnrichmentFilePath(projectPath);
  const issuesDir = getEnrichmentDir(projectPath);

  // Check if migration already completed - both marker and enrichment must exist
  // We handle the TOCTOU by catching errors when files don't exist
  let markerExists = false;
  try {
    fs.readFileSync(markerPath, 'utf-8');
    markerExists = true;
  } catch {
    // Marker doesn't exist
  }

  let enrichmentExists = false;
  try {
    await fsPromisesAccess(enrichmentPath);
    enrichmentExists = true;
  } catch {
    // Enrichment file doesn't exist
  }

  // If both exist, migration is complete - return existing data
  if (markerExists && enrichmentExists) {
    return readEnrichmentFile(projectPath);
  }

  await mkdir(issuesDir, { recursive: true });

  const enrichmentFile = createEmptyEnrichmentFile();

  // Scan for legacy triage_*.json files
  try {
    const files = fs.readdirSync(issuesDir);
    for (const file of files) {
      if (file.startsWith('triage_') && file.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
          const data = JSON.parse(raw);
          const issueNumber = data.issue_number as number;

          if (issueNumber) {
            const enrichment = createDefaultEnrichment(issueNumber);
            enrichment.triageState = 'triage';
            if (data.category) {
              enrichment.triageResult = {
                category: data.category,
                confidence: data.confidence ?? 0,
                labelsToAdd: data.labels_to_add ?? [],
                labelsToRemove: data.labels_to_remove ?? [],
                isDuplicate: data.is_duplicate ?? false,
                duplicateOf: data.duplicate_of,
                isSpam: data.is_spam ?? false,
                suggestedBreakdown: [],
                triagedAt: data.triaged_at ?? new Date().toISOString(),
              };
            }
            enrichmentFile.issues[String(issueNumber)] = enrichment;
          }
        } catch {
                logger.debug(`Failed to parse legacy triage file: ${file}`);
        }
      }
    }
  } catch {
          // Directory doesn't exist or can't be read — return empty
  }

  await writeEnrichmentFile(projectPath, enrichmentFile);

  // Write migration marker atomically
  fs.writeFileSync(markerPath, new Date().toISOString(), { mode: 0o644, flag: 'w' });

  return enrichmentFile;
}

// ============================================
// Bootstrap from GitHub Issues
// ============================================

/**
 * Generate initial enrichment from GitHub issue data.
 * Bypasses normal transition validation — bootstrap is authoritative (GAP-11).
 */
export async function bootstrapFromGitHub(
  projectPath: string,
  issues: GitHubIssue[],
): Promise<EnrichmentFile> {
  return withEnrichmentFileLock(projectPath, async () => {
    const enrichmentFile = await readEnrichmentFile(projectPath);
    const now = new Date().toISOString();

    for (const issue of issues) {
      const key = String(issue.number);

      // Skip issues that already have enrichment
      if (enrichmentFile.issues[key]) continue;

      const enrichment = createDefaultEnrichment(issue.number);

      // Infer state from GitHub issue data
      if (issue.state === 'closed') {
        enrichment.triageState = 'done';
        enrichment.resolution = 'completed';
      } else if (issue.assignees.length > 0) {
        enrichment.triageState = 'in_progress';
      }

      // Extract priority from labels
      for (const label of issue.labels) {
        const name = label.name.toLowerCase();
        if (name === 'priority:critical' || name === 'critical') {
          enrichment.priority = 'critical';
        } else if (name === 'priority:high' || name === 'high') {
          enrichment.priority = 'high';
        } else if (name === 'priority:medium' || name === 'medium') {
          enrichment.priority = 'medium';
        } else if (name === 'priority:low' || name === 'low') {
          enrichment.priority = 'low';
        }
      }

      enrichmentFile.issues[key] = enrichment;

      // Log bootstrap transition
      await appendTransition(projectPath, {
        issueNumber: issue.number,
        from: 'new',
        to: enrichment.triageState,
        actor: 'bootstrap',
        timestamp: now,
      });
    }

    await writeEnrichmentFile(projectPath, enrichmentFile);
    return enrichmentFile;
  });
}

// ============================================
// Reconciliation
// ============================================

/**
 * Reconcile GitHub state with enrichment state.
 * Bypasses normal transition validation — reconciliation is authoritative (GAP-11).
 */
export async function reconcileWithGitHub(
  projectPath: string,
  issues: GitHubIssue[],
): Promise<EnrichmentFile> {
  return withEnrichmentFileLock(projectPath, async () => {
    const enrichmentFile = await readEnrichmentFile(projectPath);
    const now = new Date().toISOString();

    for (const issue of issues) {
      const key = String(issue.number);
      const enrichment = enrichmentFile.issues[key];
      if (!enrichment) continue;

      // Closed on GitHub but not done in enrichment → mark done
      if (issue.state === 'closed' && enrichment.triageState !== 'done') {
        const from = enrichment.triageState;
        enrichment.triageState = 'done';
        enrichment.resolution = enrichment.resolution ?? 'completed';
        enrichment.updatedAt = now;

        await appendTransition(projectPath, {
          issueNumber: issue.number,
          from,
          to: 'done',
          actor: 'auto-reconcile',
          reason: 'GitHub state diverged',
          resolution: enrichment.resolution,
          timestamp: now,
        });
      }

      // Open on GitHub but done in enrichment → reopen to ready (GAP-2)
      if (issue.state === 'open' && enrichment.triageState === 'done') {
        enrichment.triageState = 'ready';
        enrichment.resolution = undefined;
        enrichment.updatedAt = now;

        await appendTransition(projectPath, {
          issueNumber: issue.number,
          from: 'done',
          to: 'ready',
          actor: 'auto-reconcile',
          reason: 'GitHub state diverged',
          timestamp: now,
        });
      }
    }

    await writeEnrichmentFile(projectPath, enrichmentFile);
    return enrichmentFile;
  });
}

// ============================================
// Garbage Collection
// ============================================

export async function runGarbageCollection(
  projectPath: string,
  currentIssueNumbers: number[],
): Promise<{ pruned: number; orphaned: number }> {
  // Safety: don't wipe enrichment if GitHub returns 0 issues
  if (currentIssueNumbers.length === 0) {
    return { pruned: 0, orphaned: 0 };
  }

  return withEnrichmentFileLock(projectPath, async () => {
    const enrichmentFile = await readEnrichmentFile(projectPath);
    const currentSet = new Set(currentIssueNumbers.map(String));
    const now = new Date();
    let pruned = 0;
    let orphaned = 0;

    for (const [key, enrichment] of Object.entries(enrichmentFile.issues)) {
      if (!currentSet.has(key)) {
        // Mark as orphaned if not already
        if (!(enrichment as IssueEnrichment & { _orphanedAt?: string })._orphanedAt) {
          (enrichment as IssueEnrichment & { _orphanedAt?: string })._orphanedAt = now.toISOString();
          orphaned++;
        } else {
          // Check if orphan is old enough to prune
          const orphanedAt = new Date(
            (enrichment as IssueEnrichment & { _orphanedAt?: string })._orphanedAt!,
          );
          const daysSinceOrphan = (now.getTime() - orphanedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceOrphan > 30) {
            delete enrichmentFile.issues[key];
            pruned++;
          } else {
            orphaned++;
          }
        }
      } else {
        // Not orphaned — clear orphan marker if present
        delete (enrichment as IssueEnrichment & { _orphanedAt?: string })._orphanedAt;
      }
    }

    await writeEnrichmentFile(projectPath, enrichmentFile);
    return { pruned, orphaned };
  });
}
