/**
 * Merge Orchestrator
 * ==================
 *
 * Main coordinator for the intent-aware merge system.
 * See apps/desktop/src/main/ai/merge/orchestrator.ts for the TypeScript implementation.
 *
 * Orchestrates the complete merge pipeline:
 * 1. Load file evolution data (baselines + task changes)
 * 2. Analyze semantic changes from each task
 * 3. Detect conflicts between tasks
 * 4. Apply deterministic merges where possible (AutoMerger)
 * 5. Call AI resolver for ambiguous conflicts (merge-resolver.ts)
 * 6. Produce final merged content and detailed report
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { AutoMerger, type MergeContext } from './auto-merger';
import { ConflictDetector } from './conflict-detector';
import { FileEvolutionTracker } from './file-evolution';
import {
  MergeDecision,
  MergeStrategy,
  type ConflictRegion,
  type FileAnalysis,
  type MergeResult,
  type TaskSnapshot,
  createFileAnalysis,
  getTaskSnapshot,
} from './types';

// =============================================================================
// Types
// =============================================================================

export interface TaskMergeRequest {
  taskId: string;
  worktreePath?: string;
  priority: number;
}

export interface MergeStats {
  filesProcessed: number;
  filesAutoMerged: number;
  filesAiMerged: number;
  filesNeedReview: number;
  filesFailed: number;
  conflictsDetected: number;
  conflictsAutoResolved: number;
  conflictsAiResolved: number;
  aiCallsMade: number;
  estimatedTokensUsed: number;
  durationMs: number;
}

export interface MergeReport {
  success: boolean;
  startedAt: Date;
  completedAt?: Date;
  tasksMerged: string[];
  fileResults: Map<string, MergeResult>;
  stats: MergeStats;
  error?: string;
}

export type ProgressStage =
  | 'analyzing'
  | 'detecting_conflicts'
  | 'resolving'
  | 'validating'
  | 'complete'
  | 'error';

export type ProgressCallback = (
  stage: ProgressStage,
  percent: number,
  message: string,
  details?: Record<string, unknown>,
) => void;

// =============================================================================
// AI resolver type (provided by caller — bridges to merge-resolver.ts)
// =============================================================================

export type AiResolverFn = (
  system: string,
  user: string,
) => Promise<string>;

// =============================================================================
// Git utility
// =============================================================================

function getFileFromBranch(
  projectDir: string,
  filePath: string,
  branch: string,
): string | undefined {
  const result = spawnSync('git', ['show', `${branch}:${filePath}`], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  if (result.status === 0) return result.stdout;
  return undefined;
}

function findWorktree(projectDir: string, taskId: string): string | undefined {
  // Common worktree locations
  const candidates = [
    path.join(projectDir, '.auto-claude', 'worktrees', taskId),
    path.join(projectDir, '.auto-claude', 'worktrees', 'tasks', taskId),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

// =============================================================================
// Merge pipeline
// =============================================================================

function buildFileAnalysis(filePath: string, snapshot: TaskSnapshot): FileAnalysis {
  const analysis = createFileAnalysis(filePath);
  analysis.changes = snapshot.semanticChanges;
  for (const change of snapshot.semanticChanges) {
    if (change.changeType.startsWith('add_function')) analysis.functionsAdded.add(change.target);
    if (change.changeType.startsWith('modify_function')) analysis.functionsModified.add(change.target);
  }
  return analysis;
}

async function mergeWithAi(
  aiResolver: AiResolverFn,
  filePath: string,
  baselineContent: string,
  taskContents: string[],
  conflicts: ConflictRegion[],
): Promise<MergeResult> {
  const systemPrompt = `You are a code merge expert. You need to merge changes from multiple tasks into a single coherent file.
Preserve all intended functionality from each task. Return ONLY the merged file content, no explanation.`;

  const conflictSummary = conflicts
    .map((c) => `- ${c.location}: ${c.reason} (severity: ${c.severity})`)
    .join('\n');

  const userPrompt = `Merge the following versions of ${filePath}:

BASELINE:
\`\`\`
${baselineContent}
\`\`\`

${taskContents.map((content, i) => `TASK ${i + 1} VERSION:\n\`\`\`\n${content}\n\`\`\``).join('\n\n')}

CONFLICTS TO RESOLVE:
${conflictSummary}

Return the merged file content:`;

  try {
    const merged = await aiResolver(systemPrompt, userPrompt);
    if (merged.trim()) {
      return {
        decision: MergeDecision.AI_MERGED,
        filePath,
        mergedContent: merged.trim(),
        conflictsResolved: conflicts,
        conflictsRemaining: [],
        aiCallsMade: 1,
        tokensUsed: 0,
        explanation: `AI merged ${conflicts.length} conflicts`,
      };
    }
  } catch {
    // Fall through to failed
  }

  return {
    decision: MergeDecision.NEEDS_HUMAN_REVIEW,
    filePath,
    conflictsResolved: [],
    conflictsRemaining: conflicts,
    aiCallsMade: 1,
    tokensUsed: 0,
    explanation: 'AI merge failed - needs human review',
  };
}

function createEmptyStats(): MergeStats {
  return {
    filesProcessed: 0,
    filesAutoMerged: 0,
    filesAiMerged: 0,
    filesNeedReview: 0,
    filesFailed: 0,
    conflictsDetected: 0,
    conflictsAutoResolved: 0,
    conflictsAiResolved: 0,
    aiCallsMade: 0,
    estimatedTokensUsed: 0,
    durationMs: 0,
  };
}

function updateStats(stats: MergeStats, result: MergeResult): void {
  stats.filesProcessed++;
  stats.aiCallsMade += result.aiCallsMade;
  stats.estimatedTokensUsed += result.tokensUsed;
  stats.conflictsDetected += result.conflictsResolved.length + result.conflictsRemaining.length;
  stats.conflictsAutoResolved += result.conflictsResolved.length;

  if (result.decision === MergeDecision.AUTO_MERGED || result.decision === MergeDecision.DIRECT_COPY) {
    stats.filesAutoMerged++;
  } else if (result.decision === MergeDecision.AI_MERGED) {
    stats.filesAiMerged++;
    stats.conflictsAiResolved += result.conflictsResolved.length;
  } else if (result.decision === MergeDecision.NEEDS_HUMAN_REVIEW) {
    stats.filesNeedReview++;
  } else if (result.decision === MergeDecision.FAILED) {
    stats.filesFailed++;
  }
}

// =============================================================================
// MergeOrchestrator
// =============================================================================

/**
 * Orchestrates the complete merge pipeline.
 *
 * Main entry point for merging task changes. Coordinates all components
 * to produce merged content with maximum automation and detailed reporting.
 */
