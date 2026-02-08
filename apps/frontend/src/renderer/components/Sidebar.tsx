import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Settings,
  LayoutGrid,
  Terminal,
  Map,
  BookOpen,
  Lightbulb,
  AlertCircle,
  Download,
  RefreshCw,
  Github,
  GitlabIcon,
  GitPullRequest,
  GitMerge,
  FileText,
  Sparkles,
  GitBranch,
  HelpCircle,
  Wrench,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from './ui/sidebar';
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
import { useSettingsStore, saveSettings } from '../stores/settings-store';
import {
  useProjectEnvStore,
  loadProjectEnvConfig,
  clearProjectEnvConfig
} from '../stores/project-env-store';
import { AddProjectModal } from './AddProjectModal';
import { GitSetupModal } from './GitSetupModal';
import { RateLimitIndicator } from './RateLimitIndicator';
import { ClaudeCodeStatusBadge } from './ClaudeCodeStatusBadge';
import { UpdateBanner } from './UpdateBanner';
import type { Project, GitStatus } from '../../shared/types';

export type SidebarView = 'kanban' | 'terminals' | 'roadmap' | 'context' | 'ideation' | 'github-issues' | 'gitlab-issues' | 'github-prs' | 'gitlab-merge-requests' | 'changelog' | 'insights' | 'worktrees' | 'agent-tools';

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
}

// Base nav items always shown
const baseNavItems: NavItem[] = [
  { id: 'kanban', labelKey: 'navigation:items.kanban', icon: LayoutGrid, shortcut: 'K' },
  { id: 'terminals', labelKey: 'navigation:items.terminals', icon: Terminal, shortcut: 'A' },
  { id: 'insights', labelKey: 'navigation:items.insights', icon: Sparkles, shortcut: 'N' },
  { id: 'roadmap', labelKey: 'navigation:items.roadmap', icon: Map, shortcut: 'D' },
  { id: 'ideation', labelKey: 'navigation:items.ideation', icon: Lightbulb, shortcut: 'I' },
  { id: 'changelog', labelKey: 'navigation:items.changelog', icon: FileText, shortcut: 'L' },
  { id: 'context', labelKey: 'navigation:items.context', icon: BookOpen, shortcut: 'C' },
  { id: 'agent-tools', labelKey: 'navigation:items.agentTools', icon: Wrench, shortcut: 'M' },
  { id: 'worktrees', labelKey: 'navigation:items.worktrees', icon: GitBranch, shortcut: 'W' }
];

// GitHub nav items shown when GitHub is enabled
const githubNavItems: NavItem[] = [
  { id: 'github-issues', labelKey: 'navigation:items.githubIssues', icon: Github, shortcut: 'G' },
  { id: 'github-prs', labelKey: 'navigation:items.githubPRs', icon: GitPullRequest, shortcut: 'P' }
];

