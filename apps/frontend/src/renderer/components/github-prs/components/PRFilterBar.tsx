/**
 * Filter bar for GitHub PRs list
 * Grid layout: Contributors (3) | Status (3) | Search (8)
 * Multi-select dropdowns with visible chip selections
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Search,
  Users,
  Sparkles,
  CheckCircle2,
  Send,
  AlertCircle,
  CheckCheck,
  RefreshCw,
  X,
  Filter,
  Check,
  Loader2,
  ArrowUpDown,
  Clock,
  FileCode
} from 'lucide-react';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Separator } from '../../ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import type { PRFilterState, PRStatusFilter, PRSortOption } from '../hooks/usePRFiltering';
import { cn } from '../../../lib/utils';

interface PRFilterBarProps {
  filters: PRFilterState;
  contributors: string[];
  hasActiveFilters: boolean;
  onSearchChange: (query: string) => void;
  onContributorsChange: (contributors: string[]) => void;
  onStatusesChange: (statuses: PRStatusFilter[]) => void;
  onSortChange: (sortBy: PRSortOption) => void;
  onClearFilters: () => void;
}

// Status options
const STATUS_OPTIONS: Array<{
  value: PRStatusFilter;
  labelKey: string;
  icon: typeof Sparkles;
  color: string;
  bgColor: string;
}> = [
  { value: 'reviewing', labelKey: 'prReview.reviewing', icon: Loader2, color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  { value: 'not_reviewed', labelKey: 'prReview.notReviewed', icon: Sparkles, color: 'text-slate-500', bgColor: 'bg-slate-500/20' },
  { value: 'reviewed', labelKey: 'prReview.reviewed', icon: CheckCircle2, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'posted', labelKey: 'prReview.posted', icon: Send, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { value: 'changes_requested', labelKey: 'prReview.changesRequested', icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { value: 'ready_to_merge', labelKey: 'prReview.readyToMerge', icon: CheckCheck, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
  { value: 'ready_for_followup', labelKey: 'prReview.readyForFollowup', icon: RefreshCw, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
];

// Sort options
const SORT_OPTIONS: Array<{
  value: PRSortOption;
  labelKey: string;
  icon: typeof Clock;
}> = [
  { value: 'newest', labelKey: 'prReview.sort.newest', icon: Clock },
  { value: 'oldest', labelKey: 'prReview.sort.oldest', icon: Clock },
  { value: 'largest', labelKey: 'prReview.sort.largest', icon: FileCode },
];

/**
 * Modern Filter Dropdown Component
 */
