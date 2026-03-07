/**
 * SDK Session Recovery Coordinator
 *
 * @deprecated This module is deprecated in favor of ClaudeOperationRegistry
 * (src/main/claude-profile/operation-registry.ts). The OperationRegistry provides
 * similar functionality with a simpler API and is actively integrated with
 * AgentManager and UsageMonitor. This module is retained for backward compatibility
 * but should not be used for new code.
 *
 * TODO: Target removal in v0.5.0 (Q2 2026). Before removal:
 * 1. Identify any remaining usages in the codebase
 * 2. Migrate all remaining consumers to ClaudeOperationRegistry
 * 3. Remove this file and associated tests
 * 4. Update imports across the codebase
 *
 * Migration guide:
 * - Use getOperationRegistry() from '../claude-profile/operation-registry'
 * - registerOperation() -> operationRegistry.registerOperation()
 * - unregisterOperation() -> operationRegistry.unregisterOperation()
 * - getOperationsByProfile() -> operationRegistry.getOperationsByProfile()
 *
 * Original description:
 * Central coordinator for all SDK operations and rate limit recovery.
 * Part of the intelligent rate limit recovery system (Phase 9: Unified Coordination).
 *
 * Responsibilities:
 * - Track all SDK operations (tasks, background operations)
 * - Centralized rate limit handling
 * - Profile selection with cooldown periods
 * - Notification batching to prevent UI spam
 */

import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { getUsageMonitor } from '../claude-profile/usage-monitor';
import { safeSendToRenderer } from '../ipc-handlers/utils';
import type { ProfileAssignmentReason } from '../../shared/types';

/**
 * Types of SDK operations that can be registered
 */
export type SDKOperationType = 'task' | 'roadmap' | 'ideation' | 'changelog' | 'title-generation' | 'other';

/**
 * Registered SDK operation
 */
export interface RegisteredOperation {
  /** Unique operation ID */
  id: string;
  /** Type of operation */
  type: SDKOperationType;
  /** Associated profile ID */
  profileId: string;
  /** Profile display name */
  profileName: string;
  /** Captured session ID (if available) */
  sessionId?: string;
  /** Operation start time */
  startedAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Profile with cooldown tracking
 */
interface ProfileCooldown {
  profileId: string;
  rateLimitedAt: Date;
  cooldownUntil: Date;
  rateLimitCount: number;
}

/**
 * Configuration for the recovery coordinator
 */
export interface RecoveryCoordinatorConfig {
  /** Cooldown period after rate limit (ms). Default: 60000 (1 minute) */
  cooldownPeriodMs: number;
  /** Maximum consecutive rate limits before profile is marked unavailable. Default: 3 */
  maxConsecutiveRateLimits: number;
  /** Notification batch window (ms). Default: 2000 */
  notificationBatchWindowMs: number;
  /** Maximum notifications per batch. Default: 5 */
  maxNotificationsPerBatch: number;
}

const DEFAULT_CONFIG: RecoveryCoordinatorConfig = {
  cooldownPeriodMs: 60000,
  maxConsecutiveRateLimits: 3,
  notificationBatchWindowMs: 2000,
  maxNotificationsPerBatch: 5,
};

/**
 * Profile scoring constants
 */
const OPERATION_PENALTY_POINTS = 15; // Penalty per active operation on a profile
const RATE_LIMIT_PENALTY_POINTS = 5; // Penalty per previous rate limit

/**
 * Notification types for batching
 */
type NotificationType = 'profile-swap' | 'rate-limit' | 'blocked';

interface PendingNotification {
  type: NotificationType;
  data: unknown;
  timestamp: Date;
}

/**
 * SDKSessionRecoveryCoordinator - Central manager for SDK operations and recovery
 *
 * @deprecated Use ClaudeOperationRegistry from '../claude-profile/operation-registry' instead.
 * This class is retained for backward compatibility but is no longer actively maintained.
 *
 * This singleton coordinates all SDK operations across the application:
 * - Tasks (via AgentManager)
 * - Background operations (roadmap, ideation, changelog)
 * - Title generation
 *
 * Provides unified rate limit handling and profile selection.
 */
export class SDKSessionRecoveryCoordinator extends EventEmitter {
  private static instance: SDKSessionRecoveryCoordinator | null = null;

