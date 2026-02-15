import {
  DndContext,
  DragOverlay,
  closestCenter
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { ProjectTabBar } from './ProjectTabBar';
import { AppBranding } from './AppBranding';
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
    <div className={cn(
      "flex items-center w-full h-10 z-10 pt-2 electron-drag",
      isMacOS && "pl-[75px]"
    )}>
      <AppBranding />

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
                <div className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 shadow-lg max-w-[200px]">
                  <div className="w-1 h-4 bg-muted-foreground rounded-full" />
                  <span className="truncate font-medium text-sm">{activeDragProject.name}</span>
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
