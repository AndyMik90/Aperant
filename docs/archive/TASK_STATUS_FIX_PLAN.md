# Task Status & Execution Phase Architecture Fix Plan

**Date:** 2026-02-01
**Status:** Planning
**Priority:** High
**Complexity:** Medium

---

## Executive Summary

The Auto-Claude (Jerry) application has a architectural confusion between **Task Status** (workflow stage) and **Execution Phase** (backend agent activity). This creates UI inconsistencies where tasks show confusing state combinations like "Coding status with Planning phase".

**Root Causes:**
1. Race condition between status update and phase initialization
2. Lack of clear UI distinction between status and phase
3. Status and phase are separate concepts but UI treats them as one
4. No "starting" intermediate state while backend initializes

**Impact:**
- Users see confusing badges (e.g., "Planning" badge on a "Coding" task)
- Unclear when tasks are actually executing vs preparing to execute
- Poor user experience during task startup phase

---

## Architecture Overview

### Current Design (Working as Intended)

```
Task Status (High-level workflow):
┌─────────┐    ┌────────┐    ┌───────────┐    ┌──────────────┐    ┌──────┐
│Planning │───▶│ Coding │───▶│ AI Review │───▶│ Human Review │───▶│ Done │
└─────────┘    └────────┘    └───────────┘    └──────────────┘    └──────┘

Execution Phase (Backend agent activity within Coding status):
┌──────┐    ┌──────────┐    ┌────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│ Idle │───▶│ Planning │───▶│ Coding │───▶│ QA Review │───▶│ QA Fixing │───▶│ Complete │
└──────┘    └──────────┘    └────────┘    └───────────┘    └──────────┘    └──────────┘
                   │                             │                │
                   │                             │                │
              (Creating spec)            (Running tests)    (Fixing issues)
```

**Valid Combinations:**
- Status: `coding`, Phase: `planning` ✅ (creating implementation spec)
- Status: `coding`, Phase: `coding` ✅ (writing code)
- Status: `coding`, Phase: `qa_review` ✅ (running tests)
- Status: `ai_review`, Phase: `qa_fixing` ✅ (fixing test failures)

### The Problem

**Race Condition Timeline:**
```
T+0ms:   User clicks "Start Build"
T+10ms:  Frontend calls task:start IPC
T+15ms:  Backend immediately sends TASK_STATUS_CHANGE → "coding"
T+20ms:  UI updates: status = "coding", phase = "idle" (stale)
T+50ms:  UI renders TaskCard with "Coding" status, no phase badge
T+1000ms: Python subprocess spawns
T+1200ms: Backend emits __EXEC_PHASE__:{"phase":"planning"}
T+1250ms: UI receives execution-progress event
T+1270ms: UI updates: phase = "planning"
T+1280ms: UI renders TaskCard with "Coding" status, "Planning" badge ❌
```

**User sees:** "Coding" task with "Planning" badge for 1+ seconds

---

## Proposed Solutions

### Solution 1: Show "Starting..." Intermediate State (Recommended)

**Concept:** Display a clear "Starting..." or "Initializing..." badge during the race condition window.

**Benefits:**
- Honest representation of system state
- Users understand the task is bootstrapping
- No false expectations about which phase is running
- Minimal code changes

**Implementation:**
1. When status changes to `coding` and phase is `idle` or stale
2. Show special "Starting..." badge with spinner
3. Hide normal phase badge until first real phase event arrives
4. Clear visual feedback that initialization is in progress

**User Experience:**
```
Before: "Coding" with "Planning" (confusing)
After:  "Coding" with "Starting..." (clear)
```

### Solution 2: Optimistic Phase Initialization

**Concept:** When status changes to `coding`, immediately set phase to `coding` optimistically.

**Benefits:**
- No confusing intermediate states
- Phase matches status from user perspective
- Smooth visual transition

**Drawbacks:**
- Not truthful - backend hasn't started coding yet
- Can create false expectations
- Phase will briefly show wrong value

### Solution 3: Context-Aware Phase Labels

**Concept:** Show different labels based on status + phase combination.

