import { Sidebar } from './Sidebar';
import { TopNavBar } from './TopNavBar';
import { WelcomeScreen } from './WelcomeScreen';
import { ViewSwitcher } from './ViewSwitcher';
import { useNavigationStore } from '@/stores/navigation-store';
import { useDialogStore } from '@/stores/dialog-store';
import { useProjectStore, selectCurrentProject } from '@/stores/project-store';
import { handleProjectTabClose } from '@/hooks/useAppEventListeners';

export function AppShell() {
  const activeView = useNavigationStore((state) => state.activeView);
  const setActiveView = useNavigationStore((state) => state.setActiveView);
  const projects = useProjectStore((state) => state.projects);
  const selectedProject = useProjectStore(selectCurrentProject);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-sidebar">
      <TopNavBar
        onProjectClose={handleProjectTabClose}
        onAddProject={() => useDialogStore.getState().openAddProjectModal()}
      />
      <div className="flex flex-1 h-full">
        <Sidebar
          onSettingsClick={() => useDialogStore.getState().openSettings()}
          onNewTaskClick={() => useDialogStore.getState().openNewTaskDialog()}
          activeView={activeView}
          onViewChange={setActiveView}
        />
        <main className="flex flex-1 overflow-hidden bg-card shadow-sm shadow-shadow rounded-[var(--radius)] border border-border mt-4">
          {selectedProject ? (
            <div className="flex flex-col h-full w-full">
              <ViewSwitcher projectPath={selectedProject.path} />
            </div>
          ) : (
            <WelcomeScreen
              projects={projects}
              // Both onNewProject and onOpenProject open the same modal intentionally:
              // the AddProjectModal handles both creating new and opening existing projects.
              onNewProject={() => useDialogStore.getState().openAddProjectModal()}
              onOpenProject={() => useDialogStore.getState().openAddProjectModal()}
              onSelectProject={(projectId) => {
                useProjectStore.getState().openProjectTab(projectId);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
