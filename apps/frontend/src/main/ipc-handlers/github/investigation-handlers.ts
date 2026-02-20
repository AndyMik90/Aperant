/**
 * GitHub issue investigation IPC handlers
 *
 * Handles the full investigation lifecycle:
 * - Start investigation (spawn Python orchestrator subprocess)
 * - Cancel investigation (kill running subprocess)
 * - Queue management for parallel investigation limits
 * - Create task from investigation report
 * - Dismiss issue
 * - Post investigation results to GitHub
 * - Get/save investigation settings
 *
 * Also retains the legacy GITHUB_INVESTIGATE_ISSUE handler for backwards
 * compatibility with the old one-shot investigation flow.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { IPC_CHANNELS, MODEL_ID_MAP, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING, DEFAULT_INVESTIGATION_MODELS, DEFAULT_INVESTIGATION_THINKING, AUTO_BUILD_PATHS, getSpecsDir } from '../../../shared/constants';
import type {
  GitHubInvestigationResult,
  GitHubInvestigationStatus,
  InvestigationProgress,
  InvestigationResult,
  InvestigationReport,
  InvestigationSettings,
  InvestigationDismissReason,
  InvestigationAgentType,
  InvestigationLogs,
  InvestigationLogEntry,
} from '../../../shared/types';
import type { AuthFailureInfo } from '../../../shared/types/terminal';
import type { AppSettings } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { writeJsonWithRetry } from '../../utils/atomic-file';
import { readSettingsFile } from '../../settings-utils';
import { AgentManager } from '../../agent';
import { getGitHubConfig, githubFetch } from './utils';
import type { GitHubAPIComment } from './types';
import { createSpecForIssue, buildIssueContext, buildInvestigationTask, updateImplementationPlanStatus } from './spec-utils';
import { withSpecNumberLock } from '../../utils/spec-number-lock';
import { createContextLogger } from './utils/logger';
import { withProjectOrNull } from './utils/project-middleware';
import { createIPCCommunicators } from './utils/ipc-communicator';
import { getRunnerEnv } from './utils/runner-env';
import {
  runPythonSubprocess,
  getPythonPath,
  getRunnerPath,
  validateGitHubModule,
  buildRunnerArgs,
  parseJSONFromOutput,
} from './utils/subprocess-runner';
import { killProcessGracefully } from '../../platform';

const { debug: debugLog } = createContextLogger('Investigation');

// ============================================
// Activity Log Persistence
// ============================================

interface ActivityLogEntry {
  event: string;
  timestamp: string;
}

/**
 * Get the path to an issue's activity log file.
 */
function getActivityLogPath(projectPath: string, issueNumber: number): string {
  return path.join(projectPath, '.auto-claude', 'issues', String(issueNumber), 'activity_log.json');
}

/**
 * Append an activity log entry to disk for an issue.
 * Creates the file if it doesn't exist. Capped at 100 entries.
 */
