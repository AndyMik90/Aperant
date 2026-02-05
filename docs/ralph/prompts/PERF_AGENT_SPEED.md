# PERF: Agent Speed Fixes (P0 + P1)

**Date:** 2026-02-05
**Tasks:** 3
**Max Iterations:** 30
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing Agent Speed Performance Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 3-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/architecture/AGENT_SPEED_INVESTIGATION.md (Root cause analysis)

---

AGENT SPEED FIXES (3 tasks)

| # | Task | File | Change | Promise |
|---|------|------|--------|---------|
| 1 | Block Task tool in Jerry | apps/backend/runners/insights_runner.py | Add disallowed_tools: ['Task'] | TASK_1_COMPLETE |
| 2 | Reduce Jerry max_turns | apps/backend/runners/insights_runner.py | Change max_turns 30→15 | TASK_2_COMPLETE |
| 3 | Reduce pipeline max_turns | apps/backend/core/client.py | Change max_turns 1000→100 | TASK_3_COMPLETE |

FINAL: <promise>AGENT_SPEED_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Block Task Tool in Jerry Chat
   - Open apps/backend/runners/insights_runner.py
   - Find options_kwargs dict in run_with_sdk function (around line 194-200)
   - Add this line: 'disallowed_tools': ['Task'],
   - This blocks subagent spawning which causes 5+ minute responses
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Reduce Jerry max_turns
   - In same options_kwargs dict in insights_runner.py
   - Change: 'max_turns': 30 → 'max_turns': 15
   - This prevents runaway sessions
   - Say: TASK_2_COMPLETE then NEXT: Task 3

3. TASK 3: Reduce Pipeline max_turns
   - Open apps/backend/core/client.py
   - Find max_turns: 1000 (around line 1035)
   - Change to: 'max_turns': 100
   - This prevents agents from burning API credits in loops
   - Say: TASK_3_COMPLETE

4. VERIFICATION:
   - Read both files to confirm changes are present
   - Ensure no syntax errors
   - Check that disallowed_tools contains 'Task'
   - Check that insights_runner max_turns is 15
   - Check that client.py max_turns is 100

5. FINAL:
   When ALL 3 tasks complete:
   <promise>AGENT_SPEED_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 3-TASK JOB - Do NOT stop until all 3 tasks are complete.
2. TWO FILES - insights_runner.py (tasks 1-2) and client.py (task 3)
3. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until all 3 tasks verified

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 30 --completion-promise "AGENT_SPEED_COMPLETE"
```

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Jerry chat response | 5+ min | ~30s |
| Agent stuck in loop | Burns credits for hours | Stops at 100 turns |

## Files Modified

1. `apps/backend/runners/insights_runner.py`
   - Added `disallowed_tools: ['Task']`
   - Changed `max_turns: 30` → `15`

2. `apps/backend/core/client.py`
   - Changed `max_turns: 1000` → `100`