export class MergeOrchestrator {
  private readonly projectDir: string;
  private readonly storageDir: string;
  private readonly enableAi: boolean;
  private readonly dryRun: boolean;
  private readonly aiResolver?: AiResolverFn;

  readonly evolutionTracker: FileEvolutionTracker;
  readonly conflictDetector: ConflictDetector;
  readonly autoMerger: AutoMerger;

  constructor(options: {
    projectDir: string;
    storageDir?: string;
    enableAi?: boolean;
    aiResolver?: AiResolverFn;
    dryRun?: boolean;
  }) {
    this.projectDir = path.resolve(options.projectDir);
    this.storageDir = options.storageDir ?? path.join(this.projectDir, '.auto-claude');
    this.enableAi = options.enableAi ?? true;
    this.dryRun = options.dryRun ?? false;
    this.aiResolver = options.aiResolver;

    this.evolutionTracker = new FileEvolutionTracker(this.projectDir, this.storageDir);
    this.conflictDetector = new ConflictDetector();
    this.autoMerger = new AutoMerger();
  }

  // ==========================================================================
  // Merge a single task
  // ==========================================================================

  async mergeTask(
    taskId: string,
    worktreePath?: string,
    targetBranch = 'main',
    progressCallback?: ProgressCallback,
  ): Promise<MergeReport> {
    const report: MergeReport = {
      success: false,
      startedAt: new Date(),
      tasksMerged: [taskId],
      fileResults: new Map(),
      stats: createEmptyStats(),
    };

    const startTime = Date.now();

    const emit = (stage: ProgressStage, percent: number, message: string, details?: Record<string, unknown>) => {
      progressCallback?.(stage, percent, message, details);
    };

    try {
      emit('analyzing', 0, 'Starting merge analysis');

      // Find worktree if not provided
      let resolvedWorktreePath = worktreePath;
      if (!resolvedWorktreePath) {
        resolvedWorktreePath = findWorktree(this.projectDir, taskId);
        if (!resolvedWorktreePath) {
          report.error = `Could not find worktree for task ${taskId}`;
          emit('error', 0, report.error);
          return report;
        }
      }

      emit('analyzing', 5, 'Loading file evolution data');
      this.evolutionTracker.refreshFromGit(taskId, resolvedWorktreePath, targetBranch);

      emit('analyzing', 15, 'Running semantic analysis');
      const modifications = this.evolutionTracker.getTaskModifications(taskId);

      if (modifications.length === 0) {
        emit('complete', 100, 'No modifications found');
        report.completedAt = new Date();
        report.success = true;
        return report;
      }

      emit('analyzing', 25, `Found ${modifications.length} modified files`);
      emit('detecting_conflicts', 25, 'Detecting conflicts');

      const totalFiles = modifications.length;
      for (let idx = 0; idx < modifications.length; idx++) {
        const [filePath, snapshot] = modifications[idx];
        const filePercent = 50 + Math.floor(((idx + 1) / Math.max(totalFiles, 1)) * 25);

        emit('resolving', filePercent, `Merging file ${idx + 1}/${totalFiles}`, { current_file: filePath });

        const result = await this.mergeFile(filePath, [snapshot], targetBranch);

        // Handle DIRECT_COPY
        if (result.decision === MergeDecision.DIRECT_COPY) {
          const worktreeFile = path.join(resolvedWorktreePath, filePath);
          if (fs.existsSync(worktreeFile)) {
            try {
              result.mergedContent = fs.readFileSync(worktreeFile, 'utf8');
            } catch {
              result.decision = MergeDecision.FAILED;
              result.error = 'Worktree file not found for DIRECT_COPY';
            }
          } else {
            result.decision = MergeDecision.FAILED;
            result.error = 'Worktree file not found for DIRECT_COPY';
          }
        }

        report.fileResults.set(filePath, result);
        updateStats(report.stats, result);
      }

      emit('validating', 75, 'Validating merge results', {
        conflicts_found: report.stats.conflictsDetected,
        conflicts_resolved: report.stats.conflictsAutoResolved,
      });

      report.success = report.stats.filesFailed === 0;
      emit('validating', 90, 'Validation complete');

    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      emit('error', 0, `Merge failed: ${report.error}`);
    }

    report.completedAt = new Date();
    report.stats.durationMs = Date.now() - startTime;

    if (!this.dryRun) {
      this.saveReport(report, taskId);
    }

    if (report.success) {
      emit('complete', 100, `Merge complete for ${taskId}`, {
        conflicts_found: report.stats.conflictsDetected,
        conflicts_resolved: report.stats.conflictsAutoResolved,
      });
    }

    return report;
  }

