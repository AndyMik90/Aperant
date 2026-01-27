import { useState, useEffect, useRef } from 'react';
import { LogIn, Key, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ProfileEditDialog } from '../settings/ProfileEditDialog';
import { useSettingsStore } from '../../stores/settings-store';
import { useTranslation } from 'react-i18next';

interface AuthChoiceStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onAPIKeyPathComplete?: () => void; // Called when profile is created (skips oauth)
}

interface AuthOptionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  variant?: 'default' | 'oauth';
  'data-testid'?: string;
}

function AuthOptionCard({ icon, title, description, onClick, variant = 'default', 'data-testid': dataTestId }: AuthOptionCardProps) {
  return (
    <Card
      data-testid={dataTestId}
      className={`border border-border bg-card/50 backdrop-blur-sm cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${
        variant === 'oauth' ? 'hover:bg-accent/5' : ''
      }`}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-lg">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * AuthChoiceStep component for the onboarding wizard.
 *
 * Allows new users to choose between:
 * 1. OAuth authentication (Sign in with Anthropic)
 * 2. Custom API key authentication (Use Custom API Key)
 *
 * Features:
 * - Two equal-weight authentication options
 * - Skip button for users who want to configure later
 * - API key path opens ProfileEditDialog for profile creation
 * - OAuth path proceeds to OAuthStep
 *
 * AC Coverage:
 * - AC1: Displays first-run screen with two clear options
 */
export function AuthChoiceStep({ onNext, onBack, onSkip, onAPIKeyPathComplete }: AuthChoiceStepProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const profiles = useSettingsStore((state) => state.profiles);

  // Track initial profiles length to detect new profile creation
  const initialProfilesLengthRef = useRef(profiles.length);

  // Update the ref when profiles change (to track the initial state before dialog opened)
  useEffect(() => {
    // Only update the ref when dialog is NOT open
    // This captures the state before user opens the dialog
    if (!isProfileDialogOpen) {
      initialProfilesLengthRef.current = profiles.length;
    }
  }, [profiles.length, isProfileDialogOpen]);

  // OAuth button handler - proceeds to OAuth step
  const handleOAuthChoice = () => {
    onNext();
  };

  // API Key button handler - opens profile dialog
  const handleAPIKeyChoice = () => {
    setIsProfileDialogOpen(true);
  };

  // Profile dialog close handler - detects profile creation and skips oauth step
  const handleProfileDialogClose = (open: boolean) => {
    const wasEmpty = initialProfilesLengthRef.current === 0;
    const hasProfilesNow = profiles.length > 0;

    setIsProfileDialogOpen(open);

    // If dialog closed and profile was created (was empty, now has profiles), skip to graphiti step
    if (!open && wasEmpty && hasProfilesNow && onAPIKeyPathComplete) {
      // Call the callback to skip oauth and go directly to graphiti
      onAPIKeyPathComplete();
    }
  };

  return (
    <>
      <div className="flex h-full flex-col items-center justify-center px-8 py-6">
        <div className="w-full max-w-2xl">
          {/* Hero Section */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              {t('onboarding:authChoice.title')}
            </h1>
            <p className="mt-3 text-muted-foreground text-lg">
              {t('onboarding:authChoice.description')}
            </p>
          </div>

          {/* Authentication Options - Equal Visual Weight */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <AuthOptionCard
              icon={<LogIn className="h-6 w-6" />}
              title={t('onboarding:authChoice.oauth.title')}
              description={t('onboarding:authChoice.oauth.description')}
              onClick={handleOAuthChoice}
              variant="oauth"
              data-testid="auth-option-oauth"
            />
            <AuthOptionCard
              icon={<Key className="h-6 w-6" />}
              title={t('onboarding:authChoice.apiKey.title')}
              description={t('onboarding:authChoice.apiKey.description')}
              onClick={handleAPIKeyChoice}
              data-testid="auth-option-apikey"
            />
          </div>

          {/* Info text */}
          <div className="text-center mb-8">
            <p className="text-muted-foreground text-sm">
              {t('onboarding:authChoice.info')}
            </p>
          </div>

          {/* Skip Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('onboarding:authChoice.skip')}
            </Button>
          </div>
        </div>
      </div>

      {/* Profile Edit Dialog for API Key Path */}
      <ProfileEditDialog
        open={isProfileDialogOpen}
        onOpenChange={handleProfileDialogClose}
        // No profile prop = create mode
      />
    </>
  );
}
