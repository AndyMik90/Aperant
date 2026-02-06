/**
 * Mock implementation for task operations
 */

import type { TaskRecoveryOptions } from '../../../shared/types';
import { mockTasks } from './mock-data';

export const taskMock = {
  getTasks: async (projectId: string) => ({
    success: true,
    data: mockTasks.filter(t => t.projectId === projectId)
  }),

  createTask: async (projectId: string, title: string, description: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      projectId,
      specId: `00${mockTasks.length + 1}-new-task`,
      title,
      description,
      status: 'planning' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  deleteTask: async () => ({ success: true }),

  updateTask: async (_taskId: string, updates: { title?: string; description?: string }) => ({
    success: true,
    data: {
      id: _taskId,
      projectId: 'mock-project-1',
      specId: '001-updated',
      title: updates.title || 'Updated Task',
      description: updates.description || 'Updated description',
      status: 'planning' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  startTask: () => {
    console.warn('[Browser Mock] startTask called');
  },

  stopTask: () => {
    console.warn('[Browser Mock] stopTask called');
  },

  submitReview: async () => ({ success: true }),

  // Task archive operations
  archiveTasks: async () => ({ success: true, data: true }),
  unarchiveTasks: async () => ({ success: true, data: true }),

  // Task status operations
  updateTaskStatus: async (_taskId: string, _status: string, _options?: { forceCleanup?: boolean }) => ({ success: true }),

  recoverStuckTask: async (taskId: string, options?: TaskRecoveryOptions) => ({
    success: true,
    data: {
      taskId,
      recovered: true,
      newStatus: options?.targetStatus || 'planning',
      message: '[Browser Mock] Task recovered successfully'
    }
  }),

  checkTaskRunning: async () => ({ success: true, data: false }),

  sendMessageToTask: async (_taskId: string, _message: string) => ({ success: true, data: true }),

  readSpecFile: async (_taskId: string, _fileName: string) => ({ success: true, data: null }),

  // Task logs operations
  getTaskLogs: async () => ({
    success: true,
    data: null
  }),

  watchTaskLogs: async () => ({ success: true }),

  unwatchTaskLogs: async () => ({ success: true }),

  // Event Listeners (no-op in browser)
  onTaskProgress: () => () => {},
  onTaskError: () => () => {},
  onTaskLog: () => () => {},
  onTaskStatusChange: () => () => {},
  onTaskExecutionProgress: () => () => {},
  onTaskAgentStopped: () => () => {},
  onTaskSpecReady: () => () => {},  // FIX-7
  onTaskLogsChanged: () => () => {},
  onTaskLogsStream: () => () => {}
};
