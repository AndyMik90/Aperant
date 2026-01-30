import { AgentProcess } from './types';

/**
 * Profile assignment for a task
 */
interface TaskProfileAssignment {
  profileId: string;
  profileName: string;
  reason: 'proactive' | 'reactive' | 'manual';
  sessionId?: string;
}

/**
 * Agent state tracking and process map management
 */
export class AgentState {
  private processes: Map<string, AgentProcess> = new Map();
  private killedSpawnIds: Set<number> = new Set();
  private spawnCounter: number = 0;

  // Queue routing state (rate limit recovery)
  private taskProfileAssignments: Map<string, TaskProfileAssignment> = new Map();

  /**
   * Generate a unique spawn ID
   */
  generateSpawnId(): number {
    return ++this.spawnCounter;
  }

  /**
   * Add a process to the tracking map
   */
  addProcess(taskId: string, process: AgentProcess): void {
    this.processes.set(taskId, process);
  }

  /**
   * Get a process by task ID
   */
  getProcess(taskId: string): AgentProcess | undefined {
    return this.processes.get(taskId);
  }

  /**
   * Remove a process from tracking
   */
  deleteProcess(taskId: string): boolean {
    return this.processes.delete(taskId);
  }

  /**
   * Check if a task has a running process
   */
  hasProcess(taskId: string): boolean {
    return this.processes.has(taskId);
  }

  /**
   * Get all running task IDs
   */
  getRunningTaskIds(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Mark a spawn ID as killed
   */
  markSpawnAsKilled(spawnId: number): void {
    this.killedSpawnIds.add(spawnId);
  }

  /**
   * Check if a spawn ID was killed
   */
  wasSpawnKilled(spawnId: number): boolean {
    return this.killedSpawnIds.has(spawnId);
  }

  /**
   * Remove a spawn ID from killed set
   */
  clearKilledSpawn(spawnId: number): void {
    this.killedSpawnIds.delete(spawnId);
  }

  /**
   * Update a process's properties (e.g., after spawn completes)
   *
   * Note: Silently ignores updates if taskId doesn't exist. This is intentional for
   * race condition handling in spawnProcess() - if a task is killed during async setup,
   * the tracking entry is deleted before spawn() completes, and we don't want to fail here.
   */
  updateProcess(taskId: string, updates: Partial<AgentProcess>): void {
    const existing = this.processes.get(taskId);
    if (existing) {
      this.processes.set(taskId, { ...existing, ...updates });
    }
  }

  /**
   * Get all processes
   */
  getAllProcesses(): Map<string, AgentProcess> {
    return this.processes;
  }

  /**
   * Clear all state (for testing or cleanup)
   */
  clear(): void {
    this.processes.clear();
    this.killedSpawnIds.clear();
    this.taskProfileAssignments.clear();
  }

  // ============================================
  // Queue Routing Methods (Rate Limit Recovery)
  // ============================================

  /**
   * Get running tasks grouped by profile
   */
  getRunningTasksByProfile(): { byProfile: Record<string, string[]>; totalRunning: number } {
    const byProfile: Record<string, string[]> = {};
    let totalRunning = 0;

    for (const [taskId] of this.processes) {
      const assignment = this.taskProfileAssignments.get(taskId);
      const profileId = assignment?.profileId || 'default';

      if (!byProfile[profileId]) {
        byProfile[profileId] = [];
      }
      byProfile[profileId].push(taskId);
      totalRunning++;
    }

    return { byProfile, totalRunning };
  }

  /**
   * Assign a profile to a task
   */
  assignProfileToTask(
    taskId: string,
    profileId: string,
    profileName: string,
    reason: 'proactive' | 'reactive' | 'manual'
  ): void {
    const existing = this.taskProfileAssignments.get(taskId);
    this.taskProfileAssignments.set(taskId, {
      profileId,
      profileName,
      reason,
      sessionId: existing?.sessionId // Preserve session ID if exists
    });
  }

  /**
   * Get the profile assignment for a task
   */
  getTaskProfileAssignment(taskId: string): TaskProfileAssignment | undefined {
    return this.taskProfileAssignments.get(taskId);
  }

  /**
   * Update the session ID for a task
   *
   * @param taskId - The task ID
   * @param sessionId - The Claude SDK session ID
   * @param profileInfo - Optional profile info when creating a new assignment
   */
  updateTaskSession(
    taskId: string,
    sessionId: string,
    profileInfo?: { profileId: string; profileName: string }
  ): void {
    const assignment = this.taskProfileAssignments.get(taskId);
    if (assignment) {
      assignment.sessionId = sessionId;
    } else {
      // Create a minimal assignment if none exists
      // Use provided profile info or 'unknown' as a placeholder
      this.taskProfileAssignments.set(taskId, {
        profileId: profileInfo?.profileId ?? 'unknown',
        profileName: profileInfo?.profileName ?? 'Unknown',
        reason: 'proactive',
        sessionId
      });
    }
  }

  /**
   * Get the session ID for a task
   */
  getTaskSessionId(taskId: string): string | undefined {
    return this.taskProfileAssignments.get(taskId)?.sessionId;
  }

  /**
   * Clear profile assignment for a task (on task completion)
   */
  clearTaskProfileAssignment(taskId: string): void {
    this.taskProfileAssignments.delete(taskId);
  }
}
