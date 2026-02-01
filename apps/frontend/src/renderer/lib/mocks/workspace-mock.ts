/**
 * Mock implementation for workspace management operations
 */

export const workspaceMock = {
  getWorktreeStatus: async () => ({
    success: true,
    data: {
      exists: false
    }
  }),

  getWorktreeDiff: async () => ({
    success: true,
    data: {
      files: [],
      summary: 'No changes'
    }
  }),

  mergeWorktree: async () => ({
    success: true,
    data: {
      success: true,
      message: 'Merge completed successfully'
    }
  }),

  mergeWorktreePreview: async () => ({
    success: true,
    data: {
      success: true,
      message: 'Preview generated',
      preview: {
        files: ['src/index.ts', 'src/utils.ts'],
        conflicts: [
          {
            file: 'src/utils.ts',
            location: 'lines 10-15',
            tasks: ['task-001'],
            severity: 'low' as const,
            canAutoMerge: true,
            strategy: 'append',
            reason: 'Non-overlapping additions'
          }
        ],
        summary: {
          totalFiles: 2,
          conflictFiles: 1,
          totalConflicts: 1,
          autoMergeable: 1
        }
      }
    }
  }),

  createWorktreePR: async () => ({
    success: true,
    data: {
      success: true,
      prUrl: 'https://github.com/example/repo/pull/123'
    }
  }),

  discardWorktree: async (_taskId: string, _skipStatusChange?: boolean) => ({
    success: true,
    data: {
      success: true,
      message: 'Worktree discarded successfully'
    }
  }),

  discardOrphanedWorktree: async (_projectId: string, _specName: string) => ({
    success: true,
    data: {
      success: true,
      message: 'Orphaned worktree discarded successfully'
    }
  }),

  clearStagedState: async () => ({
    success: true,
    data: { cleared: true }
  }),

  listWorktrees: async () => ({
    success: true,
    data: {
      worktrees: []
    }
  }),

  worktreeOpenInIDE: async () => ({
    success: true,
    data: { opened: true }
  }),

  worktreeOpenInTerminal: async () => ({
    success: true,
    data: { opened: true }
  }),

  worktreeDetectTools: async () => ({
    success: true,
    data: {
      ides: [
        { id: 'vscode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', installed: true }
      ],
      terminals: [
        { id: 'system', name: 'System Terminal', path: '', installed: true }
      ]
    }
  })
};
