import { useState, useMemo } from 'react';
import {
  Clock,
  GitPullRequest,
  CheckCircle,
  XCircle,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Bug,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { MemoryEpisode } from '../../../shared/types';
import { formatDate } from './utils';

interface PRReviewCardProps {
  memory: MemoryEpisode;
}

interface ParsedPRReview {
  prNumber: number;
  repo: string;
  verdict: 'approve' | 'request_changes' | 'comment';
  timestamp: string;
  summary: {
    verdict: string;
    finding_counts: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    total_findings: number;
  };
  keyFindings: Array<{
    severity: string;
    message: string;
    file?: string;
    line?: number;
  }>;
  patterns: string[];
  gotchas: string[];
  isFollowup: boolean;
  previousReviews?: number;
}

function parsePRReviewContent(content: string): ParsedPRReview | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function VerdictBadge({ verdict }: { verdict: string }) {
  switch (verdict) {
    case 'approve':
      return (
        <Badge className="bg-green-500/10 text-green-400 border-green-500/30 gap-1">
          <CheckCircle className="h-3 w-3" />
          Approved
        </Badge>
      );
    case 'request_changes':
      return (
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1">
          <XCircle className="h-3 w-3" />
          Changes Requested
        </Badge>
      );
    case 'comment':
      return (
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 gap-1">
          <MessageSquare className="h-3 w-3" />
          Commented
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          {verdict}
        </Badge>
      );
  }
}

function SeverityBadge({ severity, count }: { severity: string; count: number }) {
  if (count === 0) return null;

  const colorMap: Record<string, string> = {
    critical: 'bg-red-600/20 text-red-400 border-red-600/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  };

  return (
    <Badge className={`${colorMap[severity] || 'bg-muted'} text-xs font-mono`}>
      {count} {severity}
    </Badge>
  );
}

export function PRReviewCard({ memory }: PRReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = useMemo(() => parsePRReviewContent(memory.content), [memory.content]);

  if (!parsed) {
    // Fallback for non-parseable content
    return (
      <Card className="bg-muted/30 border-border/50">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-cyan-400" />
            <Badge variant="outline">PR Review</Badge>
            <span className="text-xs text-muted-foreground">{formatDate(memory.createdAt)}</span>
          </div>
          <pre className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {memory.content}
          </pre>
        </CardContent>
      </Card>
    );
  }

  const { finding_counts } = parsed.summary || { finding_counts: { critical: 0, high: 0, medium: 0, low: 0 } };
  const totalFindings = (finding_counts?.critical || 0) + (finding_counts?.high || 0) +
                       (finding_counts?.medium || 0) + (finding_counts?.low || 0);
  const hasGotchas = parsed.gotchas && parsed.gotchas.length > 0;
  const hasPatterns = parsed.patterns && parsed.patterns.length > 0;
  const hasFindings = parsed.keyFindings && parsed.keyFindings.length > 0;
  const hasExpandableContent = hasGotchas || hasPatterns || hasFindings;

  return (
    <Card className="bg-muted/30 border-border/50 hover:border-cyan-500/30 transition-colors">
      <CardContent className="pt-4 pb-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <GitPullRequest className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              {/* PR Info Row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">
                  PR #{parsed.prNumber}
                </span>
                <span className="text-muted-foreground text-sm truncate max-w-[200px]" title={parsed.repo}>
                  {parsed.repo}
                </span>
                {parsed.isFollowup && (
                  <Badge variant="secondary" className="text-xs">
                    Follow-up
                  </Badge>
                )}
              </div>

              {/* Verdict & Stats Row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <VerdictBadge verdict={parsed.verdict} />
                {totalFindings > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {totalFindings} finding{totalFindings !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Severity Breakdown */}
              {totalFindings > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <SeverityBadge severity="critical" count={finding_counts?.critical || 0} />
                  <SeverityBadge severity="high" count={finding_counts?.high || 0} />
                  <SeverityBadge severity="medium" count={finding_counts?.medium || 0} />
                  <SeverityBadge severity="low" count={finding_counts?.low || 0} />
                </div>
              )}

              {/* Timestamp */}
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(memory.createdAt)}
              </div>
            </div>
          </div>

          {/* Expand Button */}
          {hasExpandableContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 gap-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Details
                </>
              )}
            </Button>
          )}
        </div>

        {/* Expanded Content */}
        {expanded && (
          <div className="mt-4 space-y-4 pt-4 border-t border-border/50">
            {/* Key Findings */}
            {hasFindings && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Bug className="h-4 w-4 text-orange-400" />
                  <span className="text-sm font-medium text-foreground">Key Findings</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {parsed.keyFindings.length}
                  </Badge>
                </div>
                <div className="space-y-2 ps-6">
                  {parsed.keyFindings.slice(0, 5).map((finding, idx) => (
                    <div key={idx} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`text-xs ${
                            finding.severity === 'critical' ? 'bg-red-600/20 text-red-400' :
                            finding.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                            finding.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {finding.severity}
                        </Badge>
                        {finding.file && (
                          <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                            {finding.file}{finding.line ? `:${finding.line}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1">{finding.message}</p>
                    </div>
                  ))}
                  {parsed.keyFindings.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      +{parsed.keyFindings.length - 5} more findings
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Gotchas */}
            {hasGotchas && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-medium text-foreground">Gotchas Discovered</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {parsed.gotchas.length}
                  </Badge>
                </div>
                <ul className="space-y-1 ps-6">
                  {parsed.gotchas.map((gotcha, idx) => (
                    <li key={idx} className="text-sm text-red-400/80 py-1 ps-4 relative before:content-['•'] before:absolute before:start-0 before:text-red-500/50">
                      {gotcha}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Patterns */}
            {hasPatterns && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium text-foreground">Patterns Identified</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {parsed.patterns.length}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2 ps-6">
                  {parsed.patterns.map((pattern, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs bg-purple-500/10 text-purple-400">
                      {pattern}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Link to PR */}
            {parsed.repo && parsed.prNumber && (
              <div className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={() => window.open(`https://github.com/${parsed.repo}/pull/${parsed.prNumber}`, '_blank')}
                >
                  <ExternalLink className="h-3 w-3" />
                  View PR on GitHub
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
