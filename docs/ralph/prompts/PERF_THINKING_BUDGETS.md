# PERF: Thinking Budget Optimization (P2)

**Date:** 2026-02-05
**Tasks:** 2
**Max Iterations:** 20
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing Thinking Budget Optimization for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 2-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/architecture/AGENT_SPEED_INVESTIGATION.md (Root cause analysis)

---

THINKING BUDGET OPTIMIZATION (2 tasks)

| # | Task | File | Change | Promise |
|---|------|------|--------|---------|
| 1 | Reduce planning thinking | apps/backend/phase_config.py | Change planning: 'high' → 'medium' | TASK_1_COMPLETE |
| 2 | Reduce QA thinking | apps/backend/phase_config.py | Change qa: 'high' → 'medium' | TASK_2_COMPLETE |

FINAL: <promise>THINKING_BUDGET_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Reduce Planning Thinking Budget
   - Open apps/backend/phase_config.py
   - Find DEFAULT_PHASE_THINKING dict
   - Change: 'planning': 'high' → 'planning': 'medium'
   - This reduces thinking from 16384 to 4096 tokens (~10-20s savings per API call)
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Reduce QA Thinking Budget
   - In same DEFAULT_PHASE_THINKING dict
   - Change: 'qa': 'high' → 'qa': 'medium'
   - This reduces thinking from 16384 to 4096 tokens
   - Say: TASK_2_COMPLETE

3. VERIFICATION:
   - Read the file to confirm both changes
   - Ensure DEFAULT_PHASE_THINKING has:
     - 'spec': 'medium' (unchanged)
     - 'planning': 'medium' (changed from high)
     - 'coding': 'medium' (unchanged)
     - 'qa': 'medium' (changed from high)

4. FINAL:
   When BOTH tasks complete:
   <promise>THINKING_BUDGET_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 2-TASK JOB - Do NOT stop until both tasks are complete.
2. SAME FILE - Both changes are in phase_config.py
3. DO NOT change 'spec' or 'coding' - they stay at 'medium'
4. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 20 --completion-promise "THINKING_BUDGET_COMPLETE"
```

---

## Expected Results

| Phase | Before | After | Savings |
|-------|--------|-------|---------|
| planning | 16384 tokens (high) | 4096 tokens (medium) | ~10-20s per call |
| qa | 16384 tokens (high) | 4096 tokens (medium) | ~10-20s per call |

## File Modified

- `apps/backend/phase_config.py` - DEFAULT_PHASE_THINKING dict
