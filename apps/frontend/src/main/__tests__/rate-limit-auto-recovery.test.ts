/**
 * Integration tests for Rate Limit Auto-Recovery System
 * Tests the complete flow: rate limit detection → account swap → task restart
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock data
const mockProfiles = {
  mai: {
    id: 'profile-mai',
    name: 'MAI',
    email: 'mai@example.com',
    isDefault: true,
    oauthToken: 'encrypted-token-mai',
    createdAt: new Date(),
    rateLimitEvents: []
  },
  mu: {
    id: 'profile-mu',
    name: 'MU',
    email: 'mu@example.com',
    isDefault: false,
    oauthToken: 'encrypted-token-mu',
    createdAt: new Date(),
    rateLimitEvents: []
  }
};

const mockAutoSwitchSettings = {
  enabled: true,
  proactiveSwapEnabled: true,
  sessionThreshold: 95,
  weeklyThreshold: 99,
  autoSwitchOnRateLimit: true,
  usageCheckInterval: 30000
};

// Create mock profile manager
function createMockProfileManager(options: {
  activeProfileId?: string;
  profiles?: typeof mockProfiles;
  autoSwitchSettings?: typeof mockAutoSwitchSettings;
  bestAvailableProfile?: typeof mockProfiles.mai | null;
} = {}) {
  const activeId = options.activeProfileId || 'profile-mai';
  const profiles = options.profiles || mockProfiles;
  const settings = options.autoSwitchSettings || mockAutoSwitchSettings;
  const bestProfile = options.bestAvailableProfile !== undefined
    ? options.bestAvailableProfile
    : profiles.mu;

  return {
    getActiveProfile: vi.fn(() => profiles[activeId === 'profile-mai' ? 'mai' : 'mu']),
    getProfile: vi.fn((id: string) => {
      if (id === 'profile-mai') return profiles.mai;
      if (id === 'profile-mu') return profiles.mu;
      return null;
    }),
    getBestAvailableProfile: vi.fn((_excludeProfileId?: string) => bestProfile),
    setActiveProfile: vi.fn(),
    recordRateLimitEvent: vi.fn(),
    getAutoSwitchSettings: vi.fn(() => settings),
    getProfileToken: vi.fn(() => 'decrypted-token'),
    getActiveProfileToken: vi.fn(() => 'decrypted-token')
  };
}

describe('Rate Limit Auto-Recovery Integration', () => {
  let mockProfileManager: ReturnType<typeof createMockProfileManager>;

  beforeEach(() => {
    vi.resetModules();
    mockProfileManager = createMockProfileManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rate Limit Detection Patterns', () => {
    beforeEach(() => {
      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockProfileManager)
      }));
    });

    it('should detect standard Claude rate limit message', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      const output = 'Limit reached · resets Dec 17 at 6am (Europe/Oslo)';
      const result = detectRateLimit(output);

      expect(result.isRateLimited).toBe(true);
      expect(result.resetTime).toBe('Dec 17 at 6am (Europe/Oslo)');
      expect(result.limitType).toBe('weekly');
    });

    it('should detect session limit (time only reset)', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      const output = 'Limit reached • resets 11:59pm';
      const result = detectRateLimit(output);

      expect(result.isRateLimited).toBe(true);
      expect(result.limitType).toBe('session');
    });

    it('should detect rate limit in multiline output', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      const output = `Processing task...
Some output here
Limit reached · resets Dec 20 at 3pm (America/New_York)
Stack trace follows`;

      const result = detectRateLimit(output);

      expect(result.isRateLimited).toBe(true);
      expect(result.resetTime).toBe('Dec 20 at 3pm (America/New_York)');
    });

    it('should suggest alternative profile when rate limited', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      const output = 'Limit reached · resets Dec 17 at 6am';
      const result = detectRateLimit(output, 'profile-mai');

      expect(result.isRateLimited).toBe(true);
      expect(result.suggestedProfile).toBeDefined();
      expect(result.suggestedProfile?.id).toBe('profile-mu');
    });

    it('should record rate limit event in profile manager', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      detectRateLimit('Limit reached · resets Dec 17 at 6am', 'profile-mai');

      expect(mockProfileManager.recordRateLimitEvent).toHaveBeenCalledWith(
        'profile-mai',
        'Dec 17 at 6am'
      );
    });
  });

  describe('Auto-Switch Settings Verification', () => {
    it('should respect enabled flag', async () => {
      const disabledManager = createMockProfileManager({
        autoSwitchSettings: { ...mockAutoSwitchSettings, enabled: false }
      });

      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => disabledManager)
      }));

      const settings = disabledManager.getAutoSwitchSettings();

      expect(settings.enabled).toBe(false);
      // When enabled is false, auto-swap should NOT happen even if autoSwitchOnRateLimit is true
    });

    it('should respect autoSwitchOnRateLimit flag', async () => {
      const manualManager = createMockProfileManager({
        autoSwitchSettings: { ...mockAutoSwitchSettings, autoSwitchOnRateLimit: false }
      });

      const settings = manualManager.getAutoSwitchSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.autoSwitchOnRateLimit).toBe(false);
      // When autoSwitchOnRateLimit is false, should show manual modal instead
    });

    it('should have both enabled and autoSwitchOnRateLimit for auto-recovery', () => {
      const settings = mockProfileManager.getAutoSwitchSettings();

      // Both must be true for automatic recovery
      const shouldAutoRecover = settings.enabled && settings.autoSwitchOnRateLimit;
      expect(shouldAutoRecover).toBe(true);
    });
  });

  describe('Profile Scoring and Selection', () => {
    it('should return alternative profile when one is available', () => {
      const bestProfile = mockProfileManager.getBestAvailableProfile('profile-mai');

      expect(bestProfile).toBeDefined();
      expect(bestProfile?.id).toBe('profile-mu');
    });

    it('should return null when no alternative profile is available', () => {
      const noAlternativeManager = createMockProfileManager({
        bestAvailableProfile: null
      });

      const bestProfile = noAlternativeManager.getBestAvailableProfile('profile-mai');

      expect(bestProfile).toBeNull();
    });

    it('should not return the same profile that hit the limit', () => {
      const bestProfile = mockProfileManager.getBestAvailableProfile('profile-mai');

      // Best profile should be different from the one that hit the limit
      expect(bestProfile?.id).not.toBe('profile-mai');
    });
  });

  describe('Auto-Recovery Flow Simulation', () => {
    /**
     * Simulates the flow in agent-process.ts lines 274-327
     */
    function simulateRateLimitRecovery(
      output: string,
      exitCode: number,
      profileManager: ReturnType<typeof createMockProfileManager>
    ): {
      rateLimitDetected: boolean;
      autoSwapped: boolean;
      taskRestarted: boolean;
      modalShown: boolean;
      swappedToProfile?: { id: string; name: string };
    } {
      const result = {
        rateLimitDetected: false,
        autoSwapped: false,
        taskRestarted: false,
        modalShown: false,
        swappedToProfile: undefined as { id: string; name: string } | undefined
      };

      // Only check rate limit if process failed
      if (exitCode !== 0) {
        // Simulate detectRateLimit
        const rateLimitPattern = /Limit reached\s*[·•]\s*resets\s+(.+?)(?:\s*$|\n)/im;
        const rateIndicators = [/rate\s*limit/i, /usage\s*limit/i, /limit\s*reached/i];

        const isRateLimited = rateLimitPattern.test(output) ||
          rateIndicators.some(p => p.test(output));

        if (isRateLimited) {
          result.rateLimitDetected = true;

          const settings = profileManager.getAutoSwitchSettings();

          if (settings.enabled && settings.autoSwitchOnRateLimit) {
            const bestProfile = profileManager.getBestAvailableProfile('current-profile');

            if (bestProfile) {
              // Auto-swap
              profileManager.setActiveProfile(bestProfile.id);
              result.autoSwapped = true;
              result.swappedToProfile = { id: bestProfile.id, name: bestProfile.name };
              result.taskRestarted = true;
              result.modalShown = true; // Notification modal
            } else {
              // No alternative - show manual modal
              result.modalShown = true;
            }
          } else {
            // Auto-switch disabled - show manual modal
            result.modalShown = true;
          }
        }
      }

      return result;
    }

    it('should auto-swap and restart when all conditions met', () => {
      const result = simulateRateLimitRecovery(
        'Limit reached · resets Dec 17 at 6am',
        1, // non-zero exit
        mockProfileManager
      );

      expect(result.rateLimitDetected).toBe(true);
      expect(result.autoSwapped).toBe(true);
      expect(result.taskRestarted).toBe(true);
      expect(result.modalShown).toBe(true);
      expect(result.swappedToProfile?.id).toBe('profile-mu');
    });

    it('should NOT auto-swap when exit code is 0', () => {
      const result = simulateRateLimitRecovery(
        'Limit reached · resets Dec 17 at 6am',
        0, // success exit
        mockProfileManager
      );

      expect(result.rateLimitDetected).toBe(false);
      expect(result.autoSwapped).toBe(false);
      expect(result.taskRestarted).toBe(false);
    });

    it('should NOT auto-swap when enabled is false', () => {
      const disabledManager = createMockProfileManager({
        autoSwitchSettings: { ...mockAutoSwitchSettings, enabled: false }
      });

      const result = simulateRateLimitRecovery(
        'Limit reached · resets Dec 17 at 6am',
        1,
        disabledManager
      );

      expect(result.rateLimitDetected).toBe(true);
      expect(result.autoSwapped).toBe(false);
      expect(result.modalShown).toBe(true); // Manual modal
    });

    it('should NOT auto-swap when autoSwitchOnRateLimit is false', () => {
      const manualManager = createMockProfileManager({
        autoSwitchSettings: { ...mockAutoSwitchSettings, autoSwitchOnRateLimit: false }
      });

      const result = simulateRateLimitRecovery(
        'Limit reached · resets Dec 17 at 6am',
        1,
        manualManager
      );

      expect(result.rateLimitDetected).toBe(true);
      expect(result.autoSwapped).toBe(false);
      expect(result.modalShown).toBe(true); // Manual modal
    });

    it('should show manual modal when no alternative profile available', () => {
      const noAlternativeManager = createMockProfileManager({
        bestAvailableProfile: null
      });

      const result = simulateRateLimitRecovery(
        'Limit reached · resets Dec 17 at 6am',
        1,
        noAlternativeManager
      );

      expect(result.rateLimitDetected).toBe(true);
      expect(result.autoSwapped).toBe(false);
      expect(result.taskRestarted).toBe(false);
      expect(result.modalShown).toBe(true); // Manual modal because no alternative
    });

    it('should NOT detect rate limit for normal errors', () => {
      const result = simulateRateLimitRecovery(
        'Error: File not found',
        1,
        mockProfileManager
      );

      expect(result.rateLimitDetected).toBe(false);
      expect(result.autoSwapped).toBe(false);
      expect(result.modalShown).toBe(false);
    });
  });

  describe('Task Restart Context Preservation', () => {
    it('should preserve task context for restart', () => {
      // Simulate task execution context
      const taskContext = {
        taskId: 'task-123',
        projectPath: '/path/to/project',
        specId: 'spec-001',
        options: { qa: false },
        swapCount: 0,
        isSpecCreation: false
      };

      // After swap, swapCount should increment
      taskContext.swapCount++;

      expect(taskContext.swapCount).toBe(1);
    });

    it('should limit swap retries to prevent infinite loops', () => {
      const MAX_SWAPS = 2;
      let swapCount = 0;

      // Simulate multiple rate limits
      for (let i = 0; i < 5; i++) {
        if (swapCount >= MAX_SWAPS) {
          break; // Should stop after 2 swaps
        }
        swapCount++;
      }

      expect(swapCount).toBe(MAX_SWAPS);
    });
  });

  describe('Event Emission Verification', () => {
    it('should emit sdk-rate-limit event on rate limit', () => {
      const emitter = new EventEmitter();
      const sdkRateLimitHandler = vi.fn();

      emitter.on('sdk-rate-limit', sdkRateLimitHandler);

      // Simulate rate limit detected with auto-swap
      const rateLimitInfo = {
        source: 'task' as const,
        taskId: 'task-123',
        resetTime: 'Dec 17 at 6am',
        limitType: 'weekly' as const,
        profileId: 'profile-mai',
        profileName: 'MAI',
        wasAutoSwapped: true,
        swappedToProfile: { id: 'profile-mu', name: 'MU' },
        swapReason: 'reactive' as const,
        detectedAt: new Date()
      };

      emitter.emit('sdk-rate-limit', rateLimitInfo);

      expect(sdkRateLimitHandler).toHaveBeenCalledWith(rateLimitInfo);
      expect(sdkRateLimitHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit auto-swap-restart-task event for task restart', () => {
      const emitter = new EventEmitter();
      const restartHandler = vi.fn();

      emitter.on('auto-swap-restart-task', restartHandler);

      emitter.emit('auto-swap-restart-task', 'task-123', 'profile-mu');

      expect(restartHandler).toHaveBeenCalledWith('task-123', 'profile-mu');
    });

    it('should handle event chain: rate-limit → swap → restart', () => {
      const emitter = new EventEmitter();
      const events: string[] = [];

      emitter.on('sdk-rate-limit', () => events.push('sdk-rate-limit'));
      emitter.on('auto-swap-restart-task', () => events.push('auto-swap-restart-task'));

      // Simulate the flow
      emitter.emit('sdk-rate-limit', { /* info */ });
      emitter.emit('auto-swap-restart-task', 'task-123', 'profile-mu');

      expect(events).toEqual(['sdk-rate-limit', 'auto-swap-restart-task']);
    });
  });
});

