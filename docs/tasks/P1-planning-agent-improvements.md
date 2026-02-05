# Task: P1 Planning Agent Efficiency Improvements

## Overview

Improve planning agent efficiency by adding file read caching (prevent re-reading same files multiple times) and validation error injection (give agent specific feedback when validation fails instead of silent retry).

## Task Scope

### In Scope
- Add file read tracking/caching mechanism to planning agent
- Inject validation errors into agent context for self-correction
- Improve error messages shown to agent

### Out of Scope
- Changes to coding or QA agents
- UI changes
- Validator logic changes

## Success Criteria

- [ ] Planning agent tracks which files have been read in a session
- [ ] Duplicate file reads return cached content (or skip)
- [ ] When spec validation fails, specific errors are injected into agent's next turn
- [ ] Planning time reduced for typical tasks

## Workflow Type

**Type**: feature

---

## EXECUTION RULES (READ BEFORE STARTING)

**You are NOT ALLOWED to stop until ALL steps below are complete and the final promise is output.**

1. Complete each step in order
2. Output the step promise IMMEDIATELY after completing each step
3. **DO NOT** write progress summaries between steps - just continue
4. After each step promise, continue to the next step WITHOUT stopping
5. Only stop after outputting the FINAL `<promise>TASK_P1_COMPLETE</promise>`

---

## Implementation Steps

**Total Steps: 3** (You must complete ALL steps)

### Step 1 of 3: Investigate Current File Reading Pattern

**Files:**
- `apps/backend/agents/` (find where file reads happen)
- `apps/backend/spec/` (find spec orchestrator)

**What:**
1. Find where the planning agent reads files (project_index.json, context.json, etc.)
2. Understand the current flow and identify where caching could be added
3. Document the entry points for file reads

**Exit:** Understand the file reading flow and identify injection points for caching

**After completing this step:**
1. Output: `<promise>STEP_1_COMPLETE</promise>`
2. Say: **NEXT: Step 2 - Add File Read Caching**
3. DO NOT stop. Continue immediately.

---

### Step 2 of 3: Add File Read Caching

**Files:** Determined in Step 1

**What:** Add a mechanism to track and cache file reads during a planning session:

**Option A - Session-level cache:**
```python
class PlanningSession:
    def __init__(self):
        self.file_cache: dict[str, str] = {}

    def read_file_cached(self, path: str) -> str:
        if path in self.file_cache:
            debug("planning", f"Using cached content for {path}")
            return self.file_cache[path]
        content = Path(path).read_text()
        self.file_cache[path] = content
        return content
```

**Option B - Tool-level deduplication:**
Add tracking to the Read tool to warn/skip when same file is read multiple times in same session.

**Exit:** File reads are cached or deduplicated during planning sessions

**After completing this step:**
1. Output: `<promise>STEP_2_COMPLETE</promise>`
2. Say: **NEXT: Step 3 - Add Validation Error Injection**
3. DO NOT stop. Continue immediately.

---

### Step 3 of 3: Add Validation Error Injection

**Files:**
- `apps/backend/spec/spec.py` or wherever spec validation retry happens
- `apps/backend/spec/validate_pkg/`

**What:** When spec validation fails, inject the specific errors into the agent's context for the retry:

**Current behavior:** Silent retry with same prompt
**New behavior:** Inject error context like:

```python
if not validation_result.valid:
    error_injection = f"""
    === VALIDATION FAILED ===

    Your spec.md is missing required sections:
    {chr(10).join(f'- {e}' for e in validation_result.errors)}

    Required fixes:
    {chr(10).join(f'- {f}' for f in validation_result.fixes)}

    Re-read the spec_writer template and add the missing sections.
    Do NOT rewrite the entire spec - just add what's missing.
    """
    # Inject into agent's next turn
    agent_session.add_system_message(error_injection)
```

**Exit:** Validation errors are injected into agent context on retry

**After completing this step:**
1. Output: `<promise>STEP_3_COMPLETE</promise>`
2. Say: **NEXT: Final Verification**
3. DO NOT stop. Continue immediately.

---

## Files to Modify

| File | What to Change |
|------|---------------|
| TBD in Step 1 | Add file read caching mechanism |
| TBD in Step 1 | Add validation error injection |

## Files to Reference

| File | Pattern to Copy |
|------|----------------|
| `apps/backend/spec/validate_pkg/models.py` | ValidationResult structure with errors/fixes |
| `apps/backend/services/recovery.py` | Example of session-level state tracking |

---

## Final Verification Checklist

Before outputting the completion promise, verify:

- [ ] File caching mechanism is in place
- [ ] Validation errors are injected on retry
- [ ] No regressions in planning flow
- [ ] Code follows existing patterns

## Completion Promise

**ONLY output this after ALL steps are complete and verified:**

<promise>TASK_P1_COMPLETE</promise>
