# Task Lifecycle Audit — Actual vs Documented Behavior

**Audit Date:** 2026-02-08
**Methodology:** Line-by-line code tracing across 5 subsystems
**Scope:** Task creation → spec pipeline → build execution → QA validation → merge/cleanup

---

## Executive Summary

Traced the actual code paths of the complete task lifecycle and found **30+ bugs, disconnects, and dead code paths**. The most critical issues:

1. **SIMPLE fast-track crashes** — calls undefined method `_generate_ralph_prompt_file()`
2. **Stuck subtasks retried forever** — `get_next_subtask()` doesn't check attempt_history
3. **QA fixer always succeeds** — returns "fixed" regardless of outcome
4. **Worktrees never deleted** — `keep_worktree=True` hardcoded in all merge paths
5. **Silent failure loops** — `in_progress` reset swallows write errors

---

## 1. Task Creation & Queuing

### Actual Flow
```
User clicks "Create Task" (TaskCreationWizard / QuickTaskDialog)
  → createTask() in task-store.ts
  → IPC: TASK_CREATE (ipcRenderer.invoke)
  → crud-handlers.ts:47 (serialized via taskCreateLock)
    ├── Generate/validate title (AI if empty)
    ├── Generate unique specId (001-slug, 002-slug...)
    ├── Create spec directory on disk
    ├── Write implementation_plan.json (empty phases)
    ├── Write task_metadata.json
    ├── Write requirements.json
    ├── Process attached images
    ├── Create task monitor terminal
    ├── Start file watcher (chokidar on spec dir)
    └── Spawn planning agent (spec_runner.py)
```

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| T1 | HIGH | Agent startup failures silent — no error event if auth/git checks fail | crud-handlers.ts:313-324 |
| T2 | MEDIUM | File watcher may miss initial plan state (empty phases, ignoreInitial: true) | file-watcher.ts:37 |
| T3 | MEDIUM | Multiple tasks spawn parallel agents (no queuing mechanism) | agent-manager.ts |
| T4 | LOW | processType stays 'planning', doesn't transition when phases change | agent-process.ts:546 |
| T5 | LOW | Metadata passed to Python but not validated on arrival | agent-manager.ts:344-383 |

---

## 2. Spec Creation Pipeline

### Documented vs Actual Phase Counts

| Complexity | Documented Phases | Actual Phases | Difference |
|------------|-------------------|---------------|------------|
| SIMPLE | 3 | 8 | +5 (discovery, requirements, complexity_assessment, ralph_prompt undocumented) |
| STANDARD | 6-7 | 10 | +3 (discovery, requirements, complexity_assessment forced before phases_to_run) |
| COMPLEX | 8 | 11 | +3 (same forced phases + ralph_prompt) |

### Actual Phase Pipeline (all complexities)

```
[FORCED] discovery                    ← Always runs first (orchestrator.py:376)
[FORCED] requirements                 ← Always runs second (orchestrator.py:390)
[FORCED] complexity_assessment        ← Always runs third (orchestrator.py:423)
[DYNAMIC] ...remaining from phases_to_run()  ← Filtered (skips discovery + requirements)
[FINAL] ralph_prompt_generation       ← Only in main flow (orchestrator.py:505-521)
```

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| S1 | CRITICAL | `_generate_ralph_prompt_file()` undefined — SIMPLE fast-track crashes with AttributeError | orchestrator.py:371 |
| S2 | HIGH | Historical context phase skipped in fast-track (line 358 omits it from phases_to_run) | orchestrator.py:352-358 |
| S3 | HIGH | Research phase returns `success=True` after 3 failures (masks downstream issues) | requirements_phases.py:240-244 |
| S4 | LOW | `requirements_context` loaded but never used in complexity assessment | orchestrator.py:585 |
| S5 | MEDIUM | Orphan folder cleanup window hardcoded to 10 minutes | orchestrator.py:368 |
| S6 | MEDIUM | No validation that discovery/requirements files have actual content | orchestrator.py:376-400 |

---

## 3. Build Execution

### Documented Flow
1. Plan creation (if first run)
2. Subtask processing (1 per iteration)
3. QA validation

