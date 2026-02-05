/**
 * Unit tests for OperationRegistry
 *
 * Tests cover:
 * - Singleton pattern
 * - Operation registration/unregistration
 * - Profile-based querying
 * - Summary generation
 * - Operation restart functionality
 * - Event emissions
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOperationRegistry,
  resetOperationRegistry,
  type OperationType,
} from '../operation-registry';

describe('OperationRegistry', () => {
  beforeEach(() => {
    // Reset registry before each test
    resetOperationRegistry();
  });

  afterEach(() => {
    // Clean up after each test
    resetOperationRegistry();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getOperationRegistry();
      const instance2 = getOperationRegistry();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getOperationRegistry();
      resetOperationRegistry();
      const instance2 = getOperationRegistry();

      expect(instance1).not.toBe(instance2);
    });

    it('should clear all operations on reset', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation(
        'op1',
        'spec-creation',
        'profile1',
        'Profile 1',
        mockRestart
      );

      expect(registry.getOperationCount()).toBe(1);

      resetOperationRegistry();
      const newRegistry = getOperationRegistry();

      expect(newRegistry.getOperationCount()).toBe(0);
    });
  });

  describe('registerOperation', () => {
    it('should register a basic operation', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation(
        'op1',
        'spec-creation',
        'profile1',
        'Profile 1',
        mockRestart
      );

      const operation = registry.getOperation('op1');
      expect(operation).toBeDefined();
      expect(operation?.id).toBe('op1');
      expect(operation?.type).toBe('spec-creation');
      expect(operation?.profileId).toBe('profile1');
      expect(operation?.profileName).toBe('Profile 1');
      expect(operation?.restartFn).toBe(mockRestart);
      expect(operation?.startedAt).toBeInstanceOf(Date);
    });

    it('should register operation with optional stopFn', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);
      const mockStop = vi.fn();

      registry.registerOperation(
        'op1',
        'pr-review',
        'profile1',
        'Profile 1',
        mockRestart,
        { stopFn: mockStop }
      );

      const operation = registry.getOperation('op1');
      expect(operation?.stopFn).toBe(mockStop);
    });

    it('should register operation with metadata', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);
      const metadata = { projectId: 'proj1', prNumber: 123 };

      registry.registerOperation(
        'op1',
        'pr-review',
        'profile1',
        'Profile 1',
        mockRestart,
        { metadata }
      );

      const operation = registry.getOperation('op1');
      expect(operation?.metadata).toEqual(metadata);
    });

    it('should emit operation-registered event', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);
      const eventListener = vi.fn();

      registry.on('operation-registered', eventListener);

      registry.registerOperation(
        'op1',
        'task-execution',
        'profile1',
        'Profile 1',
        mockRestart
      );

      expect(eventListener).toHaveBeenCalledTimes(1);
      const emittedOperation = eventListener.mock.calls[0][0];
      expect(emittedOperation.id).toBe('op1');
      expect(emittedOperation.type).toBe('task-execution');
    });

    it('should increment operation count', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      expect(registry.getOperationCount()).toBe(0);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);
      expect(registry.getOperationCount()).toBe(1);

      registry.registerOperation('op2', 'roadmap', 'profile1', 'Profile 1', mockRestart);
      expect(registry.getOperationCount()).toBe(2);
    });

    it('should allow registering multiple operation types', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      const types: OperationType[] = [
        'spec-creation',
        'task-execution',
        'pr-review',
        'mr-review',
        'insights',
        'roadmap',
        'changelog',
        'ideation',
        'triage',
        'other',
      ];

      types.forEach((type, index) => {
        registry.registerOperation(
          `op${index}`,
          type,
          'profile1',
          'Profile 1',
          mockRestart
        );
      });

      expect(registry.getOperationCount()).toBe(types.length);

      types.forEach((type, index) => {
        const op = registry.getOperation(`op${index}`);
        expect(op?.type).toBe(type);
      });
    });
  });

  describe('unregisterOperation', () => {
    it('should unregister an existing operation', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      expect(registry.getOperation('op1')).toBeDefined();

      registry.unregisterOperation('op1');
      expect(registry.getOperation('op1')).toBeUndefined();
      expect(registry.getOperationCount()).toBe(0);
    });

    it('should emit operation-unregistered event', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);
      const eventListener = vi.fn();

      registry.on('operation-unregistered', eventListener);

      registry.registerOperation('op1', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.unregisterOperation('op1');

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith('op1', 'task-execution');
    });

    it('should handle unregistering non-existent operation gracefully', () => {
      const registry = getOperationRegistry();
      const eventListener = vi.fn();

      registry.on('operation-unregistered', eventListener);

      // Should not throw
      expect(() => registry.unregisterOperation('non-existent')).not.toThrow();

      // Should not emit event for non-existent operation
      expect(eventListener).not.toHaveBeenCalled();
    });

    it('should decrement operation count', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'roadmap', 'profile1', 'Profile 1', mockRestart);
      expect(registry.getOperationCount()).toBe(2);

      registry.unregisterOperation('op1');
      expect(registry.getOperationCount()).toBe(1);

      registry.unregisterOperation('op2');
      expect(registry.getOperationCount()).toBe(0);
    });
  });

  describe('getOperation', () => {
    it('should retrieve operation by id', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'pr-review', 'profile1', 'Profile 1', mockRestart);

      const operation = registry.getOperation('op1');
      expect(operation).toBeDefined();
      expect(operation?.id).toBe('op1');
    });

    it('should return undefined for non-existent operation', () => {
      const registry = getOperationRegistry();

      const operation = registry.getOperation('non-existent');
      expect(operation).toBeUndefined();
    });
  });

  describe('getOperationsByProfile', () => {
    it('should return operations for a specific profile', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile2', 'Profile 2', mockRestart);

      const profile1Ops = registry.getOperationsByProfile('profile1');
      expect(profile1Ops).toHaveLength(2);
      expect(profile1Ops.map(op => op.id)).toEqual(['op1', 'op2']);

      const profile2Ops = registry.getOperationsByProfile('profile2');
      expect(profile2Ops).toHaveLength(1);
      expect(profile2Ops[0].id).toBe('op3');
    });

    it('should return empty array for profile with no operations', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);

      const profile2Ops = registry.getOperationsByProfile('profile2');
      expect(profile2Ops).toEqual([]);
    });
  });

  describe('getAllOperationsByProfile', () => {
    it('should return all operations grouped by profile', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile2', 'Profile 2', mockRestart);
      registry.registerOperation('op4', 'roadmap', 'profile3', 'Profile 3', mockRestart);

      const allOps = registry.getAllOperationsByProfile();

      expect(Object.keys(allOps)).toEqual(['profile1', 'profile2', 'profile3']);
      expect(allOps['profile1']).toHaveLength(2);
      expect(allOps['profile2']).toHaveLength(1);
      expect(allOps['profile3']).toHaveLength(1);
    });

    it('should return empty object when no operations', () => {
      const registry = getOperationRegistry();

      const allOps = registry.getAllOperationsByProfile();
      expect(allOps).toEqual({});
    });
  });

  describe('getSummary', () => {
    it('should return correct summary with no operations', () => {
      const registry = getOperationRegistry();

      const summary = registry.getSummary();
      expect(summary.totalRunning).toBe(0);
      expect(summary.byProfile).toEqual({});
      expect(summary.byType).toEqual({});
    });

    it('should count operations by profile', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile2', 'Profile 2', mockRestart);

      const summary = registry.getSummary();

      expect(summary.totalRunning).toBe(3);
      expect(summary.byProfile['profile1']).toEqual(['op1', 'op2']);
      expect(summary.byProfile['profile2']).toEqual(['op3']);
    });

    it('should count operations by type', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op4', 'insights', 'profile2', 'Profile 2', mockRestart);

      const summary = registry.getSummary();

      expect(summary.byType['spec-creation']).toBe(2);
      expect(summary.byType['pr-review']).toBe(1);
      expect(summary.byType['insights']).toBe(1);
    });

    it('should return complete summary with multiple profiles and types', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile2', 'Profile 2', mockRestart);
      registry.registerOperation('op4', 'insights', 'profile2', 'Profile 2', mockRestart);
      registry.registerOperation('op5', 'roadmap', 'profile3', 'Profile 3', mockRestart);

      const summary = registry.getSummary();

      expect(summary.totalRunning).toBe(5);
      expect(Object.keys(summary.byProfile)).toHaveLength(3);
      expect(Object.keys(summary.byType)).toHaveLength(5);
    });
  });

  describe('restartOperationsOnProfile', () => {
    it('should restart all operations on a profile', async () => {
      const registry = getOperationRegistry();
      const mockRestart1 = vi.fn().mockResolvedValue(true);
      const mockRestart2 = vi.fn().mockResolvedValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart1);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart2);

      const count = await registry.restartOperationsOnProfile(
        'profile1',
        'profile2',
        'Profile 2'
      );

      expect(count).toBe(2);
      expect(mockRestart1).toHaveBeenCalledWith('profile2');
      expect(mockRestart2).toHaveBeenCalledWith('profile2');

      // Verify profile was updated
      const op1 = registry.getOperation('op1');
      const op2 = registry.getOperation('op2');
      expect(op1?.profileId).toBe('profile2');
      expect(op1?.profileName).toBe('Profile 2');
      expect(op2?.profileId).toBe('profile2');
      expect(op2?.profileName).toBe('Profile 2');
    });

    it('should call stopFn before restart if provided', async () => {
      const registry = getOperationRegistry();
      const mockStop = vi.fn().mockResolvedValue(undefined);
      const mockRestart = vi.fn().mockResolvedValue(true);

      registry.registerOperation(
        'op1',
        'pr-review',
        'profile1',
        'Profile 1',
        mockRestart,
        { stopFn: mockStop }
      );

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockRestart).toHaveBeenCalledWith('profile2');
      // Ensure stopFn was called before restartFn
      expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(
        mockRestart.mock.invocationCallOrder[0]
      );
    });

    it('should return 0 when no operations on profile', async () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockResolvedValue(true);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);

      const count = await registry.restartOperationsOnProfile(
        'profile2',
        'profile3',
        'Profile 3'
      );

      expect(count).toBe(0);
      expect(mockRestart).not.toHaveBeenCalled();
    });

    it('should handle restart failure gracefully', async () => {
      const registry = getOperationRegistry();
      const mockRestart1 = vi.fn().mockResolvedValue(true);
      const mockRestart2 = vi.fn().mockResolvedValue(false); // Fails
      const mockRestart3 = vi.fn().mockRejectedValue(new Error('Restart error')); // Throws

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart1);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart2);
      registry.registerOperation('op3', 'pr-review', 'profile1', 'Profile 1', mockRestart3);

      const count = await registry.restartOperationsOnProfile(
        'profile1',
        'profile2',
        'Profile 2'
      );

      // Only op1 succeeded
      expect(count).toBe(1);

      // op1 should have updated profile
      const op1 = registry.getOperation('op1');
      expect(op1?.profileId).toBe('profile2');

      // op2 and op3 should still have old profile
      const op2 = registry.getOperation('op2');
      const op3 = registry.getOperation('op3');
      expect(op2?.profileId).toBe('profile1');
      expect(op3?.profileId).toBe('profile1');
    });

    it('should emit operation-restarted event for each successful restart', async () => {
      const registry = getOperationRegistry();
      const mockRestart1 = vi.fn().mockResolvedValue(true);
      const mockRestart2 = vi.fn().mockResolvedValue(true);
      const eventListener = vi.fn();

      registry.on('operation-restarted', eventListener);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart1);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart2);

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      expect(eventListener).toHaveBeenCalledTimes(2);
      expect(eventListener).toHaveBeenCalledWith('op1', 'profile1', 'profile2');
      expect(eventListener).toHaveBeenCalledWith('op2', 'profile1', 'profile2');
    });

    it('should emit operations-restarted event after restart', async () => {
      const registry = getOperationRegistry();
      const mockRestart1 = vi.fn().mockResolvedValue(true);
      const mockRestart2 = vi.fn().mockResolvedValue(true);
      const eventListener = vi.fn();

      registry.on('operations-restarted', eventListener);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart1);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart2);

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith(2, 'profile1', 'profile2');
    });

    it('should not emit operations-restarted event if no restarts succeeded', async () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockResolvedValue(false);
      const eventListener = vi.fn();

      registry.on('operations-restarted', eventListener);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      expect(eventListener).not.toHaveBeenCalled();
    });

    it('should handle synchronous restart functions', async () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true); // Synchronous return

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);

      const count = await registry.restartOperationsOnProfile(
        'profile1',
        'profile2',
        'Profile 2'
      );

      expect(count).toBe(1);
      expect(mockRestart).toHaveBeenCalledWith('profile2');

      const op1 = registry.getOperation('op1');
      expect(op1?.profileId).toBe('profile2');
    });
  });

  describe('updateOperationProfile', () => {
    it('should update profile for existing operation', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);

      registry.updateOperationProfile('op1', 'profile2', 'Profile 2');

      const operation = registry.getOperation('op1');
      expect(operation?.profileId).toBe('profile2');
      expect(operation?.profileName).toBe('Profile 2');
    });

    it('should handle updating non-existent operation gracefully', () => {
      const registry = getOperationRegistry();

      // Should not throw
      expect(() =>
        registry.updateOperationProfile('non-existent', 'profile2', 'Profile 2')
      ).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all operations', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op2', 'task-execution', 'profile1', 'Profile 1', mockRestart);
      registry.registerOperation('op3', 'pr-review', 'profile2', 'Profile 2', mockRestart);

      expect(registry.getOperationCount()).toBe(3);

      registry.clear();

      expect(registry.getOperationCount()).toBe(0);
      expect(registry.getSummary().totalRunning).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle registering operation with same id (overwrites)', () => {
      const registry = getOperationRegistry();
      const mockRestart1 = vi.fn().mockReturnValue(true);
      const mockRestart2 = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'spec-creation', 'profile1', 'Profile 1', mockRestart1);
      registry.registerOperation('op1', 'task-execution', 'profile2', 'Profile 2', mockRestart2);

      const operation = registry.getOperation('op1');
      expect(operation?.type).toBe('task-execution');
      expect(operation?.profileId).toBe('profile2');
      expect(registry.getOperationCount()).toBe(1);
    });

    it('should handle multiple unregisters of same operation', () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockReturnValue(true);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);

      registry.unregisterOperation('op1');
      expect(registry.getOperationCount()).toBe(0);

      // Second unregister should not throw or cause issues
      registry.unregisterOperation('op1');
      expect(registry.getOperationCount()).toBe(0);
    });

    it('should handle restart with no operations gracefully', async () => {
      const registry = getOperationRegistry();

      const count = await registry.restartOperationsOnProfile(
        'profile1',
        'profile2',
        'Profile 2'
      );

      expect(count).toBe(0);
    });

    it('should preserve operation metadata through restart', async () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockResolvedValue(true);
      const metadata = { projectId: 'proj1', prNumber: 123 };

      registry.registerOperation(
        'op1',
        'pr-review',
        'profile1',
        'Profile 1',
        mockRestart,
        { metadata }
      );

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      const operation = registry.getOperation('op1');
      expect(operation?.metadata).toEqual(metadata);
    });

    it('should preserve startedAt timestamp through restart', async () => {
      const registry = getOperationRegistry();
      const mockRestart = vi.fn().mockResolvedValue(true);

      registry.registerOperation('op1', 'insights', 'profile1', 'Profile 1', mockRestart);

      const originalOp = registry.getOperation('op1');
      const originalStartTime = originalOp?.startedAt;

      await registry.restartOperationsOnProfile('profile1', 'profile2', 'Profile 2');

      const updatedOp = registry.getOperation('op1');
      expect(updatedOp?.startedAt).toBe(originalStartTime);
    });
  });
});
