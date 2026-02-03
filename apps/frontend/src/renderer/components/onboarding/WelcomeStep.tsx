import { Sparkles, Zap, Brain, FileCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface WelcomeStepProps {
  onGetStarted: () => void;
  onSkip: () => void;
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Card className="border border-border bg-card/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="font-medium text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Welcome step component for the onboarding wizard.
 * Displays a welcome message with a feature overview and actions to get started or skip.
 */
export function WelcomeStep({ onGetStarted, onSkip }: WelcomeStepProps) {
  const { t } = useTranslation('onboarding');

  const features = [
    {
      icon: <Sparkles className="h-5 w-5" />,
      title: t('welcome.features.aiPowered.title'),
      description: t('welcome.features.aiPowered.description')
    },
    {
      icon: <FileCode className="h-5 w-5" />,
      title: t('welcome.features.specDriven.title'),
      description: t('welcome.features.specDriven.description')
    },
    {
      icon: <Brain className="h-5 w-5" />,
      title: t('welcome.features.memory.title'),
      description: t('welcome.features.memory.description')
    },
    {
      icon: <Zap className="h-5 w-5" />,
      title: t('welcome.features.parallel.title'),
      description: t('welcome.features.parallel.description')
    }
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {t('welcome.title')}
          </h1>
          <p className="mt-3 text-muted-foreground text-lg">
            {t('welcome.subtitle')}
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>

        {/* Description */}
        <div className="text-center mb-8">
          <p className="text-muted-foreground">
            {t('wizard.helpText')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            size="lg"
            onClick={onGetStarted}
            className="gap-2 px-8"
            data-testid="welcome-get-started"
          >
            <Sparkles className="h-5 w-5" />
            {t('welcome.getStarted')}
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground"
            data-testid="welcome-skip"
          >
            {t('welcome.skip')}
          </Button>
        </div>
      </div>
    </div>
  );
}
