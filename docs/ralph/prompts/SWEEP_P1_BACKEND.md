# SWEEP P1: Major Backend Fixes

**Date:** 2026-02-05
**Tasks:** 4
**Max Iterations:** 40
**Source:** CODE_SWEEP_REPORT.md
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing SWEEP P1: Major Backend Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/CODE_SWEEP_REPORT.md (Full issue details)

---

SWEEP P1: MAJOR BACKEND FIXES (4 tasks)

| # | Task | File | Issue | Promise |
|---|------|------|-------|---------|
| 1 | Add pagination limits | gh_client.py | Add hard limits to while True loops | TASK_1_COMPLETE |
| 2 | Add exception logging | file_lock.py | Log errors in bare except blocks | TASK_2_COMPLETE |
| 3 | Fix httpx error handling | duplicates.py | Catch specific httpx exceptions | TASK_3_COMPLETE |
| 4 | Add httpx timeout | duplicates.py | Add explicit timeout config | TASK_4_COMPLETE |

FINAL: <promise>SWEEP_P1_BE_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Add Hard Pagination Limits
   - File: apps/backend/runners/github/gh_client.py
   - Lines: 1033-1057, 1085-1108
   - Issue: while True loops with only soft warnings at page > 50
   - Fix: Add hard break at MAX_PAGES (e.g., 100) and/or MAX_ITEMS
   - Example:
     ```python
     MAX_PAGES = 100
     MAX_ITEMS = 5000

     while True:
         # ... existing code
         if page > MAX_PAGES:
             logger.warning(f'Hit max page limit ({MAX_PAGES})')
             break
         if total_items > MAX_ITEMS:
             logger.warning(f'Hit max items limit ({MAX_ITEMS})')
             break
     ```
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Add Exception Logging to File Lock
   - File: apps/backend/runners/github/file_lock.py
   - Lines: 180-181, 189-190
   - Issue: Bare 'except Exception: pass' blocks swallow all errors silently
   - Fix: Add warning-level logging
   - Example:
     ```python
     except Exception as e:
         logger.warning(f'Cleanup failed: {e}')
     ```
   - Say: TASK_2_COMPLETE then NEXT: Task 3

3. TASK 3: Fix httpx Error Handling
   - File: apps/backend/runners/github/duplicates.py
   - Lines: 260-278
   - Issue: Generic exception handler masks network error root cause
   - Fix: Catch specific httpx exceptions for better error messages
   - Example:
     ```python
     import httpx

     try:
         # ... existing request code
     except httpx.TimeoutException as e:
         logger.error(f'Embedding API timeout: {e}')
         raise
     except httpx.ConnectError as e:
         logger.error(f'Embedding API connection failed: {e}')
         raise
     except httpx.HTTPStatusError as e:
         logger.error(f'Embedding API error {e.response.status_code}: {e}')
         raise
     ```
   - Say: TASK_3_COMPLETE then NEXT: Task 4

4. TASK 4: Add httpx Timeout Configuration
   - File: apps/backend/runners/github/duplicates.py
   - Line: 263 (httpx.AsyncClient() creation)
   - Issue: No explicit timeout - connection could hang indefinitely
   - Fix: Add timeout configuration
   - Example:
     ```python
     async with httpx.AsyncClient(
         timeout=httpx.Timeout(30.0, connect=10.0)
     ) as client:
     ```
   - Say: TASK_4_COMPLETE

5. VERIFICATION:
   - Python syntax check all modified files:
     python -m py_compile apps/backend/runners/github/gh_client.py
     python -m py_compile apps/backend/runners/github/file_lock.py
     python -m py_compile apps/backend/runners/github/duplicates.py

6. FINAL:
   When ALL 4 tasks complete and syntax checks pass:
   <promise>SWEEP_P1_BE_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all 4 tasks are complete.
2. PYTHON 3.11+ - Use modern Python syntax
3. ADD LOGGING - Import logger if not already present
4. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 40 --completion-promise "SWEEP_P1_BE_COMPLETE"
```

---

## Expected Results

| Issue | Before | After |
|-------|--------|-------|
| Pagination | Could process thousands | Hard limit at 100 pages/5000 items |
| File lock errors | Silent swallow | Logged warnings |
| httpx errors | Generic message | Specific timeout/connect/status errors |
| httpx timeout | Could hang forever | 30s timeout, 10s connect |

## Files Modified

1. `apps/backend/runners/github/gh_client.py`
2. `apps/backend/runners/github/file_lock.py`
3. `apps/backend/runners/github/duplicates.py`
