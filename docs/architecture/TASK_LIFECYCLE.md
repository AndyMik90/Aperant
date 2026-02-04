# Auto-Claude Task Lifecycle

**Version:** 1.2
**Updated:** 2026-02-04
**Status:** Architecture fully implemented (all TODOs complete)

---

## Overview

This document describes the complete lifecycle of a task in Auto-Claude, from creation through completion. Each task progresses through distinct phases with specific agents, user gates, and automated transitions.

---

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Task Creation | ✅ Implemented | Working |
| Phase 2: Planning | ✅ Implemented | Ralph-compatible spec output (LIFECYCLE-1) |
| Phase 3: Coding | ✅ Implemented | Ralph Loop integration with promise detection (LIFECYCLE-2) |
| Phase 4: AI Review | ✅ Implemented | Persistent memory for issues in memories/issues.md (LIFECYCLE-3) |
| Phase 5: Human Review | ✅ Implemented | Persistent memory for rejections in memories/human_feedback.md (LIFECYCLE-4) |
| Phase 6: Done | ✅ Implemented | Working |

---

## Visual Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           AUTO-CLAUDE TASK LIFECYCLE                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: TASK CREATION                                              ✅ IMPLEMENTED  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   User clicks "New Task" in UI                                                       │
│            │                                                                         │
│            ▼                                                                         │
│   ┌─────────────────┐                                                                │
│   │  TASK_CREATE    │  IPC Handler (crud-handlers.ts)                                │
│   │  handler        │                                                                │
│   └────────┬────────┘                                                                │
│            │                                                                         │
│            ▼                                                                         │
│   • Creates spec directory: .auto-claude/specs/{task-id}/                            │
│   • Writes task_metadata.json                                                        │
│   • Sets status = 'planning'                                                         │
│   • Calls agentManager.startPlanningAgent()                                          │
│            │                                                                         │
│            ▼                                                                         │
│   ┌─────────────────────────────────────────────────────┐                            │
│   │  PLANNING AGENT STARTS                              │                            │
│   │  • spec_runner.py --no-build                        │                            │
│   │  • Creates git worktree (isolated branch)           │                            │
│   │  • Agent mode: 'planning'                           │                            │
│   └─────────────────────────────────────────────────────┘                            │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: PLANNING                                              ✅ RALPH SPEC COMPLETE│
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Planning Agent (spec_runner.py with --no-build flag)                               │
│            │                                                                         │
│            ├──────────────────────────────────────────────────────┐                  │
│            │                                                      │                  │
│            ▼                                                      ▼                  │
│   ┌─────────────────────┐                              ┌─────────────────────┐       │
│   │  Analyze Codebase   │                              │  Chat with User     │       │
│   │  • Read files       │                              │  • Answer questions │       │
│   │  • Understand arch  │                              │  • Clarify scope    │       │
│   └──────────┬──────────┘                              │  • Refine plan      │       │
│              │                                         └─────────────────────┘       │
│              ▼                                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐            │
│   │  Create RALPH-COMPATIBLE spec.md                                    │            │
│   │  ════════════════════════════════                                   │            │
│   │  Must include:                                                      │            │
│   │  • Task overview                                                    │            │
│   │  • Success criteria (checkboxes)                                    │            │
│   │  • Implementation steps with:                                       │            │
│   │    - Step N of Total                                                │            │
│   │    - Files to modify                                                │            │
│   │    - What to do                                                     │            │
│   │    - Exit condition                                                 │            │
│   │    - Promise: <promise>STEP_N_COMPLETE</promise>                    │            │
│   │  • Execution rules (DO NOT STOP)                                    │            │
│   │  • Final completion promise                                         │            │
│   └──────────┬──────────────────────────────────────────────────────────┘            │
│              │                                                                       │
│              ▼                                                                       │
│   ┌─────────────────────────────────┐                                                │
│   │  Create implementation_plan.json│  Subtasks breakdown                            │
│   └──────────┬──────────────────────┘                                                │
│              │                                                                       │
│              ▼                                                                       │
│   ┌─────────────────────┐                                                            │
│   │  Save to /memories  │  Context for coding phase                                  │
│   └──────────┬──────────┘                                                            │
│              │                                                                       │
│              ▼                                                                       │
│   Agent outputs: __EXEC_PHASE__:{"phase":"planning_complete"}                        │
│              │                                                                       │
│              ▼                                                                       │
│   ════════════════════════════════════════════════════                               │
│   ║  AGENT STOPS (--no-build flag prevents auto-continue) ║                          │
│   ║  Task card shows: "Start Build" button                ║                          │
│   ════════════════════════════════════════════════════════                           │
│                                                                                      │
│   User Actions Available:                                                            │
│   • [Resume] → Restart planning agent (TASK_START)                                   │
│   • [Stop] → Kill planning agent (TASK_STOP)                                         │
│   • [Start Build] → Transition to coding (TASK_START_BUILD) ◄── MANUAL GATE          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ User clicks "Start Build"
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  MANUAL GATE: START BUILD                                                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌─────────────────┐                                                                │
│   │ TASK_START_BUILD│  IPC Handler (execution-handlers.ts)                           │
│   │ handler         │                                                                │
│   └────────┬────────┘                                                                │
│            │                                                                         │
│            ├─── Validates: spec.md exists?                                           │
│            ├─── Validates: implementation_plan.json exists?                          │
│            ├─── ✅ Validates spec.md is Ralph-compatible format                       │
│            ├─── Stops planning agent if still running                                │
│            │                                                                         │
│            ▼                                                                         │
│   • Calls agentManager.startTaskExecution()                                          │
│   • Sets status = 'coding'                                                           │
│   • Persists status to implementation_plan.json                                      │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: CODING (via Ralph Loop)                               ✅ RALPH LOOP COMPLETE│
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐    │
│   │  RALPH LOOP EXECUTION                                                       │    │
│   │  ═══════════════════════                                                    │    │
│   │                                                                             │    │
│   │  1. Load spec.md (Ralph-compatible format from planning phase)              │    │
│   │                                                                             │    │
│   │  2. Invoke Ralph Loop:                                                      │    │
│   │     /ralph-loop --completion-promise "TASK_{ID}_COMPLETE"                   │    │
│   │                                                                             │    │
│   │  3. Ralph executes autonomously:                                            │    │
│   │     ┌─────────────────────────────────────────────────────────────────┐     │    │
│   │     │  FOR EACH STEP in spec.md:                                      │     │    │
│   │     │    • Execute the step                                           │     │    │
│   │     │    • Output: <promise>STEP_N_COMPLETE</promise>                 │     │    │
│   │     │    • Continue to next step (DO NOT STOP)                        │     │    │
│   │     │                                                                 │     │    │
│   │     │  WHEN ALL STEPS DONE:                                           │     │    │
│   │     │    • Run build verification                                     │     │    │
│   │     │    • Run tests                                                  │     │    │
│   │     │    • Output: <promise>TASK_{ID}_COMPLETE</promise>              │     │    │
│   │     └─────────────────────────────────────────────────────────────────┘     │    │
│   │                                                                             │    │
│   │  4. Jerry monitors stdout for:                                              │    │
│   │     • <promise>STEP_N_COMPLETE</promise> → Update progress UI               │    │
│   │     • <promise>TASK_{ID}_COMPLETE</promise> → Transition to AI Review       │    │
│   │     • Errors → Log in terminal, update phase badge                          │    │
│   │                                                                             │    │
│   └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│   User Actions Available:                                                            │
│   • [Stop] → Kill Ralph loop (TASK_STOP)                                             │
│   • [Resume] → Restart Ralph loop (TASK_START)                                       │
│   • Chat → Send messages to agent                                                    │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Ralph outputs TASK_{ID}_COMPLETE
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: AI REVIEW (with Persistent Memory)                  ✅ MEMORY COMPLETE      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   QA Agent (run.py --qa)                                                             │
│            │                                                                         │
│            ▼                                                                         │
│   ┌─────────────────────────────────────────────┐                                    │
│   │  Self-Review Process                        │                                    │
│   │  • Verify all subtasks completed            │                                    │
│   │  • Check build passes                       │                                    │
│   │  • Check tests pass                         │                                    │
│   │  • Verify spec requirements met             │                                    │
│   └──────────┬──────────────────────────────────┘                                    │
│              │                                                                       │
│              ├────────────────────────────────────┐                                  │
│              │                                    │                                  │
│              ▼                                    ▼                                  │
│   ┌─────────────────────────────┐      ┌─────────────────────┐                       │
│   │  ISSUES FOUND               │      │  ALL CHECKS PASS    │                       │
│   │                             │      │                     │                       │
│   │  ┌───────────────────────┐  │      │  • Merge worktree   │                       │
│   │  │ PERSISTENT MEMORY     │  │      │    to main branch   │                       │
│   │  │ ═══════════════════   │  │      │  • Stage changes    │                       │
│   │  │                       │  │      └──────────┬──────────┘                       │
│   │  │ Document issue to:    │  │                 │                                  │
│   │  │ /memories/issues.md   │  │                 │                                  │
│   │  │                       │  │                 │                                  │
│   │  │ Include:              │  │                 │                                  │
│   │  │ • Issue description   │  │                 │                                  │
│   │  │ • Root cause          │  │                 │                                  │
│   │  │ • Fix applied         │  │                 │                                  │
│   │  │ • Prevention tip      │  │                 │                                  │
│   │  │                       │  │                 │                                  │
│   │  │ This ensures the      │  │                 │                                  │
│   │  │ same issue won't be   │  │                 │                                  │
│   │  │ repeated in future    │  │                 │                                  │
│   │  │ tasks!                │  │                 │                                  │
│   │  └───────────────────────┘  │                 │                                  │
│   │                             │                 │                                  │
│   │  • Write fixes              │                 │                                  │
│   │  • Loop back to coding      │                 │                                  │
│   └────────────┬────────────────┘                 │                                  │
│                │                                  │                                  │
│                ▼                                  ▼                                  │
│       Return to CODING                 Agent outputs: __EXEC_PHASE__:                │
│       (up to N retries)                  {"phase":"human_review"}                    │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Automatic transition
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: HUMAN REVIEW                                            ✅ IMPLEMENTED     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ════════════════════════════════════════════════════════════                       │
│   ║  AGENT STOPPED - Waiting for human decision              ║                       │
│   ════════════════════════════════════════════════════════════                       │
│                                                                                      │
│   Task Card Shows:                                                                   │
│   • Changes merged to main (staged, not committed)                                   │
│   • Diff view available                                                              │
│   • [Approve] and [Reject] buttons                                                   │
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐    │
│   │                                                                             │    │
│   │   User clicks [APPROVE]              User clicks [REJECT]                   │    │
│   │          │                                  │                               │    │
│   │          ▼                                  ▼                               │    │
│   │   ┌─────────────────┐              ┌─────────────────────────┐              │    │
│   │   │  TASK_REVIEW    │              │  TASK_REVIEW            │              │    │
│   │   │  approved=true  │              │  approved=false         │              │    │
│   │   └────────┬────────┘              │  feedback="Fix X..."    │              │    │
│   │            │                       │  images=[screenshots]   │              │    │
│   │            ▼                       └───────────┬─────────────┘              │    │
│   │   • Write QA_REPORT.md                        │                             │    │
│   │     (Status: APPROVED)                        ▼                             │    │
│   │   • Set status = 'done'            • Reset main to pre-merge                │    │
│   │            │                       • Write QA_FIX_REQUEST.md                │    │
│   │            │                       • ✅ Add to memories/human_feedback.md    │    │
│   │            │                       • Restart QA process                     │    │
│   │            │                       • Set status = 'coding'                  │    │
│   │            │                                  │                             │    │
│   │            │                                  ▼                             │    │
│   │            │                       Return to CODING phase                   │    │
│   │            │                       (with feedback for fixes)                │    │
│   │            │                                                                │    │
│   └────────────┼────────────────────────────────────────────────────────────────┘    │
│                │                                                                     │
└────────────────┼─────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 6: DONE                                                    ✅ IMPLEMENTED     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Task Complete!                                                                     │
│                                                                                      │
│   • Changes are staged in main branch                                                │
│   • User can commit: git commit -m "Task: {title}"                                   │
│   • User can create PR (if desired)                                                  │
│   • Worktree can be cleaned up                                                       │
│                                                                                      │
│   Task Card Shows:                                                                   │
│   • [Archive] button                                                                 │
│   • [Create PR] button (optional)                                                    │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Completed Implementations (LIFECYCLE TODOs)

