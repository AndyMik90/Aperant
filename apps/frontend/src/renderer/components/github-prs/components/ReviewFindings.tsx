/**
 * ReviewFindings - Interactive findings display with selection and filtering
 *
 * Features:
 * - Grouped by severity (Critical/High vs Medium/Low)
 * - Checkboxes for selecting which findings to post
 * - Quick select actions (Critical/High, All, None)
 * - Collapsible sections for less important findings
 * - Visual summary of finding counts
 * - Disputed findings shown in a separate collapsible section
 */

import { useState, useMemo } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  CheckSquare,
  Square,
  Send,
  ChevronDown,
  ChevronRight,
  ShieldQuestion,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { PRReviewFinding } from '../hooks/useGitHubPRs';
import { useFindingSelection } from '../hooks/useFindingSelection';
import { FindingsSummary } from './FindingsSummary';
import { SeverityGroupHeader } from './SeverityGroupHeader';
import { FindingItem } from './FindingItem';
import type { SeverityGroup } from '../constants/severity-config';
import { SEVERITY_ORDER, SEVERITY_CONFIG } from '../constants/severity-config';

interface ReviewFindingsProps {
  findings: PRReviewFinding[];
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
  const { t } = useTranslation('common');

  // Track which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Set<SeverityGroup>>(
    new Set<SeverityGroup>(['critical', 'high']) // Critical and High expanded by default
  );
  const [disputedExpanded, setDisputedExpanded] = useState(false);

  // Filter out posted findings - only show unposted findings for selection
  const unpostedFindings = useMemo(() =>
    findings.filter(f => !postedIds.has(f.id)),
    [findings, postedIds]
  );

  // Split unposted findings into active vs disputed (single pass)
  const { activeFindings, disputedFindings } = useMemo(() => {
    const active: PRReviewFinding[] = [];
    const disputed: PRReviewFinding[] = [];
    for (const finding of unpostedFindings) {
      if (finding.validationStatus === 'dismissed_false_positive') {
        disputed.push(finding);
      } else {
        active.push(finding);
      }
    }
    return { activeFindings: active, disputedFindings: disputed };
  }, [unpostedFindings]);

  // Check if all findings are posted
  const allFindingsPosted = findings.length > 0 && unpostedFindings.length === 0;

  // Group ACTIVE unposted findings by severity (disputed go in their own section)
  const groupedFindings = useMemo(() => {
    const groups: Record<SeverityGroup, PRReviewFinding[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };

    for (const finding of activeFindings) {
      const severity = finding.severity as SeverityGroup;
      if (groups[severity]) {
        groups[severity].push(finding);
      }
    }

    return groups;
  }, [activeFindings]);

  // Count by severity (active findings only)
  const counts = useMemo(() => ({
    critical: groupedFindings.critical.length,
    high: groupedFindings.high.length,
    medium: groupedFindings.medium.length,
    low: groupedFindings.low.length,
    total: activeFindings.length,
    important: groupedFindings.critical.length + groupedFindings.high.length,
    posted: postedIds.size,
  }), [groupedFindings, activeFindings.length, postedIds.size]);

  // Selection hooks - use ACTIVE unposted findings only (Select All excludes disputed)
  const {
    toggleFinding,
    selectAll,
    selectNone,
    selectImportant,
    toggleSeverityGroup,
  } = useFindingSelection({
    findings: activeFindings,
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

  // Count only active findings that are selected (excludes disputed from count)
  const selectedActiveCount = useMemo(
    () => activeFindings.filter(f => selectedIds.has(f.id)).length,
    [activeFindings, selectedIds]
  );

  // When all findings have been posted, show a success message instead of the selection UI
  if (allFindingsPosted) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 text-muted-foreground bg-success/5 rounded-lg border border-success/20">
          <Send className="h-8 w-8 mx-auto mb-2 text-success" />
          <p className="text-sm font-medium text-success">{t('prReview.allFindingsPosted')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('prReview.findingsPostedCount', { count: counts.posted })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats Bar - show active findings + disputed count */}
      <FindingsSummary
        findings={activeFindings}
        selectedCount={selectedActiveCount}
        disputedCount={disputedFindings.length}
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
          <AlertTriangle className="h-3 w-3 mr-1" />
          {t('prReview.selectCriticalHigh', { count: counts.important })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={selectAll}
          className="text-xs"
        >
          <CheckSquare className="h-3 w-3 mr-1" />
          {t('prReview.selectAll')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={selectNone}
          className="text-xs"
          disabled={selectedIds.size === 0}
        >
          <Square className="h-3 w-3 mr-1" />
          {t('prReview.clear')}
        </Button>
      </div>

      {/* Grouped Findings (active only) */}
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
                      posted={false}
                      onToggle={() => toggleFinding(finding.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Disputed Findings Section */}
      {disputedFindings.length > 0 && (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5">
          {/* Disputed Header */}
          <button
            type="button"
            onClick={() => setDisputedExpanded(!disputedExpanded)}
            aria-expanded={disputedExpanded}
            className="w-full flex items-center gap-2 p-3 text-left hover:bg-purple-500/10 transition-colors rounded-t-lg"
          >
            {disputedExpanded ? (
              <ChevronDown className="h-4 w-4 text-purple-500 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-purple-500 shrink-0" />
            )}
            <ShieldQuestion className="h-4 w-4 text-purple-500 shrink-0" />
            <span className="text-sm font-medium text-purple-500">
              {t('prReview.disputedByValidator', { count: disputedFindings.length })}
            </span>
          </button>

          {/* Disputed Content */}
          {disputedExpanded && (
            <div className="p-3 pt-0 space-y-2">
              <p className="text-xs text-muted-foreground italic mb-2">
                {t('prReview.disputedSectionHint')}
              </p>
              {disputedFindings.map((finding) => (
                <FindingItem
                  key={finding.id}
                  finding={finding}
                  selected={selectedIds.has(finding.id)}
                  posted={false}
                  disputed
                  onToggle={() => toggleFinding(finding.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty State - no findings at all */}
      {findings.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-success" />
          <p className="text-sm">{t('prReview.noIssuesFound')}</p>
        </div>
      )}
    </div>
  );
}
