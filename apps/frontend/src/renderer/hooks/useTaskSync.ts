import { useEffect } from 'react';
import { debugLog } from '@shared/utils/debug-logger';
import { useTaskStore } from '@/stores/task-store';
import { useNavigationStore } from '@/stores/navigation-store';

/**
 * Keeps selectedTask in sync with the task-store's tasks array for real-time updates.
 * When a task's fields change (status, subtasks, logs, etc.), the selectedTask reference
 * is updated so the TaskDetailModal reflects the latest data.
 */
export function useTaskSync() {
  const tasks = useTaskStore((state) => state.tasks);
  const selectedTask = useNavigationStore((state) => state.selectedTask);

  useEffect(() => {
    if (!selectedTask) {
      debugLog('[App] No selected task to update');
      return;
    }

    const updatedTask = tasks.find(
      (t) => t.id === selectedTask.id || (selectedTask.specId != null && t.specId === selectedTask.specId)
    );

    debugLog('[App] Task lookup result', {
      found: !!updatedTask,
      updatedTaskId: updatedTask?.id,
      selectedTaskId: selectedTask.id,
    });

    if (!updatedTask) {
      debugLog('[App] Updated task not found in tasks array');
      return;
    }

    // Referential equality check — if it's the same object, no fields have changed
    if (updatedTask === selectedTask) {
      debugLog('[App] Task is referentially equal, skipping comparison');
      return;
    }

    // Compare all mutable fields that affect UI state
    const subtasksChanged =
      JSON.stringify(selectedTask.subtasks || []) !==
      JSON.stringify(updatedTask.subtasks || []);
    const statusChanged = selectedTask.status !== updatedTask.status;
    const titleChanged = selectedTask.title !== updatedTask.title;
    const descriptionChanged = selectedTask.description !== updatedTask.description;
    const metadataChanged =
      JSON.stringify(selectedTask.metadata || {}) !==
      JSON.stringify(updatedTask.metadata || {});
    const executionProgressChanged =
      JSON.stringify(selectedTask.executionProgress || {}) !==
      JSON.stringify(updatedTask.executionProgress || {});
    const qaReportChanged =
      JSON.stringify(selectedTask.qaReport || {}) !==
      JSON.stringify(updatedTask.qaReport || {});
    const reviewReasonChanged = selectedTask.reviewReason !== updatedTask.reviewReason;
    const logsChanged =
      JSON.stringify(selectedTask.logs || []) !==
      JSON.stringify(updatedTask.logs || []);

    const hasChanged =
      subtasksChanged || statusChanged || titleChanged || descriptionChanged ||
      metadataChanged || executionProgressChanged || qaReportChanged ||
      reviewReasonChanged || logsChanged;

    debugLog('[App] Task comparison', {
      hasChanged,
      changes: {
        subtasks: subtasksChanged,
        status: statusChanged,
        title: titleChanged,
        description: descriptionChanged,
        metadata: metadataChanged,
        executionProgress: executionProgressChanged,
        qaReport: qaReportChanged,
        reviewReason: reviewReasonChanged,
        logs: logsChanged,
      },
    });

    if (hasChanged) {
      const reasons = [];
      if (subtasksChanged) reasons.push('Subtasks');
      if (statusChanged) reasons.push('Status');
      if (titleChanged) reasons.push('Title');
      if (descriptionChanged) reasons.push('Description');
      if (metadataChanged) reasons.push('Metadata');
      if (executionProgressChanged) reasons.push('ExecutionProgress');
      if (qaReportChanged) reasons.push('QAReport');
      if (reviewReasonChanged) reasons.push('ReviewReason');
      if (logsChanged) reasons.push('Logs');

      debugLog('[App] Updating selectedTask', {
        taskId: updatedTask.id,
        reason: reasons.join(', '),
      });
      useNavigationStore.getState().setSelectedTask(updatedTask);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when tasks array or selected task identity changes, not on selectedTask object ref
  }, [tasks, selectedTask?.id, selectedTask?.specId]);
}
