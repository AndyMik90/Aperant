/**
 * Unified registry for ALL Claude Agent SDK operations.
 *
 * This is the single source of truth for tracking running operations that use
 * Claude profiles. It enables:
 * 1. Proactive account swapping - restart operations on a different profile
 * 2. Rate limit recovery - know which operations to restart after auth refresh
 * 3. Usage attribution - track which profile is being used by which operation
 *
 * Operations include:
 * - Autonomous tasks (spec creation, task execution)
 * - GitHub PR reviews
 * - GitLab MR reviews
 * - Insights analysis
 * - Roadmap generation
 * - Changelog generation
 * - Any other Claude SDK subprocess
 */

import { EventEmitter } from 'events';

/**
 * Types of operations that use Claude SDK
 */
export type OperationType =
  | 'spec-creation'
  | 'task-execution'
  | 'pr-review'
  | 'mr-review'
  | 'insights'
  | 'roadmap'
  | 'changelog'
  | 'ideation'
  | 'triage'
  | 'other';

/**
 * Registered operation entry
 *
 * IMPORTANT: Object reference stability during restarts
 * =====================================================
 * When an operation is restarted via restartFn, the restartFn implementation may
 * choose to re-register the operation (creating a new RegisteredOperation object)
 * OR update the existing one. Either approach is valid:
 *
 * 1. RE-REGISTRATION (AgentManager pattern):
 *    - restartFn calls registerOperation() which replaces the Map entry
 *    - Creates a new RegisteredOperation object with fresh closures
 *    - Previous object references become stale and should not be used
 *    - Callers MUST call getOperation(id) again to get the fresh reference
 *
 * 2. IN-PLACE UPDATE (alternative pattern):
 *    - restartFn updates internal state but doesn't re-register
 *    - Object reference remains valid
 *    - Registry calls updateOperationProfile() to sync profileId
 *
 * BEST PRACTICE for consumers:
 * - Don't hold long-lived references to RegisteredOperation objects
 * - Always use getOperation(id) to get current state
 * - Subscribe to 'operation-restarted' events to know when to refresh
 * - If you must hold a reference, listen for 'operation-restarted' and refresh it
 */
export interface RegisteredOperation {
  /** Unique operation ID */
  id: string;
  /** Type of operation */
  type: OperationType;
  /** Profile ID currently being used */
  profileId: string;
  /** Profile name for logging */
  profileName: string;
  /** When the operation started */
  startedAt: Date;
  /** Optional metadata (project ID, PR number, etc.) */
  metadata?: Record<string, unknown>;
  /**
   * Function to restart this operation with a new profile.
   * Returns true if restart was initiated successfully.
   * The registry will update the profileId after successful restart.
   *
   * IMPORTANT: This function may re-register the operation (creating a new object)
   * or update in-place. Callers should use getOperation(id) after restart to get
   * the current reference.
   */
  restartFn: (newProfileId: string) => boolean | Promise<boolean>;
  /**
   * Optional function to stop the operation.
   * Called before restart if provided.
   */
  stopFn?: () => void | Promise<void>;
}

/**
 * Events emitted by the operation registry
 *
 * NOTE: This interface is defined for documentation purposes only. It describes the event types
 * that ClaudeOperationRegistry can emit, but is not currently enforced at the type system level.
 * EventEmitter uses runtime event names, so type-safe event binding would require additional
 * type assertion infrastructure. This interface serves as documentation for consumers of the
 * operation registry to know which events are available and their callback signatures.
 */
export interface OperationRegistryEvents {
  'operation-registered': (operation: RegisteredOperation) => void;
  'operation-unregistered': (operationId: string, type: OperationType) => void;
  'operation-restarted': (operationId: string, oldProfileId: string, newProfileId: string) => void;
  'operations-restarted': (count: number, oldProfileId: string, newProfileId: string) => void;
  'operation-profile-updated': (operationId: string, oldProfileId: string, newProfileId: string) => void;
}

/**
 * Singleton registry for Claude SDK operations
 *
 * CONSUMER GUIDELINES: Object Reference Stability
 * ================================================
 * Operations may be restarted during profile swaps. When this happens:
 *
 * 1. The operation's restartFn is called with a new profileId
 * 2. The restartFn may choose to:
 *    a) Re-register the operation (creates new RegisteredOperation object), OR
 *    b) Update internal state without re-registering (keeps same object)
 *
 * 3. Either pattern is valid, but has implications for consumers:
 *    - Pattern (a): Previous object references become stale
 *    - Pattern (b): Object references remain valid
 *
 * BEST PRACTICES for consumers:
 * - Don't hold long-lived references to RegisteredOperation objects
 * - Always use getOperation(id) to get current state when needed
 * - Subscribe to 'operation-restarted' events to know when state may have changed
 * - Use hasOperation(id) to verify an operation is still registered
 *
 * EXAMPLE: Safely working with operation references
 * ```typescript
 * const registry = getOperationRegistry();
 *
 * // Initial fetch
 * let operation = registry.getOperation('task-123');
 *
 * // Listen for restarts
 * registry.onOperationRestarted((operationId, oldProfileId, newProfileId) => {
 *   if (operationId === 'task-123') {
 *     // Refresh reference after restart
 *     operation = registry.getOperation('task-123');
 *     console.log('Operation restarted with new profile:', newProfileId);
 *   }
 * });
 *
 * // When accessing operation state later, prefer fresh fetch:
 * const currentOp = registry.getOperation('task-123');
 * if (currentOp) {
 *   console.log('Current profile:', currentOp.profileId);
 * }
 * ```
 */
