# Ralph FIX-17 Run Report

**Date:** 2026-02-04
**Task:** FIX-17 - Fix TASK_START Handler to Respect Planning → Coding Gate
**Result:** ✅ **COMPLETE**
**Build Status:** ✅ Passing

---

## Summary

Ralph successfully fixed the critical bug in the `TASK_START` handler that was bypassing the Planning → Coding manual gate.

---

## Completion Promise

```
FIX_17_TASK_START_GATE_COMPLETE
```

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
| Build passes with no TypeScript errors | ✅ |
| TASK_START uses task.status to decide which agent | ✅ |
| Planning tasks call startPlanningAgent() | ✅ |
| Coding tasks call startTaskExecution() | ✅ |
| Other statuses return an error | ✅ |
| Status notification only for coding tasks | ✅ |

---

## Behavioral Changes

| Scenario | Before | After |
|----------|--------|-------|
| Resume planning task (no spec.md) | `startSpecCreation()` (old method) | `startPlanningAgent()` ✅ |
| Resume planning task (has spec.md) | `startTaskExecution()` ❌ BUG | `startPlanningAgent()` ✅ |
| Resume coding task | `startTaskExecution()` | `startTaskExecution()` ✅ |
| Resume human_review task | `startTaskExecution()` ❌ BUG | Error message ✅ |

---

## Architecture Impact

This fix ensures the Planning → Coding manual gate works correctly:

```
User clicks "Resume" on planning task
        │
        ▼
  TASK_START handler
        │
        ├─── task.status === 'planning'?
        │           │
        │           ▼
        │    startPlanningAgent() ✅
        │    (with --no-build flag)
        │
        ├─── task.status === 'coding'?
        │           │
        │           ▼
        │    startTaskExecution() ✅
        │
        └─── other status?
                    │
                    ▼
              Return error ✅
              (no agent started)
```

The ONLY path from planning to coding is now through `TASK_START_BUILD` (when user clicks "Start Build" button).

---

## Files in This Fix

| File | Change |
|------|--------|
| `execution-handlers.ts` | Replaced file-based logic with status-based routing |

---

## Related Documents

- [ARCHITECTURE_VERIFICATION_REPORT.md](ARCHITECTURE_VERIFICATION_REPORT.md) - Bug analysis
- [RALPH_PROMPT_FIX_17.md](../tasks/RALPH_PROMPT_FIX_17.md) - Ralph prompt used
- [TASK_LIFECYCLE.md](../architecture/TASK_LIFECYCLE.md) - Updated lifecycle documentation

---

## Notes

- Build completed successfully
- Stop hook error is non-blocking (bash not recognized on Windows - expected)
- All exit criteria verified by Ralph

---

**Report Generated:** 2026-02-04
**Verified By:** Ralph autonomous execution + build verification
