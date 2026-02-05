# P2: CI Validation - Prompt/Validator Sync Test

**Date:** 2026-02-05
**Tasks:** 2
**Max Iterations:** 50

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing P2: CI Validation - Prompt/Validator Sync Test for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 2-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/tasks/P2-ci-validation-sync.md (THIS IS YOUR SPEC)

---

P2: CI VALIDATION SYNC TEST (2 tasks)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | Find test location | Find existing test patterns in apps/backend/tests/ | STEP_1_COMPLETE |
| 2 | Create sync test | Create test_prompt_validator_sync.py | STEP_2_COMPLETE |

FINAL: <promise>TASK_P2_COMPLETE</promise>

---

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "TASK_P2_COMPLETE"
```
