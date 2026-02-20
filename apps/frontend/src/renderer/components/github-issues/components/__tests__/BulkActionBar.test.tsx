/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '../BulkActionBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@shared/constants/ai-triage', () => ({
  estimateBatchCost: (count: number) => `~$${(count * 0.0035).toFixed(2)}`,
}));

describe('BulkActionBar', () => {
  it('renders with disabled action buttons when selectedCount is 0', () => {
    render(
      <BulkActionBar
        selectedCount={0}
        onBulkAction={vi.fn()}
        isOperating={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onInvestigateSelected={vi.fn()}
      />,
    );
    // Toolbar is still rendered
    expect(screen.getByRole('toolbar')).toBeDefined();
    // Action buttons should be disabled
    const closeBtn = screen.getByText('bulk.actionClose');
    expect(closeBtn.hasAttribute('disabled')).toBe(true);
    // Select All / Deselect All remain enabled
    expect(screen.getByText('phase5.selectAll').hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('phase5.deselectAll').hasAttribute('disabled')).toBe(false);
    // Investigate button should be disabled
    const investigateBtn = screen.getByText('investigation.button.investigateSelected');
    expect(investigateBtn.hasAttribute('disabled')).toBe(true);
  });

  it('shows selected count text', () => {
    render(
      <BulkActionBar
        selectedCount={5}
        onBulkAction={vi.fn()}
        isOperating={false}
      />,
    );
    expect(screen.getByText('bulk.selected')).toBeDefined();
  });

  it('Close button shows confirmation, confirm fires onBulkAction', () => {
    const onBulkAction = vi.fn();
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={onBulkAction}
        isOperating={false}
      />,
    );
    // Click Close — should show confirm prompt, NOT fire immediately
    fireEvent.click(screen.getByText('bulk.actionClose'));
    expect(onBulkAction).not.toHaveBeenCalled();
    expect(screen.getByText('bulk.confirmMessage')).toBeDefined();
    // Click Confirm — should fire onBulkAction
    fireEvent.click(screen.getByText('bulk.confirm'));
    expect(onBulkAction).toHaveBeenCalledWith('close');
  });

  it('Cancel in confirmation reverts to action buttons', () => {
    const onBulkAction = vi.fn();
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={onBulkAction}
        isOperating={false}
      />,
    );
    fireEvent.click(screen.getByText('bulk.actionClose'));
    expect(screen.getByText('bulk.confirmMessage')).toBeDefined();
    // Click Cancel
    fireEvent.click(screen.getByText('bulk.cancel'));
    expect(onBulkAction).not.toHaveBeenCalled();
    // Action buttons should be back
    expect(screen.getByText('bulk.actionClose')).toBeDefined();
  });

  it('Add Label requires payload and sends parsed labels', () => {
    const onBulkAction = vi.fn();
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={onBulkAction}
        isOperating={false}
      />,
    );

    fireEvent.click(screen.getByText('bulk.actionAddLabel'));
    const confirmBtn = screen.getByText('bulk.confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    const input = screen.getByPlaceholderText('bulk.payloadPlaceholderLabels');
    fireEvent.change(input, { target: { value: 'bug, needs-triage ' } });

    fireEvent.click(screen.getByText('bulk.confirm'));
    expect(onBulkAction).toHaveBeenCalledWith('add-label', {
      labels: ['bug', 'needs-triage'],
    });
  });

  it('Assign requires payload and sends parsed assignees', () => {
    const onBulkAction = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={onBulkAction}
        isOperating={false}
      />,
    );

    fireEvent.click(screen.getByText('bulk.actionAssign'));
    const input = screen.getByPlaceholderText('bulk.payloadPlaceholderAssignees');
    fireEvent.change(input, { target: { value: 'octocat' } });

    fireEvent.click(screen.getByText('bulk.confirm'));
    expect(onBulkAction).toHaveBeenCalledWith('add-assignee', {
      assignees: ['octocat'],
    });
  });

  it('confirmation dialog has role=alert', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
      />,
    );
    fireEvent.click(screen.getByText('bulk.actionClose'));
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('has role="toolbar"', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
      />,
    );
    expect(screen.getByRole('toolbar')).toBeDefined();
  });

  it('has i18n aria-label on toolbar', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
      />,
    );
    expect(
      screen.getByRole('toolbar').getAttribute('aria-label'),
    ).toBe('bulk.actions');
  });

  it('all buttons disabled when isOperating', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={true}
        progress={{
          action: 'close',
          totalItems: 2,
          processedItems: 1,
        }}
      />,
    );
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });

  it('progress text shown during operation', () => {
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={vi.fn()}
        isOperating={true}
        progress={{
          action: 'close',
          totalItems: 5,
          processedItems: 2,
        }}
      />,
    );
    expect(screen.getByText('bulk.processing')).toBeDefined();
  });

  it('renders Select All button when onSelectAll provided', () => {
    const onSelectAll = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
        onSelectAll={onSelectAll}
      />,
    );
    const btn = screen.getByText('phase5.selectAll');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('renders Deselect All button when onDeselectAll provided', () => {
    const onDeselectAll = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
        onDeselectAll={onDeselectAll}
      />,
    );
    const btn = screen.getByText('phase5.deselectAll');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onDeselectAll).toHaveBeenCalled();
  });

  it('does not render Select All / Deselect All when callbacks not provided', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={false}
      />,
    );
    expect(screen.queryByText('phase5.selectAll')).toBeNull();
    expect(screen.queryByText('phase5.deselectAll')).toBeNull();
  });

  it('Select All and Deselect All disabled when isOperating', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        onBulkAction={vi.fn()}
        isOperating={true}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        progress={{ action: 'close', totalItems: 2, processedItems: 1 }}
      />,
    );
    const selectAllBtn = screen.getByText('phase5.selectAll');
    const deselectAllBtn = screen.getByText('phase5.deselectAll');
    expect(selectAllBtn.hasAttribute('disabled')).toBe(true);
    expect(deselectAllBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Triage All button has aria-label', () => {
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={vi.fn()}
        isOperating={false}
        untriagedCount={5}
        onTriageAll={vi.fn()}
      />,
    );
    const triageBtn = screen.getByRole('button', { name: 'aiTriage.triageAllButton' });
    expect(triageBtn).toBeDefined();
  });

  it('Triage All shows confirmation dialog with cost estimate before executing', () => {
    const onTriageAll = vi.fn();
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={vi.fn()}
        isOperating={false}
        untriagedCount={5}
        onTriageAll={onTriageAll}
      />,
    );
    // Click Triage All — should NOT fire immediately
    fireEvent.click(screen.getByRole('button', { name: 'aiTriage.triageAllButton' }));
    expect(onTriageAll).not.toHaveBeenCalled();
    // Confirmation dialog should appear with cost estimate text
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('aiTriage.confirmTriage')).toBeDefined();
    // Confirm fires onTriageAll
    fireEvent.click(screen.getByText('bulk.confirm'));
    expect(onTriageAll).toHaveBeenCalledTimes(1);
  });

  it('Triage All confirmation can be cancelled', () => {
    const onTriageAll = vi.fn();
    render(
      <BulkActionBar
        selectedCount={3}
        onBulkAction={vi.fn()}
        isOperating={false}
        untriagedCount={5}
        onTriageAll={onTriageAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'aiTriage.triageAllButton' }));
    expect(screen.getByRole('alert')).toBeDefined();
    // Cancel
    fireEvent.click(screen.getByText('bulk.cancel'));
    expect(onTriageAll).not.toHaveBeenCalled();
    // Button should be back
    expect(screen.getByRole('button', { name: 'aiTriage.triageAllButton' })).toBeDefined();
  });
});
