# Coding & Testing Phase: Investigation Findings

**Date:** February 13, 2026
**Scope:** Three issues identified from UI screenshots during autonomous builds

---

## Issue 1: Tasks Move to "Testing" with Incomplete Subtasks

### What We Observed

The UI shows a task transitioning to the Testing/QA phase while subtask progress bars clearly show not all subtasks were completed. Visually, several subtasks appear as pending or in-progress, yet the system proceeded to QA.

### Root Cause: `is_build_complete()` Only Counts "completed" — Stuck/Failed Subtasks Create a False Exit

The completion check in `core/progress.py` (line 102-113) is:

```python
def is_build_complete(spec_dir):
    completed, total = count_subtasks(spec_dir)
    return total > 0 and completed == total
```

This looks correct at first glance — it requires ALL subtasks to be "completed". However, the **actual exit path** that triggers the premature transition is different. It's in `coder.py` lines 517-531:

```python
if not next_subtask:
    if is_build_complete(spec_dir):
        break  # → falls through to status == "complete" check
    else:
        # Retry once, then EXIT THE LOOP
        await asyncio.sleep(2)
        next_subtask = get_next_subtask(spec_dir)
        if not next_subtask:
            print("Still no pending subtasks after retry — exiting loop.")
            break  # ← THIS IS THE PROBLEM
```

When `get_next_subtask()` returns `None` (no pending subtasks available) but `is_build_complete()` returns `False` (not all subtasks are "completed"), the system retries **once**, then **breaks out of the loop anyway**.

This happens when:

1. **Some subtasks are marked "failed"** (stuck after max attempts) — they're skipped by `get_next_subtask()` via `_load_stuck_subtask_ids()`, so no pending subtasks remain
2. **Phase dependency deadlocks** — a phase's dependencies can't be satisfied because a dependent phase has failed subtasks
3. **All remaining subtasks are stuck in attempt_history.json** but their plan status wasn't updated to "failed" (the FIX-005 safety net skips them)

After the loop breaks, the code at line 848 checks `if status == "complete"` — but `status` here comes from the **last session's return value**, NOT from `is_build_complete()`. If the last session returned "continue" (subtask completed successfully), the code falls through to the `elif status == "continue"` branch which just... continues the outer loop. But after the inner `break`, the outer `while True` loop picks up again, calls `get_next_subtask()` again, gets `None` again, and eventually the whole function returns without a clear "incomplete" signal.

The **actual transition to QA/Testing in the frontend** happens because:

- The backend emits `phase_end` for the coding phase
- The `session.py` `run_agent_session()` calls `is_build_complete()` at line 642, and if the coder agent **itself** wrote `"status": "completed"` on all subtasks it was assigned (even if some were stuck/failed and never assigned), it returns `"complete"`
- The agent may mark subtasks as "completed" prematurely if it can't actually verify them but believes it has finished

### Contributing Factor: Batch Processing Masks Incomplete Work

The ralph loop batches up to 8 subtasks per session (`get_pending_subtasks_batch(spec_dir, max_batch=8)`). When a session completes, `post_session_processing()` runs for each subtask in the batch. If the agent only completed 3 of 8 subtasks but the session ended (context exhaustion, max turns), the remaining 5 get reset to "pending." However, if the agent **claims** to have completed them by writing to `implementation_plan.json`, `post_session_processing` at line 238-249 simply trusts that:

```python
if subtask_status == "completed":
    # ✓ SUCCESS PATH — no independent verification
    recovery_manager.record_attempt(success=True, ...)
    return True
```

There's **no independent verification** that the subtask's work was actually done correctly. The system trusts whatever the agent wrote to the plan file.

### Severity: **High**

This is the primary cause of the "moved to testing but tasks not done" issue. The system lacks a gate between "coding loop exited" and "QA phase starts" that validates ALL subtasks are genuinely completed.

---

## Issue 2: Recovery Button Fails Repeatedly

### What We Observed

A stuck task shows the "Recover" button. Clicking it multiple times doesn't fix the issue — the task remains stuck.

### Root Cause: Recovery for Coding Tasks Does NOT Auto-Restart

The recovery handler in `execution-handlers.ts` (line 1582-1604) explicitly prevents auto-restart for coding tasks:

```typescript
} else if (task.status === 'coding') {
    // FIX-3/FIX-4: Coding tasks should NOT auto-restart on recovery
    // Instead, mark as interrupted so user can click "Resume" button
    console.log(`[Recovery] Task ${taskId} is in coding status, marking as interrupted (no auto-restart)`);
    newStatus = 'coding';
    plan.interrupted = true;
    plan.interruptedAt = new Date().toISOString();
}
```

So clicking "Recover" on a coding-phase task:

1. Checks if the agent is running (it's not — it crashed/got stuck)
2. Reads the implementation plan
3. Analyzes subtask completion to determine target status
4. Sets `plan.interrupted = true`
5. Writes the plan back
6. Does **NOT** restart the agent

The user then has to click "Resume" separately. But here's the deeper problem — if the subtasks are genuinely stuck (failed after max attempts, marked in `attempt_history.json`), resuming just hits the same wall. The `get_next_subtask()` skips stuck subtasks, finds none available, and the loop exits again.

### The Recovery Doesn't Reset Stuck State

The recovery handler updates `plan.status` and `plan.planStatus` but does **not**:

- Clear `attempt_history.json` stuck entries
- Reset failed subtask statuses back to "pending"
- Clear the memory/attempt history that tracks failure counts

So the "Recover" button puts the task back in a "coding" state, but when resumed, the exact same stuck subtasks are skipped, the same completion check fails, and the same exit path triggers. The user is trapped in a loop.

### The Only Escape: "Restart from Planning" (Human Review Only)

The `isRestartFromHumanReview` path (line 1405-1417) DOES reset subtasks:

```typescript
if (isRestartFromHumanReview && plan.phases) {
    for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
            if (subtask.status === 'completed' || subtask.status === 'in_progress' || subtask.status === 'failed') {
                subtask.status = 'pending';
                delete subtask.actual_output;
                delete subtask.started_at;
                delete subtask.completed_at;
            }
        }
    }
}
```

But this path is only available from the `human_review` status and restarts from **planning**, throwing away all coding progress.

### Severity: **High**

Users have no way to unstick a coding-phase task without losing all progress. The Recover button is effectively a no-op for the most common stuck scenario.

---

## Issue 3: No "Restart from Coding" Button

### What We Observed

The Planning phase has a "Restart Planning" button (visible in screenshot 4). There's no equivalent for the Coding phase. When the coder gets super stuck or clearly missed steps, the only options are to recover (which doesn't work per Issue 2) or delete the task entirely.

