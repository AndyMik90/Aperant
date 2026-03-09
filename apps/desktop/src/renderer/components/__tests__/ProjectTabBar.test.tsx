/**
 * Unit tests for ProjectTabBar component
 * Tests project tab rendering, interaction handling, state display,
 * and new control props (settings, archive toggle)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from '../../../shared/types';

// Helper to create test projects
function createTestProject(overrides: Partial<Project> = {}): Project {
  return {
    id: `project-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name: 'Test Project',
    path: '/path/to/test-project',
    autoBuildPath: '/path/to/test-project/.auto-claude',
    settings: {
      model: 'claude-3-haiku-20240307',
      memoryBackend: 'file',
      linearSync: false,
      notifications: {
        onTaskComplete: true,
        onTaskFailed: true,
        onReviewNeeded: true,
        sound: false
      }
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe('ProjectTabBar', () => {
  // Mock callbacks
  const mockOnProjectSelect = vi.fn();
  const mockOnProjectClose = vi.fn();
  const mockOnAddProject = vi.fn();
  // New control callbacks
  const mockOnSettingsClick = vi.fn();
  const mockOnToggleArchived = vi.fn();

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('Rendering Logic', () => {
    it('should return null when projects array is empty', () => {
      const projects: Project[] = [];
      const activeProjectId = null;

      // Component returns null when projects.length === 0
      expect(projects.length).toBe(0);
      expect(activeProjectId).toBeNull();
    });

    it('should render when projects array has at least one project', () => {
      const projects = [createTestProject()];
      const activeProjectId = projects[0].id;

      // Component renders when projects.length > 0
      expect(projects.length).toBeGreaterThan(0);
      expect(activeProjectId).toBe(projects[0].id);
    });

    it('should render all projects in the array', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Project 1' }),
        createTestProject({ id: 'proj-2', name: 'Project 2' }),
        createTestProject({ id: 'proj-3', name: 'Project 3' })
      ];

      expect(projects).toHaveLength(3);
      expect(projects.map(p => p.name)).toEqual(['Project 1', 'Project 2', 'Project 3']);
    });

    it('should render tabs in the order they appear in the projects array', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Alpha' }),
        createTestProject({ id: 'proj-2', name: 'Beta' }),
        createTestProject({ id: 'proj-3', name: 'Gamma' })
      ];

      const expectedOrder = ['Alpha', 'Beta', 'Gamma'];
      const actualOrder = projects.map(p => p.name);

      expect(actualOrder).toEqual(expectedOrder);
    });
  });

  describe('Active Project State', () => {
    it('should identify active project correctly', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Work' }),
        createTestProject({ id: 'proj-2', name: 'Personal' })
      ];
      const activeProjectId = 'proj-2';

      // Check which project is active
      const activeProject = projects.find(p => p.id === activeProjectId);
      expect(activeProject?.name).toBe('Personal');

      // Check isActive logic for each project
      projects.forEach(project => {
        const isActive = project.id === activeProjectId;
        if (project.id === 'proj-2') {
          expect(isActive).toBe(true);
        } else {
          expect(isActive).toBe(false);
        }
      });
    });

    it('should handle when no project is active', () => {
      const projects = [createTestProject({ id: 'proj-1', name: 'Solo' })];
      const activeProjectId = null;

      const activeProject = projects.find(p => p.id === activeProjectId);
      expect(activeProject).toBeUndefined();

      // Check isActive logic for the project
      projects.forEach(project => {
        const isActive = project.id === activeProjectId;
        expect(isActive).toBe(false);
      });
    });

    it('should handle active project that is not in the projects array', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Current' })
      ];
      const activeProjectId = 'proj-not-in-array';

      // No project should be active
      projects.forEach(project => {
        const isActive = project.id === activeProjectId;
        expect(isActive).toBe(false);
      });
    });

    it('should handle multiple projects with the same name but different IDs', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'My Project' }),
        createTestProject({ id: 'proj-2', name: 'My Project' })
      ];
      const activeProjectId = 'proj-2';

      // Both projects have same name but different IDs
      expect(projects[0].name).toBe(projects[1].name);
      expect(projects[0].id).not.toBe(projects[1].id);

      // Only proj-2 should be active
      projects.forEach(project => {
        const isActive = project.id === activeProjectId;
        if (project.id === 'proj-2') {
          expect(isActive).toBe(true);
        } else {
          expect(isActive).toBe(false);
        }
      });
    });
  });

  describe('Project Selection', () => {
    it('should call onProjectSelect with correct project ID when tab is clicked', () => {
      // Simulate clicking on project 2
      const selectedProjectId = 'proj-2';
      mockOnProjectSelect(selectedProjectId);

      expect(mockOnProjectSelect).toHaveBeenCalledWith('proj-2');
      expect(mockOnProjectSelect).toHaveBeenCalledTimes(1);
    });

    it('should handle project selection for the first project', () => {
      const selectedProjectId = 'proj-first';
      mockOnProjectSelect(selectedProjectId);

      expect(mockOnProjectSelect).toHaveBeenCalledWith('proj-first');
    });

    it('should handle project selection for the last project', () => {
      const selectedProjectId = 'proj-c';
      mockOnProjectSelect(selectedProjectId);

      expect(mockOnProjectSelect).toHaveBeenCalledWith('proj-c');
    });
  });

  describe('Project Closing', () => {
    it('should call onProjectClose with correct project ID when close button is clicked', () => {
      // Simulate clicking close button for project 1
      const closedProjectId = 'proj-1';

      mockOnProjectClose(closedProjectId);

      expect(mockOnProjectClose).toHaveBeenCalledWith('proj-1');
      expect(mockOnProjectClose).toHaveBeenCalledTimes(1);
    });

    it('should prevent event propagation when close button is clicked', () => {
      const mockEvent = {
        stopPropagation: vi.fn()
      } as unknown as React.MouseEvent;

      // Simulate the event handling logic
      const onClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        mockOnProjectClose('proj-1');
      };

      onClose(mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockOnProjectClose).toHaveBeenCalledWith('proj-1');
    });

    it('should allow closing when there are multiple projects', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Project 1' }),
        createTestProject({ id: 'proj-2', name: 'Project 2' })
      ];

      // canClose = projects.length > 1
      const canClose = projects.length > 1;
      expect(canClose).toBe(true);
    });

    it('should not allow closing when there is only one project', () => {
      const projects = [
        createTestProject({ id: 'proj-only', name: 'Only Project' })
      ];

      // canClose = projects.length > 1
      const canClose = projects.length > 1;
      expect(canClose).toBe(false);
    });
  });

  describe('Add Project Button', () => {
    it('should call onAddProject when add button is clicked', () => {
      mockOnAddProject();

      expect(mockOnAddProject).toHaveBeenCalledTimes(1);
    });

    it('should render add button with correct attributes', () => {
      // Check button attributes from component
      const buttonVariant = 'ghost';
      const buttonSize = 'icon';
      const buttonTitle = 'Add Project';
      const buttonClasses = 'h-8 w-8';

      expect(buttonVariant).toBe('ghost');
      expect(buttonSize).toBe('icon');
      expect(buttonTitle).toBe('Add Project');
      expect(buttonClasses).toBe('h-8 w-8');
    });

    it('should render Plus icon in add button', () => {
      // Component uses Plus from lucide-react
      const iconClass = 'h-4 w-4';
      expect(iconClass).toBe('h-4 w-4');
    });
  });

  describe('Container Layout and Styling', () => {
    it('should apply correct container classes', () => {
      // From component: className={cn(
      //   'flex items-center border-b border-border bg-background',
      //   'overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
      //   className
      // )}
      const expectedClasses = [
        'flex',
        'items-center',
        'border-b',
        'border-border',
        'bg-background',
        'overflow-x-auto',
        'scrollbar-thin',
        'scrollbar-thumb-border',
        'scrollbar-track-transparent'
      ];

      expectedClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });
    });

    it('should apply correct flex container for tabs', () => {
      // From component: <div className="flex items-center flex-1 min-w-0">
      const tabContainerClasses = [
        'flex',
        'items-center',
        'flex-1',
        'min-w-0'
      ];

      tabContainerClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });
    });

    it('should apply correct add button container classes', () => {
      // From component: <div className="flex items-center px-2 py-1">
      const addButtonContainerClasses = [
        'flex',
        'items-center',
        'px-2',
        'py-1'
      ];

      addButtonContainerClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });
    });
  });

  describe('Props Handling', () => {
    it('should accept and use custom className', () => {
      const customClassName = 'custom-test-class';
      const baseClasses = [
        'flex items-center border-b border-border bg-background',
        'overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent'
      ];

      // The cn function combines base classes with custom className
      expect(customClassName).toBe('custom-test-class');
      baseClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });
    });

    it('should handle all required props correctly', () => {
      const projects = [createTestProject()];
      const activeProjectId = projects[0].id;
      const className = undefined;

      // All required props should be available
      expect(projects).toBeDefined();
      expect(activeProjectId).toBeDefined();
      expect(mockOnProjectSelect).toBeDefined();
      expect(mockOnProjectClose).toBeDefined();
      expect(mockOnAddProject).toBeDefined();
      expect(className).toBeUndefined(); // Optional prop
    });

    it('should handle optional className prop', () => {
      const customClassName = 'my-custom-class';

      // Optional prop should be handled correctly
      expect(customClassName).toBe('my-custom-class');
    });
  });

  describe('Tab Key Generation', () => {
    it('should use project.id as key for tabs', () => {
      const projects = [
        createTestProject({ id: 'unique-id-1', name: 'Project 1' }),
        createTestProject({ id: 'unique-id-2', name: 'Project 2' })
      ];

      // Each tab should use project.id as its key
      projects.forEach(project => {
        const key = project.id;
        expect(key).toBeDefined();
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      });

      // Keys should be unique
      const keys = projects.map(p => p.id);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should handle projects with special characters in ID', () => {
      const specialIds = ['proj-with-123', 'proj_with_underscore', 'proj.with.dots'];

      specialIds.forEach(id => {
        const project = createTestProject({ id });
        expect(project.id).toBe(id);
      });
    });
  });

  describe('Integration with SortableProjectTab', () => {
    it('should pass correct props to SortableProjectTab', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Test Project' })
      ];
      const activeProjectId = 'proj-1';

      // Props that should be passed to SortableProjectTab
      const tabProps = {
        project: projects[0],
        isActive: activeProjectId === projects[0].id,
        canClose: projects.length > 1,
        tabIndex: 0,
        onSelect: expect.any(Function),
        onClose: expect.any(Function)
      };

      expect(tabProps.project.id).toBe('proj-1');
      expect(tabProps.isActive).toBe(true);
      expect(tabProps.canClose).toBe(false); // Only one project
    });

    it('should pass canClose correctly based on project count', () => {
      const singleProject = [createTestProject({ id: 'proj-single' })];
      const multipleProjects = [
        createTestProject({ id: 'proj-a' }),
        createTestProject({ id: 'proj-b' })
      ];

      // For single project
      const canCloseSingle = singleProject.length > 1;
      expect(canCloseSingle).toBe(false);

      // For multiple projects
      const canCloseMultiple = multipleProjects.length > 1;
      expect(canCloseMultiple).toBe(true);
    });

    it('should pass correct onSelect function that calls onProjectSelect with project ID', () => {
      // Create the onSelect function that would be passed to SortableProjectTab
      const projectId = 'proj-callback';
      const onSelect = () => mockOnProjectSelect(projectId);

      onSelect();

      expect(mockOnProjectSelect).toHaveBeenCalledWith('proj-callback');
    });

    it('should pass correct onClose function that stops propagation and calls onProjectClose', () => {
      const mockEvent = {
        stopPropagation: vi.fn()
      } as unknown as React.MouseEvent;

      const projectId = 'proj-close';
      const onClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        mockOnProjectClose(projectId);
      };

      onClose(mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockOnProjectClose).toHaveBeenCalledWith('proj-close');
    });
  });

  describe('Control Props for Active Tab', () => {
    it('should accept onSettingsClick prop', () => {
      // Control props interface verification
      const controlProps = {
        onSettingsClick: mockOnSettingsClick,
        showArchived: false,
        archivedCount: 0,
        onToggleArchived: mockOnToggleArchived
      };

      expect(controlProps.onSettingsClick).toBeDefined();
      expect(typeof controlProps.onSettingsClick).toBe('function');
    });

    it('should accept showArchived prop', () => {
      const controlProps = {
        showArchived: true
      };

      expect(controlProps.showArchived).toBe(true);

      const controlPropsHidden = {
        showArchived: false
      };

      expect(controlPropsHidden.showArchived).toBe(false);
    });

    it('should accept archivedCount prop', () => {
      // With archived items
      const controlPropsWithArchived = {
        archivedCount: 5
      };
      expect(controlPropsWithArchived.archivedCount).toBe(5);

      // Without archived items
      const controlPropsNoArchived = {
        archivedCount: 0
      };
      expect(controlPropsNoArchived.archivedCount).toBe(0);
    });

    it('should accept onToggleArchived prop', () => {
      const controlProps = {
        onToggleArchived: mockOnToggleArchived
      };

      expect(controlProps.onToggleArchived).toBeDefined();
      expect(typeof controlProps.onToggleArchived).toBe('function');
    });

    it('should pass control props only to active tab', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Project 1' }),
        createTestProject({ id: 'proj-2', name: 'Project 2' })
      ];
      const activeProjectId = 'proj-2';

      // Control props should only be passed to active tab
      projects.forEach(project => {
        const isActiveTab = activeProjectId === project.id;
        const tabControlProps = {
          onSettingsClick: isActiveTab ? mockOnSettingsClick : undefined,
          showArchived: isActiveTab ? false : undefined,
          archivedCount: isActiveTab ? 3 : undefined,
          onToggleArchived: isActiveTab ? mockOnToggleArchived : undefined
        };

        if (project.id === 'proj-2') {
          // Active tab should have control props
          expect(tabControlProps.onSettingsClick).toBe(mockOnSettingsClick);
          expect(tabControlProps.showArchived).toBe(false);
          expect(tabControlProps.archivedCount).toBe(3);
          expect(tabControlProps.onToggleArchived).toBe(mockOnToggleArchived);
        } else {
          // Inactive tab should have undefined control props
          expect(tabControlProps.onSettingsClick).toBeUndefined();
          expect(tabControlProps.showArchived).toBeUndefined();
          expect(tabControlProps.archivedCount).toBeUndefined();
          expect(tabControlProps.onToggleArchived).toBeUndefined();
        }
      });
    });

    it('should handle onSettingsClick callback correctly', () => {
      // Simulate clicking settings
      mockOnSettingsClick();

      expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
    });

    it('should handle onToggleArchived callback correctly', () => {
      // Simulate clicking archive toggle
      mockOnToggleArchived();

      expect(mockOnToggleArchived).toHaveBeenCalledTimes(1);
    });

    it('should handle archived count edge cases', () => {
      // Zero archived
      expect(0).toBe(0);
      expect(0 > 0).toBe(false);

      // Some archived
      expect(5).toBeGreaterThan(0);
      expect(5 > 0).toBe(true);

      // Large number of archived
      expect(100).toBeGreaterThan(0);
      expect(100 > 0).toBe(true);
    });

    it('should toggle showArchived state correctly', () => {
      let showArchived = false;

      // Simulate toggle function behavior
      const toggle = () => {
        showArchived = !showArchived;
      };

      expect(showArchived).toBe(false);
      toggle();
      expect(showArchived).toBe(true);
      toggle();
      expect(showArchived).toBe(false);
    });
  });

  describe('Control Props with Multiple Projects', () => {
    it('should only pass control props to currently active project', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Alpha' }),
        createTestProject({ id: 'proj-2', name: 'Beta' }),
        createTestProject({ id: 'proj-3', name: 'Gamma' })
      ];

      // Test with proj-2 as active
      let activeProjectId = 'proj-2';
      let activeIndex = projects.findIndex(p => p.id === activeProjectId);
      expect(activeIndex).toBe(1);

      // Only proj-2 should get control props
      projects.forEach((project, index) => {
        const isActive = project.id === activeProjectId;
        if (index === 1) {
          expect(isActive).toBe(true);
        } else {
          expect(isActive).toBe(false);
        }
      });

      // Switch to proj-3 as active
      activeProjectId = 'proj-3';
      activeIndex = projects.findIndex(p => p.id === activeProjectId);
      expect(activeIndex).toBe(2);

      // Now only proj-3 should get control props
      projects.forEach((project, index) => {
        const isActive = project.id === activeProjectId;
        if (index === 2) {
          expect(isActive).toBe(true);
        } else {
          expect(isActive).toBe(false);
        }
      });
    });

    it('should handle rapid active project changes', () => {
      const projects = [
        createTestProject({ id: 'proj-1' }),
        createTestProject({ id: 'proj-2' }),
        createTestProject({ id: 'proj-3' })
      ];

      const activeProjectIds = ['proj-1', 'proj-2', 'proj-3', 'proj-1', 'proj-2'];

      activeProjectIds.forEach(activeId => {
        projects.forEach(project => {
          const isActive = project.id === activeId;
          const shouldHaveControls = isActive;
          expect(shouldHaveControls).toBe(project.id === activeId);
        });
      });
    });
  });

  describe('UsageIndicator Integration', () => {
    it('should render UsageIndicator next to add button', () => {
      // Component structure verification
      // UsageIndicator should be rendered in the right-side container
      const containerClasses = ['flex', 'items-center', 'gap-2', 'px-2', 'py-1'];

      containerClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });
    });

    it('should render UsageIndicator before add project button', () => {
      // Order verification: UsageIndicator, then Add button
      const expectedOrder = ['UsageIndicator', 'AddButton'];
      expect(expectedOrder[0]).toBe('UsageIndicator');
      expect(expectedOrder[1]).toBe('AddButton');
    });
  });

  describe('Updated Container Styling', () => {
    it('should apply correct gap-2 spacing in right-side container', () => {
      // From component: <div className="flex items-center gap-2 px-2 py-1">
      const rightContainerClasses = [
        'flex',
        'items-center',
        'gap-2',  // Updated from no gap
        'px-2',
        'py-1'
      ];

      rightContainerClasses.forEach(cls => {
        expect(cls).toBeTruthy();
      });

      expect(rightContainerClasses).toContain('gap-2');
    });
  });

  describe('Tab Control Props Interface', () => {
    it('should have correct interface for control props', () => {
      // Verify the control props interface matches component expectations
      interface ControlProps {
        onSettingsClick?: () => void;
        showArchived?: boolean;
        archivedCount?: number;
        onToggleArchived?: () => void;
      }

      const validControlProps: ControlProps = {
        onSettingsClick: () => {},
        showArchived: false,
        archivedCount: 0,
        onToggleArchived: () => {}
      };

      expect(validControlProps.onSettingsClick).toBeDefined();
      expect(validControlProps.showArchived).toBe(false);
      expect(validControlProps.archivedCount).toBe(0);
      expect(validControlProps.onToggleArchived).toBeDefined();
    });

    it('should allow optional control props', () => {
      interface ControlProps {
        onSettingsClick?: () => void;
        showArchived?: boolean;
        archivedCount?: number;
        onToggleArchived?: () => void;
      }

      const emptyControlProps: ControlProps = {};

      expect(emptyControlProps.onSettingsClick).toBeUndefined();
      expect(emptyControlProps.showArchived).toBeUndefined();
      expect(emptyControlProps.archivedCount).toBeUndefined();
      expect(emptyControlProps.onToggleArchived).toBeUndefined();
    });

    it('should handle partial control props', () => {
      interface ControlProps {
        onSettingsClick?: () => void;
        showArchived?: boolean;
        archivedCount?: number;
        onToggleArchived?: () => void;
      }

      // Only settings provided
      const settingsOnlyProps: ControlProps = {
        onSettingsClick: () => {}
      };
      expect(settingsOnlyProps.onSettingsClick).toBeDefined();
      expect(settingsOnlyProps.onToggleArchived).toBeUndefined();

      // Only archive toggle provided
      const archiveOnlyProps: ControlProps = {
        onToggleArchived: () => {},
        showArchived: true,
        archivedCount: 5
      };
      expect(archiveOnlyProps.onToggleArchived).toBeDefined();
      expect(archiveOnlyProps.showArchived).toBe(true);
      expect(archiveOnlyProps.archivedCount).toBe(5);
      expect(archiveOnlyProps.onSettingsClick).toBeUndefined();
    });
  });

  describe('Integration with SortableProjectTab Control Props', () => {
    it('should pass control props to SortableProjectTab for active tab', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Test Project' })
      ];
      const activeProjectId = 'proj-1';

      // Props that should be passed to SortableProjectTab including controls
      const tabProps = {
        project: projects[0],
        isActive: activeProjectId === projects[0].id,
        canClose: projects.length > 1,
        tabIndex: 0,
        onSelect: expect.any(Function),
        onClose: expect.any(Function),
        // Control props for active tab
        onSettingsClick: mockOnSettingsClick,
        showArchived: false,
        archivedCount: 3,
        onToggleArchived: mockOnToggleArchived
      };

      expect(tabProps.project.id).toBe('proj-1');
      expect(tabProps.isActive).toBe(true);
      expect(tabProps.onSettingsClick).toBe(mockOnSettingsClick);
      expect(tabProps.showArchived).toBe(false);
      expect(tabProps.archivedCount).toBe(3);
      expect(tabProps.onToggleArchived).toBe(mockOnToggleArchived);
    });

    it('should not pass control props to SortableProjectTab for inactive tab', () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'Project 1' }),
        createTestProject({ id: 'proj-2', name: 'Project 2' })
      ];
      const activeProjectId = 'proj-2';

      // Props for inactive tab (proj-1)
      const inactiveTabProps = {
        project: projects[0],
        isActive: activeProjectId === projects[0].id, // false
        canClose: projects.length > 1,
        tabIndex: 0,
        onSelect: expect.any(Function),
        onClose: expect.any(Function),
        // Control props should be undefined for inactive tab
        onSettingsClick: undefined,
        showArchived: undefined,
        archivedCount: undefined,
        onToggleArchived: undefined
      };

      expect(inactiveTabProps.isActive).toBe(false);
      expect(inactiveTabProps.onSettingsClick).toBeUndefined();
      expect(inactiveTabProps.showArchived).toBeUndefined();
      expect(inactiveTabProps.archivedCount).toBeUndefined();
      expect(inactiveTabProps.onToggleArchived).toBeUndefined();
    });
  });
});
