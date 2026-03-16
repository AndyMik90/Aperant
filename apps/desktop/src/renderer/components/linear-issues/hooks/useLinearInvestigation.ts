import { useEffect, useCallback, useState } from "react";
import { loadTasks } from "../../../stores/task-store";
import type {
  LinearIssue,
  LinearInvestigationStatus,
  LinearInvestigationResult,
} from "../../../../shared/types";

export function useLinearInvestigation(projectId: string | undefined) {
  const [investigationStatus, setInvestigationStatus] =
    useState<LinearInvestigationStatus>({
      phase: "idle",
      progress: 0,
      message: "",
    });
  const [lastInvestigationResult, setLastInvestigationResult] =
    useState<LinearInvestigationResult | null>(null);
  const [_error, setError] = useState<string | null>(null);

  // Set up event listeners for investigation progress
  useEffect(() => {
    if (!projectId) return;

    const cleanupProgress = window.electronAPI.onLinearInvestigationProgress(
      (eventProjectId, status) => {
        if (eventProjectId === projectId) {
          setInvestigationStatus(status);
        }
      },
    );

    const cleanupComplete = window.electronAPI.onLinearInvestigationComplete(
      (eventProjectId, result) => {
        if (eventProjectId === projectId) {
          setLastInvestigationResult(result);
          setInvestigationStatus({
            phase: "complete",
            progress: 100,
            message: "Investigation complete",
            issueId: result.issueId,
          });
          // Refresh the task store so the new task appears on the Kanban board
          if (result.success && result.taskId) {
            loadTasks(projectId);
          }
        }
      },
    );

    const cleanupError = window.electronAPI.onLinearInvestigationError(
      (eventProjectId, errorMsg) => {
        if (eventProjectId === projectId) {
          setError(errorMsg);
          setInvestigationStatus({
            phase: "error",
            progress: 0,
            message: errorMsg,
            error: errorMsg,
          });
        }
      },
    );

    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [projectId]);

  const startInvestigation = useCallback(
    (issue: LinearIssue, selectedCommentIds?: string[]) => {
      if (projectId) {
        setInvestigationStatus({
          phase: "fetching",
          issueId: issue.id,
          progress: 0,
          message: "Starting investigation...",
        });
        setLastInvestigationResult(null);
        setError(null);

        // undefined = include all comments, [] = include none
        window.electronAPI.investigateLinearIssue(
          projectId,
          issue.id,
          selectedCommentIds,
        );
      }
    },
    [projectId],
  );

  const resetInvestigationStatus = useCallback(() => {
    setInvestigationStatus({ phase: "idle", progress: 0, message: "" });
    setError(null);
  }, []);

  return {
    investigationStatus,
    lastInvestigationResult,
    startInvestigation,
    resetInvestigationStatus,
  };
}
