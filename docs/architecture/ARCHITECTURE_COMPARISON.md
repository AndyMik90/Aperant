# Architecture Comparison: Original vs Current Auto-Claude

**Last Updated:** 2026-02-04
**Version:** 1.0
**Status:** 📋 DOCUMENTATION

---

## Executive Summary

This document compares the **original Auto-Claude** repository with our **current fork**, documenting the task lifecycle pipeline, architectural differences, and implementation status.

### Key Findings

| Aspect | Original | Current Fork | Status |
|--------|----------|--------------|--------|
| Task Lifecycle | 6 phases | 6 phases (same) | ✅ Compatible |
| State Machine | XState-based | XState-based | ✅ Same |
| Phase Protocol | `__EXEC_PHASE__` JSON | `__EXEC_PHASE__` JSON | ✅ Same |
| Ralph Wiggum Mode | Not present | Added | ✨ Enhancement |
| QA Loop | Basic | Enhanced with configurable thresholds | ✨ Enhancement |
| Terminal Integration | Floating modal | Inline expansion (planned) | 🔄 In Progress |

---

## Task Lifecycle Overview

Both versions share the same fundamental task lifecycle:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        TASK LIFECYCLE PIPELINE                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   ┌─────────┐    ┌──────────┐    ┌────────┐    ┌───────────┐    ┌──────┐│
│   │ PLANNING│ → │  CODING  │ → │AI REVIEW│ → │HUMAN REVIEW│ → │ DONE ││
│   └─────────┘    └──────────┘    └────────┘    └───────────┘    └──────┘│
│        │              │              │               │              │    │
│   Auto-start    User-triggered   Auto-run      User approval    Merge   │
│   on create     "Start Build"    QA checks     required         changes │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Task Creation & Planning

### Original Architecture

```typescript
// apps/frontend/src/renderer/stores/task-store.ts
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'planning' | 'coding' | 'ai_review' | 'human_review' | 'done';
  executionPhase: string;
  worktreePath?: string;
  branch?: string;
}
```

**Flow:**
1. User creates task via UI or Jerry chat
2. Task saved with `status: 'planning'`
3. Planning agent auto-starts
4. Creates `spec.md` and `implementation_plan.json`

### Current Fork (Same + Enhancements)

**Same core flow**, plus:
- Enhanced spec validation
- Better error handling for planning failures
- Machine-specific path support

### Files Involved

| File | Purpose |
|------|---------|
| `apps/frontend/src/renderer/stores/task-store.ts` | Task state management |
| `apps/backend/planning/` | Planning agent logic |
| `.auto-build/specs/{task-id}/` | Spec output location |

---

## Phase 2: Planning → Coding Gate (FIX-10)

### Critical: Manual Gate Requirement

```
⚠️ IMPORTANT: Planning → Coding MUST be user-initiated
```

### Original Behavior (Bug)
- Some paths auto-transitioned from planning to coding
- User didn't get chance to review spec

### Current Fork (Fixed)
- "Start Build" button is the ONLY way to start coding
- User must explicitly approve spec
- Documented in TASK_WORKFLOW.md

### Implementation

```typescript
// Task card shows "Start Build" button only after planning completes
// apps/frontend/src/renderer/components/TaskCard.tsx

const handleStartBuild = async () => {
  // User explicitly triggers this
  await window.api.task.startBuild(task.id);
};
```

---

## Phase 3: Coding Phase

### Original Architecture

```python
# apps/backend/run.py
# Basic execution with standard retry limits
```

**Characteristics:**
- Standard retry counts (3 attempts)
- Basic QA iteration limits (50)
- No special handling for circular fixes

### Current Fork (Ralph Wiggum Mode)

```python
# apps/backend/phase_config.py
RALPH_WIGGUM_CONFIG = {
    "subtask_attempts_before_stuck": 5,     # Original: 3
    "qa_recurring_issue_threshold": 5,      # Original: 3
    "qa_consecutive_errors_limit": 5,       # Original: 3
    "qa_max_iterations": 100,               # Original: 50
    "flaky_test_retries": 2,                # Original: 0
    "force_pivot_on_circular": True,        # Original: False
}
```

**Enhancements:**
- Higher retry limits for stubborn issues
- More QA iterations allowed
- Force strategy pivot on circular fix detection
- Flaky test retry support

### Phase Protocol (Both)

```python
# Output format for frontend communication
print(f'__EXEC_PHASE__:{json.dumps({"phase": "coding", "message": "..."})}')
```

---

## Phase 4: QA Review

### Original Architecture

```python
# apps/backend/qa/loop.py
MAX_QA_ITERATIONS = 50
MAX_CONSECUTIVE_ERRORS = 3
RECURRING_ISSUE_THRESHOLD = 3
```

