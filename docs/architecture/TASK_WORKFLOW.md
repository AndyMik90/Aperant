# Complete Task Workflow Architecture

**Last Updated:** 2026-02-03
**Version:** 2.7.6
**Status:** 📝 DOCUMENTATION (Implementation Required)

---

## Overview

This document describes the **intended end-to-end workflow** for how tasks move through the Auto-Claude (Jerry) system, from initial conversation to completed code.

---

## Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASK LIFECYCLE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐                                                          │
│   │  MAIN CHAT   │  User + Jerry discuss and define the task                │
│   │   (Jerry)    │  Jerry helps refine requirements                         │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ User confirms task creation                                       │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │   PLANNING   │  Auto-starts planning agent                              │
│   │   (Auto)     │  Creates spec.md + implementation_plan.json              │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ Planning complete → ALERT USER                                    │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │ USER REVIEW  │  User reviews spec documentation                         │
│   │  (Manual)    │  User can request changes or approve                     │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ User clicks "Start Build" (MANUAL TRIGGER)                        │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │   CODING     │  Executes in Ralph-Wiggum Mode                           │
│   │ (Ralph Loop) │  Full autonomous implementation                           │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ Coding complete                                                   │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │  AI REVIEW   │  Automated testing and QA                                │
│   │   (Auto)     │  May loop back to coding for fixes                       │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ QA passes                                                         │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │HUMAN REVIEW  │  User approves or requests changes                       │
│   │  (Manual)    │  Final approval before merge                             │
│   └──────┬───────┘                                                          │
│          │                                                                   │
│          │ User approves                                                     │
│          ▼                                                                   │
│   ┌──────────────┐                                                          │
│   │    DONE      │  Changes merged, worktree cleaned                        │
│   └──────────────┘                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Main Chat - Task Definition

### Description
User interacts with Jerry (Claude) in the main chat interface to define and refine a task.

### Flow
```
1. User describes what they want to build
2. Jerry asks clarifying questions
3. Jerry helps refine requirements
4. User confirms the task is ready to create
5. Task is created and automatically sent to Planning
```

### UI Location
- Chat page (Insights → Chat)
- Jerry assists with task definition

### Data Created
- Task title
- Task description
- Initial metadata (category, priority, etc.)
- Optional: Reference images

---

## Phase 2: Planning - Spec Creation

### Description
The planning agent automatically starts when a task is created, generating the specification and implementation plan.

### Flow
```
1. Task created → Status: "planning"
2. Planning agent starts AUTOMATICALLY
3. Agent analyzes codebase
4. Agent creates spec.md
5. Agent creates implementation_plan.json
6. Planning complete → ALERT USER ⚠️
```

### Files Created
```
.auto-build/specs/{task-id}/
├── spec.md                    # Human-readable specification
├── implementation_plan.json   # Structured subtasks
└── context/                   # Optional context files
```

### Key Requirement: USER ALERT
**When planning completes, the system MUST alert the user** that the spec is ready for review. This is currently missing (see Known Issues).

### Alert Methods (Proposed)
1. **Toast Notification**: "Task 'X' is ready for review"
2. **Badge on Task Card**: "Review Spec" indicator
3. **Sound/Visual Cue**: Optional audio or animation
4. **Desktop Notification**: System-level notification

---

## Phase 3: User Review - Spec Approval

### Description
User reviews the generated specification before coding begins. This is a **MANUAL GATE** - coding should NOT start automatically.

### Flow
```
1. User sees alert that spec is ready
2. User opens task details
3. User reads spec.md
4. User reviews implementation_plan.json
5. User decides:
   a. APPROVE → Click "Start Build" → Go to Coding
   b. REQUEST CHANGES → Add feedback → Stay in Planning
   c. REJECT → Delete task
```

### UI Elements
- **View Spec Button**: Opens spec.md
- **View Plan Button**: Opens implementation_plan.json
- **Start Build Button**: Approves and starts coding (MANUAL ONLY)
- **Request Changes**: Sends feedback to planning agent

