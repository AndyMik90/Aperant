import {
  Plus,
  Settings,
  HelpCircle,
  Heart,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { GitSetupModal } from '../GitSetupModal';
import { RateLimitIndicator } from '../RateLimitIndicator';
import { ClaudeCodeStatusBadge } from '../ClaudeCodeStatusBadge';
import { UpdateBanner } from '../UpdateBanner';
import { SidebarProps, type NavItem } from './constants/types';
export type { SidebarView } from './constants/types';
import useSidebar from './hooks/useSidebar';

export function Sidebar({
  onSettingsClick,
  onNewTaskClick,
  activeView = 'kanban',
  onViewChange
}: SidebarProps) {
 const {
    showGitSetupModal,
    setShowGitSetupModal,
    gitStatus,
    t,
    selectedProjectId,
    visibleNavItems,
    handleNavClick,
    handleGitInitialized,
    selectedProject,
    isCollapsed,
    toggleSidebar,
 } = useSidebar({
    onSettingsClick, onNewTaskClick, activeView, onViewChange})

  const renderNavItem = (item: NavItem) => {
    const isActive = activeView === item.id;
    const Icon = item.icon;

    const button = (
      <button
        type="button"
        key={item.id}
        onClick={() => handleNavClick(item.id)}
        disabled={!selectedProjectId}
        aria-keyshortcuts={item.shortcut}
        className={cn(
          'flex w-full items-center rounded-lg text-sm transition-all duration-200 whitespace-nowrap overflow-hidden',
          'hover:bg-accent hover:text-accent-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
          isActive && 'bg-accent text-accent-foreground',
          isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!isCollapsed && (
          <>
            <span className="flex-1 text-left">{t(item.labelKey)}</span>
            {item.shortcut && (
              <Badge variant="muted" className="pointer-events-none hidden h-5 select-none items-center px-1.5 font-mono text-[10px] font-medium sm:flex shrink-0">
                {item.shortcut}
              </Badge>
            )}
          </>
        )}
      </button>
    );

    // Wrap in tooltip when collapsed
    if (isCollapsed) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">
            <span>{t(item.labelKey)}</span>
            {item.shortcut && (
              <Badge variant="muted" className="ml-2 px-1 font-mono text-[10px]">
                {item.shortcut}
              </Badge>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return button;
  };

  return (
    <>
      <div className={cn(
        "flex h-full flex-col bg-sidebar transition-all duration-300 overflow-hidden",
        isCollapsed ? "w-16" : "w-64"
      )}>
        {/* Drag region for macOS traffic lights */}
        {window.platform?.isMacOS && <div className="electron-drag h-6 shrink-0" />}

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <div className={cn("py-4 transition-all duration-300", isCollapsed ? "px-2" : "px-3")}>
            {/* Section header with toggle */}
            <div className={cn(
              "flex flex-row items-center whitespace-nowrap mb-1",
              isCollapsed ? "justify-center px-2" : "justify-between px-3"
            )}>
              {!isCollapsed && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('sections.project')}
                </h3>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center justify-center rounded-lg electron-no-drag shrink-0 transition-all duration-200",
                      "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
                      isCollapsed ? "h-9 w-9 p-2.5" : "h-7 w-7 p-1.5"
                    )}
                    onClick={toggleSidebar}
                    aria-label={isCollapsed ? t('actions.expandSidebar') : t('actions.collapseSidebar')}
                  >
                    {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isCollapsed ? t('actions.expandSidebar') : t('actions.collapseSidebar')}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Nav items */}
            <nav className="space-y-1">
              {visibleNavItems.map(renderNavItem)}
            </nav>
          </div>
        </ScrollArea>

        <Separator />

        {/* Rate Limit Indicator - shows when Claude is rate limited */}
        <RateLimitIndicator />

        {/* Update Banner - shows when app update is available */}
        <UpdateBanner />

        {/* Bottom section with Settings, Help, and New Task */}
        <div className={cn("space-y-3 transition-all duration-300 whitespace-nowrap", isCollapsed ? "p-2" : "p-4")}>
          {/* Claude Code Status Badge */}
          {!isCollapsed && <ClaudeCodeStatusBadge />}

          {/* Settings and Help row */}
          <div className={cn(
            "flex items-center overflow-hidden",
            isCollapsed ? "flex-col gap-1" : "gap-2"
          )}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size={isCollapsed ? "icon" : "sm"}
                  className={cn("shrink-0", !isCollapsed && "flex-1 justify-start gap-2 overflow-hidden")}
                  onClick={onSettingsClick}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  {!isCollapsed && <span className="truncate">{t('actions.settings')}</span>}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? "right" : "top"}>{t('tooltips.settings')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => window.open('https://github.com/AndyMik90/Auto-Claude/issues', '_blank')}
                  aria-label={t('tooltips.help')}
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isCollapsed ? "right" : "top"}>{t('tooltips.help')}</TooltipContent>
            </Tooltip>
          </div>

          {/* Sponsor link */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => window.open('https://github.com/sponsors/AndyMik90', '_blank')}
                className={cn(
                  'flex w-full items-center text-xs transition-colors',
                  'text-amber-500/70 hover:text-amber-400',
                  isCollapsed ? 'justify-center' : 'gap-1.5 px-3'
                )}
              >
                <Heart className="h-3.5 w-3.5" />
                {!isCollapsed && <span>{t('actions.sponsor')}</span>}
              </button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">{t('actions.sponsor')}</TooltipContent>
            )}
          </Tooltip>

          {/* New Task button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="w-full overflow-hidden"
                size={isCollapsed ? "icon" : "default"}
                onClick={onNewTaskClick}
                disabled={!selectedProjectId || !selectedProject?.autoBuildPath}
              >
                <Plus className={cn("h-4 w-4 shrink-0", !isCollapsed && "mr-2")} />
                {!isCollapsed && <span className="truncate">{t('actions.newTask')}</span>}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">{t('actions.newTask')}</TooltipContent>
            )}
          </Tooltip>

          {/* Init message - hidden when collapsed */}
          {!isCollapsed && selectedProject && !selectedProject.autoBuildPath && (
            <p className="mt-2 text-xs text-muted-foreground text-center whitespace-normal">
              {t('messages.initializeToCreateTasks')}
            </p>
          )}
        </div>
      </div>

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
