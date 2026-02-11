import * as React from 'react';

export interface AuthGateProps {
  isAuthenticated: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loginUrl?: string;
}

const AuthGate: React.FC<AuthGateProps> = ({
  isAuthenticated,
  children,
  fallback,
  loginUrl,
}) => {
  if (isAuthenticated) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (loginUrl) {
    return (
      <div className="flex items-center justify-center p-6">
        <a
          href={loginUrl}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Sign in to continue
        </a>
      </div>
    );
  }

  return null;
};
AuthGate.displayName = 'AuthGate';

export { AuthGate };
