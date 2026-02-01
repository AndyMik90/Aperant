import { ExternalLink, User, Tag, Sparkles, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { ScrollArea } from '../../ui/scroll-area';
import type { WorkItemDetailDialogProps } from '../types';
import { stripHtmlTags } from '../../../../shared/utils/html';

const WORK_ITEM_TYPE_COLORS: Record<string, string> = {
  'Bug': 'bg-red-500/20 text-red-400 border-red-500/30',
  'User Story': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Task': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Feature': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Epic': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Issue': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const STATE_COLORS: Record<string, string> = {
  'New': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'Active': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Resolved': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Closed': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'To Do': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'Doing': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Done': 'bg-green-500/20 text-green-400 border-green-500/30',
  'In Progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const PRIORITY_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: 'Critical', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  2: { label: 'High', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  3: { label: 'Medium', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  4: { label: 'Low', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
};

export function WorkItemDetailDialog({
  workItem,
  isOpen,
  onOpenChange,
  onConvertToKanban,
  isConverting = false,
}: WorkItemDetailDialogProps) {
  if (!workItem) return null;

  const typeColor = WORK_ITEM_TYPE_COLORS[workItem.workItemType] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  const stateColor = STATE_COLORS[workItem.state] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  const priorityInfo = workItem.priority ? PRIORITY_LABELS[workItem.priority] : null;
  const effort = workItem.storyPoints ?? workItem.effort;
  const tags = workItem.tags?.split(';').map(t => t.trim()).filter(Boolean) || [];

  const handleConvert = () => {
    onConvertToKanban(workItem);
  };

  const renderHtmlContent = (content: string | undefined) => {
    if (!content) return null;
    // Strip HTML tags to prevent XSS - Azure DevOps fields may contain untrusted HTML
    const sanitizedContent = stripHtmlTags(content);
    return (
      <div className="prose prose-sm prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
        {sanitizedContent}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className={typeColor}>
              {workItem.workItemType}
            </Badge>
            <Badge variant="outline" className={stateColor}>
              {workItem.state}
            </Badge>
            <span className="text-sm text-muted-foreground">#{workItem.id}</span>
            {workItem.htmlUrl && (
              <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" asChild>
                <a href={workItem.htmlUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
          <DialogTitle className="text-lg font-semibold leading-tight">
            {workItem.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-4">
            {/* Meta information */}
            <div className="flex flex-wrap gap-3 text-sm">
              {workItem.assignedTo && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{workItem.assignedTo.displayName}</span>
                </div>
              )}
              {priorityInfo && (
                <Badge variant="outline" className={priorityInfo.className}>
                  Priority: {priorityInfo.label}
                </Badge>
              )}
              {effort !== undefined && (
                <Badge variant="outline" className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
                  {workItem.storyPoints !== undefined ? 'Story Points' : 'Effort'}: {effort}
                </Badge>
              )}
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-accent/50 text-foreground border-border"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Description</h4>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                {workItem.description ? (
                  renderHtmlContent(workItem.description)
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No description provided.
                  </p>
                )}
              </div>
            </div>

            {/* Acceptance Criteria */}
            {workItem.acceptanceCriteria && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Acceptance Criteria</h4>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  {renderHtmlContent(workItem.acceptanceCriteria)}
                </div>
              </div>
            )}

            {/* Design */}
            {workItem.design && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Design</h4>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  {renderHtmlContent(workItem.design)}
                </div>
              </div>
            )}

            {/* Additional Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {workItem.iterationPath && (
                <div>
                  <span className="text-muted-foreground">Iteration: </span>
                  <span className="text-foreground">{workItem.iterationPath}</span>
                </div>
              )}
              {workItem.areaPath && (
                <div>
                  <span className="text-muted-foreground">Area: </span>
                  <span className="text-foreground">{workItem.areaPath}</span>
                </div>
              )}
              {workItem.remainingWork !== undefined && (
                <div>
                  <span className="text-muted-foreground">Remaining Work: </span>
                  <span className="text-foreground">{workItem.remainingWork}h</span>
                </div>
              )}
              {workItem.completedWork !== undefined && (
                <div>
                  <span className="text-muted-foreground">Completed Work: </span>
                  <span className="text-foreground">{workItem.completedWork}h</span>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            onClick={handleConvert}
            disabled={isConverting}
            className="w-full sm:w-auto"
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Convert to Task
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