### Critical: Manual Transition
```
⚠️ IMPORTANT: The transition from Planning → Coding MUST be user-initiated.
The "Start Build" button is the ONLY way to start coding.
Automatic transitions are a BUG (see Issue #6).
```

---

## Phase 4: Coding - Ralph-Wiggum Mode

### Description
Once the user approves the spec, the task enters coding mode using "Ralph-Wiggum Mode" - an aggressive, autonomous implementation mode.

### Flow
```
1. User clicks "Start Build"
2. Status changes: planning → coding
3. Ralph Loop starts with comprehensive prompt
4. Agent executes implementation plan
5. Agent runs tests iteratively
6. Agent fixes issues autonomously
7. Coding complete → AI Review
```

### Ralph-Wiggum Mode Characteristics
- **Aggressive Iteration**: More retry attempts
- **Higher Thresholds**: Doesn't give up easily
- **Strategy Pivots**: Tries alternative approaches when stuck
- **Autonomous Fixing**: Self-corrects without user intervention

### Execution Prompt Template

When coding starts, the system should invoke the Ralph Loop with a prompt like:

```
/ralph-loop:ralph-loop "
You are an autonomous senior engineer working on a local repo.

Repository:
- Main repo path: {PROJECT_PATH}

Primary documentation (authoritative for this task):
- {SPEC_PATH}/spec.md
- {SPEC_PATH}/implementation_plan.json

Overall goal for THIS RUN:
- {TASK_DESCRIPTION}
- Follow the implementation plan exactly
- Leave the repo in a clean, buildable, test-passing state

Execution loop you MUST follow:

1) Read and align with spec
   - Carefully read spec.md and implementation_plan.json
   - Derive a concrete checklist of subtasks
   - Keep that checklist updated as you work

2) Environment and branch state
   - Ensure you are working in the task's worktree
   - Branch: {TASK_BRANCH}

3) Implement the task
   - Apply changes described in the spec
   - Work in small, verifiable steps
   - Update checklist as tasks complete

4) Verification after each logical batch
   - Run build commands
   - Run tests
   - If any fail, diagnose and fix

5) Error handling discipline
   - For EVERY failure:
     - Note what failed
     - Diagnose root cause
     - Fix and re-verify
   - If stuck for 3 iterations, try alternative strategies

6) Final regression check
   - Run full test suite
   - Ensure app starts cleanly
   - No regressions introduced

7) Stopping condition
   - ALL subtasks complete
   - ALL tests pass
   - NO known errors
   - Write final summary
   - Output: COMPLETE

Until then, continue iterating.
" --max-iterations 180 --completion-promise "COMPLETE"
```

### Subtask Execution
The agent works through `implementation_plan.json` subtasks:
```json
{
  "subtasks": [
    { "id": "1", "title": "Create component file", "status": "pending" },
    { "id": "2", "title": "Add unit tests", "status": "pending" },
    { "id": "3", "title": "Update exports", "status": "pending" }
  ]
}
```

---

## Phase 5: AI Review

### Description
Automated quality assurance after coding completes. The system runs tests and validates the implementation.

### Flow
```
1. Coding reports complete
2. Status changes: coding → ai_review
3. QA agent runs:
   - Unit tests
   - Integration tests
   - Lint checks
   - Type checks
4. If issues found:
   - Status: ai_review (qa_fixing phase)
   - Agent attempts fixes
   - Loop back to testing
5. If QA passes:
   - Status changes: ai_review → human_review
```

### QA Checks
- `npm run build` - Build succeeds
- `npm test` - Tests pass
- `npm run lint` - No lint errors
- `npm run typecheck` - No type errors

---

## Phase 6: Human Review

### Description
Final human approval before merging changes.

### Flow
```
1. Task appears in "Human Review" column
2. User reviews:
   - Code changes (diff view)
   - Test results
   - Any warnings
3. User decides:
   a. APPROVE → Merge changes → Done
   b. REQUEST CHANGES → Feedback → Back to Coding
   c. CREATE PR → Push to GitHub for team review
```

### UI Actions
- **Approve**: Merges worktree to base branch
- **Request Changes**: Adds feedback, returns to coding
- **Create PR**: Creates GitHub pull request