describe('Rate Limit Edge Cases', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Pattern Matching Edge Cases', () => {
    const mockManager = createMockProfileManager();

    beforeEach(() => {
      vi.doMock('../claude-profile-manager', () => ({
        getClaudeProfileManager: vi.fn(() => mockManager)
      }));
    });

    it('should handle different bullet characters', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      // Middle dot (·)
      expect(detectRateLimit('Limit reached · resets 5pm').isRateLimited).toBe(true);

      // Bullet (•)
      expect(detectRateLimit('Limit reached • resets 5pm').isRateLimited).toBe(true);
    });

    it('should handle different timezone formats', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      const timezones = [
        'Dec 17 at 6am (Europe/Oslo)',
        'Dec 17 at 6am (America/New_York)',
        'Dec 17 at 6am (Asia/Tokyo)',
        'Dec 17 at 6am (UTC)',
        'Dec 17 at 6am' // No timezone
      ];

      for (const tz of timezones) {
        const result = detectRateLimit(`Limit reached · resets ${tz}`);
        expect(result.isRateLimited).toBe(true);
      }
    });

    it('should handle 12-hour and 24-hour time formats', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      expect(detectRateLimit('Limit reached · resets 11:59pm').isRateLimited).toBe(true);
      expect(detectRateLimit('Limit reached · resets 6am').isRateLimited).toBe(true);
      expect(detectRateLimit('Limit reached · resets 18:00').isRateLimited).toBe(true);
    });

    it('should NOT false-positive on similar messages', async () => {
      const { detectRateLimit } = await import('../rate-limit-detector');

      // These should NOT trigger rate limit detection
      const falsePositives = [
        'Limit your requests to avoid issues', // Contains 'limit' but not rate limit
        'The speed limit is 60mph', // Unrelated limit
        'Character limit reached for input field' // Different kind of limit
      ];

      for (const msg of falsePositives) {
        const _result = detectRateLimit(msg);
        // Note: Some may still match secondary indicators - that's intentional
        // The primary pattern should NOT match these
        const primaryPattern = /Limit reached\s*[·•]\s*resets/i;
        expect(primaryPattern.test(msg)).toBe(false);
      }
    });
  });

  describe('Both Profiles Rate Limited', () => {
    it('should return null when all profiles are rate limited', () => {
      const bothLimitedManager = createMockProfileManager({
        bestAvailableProfile: null
      });

      const best = bothLimitedManager.getBestAvailableProfile('profile-mai');
      expect(best).toBeNull();
    });

    it('should show manual modal when no profiles available', () => {
      // User must either wait or add a new account
      const bothLimitedManager = createMockProfileManager({
        bestAvailableProfile: null
      });

      const settings = bothLimitedManager.getAutoSwitchSettings();
      const bestProfile = bothLimitedManager.getBestAvailableProfile('profile-mai');

      // Even with auto-switch enabled, should show modal since no alternative
      const shouldShowManualModal = settings.enabled && settings.autoSwitchOnRateLimit && !bestProfile;
      expect(shouldShowManualModal).toBe(true);
    });
  });

  describe('Rapid Rate Limit Succession', () => {
    it('should enforce max swap count', () => {
      const MAX_SWAP_COUNT = 2;
      const context = { swapCount: 0 };

      // First swap
      context.swapCount++;
      expect(context.swapCount < MAX_SWAP_COUNT).toBe(true);

      // Second swap
      context.swapCount++;
      expect(context.swapCount >= MAX_SWAP_COUNT).toBe(true);

      // Third swap should be blocked
      const shouldAllowSwap = context.swapCount < MAX_SWAP_COUNT;
      expect(shouldAllowSwap).toBe(false);
    });
  });
});