  private operations: Map<string, RegisteredOperation> = new Map();
  private profileCooldowns: Map<string, ProfileCooldown> = new Map();
  private config: RecoveryCoordinatorConfig;
  private getMainWindow: (() => BrowserWindow | null) | null = null;

  // Notification batching
  private pendingNotifications: PendingNotification[] = [];
  private notificationBatchTimeout: NodeJS.Timeout | null = null;

  private constructor(config: Partial<RecoveryCoordinatorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: Partial<RecoveryCoordinatorConfig>): SDKSessionRecoveryCoordinator {
    if (!SDKSessionRecoveryCoordinator.instance) {
      SDKSessionRecoveryCoordinator.instance = new SDKSessionRecoveryCoordinator(config);
    }
    return SDKSessionRecoveryCoordinator.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (SDKSessionRecoveryCoordinator.instance) {
      SDKSessionRecoveryCoordinator.instance.cleanup();
      SDKSessionRecoveryCoordinator.instance = null;
    }
  }

  /**
   * Set the main window getter for sending notifications
   */
  setMainWindowGetter(getter: () => BrowserWindow | null): void {
    this.getMainWindow = getter;
  }

  /**
   * Register a new SDK operation
   */
  registerOperation(
    id: string,
    type: SDKOperationType,
    profileId: string,
    profileName: string,
    metadata?: Record<string, unknown>
  ): RegisteredOperation {
    const operation: RegisteredOperation = {
      id,
      type,
      profileId,
      profileName,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      metadata,
    };

    this.operations.set(id, operation);
    console.log(`[RecoveryCoordinator] Registered operation: ${id} (${type}) on profile ${profileName}`);

    return operation;
  }

  /**
   * Update operation with session ID
   */
  updateOperationSession(id: string, sessionId: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.sessionId = sessionId;
      operation.lastActivityAt = new Date();
      console.log(`[RecoveryCoordinator] Session captured for ${id}: ${sessionId.substring(0, 16)}...`);
    }
  }

