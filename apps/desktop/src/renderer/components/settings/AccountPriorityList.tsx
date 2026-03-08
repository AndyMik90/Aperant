/**
 * AccountPriorityList - Unified drag-and-drop priority list with usage visualization
 *
 * Displays ALL accounts in a single, unified priority list. Position determines
 * fallback order - the system uses accounts from top to bottom.
 *
 * Supports all user scenarios:
 * - OAuth accounts as primary with API fallback
 * - API endpoints as primary with OAuth fallback
 * - Any mix of providers in any order
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Star,
  Tag,
  Infinity,
  AlertCircle,
  Users,
  Server,
  Clock,
  TrendingUp,
  Info
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';

/**
 * Usage threshold constants for color coding (matching UsageIndicator)
 */
const THRESHOLD_CRITICAL = 95;  // Red: At or near limit
const THRESHOLD_WARNING = 91;   // Orange: Very high usage
const THRESHOLD_ELEVATED = 71;  // Yellow: Moderate usage

/**
 * Get color class based on usage percentage
 */
const getColorClass = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'text-red-500';
  if (percent >= THRESHOLD_WARNING) return 'text-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'text-yellow-500';
  return 'text-green-500';
};

/**
 * Get background class for progress bars
 */
const getBarColorClass = (percent: number): string => {
  if (percent >= THRESHOLD_CRITICAL) return 'bg-red-500';
  if (percent >= THRESHOLD_WARNING) return 'bg-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'bg-yellow-500';
  return 'bg-green-500';
};

const PROVIDER_BADGE_COLORS: Record<string, string> = {
  'anthropic': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  'openai': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  'google': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  'mistral': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  'groq': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  'xai': 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  'amazon-bedrock': 'bg-orange-600/10 text-orange-600 border-orange-600/20',
  'azure': 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  'ollama': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  'openai-compatible': 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  'zai': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  'openrouter': 'bg-violet-500/10 text-violet-500 border-violet-500/20',
};

const getProviderDisplayName = (provider?: string): string => {
  return PROVIDER_REGISTRY.find((entry) => entry.id === provider)?.name ?? provider ?? 'Unknown';
};

/**
 * Get status label key based on usage
 */
const getStatusKey = (sessionPercent?: number, weeklyPercent?: number, isRateLimited?: boolean): string => {
  const atOrBeyondLimit = (sessionPercent ?? 0) >= 100 || (weeklyPercent ?? 0) >= 100;
  if (isRateLimited || atOrBeyondLimit) return 'rateLimited';
  const maxPercent = Math.max(sessionPercent ?? 0, weeklyPercent ?? 0);
  if (maxPercent >= THRESHOLD_CRITICAL) return 'nearLimit';
  if (maxPercent >= THRESHOLD_WARNING) return 'highUsage';
  if (maxPercent >= THRESHOLD_ELEVATED) return 'moderate';
  return 'healthy';
};

/**
 * Unified account representation for the priority list
 */
export interface UnifiedAccount {
  id: string;
  name: string;
  type: 'oauth' | 'api';
  provider?: string;
  displayName: string;
  identifier: string; // email for OAuth, baseUrl for API
  isActive: boolean;  // TRUE only for the ONE account currently in use
  isNext: boolean;
  isAvailable: boolean;
  hasUnlimitedUsage: boolean;
  sessionPercent?: number;
  weeklyPercent?: number;
  isRateLimited?: boolean;
  rateLimitType?: 'session' | 'weekly';
  isAuthenticated?: boolean;
  /** Set when this account has identical usage to another - may indicate same underlying account */
  isDuplicateUsage?: boolean;
  /** Set when this account has an invalid refresh token and needs re-authentication */
  needsReauthentication?: boolean;
  /** Best-effort account-level identity used to reduce duplicate false positives */
  profileEmail?: string;
}

interface SortableAccountItemProps {
  account: UnifiedAccount;
  index: number;
  onSetActive?: (accountId: string) => void;
}

