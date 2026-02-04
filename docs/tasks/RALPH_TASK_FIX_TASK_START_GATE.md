# Ralph Task: FIX-17 - Fix TASK_START Handler to Respect Planning → Coding Gate

## Priority: CRITICAL

## Summary

The `TASK_START` IPC handler bypasses the intended manual gate between Planning and Coding phases. When a user clicks "Resume" on a planning task, it may incorrectly start the coding agent instead of the planning agent.

---

## Task ID: FIX-17

## Completion Promise

```
FIX_17_TASK_START_GATE_COMPLETE
```

---

## Problem

**File:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
**Handler:** `TASK_START` (lines 115-348)

### Current Broken Logic

The handler checks file existence instead of task status:

```typescript
const needsSpecCreation = !hasSpec;
const needsImplementation = hasSpec && task.subtasks.length === 0;

if (needsSpecCreation) {
  agentManager.startSpecCreation(...);  // Uses OLD method without --no-build
} else if (needsImplementation) {
  agentManager.startTaskExecution(...);  // BUG: Starts CODING agent!
} else {
  agentManager.startTaskExecution(...);  // BUG: Starts CODING agent!
}
```

### Bug Impact

1. User creates a task (status = 'planning')
2. Planning agent creates spec.md
3. User clicks "Stop", then "Resume" to continue planning
4. **BUG:** Coding agent starts instead of planning agent
5. This bypasses the manual "Start Build" gate

---

## Required Changes

### File: `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`

**Location:** TASK_START handler, lines ~227-290

**Replace the current logic with status-based routing:**

```typescript
// CURRENT CODE TO REPLACE (approximately lines 227-290):
// Check if spec.md exists...
// if (needsSpecCreation) { ... } else if (needsImplementation) { ... } else { ... }

// NEW CODE:
// Check task status to determine which agent to use
// This respects the Planning → Coding manual gate (FIX-17)
if (task.status === 'planning') {
  // Planning task - always use startPlanningAgent with --no-build
  // This prevents auto-continuation to coding, user must click "Start Build"
  const taskDescription = task.description || task.title;
  console.warn('[TASK_START] Starting planning agent for planning task:', task.specId);

  agentManager.startPlanningAgent(
    task.specId,
    project.path,
    taskDescription,
    specDir,
    task.metadata,
    baseBranch
  );
} else if (task.status === 'coding') {
  // Coding task - user already clicked "Start Build" previously, now resuming
  // startTaskExecution runs run.py (the coding agent)
  console.warn('[TASK_START] Starting coding agent for coding task:', task.specId);

  agentManager.startTaskExecution(
    taskId,
    project.path,
    task.specId,
    {
      parallel: false,
      workers: 1,
      baseBranch,
      useWorktree: task.metadata?.useWorktree
    }
  );
} else {
  // Other statuses (human_review, ai_review, done, pr_created) should not start agents
  // These tasks are in review or completed states
  console.warn('[TASK_START] Ignoring start request for task in status:', task.status);
  mainWindow.webContents.send(
    IPC_CHANNELS.TASK_ERROR,
    taskId,
    `Cannot start task in '${task.status}' status. Use appropriate actions for this status.`
  );
  return;
}
```

---

## Detailed Implementation Steps

### Step 1: Locate the TASK_START handler

Find the `ipcMain.on(IPC_CHANNELS.TASK_START, ...)` handler in `execution-handlers.ts` (starts around line 115).

### Step 2: Find the branching logic

Look for these variables around line 227-236:
- `needsSpecCreation`
- `needsImplementation`
- The `if/else if/else` block that follows

### Step 3: Replace the branching logic

Replace the file-existence-based logic with the status-based logic shown above.

**Key Changes:**
1. Check `task.status` instead of `hasSpec` / `needsImplementation`
2. Use `startPlanningAgent()` for `status === 'planning'`
3. Use `startTaskExecution()` for `status === 'coding'`
4. Reject other statuses with an error message

### Step 4: Update the status notification

The current code sends `TASK_STATUS_CHANGE` with 'coding' at the end. This should be conditional:

```typescript
// Only change status if actually starting a coding agent
if (task.status === 'coding') {
  mainWindow.webContents.send(
    IPC_CHANNELS.TASK_STATUS_CHANGE,
    taskId,
    'coding'
  );
}
// Planning tasks stay in 'planning' status (agent is just restarted)
```

### Step 5: Clean up unused variables

After the fix, the following variables may be unused and can be removed:
- `needsSpecCreation`
- `needsImplementation`
- `hasSpec` (if only used for these checks)

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` | Replace file-based logic with status-based routing |

---

## Verification Steps

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Test planning task resume:**
   - Create a new task
   - Wait for spec.md to be created
   - Click "Stop" to stop the agent
   - Click "Resume"
   - **Verify:** Planning agent starts (check logs for `[TASK_START] Starting planning agent`)
   - **Verify:** Status stays as 'planning'

3. **Test coding task resume:**
   - Create a task and let it reach planning
   - Click "Start Build" to transition to coding
   - Click "Stop" to stop the agent
   - Click "Resume" (or "Run")
   - **Verify:** Coding agent starts (check logs for `[TASK_START] Starting coding agent`)

4. **Test invalid status:**
   - Manually set a task to 'human_review' status
   - Attempt to call TASK_START
   - **Verify:** Error is shown, no agent starts

---

## Success Criteria

- [ ] Build passes with no TypeScript errors
- [ ] Planning tasks restart with planning agent (not coding agent)
- [ ] Coding tasks restart with coding agent
- [ ] Human review / done tasks do not start any agent
- [ ] Console logs show correct agent type being started

---

## Architecture Context

This fix ensures the Planning → Coding manual gate architecture works correctly:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CORRECT FLOW (After Fix)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Create Task] ──> Planning Agent (--no-build)                       │
│       │                    │                                         │
│       │                    ▼                                         │
│       │           [spec.md created]                                  │
│       │                    │                                         │
│       │           [User clicks Stop]                                 │
│       │                    │                                         │
│       ▼                    ▼                                         │
│  [Resume] ────────> Planning Agent (--no-build)  ◄── SAME agent!    │
│                            │                                         │
│                            │                                         │
│                   [User clicks "Start Build"]                        │
│                            │                                         │
│                            ▼                                         │
│  ═══════════════  MANUAL GATE (TASK_START_BUILD)  ═══════════════   │
│                            │                                         │
│                            ▼                                         │
│                      Coding Agent                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Notes

- The `startSpecCreation()` method is the OLD architecture and should eventually be deprecated
- The `startPlanningAgent()` method is the NEW architecture with proper `--no-build` flag
- This fix aligns the TASK_START handler with the rest of the architecture (TASK_START_BUILD, recovery handler)

---

**Created:** 2026-02-04
**Status:** Ready for Ralph
