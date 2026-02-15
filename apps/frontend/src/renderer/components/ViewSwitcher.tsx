import { useCallback } from 'react';
import { ErrorBoundary } from './ui/error-boundary';
import { KanbanBoard } from './KanbanBoard';
import { TerminalGrid } from './TerminalGrid';
import { Roadmap } from './Roadmap';
import { Context } from './Context';
import { Ideation } from './Ideation';
import { Insights } from './Insights';
import { GitHubIssues } from './GitHubIssues';
import { GitLabIssues } from './GitLabIssues';
import { GitHubPRs } from './github-prs';
import { GitLabMergeRequests } from './gitlab-merge-requests';
import { Changelog } from './Changelog';
import { Worktrees } from './Worktrees';
import { AgentTools } from './AgentTools';
import { useNavigationStore } from '../stores/navigation-store';
import { useDialogStore } from '../stores/dialog-store';
import { useProjectStore, selectCurrentProjectId } from '../stores/project-store';
import { useTaskStore } from '../stores/task-store';
import type { Task } from '@shared/types';
import type { SidebarView } from '@shared/types/settings';

interface ViewConfig {
  id: SidebarView;
  component: React.ComponentType<{ projectPath?: string; isActive?: boolean }>;
  alwaysMounted?: boolean;
  requiresProject?: boolean;
}

const VIEW_REGISTRY: ViewConfig[] = [
  { id: 'kanban', component: KanbanView, requiresProject: true },
  { id: 'terminals', component: TerminalView, alwaysMounted: true, requiresProject: true },
  { id: 'roadmap', component: RoadmapView, requiresProject: true },
  { id: 'context', component: ContextView, requiresProject: true },
  { id: 'ideation', component: IdeationView, requiresProject: true },
  { id: 'insights', component: InsightsView, requiresProject: true },
  { id: 'github-issues', component: GitHubIssuesView, requiresProject: true },
  { id: 'gitlab-issues', component: GitLabIssuesView, requiresProject: true },
  { id: 'github-prs', component: GitHubPRsView, alwaysMounted: true, requiresProject: true },
  { id: 'gitlab-merge-requests', component: GitLabMergeRequestsView, requiresProject: true },
  { id: 'changelog', component: ChangelogView, requiresProject: true },
  { id: 'worktrees', component: WorktreesView, requiresProject: true },
  { id: 'agent-tools', component: AgentTools },
];

export function ViewSwitcher({ projectPath }: { projectPath?: string }) {
  const activeView = useNavigationStore((state) => state.activeView);
  const projectId = useProjectStore(selectCurrentProjectId);

  return (
    <>
      {VIEW_REGISTRY.map((config) => {
        if (config.requiresProject && !projectId) return null;

        if (config.alwaysMounted) {
          return (
            <div key={config.id} className={activeView === config.id ? 'h-full' : 'hidden'}>
              <config.component projectPath={projectPath} isActive={activeView === config.id} />
            </div>
          );
        }

        if (activeView !== config.id) return null;

        return <config.component key={config.id} />;
      })}
    </>
  );
}

// --- Thin wrapper components ---
// Each reads its own props from stores, keeping ViewSwitcher clean.

function KanbanView() {
  const tasks = useTaskStore((state) => state.tasks);
  const isRefreshingTasks = useNavigationStore((state) => state.isRefreshingTasks);

  const handleTaskClick = useCallback((task: Task) => {
    useNavigationStore.getState().setSelectedTask(task);
  }, []);

  const handleRefreshTasks = useCallback(() => {
    useNavigationStore.getState().refreshTasks();
  }, []);

  const handleCloseTaskDetail = useCallback(() => {
    useDialogStore.getState().openNewTaskDialog();
  }, []);

  return (
    <KanbanBoard
      tasks={tasks}
      onTaskClick={handleTaskClick}
      onNewTaskClick={handleCloseTaskDetail}
      onRefresh={handleRefreshTasks}
      isRefreshing={isRefreshingTasks}
    />
  );
}

function TerminalView({ projectPath, isActive = false }: { projectPath?: string; isActive?: boolean }) {
  return (
    <TerminalGrid
      projectPath={projectPath}
      onNewTaskClick={() => useDialogStore.getState().openNewTaskDialog()}
      isActive={isActive}
    />
  );
}

function RoadmapView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return <Roadmap projectId={projectId} onGoToTask={(id) => useNavigationStore.getState().goToTask(id)} />;
}

function ContextView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return (
    <ErrorBoundary>
      <Context projectId={projectId} />
    </ErrorBoundary>
  );
}

function IdeationView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return <Ideation projectId={projectId} onGoToTask={(id) => useNavigationStore.getState().goToTask(id)} />;
}

function InsightsView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return <Insights projectId={projectId} />;
}

function GitHubIssuesView() {
  return (
    <GitHubIssues
      onOpenSettings={() => useDialogStore.getState().openSettings(undefined, 'github')}
      onNavigateToTask={(id) => useNavigationStore.getState().goToTask(id)}
    />
  );
}

function GitLabIssuesView() {
  return (
    <GitLabIssues
      onOpenSettings={() => useDialogStore.getState().openSettings(undefined, 'gitlab')}
      onNavigateToTask={(id) => useNavigationStore.getState().goToTask(id)}
    />
  );
}

function GitHubPRsView({ isActive = false }: { isActive?: boolean }) {
  return (
    <GitHubPRs
      onOpenSettings={() => useDialogStore.getState().openSettings(undefined, 'github')}
      isActive={isActive}
    />
  );
}

function GitLabMergeRequestsView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return (
    <GitLabMergeRequests
      projectId={projectId}
      onOpenSettings={() => useDialogStore.getState().openSettings(undefined, 'gitlab')}
    />
  );
}

function ChangelogView() {
  return <Changelog />;
}

function WorktreesView() {
  const projectId = useProjectStore(selectCurrentProjectId);
  if (!projectId) return null;
  return <Worktrees projectId={projectId} />;
}
