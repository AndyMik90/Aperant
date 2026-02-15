import { useState } from 'react';
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
  const projectTabs = useProjectStore((state) => state.getProjectTabs());
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const reorderTabs = useProjectStore((state) => state.reorderTabs);

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

  const handleProjectTabSelect = (projectId: string) => {
    setActiveProject(projectId);
  };

  // Handle drag start - set the active dragged project
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedProject = projectTabs.find(p => p.id === active.id);
    if (draggedProject) {
      setActiveDragProject(draggedProject);
    }
  };

  // Handle drag end - reorder tabs if dropped over another tab
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragProject(null);

    if (!over) return;

    const oldIndex = projectTabs.findIndex(p => p.id === active.id);
    const newIndex = projectTabs.findIndex(p => p.id === over.id);

    if (oldIndex !== newIndex && oldIndex !== -1 && newIndex !== -1) {
      reorderTabs(oldIndex, newIndex);
    }
  };

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
