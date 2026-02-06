# FIX_COMPANION_CRITICAL: Fix Broken Companion Chat (AUDIT-01 to AUDIT-04)

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** CRITICAL
**Status:** ✅ EXECUTED SUCCESSFULLY (3m 44s) — 4/4 tasks, build passed
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing CRITICAL companion agent bugs for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix 4 critical bugs that make the companion agent chat feature non-functional. The companion agent spawns correctly but users cannot send messages to it from the UI due to missing/broken IPC plumbing.

Read these files thoroughly before making changes:
- apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts — TASK_SEND_COMPANION_MESSAGE handler (~line 1066)
- apps/frontend/src/main/agent/agent-manager.ts — getCompanionPhase() method
- apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts — companion spawned/stopped events, exit handler, setTimeout calls
- apps/frontend/src/preload/api/task-api.ts — existing preload bridges for companion
- apps/frontend/src/renderer/components/TaskCard.tsx — handleSendCompanionMessage (~line 454), uses window.electronAPI.invoke()
- apps/frontend/src/renderer/stores/task-store.ts — companionActive Set, deleteTask action
- apps/frontend/src/shared/constants/ipc.ts — TASK_SEND_COMPANION_MESSAGE channel

---

FIX_COMPANION_CRITICAL: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Verify or add preload bridge for companion messages | apps/frontend/src/preload/api/task-api.ts | VERIFY+FIX - Check if window.electronAPI.invoke() is a generic bridge that handles TASK_SEND_COMPANION_MESSAGE. If TaskCard calls window.electronAPI.invoke(IPC_CHANNELS.TASK_SEND_COMPANION_MESSAGE, ...) and invoke is exposed generically, this may already work. If NOT, add a dedicated sendCompanionMessage bridge. Also verify onTaskCompanionSpawned and onTaskCompanionStopped bridges exist. | TASK_1_COMPLETE |
| 2 | Fix getCompanionPhase type mismatch | apps/frontend/src/main/agent/agent-manager.ts | FIX - Read getCompanionPhase(). The TASK_SEND_COMPANION_MESSAGE handler calls agentManager.getCompanionPhase(taskId). Verify this method correctly looks up the companion process for a given parent taskId and returns the companion's taskId/processId. If there's a type mismatch (expecting taskStatus but receiving taskId, or vice versa), fix the lookup. | TASK_2_COMPLETE |
| 3 | Fix auto-spawn vs context deletion race condition | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | FIX - Find the competing setTimeout calls for companion spawning and execution context deletion. Ensure companion spawn checks context exists before proceeding. Either: (a) clear the deletion timeout when spawning, (b) guard spawn against missing context, or (c) reorder so spawn completes before context cleanup is scheduled. | TASK_3_COMPLETE |
| 4 | Clean up companionActive on task deletion | apps/frontend/src/renderer/stores/task-store.ts | FIX - In the deleteTask action (or wherever tasks are removed from state), also remove the taskId from the companionActive Set to prevent memory leak. | TASK_4_COMPLETE |

FINAL: <promise>FIX_COMPANION_CRITICAL_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Read each file BEFORE making changes — verify the bug exists as described
2. Some issues may already be handled — if a bug doesn't exist, note why and move on
3. Do NOT break existing companion spawning/stopping lifecycle
4. Do NOT modify the companion backend (Python) — frontend only
5. Test by verifying TypeScript compiles — no runtime test needed

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS
1. 4-TASK JOB - Do NOT stop until all tasks complete
2. VERIFY before fixing — read the actual code to confirm each bug
3. Do NOT restructure the companion lifecycle
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change (or verifying no change needed)
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "FIX_COMPANION_CRITICAL_COMPLETE"
```
