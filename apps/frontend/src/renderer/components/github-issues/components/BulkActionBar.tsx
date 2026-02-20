import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkActionType, BulkOperationProgress } from '@shared/types/mutations';
import { estimateBatchCost } from '@shared/constants/ai-triage';

interface BulkActionBarProps {
  selectedCount: number;
  onBulkAction: (action: BulkActionType, payload?: Record<string, unknown>) => void;
  isOperating: boolean;
  progress?: BulkOperationProgress | null;
  untriagedCount?: number;
  onTriageAll?: () => void;
  onInvestigateSelected?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
}

const BULK_ACTIONS: Array<{ action: BulkActionType; labelKey: string }> = [
  { action: 'close', labelKey: 'bulk.actionClose' },
  { action: 'reopen', labelKey: 'bulk.actionReopen' },
  { action: 'add-label', labelKey: 'bulk.actionAddLabel' },
  { action: 'remove-label', labelKey: 'bulk.actionRemoveLabel' },
  { action: 'add-assignee', labelKey: 'bulk.actionAssign' },
  { action: 'remove-assignee', labelKey: 'bulk.actionUnassign' },
];

export function BulkActionBar({
  selectedCount,
  onBulkAction,
  isOperating,
  progress,
  untriagedCount,
  onTriageAll,
  onInvestigateSelected,
  onSelectAll,
  onDeselectAll,
}: BulkActionBarProps) {
  const { t } = useTranslation('common');
  const [pendingAction, setPendingAction] = useState<BulkActionType | null>(null);
  const [pendingPayloadInput, setPendingPayloadInput] = useState('');
  const [pendingTriageAll, setPendingTriageAll] = useState(false);
  const [pendingInvestigate, setPendingInvestigate] = useState(false);

  const noneSelected = selectedCount === 0;

  const requiresPayload = (action: BulkActionType): boolean =>
    action === 'add-label'
    || action === 'remove-label'
    || action === 'add-assignee'
    || action === 'remove-assignee';

  const payloadKind = (action: BulkActionType): 'labels' | 'assignees' | null => {
    if (action === 'add-label' || action === 'remove-label') return 'labels';
    if (action === 'add-assignee' || action === 'remove-assignee') return 'assignees';
    return null;
  };

  const parsedPayloadValues = pendingPayloadInput
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const payloadRequired = pendingAction ? requiresPayload(pendingAction) : false;
  const canConfirm = pendingAction
    ? !payloadRequired || parsedPayloadValues.length > 0
    : false;

  const handleConfirm = () => {
    if (pendingAction) {
      let payload: Record<string, unknown> | undefined;
      if (payloadRequired) {
        const kind = payloadKind(pendingAction);
        if (!kind || parsedPayloadValues.length === 0) return;
        payload = { [kind]: parsedPayloadValues };
      }
      if (payload) {
        onBulkAction(pendingAction, payload);
      } else {
        onBulkAction(pendingAction);
      }
      setPendingAction(null);
      setPendingPayloadInput('');
    }
  };

  const handleCancel = () => {
    setPendingAction(null);
    setPendingPayloadInput('');
  };

  return (
    <div
      role="toolbar"
      aria-label={t('bulk.actions')}
      className="flex flex-wrap items-center gap-2 mt-3"
    >
      <span className="text-sm font-medium text-foreground">
        {t('bulk.selected', { count: selectedCount })}
      </span>

      {onSelectAll && (
        <button
          type="button"
          className="px-2 py-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isOperating}
          onClick={onSelectAll}
        >
          {t('phase5.selectAll')}
        </button>
      )}
      {onDeselectAll && (
        <button
          type="button"
          className="px-2 py-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isOperating}
          onClick={onDeselectAll}
        >
          {t('phase5.deselectAll')}
        </button>
      )}

      {pendingAction && !noneSelected ? (
        <div className="flex items-center gap-2 ml-2" role="alert">
          <span className="text-xs text-foreground">
            {t('bulk.confirmMessage', { action: pendingAction, count: selectedCount })}
          </span>
          {payloadRequired && (
            <input
              type="text"
              value={pendingPayloadInput}
              onChange={(event) => setPendingPayloadInput(event.target.value)}
              placeholder={t(
                payloadKind(pendingAction) === 'labels'
                  ? 'bulk.payloadPlaceholderLabels'
                  : 'bulk.payloadPlaceholderAssignees',
                payloadKind(pendingAction) === 'labels'
                  ? 'Comma-separated labels'
                  : 'Comma-separated assignees',
              )}
              className="h-7 w-56 rounded border border-border bg-background px-2 text-xs text-foreground"
              aria-label={t(
                payloadKind(pendingAction) === 'labels'
                  ? 'bulk.payloadPlaceholderLabels'
                  : 'bulk.payloadPlaceholderAssignees',
                payloadKind(pendingAction) === 'labels'
                  ? 'Comma-separated labels'
                  : 'Comma-separated assignees',
              )}
            />
          )}
          <button
            type="button"
            className="px-2.5 py-1 text-xs rounded-md border border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {t('bulk.confirm')}
          </button>
          <button
            type="button"
            className="px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent"
            onClick={handleCancel}
          >
            {t('bulk.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 ml-2">
          {BULK_ACTIONS.map(({ action, labelKey }) => (
            <button
              key={action}
              type="button"
              className="px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isOperating || noneSelected}
              onClick={() => {
                setPendingAction(action);
                setPendingPayloadInput('');
              }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}

      {onTriageAll && untriagedCount != null && untriagedCount > 0 && (
        pendingTriageAll ? (
          <div className="flex items-center gap-2 ml-2" role="alert">
            <span className="text-xs text-foreground">
              {t('aiTriage.confirmTriage', { count: untriagedCount, cost: estimateBatchCost(untriagedCount, 'sonnet') })}
            </span>
            <button
              type="button"
              className="px-2.5 py-1 text-xs rounded-md border border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => { onTriageAll(); setPendingTriageAll(false); }}
            >
              {t('bulk.confirm')}
            </button>
            <button
              type="button"
              className="px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent"
              onClick={() => setPendingTriageAll(false)}
            >
              {t('bulk.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ml-2 px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isOperating}
            onClick={() => setPendingTriageAll(true)}
            aria-label={t('aiTriage.triageAllButton')}
          >
            {t('aiTriage.triageAllButton')}
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              {untriagedCount}
            </span>
          </button>
        )
      )}

      {onInvestigateSelected && (
        pendingInvestigate && !noneSelected ? (
          <div className="flex items-center gap-2 ml-2" role="alert">
            <span className="text-xs text-foreground">
              {t('investigation.button.bulkInvestigateConfirm', { count: selectedCount })}
            </span>
            <button
              type="button"
              className="px-2.5 py-1 text-xs rounded-md border border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => { onInvestigateSelected(); setPendingInvestigate(false); }}
            >
              {t('bulk.confirm')}
            </button>
            <button
              type="button"
              className="px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent"
              onClick={() => setPendingInvestigate(false)}
            >
              {t('bulk.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ml-2 px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isOperating || noneSelected}
            onClick={() => setPendingInvestigate(true)}
            aria-label={t('investigation.button.investigateSelected')}
          >
            {t('investigation.button.investigateSelected')}
            {selectedCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                {selectedCount}
              </span>
            )}
          </button>
        )
      )}

      {isOperating && progress && (
        <span className="ml-auto text-xs text-muted-foreground">
          {t('bulk.processing', { current: progress.processedItems, total: progress.totalItems })}
        </span>
      )}
    </div>
  );
}
