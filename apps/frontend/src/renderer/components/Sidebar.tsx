import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Settings,
  LayoutGrid,
  Terminal,
  Compass,
  BookOpen,
  AlertCircle,
  Download,
  RefreshCw,
  Github,
  GitlabIcon,
  GitMerge,
  FileText,
  MessageSquare,
  HelpCircle,
  AlertTriangle
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { cn } from '../lib/utils';
import {
  useProjectStore,
  removeProject,
  initializeProject
} from '../stores/project-store';
import { useSettingsStore } from '../stores/settings-store';
import { useRateLimitStore } from '../stores/rate-limit-store';
import { AddProjectModal } from './AddProjectModal';
import { GitSetupModal } from './GitSetupModal';
import type { Project, GitStatus, ProjectEnvConfig } from '../../shared/types';

export type SidebarView = 'kanban' | 'terminals' | 'discovery' | 'context' | 'github' | 'gitlab-issues' | 'gitlab-merge-requests' | 'changelog' | 'insights' | 'worktrees' | 'repository';

interface SidebarProps {
  onSettingsClick: () => void;
  onNewTaskClick: () => void;
  activeView?: SidebarView;
  onViewChange?: (view: SidebarView) => void;
}

interface NavItem {
  id: SidebarView;
  labelKey: string;
  icon: React.ElementType;
  shortcut?: string;
  section: 'main' | 'github' | 'gitlab';
}

// UI-6: Activity bar style navigation - icon only with tooltips
const navItems: NavItem[] = [
  { id: 'insights', labelKey: 'navigation:items.insights', icon: MessageSquare, shortcut: 'N', section: 'main' },
  { id: 'kanban', labelKey: 'navigation:items.kanban', icon: LayoutGrid, shortcut: 'K', section: 'main' },
  { id: 'terminals', labelKey: 'navigation:items.terminals', icon: Terminal, shortcut: 'A', section: 'main' },
  { id: 'repository', labelKey: 'navigation:items.repository', icon: BookOpen, shortcut: 'R', section: 'main' },
  { id: 'discovery', labelKey: 'navigation:items.discovery', icon: Compass, shortcut: 'D', section: 'main' },
  { id: 'changelog', labelKey: 'navigation:items.changelog', icon: FileText, shortcut: 'L', section: 'main' },
  // GitHub item (always visible - can help set up repo)
  { id: 'github', labelKey: 'navigation:items.github', icon: Github, shortcut: 'G', section: 'main' },
  // GitLab items
  { id: 'gitlab-issues', labelKey: 'navigation:items.gitlabIssues', icon: GitlabIcon, shortcut: 'B', section: 'gitlab' },
  { id: 'gitlab-merge-requests', labelKey: 'navigation:items.gitlabMRs', icon: GitMerge, section: 'gitlab' }
];

