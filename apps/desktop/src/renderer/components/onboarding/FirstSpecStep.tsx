import { useState } from 'react';
import {
  FileText,
  Lightbulb,
  CheckCircle2,
  ArrowRight,
  PenLine,
  ListChecks,
  Target,
  Sparkles
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface FirstSpecStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onOpenTaskCreator: () => void;
}

interface TipCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function TipCard({ icon, title, description }: TipCardProps) {
  return (
    <Card className="border border-border bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="font-medium text-foreground text-sm">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * First spec creation step for the onboarding wizard.
 * Guides users through creating their first task/spec with helpful tips
 * and provides an action to open the Task Creator.
 */
export function FirstSpecStep({ onNext, onBack, onSkip, onOpenTaskCreator }: FirstSpecStepProps) {
  const [hasCreatedSpec, setHasCreatedSpec] = useState(false);

  const tips = [
    {
      icon: <PenLine className="h-4 w-4" />,
      title: 'Be Descriptive',
      description: 'Clearly describe what you want to build. Include requirements, constraints, and expected behavior.'
    },
    {
      icon: <Target className="h-4 w-4" />,
      title: 'Start Small',
      description: 'Begin with a focused task like adding a feature or fixing a bug. Smaller tasks are easier to verify.'
    },
    {
      icon: <ListChecks className="h-4 w-4" />,
      title: 'Include Context',
      description: 'Mention relevant files, APIs, or patterns. The more context you provide, the better the results.'
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      title: 'Let AI Help',
      description: 'The AI can generate titles and classify tasks. Focus on describing what you want, not the details.'
    }
  ];

  const handleOpenTaskCreator = () => {
    setHasCreatedSpec(true);
    onOpenTaskCreator();
  };

  const handleContinue = () => {
    onNext();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Create Your First Task
          </h1>
          <p className="mt-2 text-muted-foreground">
            Describe what you want to build and let Aperant handle the rest
          </p>
        </div>

        {/* Success state after opening task creator */}
        {hasCreatedSpec && (
          <Card className="border border-success/30 bg-success/10 mb-6">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="h-6 w-6 text-success shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-success">
                    Task Creator Opened
                  </h3>
                  <p className="mt-1 text-sm text-success/80">
                    Great! You can create your first task now or continue with the wizard.
                    You can always create tasks later from the main dashboard.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tips section */}
        <div className="space-y-4 mb-8">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Lightbulb className="h-4 w-4" />
            Tips for Great Tasks
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tips.map((tip, index) => (
              <TipCard
                key={index}
                icon={tip.icon}
                title={tip.title}
                description={tip.description}
              />
            ))}
          </div>
        </div>

        {/* Example task card */}
        <Card className="border border-info/30 bg-info/10 mb-8">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <FileText className="h-5 w-5 text-info shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Example Task Description:
                </p>
                <p className="text-sm text-muted-foreground italic">
                  &quot;Add a dark mode toggle to the settings page. It should persist the user&apos;s
                  preference in localStorage and apply the theme immediately without page reload.
                  Use the existing color variables in styles/theme.css.&quot;
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Primary action */}
        <div className="flex justify-center mb-6">
          <Button
            size="lg"
            onClick={handleOpenTaskCreator}
            className="gap-2 px-8"
          >
            <ArrowRight className="h-5 w-5" />
            Open Task Creator
          </Button>
        </div>

        {/* Skip info */}
        <p className="text-center text-sm text-muted-foreground mb-2">
          {hasCreatedSpec
            ? 'You can continue with the wizard now or create more tasks.'
            : 'You can skip this step and create tasks later from the dashboard.'}
        </p>

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            Back
          </Button>
          <div className="flex gap-4">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
            <Button onClick={handleContinue}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
