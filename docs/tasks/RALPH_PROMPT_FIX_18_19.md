# Ralph Prompt: FIX-18 & FIX-19 - Recovery Handler & startSpecCreation Migration

**Created:** 2026-02-04
**Executed:** 2026-02-04
**Status:** ✅ COMPLETE
**Duration:** 2m 25s
**Priority:** MEDIUM

---

## Task Summary

Two fixes identified from SPEC_VS_CODE_AUDIT_REPORT.md:

| # | Fix | Issue | Description |
|---|-----|-------|-------------|
| 1 | FIX-18 | MAJ-2 | Recovery handler uses broad `else` catch instead of explicit status checks |
| 2 | FIX-19 | MIN-3 | `startSpecCreation()` still used instead of `startPlanningAgent()` |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer completing 2 bug fixes for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\reports\SPEC_VS_CODE_AUDIT_REPORT.md (issue analysis)

---

## TASKS (2 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-18: Add explicit status checks to TASK_RECOVER_STUCK handler | FIX_18_RECOVERY_STATUS_CHECKS_COMPLETE |
| 2 | FIX-19: Migrate startSpecCreation() calls to startPlanningAgent() | FIX_19_SPEC_CREATION_MIGRATION_COMPLETE |

**FINAL:** <promise>FIX_18_19_COMPLETE</promise>

---

## FIX-18: Recovery Handler Explicit Status Checks

File: apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts
Handler: TASK_RECOVER_STUCK

Problem: The recovery handler has a broad `else` clause that catches all non-planning statuses. It should have explicit checks for each status type.

Requirements:
- Replace the broad `else` with explicit status checks
- `planning` status: restart planning agent (existing behavior)
- `coding` status: mark as interrupted, require manual resume (existing behavior)
- `ai_review` status: determine appropriate recovery action
- Other statuses (`human_review`, `todo`, `done`, `archived`): no agent restart

Then output: <promise>FIX_18_RECOVERY_STATUS_CHECKS_COMPLETE</promise>
Say: NEXT: FIX-19 and begin FIX-19

---

## FIX-19: Migrate startSpecCreation to startPlanningAgent

Problem: `startSpecCreation()` is the OLD method that doesn't use `--no-build` flag. It's still used in 3 production files.

Files to update:
- apps/frontend/src/main/ipc-handlers/integrations/linear-handlers.ts
- apps/frontend/src/main/ipc-handlers/github/import-handlers.ts
- apps/frontend/src/main/ipc-handlers/task/autofix-handlers.ts

Requirements:
- Find all calls to `startSpecCreation()` in these files
- Replace with `startPlanningAgent()` calls
- Ensure the new calls pass the correct parameters
- The goal is to ensure ALL planning tasks use `--no-build` flag

Then output: <promise>FIX_19_SPEC_CREATION_MIGRATION_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify both promises were output
3. Output: <promise>FIX_18_19_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. Both fixes are REQUIRED - no skipping
2. After each fix, immediately continue to next
3. NO SUMMARIES - progress summaries are NOT stopping points
4. The job is done ONLY when <promise>FIX_18_19_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_18_19_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 2 fixes complete. BEGIN NOW.
" --max-iterations 75 --completion-promise "FIX_18_19_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `execution-handlers.ts` | TASK_RECOVER_STUCK handler gets explicit status checks |
| `linear-handlers.ts` | Replace startSpecCreation with startPlanningAgent |
| `import-handlers.ts` | Replace startSpecCreation with startPlanningAgent |
| `autofix-handlers.ts` | Replace startSpecCreation with startPlanningAgent |

---

## Verification After Run

1. **FIX-18**: Check TASK_RECOVER_STUCK has explicit `if/else if` for each status
2. **FIX-19**: Search for `startSpecCreation` - should only appear in test files or be removed
3. **Build passes:** `npm run build`

---

## Related Documents

- [SPEC_VS_CODE_AUDIT_REPORT.md](../reports/SPEC_VS_CODE_AUDIT_REPORT.md) - Issue analysis
- [RALPH_PROMPT_FIX_17.md](RALPH_PROMPT_FIX_17.md) - Previous fix (reference)

---

## Completion Promise

```
FIX_18_19_COMPLETE
```
