/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for GitHubErrorDisplay component.
 * Tests error display, icon rendering, button visibility, and countdown functionality.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitHubErrorDisplay } from '../GitHubErrorDisplay';
import type { GitHubErrorInfo } from '../../types';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'githubErrors.rateLimitTitle': 'GitHub Rate Limit Reached',
        'githubErrors.authTitle': 'GitHub Authentication Required',
        'githubErrors.permissionTitle': 'GitHub Permission Denied',
        'githubErrors.notFoundTitle': 'GitHub Resource Not Found',
        'githubErrors.networkTitle': 'GitHub Connection Error',
        'githubErrors.unknownTitle': 'GitHub Error',
        'githubErrors.rateLimitMessage': 'GitHub API rate limit reached. Please wait a moment before trying again.',
        'githubErrors.rateLimitMessageMinutes': `GitHub API rate limit reached. Please wait ${options?.minutes ?? 'X'} minute(s) before trying again.`,
        'githubErrors.rateLimitMessageHours': `GitHub API rate limit reached. Rate limit resets in approximately ${options?.hours ?? 'X'} hour(s).`,
        'githubErrors.authMessage': 'GitHub authentication failed. Please check your GitHub token in Settings.',
        'githubErrors.permissionMessage': 'GitHub permission denied. Your token may not have the required access.',
        'githubErrors.permissionMessageScopes': `GitHub permission denied. Your token is missing required scopes: ${options?.scopes ?? ''}. Please update your GitHub token in Settings.`,
        'githubErrors.notFoundMessage': 'The requested GitHub resource was not found.',
        'githubErrors.networkMessage': 'Unable to connect to GitHub. Please check your internet connection.',
        'githubErrors.unknownMessage': 'An unexpected error occurred while communicating with GitHub.',
        'githubErrors.resetsIn': options?.time ? `Resets in ${options.time as string}` : 'Resets in',
        'githubErrors.countdownHoursMinutes': `${options?.hours ?? 0}h ${options?.minutes ?? 0}m`,
        'githubErrors.countdownMinutesSeconds': `${options?.minutes ?? 0}m ${options?.seconds ?? 0}s`,
        'githubErrors.rateLimitExpired': 'Rate limit has reset. You can retry now.',
        'githubErrors.requiredScopes': 'Required scopes',
        'buttons.retry': 'Retry',
        'actions.settings': 'Settings',
      };
      return translations[key] || key;
    },
  }),
}));

// Helper to create mock GitHubErrorInfo
function createMockErrorInfo(
  type: GitHubErrorInfo['type'],
  overrides: Partial<GitHubErrorInfo> = {}
): GitHubErrorInfo {
  const defaults: Record<string, GitHubErrorInfo> = {
    rate_limit: {
      type: 'rate_limit',
      message: 'GitHub API rate limit reached. Please wait a moment before trying again.',
      statusCode: 403,
    },
    auth: {
      type: 'auth',
      message: 'GitHub authentication failed. Please check your GitHub token in Settings.',
      statusCode: 401,
    },
    permission: {
      type: 'permission',
      message: 'GitHub permission denied. Your token may not have the required access.',
      statusCode: 403,
    },
    not_found: {
      type: 'not_found',
      message: 'The requested GitHub resource was not found.',
      statusCode: 404,
    },
    network: {
      type: 'network',
      message: 'Unable to connect to GitHub. Please check your internet connection.',
    },
    unknown: {
      type: 'unknown',
      message: 'An unexpected error occurred while communicating with GitHub.',
    },
  };

  return { ...defaults[type], ...overrides };
}

