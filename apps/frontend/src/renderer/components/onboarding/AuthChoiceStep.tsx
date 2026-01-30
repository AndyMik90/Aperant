import { useState } from 'react';
import { LogIn, Key, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ProfileEditDialog } from '../settings/ProfileEditDialog';

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
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  // OAuth button handler - proceeds to OAuth step
  const handleOAuthChoice = () => {
    onNext();
  };

  // API Key button handler - opens profile dialog
  const handleAPIKeyChoice = () => {
    setIsProfileDialogOpen(true);
  };

  // Profile dialog close handler - only handles opening/closing the dialog
  const handleProfileDialogClose = (open: boolean) => {
    setIsProfileDialogOpen(open);
  };

  // Profile saved handler - closes dialog then advances wizard
  const handleProfileSaved = () => {
    // Close the dialog
    setIsProfileDialogOpen(false);

    // Skip oauth step and go directly to graphiti
    if (onAPIKeyPathComplete) {
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
              Choose Your Authentication Method
            </h1>
            <p className="mt-3 text-muted-foreground text-lg">
              Select how you want to authenticate with Claude. You can change this later in Settings.
            </p>
          </div>

          {/* Authentication Options - Equal Visual Weight */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <AuthOptionCard
              icon={<LogIn className="h-6 w-6" />}
              title="Sign in with Anthropic"
              description="Use your Anthropic account to authenticate. Simple and secure OAuth flow."
              onClick={handleOAuthChoice}
              variant="oauth"
              data-testid="auth-option-oauth"
            />
            <AuthOptionCard
              icon={<Key className="h-6 w-6" />}
              title="Use Custom API Key"
              description="Bring your own API key from Anthropic or a compatible API provider. ⚠️ Highly experimental — may incur significant costs."
              onClick={handleAPIKeyChoice}
              data-testid="auth-option-apikey"
            />
          </div>

          {/* Info text */}
          <div className="text-center mb-8">
            <p className="text-muted-foreground text-sm">
              Both options provide full access to Claude Code features. Choose based on your preference.
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
              Skip for now
            </Button>
          </div>
        </div>
      </div>

      {/* Profile Edit Dialog for API Key Path */}
      <ProfileEditDialog
        open={isProfileDialogOpen}
        onOpenChange={handleProfileDialogClose}
        onSaved={handleProfileSaved}
        // No profile prop = create mode
      />
    </>
  );
}
