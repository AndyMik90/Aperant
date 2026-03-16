import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, Filter } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import type { LinearIssueListHeaderProps, LinearFilterState } from '../types';

export function IssueListHeader({
  teamName,
  activeIssuesCount,
  isLoading,
  searchQuery,
  filterState,
  onSearchChange,
  onFilterChange,
  onRefresh,
}: LinearIssueListHeaderProps) {
  const { t } = useTranslation('common');

  return (
    <div className="shrink-0 p-4 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0ZM12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm-.5 5.25a.75.75 0 0 0-1.5 0v5.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5H11.5V6.25Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('linear.title', 'Linear Issues')}
            </h2>
            <p className="text-xs text-muted-foreground">{teamName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {activeIssuesCount} {t('linear.active', 'active')}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={t('buttons.refresh', 'Refresh')}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('linear.searchPlaceholder', 'Search issues...')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterState}
          onValueChange={(value) => onFilterChange(value as LinearFilterState)}
        >
          <SelectTrigger className="w-36">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('linear.filter.all', 'All')}</SelectItem>
            <SelectItem value="backlog">{t('linear.filter.backlog', 'Backlog')}</SelectItem>
            <SelectItem value="unstarted">{t('linear.filter.unstarted', 'Unstarted')}</SelectItem>
            <SelectItem value="started">{t('linear.filter.started', 'Started')}</SelectItem>
            <SelectItem value="completed">{t('linear.filter.completed', 'Completed')}</SelectItem>
            <SelectItem value="canceled">{t('linear.filter.canceled', 'Canceled')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