### ✅ TODO-1: Ralph-Compatible Spec Output (Phase 2) - LIFECYCLE-1

**File:** `apps/backend/runners/spec_runner.py` (or planning prompt)

The planning agent must output `spec.md` in Ralph-compatible format:

```markdown
# Task: {Task Title}

## Overview
{Brief description of what needs to be built}

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

---

## ⚠️ EXECUTION RULES (READ BEFORE STARTING)

**You are NOT ALLOWED to stop until ALL steps below are complete.**

1. Complete each step in order
2. Output the step promise after each step
3. **DO NOT** write progress summaries - just continue to next step
4. After EACH step, immediately start the next step
5. Only output <promise>TASK_{ID}_COMPLETE</promise> after ALL steps done

**If you find yourself writing "good progress" or similar wrap-up language, STOP and continue to the next step instead.**

---

## Implementation Steps ({N} TOTAL - ALL MUST COMPLETE)

### Step 1 of {N}: {Title}
**Files:** `path/to/file.ts`
**What:** {Specific action}
**Exit:** {How to verify step is done}

After completing this step:
1. Output: <promise>STEP_1_COMPLETE</promise>
2. **NEXT:** Immediately proceed to Step 2: {Next Title}

⚠️ DO NOT summarize. DO NOT stop. Continue NOW.

---

### Step 2 of {N}: {Title}
...

---

## Final Verification (MANDATORY)

Before outputting the completion promise, verify:
- [ ] All {N} step promises have been output
- [ ] Build passes: `npm run build`
- [ ] No TypeScript errors
- [ ] Tests pass

**If ALL checkboxes are checked:**
<promise>TASK_{ID}_COMPLETE</promise>

**If ANY checkbox is unchecked:**
Go back and complete the missing items. DO NOT output completion promise.
```

