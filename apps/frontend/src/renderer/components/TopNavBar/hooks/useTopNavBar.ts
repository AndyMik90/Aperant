import { useState, useCallback, useMemo } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core';
import { useProjectStore } from '@/stores/project-store';
import type { Project } from '@shared/types';

export function useTopNavBar() {
  // Subscribe to the data that getProjectTabs() depends on, then compute tabs
  // at render time. Calling getProjectTabs() inside a selector creates a new
  // array reference every render, which causes an infinite re-render loop.
  const projects = useProjectStore((state) => state.projects);
  const openProjectIds = useProjectStore((state) => state.openProjectIds);
  const tabOrder = useProjectStore((state) => state.tabOrder);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const reorderTabs = useProjectStore((state) => state.reorderTabs);

  const projectTabs = useMemo(() => {
    const orderedProjects = tabOrder
      .map(id => projects.find(p => p.id === id))
      .filter(Boolean) as Project[];
    const remainingProjects = projects
      .filter(p => openProjectIds.includes(p.id) && !tabOrder.includes(p.id));
    return [...orderedProjects, ...remainingProjects];
  }, [projects, openProjectIds, tabOrder]);

  // Setup drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

  // Track dragging state for overlay
  const [activeDragProject, setActiveDragProject] = useState<Project | null>(null);

  const handleProjectTabSelect = useCallback((projectId: string) => {
    setActiveProject(projectId);
  }, [setActiveProject]);

  // Handle drag start - set the active dragged project
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const draggedProject = projectTabs.find(p => p.id === active.id);
    if (draggedProject) {
      setActiveDragProject(draggedProject);
    }
  }, [projectTabs]);

  // Handle drag end - reorder tabs if dropped over another tab
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragProject(null);

    if (!over) return;

    const oldIndex = projectTabs.findIndex(p => p.id === active.id);
    const newIndex = projectTabs.findIndex(p => p.id === over.id);

    if (oldIndex !== newIndex && oldIndex !== -1 && newIndex !== -1) {
      reorderTabs(oldIndex, newIndex);
    }
  }, [projectTabs, reorderTabs]);

  return {
    projectTabs,
    activeProjectId,
    sensors,
    activeDragProject,
    handleDragStart,
    handleDragEnd,
    handleProjectTabSelect
  };
}
