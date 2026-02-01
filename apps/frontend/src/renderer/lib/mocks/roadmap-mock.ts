/**
 * Mock implementation for roadmap operations
 */

export const roadmapMock = {
  getRoadmap: async () => ({
    success: true,
    data: null
  }),

  generateRoadmap: () => {
    console.warn('[Browser Mock] generateRoadmap called');
  },

  refreshRoadmap: () => {
    console.warn('[Browser Mock] refreshRoadmap called');
  },

  updateFeatureStatus: async () => ({ success: true }),

  convertFeatureToSpec: async (projectId: string, _featureId: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      specId: '',
      projectId,
      title: 'Converted Feature',
      description: 'Feature converted from roadmap',
      status: 'planning' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  // Roadmap Event Listeners
  onRoadmapProgress: () => () => {},
  onRoadmapComplete: () => () => {},
  onRoadmapError: () => () => {}
};
