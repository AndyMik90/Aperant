import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, AlertCircle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { TaskDetailModal } from './task-detail/TaskDetailModal';
import { TaskCreationWizard } from './TaskCreationWizard';
import { AppSettingsDialog } from './settings/AppSettings';
import { AddProjectModal } from './AddProjectModal';
import { GitHubSetupModal } from './GitHubSetupModal';
import { RateLimitModal } from './RateLimitModal';
import { SDKRateLimitModal } from './SDKRateLimitModal';
import { AuthFailureModal } from './AuthFailureModal';
import { VersionWarningModal } from './VersionWarningModal';
import { OnboardingWizard } from './onboarding';
import { AppUpdateNotification } from './AppUpdateNotification';
import { GlobalDownloadIndicator } from './GlobalDownloadIndicator';
import { Toaster } from './ui/toaster';
import { useNavigationStore } from '@/stores/navigation-store';
import { useDialogStore } from '@/stores/dialog-store';
import { useProjectStore, selectCurrentProjectId } from '@/stores/project-store';
import { removeProject } from '@/stores/project-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  handleInitialize,
  handleGitHubSetupComplete,
  handleProjectAdded,
} from '@/hooks/useAppEventListeners';
import { handleVersionWarningClose } from '@/hooks/useVersionWarning';

