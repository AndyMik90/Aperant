/**
 * @vitest-environment jsdom
 */
/**
 * Component and utility tests for ProfileList
 * Tests utility functions and verifies component structure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileList } from './ProfileList';
import { maskApiKey } from '../../lib/profile-utils';
import { useSettingsStore } from '../../stores/settings-store';
import type { APIProfile } from '@shared/types/profile';
import { TooltipProvider } from '../ui/tooltip';
import i18n from '../../../shared/i18n';

// Wrapper for components that need TooltipProvider
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// Custom render with wrapper
function renderWithWrapper(ui: React.ReactElement) {
  return render(ui, { wrapper: TestWrapper });
}

// Mock the settings store
vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: vi.fn()
}));

// Mock the toast hook
vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

// Test profile data
const testProfiles: APIProfile[] = [
  {
    id: 'profile-1',
    name: 'Production API',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-ant-prod-key-1234',
    models: { default: 'claude-sonnet-4-5-20250929' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'profile-2',
    name: 'Development API',
    baseUrl: 'https://dev-api.example.com/v1',
    apiKey: 'sk-ant-test-key-5678',
    models: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

/**
 * Factory function to create a default settings store mock
 * Override properties by spreading with custom values
 */
function createSettingsStoreMock(overrides: Partial<ReturnType<typeof useSettingsStore>> = {}) {
  const mockDeleteProfile = vi.fn().mockResolvedValue(true);
  const mockSetActiveProfile = vi.fn().mockResolvedValue(true);

  return {
    profiles: testProfiles,
    activeProfileId: 'profile-1' as string | null,
    deleteProfile: mockDeleteProfile,
    setActiveProfile: mockSetActiveProfile,
    profilesLoading: false,
    settings: {} as any,
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
    ...overrides
  };
}

describe('ProfileList - maskApiKey Utility', () => {
  it('should mask API key showing only last 4 characters', () => {
    const apiKey = 'sk-ant-prod-key-1234';
    const masked = maskApiKey(apiKey);
    expect(masked).toBe('••••1234');
  });

  it('should return dots for keys with 4 or fewer characters', () => {
    expect(maskApiKey('key')).toBe('••••');
    expect(maskApiKey('1234')).toBe('••••');
    expect(maskApiKey('')).toBe('••••');
  });

  it('should handle undefined or null keys', () => {
    expect(maskApiKey(undefined as unknown as string)).toBe('••••');
    expect(maskApiKey(null as unknown as string)).toBe('••••');
  });

  it('should mask long API keys correctly', () => {
    const longKey = 'sk-ant-api03-very-long-key-abc123xyz789';
    const masked = maskApiKey(longKey);
    expect(masked).toBe('••••z789'); // Last 4 chars
    expect(masked.length).toBe(8); // 4 dots + 4 chars
  });

  it('should mask keys with exactly 5 characters', () => {
    const key = 'abcde';
    const masked = maskApiKey(key);
    expect(masked).toBe('••••bcde'); // Last 4 chars when length > 4
  });
});

describe('ProfileList - Profile Data Structure', () => {
  it('should have valid API profile structure', () => {
    expect(testProfiles[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      baseUrl: expect.any(String),
      apiKey: expect.any(String),
      models: expect.any(Object)
    });
  });

  it('should support profiles without optional models field', () => {
    expect(testProfiles[1].models).toBeUndefined();
  });

  it('should have non-empty required fields', () => {
    testProfiles.forEach(profile => {
      expect(profile.id).toBeTruthy();
      expect(profile.name).toBeTruthy();
      expect(profile.baseUrl).toBeTruthy();
      expect(profile.apiKey).toBeTruthy();
    });
  });
});

describe('ProfileList - Component Export', () => {
  it('should be able to import ProfileList component', async () => {
    const { ProfileList } = await import('./ProfileList');
    expect(ProfileList).toBeDefined();
    expect(typeof ProfileList).toBe('function');
  });

  it('should be a named export', async () => {
    const module = await import('./ProfileList');
    expect(Object.keys(module)).toContain('ProfileList');
  });
});

describe('ProfileList - URL Extraction', () => {
  it('should extract host from valid URLs', () => {
    const url1 = new URL(testProfiles[0].baseUrl);
    expect(url1.host).toBe('api.anthropic.com');

    const url2 = new URL(testProfiles[1].baseUrl);
    expect(url2.host).toBe('dev-api.example.com');
  });

  it('should handle URLs with paths', () => {
    const url = new URL('https://api.example.com/v1/messages');
    expect(url.host).toBe('api.example.com');
    expect(url.pathname).toBe('/v1/messages');
  });

  it('should handle URLs with ports', () => {
    const url = new URL('https://localhost:8080/api');
    expect(url.host).toBe('localhost:8080');
  });
});

