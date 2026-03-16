/**
 * Framework Router
 * ================
 *
 * Routes task execution to the appropriate agent framework based on
 * the `agentFramework` setting in AppSettings.
 *
 * Aperant's pipeline has 4 phases: spec -> planning -> coding -> qa.
 * Different frameworks handle these differently:
 *
 * | Framework     | Spec/Planning        | Coding                | QA            |
 * |--------------|---------------------|-----------------------|---------------|
 * | auto-claude  | Aperant AI SDK      | Aperant AI SDK        | Aperant AI SDK|
 * | jules        | Aperant AI SDK      | Jules (cloud VM)      | Jules         |
 * | claude-code  | Aperant AI SDK      | claude -p (local)     | claude -p     |
 * | gemini       | Aperant AI SDK      | gemini -p (local)     | gemini -p     |
 * | antigravity  | Antigravity MCP     | Aperant AI SDK        | Aperant AI SDK|
 * | custom       | Aperant AI SDK      | custom command        | custom command|
 *
 * The key insight: spec creation and planning always run locally (they need
 * filesystem access to read the codebase and write specs). Only the coding
 * and QA phases can be delegated to external agents.
 *
 * Exception: Antigravity is used for planning/roadmap because it has
 * multi-model routing built in (Gemini PM pattern).
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readSettingsFile } from '../settings-utils';
import type { AppSettings } from '../../shared/types';
import { dispatchToJules, type JulesDispatchResult } from './jules-dispatcher';

export type AgentFramework = 'auto-claude' | 'jules' | 'claude-code' | 'gemini' | 'antigravity' | 'custom';
export type PipelinePhase = 'spec' | 'planning' | 'coding' | 'qa';

export interface FrameworkDecision {
  /** Which framework handles this phase */
  framework: AgentFramework;
  /** Whether to use the built-in Aperant worker (true) or external dispatch (false) */
  useBuiltinWorker: boolean;
  /** For external dispatch: the command to run */
  externalCommand?: string;
  /** For external dispatch: command arguments */
  externalArgs?: string[];
  /** Additional environment variables */
  extraEnv?: Record<string, string>;
}

/**
 * Read the current agentFramework setting.
 */
export function getAgentFramework(): AgentFramework {
  const settings = readSettingsFile() as unknown as AppSettings | null;
  return (settings?.agentFramework as AgentFramework) || 'auto-claude';
}

/**
 * Determine how a given pipeline phase should be executed
 * based on the configured agent framework.
 */
export function routePhase(phase: PipelinePhase): FrameworkDecision {
  const framework = getAgentFramework();
  const settings = readSettingsFile() as unknown as AppSettings | null;

  // Spec creation always runs locally via Aperant's built-in worker
  // (needs filesystem access to analyze the codebase)
  if (phase === 'spec') {
    // Exception: Antigravity for planning/spec (has multi-model routing built in)
    if (framework === 'antigravity') {
      return {
        framework: 'antigravity',
        useBuiltinWorker: false,
        externalCommand: 'node',
        externalArgs: ['E:/Work/antigravity-mcp-server/dist/index.js'],
        extraEnv: {},
      };
    }
    return { framework: 'auto-claude', useBuiltinWorker: true };
  }

  // Planning phase: local for most, Antigravity for antigravity
  if (phase === 'planning') {
    if (framework === 'antigravity') {
      return {
        framework: 'antigravity',
        useBuiltinWorker: false,
        externalCommand: 'node',
        externalArgs: ['E:/Work/antigravity-mcp-server/dist/index.js'],
      };
    }
    return { framework: 'auto-claude', useBuiltinWorker: true };
  }

  // Coding and QA phases: routed based on framework
  switch (framework) {
    case 'auto-claude':
      return { framework, useBuiltinWorker: true };

    case 'jules':
      return {
        framework,
        useBuiltinWorker: false,
        externalCommand: 'jules',
        externalArgs: ['new', ...(settings?.julesDefaultRepo ? ['--repo', settings.julesDefaultRepo] : [])],
        extraEnv: settings?.julesApiKey ? { JULES_API_KEY: settings.julesApiKey } : {},
      };

    case 'claude-code':
      return {
        framework,
        useBuiltinWorker: false,
        externalCommand: 'claude',
        externalArgs: ['-p', '--permission-mode', 'bypassPermissions', '--allowedTools', 'Bash,Edit,Read,Write,Glob,Grep'],
      };

    case 'gemini':
      return {
        framework,
        useBuiltinWorker: false,
        externalCommand: 'gemini',
        externalArgs: ['-p'],
      };

    case 'antigravity':
      // For coding phase, Antigravity falls back to Aperant
      // (Antigravity is best for planning, not code execution)
      return { framework: 'auto-claude', useBuiltinWorker: true };

    case 'custom':
      const customCmd = settings?.customAgentCommand?.split(' ') ?? ['echo', 'No custom command configured'];
      return {
        framework,
        useBuiltinWorker: false,
        externalCommand: customCmd[0],
        externalArgs: customCmd.slice(1),
      };

    default:
      return { framework: 'auto-claude', useBuiltinWorker: true };
  }
}