function appendActivityLogEntry(projectPath: string, issueNumber: number, event: string): void {
  try {
    const logPath = getActivityLogPath(projectPath, issueNumber);
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let entries: ActivityLogEntry[] = [];
    if (fs.existsSync(logPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
        if (Array.isArray(data)) entries = data;
      } catch {
              // Corrupt file, start fresh
      }
    }

    entries.push({ event, timestamp: new Date().toISOString() });

    // Cap at 100 entries
    if (entries.length > 100) {
      entries = entries.slice(-100);
    }

    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    debugLog('Failed to append activity log entry', {
      issueNumber,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Load the persisted activity log for an issue.
 */
function loadActivityLog(projectPath: string, issueNumber: number): ActivityLogEntry[] {
  try {
    const logPath = getActivityLogPath(projectPath, issueNumber);
    if (!fs.existsSync(logPath)) return [];
    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
          return [];
  }
}

// ============================================
// Investigation Log Collection (Live Agent Output)
// ============================================

/**
 * Known investigation agent types for mapping prefixes to agent buckets.
 */
const INVESTIGATION_AGENT_NAMES: Record<string, InvestigationAgentType> = {
  root_cause: 'root_cause',
  impact: 'impact',
  fix_advisor: 'fix_advisor',
  reproducer: 'reproducer',
};

/**
 * Parse an investigation log line to extract agent type and content.
 *
 * The backend outputs lines in several prefix formats:
 *   [Investigation:root_cause] ...   → specialist via process_sdk_stream context_name
 *   [IssueInvestigation] ...         → orchestrator coordination messages
 *   [Agent:root_cause] ...           → subagent Task tool results
 *   [DEBUG Investigation:root_cause] → debug-mode lines (skipped)
 *   [DEBUG IssueInvestigation] ...   → debug-mode orchestrator (skipped)
 *
 * All lines from sdk_utils.py follow `[context_name] content` format.
 */
function parseInvestigationLogLine(line: string): {
  agentType: InvestigationAgentType | 'orchestrator';
  content: string;
  isError: boolean;
  isTool: boolean;
  toolName?: string;
  thinkingPreview?: string;
  thinkingChars?: number;
  isStructured?: boolean;
  lifecycleEvent?: 'started' | 'done' | 'failed';
  lifecycleError?: string;
} | null {
  // Try JSON-structured events first (emitted by emit_json_event in investigation_hooks.py)
  if (line.startsWith('{')) {
    try {
      const event = JSON.parse(line) as {
        event?: string;
        agent?: string;
        tool?: string;
        detail?: string;
        chars?: number;
        preview?: string;
        success?: boolean;
        error?: string;
      };
      if (event.event && event.agent) {
        const agentType = INVESTIGATION_AGENT_NAMES[event.agent] ?? 'orchestrator';
        const isError = event.event === 'tool_end' && event.success === false;
        const isTool = event.event === 'tool_start' || event.event === 'tool_end';

        let content = '';

        // Lifecycle events: agent_started, agent_done
        if (event.event === 'agent_started') {
          content = 'Agent started';
          return {
            agentType: agentType as InvestigationAgentType | 'orchestrator',
            content,
            isError: false,
            isTool: false,
            isStructured: true,
            lifecycleEvent: 'started' as const,
          };
        }
        if (event.event === 'agent_done') {
          const doneSuccess = event.success !== false;
          content = doneSuccess ? 'Agent completed' : `Agent failed: ${event.error ?? 'unknown'}`;
          return {
            agentType: agentType as InvestigationAgentType | 'orchestrator',
            content,
            isError: !doneSuccess,
            isTool: false,
            isStructured: true,
            lifecycleEvent: (doneSuccess ? 'done' : 'failed') as 'done' | 'failed',
            lifecycleError: event.error,
          };
        }

        if (event.event === 'thinking') {
          content = `Thinking (${event.chars?.toLocaleString() ?? '?'} chars)`;
        } else if (event.event === 'tool_start') {
          content = event.detail ?? `Using ${event.tool}`;
        } else if (event.event === 'tool_end') {
          content = event.success
            ? `${event.tool ?? 'Tool'} done`
            : `${event.tool ?? 'Tool'} failed${event.error ? `: ${event.error}` : ''}`;
        }

        return {
          agentType: agentType as InvestigationAgentType | 'orchestrator',
          content,
          isError,
          isTool,
          toolName: event.tool,
          thinkingPreview: event.preview,
          thinkingChars: event.chars,
          isStructured: true,
        };
      }
    } catch {
            // Not valid JSON, fall through to bracket parsing
    }
  }

  // Skip debug-prefixed lines (noisy, not useful for UI)
  if (line.startsWith('[DEBUG ')) return null;

  // Generic bracket-prefix extraction: [PREFIX] CONTENT
  const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!bracketMatch) return null;

  const prefix = bracketMatch[1];
  const content = bracketMatch[2];
  const isError = /^ERROR\b/i.test(content) || /\bERROR:/i.test(content);
  const isTool = /^Tool:\s/.test(content) || /^Invoking agent:/i.test(content);

  // [Investigation:agent_type] — primary specialist prefix
  const investigationMatch = prefix.match(/^Investigation:(root_cause|impact|fix_advisor|reproducer)$/);
  if (investigationMatch) {
    return {
      agentType: investigationMatch[1] as InvestigationAgentType,
      content,
      isError,
      isTool,
    };
  }

  // [Agent:agent_name] — subagent Task tool results from sdk_utils.py
  const agentMatch = prefix.match(/^Agent:(\w+)$/);
  if (agentMatch) {
    const agentType = INVESTIGATION_AGENT_NAMES[agentMatch[1]];
    if (agentType) {
      return { agentType, content, isError, isTool };
    }
  }

  // [IssueInvestigation] — orchestrator
  if (prefix === 'IssueInvestigation') {
    return { agentType: 'orchestrator', content, isError, isTool };
  }

  return null;
}

/**
 * Get the path where investigation logs are stored on disk.
 */
function getInvestigationLogsPath(projectPath: string, issueNumber: number): string {
  return path.join(projectPath, '.auto-claude', 'issues', String(issueNumber), 'investigation_logs.json');
}

/**
 * Collects investigation subprocess stdout, parses agent prefixes,
 * and periodically saves logs to disk + pushes IPC events.
 *
 * Modeled after PRLogCollector in pr-handlers.ts.
 */
class InvestigationLogCollector {
  private logs: InvestigationLogs;
  private projectPath: string;
  private entryCount = 0;
  private saveInterval = 3;
  private mainWindow: BrowserWindow | null;
  private projectId: string;

  constructor(
    projectPath: string,
    projectId: string,
    issueNumber: number,
    mainWindow: BrowserWindow | null,
  ) {
    this.projectPath = projectPath;
    this.projectId = projectId;
    this.mainWindow = mainWindow;

    const now = new Date().toISOString();
    this.logs = {
      issueNumber,
      createdAt: now,
      updatedAt: now,
      agents: {
        orchestrator: { agentType: 'orchestrator', status: 'pending', entries: [] },
        root_cause: { agentType: 'root_cause', status: 'pending', entries: [] },
        impact: { agentType: 'impact', status: 'pending', entries: [] },
        fix_advisor: { agentType: 'fix_advisor', status: 'pending', entries: [] },
        reproducer: { agentType: 'reproducer', status: 'pending', entries: [] },
      },
    };

    // Save initial empty structure so frontend can load it immediately
    this.save();
  }

  processLine(line: string): void {
    const parsed = parseInvestigationLogLine(line);
    if (!parsed) return;

    // Handle lifecycle events from backend
    if (parsed.lifecycleEvent) {
      const lifecycleAgent = this.logs.agents[parsed.agentType];
      if (parsed.lifecycleEvent === 'started') {
        lifecycleAgent.status = 'active';
        lifecycleAgent.startedAt = new Date().toISOString();
        lifecycleAgent.error = undefined;
      } else if (parsed.lifecycleEvent === 'done') {
        lifecycleAgent.status = 'completed';
        lifecycleAgent.completedAt = new Date().toISOString();
        lifecycleAgent.error = undefined;
      } else if (parsed.lifecycleEvent === 'failed') {
        lifecycleAgent.status = 'failed';
        lifecycleAgent.completedAt = new Date().toISOString();
        lifecycleAgent.error = parsed.lifecycleError ?? 'unknown';
      }
      this.save();
      return; // lifecycle events are metadata, not log entries
    }

    const agent = this.logs.agents[parsed.agentType];
    const wasNotActive = agent.status !== 'active';

    // Activate agent on first log entry
    if (agent.status === 'pending') {
      agent.status = 'active';
    }

    let entryType: InvestigationLogEntry['type'] = 'text';
    if (parsed.isError) entryType = 'error';
    else if (parsed.thinkingChars) entryType = 'thinking';
    else if (parsed.isTool) entryType = 'tool_start';

    const entry: InvestigationLogEntry = {
      timestamp: new Date().toISOString(),
      type: entryType,
      content: parsed.content,
      agentType: parsed.agentType,
      source: parsed.agentType,
      toolName: parsed.toolName,
      thinkingPreview: parsed.thinkingPreview,
      thinkingChars: parsed.thinkingChars,
      isStructured: parsed.isStructured,
    };

    agent.entries.push(entry);
    this.entryCount++;

    // Save immediately on agent activation, or every N entries
    if (wasNotActive || this.entryCount % this.saveInterval === 0) {
      this.save();
    }
  }

  save(): void {
    try {
      this.logs.updatedAt = new Date().toISOString();
      const logsPath = getInvestigationLogsPath(this.projectPath, this.logs.issueNumber);
      const dir = path.dirname(logsPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(logsPath, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err) {
      debugLog('Failed to save investigation logs', {
        issueNumber: this.logs.issueNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Push IPC event to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        IPC_CHANNELS.GITHUB_INVESTIGATION_LOGS_UPDATED,
        this.projectId,
        {
          issueNumber: this.logs.issueNumber,
          entryCount: this.entryCount,
        },
      );
    }
  }

  finalize(success: boolean): void {
    for (const agent of Object.values(this.logs.agents)) {
      // Skip agents already marked by lifecycle events
      if (agent.status === 'completed' || agent.status === 'failed') {
        continue;
      }
      if (success) {
        agent.status = 'completed';
        agent.completedAt = new Date().toISOString();
        agent.error = undefined;
      } else if (agent.status === 'active') {
        agent.status = 'failed';
        agent.completedAt = new Date().toISOString();
        agent.error = agent.error ?? 'Unknown investigation failure';
      }
      // On failure, pending agents stay pending (they never started)
    }
    this.save();
  }
}

// ============================================
// Python → TypeScript Report Transformation
// ============================================

/**
 * Transform a raw Python investigation report (snake_case Pydantic output)
 * into the TypeScript InvestigationReport shape (camelCase).
 *
 * The Python backend uses Pydantic model_dump(mode="json") which outputs
 * snake_case keys. The frontend types use camelCase. This function bridges
 * the two schemas.
 */
function transformPythonReport(raw: Record<string, unknown>): InvestigationReport {
  const codePathsToRefs = (paths: unknown[]) =>
    (paths ?? []).map((p: unknown) => {
      const cp = p as Record<string, unknown>;
      return {
        file: (cp.file as string) ?? '',
        line: cp.start_line as number | undefined,
        endLine: cp.end_line as number | undefined,
        description: (cp.description as string) ?? '',
      };
    });

  const transformAgent = (
    agentType: string,
    data: unknown,
  ): { agentType: string; summary: string; findings: string[]; codeReferences: ReturnType<typeof codePathsToRefs> } => {
    if (!data || typeof data !== 'object') {
      return { agentType, summary: '', findings: [], codeReferences: [] };
    }
    const d = data as Record<string, unknown>;

    // Each Python specialist has different field structures — extract summary/findings generically
    let summary = '';
    const findings: string[] = [];

    if (agentType === 'root_cause') {
      summary = (d.identified_root_cause as string) ?? '';
      if (d.evidence) findings.push(d.evidence as string);
      for (const ri of (d.related_issues as string[]) ?? []) findings.push(ri);
    } else if (agentType === 'impact') {
      summary = `Severity: ${d.severity ?? 'unknown'}. ${(d.blast_radius as string) ?? ''}`;
      if (d.user_impact) findings.push(`User impact: ${d.user_impact}`);
      if (d.regression_risk) findings.push(`Regression risk: ${d.regression_risk}`);
      for (const ac of (d.affected_components as Array<Record<string, unknown>>) ?? []) {
        findings.push(`${ac.component}: ${ac.description}`);
      }
    } else if (agentType === 'fix_advisor') {
      const approaches = (d.approaches as Array<Record<string, unknown>>) ?? [];
      const recIdx = (d.recommended_approach as number) ?? 0;
      const rec = approaches[recIdx];
      summary = rec ? (rec.description as string) ?? '' : '';
      for (const a of approaches) findings.push(`[${a.complexity}] ${a.description}`);
      for (const g of (d.gotchas as string[]) ?? []) findings.push(`Gotcha: ${g}`);
    } else if (agentType === 'reproducer') {
      summary = `Reproducible: ${d.reproducible ?? 'unknown'}. ${(d.suggested_test_approach as string) ?? ''}`;
      for (const step of (d.reproduction_steps as string[]) ?? []) findings.push(step);
      const tc = d.test_coverage as Record<string, unknown> | undefined;
      if (tc?.coverage_assessment) findings.push(`Coverage: ${tc.coverage_assessment}`);
    }

    return {
      agentType,
      summary,
      findings,
      codeReferences: codePathsToRefs((d.code_paths as unknown[]) ?? []),
    };
  };

  const rootCause = transformAgent('root_cause', raw.root_cause);
  const impact = transformAgent('impact', raw.impact);
  const fixAdvice = transformAgent('fix_advisor', raw.fix_advice);
  const reproduction = transformAgent('reproducer', raw.reproduction);

  // Transform suggested labels
  const suggestedLabels = ((raw.suggested_labels as Array<Record<string, unknown>>) ?? []).map(l => ({
    name: (l.name as string) ?? '',
    reason: (l.reason as string) ?? '',
    accepted: l.accepted as boolean | undefined,
  }));

  // Transform linked PRs
  const linkedPRs = ((raw.linked_prs as Array<Record<string, unknown>>) ?? []).map(pr => ({
    number: (pr.number as number) ?? 0,
    title: (pr.title as string) ?? '',
    state: ((pr.status ?? pr.state) as string) ?? 'open',
    url: (pr.url as string) ?? '',
  }));

  return {
    rootCause: { ...rootCause, agentType: 'root_cause', rootCause: rootCause.summary, codePaths: [], relatedIssues: [] },
    impact: { ...impact, agentType: 'impact', severity: (raw.impact as Record<string, unknown>)?.severity as 'critical' | 'high' | 'medium' | 'low' ?? 'medium', affectedComponents: [], userImpact: '', riskIfUnfixed: '' },
    fixAdvice: { ...fixAdvice, agentType: 'fix_advisor', suggestedApproaches: [], recommendedApproach: 0, patternsToFollow: [] },
    reproduction: { ...reproduction, agentType: 'reproducer', reproducible: 'unknown', existingTests: [], testGaps: [], suggestedTests: [] },
    summary: (raw.ai_summary as string) ?? '',
    severity: (raw.severity as 'critical' | 'high' | 'medium' | 'low') ?? 'medium',
    suggestedLabels,
    likelyResolved: (raw.likely_resolved as boolean) ?? false,
    linkedPRs,
    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  } as InvestigationReport;
}

/**
 * Check if a report object needs transformation (has snake_case keys from Python).
 * Returns true if the report appears to be raw Python output rather than
 * already-transformed TypeScript format.
 */
function needsTransformation(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r = report as Record<string, unknown>;
  // Python output has root_cause (snake), TypeScript has rootCause (camel)
  return r.root_cause !== undefined || r.ai_summary !== undefined || r.likely_resolved !== undefined;
}

// Track active investigation subprocesses, keyed by `${projectId}:${issueNumber}`
const activeInvestigations = new Map<string, ChildProcess>();

/** Kill all active investigation subprocesses. Called during app shutdown. */
export function killAllInvestigations(): void {
  for (const [key, proc] of activeInvestigations.entries()) {
    if (proc && !proc.killed) {
      try {
        killProcessGracefully(proc);
      } catch {
              // Best-effort cleanup during shutdown
      }
    }
    activeInvestigations.delete(key);
  }
}

// ============================================
// Investigation Queue
// ============================================

interface QueuedInvestigation {
  projectId: string;
  issueNumber: number;
  queuedAt: string;
}

/** FIFO queue for investigations waiting to start */
const investigationQueue: QueuedInvestigation[] = [];

/** Maximum number of investigations to auto-resume on restart */
const MAX_AUTO_RESUME = 3;

/** Delay before auto-resuming interrupted investigations on startup */
const AUTO_RESUME_DELAY_MS = 3000;

/** Maximum number of auto-resume attempts for interrupted investigations */
const MAX_AUTO_RESUME_ATTEMPTS = 3;

/** Track auto-resume attempts per investigation key: `${projectId}:${issueNumber}` */
const autoResumeAttempts = new Map<string, number>();

/**
 * Get the max parallel investigations setting for a project.
 * Reads from the project's GitHub config on disk (same source as the settings handler).
 */
function getMaxParallel(projectId: string): number {
  const DEFAULT_MAX = 3;
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return DEFAULT_MAX;
    const configPath = path.join(project.path, '.auto-claude', 'github', 'config.json');
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const settings = data.investigation_settings as InvestigationSettings | undefined;
    return settings?.maxParallelInvestigations ?? DEFAULT_MAX;
  } catch {
          return DEFAULT_MAX;
  }
}

/**
 * Remove an investigation from the queue (e.g. on cancel).
 * Returns true if the item was found and removed.
 */
function removeFromQueue(projectId: string, issueNumber: number): boolean {
  const index = investigationQueue.findIndex(
    (q) => q.projectId === projectId && q.issueNumber === issueNumber,
  );
  if (index !== -1) {
    investigationQueue.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Get GitHub Issues model and thinking settings from app settings
 */
function getGitHubIssuesSettings(): { model: string; thinkingLevel: string } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;
  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;
  const modelShort = featureModels.githubIssues ?? DEFAULT_FEATURE_MODELS.githubIssues;
  const thinkingLevel = featureThinking.githubIssues ?? DEFAULT_FEATURE_THINKING.githubIssues;
  const model = MODEL_ID_MAP[modelShort] ?? MODEL_ID_MAP['opus'];
  return { model, thinkingLevel };
}

/**
 * Get per-specialist investigation model and thinking settings from app settings.
 * Returns a JSON-serializable config dict for --specialist-config CLI arg.
 */
function getInvestigationSpecialistConfig(): Record<string, { model: string; thinking: string }> {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;
  const invModels = rawSettings?.investigationModels ?? DEFAULT_INVESTIGATION_MODELS;
  const invThinking = rawSettings?.investigationThinking ?? DEFAULT_INVESTIGATION_THINKING;

  return {
    root_cause: {
      model: MODEL_ID_MAP[invModels.rootCause] ?? MODEL_ID_MAP['opus'],
      thinking: invThinking.rootCause ?? 'high'
    },
    impact: {
      model: MODEL_ID_MAP[invModels.impact] ?? MODEL_ID_MAP['sonnet'],
      thinking: invThinking.impact ?? 'medium'
    },
    fix_advisor: {
      model: MODEL_ID_MAP[invModels.fixAdvisor] ?? MODEL_ID_MAP['sonnet'],
      thinking: invThinking.fixAdvisor ?? 'medium'
    },
    reproducer: {
      model: MODEL_ID_MAP[invModels.reproducer] ?? MODEL_ID_MAP['sonnet'],
      thinking: invThinking.reproducer ?? 'low'
    }
  };
}

/**
 * Get the GitHub config directory for a project
 */
function getGitHubDir(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', 'github');
}

/**
 * Find an existing spec for a given GitHub issue number by scanning task_metadata.json files.
 * Returns the specId if found, null otherwise.
 */
function findExistingSpecForIssue(projectPath: string, issueNumber: number, autoBuildPath?: string): string | null {
  const specsBase = autoBuildPath || '.auto-claude';
  const specsDir = path.join(projectPath, specsBase, 'specs');

  if (!fs.existsSync(specsDir)) return null;

  try {
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadataPath = path.join(specsDir, entry.name, 'task_metadata.json');
      if (!fs.existsSync(metadataPath)) continue;
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        if (metadata.githubIssueNumber === issueNumber) {
          return entry.name;
        }
      } catch {
              // Skip corrupt metadata files
      }
    }
  } catch {
          // Ignore read errors
  }

  return null;
}

/**
 * Default investigation settings
 */
function createDefaultSettings(): InvestigationSettings {
  return {
    autoCreateTasks: false,
    autoStartTasks: false,
    pipelineMode: 'full',
    autoPostToGitHub: false,
    autoCloseIssues: false,
    maxParallelInvestigations: 3,
    labelIncludeFilter: [],
    labelExcludeFilter: [],
  };
}

/**
 * Read investigation settings for a project from its config file on disk.
 */
function getInvestigationSettings(projectId: string): InvestigationSettings {
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return createDefaultSettings();
    const configPath = path.join(project.path, '.auto-claude', 'github', 'config.json');
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (data.investigation_settings) {
      return { ...createDefaultSettings(), ...data.investigation_settings } as InvestigationSettings;
    }
  } catch {
          // File doesn't exist or is corrupted, return defaults
  }
  return createDefaultSettings();
}

/**
 * Build a comprehensive task description from an investigation report.
 * Includes root cause, ALL fix approaches with pros/cons, gotchas, and
 * patterns to follow — so the AI coder agent has full context.
 */
function buildTaskDescriptionFromReport(
  issueNumber: number,
  reportData: Record<string, unknown>,
): string {
  const summary = (reportData.ai_summary as string) || `Investigation of issue #${issueNumber}`;
  const fixAdvice = reportData.fix_advice as {
    approaches?: Array<{
      description?: string;
      complexity?: string;
      files_affected?: string[];
      pros?: string[];
      cons?: string[];
    }>;
    recommended_approach?: number;
    gotchas?: string[];
    patterns_to_follow?: Array<{ file?: string; description?: string }>;
  } | undefined;
  const rootCause = reportData.root_cause as {
    identified_root_cause?: string;
    confidence?: string;
    evidence?: string;
    code_paths?: Array<{ file?: string; description?: string }>;
  } | undefined;

  const sections: string[] = [
    `# GitHub Issue #${issueNumber}`,
    '',
    '## Summary',
    summary,
  ];

  // Root cause context for the coder agent
  if (rootCause?.identified_root_cause) {
    sections.push(
      '',
      '## Root Cause',
      `**Confidence:** ${rootCause.confidence ?? 'unknown'}`,
      '',
      rootCause.identified_root_cause,
    );
    if (rootCause.code_paths?.length) {
      sections.push(
        '',
        '### Code Paths',
        ...rootCause.code_paths.map(
          (cp) => `- \`${cp.file}\` — ${cp.description ?? ''}`,
        ),
      );
    }
    if (rootCause.evidence) {
      sections.push('', '### Evidence', rootCause.evidence);
    }
  }

  // All fix approaches so the agent can choose the best strategy
  if (fixAdvice?.approaches?.length) {
    const recIdx = fixAdvice.recommended_approach ?? 0;
    sections.push('', '## Fix Approaches');
    sections.push(
      '',
      `The investigation identified ${fixAdvice.approaches.length} approach(es). ` +
      `Approach ${recIdx + 1} is recommended, but evaluate all options and choose the best strategy.`,
    );

    for (const [i, approach] of fixAdvice.approaches.entries()) {
      const isRecommended = i === recIdx;
      sections.push(
        '',
        `### Approach ${i + 1}: ${approach.description ?? 'Unnamed'}${isRecommended ? ' (Recommended)' : ''}`,
        `**Complexity:** ${approach.complexity ?? 'unknown'}`,
      );
      if (approach.files_affected?.length) {
        sections.push(
          '',
          '**Files to Modify:**',
          ...approach.files_affected.map((f) => `- \`${f}\``),
        );
      }
      if (approach.pros?.length) {
        sections.push(
          '',
          '**Pros:**',
          ...approach.pros.map((p) => `- ${p}`),
        );
      }
      if (approach.cons?.length) {
        sections.push(
          '',
          '**Cons:**',
          ...approach.cons.map((c) => `- ${c}`),
        );
      }
    }
  }

  // Gotchas and patterns
  if (fixAdvice?.gotchas?.length) {
    sections.push(
      '',
      '## Gotchas',
      ...fixAdvice.gotchas.map((g) => `- ${g}`),
    );
  }
  if (fixAdvice?.patterns_to_follow?.length) {
    sections.push(
      '',
      '## Patterns to Follow',
      ...fixAdvice.patterns_to_follow.map(
        (p) => `- \`${p.file}\` — ${p.description ?? ''}`,
      ),
    );
  }

  return sections.join('\n');
}

/**
 * Fetch issue labels from GitHub API.
 * Used for label filtering when auto-creating tasks from investigations.
 */
async function fetchIssueLabels(projectId: string, issueNumber: number): Promise<string[]> {
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return [];

    const config = getGitHubConfig(project);
    if (!config) return [];

    const normalizedRepo = config.repo.includes('/') ? config.repo : undefined;
    if (!normalizedRepo) return [];

    const issue = await githubFetch(
      config.token,
      `/repos/${normalizedRepo}/issues/${issueNumber}`
    ) as { labels: Array<{ name: string }> } | undefined;

    return issue?.labels?.map(l => l.name) ?? [];
  } catch {
          return [];
  }
}

/**
 * Auto-post investigation results to GitHub comment.
 * Extracted from the IPC handler for reuse in auto-post flow.
 */
async function autoPostInvestigationToGitHub(
  projectId: string,
  issueNumber: number,
): Promise<{ success: boolean; commentId?: number; error?: string }> {
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const validation = await validateGitHubModule(project);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'GitHub module not available' };
    }

    const backendPath = validation.backendPath ?? '';
    const { model, thinkingLevel } = getGitHubIssuesSettings();

    const args = buildRunnerArgs(
      getRunnerPath(backendPath),
      project.path,
      'post-investigation',
      [String(issueNumber)],
      { model, thinkingLevel },
    );

    const subprocessEnv = await getRunnerEnv();
    const { promise } = runPythonSubprocess<{ commentId: number }>({
      pythonPath: getPythonPath(backendPath),
      args,
      cwd: backendPath,
      env: subprocessEnv,
      onComplete: (stdout) => parseJSONFromOutput<{ commentId: number }>(stdout),
      onStdout: (line) => debugLog('STDOUT:', line),
      onStderr: (line) => debugLog('STDERR:', line),
    });

    const subResult = await promise;

    if (!subResult.success) {
      return { success: false, error: subResult.error ?? 'Failed to post to GitHub' };
    }

    const postResult = subResult.data as { commentId: number };
    appendActivityLogEntry(project.path, issueNumber, 'Results posted to GitHub');

    // Persist githubCommentId and postedAt to investigation state file
    const stateFile = path.join(project.path, '.auto-claude', 'issues', `${issueNumber}`, 'investigation_state.json');
    let existingState: Record<string, unknown> = {};
    try {
      existingState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch {
      // File doesn't exist or is invalid - start with empty state
    }
    fs.writeFileSync(stateFile, JSON.stringify({
      ...existingState,
      github_comment_id: postResult.commentId,
      posted_at: new Date().toISOString(),
    }, null, 2), 'utf-8');
    debugLog('Auto-posted investigation to GitHub', { issueNumber, commentId: postResult.commentId });

    return { success: true, commentId: postResult.commentId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to post to GitHub',
    };
  }
}

