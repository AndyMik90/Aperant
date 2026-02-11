import * as React from 'react';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Label } from '../primitives/label';
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card';
import { Separator } from '../primitives/separator';
import { cn } from '../utils';

export interface OAuthProvider {
  name: string;
  icon: React.ReactNode;
  id: string;
}

export interface LoginFormProps {
  onEmailLogin: (email: string, password: string) => void;
  onOAuthLogin: (providerId: string) => void;
  providers?: OAuthProvider[];
  isLoading?: boolean;
  error?: string;
  className?: string;
}

const LoginForm: React.FC<LoginFormProps> = ({
  onEmailLogin,
  onOAuthLogin,
  providers,
  isLoading = false,
  error,
  className,
}) => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onEmailLogin(email, password);
  };

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader>
        <CardTitle className="text-center">Sign In</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        {providers && providers.length > 0 && (
          <>
            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>

            <div className="space-y-2">
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={isLoading}
                  onClick={() => onOAuthLogin(provider.id)}
                >
                  {provider.icon}
                  Continue with {provider.name}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
LoginForm.displayName = 'LoginForm';

export { LoginForm };
