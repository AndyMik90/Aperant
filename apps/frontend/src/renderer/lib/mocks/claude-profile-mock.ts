/**
 * Mock implementation for Claude profile management operations
 */

export const claudeProfileMock = {
  getClaudeProfiles: async () => ({
    success: true,
    data: {
      profiles: [],
      activeProfileId: 'default'
    }
  }),

  saveClaudeProfile: async (profile: { id: string; name: string; oauthToken?: string; email?: string; isDefault?: boolean; createdAt?: Date }) => ({
    success: true,
    data: {
      id: profile.id,
      name: profile.name,
      oauthToken: profile.oauthToken,
      email: profile.email,
      isDefault: profile.isDefault ?? false,
      createdAt: profile.createdAt ?? new Date(),
    }
  }),

  deleteClaudeProfile: async () => ({ success: true }),

  renameClaudeProfile: async () => ({ success: true }),

  setActiveClaudeProfile: async () => ({ success: true }),

  switchClaudeProfile: async () => ({ success: true }),

  initializeClaudeProfile: async () => ({ success: true }),

  setClaudeProfileToken: async () => ({ success: true }),

  getAutoSwitchSettings: async () => ({
    success: true,
    data: {
      enabled: false,
      proactiveSwapEnabled: false,
      sessionThreshold: 95,
      weeklyThreshold: 99,
      autoSwitchOnRateLimit: false,
      autoSwitchOnAuthFailure: false,
      usageCheckInterval: 30000
    }
  }),

  updateAutoSwitchSettings: async () => ({ success: true }),

  getAccountPriorityOrder: async () => ({
    success: true,
    data: [] as string[]
  }),

  setAccountPriorityOrder: async () => ({ success: true }),

  fetchClaudeUsage: async () => ({ success: true }),

  getBestAvailableProfile: async () => ({
    success: true,
    data: null
  }),

  onSDKRateLimit: () => () => {},

  onAuthFailure: () => () => {},

  retryWithProfile: async () => ({ success: true }),

  // Usage Monitoring (Proactive Account Switching)
  requestUsageUpdate: async () => ({
    success: true,
    data: null
  }),

  requestAllProfilesUsage: async (_forceRefresh?: boolean) => ({
    success: true,
    data: null
  }),

  onUsageUpdated: () => () => {},

  onAllProfilesUsageUpdated: () => () => {},

  onProactiveSwapNotification: () => () => {},

  // Returns terminal config for embedded authentication
  authenticateClaudeProfile: async (profileId: string) => ({
    success: true,
    data: { terminalId: `claude-login-${profileId}-${Date.now()}`, configDir: '/mock/config' }
  }),

  verifyClaudeProfileAuth: async (_profileId: string) => ({
    success: true,
    data: { authenticated: false, email: undefined }
  })
};
