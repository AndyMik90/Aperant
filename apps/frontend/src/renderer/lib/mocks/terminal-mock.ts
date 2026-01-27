/**
 * Mock implementation for terminal operations
 */

export const terminalMock = {
  createTerminal: async () => {
    console.warn('[Browser Mock] createTerminal called');
    return { success: true };
  },

  destroyTerminal: async () => {
    console.warn('[Browser Mock] destroyTerminal called');
    return { success: true };
  },

  sendTerminalInput: () => {
    console.warn('[Browser Mock] sendTerminalInput called');
  },

  resizeTerminal: () => {
    console.warn('[Browser Mock] resizeTerminal called');
  },

  invokeClaudeInTerminal: () => {
    console.warn('[Browser Mock] invokeClaudeInTerminal called');
  },

  generateTerminalName: async () => ({
    success: true,
    data: 'Mock Terminal'
  }),

  setTerminalTitle: () => {
    console.warn('[Browser Mock] setTerminalTitle called');
  },

  setTerminalWorktreeConfig: () => {
    console.warn('[Browser Mock] setTerminalWorktreeConfig called');
  },

  // Terminal session management
  getTerminalSessions: async () => ({
    success: true,
    data: []
  }),

  restoreTerminalSession: async () => ({
    success: true,
    data: {
      success: true,
      terminalId: 'restored-terminal'
    }
  }),

  clearTerminalSessions: async () => ({ success: true }),

  resumeClaudeInTerminal: () => {
    console.warn('[Browser Mock] resumeClaudeInTerminal called');
  },

  activateDeferredClaudeResume: () => {
    console.warn('[Browser Mock] activateDeferredClaudeResume called');
  },

  getTerminalSessionDates: async () => ({
    success: true,
    data: []
  }),

  getTerminalSessionsForDate: async () => ({
    success: true,
    data: []
  }),

  restoreTerminalSessionsFromDate: async () => ({
    success: true,
    data: {
      restored: 0,
      failed: 0,
      sessions: []
    }
  }),

  saveTerminalBuffer: async () => {},

  checkTerminalPtyAlive: async () => ({
    success: true,
    data: { alive: false }
  }),

  updateTerminalDisplayOrders: async () => ({
    success: true
  }),

  // Terminal Event Listeners (no-op in browser mock)
  onTerminalOutput: () => () => {}, // Intentional no-op for browser mock
  onTerminalExit: () => () => {}, // Intentional no-op for browser mock
  onTerminalTitleChange: () => () => {}, // Intentional no-op for browser mock
  onTerminalWorktreeConfigChange: () => () => {}, // Intentional no-op for browser mock
  onTerminalClaudeSession: () => () => {}, // Intentional no-op for browser mock
  onTerminalRateLimit: () => () => {}, // Intentional no-op for browser mock
  onTerminalOAuthToken: () => () => {}, // Intentional no-op for browser mock
  onTerminalAuthCreated: () => () => {}, // Intentional no-op for browser mock
  onTerminalClaudeBusy: () => () => {}, // Intentional no-op for browser mock
  onTerminalClaudeExit: () => () => {}, // Intentional no-op for browser mock
  onTerminalOnboardingComplete: () => () => {}, // Intentional no-op for browser mock
  onTerminalPendingResume: () => () => {}, // Intentional no-op for browser mock
  onTerminalProfileChanged: () => () => {}, // Intentional no-op for browser mock
  onTerminalOAuthCodeNeeded: () => () => {}, // Intentional no-op for browser mock

  // OAuth code submission
  submitOAuthCode: async () => ({
    success: true
  })
};