/**
 * Check if issue labels pass the include/exclude filters.
 * Returns true if the issue should auto-create task.
 */
function passesLabelFilters(
  issueLabels: string[],
  includeFilter: string[],
  excludeFilter: string[],
): boolean {
  // If exclude filter matches, never create task
  if (excludeFilter.length > 0) {
    const hasExcludedLabel = issueLabels.some(label => excludeFilter.includes(label));
    if (hasExcludedLabel) {
      debugLog('Issue excluded by label filter', { issueLabels, excludeFilter });
      return false;
    }
  }

  // If include filter is set, only create if issue has at least one included label
  if (includeFilter.length > 0) {
    const hasIncludedLabel = issueLabels.some(label => includeFilter.includes(label));
    if (!hasIncludedLabel) {
      debugLog('Issue not in include filter', { issueLabels, includeFilter });
      return false;
    }
  }

  return true;
}

/**
 * Auto-create a task from a completed investigation report.
 * Mirrors the logic in the GITHUB_INVESTIGATION_CREATE_TASK handler.
 * Returns the specId if successful, or null on failure.
 */
async function autoCreateTaskFromInvestigation(
  projectId: string,
  issueNumber: number,
  pipelineMode: 'full' | 'skip_to_planning' | 'minimal' = 'full',
): Promise<{ specId: string; specDir: string; taskDescription: string; metadata: import('./spec-utils').SpecCreationData['metadata'] } | null> {
  try {
    const project = projectStore.getProject(projectId);
    if (!project) return null;

    const reportPath = path.join(
      project.path,
      '.auto-claude',
      'issues',
      `${issueNumber}`,
      'investigation_report.json',
    );

    if (!fs.existsSync(reportPath)) return null;

    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const summary = (reportData.ai_summary as string) || `Investigation of issue #${issueNumber}`;
    const taskDescription = buildTaskDescriptionFromReport(issueNumber, reportData);

    const config = getGitHubConfig(project);
    const githubUrl = config
      ? `https://github.com/${config.repo}/issues/${issueNumber}`
      : '';

    const labels = reportData.suggested_labels
      ?.filter((l: { accepted?: boolean }) => l.accepted !== false)
      .map((l: { name: string }) => l.name) ?? [];

    const specData = await createSpecForIssue(
      project,
      issueNumber,
      summary,
      taskDescription,
      githubUrl,
      labels,
      project.settings?.mainBranch,
      undefined,
      reportData,
      pipelineMode,
    );

    debugLog('Auto-created task from investigation', { projectId, issueNumber, specId: specData.specId });
    return specData;
  } catch (error) {
    debugLog('Failed to auto-create task from investigation', {
      projectId,
      issueNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================
// Legacy handler (old one-shot investigation)
// ============================================

/**
 * Send investigation progress update to renderer (legacy)
 */
function sendLegacyProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  status: GitHubInvestigationStatus
): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
      projectId,
      status
    );
  }
}

