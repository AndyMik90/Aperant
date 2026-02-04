/**
 * Tests for AgentState - Queue Routing functionality
 *
 * Tests the profile assignment tracking and running tasks by profile features.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentState } from './agent-state';

describe('AgentState - Queue Routing', () => {
  let state: AgentState;

  beforeEach(() => {
    state = new AgentState();
  });

  describe('getRunningTasksByProfile', () => {
    it('should return empty state when no processes running', () => {
      const result = state.getRunningTasksByProfile();

      expect(result.byProfile).toEqual({});
      expect(result.totalRunning).toBe(0);
    });

    it('should group tasks by profile', () => {
      // Add mock processes
      state.addProcess('task-1', {
        taskId: 'task-1',
        process: { pid: 1001 } as unknown as import('child_process').ChildProcess,
        startedAt: new Date(),
        spawnId: 1
      });
      state.addProcess('task-2', {
        taskId: 'task-2',
        process: { pid: 1002 } as unknown as import('child_process').ChildProcess,
        startedAt: new Date(),
        spawnId: 2
      });
      state.addProcess('task-3', {
        taskId: 'task-3',
        process: { pid: 1003 } as unknown as import('child_process').ChildProcess,
        startedAt: new Date(),
        spawnId: 3
      });

      // Assign profiles
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.assignProfileToTask('task-2', 'profile-1', 'Profile 1', 'proactive');
      state.assignProfileToTask('task-3', 'profile-2', 'Profile 2', 'proactive');

      const result = state.getRunningTasksByProfile();

      expect(result.byProfile['profile-1']).toHaveLength(2);
      expect(result.byProfile['profile-2']).toHaveLength(1);
      expect(result.totalRunning).toBe(3);
    });

    it('should use default profile for unassigned tasks', () => {
      // Add process without profile assignment
      state.addProcess('task-1', {
        taskId: 'task-1',
        process: { pid: 1001 } as unknown as import('child_process').ChildProcess,
        startedAt: new Date(),
        spawnId: 1
      });

      const result = state.getRunningTasksByProfile();

      expect(result.byProfile['default']).toContain('task-1');
      expect(result.totalRunning).toBe(1);
    });
  });

  describe('assignProfileToTask', () => {
    it('should assign profile to task', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Test Profile', 'proactive');

      const assignment = state.getTaskProfileAssignment('task-1');

      expect(assignment).toBeDefined();
      expect(assignment?.profileId).toBe('profile-1');
      expect(assignment?.profileName).toBe('Test Profile');
      expect(assignment?.reason).toBe('proactive');
    });

    it('should preserve session ID when reassigning profile', () => {
      // Initial assignment
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.updateTaskSession('task-1', 'session-abc');

      // Reassign to different profile
      state.assignProfileToTask('task-1', 'profile-2', 'Profile 2', 'reactive');

      const assignment = state.getTaskProfileAssignment('task-1');
      expect(assignment?.profileId).toBe('profile-2');
      expect(assignment?.sessionId).toBe('session-abc');
    });

    it('should support different assignment reasons', () => {
      state.assignProfileToTask('task-1', 'p1', 'P1', 'proactive');
      state.assignProfileToTask('task-2', 'p2', 'P2', 'reactive');
      state.assignProfileToTask('task-3', 'p3', 'P3', 'manual');

      expect(state.getTaskProfileAssignment('task-1')?.reason).toBe('proactive');
      expect(state.getTaskProfileAssignment('task-2')?.reason).toBe('reactive');
      expect(state.getTaskProfileAssignment('task-3')?.reason).toBe('manual');
    });
  });

  describe('getTaskProfileAssignment', () => {
    it('should return undefined for non-existent task', () => {
      const assignment = state.getTaskProfileAssignment('non-existent');
      expect(assignment).toBeUndefined();
    });
  });

  describe('updateTaskSession', () => {
    it('should update session ID for existing assignment', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.updateTaskSession('task-1', 'session-123');

      const assignment = state.getTaskProfileAssignment('task-1');
      expect(assignment?.sessionId).toBe('session-123');
    });

    it('should create minimal assignment if none exists', () => {
      // Update session without prior assignment
      state.updateTaskSession('task-1', 'session-456');

      const assignment = state.getTaskProfileAssignment('task-1');
      expect(assignment).toBeDefined();
      expect(assignment?.sessionId).toBe('session-456');
      expect(assignment?.profileId).toBe('unknown');
    });

    it('should create assignment with provided profile info', () => {
      state.updateTaskSession('task-1', 'session-789', {
        profileId: 'my-profile',
        profileName: 'My Profile'
      });

      const assignment = state.getTaskProfileAssignment('task-1');
      expect(assignment).toBeDefined();
      expect(assignment?.sessionId).toBe('session-789');
      expect(assignment?.profileId).toBe('my-profile');
      expect(assignment?.profileName).toBe('My Profile');
    });
  });

  describe('getTaskSessionId', () => {
    it('should return session ID if set', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.updateTaskSession('task-1', 'session-abc');

      expect(state.getTaskSessionId('task-1')).toBe('session-abc');
    });

    it('should return undefined if no session set', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');

      expect(state.getTaskSessionId('task-1')).toBeUndefined();
    });

    it('should return undefined for non-existent task', () => {
      expect(state.getTaskSessionId('non-existent')).toBeUndefined();
    });
  });

  describe('clearTaskProfileAssignment', () => {
    it('should clear profile assignment for task', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.clearTaskProfileAssignment('task-1');

      expect(state.getTaskProfileAssignment('task-1')).toBeUndefined();
    });

    it('should not affect other tasks', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.assignProfileToTask('task-2', 'profile-2', 'Profile 2', 'proactive');

      state.clearTaskProfileAssignment('task-1');

      expect(state.getTaskProfileAssignment('task-2')).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all profile assignments', () => {
      state.assignProfileToTask('task-1', 'profile-1', 'Profile 1', 'proactive');
      state.assignProfileToTask('task-2', 'profile-2', 'Profile 2', 'proactive');

      state.clear();

      expect(state.getTaskProfileAssignment('task-1')).toBeUndefined();
      expect(state.getTaskProfileAssignment('task-2')).toBeUndefined();
    });
  });
});
