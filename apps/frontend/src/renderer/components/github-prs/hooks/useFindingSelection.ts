/**
 * Custom hook for managing finding selection state and actions
 */

import { useCallback } from 'react';
import type { PRReviewFinding } from './useGitHubPRs';
import type { SeverityGroup } from '../constants/severity-config';

interface UseFindingSelectionProps {
  findings: PRReviewFinding[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  groupedFindings: Record<SeverityGroup, PRReviewFinding[]>;
}

export function useFindingSelection({
  findings,
  selectedIds,
  onSelectionChange,
  groupedFindings,
}: UseFindingSelectionProps) {
  // Toggle individual finding selection
  const toggleFinding = useCallback((id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  }, [selectedIds, onSelectionChange]);

  // Select all findings (preserving any disputed selections not in active findings)
  const selectAll = useCallback(() => {
    const activeIds = new Set(findings.map(f => f.id));
    // Preserve selections for disputed findings (IDs not in active findings list)
    for (const id of selectedIds) {
      if (!findings.some(f => f.id === id)) activeIds.add(id);
    }
    onSelectionChange(activeIds);
  }, [findings, selectedIds, onSelectionChange]);

  // Clear all selections
  const selectNone = useCallback(() => {
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  // Select only critical and high severity findings (preserving disputed selections)
  const selectImportant = useCallback(() => {
    const important = [...groupedFindings.critical, ...groupedFindings.high];
    const importantIds = new Set(important.map(f => f.id));
    // Preserve selections for disputed findings (IDs not in active findings list)
    for (const id of selectedIds) {
      if (!findings.some(f => f.id === id)) importantIds.add(id);
    }
    onSelectionChange(importantIds);
  }, [groupedFindings, findings, selectedIds, onSelectionChange]);

  // Toggle entire severity group selection
  const toggleSeverityGroup = useCallback((severity: SeverityGroup) => {
    const groupFindings = groupedFindings[severity];
    const allSelected = groupFindings.every(f => selectedIds.has(f.id));

    const next = new Set(selectedIds);
    if (allSelected) {
      // Deselect all in group
      for (const f of groupFindings) {
        next.delete(f.id);
      }
    } else {
      // Select all in group
      for (const f of groupFindings) {
        next.add(f.id);
      }
    }
    onSelectionChange(next);
  }, [groupedFindings, selectedIds, onSelectionChange]);

  // Check if all findings in a group are selected
  const isGroupFullySelected = useCallback((severity: SeverityGroup) => {
    const groupFindings = groupedFindings[severity];
    return groupFindings.length > 0 && groupFindings.every(f => selectedIds.has(f.id));
  }, [groupedFindings, selectedIds]);

  // Check if some (but not all) findings in a group are selected
  const isGroupPartiallySelected = useCallback((severity: SeverityGroup) => {
    const groupFindings = groupedFindings[severity];
    const selectedCount = groupFindings.filter(f => selectedIds.has(f.id)).length;
    return selectedCount > 0 && selectedCount < groupFindings.length;
  }, [groupedFindings, selectedIds]);

  return {
    toggleFinding,
    selectAll,
    selectNone,
    selectImportant,
    toggleSeverityGroup,
    isGroupFullySelected,
    isGroupPartiallySelected,
  };
}
