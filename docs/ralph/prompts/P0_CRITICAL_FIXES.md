# P0: Critical Spec Validation Fixes

**Date:** 2026-02-05
**Tasks:** 3
**Max Iterations:** 50

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing P0: Critical Spec Validation Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 3-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/
- Frontend: apps/frontend/

Primary documentation:
- docs/tasks/P0-critical-spec-validation-fixes.md (THIS IS YOUR SPEC)
- docs/architecture/AGENT_ISSUES_2026-02-05.md (Root cause analysis)

---

P0: CRITICAL SPEC VALIDATION FIXES (3 tasks)

| # | Task | File | Promise |
|---|------|------|---------|
| 1 | Add Task Scope section | apps/backend/prompts/spec_writer.md | STEP_1_COMPLETE |
| 2 | Add Task Scope (quick) | apps/backend/prompts/spec_quick.md | STEP_2_COMPLETE |
| 3 | Fix status transitions | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | STEP_3_COMPLETE |

FINAL: <promise>TASK_P0_COMPLETE</promise>

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "TASK_P0_COMPLETE"
```
