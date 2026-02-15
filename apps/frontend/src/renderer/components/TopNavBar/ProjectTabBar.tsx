import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SortableProjectTab } from './SortableProjectTab';
import { UsageIndicator } from '@/components/UsageIndicator';
import { AuthStatusIndicator } from '@/components/AuthStatusIndicator';
import type { Project } from '@shared/types';

interface ProjectTabBarProps {
  projects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectClose: (projectId: string) => void;
  onAddProject: () => void;
  className?: string;
}

export function ProjectTabBar({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectClose,
  onAddProject,
  className
}: ProjectTabBarProps) {
  const { t } = useTranslation('common');

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
      'flex items-center gap-1.5',
      'overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
      'px-1',
      className
    )}>
      {/* Project pills */}
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
          />
        );
      })}

      {/* Spacer */}
      <div className="flex-1 min-w-4" />

      {/* Separator before status indicators */}
      <div className="h-4 w-px shrink-0 bg-border mx-1" />

      {/* Status indicators and actions */}
      <div className="electron-no-drag"><AuthStatusIndicator /></div>
      <div className="electron-no-drag"><UsageIndicator /></div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full shrink-0 electron-no-drag"
        onClick={onAddProject}
        aria-label={t('projectTab.addProjectAriaLabel')}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
