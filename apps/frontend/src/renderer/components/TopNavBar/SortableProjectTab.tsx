import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Project } from '@shared/types';

interface SortableProjectTabProps {
  project: Project;
  isActive: boolean;
  canClose: boolean;
  tabIndex: number;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}

// Detect if running on macOS for keyboard shortcut display
const isMac = !!window.platform?.isMacOS;
const modKey = isMac ? '⌘' : 'Ctrl+';

export function SortableProjectTab({
  project,
  isActive,
  canClose,
  tabIndex,
  onSelect,
  onClose
}: SortableProjectTabProps) {
  const { t } = useTranslation('common');
  // Build tooltip with keyboard shortcut hint (only for tabs 1-9)
  const shortcutHint = tabIndex < 9 ? `${modKey}${tabIndex + 1}` : '';
  const closeShortcut = `${modKey}W`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center electron-no-drag',
        'touch-none transition-all duration-200',
        isDragging && 'opacity-60 scale-[0.98]'
      )}
      {...attributes}
      {...listeners}
    >
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Badge
            variant={isActive ? 'secondary' : 'outline'}
            className={cn(
              'cursor-pointer gap-1.5 pr-1.5 select-none',
              'max-w-[160px] sm:max-w-[200px] md:max-w-[240px]',
              'px-3 py-1.5',
              isActive && 'bg-secondary text-secondary-foreground',
              !isActive && [
                'bg-transparent hover:bg-secondary/50',
                'text-muted-foreground hover:text-foreground'
              ]
            )}
            onClick={onSelect}
          >
            {/* Project name */}
            <span className="truncate text-sm font-medium">
              {project.name}
            </span>

            {/* Close button */}
            {canClose && (
              <button
                type="button"
                className={cn(
                  'ml-0.5 rounded-full p-0.5 shrink-0',
                  'opacity-0 group-hover:opacity-100',
                  'hover:bg-destructive hover:text-destructive-foreground',
                  'transition-all duration-150',
                  'focus-visible:outline-none focus-visible:opacity-100',
                  isActive && 'opacity-60 hover:opacity-100'
                )}
                onClick={onClose}
                aria-label={t('projectTab.closeTabAriaLabel')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          <span>{project.name}</span>
          {shortcutHint && (
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border border-border font-mono">
              {shortcutHint}
            </kbd>
          )}
          {canClose && (
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border border-border font-mono">
              {closeShortcut}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
