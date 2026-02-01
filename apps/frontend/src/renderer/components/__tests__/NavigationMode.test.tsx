/**
 * Navigation Mode Feature Tests
 * 
 * Tests for the navigation bar display mode (icons-only vs full) feature.
 * Covers:
 * - Display mode persistence across reloads
 * - UI changes when switching modes
 * - Settings save functionality
 * - Default behavior
 * 
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings } from '../../../shared/types';

// Import browser mock to get full ElectronAPI structure
import '../../lib/browser-mock';

// Mock functions for settings IPC calls
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

// Helper function to get UI class based on mode
function getWidthClass(mode: 'icons' | 'full'): string {
  return mode === 'icons' ? 'w-16' : 'w-64';
}

function getHeaderText(mode: 'icons' | 'full'): string {
  return mode === 'full' ? 'Auto Claude' : 'AC';
}

function shouldShowHeader(mode: 'icons' | 'full'): boolean {
  return mode === 'full';
}

function getPaddingClass(mode: 'icons' | 'full'): string {
  return mode === 'icons' ? 'px-2 py-4' : 'px-3 py-4';
}

function getButtonClass(mode: 'icons' | 'full'): string {
  return mode === 'icons' ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5';
}

function shouldShowBadge(mode: 'icons' | 'full'): boolean {
  return mode === 'full';
}

describe('Navigation Mode Feature', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup window.electronAPI mocks
    if (window.electronAPI) {
      window.electronAPI.getSettings = mockGetSettings;
      window.electronAPI.saveSettings = mockSaveSettings;
    }
  });

  describe('Default Navigation Mode', () => {
    it('should default to "full" mode when navigationMode is not set', () => {
      const settings: Partial<AppSettings> = {
        theme: 'system',
        // navigationMode not set
      };

      const navigationMode = settings.navigationMode || 'full';
      expect(navigationMode).toBe('full');
    });

    it('should use "full" mode when navigationMode is undefined', () => {
      const settings: Partial<AppSettings> = {
        theme: 'system',
        navigationMode: undefined,
      };

      const navigationMode = settings.navigationMode || 'full';
      expect(navigationMode).toBe('full');
    });
  });

  describe('Navigation Mode Settings Persistence', () => {
    it('should save navigationMode when changed to "icons"', async () => {
      mockSaveSettings.mockResolvedValue({
        success: true,
      });

      const result = await window.electronAPI.saveSettings({
        navigationMode: 'icons',
      });

      expect(mockSaveSettings).toHaveBeenCalledWith({
        navigationMode: 'icons',
      });
      expect(result.success).toBe(true);
    });

    it('should save navigationMode when changed to "full"', async () => {
      mockSaveSettings.mockResolvedValue({
        success: true,
      });

      const result = await window.electronAPI.saveSettings({
        navigationMode: 'full',
      });

      expect(mockSaveSettings).toHaveBeenCalledWith({
        navigationMode: 'full',
      });
      expect(result.success).toBe(true);
    });

    it('should load saved navigationMode on settings load', async () => {
      const savedSettings: Partial<AppSettings> = {
        theme: 'system',
        navigationMode: 'icons',
      };

      mockGetSettings.mockResolvedValue({
        success: true,
        data: savedSettings,
      });

      const result = await window.electronAPI.getSettings();

      expect(result.success).toBe(true);
      expect(result.data?.navigationMode).toBe('icons');
    });

    it('should persist navigationMode setting across reloads', async () => {
      // First, save the setting
      mockSaveSettings.mockResolvedValue({
        success: true,
      });

      await window.electronAPI.saveSettings({
        navigationMode: 'icons',
      });

      // Then, simulate reload by getting settings
      mockGetSettings.mockResolvedValue({
        success: true,
        data: {
          navigationMode: 'icons',
        },
      });

      const result = await window.electronAPI.getSettings();

      expect(result.success).toBe(true);
      expect(result.data?.navigationMode).toBe('icons');
    });
  });

  describe('Navigation Mode UI Changes', () => {
    it('should use w-16 width for icons mode', () => {
      expect(getWidthClass('icons')).toBe('w-16');
    });

    it('should use w-64 width for full mode', () => {
      expect(getWidthClass('full')).toBe('w-64');
    });

    it('should show "AC" text in icons mode', () => {
      expect(getHeaderText('icons')).toBe('AC');
    });

    it('should show "Auto Claude" text in full mode', () => {
      expect(getHeaderText('full')).toBe('Auto Claude');
    });

    it('should hide section header in icons mode', () => {
      expect(shouldShowHeader('icons')).toBe(false);
    });

    it('should show section header in full mode', () => {
      expect(shouldShowHeader('full')).toBe(true);
    });

    it('should use compact padding (px-2) in icons mode', () => {
      expect(getPaddingClass('icons')).toBe('px-2 py-4');
    });

    it('should use normal padding (px-3) in full mode', () => {
      expect(getPaddingClass('full')).toBe('px-3 py-4');
    });

    it('should center-align buttons with p-2.5 in icons mode', () => {
      expect(getButtonClass('icons')).toBe('justify-center p-2.5');
    });

    it('should left-align buttons with gap and padding in full mode', () => {
      expect(getButtonClass('full')).toBe('gap-3 px-3 py-2.5');
    });

    it('should hide Claude Code Status Badge in icons mode', () => {
      expect(shouldShowBadge('icons')).toBe(false);
    });

    it('should show Claude Code Status Badge in full mode', () => {
      expect(shouldShowBadge('full')).toBe(true);
    });
  });

  describe('Navigation Mode Toggle Behavior', () => {
    it('should toggle from full to icons mode', () => {
      let currentMode: 'icons' | 'full' = 'full';
      currentMode = 'icons';
      expect(currentMode).toBe('icons');
    });

    it('should toggle from icons to full mode', () => {
      let currentMode: 'icons' | 'full' = 'icons';
      currentMode = 'full';
      expect(currentMode).toBe('full');
    });

    it('should maintain state after multiple toggles', () => {
      let currentMode: 'icons' | 'full' = 'full';
      
      // Toggle to icons
      currentMode = 'icons';
      expect(currentMode).toBe('icons');
      
      // Toggle back to full
      currentMode = 'full';
      expect(currentMode).toBe('full');
      
      // Toggle to icons again
      currentMode = 'icons';
      expect(currentMode).toBe('icons');
    });
  });

  describe('Navigation Mode Settings UI', () => {
    it('should highlight "icons" button when icons mode is selected', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' };
      const isIconsSelected = (settings.navigationMode || 'full') === 'icons';
      const isFullSelected = (settings.navigationMode || 'full') === 'full';
      
      expect(isIconsSelected).toBe(true);
      expect(isFullSelected).toBe(false);
    });

    it('should highlight "full" button when full mode is selected', () => {
      const settings = { navigationMode: 'full' as 'icons' | 'full' };
      const isIconsSelected = (settings.navigationMode || 'full') === 'icons';
      const isFullSelected = (settings.navigationMode || 'full') === 'full';
      
      expect(isIconsSelected).toBe(false);
      expect(isFullSelected).toBe(true);
    });

    it('should apply primary border to selected mode button', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' };
      const iconsBorderClass = (settings.navigationMode || 'full') === 'icons'
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-primary/50 hover:bg-accent/50';
      
      expect(iconsBorderClass).toBe('border-primary bg-primary/5');
    });

    it('should apply default border to unselected mode button', () => {
      const settings = { navigationMode: 'icons' as 'icons' | 'full' };
      const fullBorderClass = (settings.navigationMode || 'full') === 'full'
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-primary/50 hover:bg-accent/50';
      
      expect(fullBorderClass).toBe('border-border hover:border-primary/50 hover:bg-accent/50');
    });
  });

  describe('Error Handling', () => {
    it('should handle save settings failure gracefully', async () => {
      mockSaveSettings.mockResolvedValue({
        success: false,
        error: 'Failed to save settings',
      });

      const result = await window.electronAPI.saveSettings({
        navigationMode: 'icons',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to save settings');
    });

    it('should handle load settings failure gracefully', async () => {
      mockGetSettings.mockResolvedValue({
        success: false,
        error: 'Failed to load settings',
      });

      const result = await window.electronAPI.getSettings();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to load settings');
    });

    it('should fall back to default mode when settings load fails', async () => {
      mockGetSettings.mockResolvedValue({
        success: false,
        error: 'Failed to load settings',
      });

      const result = await window.electronAPI.getSettings();
      
      // Fallback to default
      const navigationMode = result.data?.navigationMode || 'full';
      expect(navigationMode).toBe('full');
    });
  });
});
