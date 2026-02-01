import { useTranslation } from 'react-i18next';
import { RefreshCw, Calendar, FolderTree } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import type { BoardHeaderProps } from '../types';

export function BoardHeader({
  projectName,
  teamName,
  areas,
  selectedAreaPath,
  onAreaChange,
  iterations,
  selectedIterationId,
  onIterationChange,
  onRefresh,
  isLoading,
  workItemCount
}: BoardHeaderProps) {
  const { t } = useTranslation(['azureDevOps', 'common']);

  const selectedIteration = iterations.find(i => i.id === selectedIterationId);
  const selectedArea = areas.find(a => a.path === selectedAreaPath);

  return (
    <div className="shrink-0 p-4 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <svg
              className="h-5 w-5 text-[#0078d4]"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('azureDevOps:board.title', 'Azure DevOps Board')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {projectName && teamName
                ? `${projectName} / ${teamName}`
                : projectName || t('azureDevOps:board.noProject', 'No project selected')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {workItemCount !== undefined && (
            <Badge variant="outline" className="text-xs">
              {workItemCount} {t('azureDevOps:board.items', 'items')}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={t('common:buttons.refresh', 'Refresh')}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Area dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              {t('azureDevOps:board.area', 'Area')}:
            </span>
          </div>
          <Select
            value={selectedAreaPath || ''}
            onValueChange={onAreaChange}
            disabled={isLoading || areas.length === 0}
          >
            <SelectTrigger className="w-64">
              <SelectValue
                placeholder={t('azureDevOps:board.selectArea', 'Select area...')}
              >
                {selectedArea?.name || t('azureDevOps:board.selectArea', 'Select area...')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {areas.map((area) => (
                <SelectItem key={area.id} value={area.path}>
                  <span>{area.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Iteration dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              {t('azureDevOps:board.iteration', 'Iteration')}:
            </span>
          </div>
          <Select
            value={selectedIterationId || ''}
            onValueChange={onIterationChange}
            disabled={isLoading || iterations.length === 0}
          >
            <SelectTrigger className="w-64">
              <SelectValue
                placeholder={t('azureDevOps:board.selectIteration', 'Select iteration...')}
              >
                {selectedIteration?.name || t('azureDevOps:board.selectIteration', 'Select iteration...')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {iterations.map((iteration) => (
                <SelectItem key={iteration.id} value={iteration.id}>
                  <div className="flex items-center gap-2">
                    <span>{iteration.name}</span>
                    {iteration.isCurrent && (
                      <Badge variant="secondary" className="text-xs">
                        {t('azureDevOps:board.current', 'Current')}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
