import { useTranslation } from 'react-i18next';
import { GitlabIcon, RefreshCw, Search, Filter } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import type { IssueListHeaderProps } from '../types';

export function IssueListHeader({
  projectPath,
  openIssuesCount,
  isLoading,
  searchQuery,
  filterState,
  onSearchChange,
  onFilterChange,
  onRefresh
}: IssueListHeaderProps) {
  const { t } = useTranslation('gitlab');

  return (
    <div className="shrink-0 p-4 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <GitlabIcon className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('title')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {projectPath}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {openIssuesCount} {t('header.open')}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('header.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="ps-9"
          />
        </div>
        <Select value={filterState} onValueChange={onFilterChange}>
          <SelectTrigger className="w-32">
            <Filter className="h-4 w-4 me-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opened">{t('filters.opened')}</SelectItem>
            <SelectItem value="closed">{t('filters.closed')}</SelectItem>
            <SelectItem value="all">{t('filters.all')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
