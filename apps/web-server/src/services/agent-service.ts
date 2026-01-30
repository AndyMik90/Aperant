/**
 * Agent Service
 *
 * Manages Python agent subprocess execution.
 * Handles task execution, roadmap generation, insights, etc.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface AgentProcess {
  id: string;
  type: 'task' | 'roadmap' | 'insights' | 'ideation' | 'spec';
  process: ChildProcess;
  projectId: string;
  taskId?: string;
  startedAt: Date;
}

export interface TaskStartOptions {
  phase?: 'spec' | 'planning' | 'coding' | 'qa';
  qaMode?: boolean;
  mergeMode?: boolean;
  model?: string;
  thinking?: number;
}

export class AgentService {
  private backendDir: string;
  private io: SocketIOServer;
  private processes: Map<string, AgentProcess> = new Map();
  private pythonPath: string;

  constructor(backendDir: string, io: SocketIOServer) {
    this.backendDir = backendDir;
    this.io = io;

    // Find Python path
    this.pythonPath = this.findPython();
    console.log(`[AgentService] Using Python: ${this.pythonPath}`);
  }

  private findPython(): string {
    // Check for virtual environment
    const venvPython = join(this.backendDir, '.venv', 'bin', 'python');
    if (existsSync(venvPython)) {
      return venvPython;
    }

    // Check for system Python
    const pythonPaths = ['python3', 'python'];
    for (const python of pythonPaths) {
      try {
        const { execSync } = require('node:child_process');
        execSync(`${python} --version`, { stdio: 'pipe' });
        return python;
      } catch {
        // Continue to next
      }
    }

    return 'python3';
  }

  /**
   * Start a task execution
   */
  startTask(
    projectId: string,
    projectPath: string,
    taskId: string,
    options: TaskStartOptions = {}
  ): string {
    const processId = `task-${taskId}-${Date.now()}`;

    // Build command arguments
    const args: string[] = ['run.py', '--spec', taskId];

    if (options.qaMode) {
      args.push('--qa');
    }
    if (options.mergeMode) {
      args.push('--merge');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.thinking) {
      args.push('--thinking', String(options.thinking));
    }

    const process = this.spawnAgent(processId, 'task', projectId, projectPath, args, taskId);
    return processId;
  }

  /**
   * Stop a running task
   */
  stopTask(taskId: string): boolean {
    for (const [id, proc] of this.processes) {
      if (proc.taskId === taskId && proc.type === 'task') {
        return this.killProcess(id);
      }
    }
    return false;
  }

  /**
   * Start roadmap generation
   */
  startRoadmap(projectId: string, projectPath: string): string {
    const processId = `roadmap-${projectId}-${Date.now()}`;
    const args = ['runners/roadmap_runner.py', '--project-path', projectPath];

    this.spawnAgent(processId, 'roadmap', projectId, projectPath, args);
    return processId;
  }

  /**
   * Start insights chat
   */
  startInsights(projectId: string, projectPath: string, query: string): string {
    const processId = `insights-${projectId}-${Date.now()}`;
    const args = ['runners/insights_runner.py', '--project-path', projectPath, '--query', query];

    this.spawnAgent(processId, 'insights', projectId, projectPath, args);
    return processId;
  }

  /**
   * Start ideation
   */
  startIdeation(projectId: string, projectPath: string, category: string): string {
    const processId = `ideation-${projectId}-${Date.now()}`;
    const args = ['runners/ideation_runner.py', '--project-path', projectPath, '--category', category];

    this.spawnAgent(processId, 'ideation', projectId, projectPath, args);
    return processId;
  }

  /**
   * Spawn an agent subprocess
   */
  private spawnAgent(
    processId: string,
    type: AgentProcess['type'],
    projectId: string,
    projectPath: string,
    args: string[],
    taskId?: string
  ): ChildProcess {
    console.log(`[AgentService] Spawning ${type} agent: ${processId}`);
    console.log(`[AgentService] Command: ${this.pythonPath} ${args.join(' ')}`);

    const childProcess = spawn(this.pythonPath, args, {
      cwd: this.backendDir,
      env: {
        ...process.env,
        PROJECT_PATH: projectPath,
        PYTHONPATH: this.backendDir,
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const agentProcess: AgentProcess = {
      id: processId,
      type,
      process: childProcess,
      projectId,
      taskId,
      startedAt: new Date()
    };

    this.processes.set(processId, agentProcess);

    // Handle stdout (NDJSON output)
    let buffer = '';
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.handleAgentOutput(processId, type, projectId, taskId, line);
        }
      }
    });

    // Handle stderr
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString();
      console.error(`[AgentService] ${processId} stderr:`, message);

      this.io.emit('agent:log', {
        processId,
        type,
        projectId,
        taskId,
        level: 'error',
        message
      });
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      console.log(`[AgentService] ${processId} exited with code ${code}, signal ${signal}`);

      this.io.emit('agent:exit', {
        processId,
        type,
        projectId,
        taskId,
        code,
        signal
      });

      this.processes.delete(processId);
    });

    childProcess.on('error', (error) => {
      console.error(`[AgentService] ${processId} error:`, error);

      this.io.emit('agent:error', {
        processId,
        type,
        projectId,
        taskId,
        error: error.message
      });
    });

    return childProcess;
  }

  /**
   * Handle NDJSON output from agent
   */
  private handleAgentOutput(
    processId: string,
    type: AgentProcess['type'],
    projectId: string,
    taskId: string | undefined,
    line: string
  ): void {
    try {
      const data = JSON.parse(line);

      // Emit event based on message type
      const eventType = data.type || 'message';
      const eventName = `agent:${eventType}`;

      this.io.emit(eventName, {
        processId,
        type,
        projectId,
        taskId,
        ...data
      });

      // Special handling for task-specific events
      if (type === 'task' && taskId) {
        switch (data.type) {
          case 'progress':
            this.io.emit('task:progress', taskId, data.plan, projectId);
            break;
          case 'log':
            this.io.emit('task:log', taskId, data.message, projectId);
            break;
          case 'status':
            this.io.emit('task:statusChange', taskId, data.status, projectId);
            break;
          case 'executionProgress':
            this.io.emit('task:executionProgress', taskId, data.progress, projectId);
            break;
          case 'error':
            this.io.emit('task:error', taskId, data.error, projectId);
            break;
        }
      }
    } catch (error) {
      // Not JSON, treat as plain log message
      this.io.emit('agent:log', {
        processId,
        type,
        projectId,
        taskId,
        level: 'info',
        message: line
      });
    }
  }

  /**
   * Kill a process
   */
  killProcess(processId: string): boolean {
    const proc = this.processes.get(processId);
    if (!proc) {
      return false;
    }

    try {
      proc.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.processes.has(processId)) {
          proc.process.kill('SIGKILL');
        }
      }, 5000);

      return true;
    } catch (error) {
      console.error(`[AgentService] Failed to kill process ${processId}:`, error);
      return false;
    }
  }

  /**
   * Check if a task is running
   */
  isTaskRunning(taskId: string): boolean {
    for (const proc of this.processes.values()) {
      if (proc.taskId === taskId && proc.type === 'task') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get process info
   */
  getProcess(processId: string): Omit<AgentProcess, 'process'> | null {
    const proc = this.processes.get(processId);
    if (!proc) {
      return null;
    }

    return {
      id: proc.id,
      type: proc.type,
      projectId: proc.projectId,
      taskId: proc.taskId,
      startedAt: proc.startedAt
    };
  }

  /**
   * List all running processes
   */
  listProcesses(): Array<Omit<AgentProcess, 'process'>> {
    return Array.from(this.processes.values()).map(({ process: _p, ...rest }) => rest);
  }

  /**
   * Clean up all processes
   */
  cleanup(): void {
    console.log(`[AgentService] Cleaning up ${this.processes.size} processes...`);
    for (const [id, proc] of this.processes) {
      try {
        proc.process.kill('SIGKILL');
        console.log(`[AgentService] Killed process ${id}`);
      } catch (error) {
        console.error(`[AgentService] Failed to kill process ${id}:`, error);
      }
    }
    this.processes.clear();
  }
}