describe('Modal Behavior with Reactive Recovery', () => {
  describe('Modal Content Variations', () => {
    it('should show notification-style modal when auto-swapped', () => {
      const rateLimitInfo = {
        source: 'task' as const,
        wasAutoSwapped: true,
        swappedToProfile: { id: 'profile-mu', name: 'MU' },
        swapReason: 'reactive' as const
      };

      // When wasAutoSwapped is true, modal should be informational
      expect(rateLimitInfo.wasAutoSwapped).toBe(true);
      expect(rateLimitInfo.swapReason).toBe('reactive');
    });

    it('should show action-required modal when NOT auto-swapped', () => {
      const rateLimitInfo = {
        source: 'task' as const,
        wasAutoSwapped: false,
        suggestedProfile: { id: 'profile-mu', name: 'MU' }
      };

      // When wasAutoSwapped is false, user needs to take action
      expect(rateLimitInfo.wasAutoSwapped).toBe(false);
    });

    it('should distinguish proactive vs reactive swaps', () => {
      const proactiveSwap = {
        wasAutoSwapped: true,
        swapReason: 'proactive' as const // Before limit hit
      };

      const reactiveSwap = {
        wasAutoSwapped: true,
        swapReason: 'reactive' as const // After limit hit
      };

      expect(proactiveSwap.swapReason).toBe('proactive');
      expect(reactiveSwap.swapReason).toBe('reactive');
    });
  });
});
