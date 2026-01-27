import { useTranslation } from 'react-i18next';
import { Github, RefreshCw, Search, Filter, Wand2, Loader2, Layers } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui/tooltip';
import type { IssueListHeaderProps } from '../types';

export function IssueListHeader({
  repoFullName,
  openIssuesCount,
  isLoading,
  searchQuery,
  filterState,
  onSearchChange,
  onFilterChange,
  onRefresh,
  autoFixEnabled,
  autoFixRunning,
  autoFixProcessing,
  onAutoFixToggle,
  onAnalyzeAndGroup,
  isAnalyzing,
}: IssueListHeaderProps) {
  const { t } = useTranslation(['common', 'github']);

  return (
    <div className="shrink-0 p-4 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Github className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('github:issueListHeader.title')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {repoFullName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {t('github:issueListHeader.openIssues', { count: openIssuesCount })}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={t('buttons.refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Issue Management Actions */}
      <div className="flex items-center gap-3 mb-4">
        {/* Analyze & Group Button (Proactive) */}
        {onAnalyzeAndGroup && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAnalyzeAndGroup}
                  disabled={isAnalyzing || isLoading}
                  className="flex-1"
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Layers className="h-4 w-4 mr-2" />
                  )}
                  {t('github:issueListHeader.analyzeAndGroup')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>{t('github:issueListHeader.analyzeAndGroupTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Auto-Fix Toggle (Reactive) */}
        {onAutoFixToggle && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    {autoFixRunning ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Label htmlFor="auto-fix-toggle" className="text-sm cursor-pointer whitespace-nowrap">
                      {t('github:issueListHeader.autoFixNew')}
                    </Label>
                    <Switch
                      id="auto-fix-toggle"
                      checked={autoFixEnabled ?? false}
                      onCheckedChange={onAutoFixToggle}
                      disabled={autoFixRunning}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p>{t('github:issueListHeader.autoFixTooltip')}</p>
                  {autoFixRunning && autoFixProcessing !== undefined && autoFixProcessing > 0 && (
                    <p className="mt-1 text-primary">
                      {t('github:issueListHeader.processing', {
                        count: autoFixProcessing,
                        plural: autoFixProcessing > 1 ? 's' : ''
                      })}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('github:issueListHeader.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterState} onValueChange={onFilterChange}>
          <SelectTrigger className="w-32">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