**Implementation:**
```typescript
// Instead of just showing phase label:
if (status === 'coding' && phase === 'planning') {
  label = "Creating Spec"
} else if (status === 'coding' && phase === 'coding') {
  label = "Implementing"
} else if (status === 'coding' && phase === 'qa_review') {
  label = "Testing"
}
```

**Benefits:**
- Clear, understandable labels
- Accurate representation of activity
- Educational for users

**Drawbacks:**
- More complex labeling logic
- Need to maintain label mappings
- Doesn't solve the initialization race condition

### Solution 4: Delay Status Update Until Phase Confirmed (NOT Recommended)

**Concept:** Don't update status until backend confirms phase.

**Drawbacks:**
- Creates different race condition (status lags behind reality)
- Slower UI responsiveness
- Complicates state synchronization

---

## Recommended Implementation Plan

**Combine Solutions 1 + 3** for best user experience:

1. **Immediate:** Show "Starting..." during initialization (Solution 1)
2. **Follow-up:** Add context-aware labels (Solution 3)
3. **Future:** Consider optimistic updates for faster perceived performance (Solution 2)

---

## Detailed Implementation Steps

### Phase 1: Add "Starting" Intermediate State

#### 1.1 Update Type Definitions

**File:** `src/shared/types/task.ts`

**Changes:**
```typescript
// Add to ExecutionPhase type
export type ExecutionPhase =
  | 'idle'
  | 'starting'  // NEW: Initialization phase
  | 'planning'
  | 'coding'
  | 'qa_review'
  | 'qa_fixing'
  | 'complete'
  | 'failed';
```

**Why:** TypeScript will enforce the new state across the codebase.

---

#### 1.2 Add Starting Phase Constants

**File:** `src/shared/constants/task.ts`

**Changes:**
```typescript
// Line ~60: Add to EXECUTION_PHASE_LABELS
export const EXECUTION_PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  starting: 'Starting...',  // NEW
  planning: 'Planning',
  coding: 'Coding',
  qa_review: 'AI Review',
  qa_fixing: 'Fixing Issues',
  complete: 'Complete',
  failed: 'Failed'
};

// Line ~82: Add to EXECUTION_PHASE_BADGE_COLORS
export const EXECUTION_PHASE_BADGE_COLORS: Record<string, string> = {
  idle: 'bg-muted/50 text-muted-foreground border-muted',
  starting: 'bg-primary/10 text-primary border-primary/30 animate-pulse',  // NEW
  planning: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  coding: 'bg-info/10 text-info border-info/30',
  qa_review: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  qa_fixing: 'bg-warning/10 text-warning border-warning/30',
  complete: 'bg-success/10 text-success border-success/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30'
};
```

**Why:** Defines visual styling for the starting state.

---

#### 1.3 Update Task Store to Set "Starting" Phase

**File:** `src/renderer/stores/task-store.ts`

**Changes:**
```typescript
// Around line 206-214: Update status change handler
export const updateTaskStatus = (
  taskId: string,
  status: TaskStatus,
  reviewReason?: ReviewReason,
  source?: string
) => {
  set((state) => ({
    tasks: state.tasks.map((t) => {
      if (t.id !== taskId) return t;

      let executionProgress = t.executionProgress;

      if (status === 'planning') {
        // When status goes to planning, reset execution progress to idle
        executionProgress = { phase: 'idle', phaseProgress: 0, overallProgress: 0 };
      } else if (status === 'coding') {
        // NEW: When starting a task, set phase to "starting" until backend confirms
        const currentPhase = t.executionProgress?.phase;
        if (!currentPhase || currentPhase === 'idle') {
          executionProgress = {
            phase: 'starting',  // NEW: Use starting instead of coding
            phaseProgress: 0,
            overallProgress: 0,
            sequenceNumber: 0
          };
        }
      }

      // Rest of the function...
    })
  }));
};
```

**Why:** Sets the initial phase to "starting" when status changes to coding.

---

#### 1.4 Update TaskCard to Show Starting Badge

**File:** `src/renderer/components/TaskCard.tsx`