describe('GitHubErrorDisplay', () => {
  describe('rendering null/empty states', () => {
    it('should render nothing when error is null', () => {
      const { container } = render(<GitHubErrorDisplay error={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when error is an empty string', () => {
      // Empty string is falsy, so component should return null
      const { container } = render(
        <GitHubErrorDisplay error={'' as string} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('rendering with string error', () => {
    it('should render error display when error is a string', () => {
      render(<GitHubErrorDisplay error="401 Unauthorized" />);

      // Should show the auth title (parsed from the error)
      expect(screen.getByText('GitHub Authentication Required')).toBeInTheDocument();
    });

    it('should render error display for rate limit string error', () => {
      render(<GitHubErrorDisplay error="rate limit exceeded" />);

      expect(screen.getByText('GitHub Rate Limit Reached')).toBeInTheDocument();
    });
  });

  describe('rendering with GitHubErrorInfo object', () => {
    it('should render rate_limit error correctly', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Rate Limit Reached')).toBeInTheDocument();
      expect(
        screen.getByText(/GitHub API rate limit reached/)
      ).toBeInTheDocument();
    });

    it('should render auth error correctly', () => {
      const errorInfo = createMockErrorInfo('auth');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Authentication Required')).toBeInTheDocument();
      expect(screen.getByText(/authentication failed/)).toBeInTheDocument();
    });

    it('should render permission error correctly', () => {
      const errorInfo = createMockErrorInfo('permission', {
        requiredScopes: ['repo', 'workflow'],
      });
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Permission Denied')).toBeInTheDocument();
      // Check that permission message is rendered
      expect(screen.getByText(/Your token is missing required scopes/)).toBeInTheDocument();
      // Should show required scopes in the code element
      expect(screen.getByText('repo, workflow')).toBeInTheDocument();
    });

    it('should render not_found error correctly', () => {
      const errorInfo = createMockErrorInfo('not_found');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Resource Not Found')).toBeInTheDocument();
      expect(screen.getByText(/not found/)).toBeInTheDocument();
    });

    it('should render network error correctly', () => {
      const errorInfo = createMockErrorInfo('network');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Connection Error')).toBeInTheDocument();
      expect(screen.getByText(/Unable to connect/)).toBeInTheDocument();
    });

    it('should render unknown error correctly', () => {
      const errorInfo = createMockErrorInfo('unknown');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('GitHub Error')).toBeInTheDocument();
      expect(screen.getByText(/unexpected error/)).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('should render compact variant when compact=true', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      render(<GitHubErrorDisplay error={errorInfo} compact />);

      // In compact mode, the title is in a smaller span
      expect(screen.getByText('GitHub Rate Limit Reached')).toBeInTheDocument();
      // Should not render the card structure (no centered layout)
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    });

    it('should show retry button in compact mode for rate_limit errors', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} compact onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();

      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should show settings button in compact mode for auth errors', () => {
      const errorInfo = createMockErrorInfo('auth');
      const onOpenSettings = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} compact onOpenSettings={onOpenSettings} />);

      const settingsButton = screen.getByRole('button', { name: /settings/i });
      expect(settingsButton).toBeInTheDocument();

      fireEvent.click(settingsButton);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('full card mode (default)', () => {
    it('should render card structure by default', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      render(<GitHubErrorDisplay error={errorInfo} />);

      // Should render heading
      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    });

    it('should show retry button for rate_limit errors with onRetry callback', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();

      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should show retry button for network errors', () => {
      const errorInfo = createMockErrorInfo('network');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();
    });

    it('should show retry button for unknown errors', () => {
      const errorInfo = createMockErrorInfo('unknown');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();
    });

    it('should NOT show retry button for auth errors', () => {
      const errorInfo = createMockErrorInfo('auth');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should NOT show retry button for permission errors', () => {
      const errorInfo = createMockErrorInfo('permission');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should NOT show retry button for not_found errors', () => {
      const errorInfo = createMockErrorInfo('not_found');
      const onRetry = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should show settings button for auth errors with onOpenSettings callback', () => {
      const errorInfo = createMockErrorInfo('auth');
      const onOpenSettings = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={onOpenSettings} />);

      const settingsButton = screen.getByRole('button', { name: /settings/i });
      expect(settingsButton).toBeInTheDocument();

      fireEvent.click(settingsButton);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('should show settings button for permission errors', () => {
      const errorInfo = createMockErrorInfo('permission');
      const onOpenSettings = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={onOpenSettings} />);

      const settingsButton = screen.getByRole('button', { name: /settings/i });
      expect(settingsButton).toBeInTheDocument();
    });

    it('should NOT show settings button for rate_limit errors', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const onOpenSettings = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={onOpenSettings} />);

      expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument();
    });

    it('should NOT show settings button for network errors', () => {
      const errorInfo = createMockErrorInfo('network');
      const onOpenSettings = vi.fn();
      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={onOpenSettings} />);

      expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument();
    });
  });

  describe('rate limit countdown', () => {
    it('should display countdown for rate limit errors with reset time', () => {
      // Set reset time 5 minutes in the future
      const resetTime = new Date(Date.now() + 5 * 60 * 1000);
      const errorInfo = createMockErrorInfo('rate_limit', {
        rateLimitResetTime: resetTime,
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      // Should show countdown in "Xm Ys" format (e.g., "4m 59s" or "5m 0s")
      expect(screen.getByText(/Resets in \d+m \d+s/)).toBeInTheDocument();
    });

    it('should set up interval to update countdown', () => {
      vi.useFakeTimers();
      const resetTime = new Date(Date.now() + 2 * 60 * 1000);
      const errorInfo = createMockErrorInfo('rate_limit', {
        rateLimitResetTime: resetTime,
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      // Initial countdown should be displayed
      expect(screen.getByText(/Resets in/)).toBeInTheDocument();

      // Verify interval is running by checking timers
      const timerCount = vi.getTimerCount();
      expect(timerCount).toBe(1); // One interval should be running

      // Advance time and verify interval still fires
      vi.advanceTimersByTime(1000);
      expect(screen.getByText(/Resets in/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('should NOT show countdown for non-rate-limit errors', () => {
      const errorInfo = createMockErrorInfo('auth');
      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.queryByText(/Resets in/)).not.toBeInTheDocument();
    });

    it('should show rate limit expired message when reset time has passed', () => {
      // Set reset time in the past
      const resetTime = new Date(Date.now() - 1000);
      const errorInfo = createMockErrorInfo('rate_limit', {
        rateLimitResetTime: resetTime,
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(
        screen.getByText('Rate limit has reset. You can retry now.')
      ).toBeInTheDocument();
    });

    it('should cleanup interval on unmount', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const resetTime = new Date(Date.now() + 5 * 60 * 1000);
      const errorInfo = createMockErrorInfo('rate_limit', {
        rateLimitResetTime: resetTime,
      });

      const { unmount } = render(<GitHubErrorDisplay error={errorInfo} />);

      // Verify the countdown was rendered
      expect(screen.getByText(/Resets in/)).toBeInTheDocument();

      // Unmount and verify clearInterval was called
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('required scopes display', () => {
    it('should display required scopes for permission errors', () => {
      const errorInfo = createMockErrorInfo('permission', {
        requiredScopes: ['repo', 'read:org', 'workflow'],
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.getByText('Required scopes:')).toBeInTheDocument();
      // The scopes appear in a code element
      expect(screen.getByText('repo, read:org, workflow')).toBeInTheDocument();
    });

    it('should NOT display scopes section when no scopes are provided', () => {
      const errorInfo = createMockErrorInfo('permission', {
        requiredScopes: undefined,
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.queryByText('Required scopes:')).not.toBeInTheDocument();
    });

    it('should NOT display scopes section when scopes array is empty', () => {
      const errorInfo = createMockErrorInfo('permission', {
        requiredScopes: [],
      });

      render(<GitHubErrorDisplay error={errorInfo} />);

      expect(screen.queryByText('Required scopes:')).not.toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply custom className in full card mode', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const { container } = render(
        <GitHubErrorDisplay error={errorInfo} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should apply custom className in compact mode', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const { container } = render(
        <GitHubErrorDisplay error={errorInfo} compact className="custom-compact-class" />
      );

      expect(container.firstChild).toHaveClass('custom-compact-class');
    });
  });

  describe('callback stability', () => {
    it('should not call onRetry on initial render', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      const onRetry = vi.fn();

      render(<GitHubErrorDisplay error={errorInfo} onRetry={onRetry} />);

      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should not call onOpenSettings on initial render', () => {
      const errorInfo = createMockErrorInfo('auth');
      const onOpenSettings = vi.fn();

      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={onOpenSettings} />);

      expect(onOpenSettings).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have role="alert" for screen reader announcements', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      render(<GitHubErrorDisplay error={errorInfo} />);

      // The error card should have role="alert" for accessibility
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have role="alert" in compact mode', () => {
      const errorInfo = createMockErrorInfo('network');
      render(<GitHubErrorDisplay error={errorInfo} compact />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have accessible button labels', () => {
      const errorInfo = createMockErrorInfo('rate_limit');
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- callback not needed for this test
      render(<GitHubErrorDisplay error={errorInfo} onRetry={() => { /* no-op */ }} />);

      const button = screen.getByRole('button', { name: /retry/i });
      expect(button).toHaveTextContent('Retry');
    });

    it('should have accessible settings button label', () => {
      const errorInfo = createMockErrorInfo('auth');
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- callback not needed for this test
      render(<GitHubErrorDisplay error={errorInfo} onOpenSettings={() => { /* no-op */ }} />);

      const button = screen.getByRole('button', { name: /settings/i });
      expect(button).toHaveTextContent('Settings');
    });
  });
});