---

### ✅ TODO-2: Ralph Loop Integration (Phase 3) - LIFECYCLE-2

**File:** `apps/frontend/src/main/agent/agent-manager.ts`

Update `startTaskExecution()` to invoke Ralph Loop:

```typescript
async startTaskExecution(taskId, projectPath, specId, options) {
  // 1. Read spec.md
  const specPath = path.join(specsDir, specId, 'spec.md');
  const specContent = readFileSync(specPath, 'utf-8');

  // 2. Validate Ralph-compatible format
  if (!isRalphCompatible(specContent)) {
    throw new Error('spec.md is not in Ralph-compatible format');
  }

  // 3. Invoke Ralph Loop
  // /ralph-loop --completion-promise "TASK_{ID}_COMPLETE"
  const args = [
    '--completion-promise', `TASK_${specId}_COMPLETE`,
    '--max-iterations', '200'
  ];

  // 4. Pass spec.md content as prompt
  // ... spawn process with spec content
}
```

---

### ✅ TODO-3: Persistent Memory for Issues (Phase 4) - LIFECYCLE-3

**File:** `apps/backend/runners/qa_runner.py` (or QA agent code)

When issues are found during AI Review, document them:

```python
def document_issue(spec_dir, issue):
    """
    Document issue to persistent memory so it won't be repeated.
    """
    issues_file = os.path.join(spec_dir, 'memories', 'issues.md')

    # Create or append to issues.md
    with open(issues_file, 'a') as f:
        f.write(f"""
## Issue: {issue['title']}
**Date:** {datetime.now().isoformat()}
**Phase:** AI Review

### Description
{issue['description']}

### Root Cause
{issue['root_cause']}

### Fix Applied
{issue['fix']}

### Prevention
{issue['prevention_tip']}

---
""")
```

