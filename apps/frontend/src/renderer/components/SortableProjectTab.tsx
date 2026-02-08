import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { Project } from '../../shared/types';

interface SortableProjectTabProps {
  project: Project;
  isActive: boolean;
  canClose: boolean;
  tabIndex: number;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  // Optional control props for active tab
  onSettingsClick?: () => void;
}

// Detect if running on macOS for keyboard shortcut display
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? '⌘' : 'Ctrl+';

export function SortableProjectTab({
  project,
  isActive,
  canClose,
  tabIndex,
  onSelect,
  onClose,
  onSettingsClick
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
        'group relative flex items-center min-w-0',
        'max-w-[220px]',
        'touch-none transition-all duration-200',
        'rounded-md border text-xs font-medium',
        isActive
          ? 'bg-primary/10 border-primary/30 text-primary'
          : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'opacity-60 scale-[0.98] shadow-lg'
      )}
      {...attributes}
    >
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex-1 flex items-center gap-1.5',
              'px-2.5 py-1',
              'min-w-0 truncate cursor-pointer transition-colors'
            )}
            onClick={onSelect}
          >
            {/* Drag handle - visible on hover, hidden on mobile */}
            <div
              {...listeners}
              className={cn(
                'hidden sm:block',
                'opacity-0 group-hover:opacity-60 transition-opacity',
                'cursor-grab active:cursor-grabbing',
                'w-1 h-3 bg-current rounded-full flex-shrink-0 opacity-30'
              )}
            />
            <span className="truncate font-medium">
              {project.name}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          <span>{project.name}</span>
          {shortcutHint && (
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border border-border font-mono">
              {shortcutHint}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Active tab controls - settings */}
      {isActive && onSettingsClick && (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'h-4 w-4 p-0 rounded-sm flex-shrink-0',
                'flex items-center justify-center',
                'text-primary/60 hover:text-primary',
                'transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSettingsClick();
              }}
              aria-label={t('projectTab.settings')}
            >
              <Settings2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{t('projectTab.settings')}</span>
          </TooltipContent>
        </Tooltip>
      )}

      {canClose && (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'h-4 w-4 p-0 mr-1 flex-shrink-0',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'transition-opacity duration-200 rounded-sm',
                'hover:bg-destructive/20 hover:text-destructive',
                'flex items-center justify-center',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isActive && 'opacity-100'
              )}
              onClick={onClose}
              aria-label={t('projectTab.closeTabAriaLabel')}
            >
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            <span>{t('projectTab.closeTab')}</span>
            <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border border-border font-mono">
              {closeShortcut}
            </kbd>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