function SortableAccountItem({ account, index, onSetActive }: SortableAccountItemProps) {
  const { t } = useTranslation('settings');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: account.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined
  };

  const statusKey = getStatusKey(account.sessionPercent, account.weeklyPercent, account.isRateLimited);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-all',
        isDragging && 'opacity-60 shadow-lg scale-[1.02]',
        account.isActive
          ? 'border-primary bg-primary/5'
          : account.isAvailable
            ? 'border-border bg-background hover:bg-muted/50'
            : 'border-border/50 bg-muted/20 opacity-60'
      )}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Priority number */}
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
        {index + 1}
      </div>

      {/* Account icon - visual distinction between OAuth and API */}
      <div className={cn(
        "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
        account.type === 'oauth' ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
      )}>
        {account.type === 'oauth' ? (
          <Users className="h-4 w-4" />
        ) : (
          <Server className="h-4 w-4" />
        )}
      </div>

      {/* Account info and usage */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">
            {account.displayName}
          </span>
          {/* Provider label */}
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border",
            PROVIDER_BADGE_COLORS[account.provider ?? ''] ?? 'bg-muted text-muted-foreground border-border'
          )}>
            {getProviderDisplayName(account.provider)}
          </span>
          {/* Account type indicator */}
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
            {account.type === 'oauth' ? t('accounts.priority.typeOAuth') : t('accounts.priority.typeAPI')}
          </span>
          {/* Status badges - only ONE account should have "In Use" */}
          {account.isActive && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
              <Star className="h-2.5 w-2.5" />
              {t('accounts.priority.inUse')}
            </span>
          )}
          {account.isNext && !account.isActive && (
            <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded flex items-center gap-1">
              <Tag className="h-2.5 w-2.5" />
              {t('accounts.priority.next')}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate block">
          {account.identifier}
        </span>

        {/* Usage bars for OAuth accounts */}
        {account.type === 'oauth' && account.isAvailable && account.sessionPercent !== undefined && (
          <div className="flex items-center gap-3 mt-2">
            {/* Session usage */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                  <Clock className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", getBarColorClass(account.sessionPercent))}
                      style={{ width: `${Math.min(account.sessionPercent, 100)}%` }}
                    />
                  </div>
                  <span className={cn("text-[10px] tabular-nums font-medium w-8", getColorClass(account.sessionPercent))}>
                    {Math.round(account.sessionPercent)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t('accounts.priority.sessionUsage')}
              </TooltipContent>
            </Tooltip>

            {/* Weekly usage */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                  <TrendingUp className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", getBarColorClass(account.weeklyPercent ?? 0))}
                      style={{ width: `${Math.min(account.weeklyPercent ?? 0, 100)}%` }}
                    />
                  </div>
                  <span className={cn("text-[10px] tabular-nums font-medium w-8", getColorClass(account.weeklyPercent ?? 0))}>
                    {Math.round(account.weeklyPercent ?? 0)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t('accounts.priority.weeklyUsage')}
              </TooltipContent>
            </Tooltip>

            {/* Status indicator */}
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded shrink-0",
              statusKey === 'healthy' && 'bg-green-500/10 text-green-600',
              statusKey === 'moderate' && 'bg-yellow-500/10 text-yellow-600',
              statusKey === 'highUsage' && 'bg-orange-500/10 text-orange-600',
              statusKey === 'nearLimit' && 'bg-red-500/10 text-red-600',
              statusKey === 'rateLimited' && 'bg-red-500/20 text-red-600 font-medium'
            )}>
              {t(`accounts.priority.status.${statusKey}`)}
            </span>
          </div>
        )}

        {/* OAuth account not authenticated */}
        {account.type === 'oauth' && !account.isAvailable && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <AlertCircle className="h-3 w-3 text-destructive" />
            <span className="text-[10px] text-destructive">
              {t('accounts.priority.needsAuth')}
            </span>
          </div>
        )}

        {/* Duplicate usage warning - may indicate same underlying OAuth account */}
        {account.type === 'oauth' && account.isDuplicateUsage && account.isAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 mt-1.5 cursor-help">
                <AlertCircle className="h-3 w-3 text-warning" />
                <span className="text-[10px] text-warning">
                  {t('accounts.priority.duplicateUsage')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[250px]">
              {t('accounts.priority.duplicateUsageHint')}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Needs re-authentication warning - invalid refresh token */}
        {account.type === 'oauth' && account.needsReauthentication && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 mt-1.5 cursor-help">
                <AlertCircle className="h-3 w-3 text-destructive" />
                <span className="text-[10px] text-destructive">
                  {t('accounts.priority.needsReauth')}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[250px]">
              {t('accounts.priority.needsReauthHint')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Set Active button - only shown for non-active accounts */}
        {onSetActive && !account.isActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSetActive(account.id)}
                className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {t('accounts.priority.setActiveTooltip')}
            </TooltipContent>
          </Tooltip>
        )}
        {/* Pay-per-use badge for API profiles */}
        {account.type === 'api' && (
          <span className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded flex items-center gap-1">
            <Infinity className="h-3 w-3" />
            {t('accounts.priority.payPerUse')}
          </span>
        )}
      </div>
    </div>
  );
}

