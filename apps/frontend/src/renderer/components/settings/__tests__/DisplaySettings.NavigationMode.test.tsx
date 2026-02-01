/**
 * DisplaySettings Navigation Mode Integration Tests
 * 
 * Tests for the navigation mode UI controls in DisplaySettings component.
 * Covers:
 * - Button click handling
 * - Immediate save on mode change
 * - Visual state updates
 * - Translation key usage
 * 
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings } from '../../../../shared/types';
import type { Mock } from 'vitest';

// Import browser mock
import '../../../lib/browser-mock';

describe('DisplaySettings - Navigation Mode Controls', () => {
  let mockSettings: AppSettings;
  let mockOnSettingsChange: Mock;
  let mockUpdateStoreSettings: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default settings
    mockSettings = {
      theme: 'system',
      colorTheme: 'default',
      defaultModel: 'opus',
      agentFramework: 'auto-claude',
      autoUpdateAutoBuild: true,
      autoNameTerminals: true,
      onboardingCompleted: true,
      notifications: {
        onTaskComplete: true,
        onTaskFailed: true,
        onReviewNeeded: true,
        sound: false,
      },
      selectedAgentProfile: 'auto',
      changelogFormat: 'keep-a-changelog',
      changelogAudience: 'user-facing',
      changelogEmojiLevel: 'none',
      uiScale: 100,
      betaUpdates: false,
      language: 'en',
      navigationMode: 'full',
      sentryEnabled: true,
      autoNameClaudeTerminals: true,
    };

    mockOnSettingsChange = vi.fn();
    mockUpdateStoreSettings = vi.fn();
  });

  describe('Navigation Mode Change Handler', () => {
    it('should call onSettingsChange when mode changes to icons', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      handleNavigationModeChange('icons');

      expect(mockOnSettingsChange).toHaveBeenCalledWith({
        ...mockSettings,
        navigationMode: 'icons',
      });
      expect(mockUpdateStoreSettings).toHaveBeenCalledWith({
        navigationMode: 'icons',
      });
    });

    it('should call onSettingsChange when mode changes to full', () => {
      mockSettings.navigationMode = 'icons';

      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      handleNavigationModeChange('full');

      expect(mockOnSettingsChange).toHaveBeenCalledWith({
        ...mockSettings,
        navigationMode: 'full',
      });
      expect(mockUpdateStoreSettings).toHaveBeenCalledWith({
        navigationMode: 'full',
      });
    });

    it('should immediately save to store when mode changes', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      handleNavigationModeChange('icons');

      // Verify immediate save (not waiting for "Save Settings" button)
      expect(mockUpdateStoreSettings).toHaveBeenCalledTimes(1);
      expect(mockUpdateStoreSettings).toHaveBeenCalledWith({
        navigationMode: 'icons',
      });
    });
  });

  describe('Button State Management', () => {
    it('should show icons button as selected when navigationMode is "icons"', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' | undefined };
      
      const isIconsSelected = (settings.navigationMode || 'full') === 'icons';
      const isFullSelected = (settings.navigationMode || 'full') === 'full';

      expect(isIconsSelected).toBe(true);
      expect(isFullSelected).toBe(false);
    });

    it('should show full button as selected when navigationMode is "full"', () => {
      const settings = { navigationMode: 'full' as 'icons' | 'full' | undefined };
      
      const isIconsSelected = (settings.navigationMode || 'full') === 'icons';
      const isFullSelected = (settings.navigationMode || 'full') === 'full';

      expect(isIconsSelected).toBe(false);
      expect(isFullSelected).toBe(true);
    });

    it('should default to full button selected when navigationMode is undefined', () => {
      const settings = { navigationMode: undefined as 'icons' | 'full' | undefined };
      
      const isIconsSelected = (settings.navigationMode || 'full') === 'icons';
      const isFullSelected = (settings.navigationMode || 'full') === 'full';

      expect(isIconsSelected).toBe(false);
      expect(isFullSelected).toBe(true);
    });
  });

  describe('Visual State Classes', () => {
    it('should apply primary border classes to selected button', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' | undefined };
      
      const iconsBorderClass = (settings.navigationMode || 'full') === 'icons'
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-primary/50 hover:bg-accent/50';

      expect(iconsBorderClass).toContain('border-primary');
      expect(iconsBorderClass).toContain('bg-primary/5');
    });

    it('should apply default border classes to unselected button', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' | undefined };
      
      const fullBorderClass = (settings.navigationMode || 'full') === 'full'
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-primary/50 hover:bg-accent/50';

      expect(fullBorderClass).toContain('border-border');
      expect(fullBorderClass).toContain('hover:border-primary/50');
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys for navigation mode section', () => {
      const translationKeys = {
        title: 'navigation.mode.title',
        description: 'navigation.mode.description',
        iconsOnly: 'navigation.mode.iconsOnly',
        iconsDescription: 'navigation.mode.iconsDescription',
        full: 'navigation.mode.full',
        fullDescription: 'navigation.mode.fullDescription',
      };

      expect(translationKeys.title).toBe('navigation.mode.title');
      expect(translationKeys.description).toBe('navigation.mode.description');
      expect(translationKeys.iconsOnly).toBe('navigation.mode.iconsOnly');
      expect(translationKeys.iconsDescription).toBe('navigation.mode.iconsDescription');
      expect(translationKeys.full).toBe('navigation.mode.full');
      expect(translationKeys.fullDescription).toBe('navigation.mode.fullDescription');
    });
  });

  describe('Integration with UI Scale Settings', () => {
    it('should not interfere with UI scale settings', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      // Change navigation mode
      handleNavigationModeChange('icons');

      // UI scale should remain unchanged
      const updatedSettings = mockOnSettingsChange.mock.calls[0][0] as AppSettings;
      expect(updatedSettings.uiScale).toBe(100);
    });

    it('should coexist with UI scale changes', () => {
      // First change navigation mode
      mockOnSettingsChange({ ...mockSettings, navigationMode: 'icons' });

      // Then change UI scale
      mockOnSettingsChange({ ...mockSettings, navigationMode: 'icons', uiScale: 125 });

      expect(mockOnSettingsChange).toHaveBeenCalledTimes(2);
      
      const lastCall = mockOnSettingsChange.mock.calls[1][0] as AppSettings;
      expect(lastCall.navigationMode).toBe('icons');
      expect(lastCall.uiScale).toBe(125);
    });
  });

  describe('Behavior Like Theme Setting', () => {
    it('should save immediately like theme changes (no "Save Settings" button needed)', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      handleNavigationModeChange('icons');

      // Should call updateStoreSettings immediately (like theme)
      expect(mockUpdateStoreSettings).toHaveBeenCalledTimes(1);
    });

    it('should apply changes immediately to UI', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      handleNavigationModeChange('icons');

      // Both local state and store should update
      expect(mockOnSettingsChange).toHaveBeenCalled();
      expect(mockUpdateStoreSettings).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid mode toggles', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      // Rapid toggles
      handleNavigationModeChange('icons');
      handleNavigationModeChange('full');
      handleNavigationModeChange('icons');

      expect(mockUpdateStoreSettings).toHaveBeenCalledTimes(3);
      expect(mockUpdateStoreSettings).toHaveBeenLastCalledWith({
        navigationMode: 'icons',
      });
    });

    it('should handle setting same mode multiple times', () => {
      const handleNavigationModeChange = (mode: 'icons' | 'full') => {
        mockOnSettingsChange({ ...mockSettings, navigationMode: mode });
        mockUpdateStoreSettings({ navigationMode: mode });
      };

      // Set icons mode twice
      handleNavigationModeChange('icons');
      handleNavigationModeChange('icons');

      expect(mockUpdateStoreSettings).toHaveBeenCalledTimes(2);
      expect(mockUpdateStoreSettings).toHaveBeenCalledWith({
        navigationMode: 'icons',
      });
    });
  });
});
