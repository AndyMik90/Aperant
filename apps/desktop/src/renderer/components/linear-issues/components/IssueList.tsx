import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "../../ui/scroll-area";
import { IssueListItem } from "./IssueListItem";
import { EmptyState } from "./EmptyStates";
import type { LinearIssueListProps } from "../types";

export function IssueList({
  issues,
  selectedIssueId,
  isLoading,
  error,
  onSelectIssue,
  onInvestigate,
  onRetry,
  onOpenSettings,
}: LinearIssueListProps) {
  const { t } = useTranslation("common");

  if (error && issues.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 max-w-md">
          <p className="text-sm text-destructive font-medium mb-2">
            {t("linear.error", "Failed to load issues")}
          </p>
          <p className="text-xs text-destructive/80 mb-3">{error}</p>
          <div className="flex items-center justify-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs text-destructive underline hover:no-underline"
              >
                {t("buttons.retry", "Retry")}
              </button>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-xs text-destructive underline hover:no-underline"
              >
                {t("buttons.openSettings", "Open Settings")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading && issues.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (issues.length === 0) {
    return <EmptyState message={t("linear.noIssues", "No issues found")} />;
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-1">
        {issues.map((issue) => (
          <IssueListItem
            key={issue.id}
            issue={issue}
            isSelected={selectedIssueId === issue.id}
            onClick={() => onSelectIssue(issue.id)}
            onInvestigate={() => onInvestigate(issue)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
