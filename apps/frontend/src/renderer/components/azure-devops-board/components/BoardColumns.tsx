import { useMemo } from 'react';
import { ScrollArea } from '../../ui/scroll-area';
import { cn } from '../../../lib/utils';
import { WorkItemCard } from './WorkItemCard';
import type { BoardColumnsProps, BoardColumnData, AzureDevOpsWorkItem } from '../types';

interface ColumnProps {
  column: BoardColumnData;
  onCardClick: (workItem: AzureDevOpsWorkItem) => void;
  isLoading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-white/5 bg-secondary/30 p-3 animate-pulse">
      <div className="flex items-start gap-2">
        <div className="h-4 w-4 rounded bg-muted-foreground/20" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-muted-foreground/20" />
          <div className="h-3 w-1/2 rounded bg-muted-foreground/20" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-5 w-5 rounded-full bg-muted-foreground/20" />
        <div className="h-3 w-16 rounded bg-muted-foreground/20" />
      </div>
    </div>
  );
}

function BoardColumn({ column, onCardClick, isLoading }: ColumnProps) {
  const getColumnBorderColor = (columnType?: string): string => {
    switch (columnType) {
      case 'incoming':
        return 'border-t-blue-500/60';
      case 'inProgress':
        return 'border-t-amber-500/60';
      case 'outgoing':
        return 'border-t-green-500/60';
      default:
        return 'border-t-muted-foreground/30';
    }
  };

  const onClickHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    column.workItems.forEach((workItem) => {
      handlers.set(workItem.id.toString(), () => onCardClick(workItem));
    });
    return handlers;
  }, [column.workItems, onCardClick]);

  return (
    <div
      className={cn(
        'flex min-w-72 max-w-80 flex-1 flex-col rounded-xl border border-white/5 bg-linear-to-b from-secondary/30 to-transparent backdrop-blur-sm',
        'border-t-2',
        getColumnBorderColor(column.columnType)
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <h2 className="font-semibold text-sm text-foreground">
            {column.name}
          </h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted-foreground/10 px-1.5 text-xs font-medium text-muted-foreground">
            {isLoading ? '-' : column.workItems.length}
          </span>
        </div>
      </div>

      {/* Work items list */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full px-3 pb-3 pt-2">
          <div className="space-y-3 min-h-[120px]">
            {isLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : column.workItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <span className="text-sm text-muted-foreground/70">
                  No work items
                </span>
              </div>
            ) : (
              column.workItems.map((workItem) => (
                <WorkItemCard
                  key={workItem.id}
                  workItem={workItem}
                  onClick={onClickHandlers.get(workItem.id.toString())!}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export function BoardColumns({ columns, onCardClick, isLoading }: BoardColumnsProps) {
  return (
    <div className="flex flex-1 gap-4 overflow-x-auto p-6">
      {columns.map((column) => (
        <BoardColumn
          key={column.id}
          column={column}
          onCardClick={onCardClick}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
