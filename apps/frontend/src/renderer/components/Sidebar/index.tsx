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
import { Button } from '../ui/button';
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
} from '../ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import {
  useProjectStore,
  removeProject,
  initializeProject
} from '../../stores/project-store';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import {
  useProjectEnvStore,
  loadProjectEnvConfig,
  clearProjectEnvConfig
} from '../../stores/project-env-store';
import { AddProjectModal } from '../AddProjectModal';
import { GitSetupModal } from '../GitSetupModal';
import { RateLimitIndicator } from '../RateLimitIndicator';
import { ClaudeCodeStatusBadge } from '../ClaudeCodeStatusBadge';
import { UpdateBanner } from '../UpdateBanner';
import type { Project, GitStatus } from '../../../shared/types';
import { SidebarProps, baseNavItems, githubNavItems, gitlabNavItems } from './constants/types';
import useSidebar from './hooks/useSidebar';

export function Sidebar({
  onSettingsClick,
  onNewTaskClick,
  activeView = 'kanban',
  onViewChange
}: SidebarProps) {
 const {
    showAddProjectModal,
    setShowAddProjectModal,
    showInitDialog,
    setShowInitDialog,
    showGitSetupModal,
    setShowGitSetupModal,
    gitStatus,
    setGitStatus,
    pendingProject,
    t,
    projects,
    selectedProjectId,
    settings,
    visibleNavItems,
    isInitializing,
    handleNavClick,
    handleProjectAdded,
    handleInitialize,
    handleSkipInit,
    handleGitInitialized,
    _handleRemoveProject,
    githubEnabled,
    gitlabEnabled,
    lastLoadedProjectIdRef,
    selectedProject,
 } = useSidebar({
    onSettingsClick, onNewTaskClick, activeView, onViewChange})

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
