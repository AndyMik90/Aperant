/**
 * Investigation data handlers for GitHub-sourced tasks
 *
 * Provides access to investigation report data for tasks created from GitHub issues.
 */

import { ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { InvestigationData } from '../../../shared/types/investigation';
import { findTaskAndProject } from './shared';

type RawRecord = Record<string, unknown>;

function isObject(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
}

function normalizeSeverity(value: unknown): 'critical' | 'high' | 'medium' | 'low' {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

function normalizeFixComplexity(value: unknown): 'simple' | 'standard' | 'complex' {
  if (value === 'simple') return 'simple';
  if (value === 'complex') return 'complex';
  return 'standard';
}

function normalizeReproducible(value: unknown): boolean | 'unknown' {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (normalized === 'yes' || normalized === 'true' || normalized === 'likely') return true;
  if (normalized === 'no' || normalized === 'false' || normalized === 'unlikely') return false;
  return 'unknown';
}

function normalizeInvestigationReport(rawReport: unknown): Omit<InvestigationData, 'reportPath'> {
  if (!isObject(rawReport)) {
    return {
      rootCause: {
        agentType: 'root_cause',
        summary: '',
        findings: [],
        codeReferences: [],
        rootCause: '',
        codePaths: [],
        relatedIssues: [],
      },
      impact: {
        agentType: 'impact',
        summary: '',
        findings: [],
        codeReferences: [],
        severity: 'medium',
        affectedComponents: [],
        userImpact: '',
        riskIfUnfixed: '',
      },
      fixAdvice: {
        agentType: 'fix_advisor',
        summary: '',
        findings: [],
        codeReferences: [],
        suggestedApproaches: [],
        recommendedApproach: 0,
        patternsToFollow: [],
      },
      reproduction: {
        agentType: 'reproducer',
        summary: '',
        findings: [],
        codeReferences: [],
        reproducible: 'unknown',
        existingTests: [],
        testGaps: [],
        suggestedTests: [],
      },
      summary: '',
      severity: 'medium',
      suggestedLabels: [],
      likelyResolved: false,
      linkedPRs: [],
      timestamp: new Date().toISOString(),
    };
  }

  const hasSnakeCase =
    rawReport.root_cause !== undefined
    || rawReport.fix_advice !== undefined
    || rawReport.ai_summary !== undefined
    || rawReport.likely_resolved !== undefined;

  if (!hasSnakeCase) {
    return {
      rootCause: (rawReport.rootCause as InvestigationData['rootCause']) ?? {
        agentType: 'root_cause',
        summary: '',
        findings: [],
        codeReferences: [],
        rootCause: '',
        codePaths: [],
        relatedIssues: [],
      },
      impact: (rawReport.impact as InvestigationData['impact']) ?? {
        agentType: 'impact',
        summary: '',
        findings: [],
        codeReferences: [],
        severity: 'medium',
        affectedComponents: [],
        userImpact: '',
        riskIfUnfixed: '',
      },
      fixAdvice: (rawReport.fixAdvice as InvestigationData['fixAdvice']) ?? {
        agentType: 'fix_advisor',
        summary: '',
        findings: [],
        codeReferences: [],
        suggestedApproaches: [],
        recommendedApproach: 0,
        patternsToFollow: [],
      },
      reproduction: (rawReport.reproduction as InvestigationData['reproduction']) ?? {
        agentType: 'reproducer',
        summary: '',
        findings: [],
        codeReferences: [],
        reproducible: 'unknown',
        existingTests: [],
        testGaps: [],
        suggestedTests: [],
      },
      summary: (rawReport.summary as string) ?? '',
      severity: normalizeSeverity(rawReport.severity),
      suggestedLabels: (rawReport.suggestedLabels as InvestigationData['suggestedLabels']) ?? [],
      likelyResolved: Boolean(rawReport.likelyResolved),
      linkedPRs: (rawReport.linkedPRs as InvestigationData['linkedPRs']) ?? [],
      timestamp: (rawReport.timestamp as string) ?? new Date().toISOString(),
    };
  }

  const rootCauseRaw = isObject(rawReport.root_cause) ? rawReport.root_cause : {};
  const impactRaw = isObject(rawReport.impact) ? rawReport.impact : {};
  const fixAdviceRaw = isObject(rawReport.fix_advice) ? rawReport.fix_advice : {};
  const reproductionRaw = isObject(rawReport.reproduction) ? rawReport.reproduction : {};
  const testCoverageRaw = isObject(reproductionRaw.test_coverage) ? reproductionRaw.test_coverage : {};

  const codePathRefs = Array.isArray(rootCauseRaw.code_paths)
    ? rootCauseRaw.code_paths
      .filter(isObject)
      .map((codePath) => ({
        file: String(codePath.file ?? ''),
        line: typeof codePath.start_line === 'number' ? codePath.start_line : undefined,
        endLine: typeof codePath.end_line === 'number' ? codePath.end_line : undefined,
        description: String(codePath.description ?? ''),
      }))
    : [];

  const approachEntries = Array.isArray(fixAdviceRaw.approaches)
    ? fixAdviceRaw.approaches.filter(isObject)
    : [];
  const recommendedApproach =
    typeof fixAdviceRaw.recommended_approach === 'number'
      ? fixAdviceRaw.recommended_approach
      : 0;
  const recommended = approachEntries[recommendedApproach] ?? approachEntries[0];
  const patternsToFollow = Array.isArray(fixAdviceRaw.patterns_to_follow)
    ? fixAdviceRaw.patterns_to_follow
      .filter(isObject)
      .map((pattern) => {
        const file = String(pattern.file ?? '').trim();
        const description = String(pattern.description ?? '').trim();
        return [file, description].filter(Boolean).join(': ');
      })
      .filter((entry) => entry.length > 0)
    : [];

  const reproductionCoverage = String(testCoverageRaw.coverage_assessment ?? '').trim();
  const relatedTestFiles = toStringArray(reproductionRaw.related_test_files);
  const existingTests = Array.from(
    new Set([...toStringArray(testCoverageRaw.test_files), ...relatedTestFiles]),
  );
  const suggestedTestApproach = String(reproductionRaw.suggested_test_approach ?? '').trim();

  return {
    rootCause: {
      agentType: 'root_cause',
      summary: String(rootCauseRaw.identified_root_cause ?? ''),
      findings: [
        ...toStringArray(rootCauseRaw.related_issues),
        String(rootCauseRaw.evidence ?? '').trim(),
      ].filter((entry) => entry.length > 0),
      codeReferences: codePathRefs,
      rootCause: String(rootCauseRaw.identified_root_cause ?? ''),
      codePaths: codePathRefs.map((ref) => ref.file).filter((file) => file.length > 0),
      relatedIssues: [],
    },
    impact: {
      agentType: 'impact',
      summary: `Severity: ${normalizeSeverity(impactRaw.severity)}. ${String(impactRaw.blast_radius ?? '')}`.trim(),
      findings: [
        String(impactRaw.user_impact ?? '').trim(),
        String(impactRaw.regression_risk ?? '').trim(),
      ].filter((entry) => entry.length > 0),
      codeReferences: [],
      severity: normalizeSeverity(impactRaw.severity),
      affectedComponents: Array.isArray(impactRaw.affected_components)
        ? impactRaw.affected_components
          .filter(isObject)
          .map((component) => String(component.component ?? component.file ?? '').trim())
          .filter((entry) => entry.length > 0)
        : [],
      userImpact: String(impactRaw.user_impact ?? ''),
      riskIfUnfixed: String(impactRaw.regression_risk ?? ''),
    },
    fixAdvice: {
      agentType: 'fix_advisor',
      summary: String(recommended?.description ?? ''),
      findings: toStringArray(fixAdviceRaw.gotchas),
      codeReferences: [],
      suggestedApproaches: approachEntries.map((approach, index) => ({
        title: `Approach ${index + 1}`,
        description: String(approach.description ?? ''),
        filesToModify: toStringArray(approach.files_affected),
        complexity: normalizeFixComplexity(approach.complexity),
        risks: toStringArray(approach.cons),
      })),
      recommendedApproach,
      patternsToFollow,
    },
    reproduction: {
      agentType: 'reproducer',
      summary: `Reproducible: ${String(reproductionRaw.reproducible ?? 'unknown')}`.trim(),
      findings: toStringArray(reproductionRaw.reproduction_steps),
      codeReferences: [],
      reproducible: normalizeReproducible(reproductionRaw.reproducible),
      reproductionSteps: toStringArray(reproductionRaw.reproduction_steps),
      existingTests,
      testGaps: reproductionCoverage ? [reproductionCoverage] : [],
      suggestedTests: suggestedTestApproach ? [suggestedTestApproach] : [],
    },
    summary: String(rawReport.ai_summary ?? ''),
    severity: normalizeSeverity(rawReport.severity),
    suggestedLabels: Array.isArray(rawReport.suggested_labels)
      ? rawReport.suggested_labels
        .filter(isObject)
        .map((label) => ({
          name: String(label.name ?? ''),
          reason: String(label.reason ?? ''),
          accepted: typeof label.accepted === 'boolean' ? label.accepted : undefined,
        }))
      : [],
    likelyResolved: Boolean(rawReport.likely_resolved),
    linkedPRs: Array.isArray(rawReport.linked_prs)
      ? rawReport.linked_prs
        .filter(isObject)
        .map((pr) => ({
          number: Number(pr.number ?? 0),
          title: String(pr.title ?? ''),
          state:
            pr.status === 'merged' || pr.status === 'closed' || pr.status === 'open'
              ? pr.status
              : (pr.state === 'merged' || pr.state === 'closed' || pr.state === 'open'
                ? pr.state
                : 'open'),
          url: String(pr.url ?? ''),
        }))
      : [],
    timestamp: String(rawReport.timestamp ?? new Date().toISOString()),
  };
}

/**
 * Register investigation data handlers
 */
export function registerTaskInvestigationHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.TASK_GET_INVESTIGATION_DATA,
    async (_event, taskId: string): Promise<IPCResult<InvestigationData | null>> => {
      try {
        const { task, project } = findTaskAndProject(taskId);

        if (!task || !project || task.metadata?.sourceType !== 'github') {
          return { success: true, data: null };
        }

        // Find the spec directory
        const specsDir = path.join(project.path, '.auto-claude', 'specs');
        const specDir = path.join(specsDir, task.specId);

        const reportPath = path.join(specDir, 'investigation_report.json');

        if (!existsSync(reportPath)) {
          return { success: true, data: null };
        }

        const reportContent = readFileSync(reportPath, 'utf-8');
        const report = JSON.parse(reportContent);
        const normalizedReport = normalizeInvestigationReport(report);

        // Return structured data for the UI
        return {
          success: true,
          data: {
            ...normalizedReport,
            reportPath,
          },
        };
      } catch (error) {
        console.error('Error loading investigation data:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load investigation data',
        };
      }
    },
  );
}
