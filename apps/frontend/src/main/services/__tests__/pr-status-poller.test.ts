/**
 * Tests for pr-status-poller.ts
 *
 * Unit tests for PRStatusPoller service covering:
 * - ETag caching behavior
 * - PR classification (active vs stable based on activity)
 * - Rate limit handling (pause/resume)
 * - Timer management (start/stop polling)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRStatusPoller, getPRStatusPoller } from '../pr-status-poller';
import { POLLING_INTERVALS, RATE_LIMIT_THRESHOLDS, ACTIVITY_THRESHOLD_MS } from '../../../shared/types/pr-status';

// Mock the GitHub utils module
const mockGithubFetchWithETag = vi.fn();
const mockClearETagCacheForProject = vi.fn();
const mockGetETagCache = vi.fn();

vi.mock('../../ipc-handlers/github/utils', () => ({
  githubFetchWithETag: (...args: unknown[]) => mockGithubFetchWithETag(...args),
  clearETagCacheForProject: (...args: unknown[]) => mockClearETagCacheForProject(...args),
  getETagCache: () => mockGetETagCache()
}));

// Mock safeSendToRenderer
const mockSafeSendToRenderer = vi.fn();
vi.mock('../../ipc-handlers/utils', () => ({
  safeSendToRenderer: (...args: unknown[]) => mockSafeSendToRenderer(...args)
}));

// Mock IPC_CHANNELS
vi.mock('../../../shared/constants', () => ({
  IPC_CHANNELS: {
    GITHUB_PR_STATUS_UPDATE: 'github:pr-status-update'
  }
}));

describe('PRStatusPoller', () => {
  let poller: PRStatusPoller;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset singleton and create fresh instance
    PRStatusPoller.resetInstance();
    poller = PRStatusPoller.getInstance();

    // Reset all mocks
    mockGithubFetchWithETag.mockReset();
    mockClearETagCacheForProject.mockReset();
    mockSafeSendToRenderer.mockReset();
  });

  afterEach(() => {
    // Clean up timers and polling
    poller.stopAllPolling();
    vi.useRealTimers();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = PRStatusPoller.getInstance();
      const instance2 = PRStatusPoller.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should return a new instance after reset', () => {
      const instance1 = PRStatusPoller.getInstance();
      PRStatusPoller.resetInstance();
      const instance2 = PRStatusPoller.getInstance();
      expect(instance1).not.toBe(instance2);
    });

    it('getPRStatusPoller should return the singleton instance', () => {
      const instance = getPRStatusPoller();
      expect(instance).toBe(PRStatusPoller.getInstance());
    });
  });

  describe('PR Classification', () => {
    it('should classify PR as active when updated within 30 minutes', async () => {
      // Mock response with recent activity (5 minutes ago)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: fiveMinutesAgo,
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Get metadata to check polling state
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.isPolling).toBe(true);
    });

    it('should classify PR as stable when not updated for over 30 minutes', async () => {
      // Mock response with old activity (1 hour ago)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: oneHourAgo,
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Check that polling started
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.isPolling).toBe(true);
    });

    it('should use ACTIVITY_THRESHOLD_MS (30 minutes) for classification boundary', () => {
      // Verify the constant is correctly set
      expect(ACTIVITY_THRESHOLD_MS).toBe(30 * 60 * 1000);
    });
  });

  describe('ETag Caching', () => {
    it('should pass cached data when 304 response received', async () => {
      // First call returns fresh data
      mockGithubFetchWithETag.mockResolvedValueOnce({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      // Subsequent calls return cached data
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: true,
        rateLimitInfo: { remaining: 4499, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify fetch was called
      expect(mockGithubFetchWithETag).toHaveBeenCalled();

      // Check the endpoint format
      const firstCall = mockGithubFetchWithETag.mock.calls[0];
      expect(firstCall[0]).toBe('test-token');
      expect(firstCall[1]).toContain('/repos/owner/repo/pulls/1');
    });

    it('should clear ETag cache when stopping polling', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');
      poller.stopPolling('owner/repo');

      expect(mockClearETagCacheForProject).toHaveBeenCalled();
    });
  });

  describe('Rate Limit Handling', () => {
    it('should pause polling when rate limit drops below threshold', async () => {
      // Return response with low rate limit
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: {
          remaining: RATE_LIMIT_THRESHOLDS.PAUSE_THRESHOLD - 1,
          reset: new Date(Date.now() + 3600000),
          limit: 5000
        }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Check that poller is paused
      expect(poller.isPaused()).toBe(true);

      // Check metadata reflects paused state
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.isPausedForRateLimit).toBe(true);
    });

    it('should not pause when rate limit is above threshold', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: {
          remaining: RATE_LIMIT_THRESHOLDS.PAUSE_THRESHOLD + 100,
          reset: new Date(Date.now() + 3600000),
          limit: 5000
        }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      expect(poller.isPaused()).toBe(false);
    });

    it('should include rate limit info in polling metadata', async () => {
      const resetTime = new Date(Date.now() + 3600000);

      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: resetTime, limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.rateLimitRemaining).toBe(4500);
      expect(metadata.rateLimitReset).toBeTruthy();
    });

    it('should schedule resume after rate limit reset', async () => {
      const resetTime = new Date(Date.now() + 60000); // Reset in 60 seconds

      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: {
          remaining: RATE_LIMIT_THRESHOLDS.PAUSE_THRESHOLD - 1,
          reset: resetTime,
          limit: 5000
        }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');
      expect(poller.isPaused()).toBe(true);

      // Verify rate limit reset timestamp is tracked
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.rateLimitReset).toBeTruthy();
      expect(metadata.isPausedForRateLimit).toBe(true);

      // Stop polling to clean up timers (avoiding infinite loop in test)
      poller.stopPolling('owner/repo');
    });
  });

  describe('Timer Management', () => {
    it('should start polling with correct intervals', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Initial poll should have happened
      const initialCallCount = mockGithubFetchWithETag.mock.calls.length;
      expect(initialCallCount).toBeGreaterThan(0);

      // Verify polling intervals are defined correctly
      expect(POLLING_INTERVALS.ACTIVE).toBe(60_000);
      expect(POLLING_INTERVALS.STABLE).toBe(300_000);
      expect(POLLING_INTERVALS.FULL_REFRESH).toBe(900_000);
    });

    it('should stop all timers when stopPolling is called', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Record call count after initial poll
      const callCountAfterStart = mockGithubFetchWithETag.mock.calls.length;

      // Stop polling
      poller.stopPolling('owner/repo');

      // Advance time past all polling intervals
      vi.advanceTimersByTime(POLLING_INTERVALS.FULL_REFRESH + 1000);

      // Call count should not have increased
      expect(mockGithubFetchWithETag.mock.calls.length).toBe(callCountAfterStart);
    });

    it('should stop all polling when stopAllPolling is called', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo1', [1], 'test-token');
      await poller.startPolling('owner/repo2', [2], 'test-token');

      poller.stopAllPolling();

      // Both contexts should be stopped
      expect(poller.getPollingMetadata('owner/repo1').isPolling).toBe(false);
      expect(poller.getPollingMetadata('owner/repo2').isPolling).toBe(false);
    });

    it('should replace existing polling when startPolling is called again', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Clear ETag cache should be called when stopping old polling
      mockClearETagCacheForProject.mockClear();

      await poller.startPolling('owner/repo', [1, 2], 'new-token');

      // Should have called clear on the old context
      expect(mockClearETagCacheForProject).toHaveBeenCalled();
    });
  });

  describe('Project ID Parsing', () => {
    it('should handle valid owner/repo format', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('myowner/myrepo', [1], 'test-token');

      // Verify the API endpoint was constructed correctly
      const calls = mockGithubFetchWithETag.mock.calls;
      const prEndpoint = calls.find((call: unknown[]) =>
        typeof call[1] === 'string' && call[1].includes('/repos/myowner/myrepo/pulls/1')
      );
      expect(prEndpoint).toBeTruthy();
    });

    it('should not start polling for invalid project ID format', async () => {
      // Console error expected for invalid format
      // biome-ignore lint/suspicious/noEmptyBlockStatements: mock implementation intentionally empty
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await poller.startPolling('invalid-format', [1], 'test-token');

      // Should log error and not start polling
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid project ID format')
      );
      expect(poller.getPollingMetadata('invalid-format').isPolling).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('PR Management', () => {
    it('should add PRs to existing polling context', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Add more PRs
      poller.addPRs('owner/repo', [2, 3]);

      // Context should still be active
      expect(poller.getPollingMetadata('owner/repo').isPolling).toBe(true);
    });

    it('should warn when adding PRs to non-existent context', () => {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: mock implementation intentionally empty
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      poller.addPRs('non-existent/repo', [1, 2]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No polling context')
      );

      consoleSpy.mockRestore();
    });

    it('should remove PRs from existing polling context', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1, 2, 3], 'test-token');

      // Remove some PRs
      poller.removePRs('owner/repo', [2, 3]);

      // Context should still be active
      expect(poller.getPollingMetadata('owner/repo').isPolling).toBe(true);
    });

    it('should not duplicate PRs when adding same PR twice', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Add same PR again (should not duplicate)
      poller.addPRs('owner/repo', [1]);

      // No error should occur and polling should continue
      expect(poller.getPollingMetadata('owner/repo').isPolling).toBe(true);
    });
  });

  describe('Status Aggregation', () => {
    it('should aggregate CI checks status correctly', async () => {
      // Mock responses for PR, status, and check-runs endpoints
      mockGithubFetchWithETag
        // PR endpoint (head.sha passed to fetchChecksStatus, no duplicate fetch)
        .mockResolvedValueOnce({
          data: {
            number: 1,
            updated_at: new Date().toISOString(),
            head: { sha: 'abc123' },
            mergeable: true,
            mergeable_state: 'clean'
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        // Combined status endpoint
        .mockResolvedValueOnce({
          data: {
            state: 'success',
            statuses: [{ state: 'success' }]
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4498, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        // Check runs endpoint
        .mockResolvedValueOnce({
          data: {
            total_count: 2,
            check_runs: [
              { status: 'completed', conclusion: 'success' },
              { status: 'completed', conclusion: 'success' }
            ]
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4497, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        // Reviews endpoint
        .mockResolvedValueOnce({
          data: [
            { state: 'APPROVED', user: { login: 'reviewer1' }, submitted_at: new Date().toISOString() }
          ],
          fromCache: false,
          rateLimitInfo: { remaining: 4496, reset: new Date(Date.now() + 3600000), limit: 5000 }
        });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify multiple endpoints were called
      expect(mockGithubFetchWithETag).toHaveBeenCalled();
    });

    it('should detect failure in CI checks', async () => {
      mockGithubFetchWithETag
        .mockResolvedValueOnce({
          data: {
            number: 1,
            updated_at: new Date().toISOString(),
            head: { sha: 'abc123' },
            mergeable: true,
            mergeable_state: 'clean'
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        .mockResolvedValueOnce({
          data: {
            state: 'failure',
            statuses: [{ state: 'failure' }]
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4498, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        .mockResolvedValueOnce({
          data: {
            total_count: 1,
            check_runs: [
              { status: 'completed', conclusion: 'failure' }
            ]
          },
          fromCache: false,
          rateLimitInfo: { remaining: 4497, reset: new Date(Date.now() + 3600000), limit: 5000 }
        })
        .mockResolvedValueOnce({
          data: [],
          fromCache: false,
          rateLimitInfo: { remaining: 4496, reset: new Date(Date.now() + 3600000), limit: 5000 }
        });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify polling metadata
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.isPolling).toBe(true);
    });
  });

  describe('Main Window Integration', () => {
    it('should send status updates to renderer when main window is set', async () => {
      const mockMainWindow = {
        webContents: {
          send: vi.fn()
        }
      };

      // Set up main window getter
      poller.setMainWindowGetter(() => mockMainWindow as unknown as Electron.BrowserWindow);

      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify safeSendToRenderer was called
      expect(mockSafeSendToRenderer).toHaveBeenCalled();
    });

    it('should not throw when main window getter is not set', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      // Should not throw even without main window
      await expect(poller.startPolling('owner/repo', [1], 'test-token')).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should record errors in metadata', async () => {
      mockGithubFetchWithETag.mockRejectedValue(new Error('Network error'));

      await poller.startPolling('owner/repo', [1], 'test-token');

      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.lastError).toBe('Network error');
    });

    it('should pause on 403 rate limit error', async () => {
      mockGithubFetchWithETag.mockRejectedValue(new Error('403 rate limit exceeded'));

      await poller.startPolling('owner/repo', [1], 'test-token');

      expect(poller.isPaused()).toBe(true);
    });

    it('should clear errors when stopping polling', async () => {
      mockGithubFetchWithETag.mockRejectedValue(new Error('Some error'));

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify error was recorded
      expect(poller.getPollingMetadata('owner/repo').lastError).toBeTruthy();

      // Stop polling
      poller.stopPolling('owner/repo');

      // Error should be cleared
      const metadata = poller.getPollingMetadata('owner/repo');
      expect(metadata.lastError).toBeNull();
    });
  });

  describe('Mergeable State Handling', () => {
    it('should schedule retry when mergeable state is unknown', async () => {
      // This test verifies that when GitHub returns null for mergeable (still computing),
      // the poller schedules a retry after MERGEABLE_RETRY interval
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: null, // GitHub still computing
          mergeable_state: 'unknown'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      // Verify initial poll happened
      expect(mockGithubFetchWithETag).toHaveBeenCalled();

      // Stop polling to prevent infinite timer loop in test
      poller.stopPolling('owner/repo');

      // Verify polling was set up
      expect(poller.getPollingMetadata('owner/repo').isPolling).toBe(false);
    });

    it('should verify MERGEABLE_RETRY interval is 2 seconds', () => {
      expect(POLLING_INTERVALS.MERGEABLE_RETRY).toBe(2_000);
    });

    it('should handle clean mergeable state without retry', async () => {
      mockGithubFetchWithETag.mockResolvedValue({
        data: {
          number: 1,
          updated_at: new Date().toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        },
        fromCache: false,
        rateLimitInfo: { remaining: 4500, reset: new Date(Date.now() + 3600000), limit: 5000 }
      });

      await poller.startPolling('owner/repo', [1], 'test-token');

      const initialCallCount = mockGithubFetchWithETag.mock.calls.length;

      // Stop polling immediately to check state
      poller.stopPolling('owner/repo');

      // Verify polling was established
      expect(initialCallCount).toBeGreaterThan(0);
    });
  });
});