export function AppDialogs() {
  const { t } = useTranslation('dialogs');
  const projectId = useProjectStore(selectCurrentProjectId);

  // Navigation store
  const selectedTask = useNavigationStore((state) => state.selectedTask);

  // Dialog store — consolidated with useShallow for referential equality
  const {
    isNewTaskDialogOpen,
    isSettingsDialogOpen,
    settingsInitialSection,
    settingsInitialProjectSection,
    showAddProjectModal,
    showInitDialog,
    pendingProject,
    isInitializing,
    initError,
    initSuccess,
    showGitHubSetup,
    gitHubSetupProject,
    showRemoveProjectDialog,
    removeProjectError,
    projectToRemove,
    isOnboardingWizardOpen,
    isVersionWarningModalOpen,
  } = useDialogStore(useShallow((state) => ({
    isNewTaskDialogOpen: state.isNewTaskDialogOpen,
    isSettingsDialogOpen: state.isSettingsDialogOpen,
    settingsInitialSection: state.settingsInitialSection,
    settingsInitialProjectSection: state.settingsInitialProjectSection,
    showAddProjectModal: state.showAddProjectModal,
    showInitDialog: state.showInitDialog,
    pendingProject: state.pendingProject,
    isInitializing: state.isInitializing,
    initError: state.initError,
    initSuccess: state.initSuccess,
    showGitHubSetup: state.showGitHubSetup,
    gitHubSetupProject: state.gitHubSetupProject,
    showRemoveProjectDialog: state.showRemoveProjectDialog,
    removeProjectError: state.removeProjectError,
    projectToRemove: state.projectToRemove,
    isOnboardingWizardOpen: state.isOnboardingWizardOpen,
    isVersionWarningModalOpen: state.isVersionWarningModalOpen,
  })));

  const settings = useSettingsStore((state) => state.settings);

  return (
    <>
      {/* Task detail modal */}
      <TaskDetailModal
        open={!!selectedTask}
        task={selectedTask}
        onOpenChange={(open) => {
          if (!open) useNavigationStore.getState().clearSelectedTask();
        }}
        onSwitchToTerminals={() => useNavigationStore.getState().setActiveView('terminals')}
        onOpenInbuiltTerminal={(id, cwd) => useNavigationStore.getState().openInbuiltTerminal(id, cwd)}
      />

      {/* Task creation wizard */}
      {projectId && (
        <TaskCreationWizard
          projectId={projectId}
          open={isNewTaskDialogOpen}
          onOpenChange={(open) => {
            if (open) useDialogStore.getState().openNewTaskDialog();
            else useDialogStore.getState().closeNewTaskDialog();
          }}
        />
      )}

      {/* App settings */}
      <AppSettingsDialog
        open={isSettingsDialogOpen}
        onOpenChange={(open) => {
          if (open) useDialogStore.getState().openSettings();
          else useDialogStore.getState().closeSettings();
        }}
        initialSection={settingsInitialSection}
        initialProjectSection={settingsInitialProjectSection}
        onRerunWizard={() => {
          useSettingsStore.getState().updateSettings({ onboardingCompleted: false });
          useDialogStore.getState().closeSettings();
          useDialogStore.getState().openOnboarding();
        }}
      />

      {/* Add Project Modal */}
      <AddProjectModal
        open={showAddProjectModal}
        onOpenChange={(open) => {
          if (open) useDialogStore.getState().openAddProjectModal();
          else useDialogStore.getState().closeAddProjectModal();
        }}
        onProjectAdded={handleProjectAdded}
      />

      {/* Initialize Auto Claude Dialog */}
      <Dialog open={showInitDialog} onOpenChange={(open) => {
        console.debug('[InitDialog] onOpenChange called', { open, pendingProject: !!pendingProject, isInitializing, initSuccess });
        if (!open && pendingProject && !isInitializing && !initSuccess) {
          useDialogStore.getState().skipInit();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('initialize.title')}
            </DialogTitle>
            <DialogDescription>
              {t('initialize.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">{t('initialize.willDo')}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>{t('initialize.createFolder')}</li>
                <li>{t('initialize.copyFramework')}</li>
                <li>{t('initialize.setupSpecs')}</li>
              </ul>
            </div>
            {!settings.autoBuildPath && (
              <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-warning">{t('initialize.sourcePathNotConfigured')}</p>
                    <p className="text-muted-foreground mt-1">
                      {t('initialize.sourcePathNotConfiguredDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {initError && (
              <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-destructive">{t('initialize.initFailed')}</p>
                    <p className="text-muted-foreground mt-1">
                      {initError}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => useDialogStore.getState().skipInit()} disabled={isInitializing}>
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

      {/* GitHub Setup Modal */}
      {gitHubSetupProject && (
        <GitHubSetupModal
          open={showGitHubSetup}
          onOpenChange={(open) => {
            if (!open) useDialogStore.getState().closeGitHubSetup();
          }}
          project={gitHubSetupProject}
          onComplete={handleGitHubSetupComplete}
          onSkip={() => useDialogStore.getState().closeGitHubSetup()}
        />
      )}

      {/* Remove Project Confirmation Dialog */}
      <Dialog open={showRemoveProjectDialog} onOpenChange={(open) => {
        if (!open) useDialogStore.getState().closeRemoveProjectDialog();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('removeProject.title')}</DialogTitle>
            <DialogDescription>
              {t('removeProject.description', { projectName: projectToRemove?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          {removeProjectError && (
            <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{removeProjectError}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => useDialogStore.getState().closeRemoveProjectDialog()}>
              {t('removeProject.cancel')}
            </Button>
            <Button variant="destructive" onClick={async () => {
              if (projectToRemove) {
                try {
                  useDialogStore.getState().setRemoveProjectError(null);
                  await removeProject(projectToRemove.id);
                  useDialogStore.getState().closeRemoveProjectDialog();
                } catch (err) {
                  console.error('[App] Failed to remove project:', err);
                  useDialogStore.getState().setRemoveProjectError(
                    err instanceof Error ? err.message : t('common:errors.unknownError')
                  );
                }
              }
            }}>
              {t('removeProject.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate Limit Modal */}
      <RateLimitModal />

      {/* SDK Rate Limit Modal */}
      <SDKRateLimitModal />

      {/* Auth Failure Modal */}
      <AuthFailureModal onOpenSettings={() => {
        useDialogStore.getState().openSettings('accounts');
      }} />

      {/* Version Warning Modal */}
      <VersionWarningModal
        isOpen={isVersionWarningModalOpen}
        onClose={handleVersionWarningClose}
        onOpenSettings={() => {
          handleVersionWarningClose();
          useDialogStore.getState().openSettings('accounts');
        }}
      />

      {/* Onboarding Wizard */}
      <OnboardingWizard
        open={isOnboardingWizardOpen}
        onOpenChange={(open) => {
          if (open) useDialogStore.getState().openOnboarding();
          else useDialogStore.getState().closeOnboarding();
        }}
        onOpenTaskCreator={() => {
          useDialogStore.getState().closeOnboarding();
          useDialogStore.getState().openNewTaskDialog();
        }}
        onOpenSettings={() => {
          useDialogStore.getState().closeOnboarding();
          useDialogStore.getState().openSettings();
        }}
      />

      {/* App Update Notification */}
      <AppUpdateNotification />

      {/* Global Download Indicator */}
      <GlobalDownloadIndicator />

      {/* Toast notifications */}
      <Toaster />
    </>
  );
}