**Also update the planning prompt** to read `/memories/issues.md` and avoid repeating documented issues.

---

### ✅ TODO-4: Human Review Rejection Memory (Phase 5) - LIFECYCLE-4

**File:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`

When user rejects in human review, add to persistent memory:

```typescript
// In TASK_REVIEW handler, when approved=false:
if (!approved && feedback) {
  // Write to persistent memory
  const issuesPath = path.join(specDir, 'memories', 'human_feedback.md');
  appendFileSync(issuesPath, `
## Human Review Rejection
**Date:** ${new Date().toISOString()}

### Feedback
${feedback}

### Screenshots
${images?.map(i => `![](${i.filename})`).join('\n') || 'None'}

---
`);
}
```

---

## Phase Details

### Phase 1: Task Creation ✅

**Trigger:** User clicks "New Task" button
**IPC Handler:** `TASK_CREATE` in `crud-handlers.ts`
**Status:** `planning`

**What Happens:**
1. Frontend sends task title, description, and metadata
2. Backend creates spec directory at `.auto-claude/specs/{task-id}/`
3. Writes `task_metadata.json` with model configuration
4. Sets initial status to `planning`
5. Calls `agentManager.startPlanningAgent()`

---

### Phase 2: Planning ✅

**Agent:** Planning Agent (`spec_runner.py --no-build`)
**Status:** `planning`
**Mode:** Interactive (can chat with user)

**What the Agent MUST Do:**
1. Creates git worktree for isolated development
2. Analyzes codebase structure
3. Reads relevant files
4. **Creates Ralph-compatible `spec.md`** ✅
5. Creates `implementation_plan.json` (subtasks breakdown)
6. Saves context to `/memories` directory
7. Outputs `__EXEC_PHASE__:{"phase":"planning_complete"}`
8. **STOPS** (due to `--no-build` flag)

**Files Created:**
```
.auto-claude/specs/{task-id}/
├── spec.md                    # MUST BE RALPH-COMPATIBLE FORMAT
├── implementation_plan.json   # Subtasks breakdown
└── memories/                  # Context for coding phase
    ├── codebase_analysis.md
    ├── issues.md              # Persistent issue memory (read by planning)
    └── ...