**Changes:**
```typescript
// Around line 529-540: Update execution phase badge rendering
{/* Execution phase badge - shown when actively running */}
{hasActiveExecution && executionPhase && !isStuck && !isIncomplete && (
  <Badge
    variant="outline"
    className={cn(
      'text-[10px] px-1.5 py-0.5 flex items-center gap-1',
      EXECUTION_PHASE_BADGE_COLORS[executionPhase]
    )}
  >
    {/* Show spinner for starting/active phases */}
    {executionPhase !== 'complete' && executionPhase !== 'failed' && (
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
    )}
    {EXECUTION_PHASE_LABELS[executionPhase]}
  </Badge>
)}
```

**Also update around line 162:**
```typescript
// Line 162: Update hasActiveExecution to include 'starting'
const hasActiveExecution = executionPhase &&
  executionPhase !== 'idle' &&
  executionPhase !== 'complete' &&
  executionPhase !== 'failed';
```

**Why:** Ensures "starting" phase shows the badge with spinner.

---

#### 1.5 Update Backend Phase Validation

**File:** `src/shared/constants/phase-protocol.ts`

**Changes:**
```typescript
// Around line 139-160: Update phase prerequisites
export const PHASE_PREREQUISITES: Record<ExecutionPhase, ExecutionPhase[]> = {
  idle: [],
  starting: ['idle'],  // NEW: Can transition from idle to starting
  planning: ['starting', 'idle'],  // NEW: Planning can follow starting
  coding: ['planning', 'starting'],  // NEW: Coding can follow starting
  qa_review: ['coding'],
  qa_fixing: ['qa_review'],
  complete: ['qa_review', 'coding', 'qa_fixing'],
  failed: ['planning', 'coding', 'qa_review', 'qa_fixing']
};
```

**Why:** Allows valid transitions through the starting phase.

---

#### 1.6 Update Agent Event Handlers

**File:** `src/main/ipc-handlers/agent-events-handlers.ts`

**Changes:**
```typescript
// Around line 334-342: Update phaseToStatus mapping
const phaseToStatus: Record<string, TaskStatus | null> = {
  idle: null,
  starting: "coding",      // NEW: Starting phase keeps task in coding
  planning: "coding",
  coding: "coding",
  qa_review: "ai_review",
  qa_fixing: "ai_review",
  complete: "human_review",
  failed: "human_review",
};
```

**Why:** Ensures starting phase maps to correct task status.

---

### Phase 2: Add Context-Aware Phase Labels

#### 2.1 Create Label Mapping Function

**File:** `src/renderer/components/TaskCard.tsx`

**Add new function around line 430:**
```typescript
/**
 * Get context-aware label for execution phase based on task status
 * This makes phase labels more understandable to users
 */
const getContextualPhaseLabel = (status: TaskStatus, phase: ExecutionPhase): string => {
  // Special handling for phase within coding status
  if (status === 'coding') {
    switch (phase) {
      case 'starting':
        return 'Starting...';
      case 'planning':
        return 'Creating Spec';
      case 'coding':
        return 'Implementing';
      case 'qa_review':
        return 'Testing';
      case 'qa_fixing':
        return 'Fixing Issues';
      default:
        return EXECUTION_PHASE_LABELS[phase];
    }
  }

  // For ai_review status
  if (status === 'ai_review') {
    switch (phase) {
      case 'qa_review':
        return 'Reviewing';
      case 'qa_fixing':
        return 'Fixing Issues';
      default:
        return EXECUTION_PHASE_LABELS[phase];
    }
  }

  // Default to standard labels
  return EXECUTION_PHASE_LABELS[phase];
};
```

**Why:** Provides clear, context-specific labels for each phase.

---

#### 2.2 Use Contextual Labels in Badge

**File:** `src/renderer/components/TaskCard.tsx`

**Changes:**
```typescript
// Around line 537: Update badge label to use contextual function
{hasActiveExecution && executionPhase && !isStuck && !isIncomplete && (
  <Badge
    variant="outline"
    className={cn(
      'text-[10px] px-1.5 py-0.5 flex items-center gap-1',
      EXECUTION_PHASE_BADGE_COLORS[executionPhase]
    )}
  >
    {executionPhase !== 'complete' && executionPhase !== 'failed' && (
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
    )}
    {/* NEW: Use contextual label instead of direct label */}
    {getContextualPhaseLabel(task.status, executionPhase)}
  </Badge>
)}
```