/**
 * Execute a task via an external framework (non-Aperant).
 * Spawns the external command with the task prompt piped via argument or stdin.
 *
 * @param decision - The framework routing decision
 * @param prompt - The task description / spec content
 * @param cwd - Working directory for the command
 * @param emitter - EventEmitter for progress/error events
 * @param taskId - Task ID for event correlation
 * @returns Promise resolving when the external process completes
 */
export async function executeExternal(
  decision: FrameworkDecision,
  prompt: string,
  cwd: string,
  emitter: EventEmitter,
  taskId: string,
  projectId?: string,
): Promise<{ success: boolean; output: string }> {
  if (!decision.externalCommand) {
    return { success: false, output: 'No external command configured' };
  }

  // Special handling for Jules (uses dispatch function with structured API)
  if (decision.framework === 'jules') {
    const settings = readSettingsFile() as unknown as AppSettings | null;
    if (settings) {
      emitter.emit('log', taskId, `[FrameworkRouter] Dispatching to Jules: ${prompt.substring(0, 100)}...`, projectId);
      emitter.emit('execution-progress', taskId, {
        phase: 'coding',
        phaseProgress: 10,
        overallProgress: 30,
        message: 'Dispatching task to Jules (Google Cloud)...',
      }, projectId);

      const result = await dispatchToJules(prompt, settings, cwd);

      if (result.success) {
        emitter.emit('log', taskId, `[FrameworkRouter] Jules session created: ${result.sessionId}`, projectId);
        emitter.emit('execution-progress', taskId, {
          phase: 'coding',
          phaseProgress: 100,
          overallProgress: 50,
          message: `Jules session ${result.sessionId} created. Task running in cloud VM.`,
        }, projectId);
      } else {
        emitter.emit('error', taskId, `Jules dispatch failed: ${result.error}`, projectId);
      }

      return { success: result.success, output: result.output };
    }
  }

  // Generic external command execution
  return new Promise((resolve) => {
    const args = [...(decision.externalArgs ?? [])];

    // For CLI tools that accept prompt as argument (claude -p, gemini -p)
    if (decision.framework === 'claude-code' || decision.framework === 'gemini') {
      args.push(prompt);
    }

    emitter.emit('log', taskId, `[FrameworkRouter] Executing: ${decision.externalCommand} ${args.join(' ').substring(0, 100)}...`, projectId);
    emitter.emit('execution-progress', taskId, {
      phase: 'coding',
      phaseProgress: 10,
      overallProgress: 30,
      message: `Running via ${decision.framework}...`,
    }, projectId);

    const child = spawn(decision.externalCommand!, args, {
      cwd,
      env: { ...process.env, ...(decision.extraEnv ?? {}) },
      shell: true,
    });

    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      emitter.emit('log', taskId, chunk, projectId);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      emitter.emit('log', taskId, `[stderr] ${chunk}`, projectId);
    });

    // For custom commands, pipe the prompt to stdin
    if (decision.framework === 'custom') {
      child.stdin?.write(prompt);
      child.stdin?.end();
    }

    child.on('error', (err: Error) => {
      emitter.emit('error', taskId, `${decision.framework} failed: ${err.message}`, projectId);
      resolve({ success: false, output: err.message });
    });

    child.on('close', (code: number | null) => {
      const success = code === 0;
      emitter.emit('execution-progress', taskId, {
        phase: success ? 'completed' : 'failed',
        phaseProgress: success ? 100 : 0,
        overallProgress: success ? 100 : 0,
        message: success ? `${decision.framework} completed successfully` : `${decision.framework} exited with code ${code}`,
      }, projectId);
      resolve({ success, output });
    });
  });
}

/**
 * Check if the current framework requires Aperant's built-in auth
 * (Claude OAuth / API key) for a given phase.
 *
 * Jules and custom frameworks handle their own auth.
 * Claude Code and Gemini CLI use their own CLI auth.
 * Only Aperant's built-in worker needs the provider account queue.
 */
export function requiresBuiltinAuth(phase: PipelinePhase): boolean {
  const decision = routePhase(phase);
  return decision.useBuiltinWorker;
}