interface AccountPriorityListProps {
  accounts: UnifiedAccount[];
  onReorder: (newOrder: string[]) => void;
  onSetActive?: (accountId: string) => void;
  isLoading?: boolean;
}

export function AccountPriorityList({ accounts, onReorder, onSetActive, isLoading }: AccountPriorityListProps) {
  const { t } = useTranslation('settings');
  const [items, setItems] = useState<UnifiedAccount[]>(accounts);

  // Sync with external accounts prop
  useEffect(() => {
    setItems(accounts);
  }, [accounts]);

  // Determine "next" account - first available account after the active one
  const nextAccountId = useMemo(() => {
    const activeIndex = items.findIndex(a => a.isActive);
    if (activeIndex === -1) {
      // No active account - first available is "next"
      return items.find(a => a.isAvailable)?.id ?? null;
    }
    for (let i = activeIndex + 1; i < items.length; i++) {
      if (items[i].isAvailable && !items[i].isActive) {
        return items[i].id;
      }
    }
    // Wrap around to beginning if needed
    for (let i = 0; i < activeIndex; i++) {
      if (items[i].isAvailable && !items[i].isActive) {
        return items[i].id;
      }
    }
    return null;
  }, [items]);

  // Detect duplicate usage - OAuth accounts with identical non-zero usage may be the same underlying account.
  // Prefer matching by provider + profile email when available to reduce false positives.
  const duplicateUsageIds = useMemo(() => {
    const duplicates = new Set<string>();
    const oauthAccounts = items.filter(a => a.type === 'oauth' && a.isAvailable);

    // Only check if we have 2+ OAuth accounts with usage data
    if (oauthAccounts.length < 2) return duplicates;

    // Build usage signature map
    const usageSignatures = new Map<string, string[]>();
    for (const account of oauthAccounts) {
      // Create a signature from usage percentages
      // Only consider it a duplicate if both session and weekly are defined and non-zero
      if (account.sessionPercent !== undefined && account.weeklyPercent !== undefined) {
        // Skip if both are 0 (could be new accounts or accounts with reset usage)
        if (account.sessionPercent === 0 && account.weeklyPercent === 0) continue;

        const normalizedEmail = account.profileEmail?.trim().toLowerCase();
        const providerPrefix = (account.provider ?? 'oauth').toLowerCase();
        const signature = normalizedEmail
          ? `${providerPrefix}:email:${normalizedEmail}:${account.sessionPercent}-${account.weeklyPercent}`
          : `${providerPrefix}:usage:${account.sessionPercent}-${account.weeklyPercent}`;
        const existing = usageSignatures.get(signature) ?? [];
        existing.push(account.id);
        usageSignatures.set(signature, existing);
      }
    }

    // Mark accounts with duplicate signatures
    for (const [, ids] of usageSignatures) {
      if (ids.length > 1) {
        ids.forEach(id => duplicates.add(id));
      }
    }

    return duplicates;
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((currentItems) => {
        const oldIndex = currentItems.findIndex((item) => item.id === active.id);
        const newIndex = currentItems.findIndex((item) => item.id === over.id);
        const newItems = arrayMove(currentItems, oldIndex, newIndex);

        // Notify parent of new order
        onReorder(newItems.map(item => item.id));

        return newItems;
      });
    }
  }, [onReorder]);

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">{t('accounts.priority.noAccounts')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-1">
          {t('accounts.priority.title')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t('accounts.priority.description')}
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map(item => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={cn(
            "space-y-2",
            isLoading && "opacity-50 pointer-events-none"
          )}>
            {items.map((account, index) => (
              <SortableAccountItem
                key={account.id}
                account={{
                  ...account,
                  isNext: account.id === nextAccountId,
                  isDuplicateUsage: duplicateUsageIds.has(account.id)
                }}
                index={index}
                onSetActive={onSetActive}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Explanatory tip - provider agnostic */}
      <div className="rounded-lg bg-info/10 border border-info/30 p-3 mt-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">{t('accounts.priority.tipTitle')}</p>
            <p>{t('accounts.priority.tipDescription')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