### Current Fork (Enhanced)

```python
# apps/backend/qa/loop.py
DEFAULT_MAX_QA_ITERATIONS = 50
DEFAULT_MAX_CONSECUTIVE_ERRORS = 3
DEFAULT_RECURRING_ISSUE_THRESHOLD = 3

# Backward compatibility alias
MAX_QA_ITERATIONS = DEFAULT_MAX_QA_ITERATIONS

# Configurable via Ralph Wiggum mode
def run_qa_loop(
    max_iterations: int = DEFAULT_MAX_QA_ITERATIONS,
    consecutive_error_limit: int = DEFAULT_MAX_CONSECUTIVE_ERRORS,
    recurring_threshold: int = DEFAULT_RECURRING_ISSUE_THRESHOLD
):
    ...
```

### QA Loop Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         QA LOOP                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐                                                   │
│   │ Run Tests│                                                   │
│   └────┬─────┘                                                   │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────┐    Pass    ┌──────────────┐                      │
│   │ Analyze  │ ─────────→ │ Human Review │                      │
│   │ Results  │            └──────────────┘                      │
│   └────┬─────┘                                                   │
│        │ Fail                                                    │
│        ▼                                                         │
│   ┌──────────┐                                                   │
│   │   Fix    │ ←───────┐                                        │
│   │  Issues  │         │                                        │
│   └────┬─────┘         │                                        │
│        │               │                                        │
│        ▼               │                                        │
│   ┌──────────┐    Fail │                                        │
│   │ Re-test  │ ────────┘                                        │
│   └────┬─────┘                                                   │
│        │ Pass                                                    │
│        ▼                                                         │
│   ┌──────────────┐                                               │
│   │ Human Review │                                               │
│   └──────────────┘                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Human Review

### Both Versions (Same)

```
┌─────────────────────────────────────────────────────────────────┐
│                      HUMAN REVIEW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User reviews in Kanban "Human Review" column                   │
│                                                                  │
│   Actions:                                                       │
│   ┌──────────┐  ┌─────────────────┐  ┌───────────┐              │
│   │ Approve  │  │ Request Changes │  │ Create PR │              │
│   └────┬─────┘  └────────┬────────┘  └─────┬─────┘              │
│        │                 │                  │                    │
│        ▼                 ▼                  ▼                    │
│   ┌──────────┐   ┌──────────┐      ┌────────────────┐           │
│   │  Merge   │   │ Back to  │      │ GitHub PR for  │           │
│   │ to main  │   │  Coding  │      │  team review   │           │
│   └──────────┘   └──────────┘      └────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Machine (XState)

### Both Versions Use XState

```typescript
// apps/frontend/src/renderer/stores/task-machine.ts
import { createMachine } from 'xstate';

const taskMachine = createMachine({
  id: 'task',
  initial: 'planning',
  states: {
    planning: {
      on: { START_BUILD: 'coding' }  // Manual trigger only
    },
    coding: {
      on: { CODING_COMPLETE: 'ai_review' }
    },
    ai_review: {
      on: {
        QA_PASS: 'human_review',
        QA_FAIL: 'coding'  // Loop back for fixes
      }
    },
    human_review: {
      on: {
        APPROVE: 'done',
        REQUEST_CHANGES: 'coding'
      }
    },
    done: {
      type: 'final'
    }
  }
});
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| planning | coding | User clicks "Start Build" |
| coding | ai_review | Coding agent completes |
| ai_review | human_review | QA passes |
| ai_review | coding | QA fails (needs fixes) |
| human_review | done | User approves |
| human_review | coding | User requests changes |

---

## IPC Communication

### Phase Protocol (Both Versions)

```python
# Backend outputs structured phase updates
__EXEC_PHASE__:{"phase":"planning","message":"Creating spec..."}
__EXEC_PHASE__:{"phase":"coding","message":"Implementing feature..."}
__EXEC_PHASE__:{"phase":"qa_review","message":"Running tests..."}
```

### Frontend Parsing

```typescript
// apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts
const PHASE_MARKER = '__EXEC_PHASE__:';

function parsePhaseOutput(output: string) {
  if (output.includes(PHASE_MARKER)) {
    const jsonStr = output.split(PHASE_MARKER)[1];
    return JSON.parse(jsonStr);
  }
  return null;
}
```

---

## Key Differences Summary

### 1. Ralph Wiggum Mode (Current Fork Only)

| Feature | Original | Current Fork |
|---------|----------|--------------|
| Retry attempts | 3 | 5 |
| QA iterations | 50 | 100 |
| Circular fix detection | No | Yes |
| Force pivot | No | Yes |
| Flaky test retries | 0 | 2 |

