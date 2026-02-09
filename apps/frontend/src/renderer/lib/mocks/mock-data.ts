/**
 * Mock data for browser preview
 * Contains sample projects, tasks, and sessions for UI development/testing
 */

import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/constants';

export const mockProjects = [
  {
    id: 'mock-project-1',
    name: 'sample-project',
    path: '/Users/demo/projects/sample-project',
    autoBuildPath: '/Users/demo/projects/sample-project/auto-claude',
    settings: DEFAULT_PROJECT_SETTINGS,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'mock-project-2',
    name: 'another-project',
    path: '/Users/demo/projects/another-project',
    autoBuildPath: '/Users/demo/projects/another-project/auto-claude',
    settings: DEFAULT_PROJECT_SETTINGS,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

export const mockInsightsSessions = [
  {
    id: 'session-1',
    projectId: 'mock-project-1',
    title: 'Architecture discussion',
    messageCount: 5,
    createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 30)
  },
  {
    id: 'session-2',
    projectId: 'mock-project-1',
    title: 'Code review suggestions',
    messageCount: 12,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2)
  },
  {
    id: 'session-3',
    projectId: 'mock-project-1',
    title: 'Security analysis',
    messageCount: 8,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // Yesterday
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  },
  {
    id: 'session-4',
    projectId: 'mock-project-1',
    title: 'Performance optimization',
    messageCount: 3,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3), // 3 days ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3)
  }
];

export const mockTasks = [
  {
    id: 'task-1',
    projectId: 'mock-project-1',
    specId: '001-add-auth',
    title: 'Add user authentication',
    description: 'Implement JWT-based user authentication with login/logout functionality',
    status: 'backlog' as const,
    subtasks: [],
    logs: [],
    createdAt: new Date(Date.now() - 86400000),
    updatedAt: new Date(Date.now() - 86400000)
  },
  {
    id: 'task-2',
    projectId: 'mock-project-1',
    specId: '002-dashboard',
    title: 'Build analytics dashboard',
    description: 'Create a real-time analytics dashboard with charts and metrics',
    status: 'in_progress' as const,
    subtasks: [
      { id: 'subtask-1', title: 'Setup chart library', description: 'Install and configure Chart.js', status: 'completed' as const, files: ['src/lib/charts.ts'] },
      { id: 'subtask-2', title: 'Create dashboard layout', description: 'Build responsive grid layout', status: 'in_progress' as const, files: ['src/components/Dashboard.tsx'] },
      { id: 'subtask-3', title: 'Add data fetching', description: 'Implement API calls for metrics', status: 'pending' as const, files: [] }
    ],
    logs: ['[INFO] Starting task...', '[INFO] Subtask 1 completed', '[INFO] Working on subtask 2...'],
    createdAt: new Date(Date.now() - 3600000),
    updatedAt: new Date()
  },
  {
    id: 'task-3',
    projectId: 'mock-project-1',
    specId: '003-fix-bug',
    title: 'Fix pagination bug',
    description: 'Fix off-by-one error in table pagination',
    status: 'human_review' as const,
    subtasks: [
      { id: 'subtask-1', title: 'Fix pagination logic', description: 'Correct the offset calculation', status: 'completed' as const, files: ['src/utils/pagination.ts'] }
    ],
    logs: ['[INFO] Task completed, awaiting review'],
    createdAt: new Date(Date.now() - 7200000),
    updatedAt: new Date(Date.now() - 1800000)
  },
  {
    id: 'task-4',
    projectId: 'mock-project-1',
    specId: '004-refactor',
    title: 'Refactor API layer',
    description: 'Consolidate API calls into a single service',
    status: 'done' as const,
    subtasks: [
      { id: 'subtask-1', title: 'Create API service', description: 'Build centralized API client', status: 'completed' as const, files: ['src/services/api.ts'] },
      { id: 'subtask-2', title: 'Migrate endpoints', description: 'Update all components to use new service', status: 'completed' as const, files: ['src/components/*.tsx'] }
    ],
    logs: ['[INFO] Task completed successfully'],
    createdAt: new Date(Date.now() - 172800000),
    updatedAt: new Date(Date.now() - 86400000)
  },
  {
    id: 'task-5',
    projectId: 'mock-project-1',
    specId: '005-add-search',
    title: 'Add search functionality',
    description: 'Implement full-text search across all entities',
    status: 'pr_created' as const,
    subtasks: [
      { id: 'subtask-1', title: 'Setup search index', description: 'Configure search indexing', status: 'completed' as const, files: ['src/lib/search.ts'] },
      { id: 'subtask-2', title: 'Add search UI', description: 'Create search component', status: 'completed' as const, files: ['src/components/Search.tsx'] }
    ],
    logs: ['[INFO] Task completed, PR created'],
    createdAt: new Date(Date.now() - 259200000),
    updatedAt: new Date(Date.now() - 43200000)
  }
];
