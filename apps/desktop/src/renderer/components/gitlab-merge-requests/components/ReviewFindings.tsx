/**
 * ReviewFindings - Interactive findings display with selection and filtering
 *
 * Features:
 * - Grouped by severity (Critical/High vs Medium/Low)
 * - Checkboxes for selecting which findings to post
 * - Quick select actions (Critical/High, All, None)
 * - Collapsible sections for less important findings
 * - Visual summary of finding counts
 */

import { useState, useMemo } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { GitLabMRReviewFinding } from '../hooks/useGitLabMRs';
import { useFindingSelection } from '../hooks/useFindingSelection';
import { FindingsSummary } from './FindingsSummary';
import { SeverityGroupHeader } from './SeverityGroupHeader';
import { FindingItem } from './FindingItem';
import type { SeverityGroup } from '../constants/severity-config';
import { SEVERITY_ORDER, SEVERITY_CONFIG } from '../constants/severity-config';

interface ReviewFindingsProps {
  findings: GitLabMRReviewFinding[];
  selectedIds: Set<string>;
  postedIds?: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
}

export function ReviewFindings({
  findings,
  selectedIds,
  postedIds = new Set(),
  onSelectionChange,
}: ReviewFindingsProps) {
  // Track which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Set<SeverityGroup>>(
    new Set<SeverityGroup>(['critical', 'high']) // Critical and High expanded by default
  );

  // Group findings by severity
  const groupedFindings = useMemo(() => {
    const groups: Record<SeverityGroup, GitLabMRReviewFinding[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };

    for (const finding of findings) {
      const severity = finding.severity as SeverityGroup;
      if (groups[severity]) {
        groups[severity].push(finding);
      }
    }

    return groups;
  }, [findings]);

  // Count by severity
  const counts = useMemo(() => ({
    critical: groupedFindings.critical.length,
    high: groupedFindings.high.length,
    medium: groupedFindings.medium.length,
    low: groupedFindings.low.length,
    total: findings.length,
    important: groupedFindings.critical.length + groupedFindings.high.length,
  }), [groupedFindings, findings.length]);

  // Selection hooks
  const {
    toggleFinding,
    selectAll,
    selectNone,
    selectImportant,
    toggleSeverityGroup,
  } = useFindingSelection({
    findings,
    selectedIds,
    onSelectionChange,
    groupedFindings,
  });

  // Toggle section expansion
  const toggleSection = (severity: SeverityGroup) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary Stats Bar */}
      <FindingsSummary
        findings={findings}
        selectedCount={selectedIds.size}
      />

      {/* Quick Select Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={selectImportant}
          className="text-xs"
          disabled={counts.important === 0}
        >
          <AlertTriangle className="h-3 w-3 me-1" />
          Select Critical/High ({counts.important})
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={selectAll}
          className="text-xs"
        >
          <CheckSquare className="h-3 w-3 me-1" />
          Select All
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={selectNone}
          className="text-xs"
          disabled={selectedIds.size === 0}
        >
          <Square className="h-3 w-3 me-1" />
          Clear
        </Button>
      </div>

      {/* Grouped Findings */}
      <div className="space-y-3">
        {SEVERITY_ORDER.map((severity) => {
          const group = groupedFindings[severity];
          if (group.length === 0) return null;

          const config = SEVERITY_CONFIG[severity];
          const isExpanded = expandedSections.has(severity);
          const selectedInGroup = group.filter(f => selectedIds.has(f.id)).length;

          return (
            <div
              key={severity}
              className={cn(
                "rounded-lg border",
                config.bgColor
              )}
            >
              {/* Group Header */}
              <SeverityGroupHeader
                severity={severity}
                count={group.length}
                selectedCount={selectedInGroup}
                expanded={isExpanded}
                onToggle={() => toggleSection(severity)}
                onSelectAll={(e) => {
                  e.stopPropagation();
                  toggleSeverityGroup(severity);
                }}
              />

              {/* Group Content */}
              {isExpanded && (
                <div className="p-3 pt-0 space-y-2">
                  {group.map((finding) => (
                    <FindingItem
                      key={finding.id}
                      finding={finding}
                      selected={selectedIds.has(finding.id)}
                      posted={postedIds.has(finding.id)}
                      onToggle={() => toggleFinding(finding.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {findings.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-success" />
          <p className="text-sm">No issues found! The code looks good.</p>
        </div>
      )}
    </div>
  );
}