```

---

### Phase 3: Coding ✅

**Agent:** Ralph Loop (Claude Code with Ralph-Wiggum plugin)
**Status:** `coding`
**Mode:** Autonomous (executes spec.md steps)

**What SHOULD Happen:**
1. `TASK_START_BUILD` validates spec.md is Ralph-compatible
2. Invokes Ralph Loop with spec.md content
3. Ralph executes each step autonomously
4. Outputs step promises: `<promise>STEP_N_COMPLETE</promise>`
5. Jerry monitors stdout and updates progress UI
6. Ralph outputs `<promise>TASK_{ID}_COMPLETE</promise>` when done
7. Transitions to AI Review

---

### Phase 4: AI Review ✅

**Agent:** QA Agent (`run.py --qa`)
**Status:** `ai_review`
**Mode:** Autonomous (self-review)

**What SHOULD Happen:**
1. Verifies all subtasks marked completed
2. Runs build verification
3. Runs test suite
4. **If issues found:**
   - **Documents issue to `/memories/issues.md`** ✅
   - Writes fixes
   - Loops back to coding
5. If all checks pass:
   - Merges worktree changes to main branch
   - Stages changes
   - Transitions to Human Review

---

### Phase 5: Human Review ✅

**Agent:** None (waiting for user)
**Status:** `human_review`

**What Happens:**
- Approve → Task marked done
- Reject → **✅ Adds feedback to memories/human_feedback.md** → Returns to coding

---

### Phase 6: Done ✅

Task complete. User can commit, create PR, or archive.

---

## Persistent Memory Structure

```
.auto-claude/specs/{task-id}/
└── memories/
    ├── codebase_analysis.md   # Planning phase analysis
    ├── issues.md              # Issues found during AI Review (append-only)
    ├── human_feedback.md      # Rejections from Human Review (append-only)
    └── learnings.md           # General learnings (future)
```

**How It Works:**
1. Planning agent READS `/memories/issues.md` before creating spec
2. Planning agent avoids approaches that caused past issues
3. AI Review WRITES to `/memories/issues.md` when fixing issues
4. Human Review WRITES to `/memories/human_feedback.md` on rejection
5. Future tasks in same project benefit from accumulated learnings

---

## IPC Handler Reference

| Handler | File | Purpose |
|---------|------|---------|
| `TASK_CREATE` | `crud-handlers.ts` | Creates task, starts planning agent |
| `TASK_START` | `execution-handlers.ts` | Resume planning OR coding (based on status) |
| `TASK_STOP` | `execution-handlers.ts` | Kill current agent |
| `TASK_START_BUILD` | `execution-handlers.ts` | **Manual gate:** planning → coding |
| `TASK_UPDATE_STATUS` | `execution-handlers.ts` | Kanban drag (status only, NO agent) |
| `TASK_REVIEW` | `execution-handlers.ts` | Approve/reject from human review |
| `TASK_RECOVER_STUCK` | `execution-handlers.ts` | Recovery for stuck tasks |

---

## Agent Method Reference

| Method | File | Script | Purpose |
|--------|------|--------|---------|
| `startPlanningAgent()` | `agent-manager.ts` | `spec_runner.py --no-build` | Planning phase |
| `startTaskExecution()` | `agent-manager.ts` | Ralph Loop ✅ | Coding phase |
| `startQAProcess()` | `agent-manager.ts` | `run.py --qa` | AI Review phase |

---

## Related Documents

- [TASK_PHASE_FLOW.md](TASK_PHASE_FLOW.md) - Code-level phase flow details
- [FULL_ARCHITECTURE.md](FULL_ARCHITECTURE.md) - Complete system architecture
- [RALPH_IMPLEMENTATION_GUIDE.md](../plans/RALPH_IMPLEMENTATION_GUIDE.md) - Ralph spec format

---

**Document Version:** 1.1
**Last Updated:** 2026-02-04