  /**
   * Update operation activity timestamp
   */
  updateOperationActivity(id: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.lastActivityAt = new Date();
    }
  }

  /**
   * Unregister an operation (completed or failed)
   */
  unregisterOperation(id: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      this.operations.delete(id);
      console.log(`[RecoveryCoordinator] Unregistered operation: ${id}`);
    }
  }

  /**
   * Get an operation by ID
   */
  getOperation(id: string): RegisteredOperation | undefined {
    return this.operations.get(id);
  }

  /**
   * Get all operations of a specific type
   */
  getOperationsByType(type: SDKOperationType): RegisteredOperation[] {
    return Array.from(this.operations.values()).filter(op => op.type === type);
  }

  /**
   * Get all operations for a profile
   */
  getOperationsByProfile(profileId: string): RegisteredOperation[] {
    return Array.from(this.operations.values()).filter(op => op.profileId === profileId);
  }

  /**
   * Handle rate limit for an operation
   * Returns the new profile to use, or null if no profile is available
   */
  async handleRateLimit(
    operationId: string,
    rateLimitedProfileId: string
  ): Promise<{ profileId: string; profileName: string; reason: ProfileAssignmentReason } | null> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      console.warn(`[RecoveryCoordinator] Unknown operation: ${operationId}`);
      return null;
    }

    // Record cooldown for rate-limited profile
    this.recordProfileCooldown(rateLimitedProfileId);

    // Select best available profile
    const newProfile = await this.selectBestProfile(rateLimitedProfileId);

    if (!newProfile) {
      // No profiles available - queue is blocked
      this.queueNotification('blocked', {
        reason: 'All profiles are at capacity or in cooldown',
        timestamp: new Date().toISOString(),
      });

      // Emit event for listeners
      this.emit('queue-blocked', { reason: 'no_profiles_available', operationId });

      return null;
    }

    // Update operation with new profile
    operation.profileId = newProfile.profileId;
    operation.profileName = newProfile.profileName;
    operation.lastActivityAt = new Date();

    // Queue swap notification
    this.queueNotification('profile-swap', {
      operationId,
      operationType: operation.type,
      fromProfileId: rateLimitedProfileId,
      fromProfileName: operation.profileName,
      toProfileId: newProfile.profileId,
      toProfileName: newProfile.profileName,
      reason: 'rate_limit',
      sessionId: operation.sessionId,
    });

    console.log(
      `[RecoveryCoordinator] Rate limit recovery: ${operationId} swapped from ${rateLimitedProfileId} to ${newProfile.profileId}`
    );

    return {
      profileId: newProfile.profileId,
      profileName: newProfile.profileName,
      reason: 'reactive',
    };
  }

  /**
   * Select the best available profile for a new operation
   * Considers cooldowns, usage, and current load
   */
  async selectBestProfile(
    excludeProfileId?: string
  ): Promise<{ profileId: string; profileName: string } | null> {
    const profileManager = getClaudeProfileManager();
    const usageMonitor = getUsageMonitor();

    // Get all profiles usage
    const allProfilesUsage = await usageMonitor.getAllProfilesUsage();
    if (!allProfilesUsage) {
      // Fallback to active profile (if not excluded)
      const activeProfile = profileManager.getActiveProfile();
      if (excludeProfileId && activeProfile.id === excludeProfileId) {
        return null;
      }
      return { profileId: activeProfile.id, profileName: activeProfile.name };
    }

    // Filter and score profiles
    const now = new Date();
    const candidates: Array<{
      profileId: string;
      profileName: string;
      score: number;
    }> = [];

    for (const profile of allProfilesUsage.allProfiles) {
      // Skip excluded profile
      if (excludeProfileId && profile.profileId === excludeProfileId) {
        continue;
      }

      // Skip unauthenticated profiles
      if (!profile.isAuthenticated) {
        continue;
      }

      // Skip rate-limited profiles
      if (profile.isRateLimited) {
        continue;
      }

      // Check cooldown
      const cooldown = this.profileCooldowns.get(profile.profileId);
      if (cooldown && cooldown.cooldownUntil > now) {
        console.log(
          `[RecoveryCoordinator] Profile ${profile.profileName} in cooldown until ${cooldown.cooldownUntil.toISOString()}`
        );
        continue;
      }

      // Check if profile has exceeded max consecutive rate limits
      if (cooldown && cooldown.rateLimitCount >= this.config.maxConsecutiveRateLimits) {
        console.log(
          `[RecoveryCoordinator] Profile ${profile.profileName} exceeded max rate limits (${cooldown.rateLimitCount})`
        );
        continue;
      }

      // Count current operations on this profile
      const operationsOnProfile = this.getOperationsByProfile(profile.profileId).length;

      // Calculate score:
      // - Base: availability score (0-100)
      // - Penalty: -15 per active operation
      // - Penalty: -5 per previous rate limit
      let score = profile.availabilityScore;
      score -= operationsOnProfile * OPERATION_PENALTY_POINTS;
      score -= (cooldown?.rateLimitCount ?? 0) * RATE_LIMIT_PENALTY_POINTS;

      candidates.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        score,
      });
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return null;
    }

    const best = candidates[0];
    console.log(
      `[RecoveryCoordinator] Selected profile: ${best.profileName} (score: ${best.score})`
    );

    return { profileId: best.profileId, profileName: best.profileName };
  }

  /**
   * Record a cooldown for a profile that hit rate limit
   */
  private recordProfileCooldown(profileId: string): void {
    const now = new Date();
    const existing = this.profileCooldowns.get(profileId);

    const cooldown: ProfileCooldown = {
      profileId,
      rateLimitedAt: now,
      cooldownUntil: new Date(now.getTime() + this.config.cooldownPeriodMs),
      rateLimitCount: (existing?.rateLimitCount ?? 0) + 1,
    };

    this.profileCooldowns.set(profileId, cooldown);
    console.log(
      `[RecoveryCoordinator] Profile ${profileId} in cooldown until ${cooldown.cooldownUntil.toISOString()} (count: ${cooldown.rateLimitCount})`
    );
  }

  /**
   * Clear cooldown for a profile (e.g., when usage resets)
   */
  clearProfileCooldown(profileId: string): void {
    this.profileCooldowns.delete(profileId);
    console.log(`[RecoveryCoordinator] Cleared cooldown for profile ${profileId}`);
  }

  /**
   * Queue a notification for batched delivery
   */
  private queueNotification(type: NotificationType, data: unknown): void {
    this.pendingNotifications.push({
      type,
      data,
      timestamp: new Date(),
    });

    // Start batch timer if not already running
    if (!this.notificationBatchTimeout) {
      this.notificationBatchTimeout = setTimeout(
        () => this.flushNotifications(),
        this.config.notificationBatchWindowMs
      );
    }
  }

  /**
   * Flush pending notifications to renderer
   */
  private flushNotifications(): void {
    this.notificationBatchTimeout = null;

    if (this.pendingNotifications.length === 0 || !this.getMainWindow) {
      return;
    }

    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      return;
    }

    // Group by type
    const swaps = this.pendingNotifications.filter(n => n.type === 'profile-swap');
    const blocked = this.pendingNotifications.filter(n => n.type === 'blocked');

    // Send profile swap notifications
    if (swaps.length > 0) {
      const toSend = swaps.slice(0, this.config.maxNotificationsPerBatch);
      for (const notification of toSend) {
        safeSendToRenderer(
          this.getMainWindow,
          IPC_CHANNELS.QUEUE_PROFILE_SWAPPED,
          notification.data
        );
      }
      if (swaps.length > this.config.maxNotificationsPerBatch) {
        console.log(
          `[RecoveryCoordinator] ${swaps.length - this.config.maxNotificationsPerBatch} swap notifications suppressed`
        );
      }
    }

    // Send blocked notification (only most recent)
    if (blocked.length > 0) {
      safeSendToRenderer(
        this.getMainWindow,
        IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES,
        blocked[blocked.length - 1].data
      );
    }

    // Clear pending notifications
    this.pendingNotifications = [];
  }

  /**
   * Get coordinator statistics
   */
  getStats(): {
    activeOperations: number;
    operationsByType: Record<SDKOperationType, number>;
    profilesInCooldown: number;
    pendingNotifications: number;
  } {
    const operationsByType: Record<SDKOperationType, number> = {
      task: 0,
      roadmap: 0,
      ideation: 0,
      changelog: 0,
      'title-generation': 0,
      other: 0,
    };

    for (const op of this.operations.values()) {
      operationsByType[op.type]++;
    }

    const now = new Date();
    const profilesInCooldown = Array.from(this.profileCooldowns.values())
      .filter(c => c.cooldownUntil > now).length;

    return {
      activeOperations: this.operations.size,
      operationsByType,
      profilesInCooldown,
      pendingNotifications: this.pendingNotifications.length,
    };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.notificationBatchTimeout) {
      clearTimeout(this.notificationBatchTimeout);
      this.notificationBatchTimeout = null;
    }
    this.operations.clear();
    this.profileCooldowns.clear();
    this.pendingNotifications = [];
    this.removeAllListeners();
  }
}

/**
 * Get the global coordinator instance
 * @deprecated Use getOperationRegistry() from '../claude-profile/operation-registry' instead.
 */
export function getRecoveryCoordinator(): SDKSessionRecoveryCoordinator {
  return SDKSessionRecoveryCoordinator.getInstance();
}
