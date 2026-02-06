# FIX_MAJOR_STABILITY: Null Checks + Race Conditions (AUDIT-11 to AUDIT-18)

**Date:** 2026-02-06
**Tasks:** 8
**Max Iterations:** 80
**Priority:** MAJOR
**Status:** ✅ EXECUTED SUCCESSFULLY (4m 15s) — 8/8 tasks, build passed
**Depends On:** FIX_COMPANION_CRITICAL, FIX_HIGH_LEAKS_SECURITY (recommended)
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing MAJOR stability issues for Auto-Claude — null checks, race conditions, and key misuse.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is an 8-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

---

OBJECTIVE: Fix 8 stability issues: index-based React keys, null reference guards, file locking for concurrent writes, input validation, race conditions in spec creation, async/await correctness, and subtask comparison bugs.

---

FIX_MAJOR_STABILITY: 8 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Fix index-based keys in DurationBreakdown | apps/frontend/src/renderer/components/TaskCard.tsx | FIX - Find phases.map((phase, i) => <div key={i}>) in the DurationBreakdown section. Replace key={i} with key={phase.name} or another stable identifier from the phase object. | TASK_1_COMPLETE |
| 2 | Add null guard for companion badge | apps/frontend/src/renderer/components/TaskCard.tsx | FIX - Find the companion badge render (hasCompanion && ...). Add a null check on task.status before rendering. Ensure badge doesn't crash on edge cases where task might be partially loaded. | TASK_2_COMPLETE |
| 3 | Add null check in complexity-classified event | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | FIX - Find the complexity-classified event handler (~line 260-278). findTaskAndProject() may return undefined task/project. Add 'if (!project || !task) return;' guard before accessing their properties. | TASK_3_COMPLETE |
| 4 | Add file locking to project_memory.py | apps/backend/memory/project_memory.py | FIX - In append_to_project_memory(), add file locking around the read-modify-write cycle. Use msvcrt.locking() on Windows or fcntl.flock() on Unix. Import platform-appropriate module. Wrap in try/finally to ensure lock release. | TASK_4_COMPLETE |
| 5 | Validate inputs in INSIGHTS_CREATE_TASK | apps/frontend/src/main/ipc-handlers/insights-handlers.ts | FIX - Find the INSIGHTS_CREATE_TASK handler. Add validation: (a) title max length 200 chars, (b) sanitize title for filesystem use (remove/replace characters not safe for directory names like /, \\, :, *, ?, <, >, |), (c) description max length 10000 chars. Return error if validation fails. | TASK_5_COMPLETE |
| 6 | Fix race condition in spec number calculation | apps/frontend/src/main/ipc-handlers/insights-handlers.ts | FIX - Find where spec directories are numbered (reading dir contents then creating next number). Use atomic directory creation: try mkdir, if EEXIST increment and retry, up to 10 retries. This prevents duplicate spec IDs under concurrent creation. | TASK_6_COMPLETE |
| 7 | Verify companion create_agent_session await | apps/backend/agents/companion_agent.py | VERIFY+FIX - Read the companion agent code and check if client.create_agent_session() is an async method. If the function calling it is async, add await. If it's sync, leave as-is. Check the Anthropic SDK usage pattern in other agent files for reference. | TASK_7_COMPLETE |
| 8 | Fix subtask comparison null check | apps/frontend/src/renderer/stores/task-store.ts | FIX - Find taskCardPropsAreEqual (~line 202). Add a length equality check before comparing individual subtask items: if prevTask.subtasks?.length !== nextTask.subtasks?.length return false. | TASK_8_COMPLETE |

FINAL: <promise>FIX_MAJOR_STABILITY_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Backend tasks (4, 7) use Python — verify with import check
2. Frontend tasks verify with npm run build
3. File locking must be cross-platform (project runs on Windows)
4. Input validation should return meaningful error messages
5. All changes are defensive — add guards, don't restructure

---

VERIFICATION:
- cd apps/backend && python -c 'from memory.project_memory import append_to_project_memory; print(\"OK\")'
- cd apps/frontend && npm run build
- Both pass with no errors

---

CRITICAL CONSTRAINTS
1. 8-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure existing code — only add guards and fixes
3. BUILD MUST PASS (both frontend and backend import check)
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 8 tasks complete. BEGIN NOW.
" --max-iterations 80 --completion-promise "FIX_MAJOR_STABILITY_COMPLETE"
```
