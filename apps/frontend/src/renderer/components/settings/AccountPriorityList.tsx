/**
 * AccountPriorityList - Two-bucket drag-and-drop priority management
 *
 * Accounts can be ordered within the auto-switch priority queue or dragged into a
 * disabled bucket where they remain visible for manual task selection but are
 * excluded from automatic switching.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
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
  RefreshCw,
  Ban,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { UnifiedAccount } from '../../../shared/types/unified-account';

const THRESHOLD_CRITICAL = 95;
const THRESHOLD_WARNING = 91;
const THRESHOLD_ELEVATED = 71;

const PRIORITY_CONTAINER_ID = 'priority-order';
const DISABLED_CONTAINER_ID = 'disabled-order';

type AccountContainerId = typeof PRIORITY_CONTAINER_ID | typeof DISABLED_CONTAINER_ID;

function getColorClass(percent: number): string {
  if (percent >= THRESHOLD_CRITICAL) return 'text-red-500';
  if (percent >= THRESHOLD_WARNING) return 'text-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'text-yellow-500';
  return 'text-green-500';
}

function getBarColorClass(percent: number): string {
  if (percent >= THRESHOLD_CRITICAL) return 'bg-red-500';
  if (percent >= THRESHOLD_WARNING) return 'bg-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return 'bg-yellow-500';
  return 'bg-green-500';
}

function getStatusKey(sessionPercent?: number, weeklyPercent?: number, isRateLimited?: boolean): string {
  if (isRateLimited) return 'rateLimited';
  const maxPercent = Math.max(sessionPercent ?? 0, weeklyPercent ?? 0);
  if (maxPercent >= THRESHOLD_CRITICAL) return 'nearLimit';
  if (maxPercent >= THRESHOLD_WARNING) return 'highUsage';
  if (maxPercent >= THRESHOLD_ELEVATED) return 'moderate';
  return 'healthy';
}

interface SortableAccountItemProps {
  account: UnifiedAccount;
  index: number;
  isDisabledBucket?: boolean;
}

function SortableAccountItem({ account, index, isDisabledBucket = false }: SortableAccountItemProps) {
  const { t } = useTranslation('settings');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const statusKey = getStatusKey(account.sessionPercent, account.weeklyPercent, account.isRateLimited);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-all',
        isDragging && 'opacity-60 shadow-lg scale-[1.02]',
        isDisabledBucket
          ? 'border-border/70 bg-muted/20'
          : account.isActive
            ? 'border-primary bg-primary/5'
            : account.isAvailable
              ? 'border-border bg-background hover:bg-muted/50'
              : 'border-border/50 bg-muted/20 opacity-60'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
        {index + 1}
      </div>

      <div
        className={cn(
          'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
          account.type === 'oauth' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'
        )}
      >
        {account.type === 'oauth' ? <Users className="h-4 w-4" /> : <Server className="h-4 w-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">
            {account.displayName}
          </span>
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
            {account.type === 'oauth' ? t('accounts.priority.typeOAuth') : t('accounts.priority.typeAPI')}
          </span>
          {isDisabledBucket && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex items-center gap-1">
              <Ban className="h-2.5 w-2.5" />
              {t('accounts.priority.manualOnly', 'Manual only')}
            </span>
          )}
          {!isDisabledBucket && account.isActive && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
              <Star className="h-2.5 w-2.5" />
              {t('accounts.priority.inUse')}
            </span>
          )}
          {!isDisabledBucket && account.isNext && !account.isActive && (
            <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded flex items-center gap-1">
              <Tag className="h-2.5 w-2.5" />
              {t('accounts.priority.next')}
            </span>
          )}
        </div>

        <span className="text-xs text-muted-foreground truncate block">
          {account.identifier}
        </span>

        {account.type === 'oauth' && account.isAvailable && account.sessionPercent !== undefined && (
          <div className="flex items-center gap-3 mt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                  <Clock className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', getBarColorClass(account.sessionPercent))}
                      style={{ width: `${Math.min(account.sessionPercent, 100)}%` }}
                    />
                  </div>
                  <span className={cn('text-[10px] tabular-nums font-medium w-8', getColorClass(account.sessionPercent))}>
                    {Math.round(account.sessionPercent)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t('accounts.priority.sessionUsage')}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                  <TrendingUp className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', getBarColorClass(account.weeklyPercent ?? 0))}
                      style={{ width: `${Math.min(account.weeklyPercent ?? 0, 100)}%` }}
                    />
                  </div>
                  <span className={cn('text-[10px] tabular-nums font-medium w-8', getColorClass(account.weeklyPercent ?? 0))}>
                    {Math.round(account.weeklyPercent ?? 0)}%
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t('accounts.priority.weeklyUsage')}
              </TooltipContent>
            </Tooltip>

            {!isDisabledBucket && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded shrink-0',
                  statusKey === 'healthy' && 'bg-green-500/10 text-green-600',
                  statusKey === 'moderate' && 'bg-yellow-500/10 text-yellow-600',
                  statusKey === 'highUsage' && 'bg-orange-500/10 text-orange-600',
                  statusKey === 'nearLimit' && 'bg-red-500/10 text-red-600',
                  statusKey === 'rateLimited' && 'bg-red-500/20 text-red-600 font-medium'
                )}
              >
                {t(`accounts.priority.status.${statusKey}`)}
              </span>
            )}
          </div>
        )}

        {account.type === 'oauth' && !account.isAvailable && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <AlertCircle className="h-3 w-3 text-destructive" />
            <span className="text-[10px] text-destructive">
              {t('accounts.priority.needsAuth')}
            </span>
          </div>
        )}

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

      {account.type === 'api' && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded flex items-center gap-1">
            <Infinity className="h-3 w-3" />
            {t('accounts.priority.payPerUse')}
          </span>
        </div>
      )}
    </div>
  );
}

interface DroppableBucketProps {
  id: AccountContainerId;
  title: string;
  description: string;
  emptyLabel: string;
  accounts: UnifiedAccount[];
  isDisabledBucket?: boolean;
}

function DroppableBucket({
  id,
  title,
  description,
  emptyLabel,
  accounts,
  isDisabledBucket = false,
}: DroppableBucketProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'rounded-lg border p-3 min-h-[88px] transition-colors',
          isOver ? 'border-primary bg-primary/5' : 'border-border/60 bg-muted/10'
        )}
      >
        {accounts.length === 0 ? (
          <div className="h-full min-h-[56px] flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-md">
            {emptyLabel}
          </div>
        ) : (
          <SortableContext items={accounts.map((account) => account.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {accounts.map((account, index) => (
                <SortableAccountItem
                  key={account.id}
                  account={account}
                  index={index}
                  isDisabledBucket={isDisabledBucket}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}

interface AccountPriorityListProps {
  activeAccounts: UnifiedAccount[];
  disabledAccounts: UnifiedAccount[];
  onReorder: (activeOrder: string[], disabledIds: string[]) => void;
  isLoading?: boolean;
}

type ListState = {
  activeAccounts: UnifiedAccount[];
  disabledAccounts: UnifiedAccount[];
};

function findContainer(accountId: string, lists: ListState): AccountContainerId | null {
  if (accountId === PRIORITY_CONTAINER_ID || lists.activeAccounts.some((account) => account.id === accountId)) {
    return PRIORITY_CONTAINER_ID;
  }
  if (accountId === DISABLED_CONTAINER_ID || lists.disabledAccounts.some((account) => account.id === accountId)) {
    return DISABLED_CONTAINER_ID;
  }
  return null;
}

function getContainerAccounts(containerId: AccountContainerId, lists: ListState): UnifiedAccount[] {
  return containerId === PRIORITY_CONTAINER_ID ? lists.activeAccounts : lists.disabledAccounts;
}

function setContainerAccounts(
  containerId: AccountContainerId,
  lists: ListState,
  accounts: UnifiedAccount[]
): ListState {
  return containerId === PRIORITY_CONTAINER_ID
    ? { ...lists, activeAccounts: accounts }
    : { ...lists, disabledAccounts: accounts };
}

export function AccountPriorityList({
  activeAccounts,
  disabledAccounts,
  onReorder,
  isLoading,
}: AccountPriorityListProps) {
  const { t } = useTranslation('settings');
  const [lists, setLists] = useState<ListState>({ activeAccounts, disabledAccounts });

  useEffect(() => {
    setLists({ activeAccounts, disabledAccounts });
  }, [activeAccounts, disabledAccounts]);

  const nextAccountId = useMemo(() => {
    const activeIndex = lists.activeAccounts.findIndex((account) => account.isActive);
    if (activeIndex === -1) {
      return lists.activeAccounts.find((account) => account.isAvailable)?.id ?? null;
    }

    for (let index = activeIndex + 1; index < lists.activeAccounts.length; index += 1) {
      const candidate = lists.activeAccounts[index];
      if (candidate.isAvailable && !candidate.isActive) {
        return candidate.id;
      }
    }

    for (let index = 0; index < activeIndex; index += 1) {
      const candidate = lists.activeAccounts[index];
      if (candidate.isAvailable && !candidate.isActive) {
        return candidate.id;
      }
    }

    return null;
  }, [lists.activeAccounts]);

  const duplicateUsageIds = useMemo(() => {
    const duplicates = new Set<string>();
    const oauthAccounts = lists.activeAccounts.filter((account) => account.type === 'oauth' && account.isAvailable);

    if (oauthAccounts.length < 2) {
      return duplicates;
    }

    const usageSignatures = new Map<string, string[]>();
    for (const account of oauthAccounts) {
      if (account.sessionPercent === undefined || account.weeklyPercent === undefined) {
        continue;
      }
      if (account.sessionPercent === 0 && account.weeklyPercent === 0) {
        continue;
      }

      const signature = `${account.sessionPercent}-${account.weeklyPercent}`;
      const matchingAccounts = usageSignatures.get(signature) ?? [];
      matchingAccounts.push(account.id);
      usageSignatures.set(signature, matchingAccounts);
    }

    for (const matchingIds of usageSignatures.values()) {
      if (matchingIds.length > 1) {
        matchingIds.forEach((id) => duplicates.add(id));
      }
    }

    return duplicates;
  }, [lists.activeAccounts]);

  const decoratedLists = useMemo<ListState>(() => ({
    activeAccounts: lists.activeAccounts.map((account) => ({
      ...account,
      isNext: account.id === nextAccountId,
      isDuplicateUsage: duplicateUsageIds.has(account.id),
    })),
    disabledAccounts: lists.disabledAccounts.map((account) => ({
      ...account,
      isNext: false,
      isDuplicateUsage: false,
    })),
  }), [duplicateUsageIds, lists.activeAccounts, lists.disabledAccounts, nextAccountId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      return;
    }

    setLists((currentLists) => {
      const activeContainer = findContainer(String(active.id), currentLists);
      const overContainer = findContainer(String(over.id), currentLists);

      if (!activeContainer || !overContainer || activeContainer === overContainer) {
        return currentLists;
      }

      const activeContainerAccounts = [...getContainerAccounts(activeContainer, currentLists)];
      const overContainerAccounts = [...getContainerAccounts(overContainer, currentLists)];
      const activeIndex = activeContainerAccounts.findIndex((account) => account.id === active.id);

      if (activeIndex === -1) {
        return currentLists;
      }

      const [movedAccount] = activeContainerAccounts.splice(activeIndex, 1);
      const overIndex = over.id === overContainer
        ? overContainerAccounts.length
        : overContainerAccounts.findIndex((account) => account.id === over.id);
      const insertIndex = overIndex >= 0 ? overIndex : overContainerAccounts.length;
      overContainerAccounts.splice(insertIndex, 0, movedAccount);

      return setContainerAccounts(
        overContainer,
        setContainerAccounts(activeContainer, currentLists, activeContainerAccounts),
        overContainerAccounts
      );
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      return;
    }

    setLists((currentLists) => {
      const activeContainer = findContainer(String(active.id), currentLists);
      const overContainer = findContainer(String(over.id), currentLists);

      if (!activeContainer || !overContainer) {
        return currentLists;
      }

      let nextLists = currentLists;

      if (activeContainer === overContainer) {
        const containerAccounts = getContainerAccounts(activeContainer, currentLists);
        const oldIndex = containerAccounts.findIndex((account) => account.id === active.id);
        const newIndex = containerAccounts.findIndex((account) => account.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          nextLists = setContainerAccounts(
            activeContainer,
            currentLists,
            arrayMove(containerAccounts, oldIndex, newIndex)
          );
        }
      }

      onReorder(
        nextLists.activeAccounts.map((account) => account.id),
        nextLists.disabledAccounts.map((account) => account.id)
      );

      return nextLists;
    });
  }, [onReorder]);

  if (decoratedLists.activeAccounts.length === 0 && decoratedLists.disabledAccounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">{t('accounts.priority.noAccounts')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <RefreshCw className={cn('h-4 w-4 text-muted-foreground', isLoading && 'animate-spin')} />
        <div>
          <h5 className="text-sm font-medium text-foreground">
            {t('accounts.priority.title', 'Account Priority Order')}
          </h5>
          <p className="text-xs text-muted-foreground">
            {t('accounts.priority.description', 'Drag accounts between priority order and the disabled bucket for automatic switching.')}
          </p>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-4">
          <DroppableBucket
            id={PRIORITY_CONTAINER_ID}
            title={t('accounts.priority.activeTitle', 'Account Priority Order')}
            description={t('accounts.priority.activeDescription', 'These accounts are eligible for automatic switching from top to bottom.')}
            emptyLabel={t('accounts.priority.activeEmpty', 'Drop accounts here to re-enable automatic switching.')}
            accounts={decoratedLists.activeAccounts}
          />

          <DroppableBucket
            id={DISABLED_CONTAINER_ID}
            title={t('accounts.priority.disabledTitle', 'Disabled Account Switching')}
            description={t('accounts.priority.disabledDescription', 'Accounts in this bucket stay available for manual task selection but are skipped by automatic switching.')}
            emptyLabel={t('accounts.priority.disabledEmpty', 'Drag accounts here to keep them out of automatic switching.')}
            accounts={decoratedLists.disabledAccounts}
            isDisabledBucket
          />
        </div>
      </DndContext>
    </div>
  );
}
