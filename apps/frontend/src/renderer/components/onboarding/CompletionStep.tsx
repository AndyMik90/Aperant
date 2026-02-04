import {
  CheckCircle2,
  Rocket,
  FileText,
  Settings,
  BookOpen,
  ArrowRight
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface CompletionStepProps {
  onFinish: () => void;
  onOpenTaskCreator?: () => void;
  onOpenSettings?: () => void;
}

interface NextStepCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
}

function NextStepCard({ icon, title, description, action, actionLabel }: NextStepCardProps) {
  return (
    <Card className="border border-border bg-card/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            {action && actionLabel && (
              <Button
                variant="link"
                size="sm"
                onClick={action}
                className="mt-2 h-auto p-0 text-primary hover:text-primary/80"
              >
                {actionLabel}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Completion step component for the onboarding wizard.
 * Displays a success message with suggestions for next steps
 * and a prominent "Finish" button to complete the wizard.
 */
export function CompletionStep({
  onFinish,
  onOpenTaskCreator,
  onOpenSettings
}: CompletionStepProps) {
  const { t } = useTranslation('onboarding');

  const nextSteps = [
    {
      icon: <FileText className="h-5 w-5" />,
      title: t('completion.createTask.title'),
      description: t('completion.createTask.description'),
      action: onOpenTaskCreator,
      actionLabel: t('completion.createTask.action')
    },
    {
      icon: <Settings className="h-5 w-5" />,
      title: t('completion.customizeSettings.title'),
      description: t('completion.customizeSettings.description'),
      action: onOpenSettings,
      actionLabel: t('completion.customizeSettings.action')
    },
    {
      icon: <BookOpen className="h-5 w-5" />,
      title: t('completion.exploreDocs.title'),
      description: t('completion.exploreDocs.description'),
      // ONBOARD-4: Add action to open documentation
      action: () => window.electronAPI?.openExternal?.('https://github.com/scopefall/jerry'),
      actionLabel: t('completion.exploreDocs.action', 'View Documentation')
    }
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Success Hero */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/20 text-success">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Rocket className="h-4 w-4" />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {t('completion.title')}
          </h1>
          <p className="mt-3 text-muted-foreground text-lg">
            {t('completion.subtitle')}
          </p>
        </div>

        {/* Completion message */}
        <Card className="border border-success/30 bg-success/10 mb-8">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-success">
                  {t('completion.setupComplete')}
                </h3>
                <p className="mt-1 text-sm text-success/80">
                  {t('completion.setupCompleteDescription')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Steps Section */}
        <div className="space-y-4 mb-10">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Rocket className="h-4 w-4" />
            {t('completion.whatsNext')}
          </div>
          <div className="grid grid-cols-1 gap-3">
            {nextSteps.map((step, index) => (
              <NextStepCard
                key={index}
                icon={step.icon}
                title={step.title}
                description={step.description}
                action={step.action}
                actionLabel={step.actionLabel}
              />
            ))}
          </div>
        </div>

        {/* Finish Button */}
        <div className="flex flex-col items-center gap-4">
          <Button
            size="lg"
            onClick={onFinish}
            className="gap-2 px-10"
          >
            <Rocket className="h-5 w-5" />
            {t('completion.finish')}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            {t('completion.rerunHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
