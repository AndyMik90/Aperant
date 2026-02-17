import {
  DndContext,
  DragOverlay,
  closestCenter
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { ProjectTabBar } from './ProjectTabBar';
import { WindowControls } from './WindowControls';
import { useTopNavBar } from './hooks/useTopNavBar';

export interface TopNavBarProps {
  onProjectClose: (projectId: string) => void;
  onAddProject: () => void;
}

export function TopNavBar({
  onProjectClose,
  onAddProject
}: TopNavBarProps) {
  const {
    projectTabs,
    activeProjectId,
    sensors,
    activeDragProject,
    handleDragStart,
    handleDragEnd,
    handleProjectTabSelect
  } = useTopNavBar();

  const isMacOS = window.platform?.isMacOS;

  return (
    <div className="flex flex-row items-center w-full h-12 pt-2 z-10 electron-drag">
      {projectTabs.length > 0 ? (
        <div className="flex-1 min-w-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={projectTabs.map(p => p.id)} strategy={horizontalListSortingStrategy}>
              <ProjectTabBar
                projects={projectTabs}
                activeProjectId={activeProjectId}
                onProjectSelect={handleProjectTabSelect}
                onProjectClose={onProjectClose}
                onAddProject={onAddProject}
              />
            </SortableContext>

            {/* Drag overlay - shows what's being dragged */}
            <DragOverlay>
              {activeDragProject && (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground shadow-lg max-w-[200px]">
                  <span className="truncate">{activeDragProject.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {!isMacOS && <div className="h-4 w-px shrink-0 bg-border mx-1 electron-no-drag" />}
      <WindowControls />
    </div>
  );
}