export function Sidebar({
  onSettingsClick,
  onNewTaskClick,
  activeView = 'kanban',
  onViewChange
}: SidebarProps) {
  const { t } = useTranslation(['navigation', 'dialogs', 'common']);
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const settings = useSettingsStore((state) => state.settings);

  // Rate limit state
  const hasPendingRateLimit = useRateLimitStore((state) => state.hasPendingRateLimit);
  const reopenRateLimitModal = useRateLimitStore((state) => state.reopenRateLimitModal);

  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [showGitSetupModal, setShowGitSetupModal] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [envConfig, setEnvConfig] = useState<ProjectEnvConfig | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Load env config when project changes to check GitHub/GitLab enabled state
  useEffect(() => {
    const loadEnvConfig = async () => {
      if (selectedProject?.autoBuildPath) {
        try {
          const result = await window.electronAPI.getProjectEnv(selectedProject.id);
          if (result.success && result.data) {
            setEnvConfig(result.data);
          } else {
            setEnvConfig(null);
          }
        } catch {
          setEnvConfig(null);
        }
      } else {
        setEnvConfig(null);
      }
    };
    loadEnvConfig();
  }, [selectedProject?.id, selectedProject?.autoBuildPath]);

  // Filter visible nav items based on GitHub/GitLab enabled state
  const visibleNavItems = useMemo(() => {
    return navItems.filter((item) => {
      if (item.section === 'github') {
        return envConfig?.githubEnabled;
      }
      if (item.section === 'gitlab') {
        return envConfig?.gitlabEnabled;
      }
      return true;
    });
  }, [envConfig?.githubEnabled, envConfig?.gitlabEnabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Only handle shortcuts when a project is selected
      if (!selectedProjectId) return;

      // Check for modifier keys - we want plain key presses only
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();

      // Find matching nav item from visible items only
      const matchedItem = visibleNavItems.find((item) => item.shortcut === key);

      if (matchedItem) {
        e.preventDefault();
        onViewChange?.(matchedItem.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProjectId, onViewChange, visibleNavItems]);

  // Check git status when project changes
  useEffect(() => {
    const checkGit = async () => {
      if (selectedProject) {
        try {
          const result = await window.electronAPI.checkGitStatus(selectedProject.path);
          if (result.success && result.data) {
            setGitStatus(result.data);
            // Show git setup modal if project is not a git repo or has no commits
            if (!result.data.isGitRepo || !result.data.hasCommits) {
              setShowGitSetupModal(true);
            }
          }
        } catch (error) {
          console.error('Failed to check git status:', error);
        }
      } else {
        setGitStatus(null);
      }
    };
    checkGit();
  }, [selectedProject]);

  const handleProjectAdded = (project: Project, needsInit: boolean) => {
    if (needsInit) {
      setPendingProject(project);
      setShowInitDialog(true);
    }
  };

  const handleInitialize = async () => {
    if (!pendingProject) return;

    const projectId = pendingProject.id;
    setIsInitializing(true);
    try {
      const result = await initializeProject(projectId);
      if (result?.success) {
        setPendingProject(null);
        setShowInitDialog(false);
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSkipInit = () => {
    setShowInitDialog(false);
    setPendingProject(null);
  };

  const handleGitInitialized = async () => {
    if (selectedProject) {
      try {
        const result = await window.electronAPI.checkGitStatus(selectedProject.path);
        if (result.success && result.data) {
          setGitStatus(result.data);
        }
      } catch (error) {
        console.error('Failed to refresh git status:', error);
      }
    }
  };

  const handleNavClick = (view: SidebarView) => {
    onViewChange?.(view);
  };

  // UI-6: Activity bar style render
  const renderNavItem = (item: NavItem) => {
    const isActive = activeView === item.id;
    const Icon = item.icon;

    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleNavClick(item.id)}
            disabled={!selectedProjectId}
            className={cn(
              'flex h-11 w-full items-center justify-center transition-all duration-200',
              'hover:text-[var(--glow-cyan)]',
              'disabled:pointer-events-none disabled:opacity-50',
              'border-l-2 border-transparent',
              isActive && 'text-[var(--glow-cyan)] border-l-[var(--glow-cyan)]'
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <span>{t(item.labelKey)}</span>
          {item.shortcut && (
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium">
              {item.shortcut}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      {/* UI-6: VS Code style activity bar - 48px wide icon-only navigation */}
      <div className="flex h-full w-12 flex-col bg-sidebar border-r border-border">
        {/* Main navigation items */}
        <div className="flex flex-col pt-2">
          {visibleNavItems.map(renderNavItem)}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Rate Limit Indicator - compact icon */}
        {hasPendingRateLimit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={reopenRateLimitModal}
                className="flex h-10 w-full items-center justify-center text-warning hover:bg-warning/10 transition-colors"
              >
                <AlertTriangle className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t('common:rateLimit.title')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Bottom section */}
        <div className="flex flex-col items-center py-2 space-y-1 border-t border-border">
          {/* New Task button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onNewTaskClick}
                disabled={!selectedProjectId || !selectedProject?.autoBuildPath}
                className="h-10 w-10"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t('actions.newTask')}
            </TooltipContent>
          </Tooltip>

          {/* Settings button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSettingsClick}
                className="h-10 w-10"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t('tooltips.settings')}
            </TooltipContent>
          </Tooltip>

          {/* Help button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.open('https://github.com/AndyMik90/Auto-Claude/issues', '_blank')}
                className="h-10 w-10"
              >
                <HelpCircle className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t('tooltips.help')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Initialize Jerry Dialog */}
      <Dialog open={showInitDialog} onOpenChange={(open) => {
        if (!open && !isInitializing) {
          handleSkipInit();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('dialogs:initialize.title')}
            </DialogTitle>
            <DialogDescription>
              {t('dialogs:initialize.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">{t('dialogs:initialize.willDo')}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>{t('dialogs:initialize.createFolder')}</li>
                <li>{t('dialogs:initialize.copyFramework')}</li>
                <li>{t('dialogs:initialize.setupSpecs')}</li>
              </ul>
            </div>
            {!settings.autoBuildPath && (
              <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-warning">{t('dialogs:initialize.sourcePathNotConfigured')}</p>
                    <p className="text-muted-foreground mt-1">
                      {t('dialogs:initialize.sourcePathNotConfiguredDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSkipInit} disabled={isInitializing}>
              {t('common:buttons.skip')}
            </Button>
            <Button
              onClick={handleInitialize}
              disabled={isInitializing || !settings.autoBuildPath}
            >
              {isInitializing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('common:labels.initializing')}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t('common:buttons.initialize')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Project Modal */}
      <AddProjectModal
        open={showAddProjectModal}
        onOpenChange={setShowAddProjectModal}
        onProjectAdded={handleProjectAdded}
      />

      {/* Git Setup Modal */}
      <GitSetupModal
        open={showGitSetupModal}
        onOpenChange={setShowGitSetupModal}
        project={selectedProject || null}
        gitStatus={gitStatus}
        onGitInitialized={handleGitInitialized}
      />
    </TooltipProvider>
  );
}
