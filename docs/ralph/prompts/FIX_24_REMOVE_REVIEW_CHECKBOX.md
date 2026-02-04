# Ralph Prompt: FIX-24 - Remove "Require Human Review" Checkbox

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** HIGH

---

## Task Summary

| # | Task | Description |
|---|------|-------------|
| 1 | FIX-24 | Remove "Require human review before coding" checkbox - conflicts with Ralph Wiggum Mode |

---

## Problem Statement

The "Require human review before coding" checkbox in the Create Task dialog conflicts with "Ralph Wiggum Autonomous Mode" which is now ALWAYS ON.

**Current state:**
- Ralph Wiggum Mode: Always enabled (shown as static "Always On" badge)
- Human Review Checkbox: Still exists and can be checked
- This is contradictory - you can't have both autonomous mode AND human review gates

**Architecture context:**

The `requireReviewBeforeCoding` flag controls `--auto-approve` in agent-manager.ts:
```typescript
// apps/frontend/src/main/agent/agent-manager.ts:176
if (!metadata?.requireReviewBeforeCoding) {
  // Auto-approve: When user starts a task from the UI without requiring review
  args.push('--auto-approve');
}
```

When:
- `requireReviewBeforeCoding = false` → `--auto-approve` passed → autonomous execution
- `requireReviewBeforeCoding = true` → no auto-approve → pauses for human review

Since Ralph Wiggum Mode is always on, we should ALWAYS pass `--auto-approve`.

---

## Files That Use requireReviewBeforeCoding

| File | Usage |
|------|-------|
| `agent-manager.ts:176` | Checks flag to add `--auto-approve` arg |
| `task.ts` (types) | Type definitions (3 locations) |
| `TaskFormFields.tsx` | UI checkbox (ALREADY REMOVED) |
| `TaskEditDialog.tsx` | State management for checkbox |
| `TaskCreationWizard.tsx` | State management for checkbox |
| `QuickTaskDialog.tsx` | Sets to `false` by default |
| `TaskTemplateSelector.tsx` | Some templates have `true` |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer removing a deprecated UI feature from Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

---

## TASK (1 required)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-24: Remove requireReviewBeforeCoding feature completely | FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE |

**FINAL:** <promise>FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE</promise>

---

## FIX-24: Remove requireReviewBeforeCoding Feature

### Context

Ralph Wiggum Autonomous Mode is ALWAYS ON (hardcoded). The 'Require human review before coding' checkbox contradicts this and should be removed entirely.

The checkbox UI has already been removed from TaskFormFields.tsx. You need to clean up the rest.

### Step 1: Investigate Architecture Impact

Before making changes, investigate:
1. Read agent-manager.ts to understand how --auto-approve is used
2. Check if removing this flag breaks any execution flows
3. Identify all places the flag is referenced

### Step 2: Clean Up TaskFormFields.tsx Props

File: apps/frontend/src/renderer/components/task-form/TaskFormFields.tsx

The checkbox UI is already removed. Now remove the unused props:
- Remove from interface: requireReviewBeforeCoding, onRequireReviewChange
- Remove from function parameters
- Clean up any references

### Step 3: Clean Up TaskEditDialog.tsx

File: apps/frontend/src/renderer/components/TaskEditDialog.tsx

Remove:
- requireReviewBeforeCoding state (line ~111)
- setRequireReviewBeforeCoding calls
- References in useEffect reset
- References in hasChanges check
- References in metadataUpdates
- Props passed to TaskFormFields

### Step 4: Clean Up TaskCreationWizard.tsx

File: apps/frontend/src/renderer/components/TaskCreationWizard.tsx

Remove:
- requireReviewBeforeCoding state (line ~119)
- setRequireReviewBeforeCoding calls
- References in draft loading
- References in formState useMemo
- References in handleCreateTask metadata
- Props passed to TaskFormFields

### Step 5: Update TaskTemplateSelector.tsx

File: apps/frontend/src/renderer/components/task-form/TaskTemplateSelector.tsx

Remove requireReviewBeforeCoding from:
- Template definitions (lines ~52, 64, 76, 88)
- TaskTemplate interface (line ~104)
- currentValues object (line ~152)

### Step 6: Update Agent Manager (IMPORTANT)

File: apps/frontend/src/main/agent/agent-manager.ts

Option A (Recommended): Remove the conditional, always pass --auto-approve
```typescript
// BEFORE:
if (!metadata?.requireReviewBeforeCoding) {
  args.push('--auto-approve');
}

// AFTER:
// Ralph Wiggum Mode: Always auto-approve (FIX-24)
args.push('--auto-approve');
```

Option B: Keep the flag but default to false everywhere (less clean)

### Step 7: Clean Up Types

File: apps/frontend/src/shared/types/task.ts

Remove requireReviewBeforeCoding from:
- TaskMetadata interface (line ~156)
- TaskCreationParams (line ~178)
- CreateTaskRequest (line ~249)

File: apps/frontend/src/main/agent/types.ts
- Remove from TaskMetadataArg (line ~54)

### Step 8: Update QuickTaskDialog.tsx

File: apps/frontend/src/renderer/components/QuickTaskDialog.tsx

Remove requireReviewBeforeCoding: false from metadata (line ~77) - it's no longer needed.

### Step 9: Remove Translation Keys

File: apps/frontend/src/shared/i18n/locales/en/tasks.json
File: apps/frontend/src/shared/i18n/locales/fr/tasks.json

Remove:
- tasks:form.requireReviewLabel
- tasks:form.requireReviewDescription

---

## VERIFICATION

1. Run: npm run build (fix any TypeScript errors)
2. Search for 'requireReviewBeforeCoding' - should find 0 results
3. Verify --auto-approve is always passed in agent-manager.ts
4. Output: <promise>FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. DO NOT break the agent execution flow
2. --auto-approve MUST still be passed to the agent
3. Run build and fix all TypeScript errors before completing
4. The job is done ONLY when <promise>FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 1 tasks complete. BEGIN NOW.
" --max-iterations 100 --completion-promise "FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TaskFormFields.tsx` | Remove requireReviewBeforeCoding props |
| `TaskEditDialog.tsx` | Remove state and prop passing |
| `TaskCreationWizard.tsx` | Remove state and prop passing |
| `TaskTemplateSelector.tsx` | Remove from templates and interface |
| `agent-manager.ts` | Always pass --auto-approve (unconditional) |
| `task.ts` | Remove from type definitions |
| `types.ts` (agent) | Remove from TaskMetadataArg |
| `QuickTaskDialog.tsx` | Remove from metadata |
| `tasks.json` (en, fr) | Remove translation keys |

---

## Verification After Run

1. No TypeScript errors
2. No references to requireReviewBeforeCoding anywhere
3. Agent tasks still run correctly with --auto-approve
4. Create Task dialog no longer shows the checkbox
5. Ralph Wiggum Mode remains the only execution mode indicator

---

## Partial Work Already Done

The checkbox UI has been removed from TaskFormFields.tsx (lines 327-347).
The Checkbox import has been removed.
Ralph needs to complete the cleanup of props, state, types, and agent-manager.

---

## Completion Promise

```
FIX_24_REMOVE_REVIEW_CHECKBOX_COMPLETE
```
