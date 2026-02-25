import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Archive } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { SortableProjectTab } from './SortableProjectTab';
import { UsageIndicator } from './UsageIndicator';
import { AuthStatusIndicator } from './AuthStatusIndicator';
import type { Project } from '../../shared/types';

interface ProjectTabBarProps {
  projects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectClose: (projectId: string) => void;
  onAddProject: () => void;
  className?: string;
  // Control props for active tab
  onSettingsClick?: () => void;
  // Kanban board controls (only displayed when Kanban view is active)
  onRefresh?: () => void;
  isRefreshing?: boolean;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  archivedCount?: number;
}

export function ProjectTabBar({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectClose,
  onAddProject,
  className,
  onSettingsClick,
  onRefresh,
  isRefreshing = false,
  showArchived = false,
  onToggleArchived,
  archivedCount = 0
}: ProjectTabBarProps) {
  const { t } = useTranslation(['common', 'tasks']);

  // Keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Cmd/Ctrl + 1-9: Switch to tab N
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < projects.length) {
          onProjectSelect(projects[index].id);
        }
        return;
      }

      // Cmd/Ctrl + Tab: Next tab
      // Cmd/Ctrl + Shift + Tab: Previous tab
      if (e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = projects.findIndex((p) => p.id === activeProjectId);
        if (currentIndex === -1 || projects.length === 0) return;

        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + projects.length) % projects.length
          : (currentIndex + 1) % projects.length;
        onProjectSelect(projects[nextIndex].id);
        return;
      }

      // Cmd/Ctrl + W: Close current tab (only if more than one tab)
      if (e.key === 'w' && activeProjectId && projects.length > 1) {
        e.preventDefault();
        onProjectClose(activeProjectId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projects, activeProjectId, onProjectSelect, onProjectClose]);

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      'flex items-center justify-between border-b border-border bg-background',
      'overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
      className
    )}>
      {/* Left side: Project tabs + Add Project button */}
      <div className="flex items-center gap-2 px-2 min-w-0">
        {projects.map((project, index) => {
          const isActiveTab = activeProjectId === project.id;
          return (
            <SortableProjectTab
              key={project.id}
              project={project}
              isActive={isActiveTab}
              canClose={projects.length > 1}
              tabIndex={index}
              onSelect={() => onProjectSelect(project.id)}
              onClose={(e) => {
                e.stopPropagation();
                onProjectClose(project.id);
              }}
              // Pass control props only for active tab
              onSettingsClick={isActiveTab ? onSettingsClick : undefined}
            />
          );
        })}

        {/* Add project button with tooltip - stays next to tabs */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={onAddProject}
              aria-label={t('common:projectTab.addProjectAriaLabel')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{t('common:projectTab.addNewProject')}</span>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Right side: Auth + Usage indicators + Refresh + Show Archived - anchored to right */}
      <div className="flex items-center gap-2 px-2 flex-shrink-0">
        <AuthStatusIndicator />
        <UsageIndicator />

        {/* Refresh button */}
        {onRefresh && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={onRefresh}
                disabled={isRefreshing}
                aria-label={t('common:accessibility.refreshAriaLabel')}
              >
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>{t('common:projectTab.refreshTasks')}</span>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Show Archived button */}
        {onToggleArchived && archivedCount > 0 && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 relative flex-shrink-0",
                  showArchived
                    ? "text-primary bg-primary/10 hover:bg-primary/20"
                    : "hover:bg-muted-foreground/10 hover:text-muted-foreground"
                )}
                onClick={onToggleArchived}
                aria-pressed={showArchived}
                aria-label={t('common:accessibility.toggleShowArchivedAriaLabel')}
              >
                <Archive className="h-4 w-4" />
                <span className="absolute -top-1 -right-1 text-[10px] font-medium bg-muted rounded-full min-w-[14px] h-[14px] flex items-center justify-center">
                  {archivedCount}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>{showArchived ? t('common:projectTab.hideArchived') : t('common:projectTab.showArchived')}</span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
