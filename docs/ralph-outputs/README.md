# Ralph Loop Documentation

This folder contains documentation of all Ralph loop executions.

## Convention

For every Ralph loop run, create two files:

### 1. Prompt File (in `docs/plans/`)
```
docs/plans/{TASK_ID}_RALPH_PROMPT.md
```

Contains:
- Task description
- Max iterations
- Completion promise
- Copy-paste command
- Task checklist

### 2. Output File (in `docs/ralph-outputs/`)
```
docs/ralph-outputs/{DATE}-{TASK_ID}-output.md
```

Contains:
- Date and duration
- Final status
- Tasks completed table
- Verification results
- Code changes summary
- Promise chain
- Any bonus fixes discovered

## Naming Examples

| Run | Prompt File | Output File |
|-----|-------------|-------------|
| P0 Critical Fixes | `P0_RALPH_PROMPT.md` | `2026-02-05-P0-output.md` |
| P1 Efficiency | `P1_RALPH_PROMPT.md` | `2026-02-05-P1-output.md` |
| P2 CI Test | `P2_RALPH_PROMPT.md` | `2026-02-05-P2-output.md` |
| Verify All | `P0_P1_P2_VERIFY_RALPH_PROMPT.md` | `2026-02-05-verify-output.md` |

## Why Document?

1. **Reproducibility** - Can re-run same prompts later
2. **Learning** - See what worked and what didn't
3. **Debugging** - Trace issues back to specific runs
4. **Metrics** - Track duration and efficiency over time
5. **Training** - Reference for writing better prompts

## Template

Use this template for output files:

```markdown
# {Task Name} - Ralph Output

**Date:** YYYY-MM-DD
**Duration:** Xm Xs
**Status:** ✅ {PROMISE} or ❌ FAILED

---

## Tasks Completed

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | ... | ... | ✅/❌ |

---

## Verification Results

- ✅/❌ Check 1
- ✅/❌ Check 2

---

## Code Changes

### file.py
- Change description

---

## Promise Chain

1. `STEP_1_COMPLETE`
2. `FINAL_PROMISE`
```
