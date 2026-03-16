import {
  User,
  Tag,
  Sparkles,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import type { LinearIssueListItemProps } from "../types";

const STATE_TYPE_COLORS: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  unstarted: "bg-info/10 text-info",
  started: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  canceled: "bg-destructive/10 text-destructive",
};

function PriorityIcon({ priority }: { priority: number }) {
  switch (priority) {
    case 1: // Urgent
      return <AlertTriangle className="h-3 w-3 text-destructive" />;
    case 2: // High
      return <ArrowUp className="h-3 w-3 text-warning" />;
    case 3: // Medium
      return <Minus className="h-3 w-3 text-info" />;
    case 4: // Low
      return <ArrowDown className="h-3 w-3 text-muted-foreground" />;
    default: // No priority
      return null;
  }
}

export function IssueListItem({
  issue,
  isSelected,
  onClick,
  onInvestigate,
}: LinearIssueListItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`group p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/50 border border-accent"
          : "hover:bg-muted/50 border border-transparent"
      }`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant="outline"
              className={`text-xs ${STATE_TYPE_COLORS[issue.state.type] || ""}`}
            >
              {issue.state.name}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {issue.identifier}
            </span>
            <PriorityIcon priority={issue.priority} />
          </div>
          <h4 className="text-sm font-medium text-foreground truncate">
            {issue.title}
          </h4>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {issue.assignee && (
              <div className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {issue.assignee.name}
              </div>
            )}
            {issue.labels.length > 0 && (
              <div className="flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {issue.labels.length}
              </div>
            )}
          </div>
          {/* Label badges */}
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {issue.labels.slice(0, 3).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    backgroundColor: `${label.color}20`,
                    borderColor: `${label.color}50`,
                    color: label.color,
                    border: "1px solid",
                  }}
                >
                  {label.name}
                </span>
              ))}
              {issue.labels.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{issue.labels.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onInvestigate();
          }}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
