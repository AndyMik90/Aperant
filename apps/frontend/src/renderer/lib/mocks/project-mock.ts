/**
 * Mock implementation for project operations
 */

import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/constants';
import { mockProjects } from './mock-data';

export const projectMock = {
  addProject: async (projectPath: string) => ({
    success: true,
    data: {
      id: `mock-${Date.now()}`,
      name: projectPath.split('/').pop() || 'new-project',
      path: projectPath,
      autoBuildPath: `${projectPath}/auto-claude`,
      settings: DEFAULT_PROJECT_SETTINGS,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  removeProject: async () => ({ success: true }),

  getProjects: async () => ({
    success: true,
    data: mockProjects
  }),

  updateProjectSettings: async () => ({ success: true }),

  initializeProject: async () => ({
    success: true,
    data: { success: true, version: '1.0.0', wasUpdate: false }
  }),

  checkProjectVersion: async () => ({
    success: true,
    data: {
      isInitialized: true,
      currentVersion: '1.0.0',
      sourceVersion: '1.0.0',
      updateAvailable: false
    }
  }),

  // Tab state operations (persisted in main process)
  getTabState: async () => ({
    success: true,
    data: {
      openProjectIds: [],
      activeProjectId: null,
      tabOrder: []
    }
  }),

  saveTabState: async () => ({ success: true }),

  // Kanban Preferences
  getKanbanPreferences: async () => ({ success: true, data: null }),
  saveKanbanPreferences: async () => ({ success: true }),

  // Dialog operations
  selectDirectory: async () => {
    return prompt('Enter project path (browser mock):', '/Users/demo/projects/new-project');
  },

  createProjectFolder: async (_location: string, name: string, initGit: boolean) => ({
    success: true,
    data: {
      path: `/Users/demo/projects/${name}`,
      name,
      gitInitialized: initGit
    }
  }),

  getDefaultProjectLocation: async () => '/Users/demo/projects',

  // File explorer operations
  listDirectory: async () => ({
    success: true,
    data: []
  }),

  readFile: async () => ({
    success: true,
    data: ''
  }),

  // Git operations
  getGitBranches: async () => ({
    success: true,
    data: ['main', 'develop', 'feature/test']
  }),

  getGitBranchesWithInfo: async () => ({
    success: true,
    data: [
      { name: 'main', type: 'local' as const, displayName: 'main', isCurrent: true },
      { name: 'develop', type: 'local' as const, displayName: 'develop', isCurrent: false },
      { name: 'feature/test', type: 'local' as const, displayName: 'feature/test', isCurrent: false },
      { name: 'origin/main', type: 'remote' as const, displayName: 'origin/main', isCurrent: false },
      { name: 'origin/develop', type: 'remote' as const, displayName: 'origin/develop', isCurrent: false }
    ]
  }),

  getCurrentGitBranch: async () => ({
    success: true,
    data: 'main'
  }),

  detectMainBranch: async () => ({
    success: true,
    data: 'main'
  }),

  checkGitStatus: async () => ({
    success: true,
    data: {
      isGitRepo: true,
      hasCommits: true,
      currentBranch: 'main'
    }
  }),

  initializeGit: async () => ({
    success: true,
    data: { success: true }
  })
};
