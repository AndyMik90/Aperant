# Ralph Prompt: LIFECYCLE Tasks - Task Lifecycle Architecture

**Created:** 2026-02-04
**Executed:** 2026-02-04
**Status:** COMPLETE
**Duration:** 10m 13s
**Priority:** HIGH

---

## Overview

4 tasks to complete the task lifecycle architecture:

| # | Task | Priority | Promise |
|---|------|----------|---------|
| 1 | LIFECYCLE-1: Ralph-compatible spec output | HIGH | LIFECYCLE_1_RALPH_SPEC_COMPLETE |
| 2 | LIFECYCLE-2: Ralph Loop integration | HIGH | LIFECYCLE_2_RALPH_LOOP_COMPLETE |
| 3 | LIFECYCLE-3: AI Review persistent memory | MEDIUM | LIFECYCLE_3_AI_MEMORY_COMPLETE |
| 4 | LIFECYCLE-4: Human Review rejection memory | MEDIUM | LIFECYCLE_4_HUMAN_MEMORY_COMPLETE |

**FINAL:** `<promise>LIFECYCLE_TODOS_COMPLETE</promise>`

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer completing 4 lifecycle tasks for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\architecture\TASK_LIFECYCLE.md (requirements and TODOs)
- docs\plans\RALPH_IMPLEMENTATION_GUIDE.md (Ralph spec format)

---

## TASKS (4 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | LIFECYCLE-1: Ralph-compatible spec output | LIFECYCLE_1_RALPH_SPEC_COMPLETE |
| 2 | LIFECYCLE-2: Ralph Loop integration | LIFECYCLE_2_RALPH_LOOP_COMPLETE |
| 3 | LIFECYCLE-3: AI Review persistent memory | LIFECYCLE_3_AI_MEMORY_COMPLETE |
| 4 | LIFECYCLE-4: Human Review rejection memory | LIFECYCLE_4_HUMAN_MEMORY_COMPLETE |

**FINAL:** <promise>LIFECYCLE_TODOS_COMPLETE</promise>

---

## TASK 1: Ralph-Compatible Spec Output

File: apps/backend/runners/spec_runner.py

Update planning agent to output spec.md in Ralph-compatible format:
- Task overview and success criteria
- Execution rules (DO NOT STOP warnings)
- Implementation steps with: Step N of Total, Files, What, Exit, Promise
- Each step ends with: <promise>STEP_N_COMPLETE</promise>
- Final verification checklist
- Completion promise: <promise>TASK_{ID}_COMPLETE</promise>

Then output: <promise>LIFECYCLE_1_RALPH_SPEC_COMPLETE</promise>
Say: NEXT: Task 2 and begin Task 2

---

## TASK 2: Ralph Loop Integration

Files:
- apps/frontend/src/main/agent/agent-manager.ts
- apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts

Update startTaskExecution to:
1. Read spec.md content
2. Validate Ralph-compatible format
3. Construct prompt with spec content and execution rules
4. Monitor stdout for <promise>STEP_N_COMPLETE</promise> (update progress)
5. Detect <promise>TASK_{ID}_COMPLETE</promise> (transition to AI Review)

Then output: <promise>LIFECYCLE_2_RALPH_LOOP_COMPLETE</promise>
Say: NEXT: Task 3 and begin Task 3

---

## TASK 3: AI Review Persistent Memory

File: apps/backend/runners/run.py (or QA logic)

When AI Review finds issues:
1. Append to {spec_dir}/memories/issues.md
2. Include: Issue title, Date, Description, Root Cause, Fix Applied, Prevention tip
3. Update planning to read issues.md and avoid past mistakes

Then output: <promise>LIFECYCLE_3_AI_MEMORY_COMPLETE</promise>
Say: NEXT: Task 4 and begin Task 4

---

## TASK 4: Human Review Rejection Memory

File: apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts

In TASK_REVIEW handler when approved=false:
1. Append to {spec_dir}/memories/human_feedback.md
2. Include: Date, Feedback text, Screenshot references

Then output: <promise>LIFECYCLE_4_HUMAN_MEMORY_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 4 promises were output
3. Output: <promise>LIFECYCLE_TODOS_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 4 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. NO SUMMARIES - progress summaries are NOT stopping points
4. The job is done ONLY when <promise>LIFECYCLE_TODOS_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>LIFECYCLE_TODOS_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "LIFECYCLE_TODOS_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `spec_runner.py` or prompts | Ralph-compatible spec format |
| `agent-manager.ts` | Ralph Loop invocation |
| `execution-handlers.ts` | Progress tracking, human feedback memory |
| `run.py` or QA logic | AI Review issue memory |

---

## Completion Promise

```
LIFECYCLE_TODOS_COMPLETE
```