**Why:** Shows the more descriptive, contextual label to users.

---

### Phase 3: Improve Phase Progress Indicator

#### 3.1 Update PhaseProgressIndicator Component

**File:** `src/renderer/components/PhaseProgressIndicator.tsx`

**Read the file first to understand current implementation, then add:**

```typescript
// Add special handling for "starting" phase
// Show indeterminate progress bar during starting phase
if (currentPhase === 'starting') {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary animate-pulse" style={{ width: '100%' }} />
      </div>
      <span className="text-muted-foreground whitespace-nowrap">Starting...</span>
    </div>
  );
}
```

**Why:** Provides visual feedback during initialization.

---

### Phase 4: Update Task Details Modal

#### 4.1 Update Task Details to Show Both Status and Phase

**File:** Search for task details modal component (likely `TaskDetailsDialog.tsx` or similar)

**Changes:**
```typescript
// Add a section showing both status and current phase
<div className="flex gap-4">
  <div>
    <Label>Status</Label>
    <Badge variant={getStatusBadgeVariant(task.status)}>
      {getStatusLabel(task.status)}
    </Badge>
  </div>
  <div>
    <Label>Current Activity</Label>
    <Badge variant="outline" className={EXECUTION_PHASE_BADGE_COLORS[executionPhase]}>
      {getContextualPhaseLabel(task.status, executionPhase)}
    </Badge>
  </div>
</div>
```

**Why:** Helps users understand the distinction between status and phase.

---

## Testing Plan

### Manual Testing Checklist

#### Test Case 1: Task Startup
- [ ] Create a new task in Planning
- [ ] Click "Start Build"
- [ ] **Expected:** Task shows "Coding" status with "Starting..." badge
- [ ] Wait 1-2 seconds
- [ ] **Expected:** Badge changes to "Creating Spec" (during spec creation)
- [ ] **Expected:** Badge changes to "Implementing" (during code writing)

#### Test Case 2: Phase Transitions
- [ ] Start a task that needs spec creation
- [ ] **Expected:** "Creating Spec" → "Implementing" → "Testing"
- [ ] **Expected:** Each phase shows spinner icon
- [ ] **Expected:** Phase tabs update correspondingly

#### Test Case 3: Quick Stop/Start
- [ ] Start a task
- [ ] Immediately click Stop (before first phase event)
- [ ] **Expected:** Task returns to Planning status
- [ ] **Expected:** No stuck "Starting..." badge
- [ ] Start the task again
- [ ] **Expected:** "Starting..." badge appears again

#### Test Case 4: Task with QA Issues
- [ ] Complete a task that will fail QA
- [ ] **Expected:** Status changes to "AI Review"
- [ ] **Expected:** Phase shows "Reviewing"
- [ ] **Expected:** When fixing, phase shows "Fixing Issues"

#### Test Case 5: Resume Task After Restart
- [ ] Start a task
- [ ] Wait until it's actively coding
- [ ] Restart the app
- [ ] **Expected:** Task resumes with correct status and phase
- [ ] **Expected:** No "Starting..." badge after restart

---

## Rollback Plan

If issues arise, rollback by reverting these commits in order:

1. **Revert Phase 4** (Task Details Modal) - Low risk
2. **Revert Phase 3** (Progress Indicator) - Low risk
3. **Revert Phase 2** (Contextual Labels) - Medium risk
4. **Revert Phase 1** (Starting State) - High risk

**Emergency Rollback:** Revert all changes and restore from `main` branch.

**Validation:** After rollback, verify tasks can still be started/stopped normally.

---

## Migration Notes

### Breaking Changes
- None expected - this is purely additive

### Backward Compatibility
- Old tasks without "starting" phase will continue to work
- Existing execution progress will not be affected
- Plan files don't need migration

### Performance Impact
- Negligible - only adds one conditional check in render path
- No database queries or async operations added

---

## Documentation Updates

### Files to Update

1. **README.md** - Add explanation of task statuses vs phases
2. **ARCHITECTURE.md** - Document the status/phase distinction
3. **User Guide** - Add section explaining what each badge means

