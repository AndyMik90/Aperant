# P1: Planning Agent Efficiency Improvements - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-05
**Tasks:** 3
**Max Iterations:** 75

---

## Quick Start

Copy and paste this into Ralph:

```bash
/ralph-loop:ralph-loop "
You are completing P1: Planning Agent Efficiency Improvements for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 3-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/tasks/P1-planning-agent-improvements.md (THIS IS YOUR SPEC)

---

P1: PLANNING AGENT EFFICIENCY (3 tasks)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | Investigate | Find where planning agent reads files | STEP_1_COMPLETE |
| 2 | File caching | Add read caching to prevent duplicates | STEP_2_COMPLETE |
| 3 | Error injection | Inject validation errors into agent context | STEP_3_COMPLETE |

FINAL: <promise>TASK_P1_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs/tasks/P1-planning-agent-improvements.md FULLY first.

2. STEP 1: Investigate file reading flow
   - Find where planning agent reads project_index.json, context.json, etc.
   - Check apps/backend/spec/ and apps/backend/agents/
   - Document entry points

3. STEP 2: Add file read caching
   - Add session-level cache or tool-level deduplication
   - Log when cache is hit to confirm it works

4. STEP 3: Validation error injection
   - Find where spec validation retries happen
   - Inject specific errors into agent context on retry
   - Don't just silently retry with same prompt

5. VERIFICATION:
   - python -m py_compile apps/backend/spec/*.py
   - python -m py_compile apps/backend/agents/*.py

6. FINAL:
   When ALL 3 promises emitted:
   <promise>TASK_P1_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 3-TASK JOB - Do NOT stop until all 3 tasks are complete.
2. INVESTIGATE FIRST - Understand the codebase before changing it.
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 75 --completion-promise "TASK_P1_COMPLETE"
```

---

## Task Checklist

- [ ] STEP 1: Investigate file reading flow → `<promise>STEP_1_COMPLETE</promise>`
- [ ] STEP 2: Add file read caching → `<promise>STEP_2_COMPLETE</promise>`
- [ ] STEP 3: Validation error injection → `<promise>STEP_3_COMPLETE</promise>`
- [ ] Final → `<promise>TASK_P1_COMPLETE</promise>`

---

**P1: Planning Agent Efficiency - 3 tasks | Medium priority**