class ClaudeOperationRegistry extends EventEmitter {
  private operations: Map<string, RegisteredOperation> = new Map();
  private debugMode: boolean;

  constructor() {
    super();
    this.debugMode = process.env.DEBUG === 'true';
  }

  private debugLog(...args: unknown[]): void {
    if (this.debugMode) {
      console.log('[OperationRegistry]', ...args);
    }
  }

  /**
   * Register a new operation
   */
  registerOperation(
    id: string,
    type: OperationType,
    profileId: string,
    profileName: string,
    restartFn: RegisteredOperation['restartFn'],
    options?: {
      stopFn?: RegisteredOperation['stopFn'];
      metadata?: Record<string, unknown>;
    }
  ): void {
    const operation: RegisteredOperation = {
      id,
      type,
      profileId,
      profileName,
      startedAt: new Date(),
      restartFn,
      stopFn: options?.stopFn,
      metadata: options?.metadata,
    };

    this.operations.set(id, operation);
    this.debugLog('Operation registered:', {
      id,
      type,
      profileId,
      profileName,
      metadata: options?.metadata,
    });

    this.emit('operation-registered', operation);
  }

  /**
   * Unregister an operation (when it completes or is cancelled)
   */
  unregisterOperation(id: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      this.operations.delete(id);
      this.debugLog('Operation unregistered:', { id, type: operation.type });
      this.emit('operation-unregistered', id, operation.type);
    }
  }

  /**
   * Get all operations running on a specific profile
   */
  getOperationsByProfile(profileId: string): RegisteredOperation[] {
    const result: RegisteredOperation[] = [];
    for (const op of this.operations.values()) {
      if (op.profileId === profileId) {
        result.push(op);
      }
    }
    return result;
  }

  /**
   * Get all running operations grouped by profile
   */
  getAllOperationsByProfile(): Record<string, RegisteredOperation[]> {
    const result: Record<string, RegisteredOperation[]> = {};
    for (const op of this.operations.values()) {
      if (!result[op.profileId]) {
        result[op.profileId] = [];
      }
      result[op.profileId].push(op);
    }
    return result;
  }

  /**
   * Get operation by ID
   *
   * IMPORTANT: Always call this method to get the current operation state.
   * Don't hold long-lived references to RegisteredOperation objects, as they
   * may become stale after a restart. Instead, call getOperation(id) whenever
   * you need current state, or subscribe to 'operation-restarted' events.
   */
  getOperation(id: string): RegisteredOperation | undefined {
    return this.operations.get(id);
  }

  /**
   * Check if an operation exists and is currently registered.
   * Use this to verify an operation reference is still valid.
   *
   * @param id - Operation ID to check
   * @returns true if operation exists in registry, false otherwise
   */
  hasOperation(id: string): boolean {
    return this.operations.has(id);
  }

  /**
   * Get count of running operations
   */
  getOperationCount(): number {
    return this.operations.size;
  }

  /**
   * Get summary of running operations for logging
   */
  getSummary(): {
    totalRunning: number;
    byProfile: Record<string, string[]>;
    byType: Record<OperationType, number>;
  } {
    const byProfile: Record<string, string[]> = {};
    const byType: Record<string, number> = {};

    for (const op of this.operations.values()) {
      // By profile
      if (!byProfile[op.profileId]) {
        byProfile[op.profileId] = [];
      }
      byProfile[op.profileId].push(op.id);

      // By type
      byType[op.type] = (byType[op.type] || 0) + 1;
    }

    return {
      totalRunning: this.operations.size,
      byProfile,
      byType: byType as Record<OperationType, number>,
    };
  }

  /**
   * Restart all operations running on a specific profile with a new profile.
   * This is called by UsageMonitor during proactive swaps.
   *
   * IMPORTANT: Object reference stability after restart
   * ====================================================
   * When operations are restarted, their restartFn implementations may:
   * 1. Re-register the operation (AgentManager pattern) - creates new object
   * 2. Update in-place (alternative pattern) - keeps same object
   *
   * For consumers holding operation references:
   * - Your reference may become stale if the operation re-registers
   * - Always call getOperation(id) after this method to get fresh reference
   * - Or subscribe to 'operation-restarted' events and refresh on each event
   *
   * This method emits:
   * - 'operation-restarted' for each successful restart (use this to refresh refs)
   * - 'operations-restarted' once with total count
   * - 'operation-profile-updated' for each profile update
   *
   * @param oldProfileId - Profile ID to migrate away from
   * @param newProfileId - Profile ID to migrate to
   * @param newProfileName - Profile name for logging
   * @returns Number of operations that were restarted
   */
  async restartOperationsOnProfile(
    oldProfileId: string,
    newProfileId: string,
    newProfileName: string
  ): Promise<number> {
    const operations = this.getOperationsByProfile(oldProfileId);

    if (operations.length === 0) {
      this.debugLog('No operations to restart on profile:', oldProfileId);
      return 0;
    }

    console.log('[OperationRegistry] Restarting', operations.length, 'operations:', {
      from: oldProfileId,
      to: newProfileId,
      operations: operations.map(op => ({ id: op.id, type: op.type })),
    });

    let restartedCount = 0;

    for (const op of operations) {
      try {
        // Stop the operation first if a stop function is provided
        if (op.stopFn) {
          this.debugLog('Stopping operation before restart:', op.id);
          await op.stopFn();
        }

        // Call the restart function
        this.debugLog('Restarting operation:', op.id, 'with profile:', newProfileId);
        const success = await op.restartFn(newProfileId);

        if (success) {
          restartedCount++;

          // Update the profile for operations that weren't re-registered during restart.
          // For AgentManager tasks, restartFn may create a NEW object in the Map,
          // in which case this update is harmless (updates the new reference).
          // For other operations, this ensures the profile is properly updated.
          this.updateOperationProfile(op.id, newProfileId, newProfileName);

          // Re-fetch from Map to get the current object (restartFn may have
          // re-registered the operation with a new object)
          const currentOp = this.operations.get(op.id);

          console.log('[OperationRegistry] Operation restarted successfully:', {
            id: op.id,
            type: currentOp?.type ?? op.type,
            newProfile: newProfileName,
          });

          this.emit('operation-restarted', op.id, oldProfileId, newProfileId);
        } else {
          console.warn('[OperationRegistry] Operation restart returned false:', op.id);
        }
      } catch (error) {
        console.error('[OperationRegistry] Failed to restart operation:', op.id, error);
      }
    }

    if (restartedCount > 0) {
      this.emit('operations-restarted', restartedCount, oldProfileId, newProfileId);
    }

    console.log('[OperationRegistry] Restart complete:', {
      total: operations.length,
      succeeded: restartedCount,
      failed: operations.length - restartedCount,
    });

    return restartedCount;
  }

  /**
   * Update the profile assignment for an operation (e.g., after restart)
   */
  updateOperationProfile(id: string, newProfileId: string, newProfileName: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      const oldProfileId = operation.profileId;
      operation.profileId = newProfileId;
      operation.profileName = newProfileName;
      this.debugLog('Operation profile updated:', {
        id,
        from: oldProfileId,
        to: newProfileId,
      });
      this.emit('operation-profile-updated', id, oldProfileId, newProfileId);
    }
  }

  /**
   * Clear all registered operations (for testing or cleanup)
   */
  clear(): void {
    this.operations.clear();
    this.debugLog('All operations cleared');
  }

  /**
   * Type-safe event subscription: operation-registered
   * Subscribe to operation registration events
   */
  onOperationRegistered(callback: (operation: RegisteredOperation) => void): () => void {
    this.on('operation-registered', callback);
    return () => this.off('operation-registered', callback);
  }

  /**
   * Type-safe event subscription: operation-unregistered
   * Subscribe to operation unregistration events
   */
  onOperationUnregistered(callback: (operationId: string, type: OperationType) => void): () => void {
    this.on('operation-unregistered', callback);
    return () => this.off('operation-unregistered', callback);
  }

  /**
   * Type-safe event subscription: operation-restarted
   * Subscribe to individual operation restart events
   */
  onOperationRestarted(callback: (operationId: string, oldProfileId: string, newProfileId: string) => void): () => void {
    this.on('operation-restarted', callback);
    return () => this.off('operation-restarted', callback);
  }

  /**
   * Type-safe event subscription: operations-restarted
   * Subscribe to batch operation restart events
   */
  onOperationsRestarted(callback: (count: number, oldProfileId: string, newProfileId: string) => void): () => void {
    this.on('operations-restarted', callback);
    return () => this.off('operations-restarted', callback);
  }

  /**
   * Type-safe event subscription: operation-profile-updated
   * Subscribe to operation profile update events
   */
  onOperationProfileUpdated(callback: (operationId: string, oldProfileId: string, newProfileId: string) => void): () => void {
    this.on('operation-profile-updated', callback);
    return () => this.off('operation-profile-updated', callback);
  }
}

// Singleton instance
let registryInstance: ClaudeOperationRegistry | null = null;

/**
 * Get the singleton ClaudeOperationRegistry instance
 */
export function getOperationRegistry(): ClaudeOperationRegistry {
  if (!registryInstance) {
    registryInstance = new ClaudeOperationRegistry();
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing)
 */
export function resetOperationRegistry(): void {
  if (registryInstance) {
    registryInstance.clear();
    registryInstance.removeAllListeners();
  }
  registryInstance = null;
}