---

## Phase 7: Done

### Description
Task is complete, changes are merged.

### Final State
- Changes merged to base branch
- Worktree optionally deleted
- Task archived (optional)

---

## Status/Phase Mapping for Workflow

| Workflow Stage | Task Status | Execution Phase | User Action Required |
|----------------|-------------|-----------------|---------------------|
| Chat | (not created) | - | Define task |
| Planning (active) | `planning` | `planning` | Wait |
| Planning (done) | `planning` | `idle` | **REVIEW SPEC** |
| Coding | `coding` | `starting`/`planning`/`coding` | Wait |
| AI Review | `ai_review` | `qa_review`/`qa_fixing` | Wait |
| Human Review | `human_review` | `idle`/`complete` | **APPROVE/REJECT** |
| Done | `done` | `idle` | - |

---

## Required UI Changes

### 1. Planning Complete Alert
When planning finishes, show notification:
```typescript
// When planning agent completes successfully
toast.success('Spec Ready for Review', {
  description: `Task "${task.title}" is ready. Review the spec and click Start Build.`,
  action: {
    label: 'Review Now',
    onClick: () => openTaskDetails(task.id)
  }
});
```

### 2. Spec Review UI
Task card in planning status should show:
- "Review Spec" button (primary action)
- "Start Build" button (only enabled after review)
- Spec preview/summary

### 3. Start Build Confirmation
Before starting build, confirm:
```typescript
// Confirmation dialog
"Are you ready to start building? The AI will implement the spec autonomously."
[Cancel] [Start Build]
```

### 4. Progress Visibility
During coding, show:
- Current subtask
- Progress percentage
- Ralph Loop iteration count
- Estimated completion

---

## Implementation Files

| File | Purpose |
|------|---------|
| `src/renderer/stores/task-store.ts` | Prevent auto-transition |
| `src/main/ipc-handlers/agent-events-handlers.ts` | Fix phaseToStatus mapping |
| `src/renderer/components/TaskCard.tsx` | Add review UI |
| `src/main/agent/agent-manager.ts` | Ralph Loop integration |
| `apps/backend/run.py` | Ralph Loop execution |

---

## Fixes Required (Cross-Reference)

This workflow requires fixing the issues documented in [KNOWN_ISSUES.md](../plans/KNOWN_ISSUES.md):

| Issue | Impact on Workflow |
|-------|-------------------|
| #1 startBuild Error UI | User doesn't know why build failed |
| #3 Planning Not Restarting | Tasks stuck, can't complete planning |
| #5 Terminal Not Legible | User can't monitor progress |
| **#6 Auto-Transition** | **CRITICAL: Breaks user review step** |

---

## Ralph-Wiggum Mode Configuration

### Task Metadata
```typescript
interface TaskMetadata {
  ralphWiggumMode?: boolean;  // Enable aggressive iteration
  maxIterations?: number;      // Default: 180
  completionPromise?: string;  // Default: "COMPLETE"
}
```

### Invocation
```bash
/ralph-loop:ralph-loop "{PROMPT}" --max-iterations 180 --completion-promise "COMPLETE"
```

### Behavior Flags
- **Aggressive Retries**: 3x normal retry count
- **Higher Thresholds**: 5x tolerance for recurring issues
- **Auto-Pivot**: Automatically tries alternative strategies
- **No Early Quit**: Must complete all subtasks or hit max iterations

---

## Summary

The key insight is that **Planning → Coding is a user-controlled gate**:

1. ✅ **Auto**: Chat → Planning (immediate on task creation)
2. ✅ **Auto**: Planning runs (creates spec)
3. ⚠️ **ALERT**: User notified when planning done
4. 🛑 **MANUAL**: User reviews and clicks "Start Build"
5. ✅ **Auto**: Coding runs (Ralph-Wiggum mode)
6. ✅ **Auto**: AI Review runs
7. 🛑 **MANUAL**: User approves in Human Review
8. ✅ **Auto**: Done (merge)

The current bug (Issue #6) breaks step 4 by auto-transitioning.

---

**End of Task Workflow Architecture**