### Actual Flow
1. Plan creation OR **silent reuse** if `implementation_plan.json` exists with subtasks
2. **Batch** subtask processing (up to **8 per session** via "ralph loop")
3. Post-session critical path: reset in_progress → record commits → async enrichment
4. Stuck detection and marking (attempt_history.json, not plan)
5. Auto-continue or wait for user interrupt
6. Loop until build complete OR no subtasks found (can exit silently)

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| B1 | HIGH | Planning skipped silently if `implementation_plan.json` exists with any subtasks | coder.py:171-188 |
| B2 | CRITICAL | `in_progress` reset can fail silently (write_json_atomic exception swallowed) → infinite loop | session.py:277-286 |
| B3 | CRITICAL | Stuck subtasks get retried — `get_next_subtask()` returns status != "completed" including "failed" | core/progress.py |
| B4 | HIGH | Post-session processing doesn't match batch — recovery hints keyed by first subtask only | coder.py:667-725 |
| B5 | MEDIUM | No atomicity across phase transition — plan may not be flushed when next iteration reads | coder.py:449-495 |
| B6 | LOW | Sync uses `shutil.copy2` (may be partial) vs tool's `write_json_atomic` | agents/utils.py vs subtask.py |
| B7 | MEDIUM | No inter-process locking on `implementation_plan.json` | N/A (missing) |
| B8 | MEDIUM | No subtask dependency enforcement — batch grabs any pending regardless of order | core/progress.py |
| B9 | MEDIUM | Session error retries same subtask with same prompt — deterministic failures loop forever | coder.py:820-832 |
| B10 | LOW | Model selection per phase only applies to first subtask in batch | coder.py:380-399 |

### Undocumented Features
- **Ralph loop batching**: Up to 8 subtasks per agent session, not mentioned in architecture docs
- **Background enrichment**: Async task after session, non-blocking but can race with next session
- **Plan reuse on resumption**: Stale plans silently reused without validation against current spec

---

## 4. QA Validation Loop

