import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('changelog');
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
        setReleaseError(result.error || t('githubRelease.failedToCreate'));
      }
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : t('githubRelease.failedToCreate'));
    } finally {
      setIsCreatingRelease(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          <CardTitle className="text-base">{t('githubRelease.title')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {releaseUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">{t('githubRelease.createdSuccess')}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open(releaseUrl, '_blank')}
            >
              <ExternalLink className="me-2 h-4 w-4" />
              {t('githubRelease.viewOnGitHub')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('githubRelease.description', { tag })}
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
                  {t('githubRelease.creating')}
                </>
              ) : (
                <>
                  <Github className="me-2 h-4 w-4" />
                  {t('githubRelease.createRelease', { tag })}
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
