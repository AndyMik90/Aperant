# Ralph Prompt: FIX-17 - TASK_START Handler Gate Fix

**Created:** 2026-02-04
**Executed:** 2026-02-04
**Status:** COMPLETE
**Priority:** CRITICAL

---

## Bug Summary

The `TASK_START` IPC handler bypasses the Planning → Coding manual gate. When a user clicks "Resume" on a planning task that has `spec.md`, the handler starts the CODING agent instead of the PLANNING agent.

**Root Cause:** Handler checks file existence instead of `task.status`.

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer completing a critical bug fix for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\reports\ARCHITECTURE_VERIFICATION_REPORT.md (bug analysis)
- docs\architecture\TASK_PHASE_FLOW.md (architecture reference)

---

## TASK (1 required - MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-17: Fix TASK_START handler to respect Planning → Coding gate | FIX_17_TASK_START_GATE_COMPLETE |

**FINAL:** <promise>FIX_17_TASK_START_GATE_COMPLETE</promise>

---

## THE BUG

File: apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts
Handler: TASK_START (starts around line 115)

Problem: The handler checks file existence (hasSpec, needsSpecCreation) instead of task.status. When user clicks Resume on a planning task that has spec.md, the handler incorrectly starts the CODING agent instead of the PLANNING agent.

---

## WHAT TO FIX

1. Find the TASK_START handler in execution-handlers.ts

2. Find the branching logic that uses needsSpecCreation and needsImplementation (around lines 227-290)

3. Replace file-existence checks with status-based routing:
   - If task.status === 'planning' → call agentManager.startPlanningAgent()
   - If task.status === 'coding' → call agentManager.startTaskExecution()
   - Other statuses → return error, don't start any agent

4. Update the status notification at the end to only send 'coding' status for coding tasks (planning tasks stay as 'planning')

5. Remove unused variables (needsSpecCreation, needsImplementation, hasSpec if no longer needed)

6. Run: npm run build (fix any errors)

---

## CRITICAL CONSTRAINTS

1. DO NOT change TASK_START_BUILD handler - it's correct
2. DO NOT change TASK_UPDATE_STATUS handler - it's correct
3. DO NOT change TASK_RECOVER_STUCK handler - it's correct
4. ONLY modify the TASK_START handler logic

---

## EXIT CRITERIA

- Build passes with no TypeScript errors
- TASK_START uses task.status to decide which agent to start
- Planning tasks call startPlanningAgent()
- Coding tasks call startTaskExecution()

---

HARD STOP RULE: You may NOT stop until <promise>FIX_17_TASK_START_GATE_COMPLETE</promise> is output.

BEGIN NOW.
" --max-iterations 50 --completion-promise "FIX_17_TASK_START_GATE_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` | Replace file-based logic with status-based routing in TASK_START handler |

---

## Verification After Run

1. **Check the TASK_START handler** uses `task.status` not `hasSpec`
2. **Planning tasks** call `startPlanningAgent()` with `--no-build` flag
3. **Coding tasks** call `startTaskExecution()`
4. **Build passes:** `npm run build`

---

## Completion Promise

```
FIX_17_TASK_START_GATE_COMPLETE
```
