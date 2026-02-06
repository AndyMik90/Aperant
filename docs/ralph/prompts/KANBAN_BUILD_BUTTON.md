# KANBAN_BUILD_BUTTON: Fix Start Build Button Not Appearing After Planning

**Date:** 2026-02-06
**Tasks:** 3
**Max Iterations:** 40
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (3m 45s)
**Design Doc:** docs/plans/KANBAN_TERMINAL_TIMELINE.md

---

## Problem

When a task finishes the planning phase naturally (agent completes and exits), the "Start Build" button never appears. User has to click "Stop" first to make it appear. The button should appear automatically when planning finishes.

## Root Cause

"Start Build" visibility is gated on `isAgentStopped` in TaskCard.tsx. This flag is only set when user manually stops — not when the agent exits naturally after completing planning.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing KANBAN_BUILD_BUTTON fix for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 3-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix the bug where the 'Start Build' button doesn't appear on Kanban task cards after planning finishes naturally. Currently the user has to click Stop first to reveal it.

The root cause: In TaskCard.tsx, the Start Build button only shows when isAgentStopped is true. But isAgentStopped is only set on manual stop, not when the agent process exits naturally after completing planning. The fix needs to detect when the planning agent exits naturally and set the stopped state accordingly.

---

KANBAN_BUILD_BUTTON: 3 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Detect natural planning exit | apps/frontend/src/renderer/hooks/useIpc.ts | MODIFY - add a listener for the agent process exit event (onTaskAgentExited or similar). When a planning-phase task's agent exits naturally (not from manual stop), set isAgentStopped to true so the Start Build button appears. Check what events the backend emits when agent process ends. | TASK_1_COMPLETE |
| 2 | Handle edge case in TaskCard | apps/frontend/src/renderer/components/TaskCard.tsx | MODIFY - update the planning section button logic to also show Start Build when the task status is 'planning' but there is no active agent process running (not just when isAgentStopped). Consider adding a check like hasActiveProcess from the task store. | TASK_2_COMPLETE |
| 3 | Clear state on task restart | apps/frontend/src/renderer/stores/task-store.ts | MODIFY - ensure that when a task is restarted (startTask called), the agent stopped state is properly cleared so the Stop button shows again during active planning. Verify the existing clearance in startTask is working. | TASK_3_COMPLETE |

FINAL: <promise>KANBAN_BUILD_BUTTON_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. When planning agent finishes naturally, Start Build button must appear without user clicking Stop
2. When planning agent is actively running, only the Stop button should show
3. When user manually stops planning, both Resume and Start Build should show (existing behavior, keep it)
4. When a task is restarted, it should go back to showing the Stop button
5. Do NOT change the behavior of coding-phase tasks — only fix planning-phase transitions

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 3-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT break existing stop/resume functionality
3. Do NOT change any behavior for coding-phase tasks
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 40 --completion-promise "KANBAN_BUILD_BUTTON_COMPLETE"
```