// GitLab nav items shown when GitLab is enabled
const gitlabNavItems: NavItem[] = [
  { id: 'gitlab-issues', labelKey: 'navigation:items.gitlabIssues', icon: GitlabIcon, shortcut: 'B' },
  { id: 'gitlab-merge-requests', labelKey: 'navigation:items.gitlabMRs', icon: GitMerge, shortcut: 'R' }
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

  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [showGitSetupModal, setShowGitSetupModal] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Subscribe to project-env-store for reactive GitHub/GitLab tab visibility
  const githubEnabled = useProjectEnvStore((state) => state.envConfig?.githubEnabled ?? false);
  const gitlabEnabled = useProjectEnvStore((state) => state.envConfig?.gitlabEnabled ?? false);

  // Track the last loaded project ID to avoid redundant loads
  const lastLoadedProjectIdRef = useRef<string | null>(null);

  // Compute visible nav items based on GitHub/GitLab enabled state from store
  const visibleNavItems = useMemo(() => {
    const items = [...baseNavItems];

    if (githubEnabled) {
      items.push(...githubNavItems);
    }

    if (gitlabEnabled) {
      items.push(...gitlabNavItems);
    }

    return items;
  }, [githubEnabled, gitlabEnabled]);

  // Load envConfig when project changes to ensure store is populated
  useEffect(() => {
    // Track whether this effect is still current (for race condition handling)
    let isCurrent = true;

    const initializeEnvConfig = async () => {
      if (selectedProject?.id && selectedProject?.autoBuildPath) {
        // Only reload if the project ID differs from what we last loaded
        if (selectedProject.id !== lastLoadedProjectIdRef.current) {
          lastLoadedProjectIdRef.current = selectedProject.id;
          await loadProjectEnvConfig(selectedProject.id);
          // Check if this effect was cancelled while loading
          if (!isCurrent) return;
        }
      } else {
        // Clear the store if no project is selected or has no autoBuildPath
        lastLoadedProjectIdRef.current = null;
        clearProjectEnvConfig();
      }
    };
    initializeEnvConfig();

    // Cleanup function to mark this effect as stale
    return () => {
      isCurrent = false;
    };
  }, [selectedProject?.id, selectedProject?.autoBuildPath]);

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
        // Clear pendingProject FIRST before closing dialog
        // This prevents onOpenChange from triggering skip logic
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
    // Refresh git status after initialization
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

  const _handleRemoveProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await removeProject(projectId);
  };

  const handleNavClick = (view: SidebarView) => {
    onViewChange?.(view);
  };

  return (
    <>
      <SidebarPrimitive collapsible="icon">
        {/* Drag region for macOS traffic lights */}
        <div className="electron-drag h-6 shrink-0" />

        {/* Navigation */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>
              {t('sections.project')}
              <SidebarTrigger className="electron-no-drag ml-auto" />
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={activeView === item.id}
                        onClick={() => handleNavClick(item.id)}
                        tooltip={t(item.labelKey)}
                        disabled={!selectedProjectId}
                        aria-keyshortcuts={item.shortcut}
                      >
                        <Icon />
                        <span>{t(item.labelKey)}</span>
                        {item.shortcut && (
                          <kbd className="ml-auto pointer-events-none hidden select-none rounded-md border border-sidebar-border px-1.5 font-mono text-[10px] font-medium text-sidebar-foreground/70 sm:inline-block">
                            {item.shortcut}
                          </kbd>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />

        {/* Footer section */}
        <SidebarFooter>
          {/* Rate Limit Indicator - shows when Claude is rate limited */}
          <RateLimitIndicator />

          {/* Update Banner - shows when app update is available */}
          <UpdateBanner />

          {/* Claude Code Status Badge - hidden when collapsed */}
          <div className="group-data-[collapsible=icon]:hidden">
            <ClaudeCodeStatusBadge />
          </div>

          {/* Settings and Help */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onSettingsClick}
                tooltip={t('tooltips.settings')}
              >
                <Settings />
                <span>{t('actions.settings')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => window.open('https://github.com/AndyMik90/Auto-Claude/issues', '_blank')}
                tooltip={t('tooltips.help')}
              >
                <HelpCircle />
                <span>{t('tooltips.help')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* New Task button */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className={cn(
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                  'active:bg-primary/80'
                )}
                onClick={onNewTaskClick}
                disabled={!selectedProjectId || !selectedProject?.autoBuildPath}
                tooltip={t('actions.newTask')}
              >
                <Plus />
                <span>{t('actions.newTask')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Init message when collapsed state hides it */}
          <div className="group-data-[collapsible=icon]:hidden">
            {selectedProject && !selectedProject.autoBuildPath && (
              <p className="px-2 text-xs text-muted-foreground text-center">
                {t('messages.initializeToCreateTasks')}
              </p>
            )}
          </div>
        </SidebarFooter>

        <SidebarRail />
      </SidebarPrimitive>

      {/* Initialize Auto Claude Dialog */}
      <Dialog open={showInitDialog} onOpenChange={(open) => {
        // Only allow closing if user manually closes (not during initialization)
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
    </>
  );
}
