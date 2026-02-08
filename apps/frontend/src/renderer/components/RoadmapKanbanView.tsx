import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Inbox, Eye, Calendar, Play, Check } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { SortableFeatureCard } from './SortableFeatureCard';
import { cn } from '../lib/utils';
import { useRoadmapStore } from '../stores/roadmap-store';
import {
  ROADMAP_STATUS_COLUMNS,
  type RoadmapStatusColumn
} from '../../shared/constants';
import type { RoadmapFeature, RoadmapFeatureStatus, Roadmap } from '../../shared/types';

interface RoadmapKanbanViewProps {
  roadmap: Roadmap;
  onFeatureClick: (feature: RoadmapFeature) => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
  onSave?: () => void;
}

interface DroppableStatusColumnProps {
  column: RoadmapStatusColumn;
  features: RoadmapFeature[];
  roadmap: Roadmap;
  onFeatureClick: (feature: RoadmapFeature) => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
  isOver: boolean;
}

// Get icon component for status
function getStatusIcon(iconName: string) {
  switch (iconName) {
    case 'Eye':
      return <Eye className="h-3.5 w-3.5" />;
    case 'Calendar':
      return <Calendar className="h-3.5 w-3.5" />;
    case 'Play':
      return <Play className="h-3.5 w-3.5" />;
    case 'Check':
      return <Check className="h-3.5 w-3.5" />;
    default:
      return null;
  }
}

function DroppableStatusColumn({
  column,
  features,
  roadmap,
  onFeatureClick,
  onConvertToSpec,
  onGoToTask,
  isOver
}: DroppableStatusColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id
  });

  const featureIds = features.map((f) => f.id);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-w-80 max-w-[32rem] flex-1 flex-col rounded-xl border border-white/5 bg-linear-to-b from-secondary/30 to-transparent backdrop-blur-sm transition-all duration-200',
        column.color,
        'border-t-2',
        isOver && 'drop-zone-highlight'
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center',
              column.id === 'done'
                ? 'bg-success/10 text-success'
                : column.id === 'in_progress'
                ? 'bg-primary/10 text-primary'
                : column.id === 'planned'
                ? 'bg-info/10 text-info'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {getStatusIcon(column.icon)}
          </div>
          <h2 className="font-semibold text-sm text-foreground">
            {column.label}
          </h2>
          <span className="column-count-badge">
            {features.length}
          </span>
        </div>
      </div>

      {/* Features list */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full px-3 pb-3 pt-2">
          <SortableContext
            items={featureIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3 min-h-[120px]">
              {features.length === 0 ? (
                <div
                  className={cn(
                    'empty-column-dropzone flex flex-col items-center justify-center py-6',
                    isOver && 'active'
                  )}
                >
                  {isOver ? (
                    <>
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium text-primary">Drop here</span>
                    </>
                  ) : (
                    <>
                      <Inbox className="h-6 w-6 text-muted-foreground/50" />
                      <span className="mt-2 text-sm font-medium text-muted-foreground/70">
                        No features
                      </span>
                      <span className="mt-0.5 text-xs text-muted-foreground/50">
                        Drag features here
                      </span>
                    </>
                  )}
                </div>
              ) : (
                features.map((feature) => (
                  <SortableFeatureCard
                    key={feature.id}
                    feature={feature}
                    roadmap={roadmap}
                    onClick={() => onFeatureClick(feature)}
                    onConvertToSpec={onConvertToSpec}
                    onGoToTask={onGoToTask}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
}

export function RoadmapKanbanView({
  roadmap,
  onFeatureClick,
  onConvertToSpec,
  onGoToTask,
  onSave
}: RoadmapKanbanViewProps) {
  const [activeFeature, setActiveFeature] = useState<RoadmapFeature | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const updateFeatureStatus = useRoadmapStore((state) => state.updateFeatureStatus);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8 // 8px movement required before drag starts
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  // Get features grouped by status
  const featuresByStatus = useMemo(() => {
    const grouped: Record<string, RoadmapFeature[]> = {};
    ROADMAP_STATUS_COLUMNS.forEach((column) => {
      grouped[column.id] = roadmap.features.filter((f) => f.status === column.id);
    });
    return grouped;
  }, [roadmap.features]);

  // Get all status IDs for detecting column drops
  const statusIds = useMemo(() => ROADMAP_STATUS_COLUMNS.map((c) => c.id), []);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const feature = roadmap.features.find((f) => f.id === active.id);
    if (feature) {
      setActiveFeature(feature);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;

    if (!over) {
      setOverColumnId(null);
      return;
    }

    const overId = over.id as string;

    // Check if over a status column
    if (statusIds.includes(overId)) {
      setOverColumnId(overId);
      return;
    }

    // Check if over a feature - get its status
    const overFeature = roadmap.features.find((f) => f.id === overId);
    if (overFeature) {
      setOverColumnId(overFeature.status);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveFeature(null);
    setOverColumnId(null);

    if (!over) return;

    const activeFeatureId = active.id as string;
    const overId = over.id as string;
    const draggedFeature = roadmap.features.find((f) => f.id === activeFeatureId);

    if (!draggedFeature) return;

    // Determine target status
    let targetStatus: RoadmapFeatureStatus;

    if (statusIds.includes(overId)) {
      // Dropped directly on a status column
      targetStatus = overId as RoadmapFeatureStatus;
    } else {
      // Dropped on a feature - get its status
      const overFeature = roadmap.features.find((f) => f.id === overId);
      if (!overFeature) return;
      targetStatus = overFeature.status;
    }

    const sourceStatus = draggedFeature.status;

    if (sourceStatus !== targetStatus) {
      // Moving to a different status
      updateFeatureStatus(activeFeatureId, targetStatus);

      // Trigger save callback
      onSave?.();
    }
    // Note: We don't support reordering within status columns for now
    // Features are displayed in their natural order within each status
  };

  // Get status label for a feature (for display in drag overlay)
  const getStatusLabelForFeature = (feature: RoadmapFeature) => {
    const statusColumn = ROADMAP_STATUS_COLUMNS.find((c) => c.id === feature.status);
    return statusColumn?.label || 'Unknown Status';
  };

  return (
    <div className="flex h-full flex-col">
      {/* Kanban columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto p-6">
          {ROADMAP_STATUS_COLUMNS.map((column) => (
            <DroppableStatusColumn
              key={column.id}
              column={column}
              features={featuresByStatus[column.id] || []}
              roadmap={roadmap}
              onFeatureClick={onFeatureClick}
              onConvertToSpec={onConvertToSpec}
              onGoToTask={onGoToTask}
              isOver={overColumnId === column.id}
            />
          ))}
        </div>

        {/* Drag overlay - enhanced visual feedback */}
        <DragOverlay>
          {activeFeature ? (
            <div className="drag-overlay-card">
              <Card className="p-4 w-80 shadow-2xl">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {getStatusLabelForFeature(activeFeature)}
                  </Badge>
                </div>
                <div className="font-medium">{activeFeature.title}</div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {activeFeature.description}
                </p>
              </Card>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