### Current Architecture for Restart Planning

The "Restart from Planning" flow works because:

1. It resets ALL subtask statuses to "pending"
2. It clears the implementation plan
3. It restarts the planning agent from scratch
4. The spec.md (requirements) is preserved

This is triggered from the `TaskReview` component via `onRestartFromPlanning` which calls `TASK_RECOVER_STUCK` with `autoRestart: true` from the `human_review` state.

### What "Restart from Coding" Would Need

A "Restart from Coding" button would need to:

1. **Preserve the implementation plan** (don't re-plan)
2. **Reset all subtask statuses** to "pending" (or selectively reset failed/stuck ones)
3. **Clear `attempt_history.json`** stuck entries and attempt counts
4. **Clear `memory/` session insights** that may contain bad patterns
5. **Optionally rollback git** to the last known-good checkpoint
6. **Restart the coding agent** with a fresh session

### Where It Would Live in the Frontend

The `TaskActions.tsx` component (line 137-155) currently shows only Start/Stop/Resume for coding tasks:

```tsx
task.status === 'coding' && (
    <Button onClick={onStartStop}>
        {isRunning ? 'Stop Task' : (isAgentStopped ? 'Resume' : 'Start Task')}
    </Button>
)
```

A "Restart Coding" button would need to be added here, similar to how planning has "Resume Planning" + "Start Build" as separate buttons.

### Backend Support Needed

The `TASK_RECOVER_STUCK` IPC handler would need a new code path:

```typescript
} else if (task.status === 'coding' && targetStatus === 'coding_restart') {
    // Reset all subtask statuses
    // Clear attempt_history.json
    // Optionally rollback to pre-coding checkpoint
    // Restart the coding agent
}
```

### Severity: **Medium-High**

Without this, users are stuck between "Recover" (doesn't work) and "Delete Task" (loses everything). A restart-from-coding is the missing middle ground.

---

## Summary of Root Causes

| Issue | Root Cause | Location |
|-------|-----------|----------|
| Premature QA transition | Loop exits when no pending subtasks remain, even if some are failed/stuck — no gate validates all subtasks truly completed | `coder.py` lines 517-531, `session.py` line 642 |
| Recovery button fails | Recovery marks task as "interrupted" but doesn't clear stuck state in `attempt_history.json` or reset failed subtasks | `execution-handlers.ts` lines 1582-1604 |
| No coding restart | No UI button or backend handler exists for resetting coding progress while preserving the plan | `TaskActions.tsx` lines 137-155 |

---

## Recommended Fixes (Prioritized)

### Fix 1: Add Completion Gate Before QA Transition (Critical)

Add a validation step between the coding loop exit and QA trigger. When the loop exits with incomplete subtasks, the system should either:

- **Option A:** Report the incomplete state to the frontend and let the user decide (mark done, retry, or restart)
- **Option B:** Automatically retry failed subtasks with a completely fresh approach before giving up

Key change in `coder.py` after the main loop:

```python
# After loop exits, validate completion
completed, total = count_subtasks(spec_dir)
detailed = count_subtasks_detailed(spec_dir)

if detailed["failed"] > 0 or detailed["pending"] > 0:
    # NOT truly complete — don't trigger QA
    emit_sdk_msg("phase_end", {
        "phase": "coding",
        "success": False,
        "message": f"Coding incomplete: {detailed['failed']} failed, {detailed['pending']} pending of {total} total",
        "incomplete_subtasks": detailed,
    })
    status_manager.update(state=BuildState.STUCK)
    return  # Don't fall through to QA
```

### Fix 2: Make Recovery Actually Reset Stuck State (High)

When recovering a coding task, the handler should:

1. Clear stuck entries from `attempt_history.json`
2. Reset failed subtask statuses to "pending" in `implementation_plan.json`
3. Zero out attempt counts for stuck subtasks
4. Then restart the agent

### Fix 3: Add "Restart Coding" Button (High)

Add a new button to `TaskActions.tsx` for coding-phase tasks when stuck or stopped. This would:

1. Reset all subtask statuses to "pending"
2. Clear `attempt_history.json` entirely
3. Preserve the implementation plan structure
4. Optionally git rollback to pre-coding state
5. Restart the coding agent fresh

This mirrors the "Restart Planning" flow but preserves the plan.

### Fix 4: Add Independent Subtask Verification (Medium)

Don't blindly trust the agent's claim that a subtask is "completed." After the agent marks a subtask done, `post_session_processing` should independently verify:

- Did the agent actually modify the files listed in `files_to_modify`?
- Did the verification command (if defined) actually pass?
- Is there a corresponding git commit?

### Fix 5: Surface Stuck Subtask Details in UI (Medium)

The frontend should show which specific subtasks are stuck/failed, how many attempts were made, and what errors occurred. This gives users actionable information rather than a generic "stuck" state.
