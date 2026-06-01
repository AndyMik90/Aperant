import { useState } from 'react';
import { ExternalLink, User, Clock, GitBranch, FileDiff, ChevronDown, ChevronUp, Plus, Minus, FileCode, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { PRData } from '../hooks/useGitHubPRs';
import { formatDate } from '../utils/formatDate';

export interface PRHeaderProps {
  pr: PRData;
  isLoadingFiles?: boolean;
}

/**
 * Get file status badge styling
 */
function getFileStatusStyle(status: string) {
  switch (status.toLowerCase()) {
    case 'added':
      return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
    case 'removed':
    case 'deleted':
      return 'bg-red-500/15 text-red-500 border-red-500/30';
    case 'modified':
    case 'changed':
      return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    case 'renamed':
      return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/**
 * Modern Header Component for PR Details
 * Shows PR metadata: state, number, title, author, dates, branches, and file stats
 */
export function PRHeader({ pr, isLoadingFiles = false }: PRHeaderProps) {
  const { t, i18n } = useTranslation('common');
  const [showFiles, setShowFiles] = useState(false);
  const hasFiles = pr.files && pr.files.length > 0;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Badge
            variant={pr.state.toLowerCase() === 'open' ? 'success' : 'secondary'}
            className={cn(
              "capitalize px-2.5 py-0.5",
              pr.state.toLowerCase() === 'open'
                ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 border-emerald-500/20"
                : ""
            )}
          >
            {t(`prReview.state.${pr.state.toLowerCase()}`)}
          </Badge>
          <span className="text-muted-foreground text-sm font-mono">#{pr.number}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>

      <h1 className="text-xl font-bold mb-4 leading-tight">{pr.title}</h1>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground border-b border-border/40 pb-5">
        <div className="flex items-center gap-2">
          <div className="bg-muted rounded-full p-1">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="font-medium text-foreground">{pr.author.login}</span>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 opacity-70" />
          <span>{formatDate(pr.createdAt, i18n.language)}</span>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 font-mono text-xs border border-border/50">
          <GitBranch className="h-3 w-3" />
          <span className="text-foreground">{pr.headRefName}</span>
          <span className="text-muted-foreground/50 mx-1">→</span>
          <span className="text-foreground">{pr.baseRefName}</span>
        </div>

        <div className="flex items-center gap-4 ms-auto">
          {/* Clickable files indicator */}
          <button
            onClick={() => setShowFiles(!showFiles)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
              "hover:bg-accent/50 cursor-pointer",
              showFiles && "bg-accent/50"
            )}
            title={t('prReview.clickToViewFiles')}
          >
            {isLoadingFiles ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDiff className="h-4 w-4" />
            )}
            <span className="font-medium text-foreground">{pr.changedFiles}</span>
            <span className="text-xs">{t('prReview.files')}</span>
            {hasFiles && (
              showFiles ? <ChevronUp className="h-3 w-3 ms-1" /> : <ChevronDown className="h-3 w-3 ms-1" />
            )}
          </button>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              +{pr.additions}
            </span>
            <span className="text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
              -{pr.deletions}
            </span>
          </div>
        </div>
      </div>

      {/* Collapsible file list */}
      {showFiles && (
        <div className="mt-4 border border-border/40 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {isLoadingFiles ? (
            <div className="p-4 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin me-2" />
              <span className="text-sm">{t('prReview.loadingFiles')}</span>
            </div>
          ) : hasFiles ? (
            <div className="divide-y divide-border/40 max-h-[300px] overflow-y-auto">
              {pr.files.map((file, index) => (
                <div
                  key={`${file.path}-${index}`}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors"
                >
                  <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs truncate flex-1" title={file.path}>
                    {file.path}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0 shrink-0", getFileStatusStyle(file.status))}
                  >
                    {file.status}
                  </Badge>
                  <div className="flex items-center gap-1.5 text-xs font-mono shrink-0">
                    <span className="text-emerald-500 flex items-center gap-0.5">
                      <Plus className="h-3 w-3" />
                      {file.additions}
                    </span>
                    <span className="text-red-500 flex items-center gap-0.5">
                      <Minus className="h-3 w-3" />
                      {file.deletions}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-muted-foreground text-sm">
              {t('prReview.noFilesAvailable')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
