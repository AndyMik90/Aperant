# Ralph Tasks: Task Lifecycle TODOs

**Created:** 2026-02-04
**Status:** Ready for execution
**Related:** [TASK_LIFECYCLE.md](../architecture/TASK_LIFECYCLE.md)

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

## Task 1: LIFECYCLE-1 - Ralph-Compatible Spec Output

### What

Update the planning agent to output `spec.md` in Ralph-compatible format that the coding phase can execute via Ralph Loop.

### Files

- `apps/backend/runners/spec_runner.py` - Main spec runner
- `apps/backend/prompts/` - Planning prompts (if separate)

### Requirements

The planning agent must generate `spec.md` with this structure:

1. **Task overview** - Brief description
2. **Success criteria** - Checkboxes
3. **Execution rules** - DO NOT STOP warnings
4. **Implementation steps** - Each step must have:
   - Step N of Total (running count)
   - Files to modify
   - What to do
   - Exit condition
   - Promise: `<promise>STEP_N_COMPLETE</promise>`
   - NEXT: pointer to next step
5. **Final verification** - Checklist before completion
6. **Completion promise** - `<promise>TASK_{ID}_COMPLETE</promise>`

### Exit Criteria

- Planning agent outputs spec.md in Ralph-compatible format
- spec.md includes step promises
- spec.md includes execution rules
- Build passes

### Promise

```
LIFECYCLE_1_RALPH_SPEC_COMPLETE
```

---

## Task 2: LIFECYCLE-2 - Ralph Loop Integration

### What

Update the coding phase to invoke Ralph Loop instead of running run.py directly.

### Files

- `apps/frontend/src/main/agent/agent-manager.ts` - startTaskExecution method
- `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` - TASK_START_BUILD handler

### Requirements

1. **TASK_START_BUILD handler** should:
   - Validate spec.md exists
   - Validate spec.md is Ralph-compatible format (has steps, promises)
   - If invalid, return error with helpful message

2. **startTaskExecution** should:
   - Read spec.md content
   - Construct Ralph Loop invocation prompt
   - Include execution rules in the prompt
   - Set completion promise: `TASK_{specId}_COMPLETE`
   - Monitor stdout for step promises and update progress

3. **Progress tracking**:
   - Parse `<promise>STEP_N_COMPLETE</promise>` from stdout
   - Update task progress in UI
   - Detect `<promise>TASK_{ID}_COMPLETE</promise>` for completion

### Exit Criteria

- startTaskExecution invokes Ralph Loop with spec.md
- Step promises are detected and progress updates
- Task completion promise triggers transition to AI Review
- Build passes

### Promise

```
LIFECYCLE_2_RALPH_LOOP_COMPLETE
```

---

## Task 3: LIFECYCLE-3 - AI Review Persistent Memory

### What

When AI Review finds issues, document them to persistent memory so the same issues won't be repeated in future tasks.

### Files

- `apps/backend/runners/run.py` - QA/AI Review logic (or qa_runner.py if separate)
- Planning prompts - Must read issues.md

### Requirements

1. **When AI Review finds an issue**:
   - Append to `/memories/issues.md` in the spec directory
   - Include:
     - Issue title/description
     - Root cause analysis
     - Fix that was applied
     - Prevention tip for future

2. **Format for issues.md**:
```markdown
## Issue: {title}
**Date:** {ISO timestamp}
**Phase:** AI Review

### Description
{What went wrong}

### Root Cause
{Why it happened}

### Fix Applied
{How it was fixed}

### Prevention
{How to avoid this in future tasks}

---
```

3. **Planning agent reads issues.md**:
   - Before creating spec.md, read existing issues
   - Avoid approaches that caused documented issues
   - Reference learnings in implementation plan

### Exit Criteria

- AI Review writes issues to /memories/issues.md when found
- Issues include description, root cause, fix, prevention
- Planning agent reads and considers past issues
- Build passes

### Promise

```
LIFECYCLE_3_AI_MEMORY_COMPLETE
```

---

## Task 4: LIFECYCLE-4 - Human Review Rejection Memory

### What

When user rejects in Human Review, save feedback to persistent memory for future reference.

### Files

- `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` - TASK_REVIEW handler

### Requirements

1. **In TASK_REVIEW handler when approved=false**:
   - Create `/memories/human_feedback.md` if not exists
   - Append rejection feedback
   - Include screenshot references if provided

2. **Format for human_feedback.md**:
```markdown
## Human Review Rejection
**Date:** {ISO timestamp}

### Feedback
{User's feedback text}

### Screenshots
{List of screenshot filenames if any}

---
```

3. **Planning agent reads human_feedback.md**:
   - Consider past rejections when planning
   - Avoid patterns that were rejected before

### Exit Criteria

- TASK_REVIEW appends to /memories/human_feedback.md on rejection
- Feedback and screenshots are saved
- Build passes

### Promise

```
LIFECYCLE_4_HUMAN_MEMORY_COMPLETE
```

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

## Execution Order

These tasks should be executed in order because:

1. **LIFECYCLE-1** must be done first - Planning creates spec.md
2. **LIFECYCLE-2** depends on 1 - Coding reads the Ralph-compatible spec
3. **LIFECYCLE-3** and **LIFECYCLE-4** can be done in any order (independent)

---

## Notes

- Tasks 1 and 2 are HIGH priority (core functionality)
- Tasks 3 and 4 are MEDIUM priority (enhancement for learning)
- All 4 tasks together complete the task lifecycle architecture

---

**Document Version:** 1.0
**Last Updated:** 2026-02-04
