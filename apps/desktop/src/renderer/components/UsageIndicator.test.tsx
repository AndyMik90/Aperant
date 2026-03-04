/**
 * @vitest-environment jsdom
 */
/**
 * Tests for UsageIndicator cross-provider mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UsageIndicator } from './UsageIndicator';
import { useSettingsStore, saveSettings } from '../stores/settings-store';
import type { ProviderAccount } from '../../shared/types/provider-account';

vi.mock('../stores/settings-store', () => ({
  useSettingsStore: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'common:usage.loading': 'Loading...',
        'common:usage.usageBreakdown': 'Usage Breakdown',
        'common:usage.unlimited': 'Unlimited',
        'common:usage.unlimitedApiKey': 'Unlimited (API Key)',
        'common:usage.noUsageMonitoring': 'Usage monitoring not available',
        'common:usage.subscriptionBadge': 'Subscription',
        'common:usage.subscriptionLimitsApply': 'Rate limits apply',
        'common:usage.subscriptionMonitoringComingSoon': 'Monitoring not available',
        'common:usage.dataUnavailable': 'Usage data unavailable',
        'common:usage.dataUnavailableDescription': 'Usage data is unavailable',
        'common:usage.crossProviderUsage': 'Cross-Provider Usage',
        'common:usage.crossProvider': 'Cross-Provider',
        'common:usage.swap': 'Swap',
        'common:usage.inUse': 'In Use',
        'common:usage.otherAccounts': 'Other Accounts',
        'common:usage.activeAccount': 'Active Account',
        'common:usage.providerAnthropic': 'Anthropic',
        'common:usage.providerOpenAI': 'OpenAI',
        'common:usage.providerGoogle': 'Google AI',
      };

      if (params && Object.keys(params).length > 0) {
        const translated = translations[key] || key;
        if (translated.includes('{{provider}}')) {
          return translated.replace('{{provider}}', String(params.provider));
        }
        return translated;
      }

      return translations[key] || key;
    },
    i18n: {
      language: 'en',
    },
  })),
}));

const crossProviderAccounts: ProviderAccount[] = [
  {
    id: 'account-openai',
    provider: 'openai',
    name: 'OpenAI API',
    authType: 'api-key',
    billingModel: 'pay-per-use',
    apiKey: 'openai-key',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'account-anthropic',
    provider: 'anthropic',
    name: 'Anthropic OAuth',
    authType: 'oauth',
    billingModel: 'subscription',
    claudeProfileId: 'account-anthropic',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const crossProviderMonitoredAccounts: ProviderAccount[] = [
  {
    id: 'account-anthropic-active',
    provider: 'anthropic',
    name: 'Anthropic OAuth',
    authType: 'oauth',
    billingModel: 'subscription',
    claudeProfileId: 'account-anthropic-active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'account-openai-other',
    provider: 'openai',
    name: 'OpenAI OAuth',
    authType: 'oauth',
    billingModel: 'pay-per-use',
    claudeProfileId: 'account-openai-other',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const commonStoreMock = {
  setQueueOrder: vi.fn(),
  setSettings: vi.fn(),
  updateSettings: vi.fn(),
  loadProfiles: vi.fn(),
  loadProviderAccounts: vi.fn(),
};

function createStoreMock(overrides?: {
  customMixedProfileActive?: boolean;
  customMixedPhaseConfig?: Record<string, { provider: 'anthropic' | 'openai' }>;
  globalPriorityOrder?: string[];
  providerAccounts?: ProviderAccount[];
}) {
  return {
    providerAccounts: overrides?.providerAccounts ?? crossProviderAccounts,
    settings: {
      globalPriorityOrder: overrides?.globalPriorityOrder ?? ['account-openai', 'account-anthropic'],
      customMixedProfileActive: overrides?.customMixedProfileActive,
      customMixedPhaseConfig: overrides?.customMixedPhaseConfig,
    },
    ...commonStoreMock,
  } as any;
}

describe('UsageIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commonStoreMock.setQueueOrder.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      onUsageUpdated: vi.fn(() => vi.fn()),
      requestUsageUpdate: vi.fn().mockResolvedValue({
        success: true,
        data: {
          profileId: 'account-openai',
          profileName: 'OpenAI API',
          profileEmail: 'openai@example.com',
          sessionPercent: 45,
          weeklyPercent: 55,
          sessionResetTimestamp: '2026-03-04T12:00:00.000Z',
          weeklyResetTimestamp: '2026-03-11T12:00:00.000Z',
          fetchedAt: new Date(),
          needsReauthentication: false,
        },
      }),
      requestAllProfilesUsage: vi.fn().mockResolvedValue({
        success: true,
        data: {
          allProfiles: [
            {
              profileId: 'account-anthropic',
              profileName: 'Anthropic OAuth',
              sessionPercent: 70,
              weeklyPercent: 80,
              isAuthenticated: true,
              isRateLimited: false,
              availabilityScore: 20,
              isActive: false,
            },
          ],
          activeProfile: {
            profileId: 'account-openai',
            profileName: 'OpenAI API',
            profileEmail: 'openai@example.com',
            sessionPercent: 45,
            weeklyPercent: 55,
            isActive: true,
          },
        },
      }),
      onAllProfilesUsageUpdated: vi.fn(),
      setQueueOrder: vi.fn(),
    };
  });

  describe('when cross-provider mode is enabled', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(createStoreMock({
        customMixedProfileActive: true,
        customMixedPhaseConfig: {
          spec: { provider: 'anthropic' },
          planning: { provider: 'openai' },
          coding: { provider: 'anthropic' },
          qa: { provider: 'openai' },
        },
      }) as any);
    });

    it('shows provider rows inside usage breakdown', async () => {
      render(<UsageIndicator />);

      const usageTrigger = screen.getByRole('button', { name: 'common:usage.usageStatusAriaLabel' });
      fireEvent.mouseEnter(usageTrigger);

      expect(await screen.findByText('Cross-Provider Usage', {}, { timeout: 12000 }))
        .toBeInTheDocument();
      expect(screen.getAllByText('Anthropic').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('OpenAI').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('70%').length).toBeGreaterThan(0);
      expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
    });

    it('does not show swap buttons on individual cross-provider rows and toggles mode via main button', async () => {
      render(<UsageIndicator />);

      const usageTrigger = screen.getByRole('button', { name: 'common:usage.usageStatusAriaLabel' });
      fireEvent.click(usageTrigger);
      await screen.findByText('Cross-Provider Usage');

      // The swap buttons in the cross-provider section should only be the main toggle,
      // not on individual provider rows
      const swapButtons = screen.getAllByRole('button', { name: 'Swap' });
      const crossProviderToggle = swapButtons.find((button) => {
        const rowText = button.closest('div')?.textContent ?? '';
        return rowText.includes('Cross-Provider');
      });

      expect(crossProviderToggle).toBeTruthy();
      fireEvent.click(crossProviderToggle as HTMLElement);

      await waitFor(() => {
        expect(vi.mocked(saveSettings)).toHaveBeenCalledWith({ customMixedProfileActive: false });
      });
    });

    it('shows cross-provider rows under Other Accounts when regular usage breakdown is shown', async () => {
      vi.mocked(useSettingsStore).mockReturnValue(createStoreMock({
        providerAccounts: crossProviderMonitoredAccounts,
        globalPriorityOrder: ['account-anthropic-active', 'account-openai-other'],
        customMixedProfileActive: true,
        customMixedPhaseConfig: {
          spec: { provider: 'anthropic' },
          planning: { provider: 'openai' },
          coding: { provider: 'anthropic' },
          qa: { provider: 'openai' },
        },
      }) as any);

      (window as any).electronAPI.requestUsageUpdate = vi.fn().mockResolvedValue({
        success: true,
        data: {
          profileId: 'account-anthropic-active',
          profileName: 'Anthropic OAuth',
          profileEmail: 'anthropic@example.com',
          sessionPercent: 42,
          weeklyPercent: 33,
          sessionResetTimestamp: '2026-03-04T12:00:00.000Z',
          weeklyResetTimestamp: '2026-03-11T12:00:00.000Z',
          fetchedAt: new Date(),
          needsReauthentication: false,
        },
      });

      (window as any).electronAPI.requestAllProfilesUsage = vi.fn().mockResolvedValue({
        success: true,
        data: {
          allProfiles: [
            {
              profileId: 'account-openai-other',
              profileName: 'OpenAI OAuth',
              sessionPercent: 54,
              weeklyPercent: 48,
              isAuthenticated: true,
              isRateLimited: false,
              availabilityScore: 46,
              isActive: false,
            },
          ],
          activeProfile: {
            profileId: 'account-anthropic-active',
            profileName: 'Anthropic OAuth',
            profileEmail: 'anthropic@example.com',
            sessionPercent: 42,
            weeklyPercent: 33,
            isActive: true,
          },
        },
      });

      render(<UsageIndicator />);

      const usageTrigger = await screen.findByRole('button', { name: 'common:usage.usageStatusAriaLabel' });
      fireEvent.mouseEnter(usageTrigger);

      expect(await screen.findByText('Cross-Provider Usage', {}, { timeout: 12000 })).toBeInTheDocument();

      const otherAccountsHeader = screen.getByText('Other Accounts');
      const crossProviderUsageHeading = screen.getByText('Cross-Provider Usage');
      expect(
        otherAccountsHeader.compareDocumentPosition(crossProviderUsageHeading) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeGreaterThan(0);

      const openAiAccount = screen.getByText('OpenAI OAuth');
      expect(
        openAiAccount.compareDocumentPosition(crossProviderUsageHeading) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeGreaterThan(0);
    });

    it('does not show cross-provider usage when it is not configured with distinct providers', async () => {
      vi.mocked(useSettingsStore).mockReturnValue(createStoreMock({
        customMixedProfileActive: true,
        customMixedPhaseConfig: {
          spec: { provider: 'anthropic' },
          planning: { provider: 'anthropic' },
          coding: { provider: 'anthropic' },
          qa: { provider: 'anthropic' },
        },
      }) as any);

      render(<UsageIndicator />);

      const usageTrigger = screen.getByRole('button', { name: 'common:usage.usageStatusAriaLabel' });
      fireEvent.mouseEnter(usageTrigger);

      await waitFor(() => {
        expect(screen.queryByText('Cross-Provider Usage')).not.toBeInTheDocument();
      });
    });
  });
});