### Actual Flow
```
Pre-flight: is_build_complete() + is_qa_approved()
  ↓
If QA_FIX_REQUEST.md exists → run fixer first (human feedback path)
  ↓
Main Loop (max 50 iterations, adaptive by complexity):
  ├── Run reviewer session → approved/rejected/error
  ├── If approved → return True
  ├── If rejected:
  │   ├── Check for recurring issues (SequenceMatcher, threshold=0.8)
  │   ├── If recurring → escalate_to_human() → return False
  │   ├── Iterations 1-2: run separate fixer
  │   └── Iterations 3+: combined review-and-fix prompt
  └── If error:
      ├── consecutive_errors += 1
      └── If >= 3 → escalate → return False
```

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| Q1 | CRITICAL | `QA_FIX_REQUEST.md` creation is entirely agent-driven (shell commands in prompt), not Python — fixer crashes if file missing | fixer.py:106-109, qa_reviewer.md:440 |
| Q2 | HIGH | Fixer always returns `("fixed", response_text)` regardless of `ready_for_qa_revalidation` flag | fixer.py:304-367 |
| Q3 | HIGH | `ready_for_qa_revalidation` flag never set by any code (fixer doesn't set "fixes_applied" status) | qa.py:56 |
| Q4 | MEDIUM | `is_fixes_applied()` is dead code — never called in loop | criteria.py:70-77 |
| Q5 | MEDIUM | `fixes_applied` status defined but never transitioned to | qa.py:108 |
| Q6 | LOW | Documentation claims "cosine similarity" but code uses `SequenceMatcher.ratio()` | report.py |
| Q7 | MEDIUM | Max iterations exit creates no escalation file (recurring issues do create QA_ESCALATION.md) | loop.py:596-663 |

### Dead Code Inventory
- `is_fixes_applied()` in criteria.py — never called
- `"fixes_applied"` status value in qa.py — never set
- `ready_for_qa_revalidation` field — always False

---

## 5. Post-Build: Merge & Cleanup

### Actual Flow
```
Smart merge attempt:
  ├── Detect divergence (git merge-base comparison)
  ├── Categorize files: simple copy / 3-way auto-merge / AI merge / path-mapped
  ├── Lock file exclusion
  └── MergeLock prevents concurrent merges

If smart merge succeeds:
  ├── Changes written and staged
  └── Worktree kept (ALWAYS — keep_worktree=True hardcoded)

If smart merge fails:
  └── Fall back to standard git merge (also keeps worktree)

Stash/pop flow:
  ├── Stash uncommitted changes before merge
  ├── Do merge
  └── Pop stash (WARNING ONLY if fails)

Rebase flow (for diverged branches):
  ├── Rebase spec branch onto main
  ├── If fails: abort rebase
  └── Finally: restore original branch (WARNING ONLY if fails)
```

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| M1 | HIGH | Merge NEVER deletes worktree — `keep_worktree=True` in all paths, orphaned worktrees accumulate | workspace.py:265-272, 281-283, 323-325 |
| M2 | CRITICAL | Stash pop failure just prints warning — user's uncommitted changes stuck in stash | worktree.py:622-646 |
| M3 | HIGH | Rebase failure + branch restore failure leaves repo on wrong branch in inconsistent state | workspace.py:856-865 |
| M4 | HIGH | Frontend `mergeWorktree()` never passes `delete_after` parameter | Worktrees.tsx:218 |
| M5 | MEDIUM | Partial merge (some files skipped) marks entire merge as failed in direct copy path | workspace.py:688-700 |
| M6 | MEDIUM | No timeout on merge operations (push has 120s, PR has 60s, merge has none) | worktree.py |
| M7 | MEDIUM | CLI finalization flow not called from UI builds — different merge behaviors | finalization.py |
| M8 | LOW | Lock file handling asymmetry between preview and actual merge paths | workspace.py:1266-1277 |

---

## 6. Chat / Multi-Agent System

### Architecture

A single chat UI (`TaskMonitorChat.tsx`) routes messages to three different agent types depending on task state:

| Agent | When | Process Key | Mode | Tools |
|-------|------|-------------|------|-------|
| Companion | Between phases (auto-spawns 1.5s after coder exits) | `{taskId}` | Read-only | Read, Glob, Grep, get_build_progress |
| Supervisor | During active builds (alongside coder) | `supervisor-{taskId}` | Read-only | Read, Glob, Grep, get_build_progress |
| Direct stdin | Fallback when no companion/supervisor | `{taskId}` | Full access | (whatever the running agent has) |

### Message Routing (TaskMonitorChat.tsx:1004-1029)

```
User types in chat
  → hasSupervisor?   → sendMessageToSupervisor(taskId, message)
  → isTaskRunning?   → sendMessageToTask(taskId, message)
  → else             → stored locally (waiting for agent)
```

### Companion Agent

**Backend:** `CompanionAgent` class in `agents/companion_agent.py`, spawned via `runners/companion_runner.py`

**Lifecycle:**
1. Coder exits with code 0
2. `AgentManager` waits 1.5s, then calls `startCompanion(taskId)`
3. Spawns `python companion_runner.py --spec-dir ... --current-phase coding_complete`
4. Agent prints `__COMPANION_READY__` on stdout
5. Enters message loop: await user message → send to Claude SDK → stream response via `__SDK_MSG__` markers
6. When next execution starts (planning/coding/QA), companion is killed via `stopCompanion(taskId)`

**System prompt** includes: spec.md, implementation_plan.json summary, qa_report.md, task_metadata.json, ralph_prompt.md, context.json

### Supervisor Agent

Same `CompanionAgent` class with `--supervisor-mode` flag. Changes the system prompt to:
- "You are a live supervisor agent monitoring an active coding session"
- Focus on `get_build_progress` tool for real-time status
- Brief, direct answers about what the coder is working on

Uses `supervisor-{taskId}` as the process Map key, so it coexists with the coder on `{taskId}`.

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| C1 | HIGH | Companion shares process key with coder — killed when build starts, no chat during builds without supervisor (Bug #12) | agent-manager.ts:301-302, 413-414 |
| C2 | MEDIUM | No conversation persistence — each `create_agent_session()` is a fresh session, no multi-turn memory | companion_agent.py:313 |
| C3 | LOW | `getCompanionPhase()` defaults to `'coding_complete'` regardless of actual task state | agent-manager.ts:823 |
| C4 | MEDIUM | Auto-spawn race condition — 1.5s delay + context cleanup race, timing fragile | agent-manager.ts:122-151 |
| C5 | LOW | Supervisor implementation exists in code but plan file indicates it may not be fully wired/tested | agent-manager.ts:889+ |

---

## 7. Insights Agent (Main Chat + Task Creation)

### Architecture

The Insights agent is the primary user-facing chat — separate from the companion/supervisor build agents. Users open it from the sidebar to ask codebase questions and create tasks.

### Message Flow

```
User types in Insights panel (Insights.tsx)
  → insights-store.ts: sendMessage()
  → IPC: INSIGHTS_SEND_MESSAGE
  → insights-handlers.ts: loads project + model config
  → insights-service.ts: sendMessage()
    ├── Loads/creates session (.auto-claude/.insights/{session-id}.json)
    ├── Writes conversation history to temp file
    └── Spawns Python process
  → insights_runner.py (run_with_sdk):
    ├── Builds system prompt (project_index, roadmap, existing task IDs)
    ├── Creates ClaudeSDKClient with read-only tools
    ├── Streams response to stdout
    └── Outputs __TASK_SUGGESTION__:{json} markers for task creation
  → insights-executor.ts: parses stdout markers
  → IPC: INSIGHTS_STREAM_CHUNK → renderer updates in real-time
```

### Task Creation: Two-Step Suggest → Approve

The agent **cannot create tasks directly**. It suggests them; the user confirms.

1. **Agent suggests**: Outputs `__TASK_SUGGESTION__:{"title": "...", "description": "...", "metadata": {...}}` in response
2. **UI renders**: Card with title, description, complexity badges, "Add to Queue" button
3. **User clicks "Add to Queue"**: Task added to `InsightsTaskQueueStore`, persisted to session JSON
4. **User clicks "Start" in queue sidebar**: `createTaskFromInsights()` IPC handler creates spec directory, writes `implementation_plan.json` + `task_metadata.json` (with `sourceType: "insights"`), task appears in main task list

### Tools & Configuration

| Setting | Value |
|---------|-------|
| Tools | Read, Glob, Grep, WebFetch, WebSearch |
| Blocked | Write, Edit, Bash, Task (no file modification, no subagents) |
| MCP Servers | None |
| Model | Configurable per-session (default: sonnet) |
| Thinking | Configurable: none/low/medium/high/ultrathink (default: medium) |
| Max turns | 15 |
| Sessions | Persisted to `.auto-claude/.insights/{session-id}.json` |

### System Prompt Context

The insights runner builds context from (insights_runner.py:148-175):
- Project index (`.auto-claude/project_index.json`)
- Roadmap features
- Existing tasks with IDs (for dependency linking in suggestions)
- Task suggestion format instructions

### Streaming Markers

| Marker | Purpose |
|--------|---------|
| `__TASK_SUGGESTION__:{json}` | Task creation suggestion |
| `__TOOL_START__:{json}` | Tool execution started |
| `__TOOL_END__:{json}` | Tool execution finished |
| Plain text | Normal response content |

### Insights vs Companion vs Supervisor

| Feature | Insights | Companion | Supervisor |
|---------|----------|-----------|------------|
| When | User-initiated anytime | Between build phases | During active builds |
| Task creation | Yes (suggestions) | No | No |
| Web tools | WebFetch, WebSearch | No | No |
| Model | Configurable | COMPANION_CONFIG | COMPANION_CONFIG |
| Memory | Multi-session persistent | Ephemeral | Ephemeral |
| Max turns | 15 | 25 | 25 |
| Process key | Separate process | `{taskId}` | `supervisor-{taskId}` |

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| I1 | LOW | History temp file cleanup only on `close` event, not guaranteed on crash | insights-executor.ts:227-237 |
| I2 | LOW | Multiple task suggestions in one response — only last one persists on message (but service handles array correctly) | insights-executor.ts:133-154 |
| I3 | LOW | Thinking level not validated — invalid values silently default to "medium" | insights_runner.py:220 |

---

## 8. Task End-of-Life (Merge → Done → Archive)

### Intended Flow

The user is in `human_review` status. The designed path is:

```
human_review → [user clicks Merge] → worktree deleted, changes in main branch
             → [user clicks Mark as Done] → status='done' in implementation_plan.json
             → [user manually archives] → archivedAt set in task_metadata.json
             → task filtered from default view (spec files remain forever)
```

### Merge Phase (TaskDetailModal.tsx:182)

User clicks "Merge" → `window.electronAPI.mergeWorktree(task.id)` → `worktree-handlers.ts`

**Full merge** (not stage-only):
1. Smart merge: detect divergence, categorize files, 3-way merge → AI merge for conflicts
2. **Auto-deletes worktree**: `git worktree remove --force`
3. **Auto-deletes branch**: `git branch -D auto-claude/{specId}`
4. Returns `{ merged: true }` → UI shows green success card with "Mark as Done" button

**Stage-only merge** (`stageOnly: true`):
1. Changes staged in main project but NOT committed
2. Worktree NOT deleted (user still has it)
3. UI shows staged success message with suggested commit message

### Mark as Done (TaskDetailModal.tsx:243)

User clicks "Mark as Done" → `persistTaskStatus(task.id, 'done')` → `task-store.ts:947`

**Frontend** (`task-store.ts:947-995`):
1. Calls `window.electronAPI.updateTaskStatus(taskId, 'done')`
2. On success: updates local Zustand state via `store.updateTaskStatus(taskId, 'done')`
3. Removes task from insights queue if it was sourced from insights agent

**Backend** (`execution-handlers.ts:964-1138`):
1. **Worktree check** (line 982): Looks for worktree. After full merge, worktree is already deleted → falls through as "limbo state recovery" (line 1055-1058)
2. **Transition validation** (line 1094): Validates `human_review → done` against state machine. Valid.
3. **Persist to plan file** (line 1119): `persistPlanStatus(planPath, 'done')` → writes `"status": "done"` to `implementation_plan.json`
4. **Auto-stop agents** (line 1130): If any agent still running for this task, kills it

### Archive (project-store.ts:773-830)

Manual action. User clicks archive in task list.

1. Writes `archivedAt` timestamp + optional `archivedInVersion` to `task_metadata.json` in ALL spec locations (main + worktrees)
2. Tasks filtered from default view but files remain on disk
3. Can be unarchived: removes `archivedAt`/`archivedInVersion` from metadata

### State Machine (execution-handlers.ts:1094-1102)

```
'planning':      → [coding, done, archived]
'coding':        → [planning, ai_review, human_review, done, archived]
'ai_review':     → [coding, human_review, done, archived]
'human_review':  → [planning, coding, done, pr_created, archived]
'pr_created':    → [done, archived]
'done':          → [archived]
'archived':      → [planning]
```

**Note**: `planning → human_review` removed (was previously allowed). Kanban drag-between-columns removed from UI, so most transitions in the state machine are unreachable from the frontend — only the designed flow triggers them.

### PR Creation Path (alternative to direct merge)

1. User clicks "Create PR" in `WorkspaceStatus.tsx:459` → `CreatePRDialog`
2. Spawns `python run.py --create-pr` (2-min timeout) → pushes branch, `gh pr create`
3. Status → `pr_created`, PR URL stored in `task_metadata.json`
4. User later marks as done (worktree may or may not still exist)

### Graphiti Memory Pipeline (per-subtask, NOT on "done" click)

Runs async during build phase, triggered per completed subtask (`session.py:231`):

1. `_background_enrichment()` fires as `asyncio.create_task()` (non-blocking)
2. **Insight extraction**: Claude Haiku analyzes git diff, changed files, commit messages → structured insights
3. **Graphiti save**: 4 episode types — `CODEBASE_DISCOVERY`, `PATTERN`, `GOTCHA`, `TASK_OUTCOME`
4. **Project memory promotion**: Patterns/gotchas appended to `.auto-claude/project_memory.md`
5. **Fallback**: If Graphiti disabled → `spec_dir/memory/session_insights/session_NNN.json`
6. **Next task**: Agents retrieve learned patterns/gotchas via semantic search

### What Does NOT Happen on "Done"

| Expected? | Action | Actually Happens |
|-----------|--------|-----------------|
| - | Spec directory cleanup | Never. Persists forever. No GC mechanism. |
| - | Linear notification | Fires during build exit (`session.py`), NOT on "done" click |
| - | Graphiti memory update | Fires per-subtask during build, NOT on "done" click |
| - | Automatic archiving | Never. Manual only. |
| - | PR creation | Separate manual action, not part of "done" flow |

### Bugs Found

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| D1 | MEDIUM | Spec directories never cleaned up — accumulate forever, no GC mechanism | entire codebase |
| D2 | MEDIUM | Backend state machine allows transitions UI can't trigger (e.g. `planning → done`) — dead validation code | execution-handlers.ts:1094-1102 |
| D3 | MEDIUM | Stage-only merge leaves worktree alive — user can forget about it, blocks future "done" | worktree-handlers.ts:2148 |
| D4 | MEDIUM | No status check before PR creation — can create PR from any status where worktree exists | worktree-handlers.ts:2934 |
| D5 | LOW | PR timeout doesn't verify PR wasn't created — "timed out" but PR may exist on GitHub | worktree-handlers.ts:3023 |
| D6 | LOW | Branch name fallback uses `auto-claude/{specId}` pattern that may not match actual branch | execution-handlers.ts:1002 |
| D7 | HIGH | PR creation impossible after "done" — worktree already deleted, can't push | WorkspaceStatus.tsx:460 |
| D8 | LOW | Linear fires on build exit, not "done" — no notification for manual status changes | session.py |

---

## Priority Fix Recommendations

### P0 — Fix Immediately (crashes / data loss)
1. **S1**: Define `_generate_ralph_prompt_file()` or remove the call in fast-track path
2. **B2**: Propagate `write_json_atomic` failures instead of swallowing them in session.py
3. **M2**: On stash pop failure, auto-restore or clearly communicate recovery steps
4. **Q1**: Create `QA_FIX_REQUEST.md` in Python code, not rely on agent prompt

### P1 — Fix Soon (silent failures / infinite loops)
5. **B3**: Make `get_next_subtask()` skip "failed" subtasks that are marked stuck in attempt_history
6. **S3**: Return `success=False` from research phase when all retries fail
7. **M1/M4**: Pass `delete_after=True` from frontend and honor it in merge
8. **M3**: On rebase failure, ensure repo is restored to original branch before returning

### P2 — Fix When Possible (dead code / doc mismatches)
9. **Q2-Q5**: Remove dead `fixes_applied` / `is_fixes_applied` / `ready_for_qa_revalidation` code
10. **B1**: Add plan staleness check before reusing existing implementation_plan.json
11. **Q6**: Fix docs to say "SequenceMatcher similarity" not "cosine similarity"
12. **Update phase count docs**: SIMPLE=8, STANDARD=10, COMPLEX=11

### P3 — Architecture Improvements
13. Add inter-process locking for `implementation_plan.json`
14. Add subtask dependency enforcement in `get_next_subtask()`
15. Add merge timeout
16. Unify CLI and UI merge behavior
17. Document ralph loop batching (up to 8 subtasks per session)
18. **D1**: Add spec directory GC — cleanup old/archived spec dirs (at least on explicit delete)
19. **D2**: Prune state machine to only transitions the UI can actually trigger
20. **D3**: Warn user or auto-cleanup stale stage-only worktrees
21. **D4**: Add status validation before PR creation (`human_review` or `pr_created` only)

---

## Appendix: Key File References

| Area | File | Size | Purpose |
|------|------|------|---------|
| Spec Pipeline | `apps/backend/spec/pipeline/orchestrator.py` | ~600 lines | Phase orchestration |
| Spec Pipeline | `apps/backend/spec/complexity.py` | ~400 lines | Complexity assessment + phase lists |
| Spec Pipeline | `apps/backend/spec/phases/requirements_phases.py` | ~250 lines | Research/requirements phases |
| Build | `apps/backend/agents/coder.py` | 43.6 KB | Main coder agent + ralph loop |
| Build | `apps/backend/agents/session.py` | 27.8 KB | Session management + post-processing |
| Build | `apps/backend/core/progress.py` | ~200 lines | get_next_subtask, is_build_complete |
| QA | `apps/backend/qa/loop.py` | 663 lines | QA loop orchestration |
| QA | `apps/backend/qa/reviewer.py` | 469 lines | QA reviewer session |
| QA | `apps/backend/qa/fixer.py` | 378 lines | QA fixer session |
| QA | `apps/backend/qa/criteria.py` | 190 lines | Status checks (has dead code) |
| QA | `apps/backend/qa/report.py` | 671 lines | Issue tracking + similarity |
| Merge | `apps/backend/core/workspace.py` | 1500+ lines | Smart merge + AI merge |
| Merge | `apps/backend/core/worktree.py` | ~1000 lines | Git worktree management |
| Insights | `apps/backend/runners/insights_runner.py` | ~450 lines | Main chat Python runner |
| Insights | `apps/frontend/src/main/insights-service.ts` | ~243 lines | Session management + orchestration |
| Insights | `apps/frontend/src/main/insights/insights-executor.ts` | ~332 lines | Python process spawner + stdout parser |
| Insights | `apps/frontend/src/main/ipc-handlers/insights-handlers.ts` | ~489 lines | IPC handlers (send, create task, sessions) |
| Insights | `apps/frontend/src/renderer/stores/insights-store.ts` | ~545 lines | UI state + message streaming |
| Chat | `apps/backend/agents/companion_agent.py` | 396 lines | Companion + supervisor agent |
| Chat | `apps/backend/runners/companion_runner.py` | 223 lines | CLI entry point for companion |
| Chat | `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx` | ~1460 lines | Chat UI + message routing |
| IPC | `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts` | ~330 lines | TASK_CREATE handler |
| IPC | `apps/frontend/src/main/agent/agent-manager.ts` | ~500 lines | Agent spawn/lifecycle |
| IPC | `apps/frontend/src/main/agent/agent-process.ts` | ~700 lines | Process spawn + output streaming |
| Watch | `apps/frontend/src/main/file-watcher.ts` | 128 lines | chokidar plan watcher |
| End-of-Life | `apps/frontend/src/renderer/components/task-detail/TaskDetailModal.tsx` | ~700 lines | Merge/Done/PR UI orchestration |
| End-of-Life | `apps/frontend/src/renderer/components/task-detail/TaskReview.tsx` | ~200 lines | Workspace status + Mark as Done button |
| End-of-Life | `apps/frontend/src/renderer/components/task-detail/task-review/WorkspaceMessages.tsx` | ~300 lines | Post-merge cleanup options |
| End-of-Life | `apps/frontend/src/renderer/stores/task-store.ts` | ~1200 lines | persistTaskStatus, forceCompleteTask |
| End-of-Life | `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` | ~1150 lines | TASK_UPDATE_STATUS + state machine |
| End-of-Life | `apps/frontend/src/main/project-store.ts` | ~900 lines | archiveTasks, unarchiveTasks |
| End-of-Life | `apps/frontend/src/main/ipc-handlers/task/archive-handlers.ts` | 55 lines | TASK_ARCHIVE/TASK_UNARCHIVE IPC |
| End-of-Life | `apps/frontend/src/main/ipc-handlers/task/worktree-handlers.ts` | ~3200 lines | Merge, PR creation, discard |
| Memory | `apps/backend/agents/session.py` | 27.8 KB | post_session_processing + background enrichment |
| Memory | `apps/backend/analysis/insight_extractor.py` | ~400 lines | Claude Haiku insight extraction |
| Memory | `apps/backend/agents/memory_manager.py` | ~450 lines | Graphiti + file-based memory save |
| Memory | `apps/backend/integrations/graphiti/queries_pkg/queries.py` | ~300 lines | Graphiti episode storage |
