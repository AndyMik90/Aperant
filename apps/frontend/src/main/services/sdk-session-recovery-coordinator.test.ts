/**
 * Tests for SDK Session Recovery Coordinator
 *
 * Tests the central coordinator for SDK operations and rate limit recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SDKSessionRecoveryCoordinator,
  getRecoveryCoordinator,
} from './sdk-session-recovery-coordinator';

// Mock dependencies
vi.mock('../claude-profile-manager', () => ({
  getClaudeProfileManager: vi.fn(() => ({
    getActiveProfile: vi.fn(() => ({
      id: 'profile-1',
      name: 'Test Profile'
    })),
    getProfile: vi.fn((id: string) => ({
      id,
      name: `Profile ${id}`
    }))
  }))
}));

vi.mock('../claude-profile/usage-monitor', () => ({
  getUsageMonitor: vi.fn(() => ({
    getAllProfilesUsage: vi.fn(async () => ({
      activeProfile: {
        profileId: 'profile-1',
        profileName: 'Profile 1',
        sessionPercent: 50,
        weeklyPercent: 30
      },
      allProfiles: [
        {
          profileId: 'profile-1',
          profileName: 'Profile 1',
          isAuthenticated: true,
          isRateLimited: false,
          availabilityScore: 70
        },
        {
          profileId: 'profile-2',
          profileName: 'Profile 2',
          isAuthenticated: true,
          isRateLimited: false,
          availabilityScore: 90
        }
      ],
      fetchedAt: new Date()
    }))
  }))
}));

vi.mock('../ipc-handlers/utils', () => ({
  safeSendToRenderer: vi.fn()
}));

describe('SDKSessionRecoveryCoordinator', () => {
  let coordinator: SDKSessionRecoveryCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset singleton before each test
    SDKSessionRecoveryCoordinator.resetInstance();
    coordinator = SDKSessionRecoveryCoordinator.getInstance();
  });

  afterEach(() => {
    coordinator.cleanup();
    vi.useRealTimers();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = SDKSessionRecoveryCoordinator.getInstance();
      const instance2 = SDKSessionRecoveryCoordinator.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = SDKSessionRecoveryCoordinator.getInstance();
      SDKSessionRecoveryCoordinator.resetInstance();
      const instance2 = SDKSessionRecoveryCoordinator.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('operation registration', () => {
    it('should register a new operation', () => {
      const operation = coordinator.registerOperation(
        'task-1',
        'task',
        'profile-1',
        'Test Profile'
      );

      expect(operation.id).toBe('task-1');
      expect(operation.type).toBe('task');
      expect(operation.profileId).toBe('profile-1');
      expect(operation.profileName).toBe('Test Profile');
      expect(operation.startedAt).toBeInstanceOf(Date);
    });

    it('should register operation with metadata', () => {
      const metadata = { key: 'value' };
      const operation = coordinator.registerOperation(
        'task-2',
        'roadmap',
        'profile-1',
        'Test Profile',
        metadata
      );

      expect(operation.metadata).toEqual(metadata);
    });

    it('should get registered operation by ID', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');

      const operation = coordinator.getOperation('task-1');
      expect(operation).toBeDefined();
      expect(operation?.id).toBe('task-1');
    });

    it('should return undefined for non-existent operation', () => {
      const operation = coordinator.getOperation('non-existent');
      expect(operation).toBeUndefined();
    });

    it('should unregister operation', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');
      coordinator.unregisterOperation('task-1');

      const operation = coordinator.getOperation('task-1');
      expect(operation).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('should update operation session ID', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');
      coordinator.updateOperationSession('task-1', 'session-abc123');

      const operation = coordinator.getOperation('task-1');
      expect(operation?.sessionId).toBe('session-abc123');
    });

    it('should update last activity on session update', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');
      const beforeUpdate = coordinator.getOperation('task-1')?.lastActivityAt;

      vi.advanceTimersByTime(1000);
      coordinator.updateOperationSession('task-1', 'session-abc123');

      const afterUpdate = coordinator.getOperation('task-1')?.lastActivityAt;
      expect(afterUpdate?.getTime()).toBeGreaterThan(beforeUpdate?.getTime() ?? 0);
    });

    it('should update activity timestamp', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');
      const before = coordinator.getOperation('task-1')?.lastActivityAt;

      vi.advanceTimersByTime(1000);
      coordinator.updateOperationActivity('task-1');

      const after = coordinator.getOperation('task-1')?.lastActivityAt;
      expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
    });
  });

  describe('getOperationsByType', () => {
    it('should filter operations by type', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');
      coordinator.registerOperation('task-2', 'task', 'profile-1', 'Test Profile');
      coordinator.registerOperation('roadmap-1', 'roadmap', 'profile-1', 'Test Profile');

      const tasks = coordinator.getOperationsByType('task');
      expect(tasks).toHaveLength(2);
      expect(tasks.every(op => op.type === 'task')).toBe(true);
    });

    it('should return empty array when no operations of type exist', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Test Profile');

      const ideations = coordinator.getOperationsByType('ideation');
      expect(ideations).toHaveLength(0);
    });
  });

  describe('getOperationsByProfile', () => {
    it('should filter operations by profile', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');
      coordinator.registerOperation('task-2', 'task', 'profile-1', 'Profile 1');
      coordinator.registerOperation('task-3', 'task', 'profile-2', 'Profile 2');

      const profile1Ops = coordinator.getOperationsByProfile('profile-1');
      expect(profile1Ops).toHaveLength(2);
      expect(profile1Ops.every(op => op.profileId === 'profile-1')).toBe(true);
    });
  });

  describe('selectBestProfile', () => {
    it('should select profile with highest availability score', async () => {
      const result = await coordinator.selectBestProfile();

      // Profile 2 has higher availability score (90 vs 70)
      expect(result).not.toBeNull();
      expect(result?.profileId).toBe('profile-2');
    });

    it('should exclude specified profile', async () => {
      const result = await coordinator.selectBestProfile('profile-2');

      // Profile 2 is excluded, should select profile-1
      expect(result).not.toBeNull();
      expect(result?.profileId).toBe('profile-1');
    });

    it('should consider active operations when scoring', async () => {
      // Register multiple operations on profile-2
      coordinator.registerOperation('task-1', 'task', 'profile-2', 'Profile 2');
      coordinator.registerOperation('task-2', 'task', 'profile-2', 'Profile 2');

      const result = await coordinator.selectBestProfile();

      // Profile 2 has -30 penalty (2 ops * 15), score goes from 90 to 60
      // Profile 1 still at 70, should be selected
      expect(result?.profileId).toBe('profile-1');
    });
  });

  describe('handleRateLimit', () => {
    it('should return new profile on rate limit', async () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');

      const result = await coordinator.handleRateLimit('task-1', 'profile-1');

      expect(result).not.toBeNull();
      expect(result?.profileId).toBe('profile-2');
      expect(result?.reason).toBe('reactive');
    });

    it('should update operation with new profile', async () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');

      await coordinator.handleRateLimit('task-1', 'profile-1');

      const operation = coordinator.getOperation('task-1');
      expect(operation?.profileId).toBe('profile-2');
    });

    it('should return null for unknown operation', async () => {
      const result = await coordinator.handleRateLimit('non-existent', 'profile-1');
      expect(result).toBeNull();
    });

    it('should emit queue-blocked event when no profiles available', async () => {
      const blockedHandler = vi.fn();
      coordinator.on('queue-blocked', blockedHandler);

      // Register operation
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');

      // Mock getAllProfilesUsage to return no available profiles
      const { getUsageMonitor } = await import('../claude-profile/usage-monitor');
      (getUsageMonitor as ReturnType<typeof vi.fn>).mockReturnValue({
        getAllProfilesUsage: vi.fn(async () => ({
          allProfiles: [
            {
              profileId: 'profile-1',
              isAuthenticated: true,
              isRateLimited: true, // Rate limited
              availabilityScore: 0
            }
          ]
        }))
      });

      const result = await coordinator.handleRateLimit('task-1', 'profile-1');

      expect(result).toBeNull();
      // Advance timers to flush notification batch
      vi.advanceTimersByTime(2000);
      expect(blockedHandler).toHaveBeenCalled();
    });
  });

  describe('profile cooldown', () => {
    it('should clear cooldown for profile', () => {
      // Trigger a rate limit to create cooldown
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');
      coordinator.handleRateLimit('task-1', 'profile-1');

      // Clear cooldown
      coordinator.clearProfileCooldown('profile-1');

      // Profile should be eligible again
      const stats = coordinator.getStats();
      expect(stats.profilesInCooldown).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');
      coordinator.registerOperation('task-2', 'roadmap', 'profile-1', 'Profile 1');
      coordinator.registerOperation('task-3', 'ideation', 'profile-2', 'Profile 2');

      const stats = coordinator.getStats();

      expect(stats.activeOperations).toBe(3);
      expect(stats.operationsByType.task).toBe(1);
      expect(stats.operationsByType.roadmap).toBe(1);
      expect(stats.operationsByType.ideation).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should clear all state on cleanup', () => {
      coordinator.registerOperation('task-1', 'task', 'profile-1', 'Profile 1');

      coordinator.cleanup();

      expect(coordinator.getOperation('task-1')).toBeUndefined();
      expect(coordinator.getStats().activeOperations).toBe(0);
    });
  });
});

describe('getRecoveryCoordinator', () => {
  beforeEach(() => {
    SDKSessionRecoveryCoordinator.resetInstance();
  });

  it('should return the singleton instance', () => {
    const coordinator = getRecoveryCoordinator();
    const sameCoordinator = SDKSessionRecoveryCoordinator.getInstance();
    expect(coordinator).toBe(sameCoordinator);
  });
});
