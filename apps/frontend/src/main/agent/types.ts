import { ChildProcess } from 'child_process';
import type { CompletablePhase, ExecutionPhase } from '../../shared/constants/phase-protocol';
import type { TaskEventPayload } from './task-event-schema';

/**
 * Agent-specific types for process and state management
 */

export type QueueProcessType = 'ideation' | 'roadmap';

export interface AgentProcess {
  taskId: string;
  process: ChildProcess | null; // null during async spawn setup before ChildProcess is created
  startedAt: Date;
  projectPath?: string; // For ideation processes to load session on completion
  spawnId: number; // Unique ID to identify this specific spawn
  queueProcessType?: QueueProcessType; // Type of queue process (ideation or roadmap)
}

export interface ExecutionProgressData {
  phase: ExecutionPhase;
  phaseProgress: number;
  overallProgress: number;
  currentSubtask?: string;
  message?: string;
  // FIX (ACS-203): Track completed phases to prevent phase overlaps
  completedPhases?: CompletablePhase[];
}

export type ProcessType = 'spec-creation' | 'task-execution' | 'qa-process';

export interface AgentManagerEvents {
  log: (taskId: string, log: string, projectId?: string) => void;
  error: (taskId: string, error: string, projectId?: string) => void;
  exit: (taskId: string, code: number | null, processType: ProcessType, projectId?: string) => void;
  'execution-progress': (taskId: string, progress: ExecutionProgressData, projectId?: string) => void;
  'task-event': (taskId: string, event: TaskEventPayload, projectId?: string) => void;
}

// IdeationConfig now imported from shared types to maintain consistency

export interface RoadmapConfig {
  model?: string;          // Model shorthand (opus, sonnet, haiku)
  thinkingLevel?: string;  // Thinking level (low, medium, high)
}

export interface TaskExecutionOptions {
  parallel?: boolean;
  workers?: number;
  baseBranch?: string;
  useWorktree?: boolean; // If false, use --direct mode (no worktree isolation)
  useLocalBranch?: boolean; // If true, use local branch directly instead of preferring origin/branch
}

export interface SpecCreationMetadata {
  requireReviewBeforeCoding?: boolean;
  // Auto profile - phase-based model and thinking configuration
  isAutoProfile?: boolean;
  phaseModels?: {
    spec: 'haiku' | 'sonnet' | 'opus' | 'opus-1m' | 'opus-4.5';
    planning: 'haiku' | 'sonnet' | 'opus' | 'opus-1m' | 'opus-4.5';
    coding: 'haiku' | 'sonnet' | 'opus' | 'opus-1m' | 'opus-4.5';
    qa: 'haiku' | 'sonnet' | 'opus' | 'opus-1m' | 'opus-4.5';
  };
  phaseThinking?: {
    spec: 'low' | 'medium' | 'high';
    planning: 'low' | 'medium' | 'high';
    coding: 'low' | 'medium' | 'high';
    qa: 'low' | 'medium' | 'high';
  };
  // Non-auto profile - single model and thinking level
  model?: 'haiku' | 'sonnet' | 'opus' | 'opus-1m' | 'opus-4.5';
  thinkingLevel?: 'low' | 'medium' | 'high';
  // Workspace mode - whether to use worktree isolation
  useWorktree?: boolean; // If false, use --direct mode (no worktree isolation)
  useLocalBranch?: boolean; // If true, use local branch directly instead of preferring origin/branch
}

export interface IdeationProgressData {
  phase: string;
  progress: number;
  message: string;
  completedTypes?: string[];
}

export interface RoadmapProgressData {
  phase: string;
  progress: number;
  message: string;
}
