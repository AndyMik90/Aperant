# Task: P0 Critical Spec Validation Fixes

## Overview

Fix two critical bugs blocking the planning pipeline: (1) Add missing "Task Scope" section to spec_writer.md template that the validator requires, and (2) Fix the frontend status transition so failed planning stays in "planning" status instead of incorrectly moving to "human_review".

## Task Scope

### In Scope
- Add "## Task Scope" section to `prompts/spec_writer.md` template
- Add "## Task Scope" section to `prompts/spec_quick.md` template
- Fix `agent-events-handlers.ts` to handle phase-aware failure status

### Out of Scope
- Changes to the validator itself (schemas.py is correct)
- Changes to other agent prompts (coder.md, qa_reviewer.md are fine)
- UI changes beyond status transition fix

## Success Criteria

- [ ] spec_writer.md contains `## Task Scope` section with In Scope, Out of Scope, Boundaries subsections
- [ ] spec_quick.md contains `## Task Scope` section (simplified version)
- [ ] agent-events-handlers.ts routes planning failures to "planning" status, not "human_review"
- [ ] Existing tests still pass

## Workflow Type

**Type**: bugfix

---

## EXECUTION RULES (READ BEFORE STARTING)

**You are NOT ALLOWED to stop until ALL steps below are complete and the final promise is output.**

1. Complete each step in order
2. Output the step promise IMMEDIATELY after completing each step
3. **DO NOT** write progress summaries between steps - just continue
4. After each step promise, continue to the next step WITHOUT stopping
5. Only stop after outputting the FINAL `<promise>TASK_P0_COMPLETE</promise>`

---

## Implementation Steps

**Total Steps: 3** (You must complete ALL steps)

### Step 1 of 3: Add Task Scope to spec_writer.md

**Files:** `apps/backend/prompts/spec_writer.md`

**What:** Add a `## Task Scope` section to the spec template. Insert it after the `## Workflow Type` section (around line 97) and before `## EXECUTION RULES`. The section should include:
- `### In Scope` - What IS included in this task
- `### Out of Scope` - What is NOT included (helps agent stay focused)
- `### Boundaries` - Services affected, constraints

**Template to add:**
```markdown
## Task Scope

### In Scope
- [List specific deliverables from requirements.json]
- [Features/changes that ARE part of this task]

### Out of Scope
- [Explicitly list what this task does NOT include]
- [Related features that should be separate tasks]
- [Refactoring or improvements beyond the ask]

### Boundaries
- Services affected: [from requirements.json services_involved]
- Files touched: [estimated count from context.json]
```

**Exit:** spec_writer.md contains `## Task Scope` section between Workflow Type and Execution Rules

**After completing this step:**
1. Output: `<promise>STEP_1_COMPLETE</promise>`
2. Say: **NEXT: Step 2 - Add Task Scope to spec_quick.md**
3. DO NOT stop. Continue immediately.

---

### Step 2 of 3: Add Task Scope to spec_quick.md

**Files:** `apps/backend/prompts/spec_quick.md`

**What:** Add a simplified `## Task Scope` section to the quick spec template. This template is for simple tasks, so keep it minimal.

**Template to add:**
```markdown
## Task Scope

**In Scope:** [One line describing what's included]

**Out of Scope:** [One line describing what's excluded]
```

**Exit:** spec_quick.md contains `## Task Scope` section

**After completing this step:**
1. Output: `<promise>STEP_2_COMPLETE</promise>`
2. Say: **NEXT: Step 3 - Fix agent-events-handlers.ts**
3. DO NOT stop. Continue immediately.

---

### Step 3 of 3: Fix Failed Planning Status Transition

**Files:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`

**What:** Fix lines 399-410 so that when an agent fails (non-zero exit code), the status reflects the current phase instead of always going to "human_review".

**Current buggy code (lines 399-410):**
```typescript
} else {
  // code !== 0 (FAILURE case)
  notificationService.notifyTaskFailed(taskTitle, project.id, taskId);
  persistStatus("human_review");  // BUG: Always human_review
  safeSendToRenderer(
    getMainWindow,
    IPC_CHANNELS.TASK_STATUS_CHANGE,
    taskId,
    "human_review" as TaskStatus,
    projectId
  );
}
```

**Fix:** Determine appropriate status based on current phase:
- Planning failure → stay in "planning"
- Coding failure → stay in "coding"
- QA failure → move to "human_review" (this is correct)

**Implementation approach:**
1. Check what phase is currently running (should be available in scope or passed to handler)
2. Map phase to failure status
3. Use that status instead of hardcoded "human_review"

**Exit:** Failed planning tasks stay in "planning" status, not "human_review"

**After completing this step:**
1. Output: `<promise>STEP_3_COMPLETE</promise>`
2. Say: **NEXT: Final Verification**
3. DO NOT stop. Continue immediately.

---

## Files to Modify

| File | What to Change |
|------|---------------|
| `apps/backend/prompts/spec_writer.md` | Add `## Task Scope` section after Workflow Type |
| `apps/backend/prompts/spec_quick.md` | Add simplified `## Task Scope` section |
| `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts` | Fix lines 399-410 to use phase-aware status |

## Files to Reference

| File | Pattern to Copy |
|------|----------------|
| `apps/backend/spec/validate_pkg/schemas.py:119-124` | See SPEC_REQUIRED_SECTIONS for required sections |
| `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts:366-398` | Success case handling (for comparison) |

---

## Final Verification Checklist

Before outputting the completion promise, verify:

- [ ] spec_writer.md has `## Task Scope` section
- [ ] spec_quick.md has `## Task Scope` section
- [ ] agent-events-handlers.ts failure case uses phase-aware status
- [ ] No syntax errors in modified files

## Completion Promise

**ONLY output this after ALL steps are complete and verified:**

<promise>TASK_P0_COMPLETE</promise>
