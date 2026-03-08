import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, Download, CheckCircle2, Loader2, Lock, Globe, Search, X, FolderGit2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useProjectStore } from '../stores/project-store';
import type { Project } from '../../shared/types';

interface CustomerReposModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Project;
}

interface RepoItem {
  fullName: string;
  description: string | null;
  isPrivate: boolean;
}

type CloneStatus = 'idle' | 'cloning' | 'done' | 'error';

export function CustomerReposModal({ open, onOpenChange, customer }: CustomerReposModalProps) {
  const { t } = useTranslation('dialogs');
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cloneStatuses, setCloneStatuses] = useState<Record<string, CloneStatus>>({});
  const [cloneErrors, setCloneErrors] = useState<Record<string, string>>({});

  const loadRepos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.listGitHubUserRepos();
      if (result.success && result.data) {
        setRepos(result.data.repos);
      } else {
        setError(result.error || t('customerRepos.failedToLoad'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('customerRepos.failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setCloneStatuses({});
      setCloneErrors({});
      loadRepos();
    }
  }, [open, loadRepos]);

  const handleClone = async (repo: RepoItem) => {
    setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'cloning' }));
    setCloneErrors(prev => {
      const next = { ...prev };
      delete next[repo.fullName];
      return next;
    });

    try {
      const result = await window.electronAPI.cloneGitHubRepo(repo.fullName, customer.path);
      if (!result.success || !result.data) {
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
        setCloneErrors(prev => ({ ...prev, [repo.fullName]: result.error || t('customerRepos.cloneFailed') }));
        return;
      }

      // Register the cloned repo as a project
      const addResult = await window.electronAPI.addProject(result.data.path);
      if (addResult.success && addResult.data) {
        const store = useProjectStore.getState();
        store.addProject(addResult.data);
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'done' }));
      } else {
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
        setCloneErrors(prev => ({
          ...prev,
          [repo.fullName]: addResult.error || t('customerRepos.cloneFailed')
        }));
      }
    } catch (err) {
      setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
      setCloneErrors(prev => ({
        ...prev,
        [repo.fullName]: err instanceof Error ? err.message : t('customerRepos.cloneFailed')
      }));
    }
  };

  const filteredRepos = repos.filter(repo =>
    repo.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(search.toLowerCase()))
  );

  const clonedCount = Object.values(cloneStatuses).filter(s => s === 'done').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5" />
            {t('customerRepos.title')}
          </DialogTitle>
          <DialogDescription>
            {t('customerRepos.description', { name: customer.name })}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('customerRepos.searchPlaceholder')}
            className={cn(
              'w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            )}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Repo list */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 py-2 max-h-[400px]">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('customerRepos.loading')}</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3" role="alert">
              {error}
            </div>
          )}

          {!isLoading && !error && filteredRepos.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {search ? t('customerRepos.noResults') : t('customerRepos.noRepos')}
            </div>
          )}

          {filteredRepos.map((repo) => {
            const status = cloneStatuses[repo.fullName] || 'idle';
            const cloneError = cloneErrors[repo.fullName];

            return (
              <div
                key={repo.fullName}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border border-border',
                  'bg-card hover:bg-accent/50 transition-colors',
                  status === 'done' && 'border-green-500/30 bg-green-500/5'
                )}
              >
                <Github className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{repo.fullName}</span>
                    {repo.isPrivate ? (
                      <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('customerRepos.private')} />
                    ) : (
                      <Globe className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('customerRepos.public')} />
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {repo.description}
                    </p>
                  )}
                  {cloneError && (
                    <p className="text-xs text-destructive mt-1">{cloneError}</p>
                  )}
                </div>

                <div className="shrink-0">
                  {status === 'idle' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleClone(repo)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t('customerRepos.clone')}
                    </Button>
                  )}
                  {status === 'cloning' && (
                    <Button variant="outline" size="sm" disabled>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {t('customerRepos.cloning')}
                    </Button>
                  )}
                  {status === 'done' && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {t('customerRepos.cloned')}
                    </span>
                  )}
                  {status === 'error' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleClone(repo)}
                    >
                      {t('customerRepos.retry')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            {clonedCount > 0 && t('customerRepos.clonedCount', { count: clonedCount })}
          </span>
          <Button onClick={() => onOpenChange(false)}>
            {t('customerRepos.done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
