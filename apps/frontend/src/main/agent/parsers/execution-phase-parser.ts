/**
 * Execution Phase Parser
 * =======================
 * Parses task execution phases from log output.
 * Handles both structured events and fallback text matching.
 */

import { BasePhaseParser, type PhaseParseResult, type PhaseParserContext } from './base-phase-parser';
import {
  EXECUTION_PHASES,
  TERMINAL_PHASES,
  isPausePhase,
  type ExecutionPhase
} from '../../../shared/constants/phase-protocol';
import { parsePhaseEvent } from '../phase-event-parser';

/**
 * Context for execution phase parsing.
 * Extends base context with spec runner flag.
 */
export interface ExecutionParserContext extends PhaseParserContext<ExecutionPhase> {
  isSpecRunner: boolean;
}

/**
 * Parser for task execution phases.
 * Handles the planning → coding → qa_review → qa_fixing → complete flow.
 */
export class ExecutionPhaseParser extends BasePhaseParser<ExecutionPhase> {
  protected readonly phaseOrder = EXECUTION_PHASES;
  protected readonly terminalPhases = TERMINAL_PHASES;

  /**
   * Parse execution phase from log line.
   *
   * @param log - The log line to parse
   * @param context - Execution parser context
   * @returns Phase result or null
   */
  parse(log: string, context: ExecutionParserContext): PhaseParseResult<ExecutionPhase> | null {
    // 1. Try structured event first (authoritative source)
    const structuredEvent = parsePhaseEvent(log);
    if (structuredEvent) {
      const result: PhaseParseResult<ExecutionPhase> = {
        phase: structuredEvent.phase as ExecutionPhase,
        message: structuredEvent.message,
        currentSubtask: structuredEvent.subtask
      };

      // Include pause phase metadata if present
      if (structuredEvent.reset_timestamp !== undefined) {
        result.resetTimestamp = structuredEvent.reset_timestamp;
      }
      if (structuredEvent.profile_id !== undefined) {
        result.profileId = structuredEvent.profile_id;
      }

      return result;
    }

    // 2. Terminal states can't be changed by fallback matching
    if (this.isTerminal(context.currentPhase)) {
      return null;
    }

    // 3. Pause phases should only be changed by structured events
    // Don't allow fallback text matching to transition out of pause phases
    if (isPausePhase(context.currentPhase)) {
      return null;
    }

    // 4. Fall back to text pattern matching
    return this.parseFallbackPatterns(log, context);
  }

  /**
   * Parse phase from text patterns when no structured event is found.
   * Implements regression prevention for all phase transitions.
   */
  private parseFallbackPatterns(
    log: string,
    context: ExecutionParserContext
  ): PhaseParseResult<ExecutionPhase> | null {
    // Ignore internal task logger events
    if (log.includes('__TASK_LOG_')) {
      return null;
    }

    const lowerLog = log.toLowerCase();
    const { currentPhase, isSpecRunner } = context;

    // Spec runner phase detection (all part of "planning")
    if (isSpecRunner) {
      return this.parseSpecRunnerPhase(lowerLog);
    }

    // Run.py phase detection
    return this.parseRunPhase(lowerLog, log, currentPhase);
  }

  /**
   * Parse phases for spec_runner.py execution.
   * All spec runner phases map to 'planning'.
   */
  private parseSpecRunnerPhase(lowerLog: string): PhaseParseResult<ExecutionPhase> | null {
    if (lowerLog.includes('discovering') || lowerLog.includes('discovery')) {
      return { phase: 'planning', message: 'Discovering project context...' };
    }
    if (lowerLog.includes('requirements') || lowerLog.includes('gathering')) {
      return { phase: 'planning', message: 'Gathering requirements...' };
    }
    if (lowerLog.includes('writing spec') || lowerLog.includes('spec writer')) {
      return { phase: 'planning', message: 'Writing specification...' };
    }
    if (lowerLog.includes('validating') || lowerLog.includes('validation')) {
      return { phase: 'planning', message: 'Validating specification...' };
    }
    if (lowerLog.includes('spec complete') || lowerLog.includes('specification complete')) {
      return { phase: 'planning', message: 'Specification complete' };
    }

    return null;
  }

