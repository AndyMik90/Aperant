# Auto-Claude Agent Architecture Issues & Improvements

**Date:** 2026-02-05
**Investigator:** Claude Code
**Trigger:** Task went from Planning → Human Review with 0/0 subtasks, 18+ minute runtime

---

## Executive Summary

A task created via jerry-bot chat failed during planning phase and incorrectly transitioned to Human Review instead of staying in Planning with an error state. Investigation revealed multiple issues across the agent pipeline.

---

## Issue 1: Template/Validator Mismatch (CRITICAL)

### Problem
The spec validator requires a "Task Scope" section, but the spec_writer.md template doesn't include it.

### Files Involved
| File | Line | Issue |
|------|------|-------|
| `spec/validate_pkg/schemas.py` | 119-124 | Requires: Overview, Workflow Type, **Task Scope**, Success Criteria |
| `prompts/spec_writer.md` | 80-273 | Template MISSING "## Task Scope" section |
| `prompts/spec_writer.md` | 286 | Verification grep checks for Task Scope (but template doesn't have it) |
| `prompts/spec_writer.md` | 316 | Rules say to include Task Scope (but template doesn't have it) |

### Root Cause
The spec template defines these sections:
- ✅ Overview
- ✅ Success Criteria
- ✅ Workflow Type
- ✅ Execution Rules
- ✅ Implementation Steps
- ✅ Files to Modify
- ✅ Files to Reference
- ❌ **Task Scope** (MISSING from template!)

The agent correctly follows its template but the validator expects a section that isn't there.

### Fix Required
**Option A (Recommended):** Add `## Task Scope` section to spec_writer.md template
**Option B:** Remove "Task Scope" from SPEC_REQUIRED_SECTIONS in schemas.py

### Suggested Template Addition
```markdown
## Task Scope

### In Scope
- [List what IS included in this task]

### Out of Scope
- [List what is NOT included - helps agent stay focused]

### Boundaries
- Services affected: [from requirements.json services_involved]
- Time estimate: [if available]
```

---

## Issue 2: Failed Planning → Human Review Bug (CRITICAL)

### Problem
When an agent fails (non-zero exit code), the frontend always moves the task to `human_review` regardless of which phase failed.

### File Involved
`apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts` lines 399-410

### Current (Buggy) Code
```typescript
} else {
  // code !== 0 (FAILURE case)
  notificationService.notifyTaskFailed(taskTitle, project.id, taskId);
  persistStatus("human_review");  // ← BUG: Always moves to human_review
  safeSendToRenderer(
    getMainWindow,
    IPC_CHANNELS.TASK_STATUS_CHANGE,
    taskId,
    "human_review" as TaskStatus,
    projectId
  );
}
```

### Expected Behavior
- Planning failure → Stay in `planning` with error state
- Coding failure → Stay in `coding` with error state
- QA failure → Move to `human_review` (this IS correct)

### Fix Required
Check the current phase before setting status:
```typescript
} else {
  // code !== 0 (FAILURE case)
  notificationService.notifyTaskFailed(taskTitle, project.id, taskId);

  // Determine appropriate status based on phase
  const failureStatus = currentPhase === "qa"
    ? "human_review"
    : currentPhase; // Stay in current phase

  persistStatus(failureStatus);
  safeSendToRenderer(
    getMainWindow,
    IPC_CHANNELS.TASK_STATUS_CHANGE,
    taskId,
    failureStatus as TaskStatus,
    projectId
  );
}
```

---

## Issue 3: Planning Agent Inefficiency (HIGH)

### Problem
Planning took 18+ minutes for a relatively simple 6-step spec. Agent showed inefficient behavior:

### Observed Issues (from task_logs.json)
1. **Duplicate File Reads**: Read the same files multiple times
   - project_index.json read 3+ times
   - context.json read 3+ times
   - spec.md read after writing (unnecessary)

2. **Duplicate Spec Writes**: Wrote spec.md twice
   - First write at 09:37:05
   - Second write attempt at 09:40:11

3. **Edit Tool Errors**: Multiple "File has not been read yet" errors
   - Lines 800-804, 920-927, 954-961 in task_logs.json

4. **Redundant Verification**: Ran multiple bash grep commands to verify sections that were just written

5. **Wrong File Paths**: Initially tried to read files from wrong paths (./project_index.json instead of spec_dir path)

### Metrics
- Total runtime: ~11 minutes in task_logs (09:32:48 to 09:43:46)
- But user reported 18+ minutes total planning phase
- Spec output: 398 lines (reasonable)
- Attempts: 3 (all failed same validation)

### Improvements Needed
1. **Read-Once Pattern**: Track which files have been read in agent memory
2. **Path Resolution**: Always resolve relative paths to absolute before reading
3. **Write Verification**: After Write tool, assume file exists (no need to re-read)
4. **Fail Fast**: After first validation failure, show specific error to agent

---

## Issue 4: Empty implementation_plan.json

### Problem
The implementation_plan.json has `phases: []` because spec_writing failed before planning phase ran.

### File Content
```json
{
  "feature": "Phase 0: Foundation Fixes - Critical Blockers",
  "status": "human_review",
  "phases": [],  // EMPTY - planning never generated subtasks
  "planStatus": "review"
}
```

### Root Cause
This is a SYMPTOM of Issue 1 (spec validation failure), not a separate bug. The planning phase that generates subtasks never ran because spec_writing failed.

### Expected Flow
1. spec_writing → Creates spec.md ✓
2. spec validation → Should pass (currently fails)
3. planning → Generates implementation_plan.json with phases
4. plan validation → Verifies phases exist

---

## Phase Audit: Coding Phase

### Validation Architecture
| Component | File | Status |
|-----------|------|--------|
| Subtask status validation | `agents/tools_pkg/tools/subtask.py:87-141` | ✅ OK |
| Valid statuses | `["pending", "in_progress", "completed", "failed"]` | ✅ OK |
| Plan validation | `spec/validate_pkg/validators/implementation_plan_validator.py` | ✅ OK |

### Prompt/Validator Alignment
The coder.md prompt correctly instructs the agent to:
- Update subtask status to "completed" or "failed"
- Create commits after each subtask
- Run verification commands

**No template/validator mismatch found in coding phase.**

### Potential Issues
1. **Self-Critique Step**: Step 6.5 is optional but critical - agent may skip it
2. **Git Commit Rules**: Lines 705-761 have complex path verification that could cause issues

---

## Phase Audit: QA/AI Review Phase

### Validation Architecture
| Component | File | Status |
|-----------|------|--------|
| QA status validation | `agents/tools_pkg/tools/qa.py:103-118` | ✅ OK |
| Valid statuses | `["pending", "in_review", "approved", "rejected", "fixes_applied"]` | ✅ OK |
| qa_signoff structure | `agents/tools_pkg/tools/qa.py:26-71` | ✅ OK |

### Prompt/Validator Alignment
The qa_reviewer.md prompt correctly instructs the agent to:
- Update `implementation_plan.json` with `qa_signoff` object
- Create `qa_report.md` with findings
- Create `QA_FIX_REQUEST.md` if issues found

**No template/validator mismatch found in QA phase.**

### Escalation Logic (Working Correctly)
- Recurring issues (≥3 times) → Human review
- Max iterations (50) → Human review
- Consecutive errors (3+) → Human review

---

## Recommended Architecture Improvements

### 1. Prompt/Validator Sync System
Create a validation layer that ensures prompts and validators stay in sync:

```python
# spec_contract.py
SPEC_SECTIONS = {
    "required": ["Overview", "Workflow Type", "Task Scope", "Success Criteria"],
    "recommended": ["Files to Modify", "Files to Reference", "Requirements", "QA Acceptance Criteria"]
}

# Use this SAME definition in:
# - schemas.py (validator)
# - spec_writer.md (prompt template)
# - spec_quick.md (quick spec template)
```

### 2. Agent Memory Deduplication
Track file reads in session to prevent redundant reads:

```python
class AgentSession:
    def __init__(self):
        self.files_read: dict[str, str] = {}  # path -> content

    def read_file(self, path: str) -> str:
        if path in self.files_read:
            return self.files_read[path]  # Return cached
        content = actual_read(path)
        self.files_read[path] = content
        return content
```

### 3. Phase-Aware Status Transitions
```typescript
// agent-events-handlers.ts
const PHASE_FAILURE_STATUS: Record<string, TaskStatus> = {
  "planning": "planning",      // Stay in planning
  "coding": "coding",          // Stay in coding
  "qa": "human_review",        // Escalate to human
};

function getFailureStatus(phase: string): TaskStatus {
  return PHASE_FAILURE_STATUS[phase] ?? "human_review";
}
```

### 4. Validation Error Feedback Loop
When validation fails, inject the specific error into the agent's next turn:

```python
if not validation_result.valid:
    error_context = f"""
    VALIDATION FAILED: {validation_result.errors}

    You must fix these issues:
    {validation_result.fixes}

    Re-read the requirements and add the missing sections.
    """
    # Inject into agent's next message
    agent.inject_system_message(error_context)
```

### 5. Spec Template Linting
Add a CI check that validates prompt templates against schemas:

```python
# test_prompt_validator_sync.py
def test_spec_writer_has_all_required_sections():
    template = read_file("prompts/spec_writer.md")
    for section in SPEC_REQUIRED_SECTIONS:
        assert f"## {section}" in template, f"Template missing: {section}"
```

---

## Action Items

| Priority | Issue | Fix |
|----------|-------|-----|
| P0 | Missing Task Scope in template | Add section to spec_writer.md |
| P0 | Failed→Human Review bug | Fix status transition logic |
| P1 | Planning inefficiency | Implement file read caching |
| P1 | Validation error feedback | Inject errors into agent context |
| P2 | Prompt/validator sync | Create shared definitions |
| P2 | CI validation | Add template linting tests |

---

## Test Reproduction

To reproduce the original issue:
1. Create a task via jerry-bot chat interface
2. Click "Create" from chat window
3. Task will fail spec validation with "Missing Task Scope"
4. Task incorrectly moves to Human Review with 0/0 subtasks

Expected after fix:
1. Spec includes Task Scope section
2. Validation passes
3. Planning generates subtasks
4. Task proceeds to Coding phase