/**
 * Send investigation error to renderer (legacy)
 */
function sendLegacyError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
      projectId,
      error
    );
  }
}

/**
 * Send investigation completion to renderer (legacy)
 */
function sendLegacyComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  result: GitHubInvestigationResult
): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
      projectId,
      result
    );
  }
}

/**
 * Legacy: Investigate a GitHub issue and create a task (old one-shot flow)
 */
function registerLegacyInvestigateIssue(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.GITHUB_INVESTIGATE_ISSUE,
    async (_, projectId: string, issueNumber: number, selectedCommentIds?: number[]) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendLegacyError(mainWindow, projectId, 'Project not found');
        return;
      }

      const config = getGitHubConfig(project);
      if (!config) {
        sendLegacyError(mainWindow, projectId, 'No GitHub token or repository configured');
        return;
      }

      try {
        sendLegacyProgress(mainWindow, projectId, {
          phase: 'fetching',
          issueNumber,
          progress: 10,
          message: 'Fetching issue details...'
        });

        const issue = await githubFetch(
          config.token,
          `/repos/${config.repo}/issues/${issueNumber}`
        ) as {
          number: number;
          title: string;
          body?: string;
          labels: Array<{ name: string }>;
          html_url: string;
        };

        const allComments = await githubFetch(
          config.token,
          `/repos/${config.repo}/issues/${issueNumber}/comments`
        ) as GitHubAPIComment[];

        const comments = Array.isArray(selectedCommentIds)
          ? allComments.filter(c => selectedCommentIds.includes(c.id))
          : allComments;

        const labels = issue.labels.map(l => l.name);
        const issueContext = buildIssueContext(
          issue.number,
          issue.title,
          issue.body,
          labels,
          issue.html_url,
          comments
        );

        sendLegacyProgress(mainWindow, projectId, {
          phase: 'analyzing',
          issueNumber,
          progress: 30,
          message: 'AI is analyzing the issue...'
        });

        const taskDescription = buildInvestigationTask(
          issue.number,
          issue.title,
          issueContext
        );

        const specData = await createSpecForIssue(
          project,
          issue.number,
          issue.title,
          taskDescription,
          issue.html_url,
          labels,
          project.settings?.mainBranch
        );

        sendLegacyProgress(mainWindow, projectId, {
          phase: 'creating_task',
          issueNumber,
          progress: 70,
          message: 'Creating task from investigation...'
        });

        const investigationResult: GitHubInvestigationResult = {
          success: true,
          issueNumber,
          analysis: {
            summary: `Investigation of issue #${issueNumber}: ${issue.title}`,
            proposedSolution: 'Task has been created for AI agent to implement the solution.',
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: [
              `Issue #${issueNumber} requirements are met`,
              'All existing tests pass',
              'New functionality is tested'
            ]
          },
          taskId: specData.specId
        };

        sendLegacyProgress(mainWindow, projectId, {
          phase: 'complete',
          issueNumber,
          progress: 100,
          message: 'Investigation complete!'
        });

        sendLegacyComplete(mainWindow, projectId, investigationResult);

      } catch (error) {
        sendLegacyError(
          mainWindow,
          projectId,
          error instanceof Error ? error.message : 'Failed to investigate issue'
        );
      }
    }
  );
}

