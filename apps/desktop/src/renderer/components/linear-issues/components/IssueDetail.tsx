import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ExternalLink,
  User,
  Clock,
  Sparkles,
  CheckCircle2,
  Eye,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Minus,
  Gauge,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Progress } from "../../ui/progress";
import { ScrollArea } from "../../ui/scroll-area";
import type { LinearIssueDetailProps } from "../types";

const STATE_TYPE_COLORS: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  unstarted: "bg-info/10 text-info",
  started: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  canceled: "bg-destructive/10 text-destructive",
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "No priority", color: "text-muted-foreground" },
  1: { label: "Urgent", color: "text-destructive" },
  2: { label: "High", color: "text-warning" },
  3: { label: "Medium", color: "text-info" },
  4: { label: "Low", color: "text-muted-foreground" },
};

function PriorityBadge({
  priority,
  priorityLabel,
}: {
  priority: number;
  priorityLabel: string;
}) {
  const iconMap: Record<number, React.ReactNode> = {
    1: <AlertTriangle className="h-3 w-3" />,
    2: <ArrowUp className="h-3 w-3" />,
    3: <Minus className="h-3 w-3" />,
    4: <ArrowDown className="h-3 w-3" />,
  };

  const config = PRIORITY_LABELS[priority] || PRIORITY_LABELS[0];

  return (
    <Badge variant="outline" className={`${config.color}`}>
      {iconMap[priority]}
      <span className="ml-1">{priorityLabel}</span>
    </Badge>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function IssueDetail({
  issue,
  onInvestigate,
  investigationResult,
  linkedTaskId,
  onViewTask,
  projectId,
}: LinearIssueDetailProps) {
  const { t } = useTranslation("common");

  // Determine which task ID to use - either already linked or just created
  const taskId =
    linkedTaskId ||
    (investigationResult?.success ? investigationResult.taskId : undefined);
  const hasLinkedTask = !!taskId;

  const handleViewTask = () => {
    if (taskId && onViewTask) {
      onViewTask(taskId);
    }
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`${STATE_TYPE_COLORS[issue.state.type] || ""}`}
              >
                {issue.state.name}
              </Badge>
              <span className="text-sm text-muted-foreground font-mono">
                {issue.identifier}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              asChild
              aria-label={t("linear.openInLinear", "Open in Linear")}
            >
              <a href={issue.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {issue.title}
          </h2>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {issue.assignee && (
            <div className="flex items-center gap-1">
              <User className="h-4 w-4" />
              {issue.assignee.name}
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDate(issue.createdAt)}
          </div>
          <PriorityBadge
            priority={issue.priority}
            priorityLabel={issue.priorityLabel}
          />
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {issue.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                style={{
                  backgroundColor: `${label.color}20`,
                  borderColor: `${label.color}50`,
                  color: label.color,
                }}
              >
                {label.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {hasLinkedTask ? (
            <Button
              onClick={handleViewTask}
              className="flex-1"
              variant="secondary"
            >
              <Eye className="h-4 w-4 mr-2" />
              {t("linear.viewTask", "View Task")}
            </Button>
          ) : (
            <Button onClick={onInvestigate} className="flex-1">
              <Sparkles className="h-4 w-4 mr-2" />
              {t("linear.investigate", "Investigate & Create Task")}
            </Button>
          )}
        </div>

        {/* Task Linked Info */}
        {hasLinkedTask && (
          <Card className="bg-success/5 border-success/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t("linear.taskLinked", "Task Linked")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {investigationResult?.success ? (
                <>
                  <p className="text-foreground">
                    {investigationResult.analysis.summary}
                  </p>
                  {investigationResult.analysis.proposedSolution &&
                    investigationResult.analysis.proposedSolution !==
                      "See task description for details." && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("linear.proposedSolution", "Proposed Solution")}
                        </p>
                        <p className="text-foreground text-xs">
                          {investigationResult.analysis.proposedSolution}
                        </p>
                      </div>
                    )}
                  {investigationResult.analysis.affectedFiles.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("linear.affectedFiles", "Affected Files")}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {investigationResult.analysis.affectedFiles.map(
                          (file) => (
                            <Badge
                              key={file}
                              variant="outline"
                              className="text-xs font-mono"
                            >
                              {file}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                  {investigationResult.analysis.impactScore != null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Gauge className="h-3 w-3" />
                          {t("linear.impactScore", "Impact Score")}
                        </p>
                        <span className="text-xs font-semibold">
                          {investigationResult.analysis.impactScore}/100
                        </span>
                      </div>
                      <Progress
                        value={investigationResult.analysis.impactScore}
                        className={`h-1.5 ${
                          investigationResult.analysis.impactScore <= 25
                            ? "[&>div]:bg-success"
                            : investigationResult.analysis.impactScore <= 50
                              ? "[&>div]:bg-warning"
                              : investigationResult.analysis.impactScore <= 75
                                ? "[&>div]:bg-orange-500"
                                : "[&>div]:bg-destructive"
                        }`}
                      />
                      {investigationResult.analysis.impactDetails && (
                        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          <Badge
                            variant="outline"
                            className={
                              investigationResult.analysis.impactDetails
                                .riskLevel === "low"
                                ? "bg-success/10 text-success"
                                : investigationResult.analysis.impactDetails
                                      .riskLevel === "medium"
                                  ? "bg-warning/10 text-warning"
                                  : investigationResult.analysis.impactDetails
                                        .riskLevel === "high"
                                    ? "bg-orange-500/10 text-orange-500"
                                    : "bg-destructive/10 text-destructive"
                            }
                          >
                            {
                              investigationResult.analysis.impactDetails
                                .riskLevel
                            }{" "}
                            {t("linear.risk", "risk")}
                          </Badge>
                          <span>
                            {
                              investigationResult.analysis.impactDetails
                                .affectedSymbols
                            }{" "}
                            {t("linear.symbols", "symbols")}
                          </span>
                          <span>
                            {
                              investigationResult.analysis.impactDetails
                                .affectedProcesses
                            }{" "}
                            {t("linear.processes", "processes")}
                          </span>
                          <span>
                            {t("linear.blastRadius", "blast radius")}:{" "}
                            {
                              investigationResult.analysis.impactDetails
                                .blastRadius
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        investigationResult.analysis.estimatedComplexity ===
                        "simple"
                          ? "bg-success/10 text-success"
                          : investigationResult.analysis.estimatedComplexity ===
                              "standard"
                            ? "bg-warning/10 text-warning"
                            : "bg-destructive/10 text-destructive"
                      }
                    >
                      {investigationResult.analysis.estimatedComplexity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("linear.taskId", "Task ID")}: {taskId}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("linear.taskId", "Task ID")}: {taskId}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Body */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {t("linear.description", "Description")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {issue.description ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {issue.description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t("linear.noDescription", "No description provided.")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Project */}
        {issue.project && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t("linear.project", "Project")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{issue.project.name}</Badge>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
