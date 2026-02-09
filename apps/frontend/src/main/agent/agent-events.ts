import { ExecutionProgressData } from './types';
import { parsePhaseEvent } from './phase-event-parser';
import {
  wouldPhaseRegress,
  isTerminalPhase,
  isPausePhase,
  isValidExecutionPhase,
  type ExecutionPhase
} from '../../shared/constants/phase-protocol';
import { EXECUTION_PHASE_WEIGHTS } from '../../shared/constants/task';

export class AgentEvents {
  parseExecutionPhase(
    log: string,
    currentPhase: ExecutionProgressData['phase'],
    isSpecRunner: boolean
  ): {
    phase: ExecutionProgressData['phase'];
    message?: string;
    currentSubtask?: string;
    resetTimestamp?: number;
    profileId?: string;
  } | null {
    const structuredEvent = parsePhaseEvent(log);
    if (structuredEvent) {
      // structuredEvent.phase is validated as BackendPhase (via Zod schema),
      // which is a subset of ExecutionPhase, so this assertion is safe
      const result: {
        phase: ExecutionProgressData['phase'];
        message?: string;
        currentSubtask?: string;
        resetTimestamp?: number;
        profileId?: string;
      } = {
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

    // Terminal states can't be changed by fallback matching
    if (isTerminalPhase(currentPhase)) {
      return null;
    }

    // Pause phases should only be changed by structured events
    // Don't allow fallback text matching to transition out of pause phases
    if (isPausePhase(currentPhase)) {
      return null;
    }

    // Ignore internal task logger events - they're not phase transitions
    if (log.includes('__TASK_LOG_')) {
      return null;
    }

    const checkRegression = (newPhase: string): boolean => {
      if (!isValidExecutionPhase(currentPhase) || !isValidExecutionPhase(newPhase)) {
        return true;
      }
      return wouldPhaseRegress(currentPhase, newPhase);
    };

    const lowerLog = log.toLowerCase();

    // Spec runner phase detection (all part of "planning")
    // IMPORTANT: Spec runner should NEVER transition to coding/qa phases via fallback matching
    if (isSpecRunner) {
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
      // Spec runner: don't fall through to run.py patterns (would incorrectly detect coding phase)
      return null;
    }

    // Run.py phase detection
    if (!checkRegression('planning') && (lowerLog.includes('planner agent') || lowerLog.includes('creating implementation plan'))) {
      return { phase: 'planning', message: 'Creating implementation plan...' };
    }

    // Coder agent running - don't regress from QA phases
    if (!checkRegression('coding') && (lowerLog.includes('coder agent') || lowerLog.includes('starting coder'))) {
      return { phase: 'coding', message: 'Implementing code changes...' };
    }

    // Subtask progress detection - only when in coding phase
    const subtaskMatch = log.match(/subtask[:\s]+(\d+(?:\/\d+)?|\w+[-_]\w+)/i);
    if (subtaskMatch && currentPhase === 'coding') {
      return { phase: 'coding', currentSubtask: subtaskMatch[1], message: `Working on subtask ${subtaskMatch[1]}...` };
    }

    // Subtask completion detection - don't regress from QA phases
    if (!checkRegression('coding') && (lowerLog.includes('subtask completed') || lowerLog.includes('subtask done'))) {
      const completedSubtask = log.match(/subtask[:\s]+"?([^"]+)"?\s+completed/i);
      return {
        phase: 'coding',
        currentSubtask: completedSubtask?.[1],
        message: `Subtask ${completedSubtask?.[1] || ''} completed`
      };
    }

    // QA phases require at least coding phase first (prevents false positives from early logs)
    const canEnterQAPhase = currentPhase === 'coding' || currentPhase === 'qa_review' || currentPhase === 'qa_fixing';

    // QA Review phase
    if (canEnterQAPhase && (lowerLog.includes('qa reviewer') || lowerLog.includes('qa_reviewer') || lowerLog.includes('starting qa'))) {
      return { phase: 'qa_review', message: 'Running QA review...' };
    }

    // QA Fixer phase
    if (canEnterQAPhase && (lowerLog.includes('qa fixer') || lowerLog.includes('qa_fixer') || lowerLog.includes('fixing issues'))) {
      return { phase: 'qa_fixing', message: 'Fixing QA issues...' };
    }

    // IMPORTANT: Don't set 'complete' phase via fallback text matching!
    // The "=== BUILD COMPLETE ===" banner is printed when SUBTASKS finish,
    // but QA hasn't run yet. Only the structured emit_phase(COMPLETE) from
    // QA approval (in qa/loop.py) should set the complete phase.
    // Removing this prevents the brief "Completed" flash before QA review.

    // Incomplete build detection - don't regress from QA phases
    if (!checkRegression('coding') && (lowerLog.includes('build incomplete') || lowerLog.includes('subtasks still pending'))) {
      return { phase: 'coding', message: 'Build paused - subtasks still pending' };
    }

    // Error/failure detection - be specific to avoid false positives from tool errors
    const isToolError = lowerLog.includes('tool error') || lowerLog.includes('tool_use_error');
    if (!isToolError && (lowerLog.includes('build failed') || lowerLog.includes('fatal error') || lowerLog.includes('agent failed'))) {
      return { phase: 'failed', message: log.trim().substring(0, 200) };
    }

    return null;
  }

  calculateOverallProgress(phase: ExecutionProgressData['phase'], phaseProgress: number): number {
    const phaseWeight = EXECUTION_PHASE_WEIGHTS[phase];
    if (!phaseWeight) {
      console.warn(`[AgentEvents] Unknown phase "${phase}" in calculateOverallProgress - defaulting to 0%`);
      return 0;
    }
    const phaseRange = phaseWeight.end - phaseWeight.start;
    return Math.round(phaseWeight.start + ((phaseRange * phaseProgress) / 100));
  }

  /**
   * Parse ideation progress from log output
   */
  parseIdeationProgress(
    log: string,
    currentPhase: string,
    currentProgress: number,
    completedTypes: Set<string>,
    totalTypes: number
  ): { phase: string; progress: number } {
    let phase = currentPhase;
    let progress = currentProgress;

    if (log.includes('PROJECT INDEX') || log.includes('PROJECT ANALYSIS')) {
      phase = 'analyzing';
      progress = 10;
    } else if (log.includes('CONTEXT GATHERING')) {
      phase = 'discovering';
      progress = 20;
    } else if (log.includes('GENERATING IDEAS (PARALLEL)') || (log.includes('Starting') && log.includes('ideation agents in parallel'))) {
      phase = 'generating';
      progress = 30;
    } else if (log.includes('MERGE') || log.includes('FINALIZE')) {
      phase = 'finalizing';
      progress = 90;
    } else if (log.includes('IDEATION COMPLETE')) {
      phase = 'complete';
      progress = 100;
    }

    // Update progress based on completed types during generation phase
    if (phase === 'generating' && completedTypes.size > 0) {
      // Progress from 30% to 90% based on completed types
      progress = 30 + Math.floor((completedTypes.size / totalTypes) * 60);
    }

    return { phase, progress };
  }

  /**
   * Parse roadmap progress from log output
   * Provides granular progress updates (8+ intermediate points) for better UX feedback
   */
  parseRoadmapProgress(log: string, currentPhase: string, currentProgress: number): { phase: string; progress: number } {
    // Define roadmap phase order to prevent regression
    const ROADMAP_PHASE_ORDER: Record<string, number> = {
      'idle': 0,
      'analyzing': 1,
      'discovering': 2,
      'generating': 3,
      'complete': 4,
      'error': 5,
    };

    const wouldRoadmapPhaseRegress = (current: string, next: string): boolean => {
      const currentOrder = ROADMAP_PHASE_ORDER[current] ?? -1;
      const nextOrder = ROADMAP_PHASE_ORDER[next] ?? -1;
      // Allow progression to error from any phase, but otherwise prevent regression
      if (next === 'error') return false;
      return nextOrder < currentOrder;
    };

    let phase = currentPhase;
    let progress = currentProgress;
    let detectedPhase = currentPhase;

    // Phase 1: Project Analysis (10-25%)
    if (log.includes('PROJECT ANALYSIS')) {
      detectedPhase = 'analyzing';
      progress = 10;
    } else if (log.includes('Copied existing project_index')) {
      detectedPhase = 'analyzing';
      progress = 15;
    } else if (log.includes('Running project analyzer')) {
      detectedPhase = 'analyzing';
      progress = 20;
    } else if (log.includes('project_index.json already exists')) {
      detectedPhase = 'analyzing';
      progress = 22;
    } else if (log.includes('Created project_index')) {
      detectedPhase = 'analyzing';
      progress = 25;
    }

    // Phase 2: Discovery (30-50%)
    else if (log.includes('PROJECT DISCOVERY')) {
      detectedPhase = 'discovering';
      progress = 30;
    } else if (log.includes('Analyzing project')) {
      detectedPhase = 'discovering';
      progress = 35;
    } else if (log.includes('Running discovery agent')) {
      detectedPhase = 'discovering';
      progress = 40;
    } else if (log.includes('Discovery attempt')) {
      detectedPhase = 'discovering';
      progress = 45;
    } else if (
      log.includes('roadmap_discovery.json') &&
      !log.toLowerCase().includes('failed') &&
      !log.toLowerCase().includes('error')
    ) {
      detectedPhase = 'discovering';
      progress = 50;
    }

    // Phase 3: Feature Generation (55-95%)
    else if (log.includes('FEATURE GENERATION')) {
      detectedPhase = 'generating';
      progress = 55;
    } else if (log.includes('Generating features')) {
      detectedPhase = 'generating';
      progress = 60;
    } else if (log.includes('Features attempt')) {
      detectedPhase = 'generating';
      progress = 65;
    } else if (log.includes('Prioritizing features')) {
      detectedPhase = 'generating';
      progress = 75;
    } else if (log.includes('Creating roadmap file')) {
      detectedPhase = 'generating';
      progress = 85;
    } else if (log.includes('Created valid roadmap')) {
      detectedPhase = 'generating';
      progress = 90;
    }

    // Complete
    else if (log.includes('ROADMAP GENERATED')) {
      detectedPhase = 'complete';
      progress = 100;
    }

    // Apply phase only if it doesn't regress (prevents visual inconsistency)
    if (!wouldRoadmapPhaseRegress(currentPhase, detectedPhase)) {
      phase = detectedPhase;
    }

    // Ensure progress only moves forward (never backward) and stays within bounds (0-100)
    progress = Math.min(100, Math.max(progress, currentProgress));

    return { phase, progress };
  }
}