describe('ProfileList - Active Profile Logic', () => {
  it('should identify active profile correctly', () => {
    const activeProfileId = 'profile-1';
    const activeProfile = testProfiles.find(p => p.id === activeProfileId);
    expect(activeProfile?.id).toBe('profile-1');
    expect(activeProfile?.name).toBe('Production API');
  });

  it('should return undefined for non-matching profile', () => {
    const activeProfileId = 'non-existent';
    const activeProfile = testProfiles.find(p => p.id === activeProfileId);
    expect(activeProfile).toBeUndefined();
  });

  it('should handle null active profile ID', () => {
    const activeProfileId = null;
    const activeProfile = testProfiles.find(p => p.id === activeProfileId);
    expect(activeProfile).toBeUndefined();
  });
});

// Test 1: Delete confirmation dialog shows profile name correctly
describe('ProfileList - Delete Confirmation Dialog', () => {
  beforeEach(() => {
    vi.mocked(useSettingsStore).mockReturnValue(
      createSettingsStoreMock({ activeProfileId: 'profile-2' })
    );
  });

  it('should show delete confirmation dialog with profile name', () => {
    renderWithWrapper(<ProfileList />);

    // Click delete button on first profile (find by test id)
    const deleteButton = screen.getByTestId('profile-delete-button-profile-1');
    fireEvent.click(deleteButton);

    // Check dialog appears with profile name
    expect(screen.getByText(i18n.t('settings:apiProfiles.dialog.deleteTitle'))).toBeInTheDocument();
    expect(screen.getByText(
      i18n.t('settings:apiProfiles.dialog.deleteDescription', { name: 'Production API' })
    )).toBeInTheDocument();
    expect(screen.getByText(i18n.t('settings:apiProfiles.dialog.cancel'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('settings:apiProfiles.dialog.delete'))).toBeInTheDocument();
  });

  // Test 5: Cancel delete → dialog closes, profile remains in list
  it('should close dialog when cancel is clicked', async () => {
    const mockStore = createSettingsStoreMock({ activeProfileId: 'profile-2' });
    vi.mocked(useSettingsStore).mockReturnValue(mockStore);

    renderWithWrapper(<ProfileList />);

    // Click delete button (find by test id)
    const deleteButton = screen.getByTestId('profile-delete-button-profile-1');
    fireEvent.click(deleteButton);

    // Click cancel
    const cancelButton = await screen.findByText(i18n.t('settings:apiProfiles.dialog.cancel'));
    fireEvent.click(cancelButton);

    // Dialog should be closed
    expect(screen.queryByText(
      i18n.t('settings:apiProfiles.dialog.deleteTitle')
    )).not.toBeInTheDocument();
    // Profiles should still be visible
    expect(screen.getByText('Production API')).toBeInTheDocument();
    expect(mockStore.deleteProfile).not.toHaveBeenCalled();
  });

  // Test 6: Delete confirmation dialog has delete action button
  it('should show delete action button in confirmation dialog', () => {
    vi.mocked(useSettingsStore).mockReturnValue(
      createSettingsStoreMock({ activeProfileId: 'profile-2' })
    );

    renderWithWrapper(<ProfileList />);

    // Click delete button on inactive profile (find by test id)
    const deleteButton = screen.getByTestId('profile-delete-button-profile-1');
    fireEvent.click(deleteButton);

    // Dialog should have Delete elements (title "Delete Profile?" and "Delete" button)
    expect(screen.getByText(i18n.t('settings:apiProfiles.dialog.deleteTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('settings:apiProfiles.dialog.delete'))).toBeInTheDocument();
  });
});

describe('ProfileList - Switch to OAuth Button', () => {
  beforeEach(() => {
    vi.mocked(useSettingsStore).mockReturnValue(createSettingsStoreMock());
  });

  it('should show "Switch to OAuth" button when a profile is active', () => {
    renderWithWrapper(<ProfileList />);

    // Button should be visible when activeProfileId is set
    expect(screen.getByText(i18n.t('settings:apiProfiles.switchToOauth.label'))).toBeInTheDocument();
  });

  it('should NOT show "Switch to OAuth" button when no profile is active', () => {
    vi.mocked(useSettingsStore).mockReturnValue(
      createSettingsStoreMock({ activeProfileId: null })
    );

    renderWithWrapper(<ProfileList />);

    // Button should NOT be visible when activeProfileId is null
    expect(screen.queryByText(
      i18n.t('settings:apiProfiles.switchToOauth.label')
    )).not.toBeInTheDocument();
  });

  it('should call setActiveProfile with null when "Switch to OAuth" is clicked', () => {
    const mockStore = createSettingsStoreMock();
    vi.mocked(useSettingsStore).mockReturnValue(mockStore);

    renderWithWrapper(<ProfileList />);

    // Click the "Switch to OAuth" button
    const switchButton = screen.getByText(i18n.t('settings:apiProfiles.switchToOauth.label'));
    fireEvent.click(switchButton);

    // Should call setActiveProfile with null to switch to OAuth
    expect(mockStore.setActiveProfile).toHaveBeenCalledWith(null);
  });
});
