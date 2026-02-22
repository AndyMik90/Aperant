/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { UsageIndicator } from './UsageIndicator';
import { useSettingsStore } from '../stores/settings-store';

vi.mock('../stores/settings-store', () => ({
  useSettingsStore: vi.fn()
}));

vi.mock('./ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}));

vi.mock('./ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:usage.loading': 'Loading usage',
        'common:usage.reauthRequired': 'Re-authentication required',
        'common:usage.reauthRequiredDescription': 'Your session has expired. Re-authenticate to continue.',
        'common:usage.clickToOpenSettings': 'Open settings',
        'common:usage.dataUnavailable': 'Usage data unavailable',
        'common:usage.dataUnavailableDescription': 'Usage data is not currently available.',
        'common:usage.notAvailable': 'N/A'
      };
      return translations[key] || key;
    },
    i18n: { language: 'en' }
  }))
}));

let mockActiveProfileId: string | null = null;
let onAllProfilesUsageUpdatedCallback: ((allProfilesUsage: AllProfilesUsagePayload) => void) | undefined;
type AllProfilesUsagePayload = ReturnType<typeof buildAllProfilesUsageResponse>['data'];

function buildAllProfilesUsageResponse(needsReauthentication: boolean) {
  return {
    success: true,
    data: {
      activeProfile: {
        sessionPercent: 0,
        weeklyPercent: 0,
        profileId: 'oauth-profile-1',
        profileName: 'OAuth Profile 1',
        fetchedAt: new Date(),
        needsReauthentication
      },
      allProfiles: [
        {
          profileId: 'oauth-profile-1',
          profileName: 'OAuth Profile 1',
          sessionPercent: 0,
          weeklyPercent: 0,
          isAuthenticated: true,
          isRateLimited: false,
          availabilityScore: 100,
          isActive: true,
          needsReauthentication
        }
      ],
      fetchedAt: new Date()
    }
  };
}

describe('UsageIndicator re-auth handling by auth mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveProfileId = null;
    onAllProfilesUsageUpdatedCallback = undefined;

    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      const state = { activeProfileId: mockActiveProfileId } satisfies { activeProfileId: string | null };
      return selector(state as any);
    });

    (window as any).electronAPI = {
      onUsageUpdated: vi.fn(() => vi.fn()),
      onAllProfilesUsageUpdated: vi.fn((callback: (allProfilesUsage: AllProfilesUsagePayload) => void) => {
        onAllProfilesUsageUpdatedCallback = callback;
        return vi.fn();
      }),
      requestUsageUpdate: vi.fn().mockResolvedValue({ success: false, data: null }),
      requestAllProfilesUsage: vi.fn().mockResolvedValue(buildAllProfilesUsageResponse(true))
    };
  });

  it('does not show OAuth re-auth UI in API profile mode', async () => {
    mockActiveProfileId = 'api-profile-1';

    render(<UsageIndicator />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Usage data unavailable' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Re-authentication required')).not.toBeInTheDocument();
  });

  it('shows re-auth UI in OAuth mode when active profile needs re-authentication', async () => {
    render(<UsageIndicator />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Re-authentication required' })).toBeInTheDocument();
    });

    expect(screen.getByText('Re-authentication required')).toBeInTheDocument();
  });

  it('ignores re-auth updates from usage events in API profile mode', async () => {
    mockActiveProfileId = 'api-profile-1';

    render(<UsageIndicator />);

    await waitFor(() => {
      expect(onAllProfilesUsageUpdatedCallback).toBeDefined();
    });

    await act(async () => {
      onAllProfilesUsageUpdatedCallback?.(buildAllProfilesUsageResponse(true).data);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Usage data unavailable' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Re-authentication required')).not.toBeInTheDocument();
  });
});