### Changelog Entry

```markdown
## [2.7.6] - 2026-02-01

### Fixed
- Task status/phase confusion by adding "Starting..." intermediate state
- Improved phase badge labels with context-aware descriptions
- Better visual feedback during task initialization

### Changed
- Phase badges now show contextual labels (e.g., "Creating Spec" instead of "Planning")
- Added "Starting..." state to indicate task initialization
```

---

## Future Enhancements

### Potential Improvements (Not in Scope)

1. **Estimated Time Remaining**
   - Show "~2 min remaining" based on phase progress
   - Learn from historical task durations

2. **Phase Transition Animations**
   - Smooth fade between phase badges
   - Visual celebration when phase completes

3. **Detailed Phase Timeline**
   - Show all completed phases with timestamps
   - Visualize time spent in each phase

4. **Phase Skip Detection**
   - Warn if backend skips expected phases
   - Helpful for debugging agent issues

5. **Multi-Task Phase Coordination**
   - Show if multiple tasks are in same phase
   - Resource contention warnings

---

## Questions & Decisions

### Q: Should we show phase at all if task is in Planning status?
**A:** No - planning tasks shouldn't show execution phase badge. Only show when status is coding or ai_review.

### Q: What if backend never sends first phase event?
**A:** After 30 seconds, show "Stuck" indicator and allow recovery. This is already handled by stuck task detection.

### Q: Should "Starting..." badge pulse or spin?
**A:** Pulse animation via `animate-pulse` class - less distracting than spinner, still shows activity.

### Q: Can we remove the phase concept entirely?
**A:** No - backend needs phases to track agent activities. But we can hide implementation details from users via contextual labels.

---

## Success Metrics

### Before Fix
- Users report confusion about "Planning" badge on "Coding" tasks
- Support questions about task states
- Unclear when tasks are actually running

### After Fix
- Clear "Starting..." feedback during initialization
- Descriptive labels ("Creating Spec", "Implementing", "Testing")
- Reduced user confusion
- Better understanding of task lifecycle

### Measurable Goals
- Zero user reports of status/phase confusion
- 100% of tasks show appropriate "Starting..." state
- Phase transitions complete within 2 seconds
- No regressions in task execution

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Type errors from new phase | Low | High | Run TypeScript checks before commit |
| Breaking existing tasks | Low | High | Thorough manual testing of all scenarios |
| Performance degradation | Very Low | Medium | Profile before/after, ensure <1ms overhead |
| User confusion from label changes | Medium | Low | Update docs, add tooltips to badges |
| Backend incompatibility | Low | High | Ensure backend handles "starting" phase |

---

## Approval & Sign-off

- [ ] Technical design approved
- [ ] Breaking changes reviewed
- [ ] Testing plan approved
- [ ] Documentation plan approved
- [ ] Ready for implementation

---

## Implementation Tracking

**Total Estimated Time:** 4-6 hours

- [ ] Phase 1: Starting State (2-3 hours)
  - [ ] 1.1 Type definitions
  - [ ] 1.2 Constants
  - [ ] 1.3 Task store
  - [ ] 1.4 TaskCard component
  - [ ] 1.5 Backend validation
  - [ ] 1.6 Event handlers

- [ ] Phase 2: Contextual Labels (1-2 hours)
  - [ ] 2.1 Label mapping function
  - [ ] 2.2 Update badge rendering

- [ ] Phase 3: Progress Indicator (30 min)
  - [ ] 3.1 Update component

- [ ] Phase 4: Task Details (30 min)
  - [ ] 4.1 Modal updates

- [ ] Testing (1 hour)
  - [ ] Manual test cases
  - [ ] Edge case testing
  - [ ] Cross-browser testing

- [ ] Documentation (30 min)
  - [ ] Update README
  - [ ] Add architecture docs
  - [ ] Write changelog

---

## Notes

- This plan prioritizes user experience over technical purity
- The "starting" phase is a UX affordance, not a backend requirement
- We're fixing UI confusion, not changing the underlying architecture
- Backend phase emission logic remains unchanged

---

**End of Implementation Plan**
