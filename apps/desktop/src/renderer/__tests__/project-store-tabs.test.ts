/**
 * Unit tests for Project Store Tab Management
 * Tests Zustand store for project tab state management
 *
 * Note: Tab state persistence is now handled via IPC (saveTabState/getTabState)
 * rather than localStorage. The saveTabState calls are debounced, so we don't
 * assert on them directly in these unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useProjectStore } from '../stores/project-store';
import type { Project, ProjectSettings } from '../../shared/types';

// Helper to create test projects
function createTestProject(overrides: Partial<Project> = {}): Project {
  const defaultSettings: ProjectSettings = {
    model: 'claude-3-opus',
    memoryBackend: 'memory',
    linearSync: false,
    notifications: {
      onTaskComplete: true,
      onTaskFailed: true,
      onReviewNeeded: true,
      sound: false
    },
    
  };

  return {
    id: `project-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name: 'Test Project',
    path: '/path/to/test-project',
    autoBuildPath: '.auto-claude',
    settings: defaultSettings,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}


describe('Project Store Tab Management', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useProjectStore.setState({
      projects: [],
      selectedProjectId: null,
      isLoading: false,
      error: null,
      openProjectIds: [],
      activeProjectId: null,
      tabOrder: []
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('openProjectTab', () => {
    it('should open a new project tab', () => {
      const project = createTestProject({ id: 'project-1' });
      useProjectStore.setState({ projects: [project] });

      useProjectStore.getState().openProjectTab('project-1');

      expect(useProjectStore.getState().openProjectIds).toContain('project-1');
      expect(useProjectStore.getState().activeProjectId).toBe('project-1');
      expect(useProjectStore.getState().tabOrder).toContain('project-1');
    });

    it('should add to existing open tabs', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });
      useProjectStore.setState({
        projects: [project1, project2],
        openProjectIds: ['project-1'],
        activeProjectId: 'project-1',
        tabOrder: ['project-1']
      });

      useProjectStore.getState().openProjectTab('project-2');

      expect(useProjectStore.getState().openProjectIds).toEqual(['project-1', 'project-2']);
      expect(useProjectStore.getState().activeProjectId).toBe('project-2');
      expect(useProjectStore.getState().tabOrder).toEqual(['project-1', 'project-2']);
    });

    it('should not duplicate existing tab', () => {
      const project = createTestProject({ id: 'project-1' });
      useProjectStore.setState({
        projects: [project],
        openProjectIds: ['project-1'],
        activeProjectId: 'project-1',
        tabOrder: ['project-1']
      });

      useProjectStore.getState().openProjectTab('project-1');

      // Should only have one entry
      expect(useProjectStore.getState().openProjectIds).toEqual(['project-1']);
      expect(useProjectStore.getState().tabOrder).toEqual(['project-1']);
      // Should still make it active
      expect(useProjectStore.getState().activeProjectId).toBe('project-1');
    });

    it('should preserve existing tab order when adding new tab', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });
      const project3 = createTestProject({ id: 'project-3' });
      useProjectStore.setState({
        projects: [project1, project2, project3],
        openProjectIds: ['project-1', 'project-3'],
        activeProjectId: 'project-3',
        tabOrder: ['project-1', 'project-3']
      });

      useProjectStore.getState().openProjectTab('project-2');

      expect(useProjectStore.getState().tabOrder).toEqual(['project-1', 'project-3', 'project-2']);
    });
  });

  describe('closeProjectTab', () => {
    it('should close a project tab', () => {
      useProjectStore.setState({
        openProjectIds: ['project-1', 'project-2'],
        activeProjectId: 'project-2',
        tabOrder: ['project-1', 'project-2']
      });

      useProjectStore.getState().closeProjectTab('project-1');

      expect(useProjectStore.getState().openProjectIds).toEqual(['project-2']);
      expect(useProjectStore.getState().tabOrder).toEqual(['project-2']);
    });

    it('should activate first remaining tab when closing active tab', () => {
      useProjectStore.setState({
        openProjectIds: ['project-1', 'project-2', 'project-3'],
        activeProjectId: 'project-2',
        tabOrder: ['project-1', 'project-2', 'project-3']
      });

      useProjectStore.getState().closeProjectTab('project-2');

      // After removing project-2 from tabOrder, we get ['project-1', 'project-3']
      // The first tab in the remaining order is 'project-1'
      expect(useProjectStore.getState().activeProjectId).toBe('project-1');
    });

    it('should activate previous tab when closing active tab and no next tab', () => {
      useProjectStore.setState({
        openProjectIds: ['project-1', 'project-2'],
        activeProjectId: 'project-2',
        tabOrder: ['project-1', 'project-2']
      });

      useProjectStore.getState().closeProjectTab('project-2');

      expect(useProjectStore.getState().activeProjectId).toBe('project-1');
    });

    it('should set activeProjectId to null when closing last tab', () => {
      useProjectStore.setState({
        openProjectIds: ['project-1'],
        activeProjectId: 'project-1',
        tabOrder: ['project-1']
      });

      useProjectStore.getState().closeProjectTab('project-1');

      expect(useProjectStore.getState().activeProjectId).toBeNull();
    });

    it('should not affect activeProjectId when closing non-active tab', () => {
      useProjectStore.setState({
        openProjectIds: ['project-1', 'project-2'],
        activeProjectId: 'project-2',
        tabOrder: ['project-1', 'project-2']
      });

      useProjectStore.getState().closeProjectTab('project-1');

      expect(useProjectStore.getState().activeProjectId).toBe('project-2');
    });
  });

  describe('setActiveProject', () => {
    it('should set active project', () => {
      useProjectStore.setState({ activeProjectId: null });

      useProjectStore.getState().setActiveProject('project-1');

      expect(useProjectStore.getState().activeProjectId).toBe('project-1');
    });

    it('should clear active project with null', () => {
      useProjectStore.setState({ activeProjectId: 'project-1' });

      useProjectStore.getState().setActiveProject(null);

      expect(useProjectStore.getState().activeProjectId).toBeNull();
    });

    it('should also update selectedProjectId for backward compatibility', () => {
      useProjectStore.setState({ selectedProjectId: null });

      useProjectStore.getState().setActiveProject('project-1');

      expect(useProjectStore.getState().selectedProjectId).toBe('project-1');
    });
  });

  describe('reorderTabs', () => {
    it('should reorder tabs by moving from index to index', () => {
      useProjectStore.setState({
        tabOrder: ['project-1', 'project-2', 'project-3', 'project-4']
      });

      // Move project-3 from index 2 to index 1
      useProjectStore.getState().reorderTabs(2, 1);

      expect(useProjectStore.getState().tabOrder).toEqual(['project-1', 'project-3', 'project-2', 'project-4']);
    });

    it('should handle moving tab to the end', () => {
      useProjectStore.setState({
        tabOrder: ['project-1', 'project-2', 'project-3']
      });

      // Move project-1 from index 0 to index 2
      useProjectStore.getState().reorderTabs(0, 2);

      expect(useProjectStore.getState().tabOrder).toEqual(['project-2', 'project-3', 'project-1']);
    });

    it('should handle moving tab to the beginning', () => {
      useProjectStore.setState({
        tabOrder: ['project-1', 'project-2', 'project-3']
      });

      // Move project-3 from index 2 to index 0
      useProjectStore.getState().reorderTabs(2, 0);

      expect(useProjectStore.getState().tabOrder).toEqual(['project-3', 'project-1', 'project-2']);
    });

    it('should handle no-op reordering (same index)', () => {
      useProjectStore.setState({
        tabOrder: ['project-1', 'project-2', 'project-3']
      });

      useProjectStore.getState().reorderTabs(1, 1);

      expect(useProjectStore.getState().tabOrder).toEqual(['project-1', 'project-2', 'project-3']);
    });
  });

  describe('restoreTabState', () => {
    it('should be a no-op (tab state is now loaded via IPC in loadProjects)', () => {
      // Set up some initial state
      useProjectStore.setState({
        openProjectIds: ['existing'],
        activeProjectId: 'existing',
        tabOrder: ['existing']
      });

      // restoreTabState is now a no-op - it just logs
      useProjectStore.getState().restoreTabState();

      // State should remain unchanged (not modified by restoreTabState)
      expect(useProjectStore.getState().openProjectIds).toEqual(['existing']);
      expect(useProjectStore.getState().activeProjectId).toBe('existing');
      expect(useProjectStore.getState().tabOrder).toEqual(['existing']);
    });
  });

  describe('getOpenProjects', () => {
    it('should return projects that are open', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });
      const project3 = createTestProject({ id: 'project-3' });

      useProjectStore.setState({
        projects: [project1, project2, project3],
        openProjectIds: ['project-1', 'project-3']
      });

      const openProjects = useProjectStore.getState().getOpenProjects();

      expect(openProjects).toHaveLength(2);
      expect(openProjects.map(p => p.id)).toEqual(['project-1', 'project-3']);
    });

    it('should return empty array when no projects are open', () => {
      const project1 = createTestProject({ id: 'project-1' });

      useProjectStore.setState({
        projects: [project1],
        openProjectIds: []
      });

      const openProjects = useProjectStore.getState().getOpenProjects();

      expect(openProjects).toHaveLength(0);
    });

    it('should handle open project IDs that dont exist in projects', () => {
      const project1 = createTestProject({ id: 'project-1' });

      useProjectStore.setState({
        projects: [project1],
        openProjectIds: ['project-1', 'non-existent']
      });

      const openProjects = useProjectStore.getState().getOpenProjects();

      expect(openProjects).toHaveLength(1);
      expect(openProjects[0].id).toBe('project-1');
    });
  });

  describe('getActiveProject', () => {
    it('should return the active project', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });

      useProjectStore.setState({
        projects: [project1, project2],
        activeProjectId: 'project-2'
      });

      const activeProject = useProjectStore.getState().getActiveProject();

      expect(activeProject).toBeDefined();
      expect(activeProject?.id).toBe('project-2');
    });

    it('should return undefined when no active project', () => {
      const project1 = createTestProject({ id: 'project-1' });

      useProjectStore.setState({
        projects: [project1],
        activeProjectId: null
      });

      const activeProject = useProjectStore.getState().getActiveProject();

      expect(activeProject).toBeUndefined();
    });

    it('should return undefined when active project ID does not exist', () => {
      const project1 = createTestProject({ id: 'project-1' });

      useProjectStore.setState({
        projects: [project1],
        activeProjectId: 'non-existent'
      });

      const activeProject = useProjectStore.getState().getActiveProject();

      expect(activeProject).toBeUndefined();
    });
  });

  describe('getProjectTabs', () => {
    it('should return projects in tab order', () => {
      const project1 = createTestProject({ id: 'project-1', name: 'Project 1' });
      const project2 = createTestProject({ id: 'project-2', name: 'Project 2' });
      const project3 = createTestProject({ id: 'project-3', name: 'Project 3' });

      useProjectStore.setState({
        projects: [project1, project2, project3],
        openProjectIds: ['project-1', 'project-2', 'project-3'],
        tabOrder: ['project-3', 'project-1', 'project-2']
      });

      const tabs = useProjectStore.getState().getProjectTabs();

      expect(tabs).toHaveLength(3);
      expect(tabs.map(p => p.id)).toEqual(['project-3', 'project-1', 'project-2']);
    });

    it('should append open projects not in tab order', () => {
      const project1 = createTestProject({ id: 'project-1', name: 'Project 1' });
      const project2 = createTestProject({ id: 'project-2', name: 'Project 2' });
      const project3 = createTestProject({ id: 'project-3', name: 'Project 3' });

      useProjectStore.setState({
        projects: [project1, project2, project3],
        openProjectIds: ['project-1', 'project-2', 'project-3'],
        tabOrder: ['project-2'] // Only project-2 is in tabOrder
      });

      const tabs = useProjectStore.getState().getProjectTabs();

      expect(tabs).toHaveLength(3);
      // project-2 should be first (from tabOrder), others appended
      expect(tabs[0].id).toBe('project-2');
      expect(tabs.slice(1).map(p => p.id)).toContain('project-1');
      expect(tabs.slice(1).map(p => p.id)).toContain('project-3');
    });

    it('should return empty array when no tabs are open', () => {
      const project1 = createTestProject({ id: 'project-1' });

      useProjectStore.setState({
        projects: [project1],
        openProjectIds: [],
        tabOrder: []
      });

      const tabs = useProjectStore.getState().getProjectTabs();

      expect(tabs).toHaveLength(0);
    });

    it('should handle tab order entries for projects that are not open', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });

      useProjectStore.setState({
        projects: [project1, project2],
        openProjectIds: ['project-1'], // Only project-1 is actually open
        tabOrder: ['project-2', 'project-1'] // tabOrder has project-2
      });

      const tabs = useProjectStore.getState().getProjectTabs();

      // getProjectTabs returns all projects in tabOrder, then adds open projects not in tabOrder
      // So it returns project-2 (from tabOrder) and project-1 (from tabOrder)
      // Even though project-2 is not in openProjectIds
      expect(tabs).toHaveLength(2);
      expect(tabs[0].id).toBe('project-2'); // First in tabOrder
      expect(tabs[1].id).toBe('project-1'); // Second in tabOrder
    });
  });

  describe('Integration with existing project operations', () => {
    it('should open tab when adding project', () => {
      const project = createTestProject({ id: 'project-1' });

      useProjectStore.setState({ projects: [] });
      useProjectStore.getState().addProject(project);
      useProjectStore.getState().selectProject(project.id);
      useProjectStore.getState().openProjectTab(project.id);

      expect(useProjectStore.getState().projects).toContain(project);
      expect(useProjectStore.getState().selectedProjectId).toBe(project.id);
      expect(useProjectStore.getState().openProjectIds).toContain(project.id);
      expect(useProjectStore.getState().activeProjectId).toBe(project.id);
    });

    it('should update selectedProjectId when removing project', () => {
      const project1 = createTestProject({ id: 'project-1' });
      const project2 = createTestProject({ id: 'project-2' });

      useProjectStore.setState({
        projects: [project1, project2],
        openProjectIds: ['project-1', 'project-2'],
        activeProjectId: 'project-2',
        selectedProjectId: 'project-1'
      });

      useProjectStore.getState().removeProject('project-1');

      expect(useProjectStore.getState().projects).not.toContain(
        expect.objectContaining({ id: 'project-1' })
      );
      // removeProject clears selectedProjectId if it matches the removed project
      expect(useProjectStore.getState().selectedProjectId).toBeNull();
      // Note: openProjectIds is not automatically cleared by removeProject
      // This would be handled by the UI layer when it detects the project was removed
    });
  });
});