// ============================================
// New investigation system handlers
// ============================================

/**
 * Run a single investigation subprocess for a given project/issue.
 * This is extracted from the start handler so it can be called both
 * directly (when under the parallel limit) and from processQueue().
 *
 * After completion (success, error, or exception), it calls processQueue()
 * to start the next queued investigation.
 */
async function runInvestigation(
  projectId: string,
  issueNumber: number,
  getMainWindow: () => BrowserWindow | null,
  agentManager?: AgentManager,
): Promise<void> {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  const { sendProgress, sendError, sendComplete } = createIPCCommunicators<
    InvestigationProgress,
    InvestigationResult
  >(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
      error: IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
      complete: IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
    },
    projectId,
  );

  const processKey = `${projectId}:${issueNumber}`;

  try {
    await withProjectOrNull(projectId, async (project) => {
      const validation = await validateGitHubModule(project);
      if (!validation.valid) {
        sendError({ error: validation.error ?? 'GitHub module not available', issueNumber });
        return;
      }

      const backendPath = validation.backendPath ?? '';
      const specialistConfig = getInvestigationSpecialistConfig();

      // Pre-allocate a spec number for task creation (Gap 86)
      // This reserves the number early to prevent collisions when multiple
      // investigations complete around the same time.
      let preAllocatedSpecNumber: number | null = null;
      try {
        preAllocatedSpecNumber = await withSpecNumberLock(project.path, (lock) => {
          return lock.getNextSpecNumber(project.autoBuildPath);
        });

        // Save pre-allocated number to investigation state on disk
        const issueStateDir = path.join(project.path, '.auto-claude', 'issues', `${issueNumber}`);
        fs.mkdirSync(issueStateDir, { recursive: true });
        const stateFile = path.join(issueStateDir, 'investigation_state.json');
        let existingState: Record<string, unknown> = {};
        try {
          existingState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        } catch {
          // File doesn't exist or is invalid - start with empty state
        }
        fs.writeFileSync(stateFile, JSON.stringify({
          ...existingState,
          issue_number: issueNumber,
          status: 'investigating',
          spec_id: String(preAllocatedSpecNumber).padStart(3, '0'),
          started_at: new Date().toISOString(),
        }, null, 2), 'utf-8');

        debugLog('Pre-allocated spec number for investigation', {
          issueNumber,
          specNumber: preAllocatedSpecNumber,
        });
      } catch (lockErr) {
        // Non-fatal: if pre-allocation fails, task creation will allocate on demand
        debugLog('Failed to pre-allocate spec number (non-fatal)', {
          issueNumber,
          error: lockErr instanceof Error ? lockErr.message : String(lockErr),
        });
      }

      // Read session IDs for interrupted investigation resume
      // Resume sessions if:
      // 1. Sessions exist on disk, AND
      // 2. Investigation hasn't successfully completed (no completed_at or status is 'investigating')
      let resumeSessionsArg: string[] = [];
      try {
        const stateFile = path.join(
          project.path, '.auto-claude', 'issues', `${issueNumber}`, 'investigation_state.json'
        );
        if (fs.existsSync(stateFile)) {
          const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          if (stateData.sessions && Object.keys(stateData.sessions).length > 0) {
            // Check if investigation is incomplete (no completed_at or still investigating)
            const isIncomplete = !stateData.completed_at || stateData.status === 'investigating' || stateData.status === 'failed' || stateData.status === 'cancelled';
            if (isIncomplete) {
              resumeSessionsArg = ['--resume-sessions', JSON.stringify(stateData.sessions)];
              debugLog('Resuming investigation with saved sessions', {
                issueNumber,
                sessionCount: Object.keys(stateData.sessions).length,
                currentStatus: stateData.status
              });
            }
          }
        }
      } catch {
              // Non-fatal: will start fresh
      }

      // Read investigation settings to get fastInvestigations flag
      const investigationSettings = getInvestigationSettings(projectId);

      const args = [
        ...buildRunnerArgs(
          getRunnerPath(backendPath),
          project.path,
          'investigate',
          [String(issueNumber)],
          { fastMode: investigationSettings.fastInvestigations ?? false },
        ),
        '--specialist-config', JSON.stringify(specialistConfig),
        ...resumeSessionsArg,
      ];

      const startedAt = new Date().toISOString();

      appendActivityLogEntry(project.path, issueNumber, 'Investigation started');

      sendProgress({
        issueNumber,
        phase: 'starting',
        progress: 5,
        message: 'Starting investigation...',
        agentStatuses: [
          { agentType: 'root_cause', status: 'pending', progress: 0 },
          { agentType: 'impact', status: 'pending', progress: 0 },
          { agentType: 'fix_advisor', status: 'pending', progress: 0 },
          { agentType: 'reproducer', status: 'pending', progress: 0 },
        ],
        startedAt,
      });

      const mainWindow = getMainWindow();
      const logCollector = new InvestigationLogCollector(project.path, projectId, issueNumber, mainWindow);

      const subprocessEnv = await getRunnerEnv();
      const { process: childProcess, promise } = runPythonSubprocess<InvestigationResult>({
        pythonPath: getPythonPath(backendPath),
        args,
        cwd: backendPath,
        env: subprocessEnv,
        onProgress: (percent, message, data) => {
          // Parse agent status updates from progress data if available
          const progressUpdate: InvestigationProgress = {
            issueNumber,
            phase: percent < 90 ? 'investigating' : 'finalizing',
            progress: percent,
            message,
            agentStatuses: (data as InvestigationProgress | undefined)?.agentStatuses ?? [],
            startedAt,
          };
          sendProgress(progressUpdate);
        },
        onComplete: (stdout) => parseJSONFromOutput<InvestigationResult>(stdout),
        onStdout: (line) => {
          debugLog('STDOUT:', line);
          logCollector.processLine(line);
        },
        onStderr: (line) => debugLog('STDERR:', line),
        onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
          }
        },
      });

      activeInvestigations.set(processKey, childProcess);

      let result;
      try {
        result = await promise;
      } finally {
        activeInvestigations.delete(processKey);
        // Reset auto-resume counter on successful completion or manual cancellation
        autoResumeAttempts.delete(processKey);
      }

      logCollector.finalize(!!result.success);

      if (!result.success) {
        appendActivityLogEntry(project.path, issueNumber, `Investigation failed: ${result.error ?? 'unknown error'}`);
        // Check if there are saved sessions for resume before sending error
        const stateFile = path.join(project.path, '.auto-claude', 'issues', String(issueNumber), 'investigation_state.json');
        let hasResumeSessions = false;
        try {
          if (fs.existsSync(stateFile)) {
            const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            hasResumeSessions = stateData.sessions && typeof stateData.sessions === 'object' && Object.keys(stateData.sessions).length > 0;
          }
        } catch {
                // Non-fatal: if we can't read the state file, assume no sessions
        }
        sendError({ error: result.error ?? 'Investigation failed', issueNumber, hasResumeSessions });
        return;
      }

      // The Python subprocess outputs a raw InvestigationReport (snake_case Pydantic dict),
      // NOT an InvestigationResult envelope. We need to wrap it properly so the renderer
      // store can key on issueNumber and transition state from "investigating" → "findings_ready".
      const rawReport = result.data as unknown as Record<string, unknown>;
      const transformedReport = needsTransformation(rawReport)
        ? transformPythonReport(rawReport)
        : rawReport as unknown as InvestigationReport;

      const investigationResult: InvestigationResult = {
        issueNumber,
        report: transformedReport,
        completedAt: new Date().toISOString(),
      };
      sendComplete(investigationResult);

      appendActivityLogEntry(project.path, issueNumber, 'Investigation completed');

      // --- Get investigation settings ---
      const settings = getInvestigationSettings(projectId);

      // --- Auto-post to GitHub if enabled ---
      if (settings.autoPostToGitHub) {
        try {
          await autoPostInvestigationToGitHub(projectId, issueNumber);
        } catch (postError) {
          debugLog('Failed to auto-post investigation to GitHub', {
            projectId,
            issueNumber,
            error: postError instanceof Error ? postError.message : String(postError),
          });
        }
      }

      // --- Auto-create task if setting is enabled ---
      if (settings.autoCreateTasks) {
        // Fetch issue labels for filter checking
        const issueLabels = await fetchIssueLabels(projectId, issueNumber);

        // Check label filters before creating task
        if (!passesLabelFilters(
          issueLabels,
          settings.labelIncludeFilter ?? [],
          settings.labelExcludeFilter ?? [],
        )) {
          debugLog('Skipping auto-create task due to label filters', {
            projectId,
            issueNumber,
            issueLabels,
            includeFilter: settings.labelIncludeFilter,
            excludeFilter: settings.labelExcludeFilter,
          });
          appendActivityLogEntry(project.path, issueNumber, 'Task creation skipped due to label filters');
        } else {
          const specData = await autoCreateTaskFromInvestigation(
            projectId,
            issueNumber,
            settings.pipelineMode ?? 'full',
          );
          if (specData) {
            appendActivityLogEntry(project.path, issueNumber, `Task created: ${specData.specId}`);
          }
          if (specData && settings.autoStartTasks && agentManager) {
            // Auto-start the build pipeline for the newly created task
            try {
              const proj = projectStore.getProject(projectId);
              if (proj) {
                agentManager.startSpecCreation(
                  specData.specId,
                  proj.path,
                  specData.taskDescription,
                  specData.specDir,
                  specData.metadata,
                );
                // Only update status if not already in planning (for skip_to_planning mode)
                if (settings.pipelineMode !== 'skip_to_planning') {
                  updateImplementationPlanStatus(specData.specDir, 'planning');
                }
                debugLog('Auto-started build for investigation task', {
                  projectId,
                  issueNumber,
                  specId: specData.specId,
                });
              }
            } catch (startError) {
              debugLog('Failed to auto-start build for investigation task', {
                projectId,
                issueNumber,
                error: startError instanceof Error ? startError.message : String(startError),
              });
            }
          }
        }
      }
    });
  } catch (error) {
    sendError({ error: error instanceof Error ? error.message : 'Failed to start investigation', issueNumber });
  } finally {
    // Always try to start the next queued investigation after this one finishes
    processQueue(getMainWindow, agentManager);
  }
}

