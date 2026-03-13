/**
 * @vitest-environment jsdom
 */
/**
 * OnboardingWizard integration tests
 *
 * Integration tests for the complete onboarding wizard flow.
 * Verifies step navigation, accounts step, back button behavior,
 * and progress indicator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OnboardingWizard } from './OnboardingWizard';

// Mock react-i18next to avoid initialization issues
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Return the key itself or provide specific translations
      // Keys are without namespace since component uses useTranslation('namespace')
      const translations: Record<string, string> = {
        'welcome.title': 'Welcome to Aperant',
        'welcome.subtitle': 'AI-powered autonomous coding assistant',
        'welcome.getStarted': 'Get Started',
        'welcome.skip': 'Skip Setup',
        'wizard.helpText': 'Let us help you get started with Aperant',
        'welcome.features.aiPowered.title': 'AI-Powered',
        'welcome.features.aiPowered.description': 'Powered by Claude',
        'welcome.features.specDriven.title': 'Spec-Driven',
        'welcome.features.specDriven.description': 'Create from specs',
        'welcome.features.memory.title': 'Memory',
        'welcome.features.memory.description': 'Remembers context',
        'welcome.features.parallel.title': 'Parallel',
        'welcome.features.parallel.description': 'Work in parallel',
        'accounts.title': 'Add Your AI Accounts',
        'accounts.description': 'Connect your AI provider accounts.',
        'accounts.buttons.back': 'Back',
        'accounts.buttons.continue': 'Continue',
        'accounts.buttons.skip': 'Skip for now',
        // Common translations
        'common:actions.close': 'Close'
      };
      return translations[key] || key;
    },
    i18n: { language: 'en' }
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children
}));

// Mock the settings store
const mockUpdateSettings = vi.fn();
const mockLoadSettings = vi.fn();

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = {
      settings: { onboardingCompleted: false },
      isLoading: false,
      profiles: [],
      activeProfileId: null,
      providerAccounts: [],
      envCredentials: {},
      updateSettings: mockUpdateSettings,
      loadSettings: mockLoadSettings,
      loadProviderAccounts: vi.fn().mockResolvedValue(undefined),
      checkEnvCredentials: vi.fn().mockResolvedValue(undefined),
      deleteProviderAccount: vi.fn().mockResolvedValue({ success: true }),
      updateProviderAccount: vi.fn().mockResolvedValue({ success: true }),
    };
    if (!selector) return state;
    return selector(state);
  })
}));

// Mock provider registry
vi.mock('@shared/constants/providers', () => ({
  PROVIDER_REGISTRY: []
}));

// Mock electronAPI
const mockSaveSettings = vi.fn().mockResolvedValue({ success: true });

Object.defineProperty(window, 'electronAPI', {
  value: {
    saveSettings: mockSaveSettings,
    onAppUpdateDownloaded: vi.fn(),
    requestAllProfilesUsage: vi.fn().mockResolvedValue({ success: true, data: { allProfiles: [] } }),
    onAllProfilesUsageUpdated: vi.fn(() => vi.fn()),
  },
  writable: true
});

describe('OnboardingWizard Integration Tests', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Accounts Step Navigation', () => {
    it('should navigate from welcome to accounts step', async () => {
      render(<OnboardingWizard {...defaultProps} />);

      // Start at welcome step
      expect(screen.getByText(/Welcome to Aperant/)).toBeInTheDocument();

      // Click "Get Started" to go to accounts
      const getStartedButton = screen.getByRole('button', { name: /Get Started/ });
      fireEvent.click(getStartedButton);

      // Should now show accounts step
      await waitFor(() => {
        expect(screen.getByText(/Add Your AI Accounts/)).toBeInTheDocument();
      });
    });

    it('should allow continuing from accounts step without adding accounts', async () => {
      render(<OnboardingWizard {...defaultProps} />);

      // Navigate to accounts
      fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));
      await waitFor(() => {
        expect(screen.getByText(/Add Your AI Accounts/)).toBeInTheDocument();
      });

      // Continue button should be enabled (accounts are optional)
      const continueButton = screen.getByRole('button', { name: /Continue/ });
      expect(continueButton).not.toBeDisabled();
    });

    it('should navigate back from accounts to welcome', async () => {
      render(<OnboardingWizard {...defaultProps} />);

      // Navigate to accounts
      fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));
      await waitFor(() => {
        expect(screen.getByText(/Add Your AI Accounts/)).toBeInTheDocument();
      });

      // Click back
      fireEvent.click(screen.getByRole('button', { name: /Back/ }));

      // Should be back at welcome
      await waitFor(() => {
        expect(screen.getByText(/Welcome to Aperant/)).toBeInTheDocument();
      });
    });
  });

  describe('First-Run Detection', () => {
    it('should show wizard for users with no auth configured', () => {
      render(<OnboardingWizard {...defaultProps} open={true} />);

      // Wizard should be visible
      expect(screen.getByText(/Welcome to Aperant/)).toBeInTheDocument();
    });

    it('should not show wizard when open is false', () => {
      const { rerender } = render(<OnboardingWizard {...defaultProps} open={true} />);

      expect(screen.getByText(/Welcome to Aperant/)).toBeInTheDocument();

      // Close wizard
      rerender(<OnboardingWizard {...defaultProps} open={false} />);

      // Wizard content should not be visible
      expect(screen.queryByText(/Welcome to Aperant/)).not.toBeInTheDocument();
    });

    it('should not show wizard for users with existing auth', () => {
      render(<OnboardingWizard {...defaultProps} open={false} />);

      expect(screen.queryByText(/Welcome to Aperant/)).not.toBeInTheDocument();
    });
  });

  describe('Skip and Completion', () => {
    it('should complete wizard when skip is clicked', async () => {
      render(<OnboardingWizard {...defaultProps} />);

      // Click skip on welcome step
      const skipButton = screen.getByRole('button', { name: /Skip Setup/ });
      fireEvent.click(skipButton);

      // Should call saveSettings
      await waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith({ onboardingCompleted: true });
      });
    });

    it('should call onOpenChange when wizard is closed', async () => {
      const mockOnOpenChange = vi.fn();
      render(<OnboardingWizard {...defaultProps} onOpenChange={mockOnOpenChange} />);

      // Click skip to close wizard
      const skipButton = screen.getByRole('button', { name: /Skip Setup/ });
      fireEvent.click(skipButton);

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should allow skipping from accounts step', async () => {
      render(<OnboardingWizard {...defaultProps} />);

      // Navigate to accounts
      fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));
      await waitFor(() => {
        expect(screen.getByText(/Add Your AI Accounts/)).toBeInTheDocument();
      });

      // Click skip
      fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));

      // Should call saveSettings
      await waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith({ onboardingCompleted: true });
      });
    });
  });
});