function FilterDropdown<T extends string>({
  title,
  icon: Icon,
  items,
  selected,
  onChange,
  renderItem,
  renderTrigger,
  searchable = false,
  searchPlaceholder,
  selectedCountLabel,
  noResultsLabel,
  clearLabel,
}: {
  title: string;
  icon: typeof Users;
  items: T[];
  selected: T[];
  onChange: (selected: T[]) => void;
  renderItem?: (item: T) => React.ReactNode;
  renderTrigger?: (selected: T[]) => React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  selectedCountLabel?: string;
  noResultsLabel?: string;
  clearLabel?: string;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const toggleItem = useCallback((item: T) => {
    if (selected.includes(item)) {
      onChange(selected.filter((s) => s !== item));
    } else {
      onChange([...selected, item]);
    }
  }, [selected, onChange]);

  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    return items.filter(item =>
      item.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [items, searchTerm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filteredItems.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev =>
          prev < filteredItems.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev =>
          prev > 0 ? prev - 1 : filteredItems.length - 1
        );
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredItems.length) {
          toggleItem(filteredItems[focusedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  }, [filteredItems, focusedIndex, toggleItem]);

  // Scroll focused item into view for keyboard navigation
  useEffect(() => {
    if (focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        setSearchTerm('');
        setFocusedIndex(-1);
      }
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-full justify-start border-dashed bg-transparent",
            selected.length > 0 && "border-solid bg-accent/50"
          )}
        >
          <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
          <span className="truncate">{title}</span>
          {selected.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal lg:hidden"
              >
                {selected.length}
              </Badge>
              <div className="hidden space-x-1 lg:flex flex-1 truncate">
                {selected.length > 2 ? (
                  <Badge
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {selectedCountLabel}
                  </Badge>
                ) : (
                  renderTrigger ? renderTrigger(selected) : (
                    selected.map((item) => (
                      <Badge
                        variant="secondary"
                        key={item}
                        className="rounded-sm px-1 font-normal"
                      >
                        {item}
                      </Badge>
                    ))
                  )
                )}
              </div>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px] p-0">
        <div className="px-3 py-2 border-b border-border/50">
          <div className="text-xs font-semibold text-muted-foreground mb-1">
            {title}
          </div>
          {searchable && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                className="h-7 text-xs pl-7 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>

        <div
          className="max-h-[300px] overflow-y-auto custom-scrollbar p-1"
          role="listbox"
          aria-multiselectable="true"
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          {filteredItems.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">
              {noResultsLabel}
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = selected.includes(item);
              const isFocused = index === focusedIndex;
              return (
                <div
                  key={item}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                    isSelected && "bg-accent/50",
                    isFocused && "ring-2 ring-primary/50 bg-accent"
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    toggleItem(item);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleItem(item);
                    }
                  }}
                  tabIndex={-1}
                >
                  <div className={cn(
                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary/30",
                    isSelected ? "bg-primary border-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                  )}>
                    <Check className={cn("h-3 w-3")} />
                  </div>
                  {renderItem ? renderItem(item) : item}
                </div>
              );
            })
          )}
        </div>

        {selected.length > 0 && (
          <div className="p-1 border-t border-border/50 bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs h-7 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onChange([])}
            >
              {clearLabel}
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Single-select Sort Dropdown Component
 */
function SortDropdown({
  value,
  onChange,
  options,
  title,
}: {
  value: PRSortOption;
  onChange: (value: PRSortOption) => void;
  options: typeof SORT_OPTIONS;
  title: string;
}) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const currentOption = options.find((opt) => opt.value === value) || options[0];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (options.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          onChange(options[focusedIndex].value);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  }, [options, focusedIndex, onChange]);

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          // Focus current selection on open for better keyboard UX
          setFocusedIndex(options.findIndex((o) => o.value === value));
        } else {
          setFocusedIndex(-1);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 justify-start border-dashed bg-transparent"
        >
          <ArrowUpDown className="mr-2 h-4 w-4 text-muted-foreground" />
          <span className="truncate">{title}</span>
          <Separator orientation="vertical" className="mx-2 h-4" />
          <Badge variant="secondary" className="rounded-sm px-1 font-normal">
            {t(currentOption.labelKey)}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[180px] p-0">
        <div className="px-3 py-2 border-b border-border/50">
          <div className="text-xs font-semibold text-muted-foreground">
            {title}
          </div>
        </div>
        <div
          className="p-1"
          role="listbox"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {options.map((option, index) => {
            const isSelected = value === option.value;
            const isFocused = focusedIndex === index;
            const Icon = option.icon;
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent/50",
                  isFocused && "bg-accent text-accent-foreground"
                )}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <div className={cn(
                  "mr-2 flex h-4 w-4 items-center justify-center rounded-full border border-primary/30",
                  isSelected ? "bg-primary border-primary text-primary-foreground" : "opacity-50"
                )}>
                  {isSelected && <Check className="h-2.5 w-2.5" />}
                </div>
                <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>{t(option.labelKey)}</span>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PRFilterBar({
  filters,
  contributors,
  hasActiveFilters,
  onSearchChange,
  onContributorsChange,
  onStatusesChange,
  onSortChange,
  onClearFilters,
}: PRFilterBarProps) {
  const { t } = useTranslation('common');

  // Get status option by value
  const getStatusOption = (value: PRStatusFilter) =>
    STATUS_OPTIONS.find((opt) => opt.value === value);

  return (
    <div className="px-4 py-2 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2 h-9">
        {/* Search Input - Flexible width */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('prReview.searchPlaceholder')}
            value={filters.searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-9 bg-background/50 focus:bg-background transition-colors"
          />
          {filters.searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('prReview.clearSearch')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Contributors Filter */}
        <div className="flex-1 max-w-[240px]">
          <FilterDropdown
            title={t('prReview.contributors')}
            icon={Users}
            items={contributors}
            selected={filters.contributors}
            onChange={onContributorsChange}
            searchable={true}
            searchPlaceholder={t('prReview.searchContributors')}
            selectedCountLabel={t('prReview.selectedCount', { count: filters.contributors.length })}
            noResultsLabel={t('prReview.noResultsFound')}
            clearLabel={t('prReview.clearFilters')}
            renderItem={(contributor) => (
               <div className="flex items-center gap-2 min-w-0">
                 <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-medium text-primary">
                      {contributor.slice(0, 2).toUpperCase()}
                    </span>
                 </div>
                 <span className="truncate text-sm">{contributor}</span>
               </div>
            )}
          />
        </div>

        {/* Status Filter */}
        <div className="flex-1 max-w-[240px]">
          <FilterDropdown
            title={t('prReview.allStatuses')}
            icon={Filter}
            items={STATUS_OPTIONS.map((opt) => opt.value)}
            selected={filters.statuses}
            onChange={onStatusesChange}
            selectedCountLabel={t('prReview.selectedCount', { count: filters.statuses.length })}
            noResultsLabel={t('prReview.noResultsFound')}
            clearLabel={t('prReview.clearFilters')}
            renderItem={(status) => {
              const option = getStatusOption(status);
              if (!option) return null;
              const Icon = option.icon;
              return (
                <div className="flex items-center gap-2">
                  <div className={cn("p-1 rounded-full", option.bgColor)}>
                     <Icon className={cn("h-3 w-3", option.color)} />
                  </div>
                  <span className="text-sm">{t(option.labelKey)}</span>
                </div>
              );
            }}
            renderTrigger={(selected) => (
              selected.map(status => {
                const option = getStatusOption(status);
                if (!option) return null;
                const Icon = option.icon;
                return (
                  <Badge
                    variant="secondary"
                    key={status}
                    className={cn(
                      "rounded-sm px-1 font-normal gap-1",
                      option.bgColor,
                      option.color
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span className="truncate max-w-[80px]">{t(option.labelKey)}</span>
                  </Badge>
                );
              })
            )}
          />
        </div>

        {/* Sort Dropdown */}
        <div className="flex-shrink-0">
          <SortDropdown
            value={filters.sortBy}
            onChange={onSortChange}
            options={SORT_OPTIONS}
            title={t('prReview.sort.label')}
          />
        </div>

        {/* Reset All */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-8 px-2 lg:px-3 text-muted-foreground hover:text-foreground ml-auto"
          >
            <span className="hidden lg:inline mr-2">{t('prReview.reset')}</span>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