  // ==========================================================================
  // Merge multiple tasks
  // ==========================================================================

  async mergeTasks(
    requests: TaskMergeRequest[],
    targetBranch = 'main',
    progressCallback?: ProgressCallback,
  ): Promise<MergeReport> {
    const report: MergeReport = {
      success: false,
      startedAt: new Date(),
      tasksMerged: requests.map((r) => r.taskId),
      fileResults: new Map(),
      stats: createEmptyStats(),
    };

    const startTime = Date.now();

    const emit = (stage: ProgressStage, percent: number, message: string, details?: Record<string, unknown>) => {
      progressCallback?.(stage, percent, message, details);
    };

    try {
      emit('analyzing', 0, `Starting merge analysis for ${requests.length} tasks`);

      const sorted = [...requests].sort((a, b) => b.priority - a.priority);

      emit('analyzing', 5, 'Loading file evolution data');
      for (const request of sorted) {
        if (request.worktreePath && fs.existsSync(request.worktreePath)) {
          this.evolutionTracker.refreshFromGit(request.taskId, request.worktreePath, targetBranch);
        }
      }

      emit('analyzing', 15, 'Running semantic analysis');
      const taskIds = sorted.map((r) => r.taskId);
      const fileTasks = this.evolutionTracker.getFilesModifiedByTasks(taskIds);

      emit('analyzing', 25, `Found ${fileTasks.size} files to merge`);
      emit('detecting_conflicts', 25, 'Detecting conflicts across tasks');

      const totalFiles = fileTasks.size;
      let idx = 0;

      for (const [filePath, modifyingTaskIds] of fileTasks) {
        const filePercent = 50 + Math.floor((idx / Math.max(totalFiles, 1)) * 25);
        emit('resolving', filePercent, `Merging file ${idx + 1}/${totalFiles}`, { current_file: filePath });

        const evolution = this.evolutionTracker.getFileEvolution(filePath);
        if (!evolution) { idx++; continue; }

        const snapshots: TaskSnapshot[] = modifyingTaskIds
          .map((tid) => getTaskSnapshot(evolution, tid))
          .filter((s): s is TaskSnapshot => s !== undefined);

        if (snapshots.length === 0) { idx++; continue; }

        const result = await this.mergeFile(filePath, snapshots, targetBranch);

        // Handle DIRECT_COPY for multi-task merge
        if (result.decision === MergeDecision.DIRECT_COPY) {
          let found = false;
          for (const tid of modifyingTaskIds) {
            const req = sorted.find((r) => r.taskId === tid);
            if (req?.worktreePath) {
              const worktreeFile = path.join(req.worktreePath, filePath);
              if (fs.existsSync(worktreeFile)) {
                try {
                  result.mergedContent = fs.readFileSync(worktreeFile, 'utf8');
                  found = true;
                } catch {
                  // Skip
                }
                break;
              }
            }
          }
          if (!found) {
            result.decision = MergeDecision.FAILED;
            result.error = 'Worktree file not found for DIRECT_COPY';
          }
        }

        report.fileResults.set(filePath, result);
        updateStats(report.stats, result);
        idx++;
      }

      emit('validating', 75, 'Validating merge results', {
        conflicts_found: report.stats.conflictsDetected,
        conflicts_resolved: report.stats.conflictsAutoResolved,
      });

      report.success = report.stats.filesFailed === 0;
      emit('validating', 90, 'Validation complete');

    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      emit('error', 0, `Merge failed: ${report.error}`);
    }

    report.completedAt = new Date();
    report.stats.durationMs = Date.now() - startTime;

    if (!this.dryRun) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.saveReport(report, `multi_${timestamp}`);
    }

