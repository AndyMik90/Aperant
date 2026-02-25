# XState Task State Machine Migration - Summary

**Issue:** #1338
**PR:** #1575
**Date:** 2026-01-28
**Branch:** fix/1524-xstate-clean

## Overview

Migrated task status management from scattered decision logic across multiple handler files to a centralized XState v5 state machine. This eliminates race conditions, inconsistent status updates, and makes the task lifecycle formally defined and testable.

## Critical Dependencies & Blockers

### 1. Windows Credential Manager Fix (Required for Testing)
**PR:** #1569 - fix(windows): fix Windows Credential Manager authentication
**Issue:** #1525

This PR includes changes that depend on the Windows authentication fix. We could not complete end-to-end testing without this fix in place. If a different solution is implemented for #1525, we can remove these changes and resubmit.

### 2. spec_runner.py Project Detection Fix
**Issue:** #1570 - spec_runner.py incorrectly detects auto-claude project as source directory

We encountered and fixed this bug during development as it was blocking our test workflow. The fix is included in this PR.

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Create XState machine definition (task-machine.ts) | ✅ Complete |
| Phase 2 | Create TaskStateManager singleton wrapper | ✅ Complete |
| Phase 3 | Integrate into agent-events-handlers.ts | ✅ Complete |
| Phase 4 | Remove legacy TaskStateMachine class | ✅ Complete |

### Migration Complete

All four phases are now complete. The XState-based `TaskStateManager` is the sole state management system — the legacy `TaskStateMachine` class and `validateStatusTransition()` function have been fully removed. `agent-events-handlers.ts` uses the XState-based `taskStateManager` singleton exclusively.

## What Changed

### Before (Old Architecture — Now Removed)
- Status decisions scattered across agent-events-handlers.ts, execution-handlers.ts, worktree-handlers.ts
- `validateStatusTransition()` function with complex conditional logic
- `TaskStateMachine` class that was essentially an event emitter wrapper
- Multiple places persisting status to implementation_plan.json
- Race conditions possible when multiple handlers tried to update status

### After (New Architecture)
- **Single source of truth:** TaskStateManager (XState-based singleton)
- **Formal state machine:** taskMachine with explicit states and transitions
- **Centralized persistence:** Status written to JSON from one place
- **Testable:** Unit tests verify all state transitions
- **Observable:** XState actors can be inspected/visualized

## State Machine States

```
backlog → planning → coding → qa_review → qa_fixing → human_review → done
                  ↘ plan_review ↗              ↓
                                             error
```

| State | Maps to Legacy Status | reviewReason |
|-------|----------------------|--------------|
| backlog | backlog | - |
| planning | in_progress | - |
| coding | in_progress | - |
| plan_review | human_review | plan_review |
| qa_review | ai_review | - |
| qa_fixing | ai_review | - |
| human_review | human_review | completed or stopped |
| creating_pr | human_review | completed |
| pr_created | pr_created | - |
| error | human_review | errors |
| done | done | - |

## Key Files

| File | Purpose |
|------|---------|
| `apps/frontend/src/shared/state-machines/task-machine.ts` | XState machine definition |
| `apps/frontend/src/main/task-state-manager.ts` | Singleton service wrapping XState actors |
| `apps/frontend/src/shared/state-machines/__tests__/task-machine.test.ts` | State machine unit tests (35 tests) |
| `apps/frontend/src/main/__tests__/task-state-manager.test.ts` | Manager service unit tests (20 tests) |
| `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts` | Refactored to call TaskStateManager |

## Events

The state machine responds to these events:

| Event | Triggered By |
|-------|-------------|
| PLANNING_STARTED | Execution progress phase=planning |
| PLANNING_COMPLETE | Execution progress moving past planning |
| PLAN_APPROVED | User clicks "Proceed to Coding" from plan_review |
| CODING_STARTED | Execution progress phase=coding |
| QA_STARTED | Execution progress phase=qa_review |
| QA_PASSED | Execution progress phase=complete |
| QA_FAILED | Execution progress phase=qa_fixing |
| PROCESS_EXITED | Agent process exit event |
| USER_STOPPED | User clicks stop |
| USER_RESUMED | User resumes task |
| MARK_DONE | User marks task as done |
| CREATE_PR | User initiates PR creation |
| PR_CREATED | PR successfully created |

## Testing

| Test Suite | Result |
|------------|--------|
| Frontend unit tests | ✅ 2579 passed |
| TypeScript strict mode | ✅ Pass |
| Biome lint | ✅ Pass |
| XState machine tests | ✅ 35 passed |
| TaskStateManager tests | ✅ 20 passed |
| Python backend tests | ✅ Pass |

## Session Fixes (2026-01-28)

### Fixed Issues

1. **Badge showing "Needs Review" instead of "Complete"** - Added `effectiveReviewReason` logic in TaskCard.tsx that sets 'completed' when phase === 'complete'

2. **Task showing "Incomplete" badge for plan_review** - Added 'plan_review' to exclusion list in `isIncompleteHumanReview`

3. **Missing "Proceed to Coding" button** - Restored in WorkspaceMessages.tsx for plan_review flow

4. **Wrong XState event for plan_review → coding** - Fixed to send PLAN_APPROVED instead of PLANNING_STARTED when starting from plan_review state

5. **Stuck detection logic** - Reverted useTaskDetail.ts to simpler logic from working branch (only skip 'planning' phase, 2s timeout)

## Outstanding Items (Requires PM Input)

### 1. Future: Subtask XState Migration
- **Issue:** `subtask.status` is checked directly in UI code
- **Recommendation:** Should be managed by state machine for consistency
- **Status:** Out of scope for current PR, document for future work

## Future Improvements

- Add @stately-ai/inspect for runtime devtools
- **Subtask state management** - Track individual subtask states within the machine using XState parallel states
- Add more granular QA states (qa_round_1, qa_round_2, etc.)


## Visualization

The state machine can be visualized at [Stately.ai Editor](https://stately.ai/editor):
1. Paste the contents of task-machine.ts
2. Click "Visualize" to see the state diagram
