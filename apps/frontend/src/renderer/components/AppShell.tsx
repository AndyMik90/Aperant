import { Sidebar } from './Sidebar';
import { TopNavBar } from './TopNavBar';
import { WelcomeScreen } from './WelcomeScreen';
import { ViewSwitcher } from './ViewSwitcher';
import { useNavigationStore } from '../stores/navigation-store';
import { useDialogStore } from '../stores/dialog-store';
import { useProjectStore } from '../stores/project-store';
import { handleProjectTabClose } from '../hooks/useAppEventListeners';

export function AppShell() {
  const activeView = useNavigationStore((state) => state.activeView);
  const setActiveView = useNavigationStore((state) => state.setActiveView);
  const projects = useProjectStore((state) => state.projects);
  const selectedProject = useProjectStore((state) => {
    const id = state.activeProjectId || state.selectedProjectId;
    return state.projects.find((p) => p.id === id);
  });

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
        <main className="flex flex-1 overflow-hidden bg-card shadow-sm shadow-shadow rounded-(--radius) border border-border mt-4">
          {selectedProject ? (
            <div className="flex flex-col h-full w-full">
              <ViewSwitcher projectPath={selectedProject.path} />
            </div>
          ) : (
            <WelcomeScreen
              projects={projects}
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
