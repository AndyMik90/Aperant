# P2: CI Validation - Prompt/Validator Sync Test - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-05
**Tasks:** 2
**Max Iterations:** 50

---

## Quick Start

Copy and paste this into Ralph:

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

EXECUTION PROTOCOL

1. Read docs/tasks/P2-ci-validation-sync.md FULLY first.

2. STEP 1: Find test location and patterns
   - Look at apps/backend/tests/ structure
   - Find where spec-related tests live
   - Understand pytest patterns used

3. STEP 2: Create the sync test
   - Create apps/backend/tests/spec/test_prompt_validator_sync.py
   - Import SPEC_REQUIRED_SECTIONS from schemas.py
   - Test that spec_writer.md has all required sections
   - Test that spec_quick.md has all required sections
   - Use regex to find ## Section headers
   - Clear error messages if section missing

4. VERIFICATION:
   - python -m pytest apps/backend/tests/spec/test_prompt_validator_sync.py -v

5. FINAL:
   When ALL 2 promises emitted AND test passes:
   <promise>TASK_P2_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 2-TASK JOB - Do NOT stop until all 2 tasks are complete.
2. TEST MUST PASS - The test should pass since P0 added Task Scope.
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "TASK_P2_COMPLETE"
```

---

## Task Checklist

- [ ] STEP 1: Find test location → `<promise>STEP_1_COMPLETE</promise>`
- [ ] STEP 2: Create sync test → `<promise>STEP_2_COMPLETE</promise>`
- [ ] Final → `<promise>TASK_P2_COMPLETE</promise>`

---

**P2: CI Validation Sync Test - 2 tasks | Low priority**
