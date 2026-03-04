/**
 * @vitest-environment jsdom
 */
/**
 * Tests for AuthStatusIndicator component
 * Updated to use provider accounts + global priority queue model
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { AuthStatusIndicator } from './AuthStatusIndicator';
import { useSettingsStore } from '../stores/settings-store';
import type { ProviderAccount } from '../../shared/types/provider-account';

// Mock the settings store
vi.mock('../stores/settings-store', () => ({
  useSettingsStore: vi.fn()
}));

// Mock i18n translation function
vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'common:usage.authentication': 'Authentication',
        'common:usage.oauth': 'OAuth',
        'common:usage.apiKey': 'API Key',
        'common:usage.provider': 'Provider',
        'common:usage.providerAnthropic': 'Anthropic',
        'common:usage.providerOpenAI': 'OpenAI',
        'common:usage.providerGoogle': 'Google AI',
        'common:usage.providerZai': 'z.ai',
        'common:usage.providerZhipu': 'ZHIPU AI',
        'common:usage.providerUnknown': 'Unknown',
        'common:usage.authenticationAriaLabel': 'Authentication: {{provider}}',
        'common:usage.authenticationDetails': 'Authentication Details',
        'common:usage.claudeCode': 'Claude Code',
        'common:usage.noAccount': 'No Account',
        'common:usage.noAccountDescription': 'Add an account in Settings to get started',
        'common:usage.billingSubscription': 'Subscription',
        'common:usage.billingPayPerUse': 'Pay-per-use',
        'common:usage.queuePosition': 'Queue Position',
        'common:usage.inUse': 'In Use',
        'common:usage.accountName': 'Account',
        'common:usage.crossProvider': 'Cross-Provider',
        'common:usage.crossProviderConfig': 'Cross-Provider',
      };
      if (params && Object.keys(params).length > 0) {
        const translated = translations[key] || key;
        if (translated.includes('{{provider}}')) {
          return translated.replace('{{provider}}', String(params.provider));
        }
        if (translated.includes('{{position}}') && translated.includes('{{total}}')) {
          return translated.replace('{{position}}', String(params.position)).replace('{{total}}', String(params.total));
        }
        return translated;
      }
      return translations[key] || key;
    }
  }))
}));

// Test provider accounts
const testAccounts: ProviderAccount[] = [
  {
    id: 'account-anthropic',
    provider: 'anthropic',
    name: 'Claude Pro',
    authType: 'oauth',
    billingModel: 'subscription',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'account-openai',
    provider: 'openai',
    name: 'OpenAI API',
    authType: 'api-key',
    billingModel: 'pay-per-use',
    apiKey: 'sk-openai-xxx',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'account-google',
    provider: 'google',
    name: 'Google AI Key',
    authType: 'api-key',
    billingModel: 'pay-per-use',
    apiKey: 'AIza-xxx',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/**
 * Creates a mock settings store with provider accounts model
 */
function createStoreMock(overrides?: {
  providerAccounts?: ProviderAccount[];
  globalPriorityOrder?: string[];
  customMixedProfileActive?: boolean;
  customMixedPhaseConfig?: Record<string, { provider: string }>;
}) {
  return {
    providerAccounts: overrides?.providerAccounts ?? testAccounts,
    settings: {
      globalPriorityOrder: overrides?.globalPriorityOrder ?? ['account-anthropic', 'account-openai', 'account-google'],
      customMixedProfileActive: overrides?.customMixedProfileActive,
      customMixedPhaseConfig: overrides?.customMixedPhaseConfig,
    },
    // Legacy fields (still in store type but not used by new component)
    profiles: [],
    activeProfileId: null,
    deleteProfile: vi.fn().mockResolvedValue(true),
    setActiveProfile: vi.fn().mockResolvedValue(true),
    profilesLoading: false,
    isLoading: false,
    error: null,
    setSettings: vi.fn(),
    updateSettings: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setProfiles: vi.fn(),
    setProfilesLoading: vi.fn(),
    setProfilesError: vi.fn(),
    saveProfile: vi.fn().mockResolvedValue(true),
    updateProfile: vi.fn().mockResolvedValue(true),
    profilesError: null,
  };
}

describe('AuthStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      onUsageUpdated: vi.fn(() => vi.fn()),
      requestUsageUpdate: vi.fn().mockResolvedValue({ success: false, data: null })
    };
  });

  describe('when Anthropic OAuth is the active account', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: testAccounts,
          globalPriorityOrder: ['account-anthropic', 'account-openai'],
        }) as any
      );
    });

    it('should display Anthropic provider badge', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
    });

    it('should have correct aria-label', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByRole('button', { name: /authentication: anthropic/i })).toBeInTheDocument();
    });

    it('should apply orange color classes for Anthropic', () => {
      render(<AuthStatusIndicator />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('text-orange-500');
    });
  });

  describe('when OpenAI is the active account', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: testAccounts,
          globalPriorityOrder: ['account-openai', 'account-anthropic'],
        }) as any
      );
    });

    it('should display OpenAI provider badge', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });

    it('should apply green/emerald color classes for OpenAI', () => {
      render(<AuthStatusIndicator />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('text-emerald-500');
    });
  });

  describe('when Google AI is the active account', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: testAccounts,
          globalPriorityOrder: ['account-google', 'account-anthropic'],
        }) as any
      );
    });

    it('should display Google AI provider badge', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByText('Google AI')).toBeInTheDocument();
    });

    it('should apply blue color classes for Google', () => {
      render(<AuthStatusIndicator />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('text-blue-500');
    });
  });

  describe('when no accounts exist', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: [],
          globalPriorityOrder: [],
        }) as any
      );
    });

    it('should display No Account badge', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByText('No Account')).toBeInTheDocument();
    });
  });

  describe('when cross-provider mode is active', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: testAccounts,
          globalPriorityOrder: ['account-openai', 'account-anthropic', 'account-google'],
          customMixedProfileActive: true,
          customMixedPhaseConfig: {
            spec: { provider: 'anthropic', modelId: 'claude-3-opus', thinkingLevel: 'high' },
            planning: { provider: 'openai', modelId: 'gpt-4', thinkingLevel: 'medium' },
            coding: { provider: 'openai', modelId: 'gpt-4', thinkingLevel: 'high' },
            qa: { provider: 'google', modelId: 'gemini-1.5', thinkingLevel: 'medium' },
          } as any,
        }) as any
      );
    });

    it('should display cross-provider in provider badge', () => {
      render(<AuthStatusIndicator />);
      expect(screen.getByRole('button', { name: /authentication: cross-provider/i })).toBeInTheDocument();
    });

    it('should display provider list in authentication details tooltip', () => {
      render(<AuthStatusIndicator />);
      const tooltipTrigger = screen.getByRole('button', { name: /authentication: cross-provider/i });
      expect(tooltipTrigger).toBeInTheDocument();
      expect(screen.getByText('Cross-Provider')).toBeInTheDocument();
    });
  });

  describe('fallback when globalPriorityOrder is empty', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock({
          providerAccounts: testAccounts,
          globalPriorityOrder: [],
        }) as any
      );
    });

    it('should fallback to first provider account', () => {
      render(<AuthStatusIndicator />);
      // First account in array is Anthropic
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
    });
  });

  describe('component structure', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(
        createStoreMock() as any
      );
    });

    it('should be a valid React component', () => {
      expect(() => render(<AuthStatusIndicator />)).not.toThrow();
    });
  });
});
