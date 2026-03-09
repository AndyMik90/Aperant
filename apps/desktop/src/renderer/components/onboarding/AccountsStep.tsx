import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Button } from '../ui/button';
import { ProviderAccountsList } from '../settings/ProviderAccountsList';

interface AccountsStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * AccountsStep component for the onboarding wizard.
 *
 * Replaces the old AuthChoiceStep + OAuthStep two-step flow with a single
 * step that reuses the ProviderAccountsList from settings. Users can add
 * accounts from any supported provider (Anthropic, OpenAI, Google, etc.).
 */
export function AccountsStep({ onNext, onBack, onSkip }: AccountsStepProps) {
  const { t } = useTranslation('onboarding');

  return (
    <div className="flex h-full flex-col items-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {t('accounts.title')}
          </h1>
          <p className="mt-3 text-muted-foreground text-lg">
            {t('accounts.description')}
          </p>
        </div>

        {/* Provider accounts list - reused from settings */}
        <div className="rounded-lg border border-border bg-card/50 p-4">
          <ProviderAccountsList />
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('accounts.buttons.back')}
          </Button>
          <div className="flex gap-4">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('accounts.buttons.skip')}
            </Button>
            <Button onClick={onNext}>
              {t('accounts.buttons.continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