  /**
   * Parse phases for run.py execution.
   * Handles the full build pipeline phases.
   */
  private parseRunPhase(
    lowerLog: string,
    originalLog: string,
    currentPhase: ExecutionPhase
  ): PhaseParseResult<ExecutionPhase> | null {
    // Planning phase
    if (
      !this.wouldRegress(currentPhase, 'planning') &&
      (lowerLog.includes('planner agent') || lowerLog.includes('creating implementation plan'))
    ) {
      return { phase: 'planning', message: 'Creating implementation plan...' };
    }

    // Coding phase - don't regress from QA phases
    if (
      !this.wouldRegress(currentPhase, 'coding') &&
      (lowerLog.includes('coder agent') || lowerLog.includes('starting coder'))
    ) {
      return { phase: 'coding', message: 'Implementing code changes...' };
    }

    // Subtask progress detection - only when in coding phase
    const subtaskMatch = originalLog.match(/subtask[:\s]+(\d+(?:\/\d+)?|\w+[-_]\w+)/i);
    if (subtaskMatch && currentPhase === 'coding') {
      return {
        phase: 'coding',
        currentSubtask: subtaskMatch[1],
        message: `Working on subtask ${subtaskMatch[1]}...`
      };
    }

    // Subtask completion detection
    if (
      !this.wouldRegress(currentPhase, 'coding') &&
      (lowerLog.includes('subtask completed') || lowerLog.includes('subtask done'))
    ) {
      const completedSubtask = originalLog.match(/subtask[:\s]+"?([^"]+)"?\s+completed/i);
      return {
        phase: 'coding',
        currentSubtask: completedSubtask?.[1],
        message: `Subtask ${completedSubtask?.[1] || ''} completed`
      };
    }

    // QA phases require at least coding phase to be completed first
    // This prevents false positives from early log messages mentioning QA
    const canEnterQAPhase = currentPhase === 'coding' || currentPhase === 'qa_review' || currentPhase === 'qa_fixing';

    // QA Fixer phase (check before QA reviewer - more specific pattern)
    if (
      canEnterQAPhase &&
      (lowerLog.includes('qa fixer') ||
       lowerLog.includes('qa_fixer') ||
       lowerLog.includes('fixing issues'))
    ) {
      return { phase: 'qa_fixing', message: 'Fixing QA issues...' };
    }

    // QA Review phase
    if (
      canEnterQAPhase &&
      (lowerLog.includes('qa reviewer') ||
       lowerLog.includes('qa_reviewer') ||
       lowerLog.includes('starting qa'))
    ) {
      return { phase: 'qa_review', message: 'Running QA review...' };
    }

    // IMPORTANT: Don't set 'complete' phase via fallback text matching!
    // The "=== BUILD COMPLETE ===" banner is printed when SUBTASKS finish,
    // but QA hasn't run yet. Only the structured emit_phase(COMPLETE) from
    // QA approval (in qa/loop.py) should set the complete phase.

    // Incomplete build detection
    if (
      !this.wouldRegress(currentPhase, 'coding') &&
      (lowerLog.includes('build incomplete') || lowerLog.includes('subtasks still pending'))
    ) {
      return { phase: 'coding', message: 'Build paused - subtasks still pending' };
    }

    // Error/failure detection - be specific to avoid false positives
    const isToolError = lowerLog.includes('tool error') || lowerLog.includes('tool_use_error');
    if (
      !isToolError &&
      (lowerLog.includes('build failed') ||
        lowerLog.includes('fatal error') ||
        lowerLog.includes('agent failed'))
    ) {
      return { phase: 'failed', message: originalLog.trim().substring(0, 200) };
    }

    return null;
  }
}
