# Fix: Task Detail Modal Buttons (Old Architecture)

**Created:** 2026-02-04
**Priority:** Medium
**Status:** Pending

---

## Problem

The **TaskDetailModal** (opened when double-clicking a task) has an old "Start Task" button architecture that doesn't match the new button flow on TaskCard.

**Screenshot location:** Task detail modal footer shows "Start Task" button for planning tasks

---

## Current (Old) Architecture

**File:** `src/renderer/components/task-detail/TaskDetailModal.tsx` (lines 277-296)

```tsx
if (task.status === 'planning' || task.status === 'coding') {
  return (
    <Button onClick={handleStartStop}>
      {state.isRunning ? (
        <>
          <Square /> Stop Task
        </>
      ) : (
        <>
          <Play /> Start Task
        </>
      )}
    </Button>
  );
}
```

**Issues:**
1. "Start Task" is ambiguous - doesn't distinguish between:
   - Starting/resuming the planning agent
   - Starting the build (coding phase)
2. Doesn't follow the gated workflow (planning → spec ready → user approval → coding)
3. Missing the "Start Build" button that only appears when spec is ready

---

## New Architecture (TaskCard)

**File:** `src/renderer/components/TaskCard.tsx` (lines 880-940)

The TaskCard has the correct flow:
1. **Planning phase (agent running):** Shows "Stop" button only
2. **Planning phase (agent stopped, spec ready):** Shows "Resume" + "Start Build" buttons
3. **Coding phase:** Shows "Stop" or "Resume" based on agent state
4. **Review phases:** Shows appropriate actions

---

## Fix Required

Update `TaskDetailModal.tsx` to match `TaskCard.tsx` button logic:

### For Planning Tasks:
- If agent is running → Show "Stop" button
- If agent stopped AND spec ready → Show "Resume" + "Start Build" buttons
- If agent stopped AND no spec → Show "Resume" button only

### For Coding Tasks:
- If agent is running → Show "Stop" button
- If agent stopped → Show "Resume" button

### Files to Modify:
1. `src/renderer/components/task-detail/TaskDetailModal.tsx`
2. `src/renderer/components/task-detail/TaskActions.tsx` (also has "Start Task" on line 89)

---

## Related Files

- `TaskCard.tsx` - Reference implementation for new button architecture
- `task-store.ts` - `startBuild()` function for starting coding phase
- `useTaskExecution.ts` - Task execution state management

---

## Notes

- The "Start Build" button should only appear when:
  1. Task is in planning status
  2. Planning agent is stopped (not running)
  3. Spec file exists (ready for review)

- This follows FIX-14 pattern from TaskCard

---

**Ralph prompt (optional):**
```
Fix the TaskDetailModal button architecture to match TaskCard. Remove the old "Start Task"
button and implement the correct gated workflow: planning tasks show Resume/Stop based on
agent state, and "Start Build" only appears when spec is ready and agent is stopped.
```
