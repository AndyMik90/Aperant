import { TooltipProvider } from './components/ui/tooltip';
import { ProactiveSwapListener } from './components/ProactiveSwapListener';
import { AppShell } from './components/AppShell';
import { AppDialogs } from './components/AppDialogs';
import { ViewStateProvider } from './contexts/ViewStateContext';
import { useIpcListeners } from './hooks/useIpc';
import { useGlobalTerminalListeners } from './hooks/useGlobalTerminalListeners';
import { useTerminalProfileChange } from './hooks/useTerminalProfileChange';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useAppTheme } from './hooks/useAppTheme';
import { useAppEventListeners } from './hooks/useAppEventListeners';
import { useOnboardingDetection } from './hooks/useOnboardingDetection';
import { useVersionWarning } from './hooks/useVersionWarning';
import { useTaskSync } from './hooks/useTaskSync';

export function App() {
  // Core IPC and terminal listeners
  useIpcListeners();
  useGlobalTerminalListeners();
  useTerminalProfileChange();

  // App initialization (load projects, settings, tabs, tasks)
  const { settingsHaveLoaded } = useAppInitialization();

  // Theme, language, UI scale, spellcheck
  useAppTheme();

  // Event listeners (custom events, keyboard shortcuts, update listener)
  useAppEventListeners();

  // First-run onboarding and version warnings
  useOnboardingDetection(settingsHaveLoaded);
  useVersionWarning(settingsHaveLoaded);

  // Keep selectedTask in sync with task-store updates
  useTaskSync();

  return (
    <ViewStateProvider>
      <TooltipProvider>
        <ProactiveSwapListener />
        <AppShell />
      </TooltipProvider>
      <AppDialogs />
    </ViewStateProvider>
  );
}
