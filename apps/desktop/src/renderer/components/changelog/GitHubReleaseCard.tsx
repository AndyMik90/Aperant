import { useState } from 'react';
import { Github, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface GitHubReleaseCardProps {
  projectId: string;
  version: string;
  generatedChangelog: string;
}

export function GitHubReleaseCard({
  projectId,
  version,
  generatedChangelog
}: GitHubReleaseCardProps) {
  const [isCreatingRelease, setIsCreatingRelease] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const tag = version.startsWith('v') ? version : `v${version}`;

  const handleCreateRelease = async () => {
    setIsCreatingRelease(true);
    setReleaseError(null);
    try {
      const result = await window.electronAPI.createGitHubRelease(
        projectId,
        version,
        generatedChangelog
      );
      if (result.success && result.data) {
        setReleaseUrl(result.data.url);
      } else {
        setReleaseError(result.error || 'Failed to create release');
      }
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Failed to create release');
    } finally {
      setIsCreatingRelease(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          <CardTitle className="text-base">Create GitHub Release</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {releaseUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">Release created successfully!</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open(releaseUrl, '_blank')}
            >
              <ExternalLink className="me-2 h-4 w-4" />
              View Release on GitHub
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Create a new release {tag} on GitHub with the changelog as release notes.
            </p>
            {releaseError && (
              <div className="flex items-start gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{releaseError}</span>
              </div>
            )}
            <Button
              className="w-full"
              onClick={handleCreateRelease}
              disabled={isCreatingRelease}
            >
              {isCreatingRelease ? (
                <>
                  <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                  Creating Release...
                </>
              ) : (
                <>
                  <Github className="me-2 h-4 w-4" />
                  Create Release {tag}
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