### 2. Terminal Integration

| Feature | Original | Current Fork |
|---------|----------|--------------|
| Terminal display | Floating modal | Floating modal (inline planned) |
| Tool use display | Basic | Enhanced (in progress) |
| Output parsing | Raw | Structured (planned) |

### 3. Documentation

| Feature | Original | Current Fork |
|---------|----------|--------------|
| Task workflow docs | Minimal | Comprehensive |
| Ralph prompt format | N/A | Documented & tested |
| Architecture docs | Basic | Detailed comparison |

---

## What's Working in Current Fork

### ✅ Fully Working

1. **Task Creation** - UI creates tasks correctly
2. **Planning Agent** - Auto-starts and creates specs
3. **State Machine** - Valid transitions enforced
4. **Phase Protocol** - Frontend receives phase updates
5. **QA Loop** - Tests run and issues detected
6. **Human Review** - Manual approval gate works

### ✅ Enhanced & Working

1. **Ralph Wiggum Mode** - Higher thresholds, better iteration
2. **Configurable QA** - Adjustable limits per task
3. **Multi-machine paths** - Works on different machines

### 🔄 In Progress

1. **Terminal Inline Display** - Phase 7 (TERM-1 through TERM-4)
2. **Tool Use Display Fix** - Shows "(no path)" currently
3. **UI Navigation Updates** - Phase 7 tasks

---

## What Needs Improvement

### Priority 1 (Critical)

| Issue | Description | Plan |
|-------|-------------|------|
| Terminal readability | Tool use shows "(no path)" | TERM-2 |
| Inline terminal | Modal is disconnected | TERM-1 |

### Priority 2 (Important)

| Issue | Description | Plan |
|-------|-------------|------|
| Output parsing | Raw terminal output | TERM-3 |
| Status indicators | No visual feedback | TERM-4 |

### Priority 3 (Nice to Have)

| Issue | Description | Plan |
|-------|-------------|------|
| Desktop notifications | Alert when planning done | Future |
| Progress percentage | Show completion % | Future |

---

## File Structure Comparison

### Original Auto-Claude

```
Auto-Claude-original/
├── apps/
│   ├── backend/
│   │   ├── run.py              # Main execution
│   │   ├── planning/           # Planning agent
│   │   └── qa/                 # QA loop (basic)
│   └── frontend/
│       └── src/
│           ├── main/           # Electron main process
│           └── renderer/       # React UI
│               ├── components/ # UI components
│               └── stores/     # State management
└── docs/                       # Basic docs
```

### Current Fork

```
Auto-Claude/
├── apps/
│   ├── backend/
│   │   ├── run.py              # Main execution
│   │   ├── phase_config.py     # ✨ NEW: Ralph Wiggum config
│   │   ├── planning/           # Planning agent
│   │   └── qa/                 # QA loop (enhanced)
│   │       ├── loop.py         # Configurable thresholds
│   │       ├── criteria.py     # QA criteria
│   │       └── report.py       # QA reporting
│   └── frontend/
│       └── src/
│           ├── main/           # Electron main process
│           └── renderer/       # React UI
│               ├── components/ # UI components
│               └── stores/     # State management
└── docs/
    ├── architecture/           # ✨ NEW: Architecture docs
    │   ├── TASK_WORKFLOW.md
    │   └── ARCHITECTURE_COMPARISON.md
    └── plans/                  # ✨ NEW: Implementation plans
        ├── REMAINING_TASKS.md
        ├── TERMINAL_REDESIGN.md
        └── RALPH_IMPLEMENTATION_GUIDE.md
```

---

## Completion Promises System

### Purpose
Prevent Ralph from stopping early by requiring explicit completion markers.

### Format
```
<promise>TASK_NAME_COMPLETE</promise>
```

### Usage in Prompts
```bash
/ralph-loop:ralph-loop "..." --completion-promise "PHASE_COMPLETE"
```

### Current Promises

| Phase | Promise |
|-------|---------|
| v3.2 Quick Fixes | `V3_2_REMAINING_TASKS_COMPLETE` |
| Phase 7 | `PHASE_7_TERMINAL_REDESIGN_COMPLETE` |

---

## Conclusion

The current fork maintains **full compatibility** with the original Auto-Claude architecture while adding significant enhancements:

1. **Ralph Wiggum Mode** - More aggressive, persistent task completion
2. **Configurable QA** - Adjustable thresholds for different task types
3. **Comprehensive Documentation** - Clear understanding of system behavior
4. **Multi-machine Support** - Works across different development environments

The core task lifecycle (Planning → Coding → AI Review → Human Review → Done) remains unchanged, ensuring stability while allowing for improvements.

---

**End of Architecture Comparison Document**
