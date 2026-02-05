# SWEEP P0: Critical Fixes

**Date:** 2026-02-05
**Tasks:** 4
**Max Iterations:** 50
**Source:** CODE_SWEEP_REPORT.md
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing SWEEP P0: Critical Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

Primary documentation:
- docs/CODE_SWEEP_REPORT.md (Full issue details)
- docs/KNOWN_ISSUES.md (Issue tracking)

---

SWEEP P0: CRITICAL FIXES (4 tasks)

| # | Task | File | Issue | Promise |
|---|------|------|-------|---------|
| 1 | Fix unhandled promise | execution-handlers.ts | Add .catch() to async agent starts | TASK_1_COMPLETE |
| 2 | Fix memory leak | agent-queue.ts | Remove event listeners on process exit | TASK_2_COMPLETE |
| 3 | Fix race condition | terminal-store.ts | Add finally block for restoringProjects cleanup | TASK_3_COMPLETE |
| 4 | Fix resource leak | glab_client.py | Close HTTPError file pointer in finally | TASK_4_COMPLETE |

FINAL: <promise>SWEEP_P0_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Fix Unhandled Promise Rejection
   - File: apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts
   - Lines: 340-347, 356-366
   - Issue: agentManager.startPlanningAgent() and startTaskExecution() called without await or .catch()
   - Fix: Add .catch() handlers that emit error events to UI
   - Example:
     ```typescript
     agentManager.startPlanningAgent(...).catch((error) => {
       console.error('Failed to start planning agent:', error);
       event.sender.send('task:error', { taskId, error: error.message });
     });
     ```
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Fix Event Listener Memory Leak
   - File: apps/frontend/src/main/agent/agent-queue.ts
   - Lines: 652-658, 676-709, 712-799
   - Issue: stdout/stderr listeners attached but never removed on process exit
   - Fix: Store listener references and remove them in the exit/close handler
   - Example:
     ```typescript
     const stdoutHandler = (data: Buffer) => { ... };
     childProcess.stdout?.on('data', stdoutHandler);
     childProcess.on('exit', () => {
       childProcess.stdout?.removeListener('data', stdoutHandler);
       // ... rest of cleanup
     });
     ```
   - Say: TASK_2_COMPLETE then NEXT: Task 3

3. TASK 3: Fix Terminal Restore Race Condition
   - File: apps/frontend/src/renderer/stores/terminal-store.ts
   - Line: 818 (restoringProjects.add), Line: 891 (restoringProjects.delete)
   - Issue: If error thrown before delete(), project permanently locked
   - Fix: Wrap the restore logic in try/finally, move delete() to finally block
   - Example:
     ```typescript
     restoringProjects.add(projectId);
     try {
       // ... existing restore logic
     } finally {
       restoringProjects.delete(projectId);
     }
     ```
   - Say: TASK_3_COMPLETE then NEXT: Task 4

4. TASK 4: Fix Python HTTPError Resource Leak
   - File: apps/backend/runners/gitlab/glab_client.py
   - Lines: 136-138, 171
   - Issue: HTTPError file pointer not closed when re-raising
   - Fix: Add finally block to close e.fp or use context manager
   - Example:
     ```python
     except urllib.error.HTTPError as e:
         try:
             error_body = e.read()
             # ... existing handling
         finally:
             e.close()  # Ensure file pointer closed
     ```
   - Say: TASK_4_COMPLETE

5. VERIFICATION:
   - Run: cd apps/frontend && npm run build
   - Ensure no TypeScript errors
   - Python syntax check: python -m py_compile apps/backend/runners/gitlab/glab_client.py

6. FINAL:
   When ALL 4 tasks complete and builds pass:
   <promise>SWEEP_P0_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all 4 tasks are complete.
2. PRESERVE FUNCTIONALITY - Only add error handling, don't change logic
3. BUILD MUST PASS - Verify TypeScript and Python compilation
4. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "SWEEP_P0_COMPLETE"
```

---

## Expected Results

| Issue | Before | After |
|-------|--------|-------|
| Promise rejection | Silent failure | Error emitted to UI |
| Event listeners | Accumulate forever | Cleaned up on exit |
| Terminal restore | Permanently locked on error | Always unlocked in finally |
| HTTPError | File pointer leak | Properly closed |

## Files Modified

1. `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
2. `apps/frontend/src/main/agent/agent-queue.ts`
3. `apps/frontend/src/renderer/stores/terminal-store.ts`
4. `apps/backend/runners/gitlab/glab_client.py`
