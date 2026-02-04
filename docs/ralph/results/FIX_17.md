# Ralph Run Result: FIX-17 - TASK_START Handler Gate Fix

**Date:** 2026-02-04
**Status:** COMPLETE
**Duration:** ~5m
**Promise:** `FIX_17_TASK_START_GATE_COMPLETE`

---

## Summary

Ralph successfully fixed the critical bug in the `TASK_START` handler that was bypassing the Planning → Coding manual gate.

---

## Changes Made

### File Modified
`apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`

### Before (Broken Logic)
The handler checked file existence instead of task status:
```typescript
const needsSpecCreation = !hasSpec;
const needsImplementation = hasSpec && task.subtasks.length === 0;

if (needsSpecCreation) {
  agentManager.startSpecCreation(...);  // OLD method
} else if (needsImplementation) {
  agentManager.startTaskExecution(...);  // BUG: Started coding!
} else {
  agentManager.startTaskExecution(...);  // BUG: Started coding!
}
```

### After (Fixed Logic)
The handler now checks `task.status` to route correctly:
```typescript
// FIX-17: Use task.status to decide which agent to start, NOT file existence
console.warn('[TASK_START] Routing based on task.status:', task.status);

if (task.status === 'planning') {
  // Planning tasks always use the planning agent
  agentManager.startPlanningAgent(
    task.specId,
    project.path,
    taskDescription,
    specDir,
    task.metadata,
    baseBranch
  );
} else if (task.status === 'coding') {
  // Coding tasks use the task execution agent
  agentManager.startTaskExecution(
    taskId,
    project.path,
    task.specId,
    { parallel: false, workers: 1, baseBranch, useWorktree: task.metadata?.useWorktree }
  );
} else {
  // Other statuses should not start any agent
  mainWindow.webContents.send(
    IPC_CHANNELS.TASK_ERROR,
    taskId,
    `Cannot start task with status '${task.status}'. Only 'planning' and 'coding' tasks can be started.`
  );
  return;
}
```

### Status Notification Fix
Only sends status change IPC for coding tasks (planning tasks keep their status):
```typescript
// FIX-17: Only send status change for coding tasks
if (task.status === 'coding') {
  mainWindow.webContents.send(
    IPC_CHANNELS.TASK_STATUS_CHANGE,
    taskId,
    'coding'
  );
  // ... persist to file
}
```

---

## Exit Criteria Verification

| Criteria | Status |
|----------|--------|
| Build passes with no TypeScript errors | |
| TASK_START uses task.status to decide which agent | |
| Planning tasks call startPlanningAgent() | |
| Coding tasks call startTaskExecution() | |
| Other statuses return an error | |
| Status notification only for coding tasks | |

---

## Behavioral Changes

| Scenario | Before | After |
|----------|--------|-------|
| Resume planning task (no spec.md) | `startSpecCreation()` (old method) | `startPlanningAgent()` |
| Resume planning task (has spec.md) | `startTaskExecution()` BUG | `startPlanningAgent()` |
| Resume coding task | `startTaskExecution()` | `startTaskExecution()` |
| Resume human_review task | `startTaskExecution()` BUG | Error message |

---

## Build Status

 Build passes (`npm run build`)

---

**Report Generated:** 2026-02-04
