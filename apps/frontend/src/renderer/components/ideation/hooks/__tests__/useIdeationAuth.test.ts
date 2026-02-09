/**
 * Unit tests for useIdeationAuth hook
 * Tests combined authentication logic from source OAuth token and API profiles
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Import browser mock to get full ElectronAPI structure
import '../../../../lib/browser-mock';

// Import the hook to test
import { useIdeationAuth } from '../useIdeationAuth';

// Import the store to set test state
import { useSettingsStore } from '../../../../stores/settings-store';

// Mock checkSourceToken function
const mockCheckSourceToken = vi.fn();
const mockGetApiProfiles = vi.fn();

describe('useIdeationAuth', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset store to initial state (minimal settings, actual settings loaded by store)
    useSettingsStore.setState({
      profiles: [],
      activeProfileId: null,
      profilesLoading: false,
      profilesError: null,
      isTestingConnection: false,
      testConnectionResult: null
    } as Partial<typeof useSettingsStore.getState>);

    // Setup window.electronAPI mock
    if (window.electronAPI) {
      window.electronAPI.checkSourceToken = mockCheckSourceToken;
      window.electronAPI.getAPIProfiles = mockGetApiProfiles;
    }

    // Default mock implementation - has source token
    mockCheckSourceToken.mockResolvedValue({
      success: true,
      data: { hasToken: true, sourcePath: '/mock/ac-jerry' }
    });

    mockGetApiProfiles.mockResolvedValue({
      success: true,
      data: {
        profiles: [],
        activeProfileId: null,
        version: 1
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state and loading', () => {
    it('should start with loading state', () => {
      const { result } = renderHook(() => useIdeationAuth());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.hasToken).toBe(null);
      expect(result.current.error).toBe(null);
    });

    it('should complete loading after check', async () => {
      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true); // default mock has token
    });

    it('should provide checkAuth function', () => {
      const { result } = renderHook(() => useIdeationAuth());

      expect(typeof result.current.checkAuth).toBe('function');
    });
  });

  describe('source OAuth token authentication', () => {
    it('should return hasToken true when source OAuth token exists', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: true, sourcePath: '/mock/ac-jerry' }
      });

      // No API profile active
      useSettingsStore.setState({
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
      expect(mockCheckSourceToken).toHaveBeenCalled();
    });

    it('should return hasToken false when source OAuth token does not exist', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      // No API profile active
      useSettingsStore.setState({
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
    });

    it('should handle checkSourceToken API returning success: false gracefully', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: false,
        error: 'Failed to check source token'
      });

      useSettingsStore.setState({
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // When API returns success: false, hasToken should be false (no exception thrown)
      expect(result.current.hasToken).toBe(false);
      expect(result.current.error).toBe(null); // No error set for API failure without exception
    });

    it('should handle checkSourceToken exception', async () => {
      mockCheckSourceToken.mockRejectedValue(new Error('Network error'));

      useSettingsStore.setState({
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
      expect(result.current.error).toBe('Network error');
    });
  });

  describe('API profile authentication', () => {
    it('should return hasToken true when API profile is active', async () => {
      // Source token does not exist
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      // Active API profile
      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: 'profile-1'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
    });

    it('should fall back to IPC profiles when store activeProfileId is missing', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      mockGetApiProfiles.mockResolvedValue({
        success: true,
        data: {
          profiles: [{
            id: 'profile-1',
            name: 'Custom API',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }],
          activeProfileId: 'profile-1',
          version: 1
        }
      });

      useSettingsStore.setState({
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetApiProfiles).toHaveBeenCalled();
      expect(result.current.hasToken).toBe(true);
    });

    it('should not call IPC profiles when store activeProfileId is set', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      useSettingsStore.setState({
        activeProfileId: 'profile-1'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetApiProfiles).not.toHaveBeenCalled();
      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken false when no API profile is active', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
    });

    it('should return hasToken false when activeProfileId is empty string', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: ''
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
    });
  });

  describe('combined authentication (source token OR API profile)', () => {
    it('should return hasToken true when both source token and API profile exist', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: true, sourcePath: '/mock/ac-jerry' }
      });

      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: 'profile-1'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken true when only source token exists (no API profile)', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: true, sourcePath: '/mock/ac-jerry' }
      });

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken true when only API profile exists (no source token)', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: 'profile-1'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken false when neither source token nor API profile exists', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
    });
  });

  describe('profile switching and re-checking', () => {
    it('should re-check authentication when activeProfileId changes', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      const { result } = renderHook(() => useIdeationAuth());

      // Initial state - no active profile
      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: null
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.hasToken).toBe(false);

      // Switch to active profile
      act(() => {
        useSettingsStore.setState({
          activeProfileId: 'profile-1'
        });
      });

      await waitFor(() => {
        expect(result.current.hasToken).toBe(true);
      });

      // Effect runs when activeProfileId changes
      expect(mockCheckSourceToken).toHaveBeenCalled();
    });

    it('should re-check authentication when switching from API profile to none', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      // Initial state - active profile
      useSettingsStore.setState({
        profiles: [{
          id: 'profile-1',
          name: 'Custom API',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant-test-key',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        activeProfileId: 'profile-1'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.hasToken).toBe(true);

      // Switch to no active profile
      act(() => {
        useSettingsStore.setState({
          activeProfileId: null
        });
      });

      await waitFor(() => {
        expect(result.current.hasToken).toBe(false);
      });
    });
  });

  describe('manual checkAuth function', () => {
    it('should manually re-check authentication when checkAuth is called', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      // Initial state - no active profile
      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.hasToken).toBe(false);

      // Update to have active profile
      act(() => {
        useSettingsStore.setState({
          profiles: [{
            id: 'profile-1',
            name: 'Custom API',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-test-key',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }],
          activeProfileId: 'profile-1'
        });
      });

      // Manually trigger re-check
      act(() => {
        result.current.checkAuth();
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(true);
    });

    it('should set loading state during manual checkAuth', async () => {
      mockCheckSourceToken.mockImplementation(
        () => new Promise(resolve => {
          setTimeout(() => {
            resolve({
              success: true,
              data: { hasToken: true }
            });
          }, 100);
        })
      );

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      // Wait for initial check
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Trigger manual check
      act(() => {
        result.current.checkAuth();
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should clear error on successful manual re-check', async () => {
      // First call throws error
      mockCheckSourceToken.mockRejectedValueOnce(new Error('Network error'));

      // Second call succeeds
      mockCheckSourceToken.mockResolvedValueOnce({
        success: true,
        data: { hasToken: true }
      });

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');

      // Manually re-check
      act(() => {
        result.current.checkAuth();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe(null);
      expect(result.current.hasToken).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle activeProfileId as null', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: true }
      });

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should still check source token
      expect(result.current.hasToken).toBe(true);
    });

    it('should handle unknown error type in catch block', async () => {
      mockCheckSourceToken.mockRejectedValue('string error');

      useSettingsStore.setState({
        profiles: [],
        activeProfileId: null
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasToken).toBe(false);
      expect(result.current.error).toBe('Unknown error');
    });

    it('should handle profiles array with API profiles', async () => {
      mockCheckSourceToken.mockResolvedValue({
        success: true,
        data: { hasToken: false }
      });

      // Multiple profiles, one active
      useSettingsStore.setState({
        profiles: [
          {
            id: 'profile-1',
            name: 'API 1',
            baseUrl: 'https://api1.anthropic.com',
            apiKey: 'sk-ant-key-1',
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'profile-2',
            name: 'API 2',
            baseUrl: 'https://api2.anthropic.com',
            apiKey: 'sk-ant-key-2',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ],
        activeProfileId: 'profile-2'
      });

      const { result } = renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Has active profile
      expect(result.current.hasToken).toBe(true);
    });
  });
});
