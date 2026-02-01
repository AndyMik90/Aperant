import { memo } from 'react';
import { Bug, BookOpen, CheckSquare, Sparkles, FileText, User } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { WorkItemCardProps, AzureDevOpsWorkItem } from '../types';

const WORK_ITEM_TYPE_CONFIG: Record<string, { icon: typeof Bug; color: string }> = {
  'Bug': { icon: Bug, color: 'text-red-500 bg-red-500/10 border-red-500/30' },
  'User Story': { icon: BookOpen, color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
  'Task': { icon: CheckSquare, color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30' },
  'Feature': { icon: Sparkles, color: 'text-purple-500 bg-purple-500/10 border-purple-500/30' },
  'Epic': { icon: Sparkles, color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: 'Critical', color: 'text-red-500 bg-red-500/10 border-red-500/30' },
  2: { label: 'High', color: 'text-orange-500 bg-orange-500/10 border-orange-500/30' },
  3: { label: 'Medium', color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30' },
  4: { label: 'Low', color: 'text-green-500 bg-green-500/10 border-green-500/30' },
};

function getWorkItemTypeConfig(type: string) {
  return WORK_ITEM_TYPE_CONFIG[type] || { icon: FileText, color: 'text-muted-foreground bg-muted/10 border-border' };
}

function workItemCardPropsAreEqual(
  prevProps: WorkItemCardProps,
  nextProps: WorkItemCardProps
): boolean {
  const prev = prevProps.workItem;
  const next = nextProps.workItem;
  
  if (prev === next && prevProps.onClick === nextProps.onClick) {
    return true;
  }
  
  const prevTags = prev.tags?.split(';').filter(Boolean) || [];
  const nextTags = next.tags?.split(';').filter(Boolean) || [];
  
  return (
    prev.id === next.id &&
    prev.rev === next.rev &&
    prev.title === next.title &&
    prev.state === next.state &&
    prev.assignedTo?.displayName === next.assignedTo?.displayName &&
    prev.priority === next.priority &&
    prevTags.length === nextTags.length
  );
}

export const WorkItemCard = memo(function WorkItemCard({ workItem, onClick }: WorkItemCardProps) {
  const typeConfig = getWorkItemTypeConfig(workItem.workItemType);
  const TypeIcon = typeConfig.icon;
  const priorityConfig = workItem.priority ? PRIORITY_CONFIG[workItem.priority] : null;
  const tags = workItem.tags?.split(';').map(t => t.trim()).filter(Boolean) || [];
  
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/50 hover:-translate-y-0.5',
        'active:translate-y-0 active:shadow-sm'
      )}
      onClick={onClick}
    >
      <CardContent className="p-3">
        {/* Header: ID + Type */}
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0.5 flex items-center gap-1', typeConfig.color)}
          >
            <TypeIcon className="h-3 w-3" />
            {workItem.workItemType}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">#{workItem.id}</span>
        </div>
        
        {/* Title */}
        <h3
          className="font-medium text-sm text-foreground line-clamp-2 leading-snug"
          title={workItem.title}
        >
          {workItem.title}
        </h3>
        
        {/* Tags */}
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 bg-muted/50"
              >
                {tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 bg-muted/50"
              >
                +{tags.length - 3}
              </Badge>
            )}
          </div>
        )}
        
        {/* Footer: Assignee + Priority */}
        <div className="mt-3 flex items-center justify-between">
          {/* Assignee */}
          <div className="flex items-center gap-1.5">
            {workItem.assignedTo ? (
              <>
                {workItem.assignedTo.imageUrl ? (
                  <img
                    src={workItem.assignedTo.imageUrl}
                    alt={workItem.assignedTo.displayName}
                    className="h-5 w-5 rounded-full"
                  />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-3 w-3 text-primary" />
                  </div>
                )}
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {workItem.assignedTo.displayName}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground/50 italic">Unassigned</span>
            )}
          </div>
          
          {/* Priority */}
          {priorityConfig && (
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', priorityConfig.color)}
            >
              {priorityConfig.label}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}, workItemCardPropsAreEqual);
