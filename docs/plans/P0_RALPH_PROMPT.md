# P0: Critical Spec Validation Fixes - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-05
**Tasks:** 3
**Max Iterations:** 50

---

## Quick Start

Copy and paste this into Ralph:

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

EXECUTION PROTOCOL

1. Read docs/tasks/P0-critical-spec-validation-fixes.md FULLY first.

2. STEP 1: Add Task Scope to spec_writer.md
   - Location: apps/backend/prompts/spec_writer.md
   - Insert after ## Workflow Type section (around line 97)
   - Insert before ## EXECUTION RULES section
   - Add: ## Task Scope with subsections: In Scope, Out of Scope, Boundaries
   - Template in spec file

3. STEP 2: Add Task Scope to spec_quick.md
   - Location: apps/backend/prompts/spec_quick.md
   - Add simplified ## Task Scope section
   - Just In Scope and Out of Scope (one line each)

4. STEP 3: Fix Failed Planning Status Transition
   - Location: apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts
   - Lines 399-410: currently always sets human_review on failure
   - Fix: planning failure should stay in planning status
   - Only QA failure should go to human_review

5. VERIFICATION:
   - grep 'Task Scope' apps/backend/prompts/spec_writer.md
   - grep 'Task Scope' apps/backend/prompts/spec_quick.md
   - npm run build (from apps/frontend)

6. FINAL:
   When ALL 3 promises emitted AND builds pass:
   <promise>TASK_P0_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 3-TASK JOB - Do NOT stop until all 3 tasks are complete.
2. ALL REQUIRED - Every task must be executed.
3. VALIDATOR SYNC - Task Scope is required by schemas.py:122
4. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "TASK_P0_COMPLETE"
```

---

## Task Checklist

- [ ] STEP 1: Task Scope in spec_writer.md → `<promise>STEP_1_COMPLETE</promise>`
- [ ] STEP 2: Task Scope in spec_quick.md → `<promise>STEP_2_COMPLETE</promise>`
- [ ] STEP 3: Fix status transitions → `<promise>STEP_3_COMPLETE</promise>`
- [ ] Final → `<promise>TASK_P0_COMPLETE</promise>`

---

**P0: Critical Spec Validation Fixes - 3 tasks | High priority**
