/**
 * get_build_progress Tool
 * =======================
 *
 * Reports current build progress from implementation_plan.json.
 * See apps/desktop/src/main/ai/tools/auto-claude/get-build-progress.ts for the TypeScript implementation.
 *
 * Tool name: mcp__auto-claude__get_build_progress
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { safeParseJson } from '../../../utils/json-repair';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema (no parameters required)
// ---------------------------------------------------------------------------

const inputSchema = z.object({});

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface PlanSubtask {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
}

interface PlanPhase {
  id?: string;
  phase?: number;
  name?: string;
  subtasks?: PlanSubtask[];
}

interface ImplementationPlan {
  phases?: PlanPhase[];
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const getBuildProgressTool = Tool.define({
  metadata: {
    name: 'mcp__auto-claude__get_build_progress',
    description:
      'Get the current build progress including completed subtasks, pending subtasks, and next subtask to work on.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: (_input, context) => {
    const planFile = path.join(context.specDir, 'implementation_plan.json');

    if (!fs.existsSync(planFile)) {
      return 'No implementation plan found. Run the planner first.';
    }

    let plan: ImplementationPlan;
    const raw = fs.readFileSync(planFile, 'utf-8');
    const parsed = safeParseJson<ImplementationPlan>(raw);
    if (!parsed) {
      return 'Error reading build progress: Invalid JSON in implementation_plan.json';
    }
    plan = parsed;

    const stats = { total: 0, completed: 0, in_progress: 0, pending: 0, failed: 0 };
    const phasesSummary: string[] = [];
    let nextSubtask: { id?: string; description?: string; phase?: string } | null = null;

    for (const phase of plan.phases ?? []) {
      const phaseId = phase.id ?? String(phase.phase ?? '');
      const phaseName = phase.name ?? phaseId;
      const subtasks = phase.subtasks ?? [];

      let phaseCompleted = 0;

      for (const subtask of subtasks) {
        stats.total++;
        const status = subtask.status ?? 'pending';

        if (status === 'completed') {
          stats.completed++;
          phaseCompleted++;
        } else if (status === 'in_progress') {
          stats.in_progress++;
        } else if (status === 'failed') {
          stats.failed++;
        } else {
          stats.pending++;
          if (!nextSubtask) {
            nextSubtask = { id: subtask.id, description: subtask.description, phase: phaseName };
          }
        }
      }

      phasesSummary.push(`  ${phaseName}: ${phaseCompleted}/${subtasks.length}`);
    }

    const progressPct = stats.total > 0
      ? ((stats.completed / stats.total) * 100).toFixed(0)
      : '0';

    let result =
      `Build Progress: ${stats.completed}/${stats.total} subtasks (${progressPct}%)\n\n` +
      `Status breakdown:\n` +
      `  Completed: ${stats.completed}\n` +
      `  In Progress: ${stats.in_progress}\n` +
      `  Pending: ${stats.pending}\n` +
      `  Failed: ${stats.failed}\n\n` +
      `Phases:\n${phasesSummary.join('\n')}`;

    if (nextSubtask) {
      result +=
        `\n\nNext subtask to work on:\n` +
        `  ID: ${nextSubtask.id ?? 'unknown'}\n` +
        `  Phase: ${nextSubtask.phase ?? 'unknown'}\n` +
        `  Description: ${nextSubtask.description ?? 'No description'}`;
    } else if (stats.completed === stats.total && stats.total > 0) {
      result += '\n\nAll subtasks completed! Build is ready for QA.';
    }

    return result;
  },
});