/**
 * Send a "queued" progress update to the renderer for a queued investigation,
 * including the 1-based queue position.
 */
function sendQueuedProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  issueNumber: number,
  position: number,
): void {
  const { sendProgress } = createIPCCommunicators<InvestigationProgress, InvestigationResult>(
    mainWindow,
    {
      progress: IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
      error: IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
      complete: IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
    },
    projectId,
  );

  sendProgress({
    issueNumber,
    phase: 'queued',
    progress: 0,
    message: `Queued (position ${position})`,
    agentStatuses: [],
    startedAt: new Date().toISOString(),
  });
}

/**
 * Update queue position progress for all currently queued investigations.
 */
function broadcastQueuePositions(getMainWindow: () => BrowserWindow | null): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  for (let i = 0; i < investigationQueue.length; i++) {
    const queued = investigationQueue[i];
    sendQueuedProgress(mainWindow, queued.projectId, queued.issueNumber, i + 1);
  }
}

/**
 * Process the investigation queue: start as many queued investigations as
 * allowed by the maxParallelInvestigations limit.
 */
function processQueue(getMainWindow: () => BrowserWindow | null, agentManager?: AgentManager): void {
  if (investigationQueue.length === 0) return;

  // Track how many we fire-and-forget in this synchronous loop per project,
  // since runInvestigation adds to activeInvestigations asynchronously (after
  // the first await), so activeInvestigations.size alone would under-count.
  const startedPerProject = new Map<string, number>();

  // Process items from the front of the queue (FIFO).
  while (investigationQueue.length > 0) {
    const next = investigationQueue[0];
    const maxParallel = getMaxParallel(next.projectId);

    // Count active investigations for this specific project
    const activeForProject = [...activeInvestigations.keys()]
      .filter((key) => key.startsWith(`${next.projectId}:`)).length;
    const launchingForProject = startedPerProject.get(next.projectId) ?? 0;

    if (activeForProject + launchingForProject >= maxParallel) {
      debugLog('Queue: at parallel limit, waiting', {
        projectId: next.projectId,
        activeForProject,
        launchingForProject,
        maxParallel,
        queued: investigationQueue.length,
      });
      break;
    }

    // Dequeue and start
    investigationQueue.shift();
    startedPerProject.set(next.projectId, launchingForProject + 1);
    debugLog('Queue: starting queued investigation', {
      projectId: next.projectId,
      issueNumber: next.issueNumber,
      remainingInQueue: investigationQueue.length,
    });

    // IMPORTANT: Reserve the slot in activeInvestigations BEFORE calling runInvestigation
    // to prevent race conditions where rapid IPC calls all pass the parallel limit check.
    const processKey = `${next.projectId}:${next.issueNumber}`;
    activeInvestigations.set(processKey, null as unknown as ChildProcess);

    // Fire-and-forget: runInvestigation will call processQueue again when it finishes
    runInvestigation(next.projectId, next.issueNumber, getMainWindow, agentManager).catch((err) => {
      // If runInvestigation fails before setting the actual subprocess, clean up the placeholder
      activeInvestigations.delete(processKey);
      debugLog('Queued investigation failed to start, cleaned up placeholder', {
        projectId: next.projectId,
        issueNumber: next.issueNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Update queue positions for remaining items
    broadcastQueuePositions(getMainWindow);
  }
}

/**
 * Register all investigation-related handlers
 */
export function registerInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Investigation handlers');

  // Keep legacy handler for backwards compatibility
  registerLegacyInvestigateIssue(agentManager, getMainWindow);

  // ============================================
  // 1. Start investigation (with queue management)
  // ============================================
  ipcMain.on(
    IPC_CHANNELS.GITHUB_INVESTIGATION_START,
    async (_, projectId: string, issueNumber: number) => {
      debugLog('startInvestigation handler called', { projectId, issueNumber });
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
        const { sendError } = createIPCCommunicators<InvestigationProgress, InvestigationResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
            error: IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
            complete: IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
          },
          projectId,
        );
        sendError({ error: 'Invalid issue number', issueNumber });
        return;
      }

      const processKey = `${projectId}:${issueNumber}`;

      // Guard against concurrent investigation start for the same process key
      // This prevents race conditions where multiple calls try to start the same investigation
      if (activeInvestigations.has(processKey)) {
        const existingProcess = activeInvestigations.get(processKey);
        if (existingProcess && !existingProcess.killed) {
          debugLog('Investigation already active, cancelling previous', { projectId, issueNumber });
          killProcessGracefully(existingProcess);
          activeInvestigations.delete(processKey);
        }
      }

      // Also remove from queue if already queued (re-start scenario)
      removeFromQueue(projectId, issueNumber);

      // Check whether we are at the parallel limit for this project
      const maxParallel = getMaxParallel(projectId);
      const activeForProject = [...activeInvestigations.keys()]
        .filter((key) => key.startsWith(`${projectId}:`)).length;
      if (activeForProject >= maxParallel) {
        // Enqueue and send "queued" progress
        investigationQueue.push({
          projectId,
          issueNumber,
          queuedAt: new Date().toISOString(),
        });

        const position = investigationQueue.length;
        debugLog('Investigation queued', {
          projectId,
          issueNumber,
          position,
          activeForProject,
          maxParallel,
        });

        sendQueuedProgress(mainWindow, projectId, issueNumber, position);
        return;
      }

      // Under the limit — reserve slot and start immediately
      // IMPORTANT: Reserve the slot in activeInvestigations BEFORE calling runInvestigation
      // to prevent race conditions where rapid IPC calls all pass the parallel limit check.
      // runInvestigation will replace this placeholder with the actual subprocess.
      activeInvestigations.set(processKey, null as unknown as ChildProcess);
      runInvestigation(projectId, issueNumber, getMainWindow, agentManager).catch((err) => {
        // If runInvestigation fails before setting the actual subprocess, clean up the placeholder
        activeInvestigations.delete(processKey);
        debugLog('Investigation failed to start, cleaned up placeholder', {
          projectId,
          issueNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  );

  // ============================================
  // 2. Cancel investigation (also removes from queue)
  // ============================================
  ipcMain.on(
    IPC_CHANNELS.GITHUB_INVESTIGATION_CANCEL,
    (_, projectId: string, issueNumber: number) => {
      debugLog('cancelInvestigation handler called', { projectId, issueNumber });

      const project = projectStore.getProject(projectId);

      // First, try to remove from the queue (not yet started)
      const wasQueued = removeFromQueue(projectId, issueNumber);
      if (wasQueued) {
        debugLog('Investigation removed from queue', { projectId, issueNumber });
        if (project) appendActivityLogEntry(project.path, issueNumber, 'Investigation cancelled (was queued)');
        // Update queue positions for remaining items
        broadcastQueuePositions(getMainWindow);
        return;
      }

      // Otherwise, kill the running subprocess
      const processKey = `${projectId}:${issueNumber}`;
      const proc = activeInvestigations.get(processKey);

      if (proc && !proc.killed) {
        killProcessGracefully(proc);
        debugLog('Investigation process killed', { processKey });

        // Check for saved sessions and send error response
        const mainWindow = getMainWindow();
        if (mainWindow && project) {
          const stateFile = path.join(project.path, '.auto-claude', 'issues', String(issueNumber), 'investigation_state.json');
          let hasResumeSessions = false;
          try {
            if (fs.existsSync(stateFile)) {
              const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
              hasResumeSessions = stateData.sessions && typeof stateData.sessions === 'object' && Object.keys(stateData.sessions).length > 0;
            }
          } catch {
                  // Non-fatal: if we can't read the state file, assume no sessions
          }

          const { sendError } = createIPCCommunicators<InvestigationProgress, InvestigationResult>(
            mainWindow,
            {
              progress: IPC_CHANNELS.GITHUB_INVESTIGATION_PROGRESS,
              error: IPC_CHANNELS.GITHUB_INVESTIGATION_ERROR,
              complete: IPC_CHANNELS.GITHUB_INVESTIGATION_COMPLETE,
            },
            projectId,
          );
          sendError({ error: 'Investigation cancelled', issueNumber, hasResumeSessions });
        }
      }

      if (project) appendActivityLogEntry(project.path, issueNumber, 'Investigation cancelled');
      activeInvestigations.delete(processKey);
      // Reset auto-resume counter on manual cancellation
      autoResumeAttempts.delete(processKey);
    },
  );

  // ============================================
  // 2b. Cancel all investigations for a project
  // ============================================
  ipcMain.on(
    IPC_CHANNELS.GITHUB_INVESTIGATION_CANCEL_ALL,
    (_, projectId: string) => {
      debugLog('cancelAllInvestigations handler called', { projectId });

      // Remove all queued investigations for this project
      for (let i = investigationQueue.length - 1; i >= 0; i--) {
        if (investigationQueue[i].projectId === projectId) {
          investigationQueue.splice(i, 1);
        }
      }

      // Kill all active investigations for this project
      for (const [processKey, proc] of activeInvestigations.entries()) {
        if (processKey.startsWith(`${projectId}:`)) {
          if (!proc.killed) {
            killProcessGracefully(proc);
            debugLog('Investigation process killed (cancel all)', { processKey });
          }
          activeInvestigations.delete(processKey);
        }
      }

      broadcastQueuePositions(getMainWindow);
    },
  );

  // ============================================
  // 3. Create task from investigation
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_CREATE_TASK,
    async (_, projectId: string, issueNumber: number) => {
      debugLog('createTaskFromInvestigation handler called', { projectId, issueNumber });

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          // Read investigation report from persistence
          // Reports are stored at .auto-claude/issues/{issueNumber}/investigation_report.json
          const reportPath = path.join(
            project.path,
            '.auto-claude',
            'issues',
            `${issueNumber}`,
            'investigation_report.json',
          );

          if (!fs.existsSync(reportPath)) {
            return { success: false, error: 'Investigation report not found. Run investigation first.' };
          }

          const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

          // Build task description from investigation report with ALL fix approaches
          const summary = (reportData.ai_summary as string) || `Investigation of issue #${issueNumber}`;
          const taskDescription = buildTaskDescriptionFromReport(issueNumber, reportData);

          const config = getGitHubConfig(project);
          const githubUrl = config
            ? `https://github.com/${config.repo}/issues/${issueNumber}`
            : '';

          const labels = reportData.suggested_labels
            ?.filter((l: { accepted?: boolean }) => l.accepted !== false)
            .map((l: { name: string }) => l.name) ?? [];

          // Check if a task already exists for this issue
          const existingSpecId = findExistingSpecForIssue(project.path, issueNumber, project.autoBuildPath);
          if (existingSpecId) {
            // Update the existing task's description with new investigation findings
            const specsBase = getSpecsDir(project.autoBuildPath);
            const existingSpecDir = path.join(project.path, specsBase, existingSpecId);
            const planPath = path.join(existingSpecDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

            try {
              // Try to read and update the plan - handle missing file gracefully
              try {
                const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
                plan.description = taskDescription;
                plan.updated_at = new Date().toISOString();
                fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');
              } catch (readErr) {
                // Plan file doesn't exist or can't be read - skip update
                debugLog('Plan file not found or invalid, skipping update', {
                  specId: existingSpecId,
                  error: readErr instanceof Error ? readErr.message : String(readErr),
                });
              }
            } catch (updateErr) {
              debugLog('Failed to update existing spec plan', {
                specId: existingSpecId,
                error: updateErr instanceof Error ? updateErr.message : String(updateErr),
              });
            }

            debugLog('Found existing task for issue, returning existing specId', {
              issueNumber,
              specId: existingSpecId,
            });
            return { success: true, data: { specId: existingSpecId, existing: true } };
          }

          // Read pre-allocated spec number from investigation state (Gap 86)
          let preAllocatedSpecNumber: number | undefined;
          try {
            const stateFile = path.join(
              project.path,
              '.auto-claude',
              'issues',
              `${issueNumber}`,
              'investigation_state.json',
            );
            if (fs.existsSync(stateFile)) {
              const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
              if (stateData.spec_id) {
                const parsed = parseInt(stateData.spec_id, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  preAllocatedSpecNumber = parsed;
                  debugLog('Using pre-allocated spec number', { issueNumber, specNumber: parsed });
                }
              }
            }
          } catch {
                  // Non-fatal: will allocate on demand
          }

          const specData = await createSpecForIssue(
            project,
            issueNumber,
            summary,
            taskDescription,
            githubUrl,
            labels,
            project.settings?.mainBranch,
            preAllocatedSpecNumber,
            reportData,
          );

          appendActivityLogEntry(project.path, issueNumber, `Task created: ${specData.specId}`);

          // Persist spec_id to investigation state file so the UI knows a task was created
          const stateFile = path.join(project.path, '.auto-claude', 'issues', `${issueNumber}`, 'investigation_state.json');
          let existingState: Record<string, unknown> = {};
          try {
            existingState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          } catch {
            // File doesn't exist or is invalid - start with empty state
          }
          fs.writeFileSync(stateFile, JSON.stringify({
            ...existingState,
            spec_id: specData.specId,
            linked_spec_id: specData.specId, // Legacy field name for backwards compatibility
          }, null, 2), 'utf-8');
          debugLog('Persisted spec_id to investigation state', { issueNumber, specId: specData.specId });

          return { success: true, data: { specId: specData.specId } };
        });

        return result ?? { success: false, error: 'Project not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create task',
        };
      }
    },
  );

  // ============================================
  // 4. Dismiss issue
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_DISMISS,
    async (_, projectId: string, issueNumber: number, reason: InvestigationDismissReason) => {
      debugLog('dismissIssue handler called', { projectId, issueNumber, reason });

      // Validate dismiss reason at runtime to guard against unexpected values
      const validReasons: ReadonlySet<string> = new Set(['wont_fix', 'duplicate', 'cannot_reproduce', 'out_of_scope']);
      if (!validReasons.has(reason)) {
        return { success: false, error: `Invalid dismiss reason: ${reason}` };
      }

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          const githubDir = getGitHubDir(project.path);
          const dismissDir = path.join(githubDir, 'investigations', 'dismissed');
          fs.mkdirSync(dismissDir, { recursive: true });

          const dismissPath = path.join(dismissDir, `${issueNumber}.json`);
          await writeJsonWithRetry(dismissPath, {
            issueNumber,
            reason,
            dismissedAt: new Date().toISOString(),
          }, { indent: 2 });

          appendActivityLogEntry(project.path, issueNumber, `Dismissed: ${reason}`);

          // Also close the issue on GitHub with a comment
          try {
            const config = getGitHubConfig(project);
            if (config) {
              const reasonLabels: Record<string, string> = {
                wont_fix: "Won't Fix",
                duplicate: 'Duplicate',
                cannot_reproduce: 'Cannot Reproduce',
                out_of_scope: 'Out of Scope',
              };
              const reasonLabel = reasonLabels[reason] ?? reason;
              const commentBody = `Dismissed by Auto-Claude: ${reasonLabel}`;

              // Post a comment with the dismiss reason
              await githubFetch(
                config.token,
                `/repos/${config.repo}/issues/${issueNumber}/comments`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ body: commentBody }),
                },
              );

              // Close the issue
              await githubFetch(
                config.token,
                `/repos/${config.repo}/issues/${issueNumber}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ state: 'closed' }),
                },
              );

              debugLog('Issue closed on GitHub after dismiss', { issueNumber, reason });
            }
          } catch (ghError) {
            // GitHub API failure should not crash the dismiss flow
            debugLog('Failed to close issue on GitHub after dismiss', {
              issueNumber,
              error: ghError instanceof Error ? ghError.message : String(ghError),
            });
          }

          return { success: true };
        });

        return result ?? { success: false, error: 'Project not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to dismiss issue',
        };
      }
    },
  );

  // ============================================
  // 5. Post investigation results to GitHub
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_POST_GITHUB,
    async (_, projectId: string, issueNumber: number) => {
      debugLog('postInvestigationToGitHub handler called', { projectId, issueNumber });

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          const validation = await validateGitHubModule(project);
          if (!validation.valid) {
            return { success: false, error: validation.error ?? 'GitHub module not available' };
          }

          const backendPath = validation.backendPath ?? '';
          const { model, thinkingLevel } = getGitHubIssuesSettings();

          const args = buildRunnerArgs(
            getRunnerPath(backendPath),
            project.path,
            'post-investigation',
            [String(issueNumber)],
            { model, thinkingLevel },
          );

          const subprocessEnv = await getRunnerEnv();
          const { promise } = runPythonSubprocess<{ commentId: number }>({
            pythonPath: getPythonPath(backendPath),
            args,
            cwd: backendPath,
            env: subprocessEnv,
            onComplete: (stdout) => parseJSONFromOutput<{ commentId: number }>(stdout),
            onStdout: (line) => debugLog('STDOUT:', line),
            onStderr: (line) => debugLog('STDERR:', line),
          });

          const subResult = await promise;

          if (!subResult.success) {
            return { success: false, error: subResult.error ?? 'Failed to post to GitHub' };
          }

          const postResult = subResult.data as { commentId: number };
          appendActivityLogEntry(project.path, issueNumber, 'Results posted to GitHub');

          // Persist githubCommentId and postedAt to investigation state file
          const stateFile = path.join(project.path, '.auto-claude', 'issues', `${issueNumber}`, 'investigation_state.json');
          let existingState: Record<string, unknown> = {};
          try {
            existingState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          } catch {
            // File doesn't exist or is invalid - start with empty state
          }
          fs.writeFileSync(stateFile, JSON.stringify({
            ...existingState,
            github_comment_id: postResult.commentId,
            posted_at: new Date().toISOString(),
          }, null, 2), 'utf-8');
          debugLog('Persisted githubCommentId and postedAt to investigation state', { issueNumber, commentId: postResult.commentId });

          return { success: true, data: { commentId: postResult.commentId } };
        });

        return result ?? { success: false, error: 'Project not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to post to GitHub',
        };
      }
    },
  );

  // ============================================
  // 6. Get investigation settings
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_GET_SETTINGS,
    async (_, projectId: string) => {
      debugLog('getInvestigationSettings handler called', { projectId });

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          const configPath = path.join(getGitHubDir(project.path), 'config.json');

          try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (data.investigation_settings) {
              return {
                success: true,
                data: data.investigation_settings as InvestigationSettings,
              };
            }
          } catch {
                  // File doesn't exist or is corrupted, return defaults
          }

          return { success: true, data: createDefaultSettings() };
        });

        return result ?? { success: true, data: createDefaultSettings() };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get settings',
        };
      }
    },
  );

  // ============================================
  // 7. Save investigation settings
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_SAVE_SETTINGS,
    async (_, projectId: string, settings: Partial<InvestigationSettings>) => {
      debugLog('saveInvestigationSettings handler called', { projectId });

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          const githubDir = getGitHubDir(project.path);
          fs.mkdirSync(githubDir, { recursive: true });

          const configPath = path.join(githubDir, 'config.json');
          let existingConfig: Record<string, unknown> = {};

          try {
            existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          } catch {
                  // Use empty config if file doesn't exist
          }

          // Merge with existing settings (partial update)
          const existingSettings = (existingConfig.investigation_settings as InvestigationSettings) ?? createDefaultSettings();
          const updatedConfig = {
            ...existingConfig,
            investigation_settings: {
              ...existingSettings,
              ...settings,
            },
          };

          await writeJsonWithRetry(configPath, updatedConfig, { indent: 2 });
          return { success: true };
        });

        return result ?? { success: false, error: 'Project not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save settings',
        };
      }
    },
  );

  // ============================================
  // 8. Load persisted investigations from disk
  // ============================================
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_INVESTIGATION_LOAD_PERSISTED,
    async (_, projectId: string) => {
      debugLog('loadPersistedInvestigations handler called', { projectId });

      try {
        const result = await withProjectOrNull(projectId, async (project) => {
          const issuesDir = path.join(project.path, '.auto-claude', 'issues');

          if (!fs.existsSync(issuesDir)) {
            return { success: true, data: [] };
          }

          const entries = fs.readdirSync(issuesDir, { withFileTypes: true });
          const persisted: Array<{
            issueNumber: number;
            status: string;
            report?: unknown;
            completedAt?: string;
            specId?: string;
            githubCommentId?: number;
            postedAt?: string;
            wasInterrupted?: boolean;
            hasResumeSessions?: boolean;
            activityLog?: ActivityLogEntry[];
          }> = [];
          const interruptedIssues: number[] = [];

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const issueNumber = parseInt(entry.name, 10);
            if (Number.isNaN(issueNumber)) continue;

            const issueDir = path.join(issuesDir, entry.name);
            const stateFile = path.join(issueDir, 'investigation_state.json');

            if (!fs.existsSync(stateFile)) continue;

            try {
              const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
              const status = stateData.status;

              // If the investigation was in-progress when the app shut down, mark it as failed
              if (status === 'investigating') {
                // Check if there are saved session IDs for resume
                const sessions = stateData.sessions;
                const hasResumeSessions = sessions && typeof sessions === 'object' && Object.keys(sessions).length > 0;

                const item: (typeof persisted)[number] = {
                  issueNumber,
                  status: 'failed',
                  completedAt: stateData.completed_at ?? undefined,
                  specId: stateData.spec_id ?? stateData.linked_spec_id ?? undefined,
                  githubCommentId: stateData.github_comment_id ?? undefined,
                  postedAt: stateData.posted_at ?? undefined,
                  wasInterrupted: true,
                  hasResumeSessions,
                  activityLog: loadActivityLog(project.path, issueNumber),
                };

                // Try to load partial report if one exists
                const reportFile = path.join(issueDir, 'investigation_report.json');
                if (fs.existsSync(reportFile)) {
                  try {
                    const rawReport = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
                    item.report = needsTransformation(rawReport)
                      ? transformPythonReport(rawReport)
                      : rawReport;
                  } catch {
                          // Ignore corrupt report files
                  }
                }

                persisted.push(item);

                // Track for potential auto-resume (max 3 to prevent infinite loops)
                if (interruptedIssues.length < MAX_AUTO_RESUME) {
                  interruptedIssues.push(issueNumber);
                }
                continue;
              }

              // Skip cancelled investigations
              if (status === 'cancelled') continue;

              // For completed states, load and transform the report
              const reportFile = path.join(issueDir, 'investigation_report.json');
              let report: unknown | undefined;

              if (fs.existsSync(reportFile)) {
                try {
                  const rawReport = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
                  report = needsTransformation(rawReport)
                    ? transformPythonReport(rawReport)
                    : rawReport;
                } catch {
                        // Ignore corrupt report files
                }
              }

              persisted.push({
                issueNumber,
                status,
                report,
                completedAt: stateData.completed_at ?? undefined,
                specId: stateData.spec_id ?? stateData.linked_spec_id ?? undefined,
                githubCommentId: stateData.github_comment_id ?? undefined,
                postedAt: stateData.posted_at ?? undefined,
                wasInterrupted: false,
                activityLog: loadActivityLog(project.path, issueNumber),
              });
            } catch {
                    // Skip issues with corrupt state files
              debugLog('Skipping corrupt investigation state', { issueNumber });
            }
          }

          // Clean stale entries from activeInvestigations for interrupted issues.
          // After CTRL+R the main process keeps stale map entries for killed subprocesses
          // whose finally blocks never ran. Remove them so auto-resume isn't blocked.
          for (const issueNum of interruptedIssues) {
            const processKey = `${projectId}:${issueNum}`;
            const staleProcess = activeInvestigations.get(processKey);
            if (staleProcess) {
              debugLog('Cleaning stale activeInvestigation entry', { processKey, killed: staleProcess.killed });
              if (!staleProcess.killed) {
                try { staleProcess.kill(); } catch { /* already dead */ }
              }
              activeInvestigations.delete(processKey);
            }
          }

          // Schedule auto-resume for interrupted investigations after a delay.
          // Route through the queue to respect the parallel limit.
          if (interruptedIssues.length > 0) {
            debugLog('Scheduling auto-resume for interrupted investigations', {
              projectId,
              count: interruptedIssues.length,
              issues: interruptedIssues,
            });
            setTimeout(() => {
              for (const issueNum of interruptedIssues) {
                const processKey = `${projectId}:${issueNum}`;

                // Check max retry limit to prevent infinite loops
                const attempts = autoResumeAttempts.get(processKey) ?? 0;
                if (attempts >= MAX_AUTO_RESUME_ATTEMPTS) {
                  debugLog('Auto-resume: max attempts reached, skipping', { projectId, issueNumber: issueNum, attempts });
                  continue;
                }

                // Skip if already active or already queued (e.g. user manually started during delay)
                if (activeInvestigations.has(processKey)) {
                  debugLog('Auto-resume: skipping already-active investigation', { projectId, issueNumber: issueNum });
                  continue;
                }
                if (investigationQueue.some((q) => q.projectId === projectId && q.issueNumber === issueNum)) {
                  debugLog('Auto-resume: skipping already-queued investigation', { projectId, issueNumber: issueNum });
                  continue;
                }

                // Skip if the investigation folder was manually deleted by the user
                const issueDir = path.join(project.path, '.auto-claude', 'issues', String(issueNum));
                if (!fs.existsSync(issueDir)) {
                  debugLog('Auto-resume: investigation folder deleted by user, skipping', { projectId, issueNumber: issueNum });
                  continue;
                }

                // Increment attempt counter
                autoResumeAttempts.set(processKey, attempts + 1);
                debugLog('Auto-resuming interrupted investigation', { projectId, issueNumber: issueNum, attempt: attempts + 1 });
                investigationQueue.push({
                  projectId,
                  issueNumber: issueNum,
                  queuedAt: new Date().toISOString(),
                });
              }
              processQueue(getMainWindow, agentManager);
            }, AUTO_RESUME_DELAY_MS);
          }

          return { success: true, data: persisted };
        });

        return result ?? { success: true, data: [] };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load persisted investigations',
        };
      }
    },
  );

  // ============================================
  // 9. Load investigation logs from disk
  // ============================================
  ipcMain.handle(IPC_CHANNELS.GITHUB_INVESTIGATION_GET_LOGS, (_event, projectId: string, issueNumber: number) => {
    const project = projectStore.getProject(projectId);
    if (!project) return null;

    const logsPath = getInvestigationLogsPath(project.path, issueNumber);
    try {
      if (!fs.existsSync(logsPath)) return null;
      const raw = fs.readFileSync(logsPath, 'utf-8');
      return JSON.parse(raw) as InvestigationLogs;
    } catch {
            return null;
    }
  });

  debugLog('Investigation handlers registered');
}
