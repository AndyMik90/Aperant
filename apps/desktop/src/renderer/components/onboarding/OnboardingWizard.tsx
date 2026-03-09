import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2 } from 'lucide-react';
import {
  FullScreenDialog,
  FullScreenDialogContent,
  FullScreenDialogHeader,
  FullScreenDialogBody,
  FullScreenDialogTitle,
  FullScreenDialogDescription
} from '../ui/full-screen-dialog';
import { ScrollArea } from '../ui/scroll-area';
import { WizardProgress, WizardStep } from './WizardProgress';
import { WelcomeStep } from './WelcomeStep';
import { AccountsStep } from './AccountsStep';
import { DevToolsStep } from './DevToolsStep';
import { PrivacyStep } from './PrivacyStep';
import { MemoryStep } from './MemoryStep';
import { CompletionStep } from './CompletionStep';
import { useSettingsStore } from '../../stores/settings-store';

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTaskCreator?: () => void;
  onOpenSettings?: () => void;
}

// Wizard step identifiers
type WizardStepId = 'welcome' | 'accounts' | 'devtools' | 'privacy' | 'memory' | 'completion';

// Step configuration with translation keys
const WIZARD_STEPS: { id: WizardStepId; labelKey: string }[] = [
  { id: 'welcome', labelKey: 'steps.welcome' },
  { id: 'accounts', labelKey: 'steps.accounts' },
  { id: 'devtools', labelKey: 'steps.devtools' },
  { id: 'privacy', labelKey: 'steps.privacy' },
  { id: 'memory', labelKey: 'steps.memory' },
  { id: 'completion', labelKey: 'steps.done' }
];

/**
 * Main onboarding wizard component.
 * Provides a full-screen, multi-step wizard experience for new users
 * to configure their Auto Claude environment.
 *
 * Features:
 * - Step progress indicator
 * - Navigation between steps (next, back, skip)
 * - Persists completion state to settings
 * - Can be re-run from settings
 */
export function OnboardingWizard({
  open,
  onOpenChange,
  onOpenTaskCreator,
  onOpenSettings
}: OnboardingWizardProps) {
  const { t } = useTranslation('onboarding');
  const { updateSettings } = useSettingsStore();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStepId>>(new Set());

  // Get current step ID
  const currentStepId = WIZARD_STEPS[currentStepIndex].id;

  // Build step data for progress indicator
  const steps: WizardStep[] = WIZARD_STEPS.map((step, index) => ({
    id: step.id,
    label: t(step.labelKey),
    completed: completedSteps.has(step.id) || index < currentStepIndex
  }));

  // Navigation handlers
  const goToNextStep = useCallback(() => {
    // Mark current step as completed
    setCompletedSteps(prev => new Set(prev).add(currentStepId));

    if (currentStepIndex < WIZARD_STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    }
  }, [currentStepIndex, currentStepId]);

  const goToPreviousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  // Reset wizard state (for re-running) - defined before skipWizard/finishWizard that use it
  const resetWizard = useCallback(() => {
    setCurrentStepIndex(0);
    setCompletedSteps(new Set());
  }, []);

  const completeWizard = useCallback(async () => {
    // Mark onboarding as completed and close - save to disk AND update local state
    try {
      const result = await window.electronAPI.saveSettings({ onboardingCompleted: true });
      if (!result?.success) {
        console.error('Failed to save onboarding completion:', result?.error);
      }
    } catch (err) {
      console.error('Error saving onboarding completion:', err);
    }
    updateSettings({ onboardingCompleted: true });
    onOpenChange(false);
    resetWizard();
  }, [updateSettings, onOpenChange, resetWizard]);

  // Handle opening task creator from within wizard
  const handleOpenTaskCreator = useCallback(() => {
    if (onOpenTaskCreator) {
      // Close wizard first, then open task creator
      onOpenChange(false);
      onOpenTaskCreator();
    }
  }, [onOpenTaskCreator, onOpenChange]);

  // Handle opening settings from completion step
  const handleOpenSettings = useCallback(() => {
    if (onOpenSettings) {
      // Finish wizard first, then open settings
      completeWizard();
      onOpenSettings();
    }
  }, [onOpenSettings, completeWizard]);

  // Render current step content
  const renderStepContent = () => {
    switch (currentStepId) {
      case 'welcome':
        return (
          <WelcomeStep
            onGetStarted={goToNextStep}
            onSkip={completeWizard}
          />
        );
      case 'accounts':
        return (
          <AccountsStep
            onNext={goToNextStep}
            onBack={goToPreviousStep}
            onSkip={completeWizard}
          />
        );
      case 'devtools':
        return (
          <DevToolsStep
            onNext={goToNextStep}
            onBack={goToPreviousStep}
          />
        );
      case 'privacy':
        return (
          <PrivacyStep
            onNext={goToNextStep}
            onBack={goToPreviousStep}
          />
        );
      case 'memory':
        return (
          <MemoryStep
            onNext={goToNextStep}
            onBack={goToPreviousStep}
          />
        );
      case 'completion':
        return (
          <CompletionStep
            onFinish={completeWizard}
            onOpenTaskCreator={handleOpenTaskCreator}
            onOpenSettings={handleOpenSettings}
          />
        );
      default:
        return null;
    }
  };

  // Handle dialog close - ask for confirmation if not completed
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      // If closing before completion, skip the wizard
      completeWizard();
    } else {
      onOpenChange(newOpen);
    }
  }, [completeWizard, onOpenChange]);

  return (
    <FullScreenDialog open={open} onOpenChange={handleOpenChange}>
      <FullScreenDialogContent>
        <FullScreenDialogHeader>
          <FullScreenDialogTitle className="flex items-center gap-3">
            <Wand2 className="h-6 w-6" />
            {t('wizard.title')}
          </FullScreenDialogTitle>
          <FullScreenDialogDescription>
            {t('wizard.description')}
          </FullScreenDialogDescription>

          {/* Progress indicator - show for all steps except welcome and completion */}
          {currentStepId !== 'welcome' && currentStepId !== 'completion' && (
            <div className="mt-6">
              <WizardProgress currentStep={currentStepIndex} steps={steps} />
            </div>
          )}
        </FullScreenDialogHeader>

        <FullScreenDialogBody>
          <ScrollArea className="h-full">
            {renderStepContent()}
          </ScrollArea>
        </FullScreenDialogBody>
      </FullScreenDialogContent>
    </FullScreenDialog>
  );
}
