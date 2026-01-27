import { FolderOpen, FolderPlus, Clock, ChevronRight, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import type { Project } from '../../shared/types';

interface WelcomeScreenProps {
  projects: Project[];
  onNewProject: () => void;
  onOpenProject: () => void;
  onSelectProject: (projectId: string) => void;
}

export function WelcomeScreen({
  projects,
  onNewProject,
  onOpenProject,
  onSelectProject
}: WelcomeScreenProps) {
  const { t } = useTranslation(['welcome', 'common']);

  // Sort projects by updatedAt (most recent first)
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('common:time.justNow');
    if (diffMins < 60) return t('common:time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('common:time.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('common:time.daysAgo', { count: diffDays });
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Hero Section */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {t('welcome:hero.title')}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {t('welcome:hero.subtitle')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center mb-10">
          <Button
            size="lg"
            onClick={onNewProject}
            className="gap-2 px-6"
          >
            <FolderPlus className="h-5 w-5" />
            {t('welcome:actions.newProject')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={onOpenProject}
            className="gap-2 px-6"
          >
            <FolderOpen className="h-5 w-5" />
            {t('welcome:actions.openProject')}
          </Button>
        </div>

        {/* Recent Projects Section */}
        {recentProjects.length > 0 && (
          <Card className="border border-border bg-card/50 backdrop-blur-sm">
            <div className="p-4 pb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                {t('welcome:recentProjects.title')}
              </div>
            </div>
            <Separator />
            <ScrollArea className="max-h-[320px]">
              <div className="p-2">
                {recentProjects.map((project, _index) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/50 group"
                    aria-label={t('welcome:recentProjects.openProjectAriaLabel', { name: project.name })}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground shrink-0">
                      <Folder className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {project.name}
                        </span>
                        {project.autoBuildPath && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/20 text-success shrink-0">
                            {t('welcome:recentProjects.initialized')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {project.path}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(project.updatedAt)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </Card>
        )}

        {/* Empty State for No Projects */}
        {projects.length === 0 && (
          <Card className="border border-dashed border-border bg-card/30 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 mx-auto mb-4">
              <Folder className="h-6 w-6 text-accent-foreground" />
            </div>
            <h3 className="font-medium text-foreground mb-1">{t('welcome:recentProjects.empty')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('welcome:recentProjects.emptyDescription')}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