    if (report.success) {
      emit('complete', 100, `Merge complete for ${requests.length} tasks`, {
        conflicts_found: report.stats.conflictsDetected,
        conflicts_resolved: report.stats.conflictsAutoResolved,
      });
    }

    return report;
  }

  // ==========================================================================
  // Merge a single file
  // ==========================================================================

  private async mergeFile(
    filePath: string,
    taskSnapshots: TaskSnapshot[],
    targetBranch: string,
  ): Promise<MergeResult> {
    // Get baseline content
    let baselineContent = this.evolutionTracker.getBaselineContent(filePath);
    if (!baselineContent) {
      baselineContent = getFileFromBranch(this.projectDir, filePath, targetBranch);
    }
    if (!baselineContent) {
      baselineContent = '';
    }

    // Build analyses for conflict detection
    const taskAnalyses = new Map<string, FileAnalysis>();
    for (const snapshot of taskSnapshots) {
      taskAnalyses.set(snapshot.taskId, buildFileAnalysis(filePath, snapshot));
    }

    // Detect conflicts
    const conflicts = this.conflictDetector.detectConflicts(taskAnalyses);

    // If no conflicts or all are auto-mergeable, try auto-merge
    if (conflicts.length === 0 && taskSnapshots.length === 1) {
      // Single task, no conflicts — direct copy
      return {
        decision: MergeDecision.DIRECT_COPY,
        filePath,
        conflictsResolved: [],
        conflictsRemaining: [],
        aiCallsMade: 0,
        tokensUsed: 0,
        explanation: 'Single task modification - direct copy',
      };
    }

    const autoMergeableConflicts = conflicts.filter((c) => c.canAutoMerge);
    const hardConflicts = conflicts.filter((c) => !c.canAutoMerge);

    // Try auto-merge for compatible conflicts
    if (autoMergeableConflicts.length > 0 && hardConflicts.length === 0) {
      // Pick the strategy from the first conflict
      const strategy = autoMergeableConflicts[0]?.mergeStrategy ?? MergeStrategy.APPEND_FUNCTIONS;

      const context: MergeContext = {
        filePath,
        baselineContent,
        taskSnapshots,
        conflict: autoMergeableConflicts[0],
      };

      if (this.autoMerger.canHandle(strategy)) {
        const result = this.autoMerger.merge(context, strategy);
        result.conflictsResolved = autoMergeableConflicts;
        return result;
      }
    }

    // Handle hard conflicts with AI if enabled
    if (hardConflicts.length > 0 && this.enableAi && this.aiResolver) {
      // Get task content from snapshots
      const taskContents = taskSnapshots
        .map((s) => {
          // Find the file in the worktree if we have the content
          return s.rawDiff ? `(diff available)` : baselineContent ?? '';
        });

      return mergeWithAi(this.aiResolver, filePath, baselineContent, taskContents, hardConflicts);
    }

    // Multiple tasks, no auto-merge possible — flag for review
    if (hardConflicts.length > 0) {
      return {
        decision: MergeDecision.NEEDS_HUMAN_REVIEW,
        filePath,
        conflictsResolved: autoMergeableConflicts,
        conflictsRemaining: hardConflicts,
        aiCallsMade: 0,
        tokensUsed: 0,
        explanation: `${hardConflicts.length} hard conflicts need human review`,
      };
    }

    // No conflicts at all — direct copy from last task
    return {
      decision: MergeDecision.DIRECT_COPY,
      filePath,
      conflictsResolved: [],
      conflictsRemaining: [],
      aiCallsMade: 0,
      tokensUsed: 0,
      explanation: 'No conflicts detected - direct copy',
    };
  }

  // ==========================================================================
  // Preview and utility methods
  // ==========================================================================

  previewMerge(taskIds: string[]): Record<string, unknown> {
    const fileTasks = this.evolutionTracker.getFilesModifiedByTasks(taskIds);
    const conflicting = this.evolutionTracker.getConflictingFiles(taskIds);

    const preview: {
      tasks: string[];
      files_to_merge: string[];
      files_with_potential_conflicts: string[];
      conflicts: Array<Record<string, unknown>>;
      summary: Record<string, number>;
    } = {
      tasks: taskIds,
      files_to_merge: [...fileTasks.keys()],
      files_with_potential_conflicts: conflicting,
      conflicts: [],
      summary: {},
    };

    for (const filePath of conflicting) {
      const evolution = this.evolutionTracker.getFileEvolution(filePath);
      if (!evolution) continue;

      const analyses = new Map<string, FileAnalysis>();
      for (const snapshot of evolution.taskSnapshots) {
        if (taskIds.includes(snapshot.taskId)) {
          analyses.set(snapshot.taskId, buildFileAnalysis(filePath, snapshot));
        }
      }

      const conflicts = this.conflictDetector.detectConflicts(analyses);
      for (const c of conflicts) {
        preview.conflicts.push({
          file: c.filePath,
          location: c.location,
          tasks: c.tasksInvolved,
          severity: c.severity,
          can_auto_merge: c.canAutoMerge,
          strategy: c.mergeStrategy ?? null,
          reason: c.reason,
        });
      }
    }

    preview.summary = {
      total_files: fileTasks.size,
      conflict_files: conflicting.length,
      total_conflicts: preview.conflicts.length,
      auto_mergeable: preview.conflicts.filter((c) => c['can_auto_merge']).length,
    };

    return preview;
  }

  writeMergedFiles(report: MergeReport, outputDir?: string): string[] {
    if (this.dryRun) return [];

    const dir = outputDir ?? path.join(this.storageDir, 'merge_output');
    fs.mkdirSync(dir, { recursive: true });

    const written: string[] = [];
    for (const [filePath, result] of report.fileResults) {
      if (result.mergedContent !== undefined) {
        const outPath = path.join(dir, filePath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, result.mergedContent, 'utf8');
        written.push(outPath);
      }
    }

    return written;
  }

  applyToProject(report: MergeReport): boolean {
    if (this.dryRun) return true;

    let success = true;
    for (const [filePath, result] of report.fileResults) {
      if (result.mergedContent && result.decision !== MergeDecision.FAILED) {
        const targetPath = path.join(this.projectDir, filePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        try {
          fs.writeFileSync(targetPath, result.mergedContent, 'utf8');
        } catch {
          success = false;
        }
      }
    }
    return success;
  }

  private saveReport(report: MergeReport, name: string): void {
    const reportsDir = path.join(this.storageDir, 'merge_reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `${name}_${timestamp}.json`);

    const data = {
      success: report.success,
      started_at: report.startedAt.toISOString(),
      completed_at: report.completedAt?.toISOString(),
      tasks_merged: report.tasksMerged,
      stats: report.stats,
      error: report.error,
      file_results: Object.fromEntries(
        [...report.fileResults.entries()].map(([fp, result]) => [fp, {
          decision: result.decision,
          explanation: result.explanation,
          error: result.error,
          conflicts_resolved: result.conflictsResolved.length,
          conflicts_remaining: result.conflictsRemaining.length,
        }])
      ),
    };

    try {
      fs.writeFileSync(reportPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  }
}
