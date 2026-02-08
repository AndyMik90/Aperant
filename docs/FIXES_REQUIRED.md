# AC.Jerry — Required Fixes

**Generated:** 2026-02-08
**Source:** Full code audit of task lifecycle (8 subsystems, 50+ files traced)
**Reference:** `docs/TASK_LIFECYCLE_AUDIT.md`, `docs/ARCHITECTURE_AUDIT.md`

Every item below is a confirmed deviation from the intended architecture, verified by reading the actual source code line-by-line.

---

## How to Read This Document

Each fix has:
- **What should happen** — the intended architectural behavior
- **What actually happens** — the bug or deviation
- **Where** — exact file(s) and line numbers
- **Fix** — concrete action to take
- **Priority** — P0 (crash/data loss), P1 (silent failure/loop), P2 (dead code/wrong docs), P3 (architecture debt)

---

## P0 — Crashes and Data Loss (fix immediately)

### FIX-001: SIMPLE fast-track calls undefined method

**What should happen:** SIMPLE tasks go through a fast-track path that generates a ralph prompt file.
**What actually happens:** `_generate_ralph_prompt_file()` is called but never defined. SIMPLE fast-track crashes with `AttributeError`.
**Where:** `apps/backend/spec/pipeline/orchestrator.py:371`
**Fix:** Either define the method or replace the call with the existing `ralph_prompt_generation` phase that the normal flow uses.

---

### FIX-002: in_progress reset swallows write errors → infinite retry loop

**What should happen:** After a session ends, all `in_progress` subtasks are reset to `pending` so the next session can pick them up.
**What actually happens:** `write_json_atomic` exceptions are caught and swallowed. If the write fails, subtasks stay `in_progress` forever. `get_next_subtask()` skips them (looking for `pending`), but the recovery logic resets them again — creating an infinite loop that burns API credits.
**Where:** `apps/backend/agents/session.py:277-286`
**Fix:** Propagate `write_json_atomic` failures. If reset fails, halt the auto-continue loop and surface the error to the user.

---

### FIX-003: Stash pop failure silently loses user's uncommitted changes

**What should happen:** Before merge, uncommitted changes are stashed. After merge, they're popped back.
**What actually happens:** If `git stash pop` fails, it just prints a warning to the log. The user's changes remain stuck in the stash with no notification. They might not realize their work is missing until much later.
**Where:** `apps/backend/core/worktree.py:622-646`
**Fix:** On stash pop failure: (1) auto-run `git stash show` to get the stash contents, (2) return an explicit error to the frontend with recovery instructions ("run `git stash pop` manually"), (3) do NOT mark the merge as successful.

---

### FIX-004: QA_FIX_REQUEST.md created by agent prompt, not Python code

**What should happen:** When QA finds issues, a structured `QA_FIX_REQUEST.md` file is created so the fixer agent knows what to fix.
**What actually happens:** The file is only created via shell commands embedded in the QA reviewer's system prompt. If the agent doesn't execute those commands (model error, tool failure, etc.), the file doesn't exist. The fixer then crashes at `fixer.py:106-109` trying to read it.
**Where:** `apps/backend/qa/fixer.py:106-109`, reviewer prompt at `qa_reviewer.md:440`
**Fix:** Create `QA_FIX_REQUEST.md` in Python code after the reviewer session returns rejection details. The reviewer's response already contains the issues — write them to the file deterministically.

---

## P1 — Silent Failures and Infinite Loops (fix soon)

### FIX-005: Stuck subtasks retried forever

**What should happen:** Subtasks that fail repeatedly should be marked as stuck and skipped.
**What actually happens:** `get_next_subtask()` returns the first subtask with `status != "completed"` — this includes `"failed"` subtasks. The stuck detection writes to `attempt_history.json`, but `get_next_subtask()` never checks it. Result: stuck subtasks are retried indefinitely.
**Where:** `apps/backend/core/progress.py` (get_next_subtask function)
**Fix:** `get_next_subtask()` should check `attempt_history.json` and skip subtasks that have exceeded max attempts (currently 3). Return `None` or the next non-stuck subtask instead.

---

### FIX-006: Research phase masks failures as success

**What should happen:** If the research phase fails after all retries, the pipeline should know and potentially skip dependent phases or re-attempt.
**What actually happens:** After 3 failed research attempts, returns `success=True` with empty/partial results. Downstream phases (context, spec_writing) proceed with incomplete data, producing low-quality specs.
**Where:** `apps/backend/spec/phases/requirements_phases.py:240-244`
**Fix:** Return `success=False` when all retries are exhausted. Let the orchestrator decide whether to proceed without research or halt.

---

### FIX-007: Rebase failure can leave repo on wrong branch

**What should happen:** If rebase fails, the repo should be restored to its original state (original branch, no partial rebase).
**What actually happens:** Rebase failure triggers `git rebase --abort`, then attempts to restore the original branch. If the branch restore ALSO fails, it just logs a warning. The repo is now on an unknown branch in an inconsistent state.
**Where:** `apps/backend/core/workspace.py:856-865`
**Fix:** If branch restore fails after rebase abort: (1) detect which branch we're on, (2) attempt `git checkout <original_branch>` explicitly, (3) if that also fails, return a hard error with the exact repo state so the user can recover manually.

---

### FIX-008: Agent startup failures are silent

**What should happen:** When a planning agent fails to start (auth failure, git check failure, Python not found), the user should see an error in the UI.
**What actually happens:** The agent process exits with a non-zero code, but no error event is emitted to the frontend. The task appears to be "processing" but nothing happens. User has to check logs to discover the failure.
**Where:** `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts:313-324`
**Fix:** Listen for the agent process `exit` event with non-zero code. Emit a `TASK_ERROR` event to the renderer with the stderr output. Update the task status to indicate failure.

---

### FIX-009: QA fixer always reports success

**What should happen:** The fixer agent should report whether it actually fixed the issues or not, so the QA loop can decide whether to re-review or escalate.
**What actually happens:** `fixer.py` returns `("fixed", response_text)` unconditionally at the end of every fixer session, regardless of what the agent actually did. The `ready_for_qa_revalidation` flag exists but is never set.
**Where:** `apps/backend/qa/fixer.py:304-367`
**Fix:** Parse the fixer agent's response for success/failure indicators. At minimum, check if any files were actually modified (git diff). Return `"fixed"` only if changes were made, otherwise return `"failed"`.

---

### FIX-010: Planning silently skipped on resume

**What should happen:** When a build resumes, it should verify the existing plan is still valid against the current spec before proceeding.
**What actually happens:** If `implementation_plan.json` exists and has subtasks, planning is skipped entirely (`coder.py:171-188`). The plan could be stale (spec was updated, complexity changed, user edited requirements) but it's reused without validation.
**Where:** `apps/backend/agents/coder.py:171-188`
**Fix:** Add a staleness check: compare plan's `spec_hash` or `updated_at` against the current spec. If the spec is newer than the plan, re-run planning. At minimum, log a warning when reusing an existing plan.

---

### FIX-011: Session error retries same subtask with identical prompt

**What should happen:** If a subtask fails, the retry should include context about what went wrong so the agent can try a different approach.
**What actually happens:** On session error, the same subtask is retried with the exact same prompt. If the failure is deterministic (e.g., impossible subtask, missing dependency), it loops forever.
**Where:** `apps/backend/agents/coder.py:820-832`
**Fix:** Include the error message from the previous attempt in the retry prompt. After 2 identical failures, mark the subtask as stuck and move on.

---

### FIX-012: Historical context skipped in SIMPLE fast-track

**What should happen:** All tasks should benefit from historical context (past task patterns, known gotchas) to improve spec quality.
**What actually happens:** The SIMPLE fast-track path at `orchestrator.py:352-358` omits the `historical_context` phase. SIMPLE tasks miss learned patterns from previous tasks.
**Where:** `apps/backend/spec/pipeline/orchestrator.py:352-358`
**Fix:** Add `historical_context` to the SIMPLE fast-track phase list. It's a lightweight phase that significantly improves spec quality.

---

## P2 — Dead Code, Wrong Docs, Broken Invariants (fix when possible)

### FIX-013: QA dead code — 3 unused constructs

**What should happen:** The QA system should use the `fixes_applied` status to track whether the fixer actually applied changes before re-reviewing.
**What actually happens:** Three related constructs are defined but never used:
1. `ready_for_qa_revalidation` flag — always `False`, never set
2. `"fixes_applied"` status value — defined in `qa.py:108`, never transitioned to
3. `is_fixes_applied()` function — defined in `criteria.py:70-77`, never called

**Where:** `apps/backend/qa/criteria.py:70-77`, `apps/backend/qa/fixer.py`, `apps/backend/qa/qa.py:56,108`
**Fix:** Either implement the intended flow (fixer sets `fixes_applied` → QA loop checks `is_fixes_applied()` before re-reviewing) or remove the dead code entirely. Given FIX-009, implementing it properly makes more sense.

---

### FIX-014: Documentation claims wrong phase counts

**What should happen:** Documentation should accurately reflect the number of phases in each complexity pipeline.
**What actually happens:**

| Complexity | Docs Say | Actual |
|------------|----------|--------|
| SIMPLE     | 3        | 8      |
| STANDARD   | 6-7      | 10     |
| COMPLEX    | 8        | 11     |

The difference is because docs don't count the 3 forced phases (discovery, requirements, complexity_assessment) or the final ralph_prompt phase.
**Where:** Architecture documentation (wherever phase counts are mentioned)
**Fix:** Update all phase count references to match reality: SIMPLE=8, STANDARD=10, COMPLEX=11. Document the forced phases explicitly.

---

### FIX-015: "Cosine similarity" claim is wrong

**What should happen:** Documentation should describe the actual similarity algorithm used.
**What actually happens:** Docs claim QA uses "cosine similarity" for recurring issue detection. The code actually uses Python's `SequenceMatcher.ratio()` (Ratcliff/Obershelp pattern matching).
**Where:** `apps/backend/qa/report.py`, related documentation
**Fix:** Update docs to say "SequenceMatcher similarity (threshold=0.8)" instead of "cosine similarity".

---

### FIX-016: Backend state machine has unreachable transitions

**What should happen:** The state machine should only allow transitions that can actually occur in the application.
**What actually happens:** The Kanban drag-between-columns UI was removed, but the backend still validates transitions like `planning → done`, `coding → archived`, etc. These transitions can never be triggered from the frontend. The state machine is:
```
'planning':      → [coding, done, archived]
'coding':        → [planning, ai_review, human_review, done, archived]
'ai_review':     → [coding, human_review, done, archived]
'human_review':  → [planning, coding, done, pr_created, archived]
'pr_created':    → [done, archived]
'done':          → [archived]
'archived':      → [planning]
```
The only transitions that actually happen from the UI are:
```
planning → coding (Start Build button)
coding → ai_review (automatic, build complete)
ai_review → human_review (automatic, QA approved)
human_review → done (Mark as Done button, after merge)
human_review → pr_created (Create PR button)
pr_created → done (Mark as Done button)
done → archived (Archive action)
human_review → coding (Reject in review)
```
**Where:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts:1094-1102`
**Fix:** Prune the state machine to only the transitions that are actually possible. This prevents bugs where an API caller or stale frontend code triggers an invalid transition that "works" because the backend allows it.

---

### FIX-017: requirements_context loaded but never used

**What should happen:** The requirements context gathered during the requirements phase should feed into subsequent phases.
**What actually happens:** `requirements_context` is loaded from disk at `orchestrator.py:585` but never passed to the complexity assessment or any downstream phase.
**Where:** `apps/backend/spec/pipeline/orchestrator.py:585`
**Fix:** Either pass it to the complexity assessment phase (where it would improve accuracy) or remove the dead load.

---

### FIX-018: Max QA iterations exit without escalation file

**What should happen:** When QA hits the max iteration limit, it should create an escalation file so the user understands why the task stopped.
**What actually happens:** Recurring issues create `QA_ESCALATION.md`, but hitting the max iteration limit (50) just returns `False` with no file. The user sees the task stop but doesn't know why.
**Where:** `apps/backend/qa/loop.py:596-663`
**Fix:** Create `QA_ESCALATION.md` (or similar) when max iterations are reached, listing the last reviewer findings and iteration count.

---

### FIX-019: processType stays 'planning' forever

**What should happen:** The `processType` field on agent processes should reflect the current execution phase (planning, coding, qa, etc.).
**What actually happens:** It's set to `'planning'` when the agent spawns and never updated as the task progresses through phases.
**Where:** `apps/frontend/src/main/agent/agent-process.ts:546`
**Fix:** Update `processType` when the file watcher detects phase changes in the plan file, or when the agent manager transitions between phases.

---

### FIX-020: Companion phase hardcoded to 'coding_complete'

**What should happen:** The companion agent should receive the actual current phase of the task so its system prompt is contextually accurate.
**What actually happens:** `getCompanionPhase()` in agent-manager.ts always returns `'coding_complete'` regardless of the actual task state.
**Where:** `apps/frontend/src/main/agent/agent-manager.ts:823`
**Fix:** Read the actual task status and map it to the appropriate companion phase. The companion already supports: `spec_complete`, `planning`, `coding_complete`, `qa_complete`, `human_review`.

---

## P3 — Architecture Improvements (when bandwidth allows)

### FIX-021: No inter-process locking on implementation_plan.json

**What should happen:** Only one process should write to `implementation_plan.json` at a time to prevent corruption.
**What actually happens:** The coder agent, session post-processing, QA loop, and file watcher all read/write the plan file without locks. Race conditions can corrupt the file.
**Where:** Multiple files — `coder.py`, `session.py`, `progress.py`, `file-watcher.ts`
**Fix:** Add file-level locking (e.g., `fcntl.flock` on Unix, or a `.lock` sidecar file) around all plan file writes. The `write_json_atomic` function is a good place to add this.

---

### FIX-022: No subtask dependency enforcement

**What should happen:** Subtasks with dependencies should only be picked up after their dependencies complete.
**What actually happens:** `get_next_subtask()` grabs any pending subtask regardless of ordering. The ralph loop batches up to 8 — if subtask 5 depends on subtask 3's output, they might run in the same batch with subtask 5 going first.
**Where:** `apps/backend/core/progress.py`
**Fix:** If the plan defines subtask dependencies or ordering, respect them in `get_next_subtask()`. At minimum, process subtasks in phase order.

---

### FIX-023: No merge timeout

**What should happen:** Merge operations should have a timeout to prevent hangs.
**What actually happens:** Push has a 120s timeout, PR creation has 60s, but the actual merge operation has no timeout. A complex AI merge could hang indefinitely.
**Where:** `apps/backend/core/worktree.py`, `apps/backend/core/workspace.py`
**Fix:** Add a configurable timeout (e.g., 5 minutes) to the merge operation. On timeout, abort and report to the user.

---

### FIX-024: CLI and UI merge behaviors differ

**What should happen:** Merging from CLI and UI should produce identical results.
**What actually happens:** CLI runs a finalization flow (commit, push, cleanup) that the UI skips entirely. This means CLI merges leave a cleaner state than UI merges.
**Where:** `apps/backend/finalization.py` (CLI only), `apps/frontend/src/main/ipc-handlers/task/worktree-handlers.ts` (UI)
**Fix:** Extract the finalization logic into a shared function callable from both CLI and UI paths. Or document the intentional difference if it's by design.

---

### FIX-025: Spec directories accumulate forever

**What should happen:** Spec directories for completed/archived tasks should eventually be cleaned up to prevent disk bloat.
**What actually happens:** Spec directories persist indefinitely. Even after archive, the files remain in `.auto-claude/specs/`. There is no garbage collection mechanism.
**Where:** Entire codebase (missing feature)
**Fix:** Add GC that cleans up spec directories when: (1) task is explicitly deleted via `TASK_DELETE`, or (2) task has been archived for > N days (configurable), or (3) user triggers manual cleanup.

---

### FIX-026: Stage-only merge leaves worktree alive

**What should happen:** After staging changes, the user should be clearly prompted about the worktree's continued existence and guided to either commit+cleanup or discard.
**What actually happens:** Stage-only merge stages changes in the main project but leaves the worktree intact. The user can forget about it. If they try to mark as "done" later, the backend blocks it because the worktree still exists (requiring `forceCleanup` confirmation).
**Where:** `apps/frontend/src/main/ipc-handlers/task/worktree-handlers.ts:2148`
**Fix:** After stage-only merge, show a persistent reminder that the worktree still exists. Offer "Commit & Cleanup" as the primary action, with "Keep Worktree" as secondary.

---

### FIX-027: No status validation before PR creation

**What should happen:** PR creation should only be allowed from `human_review` status (when the build is complete and reviewed).
**What actually happens:** The PR creation handler doesn't check task status. It only checks if a worktree exists. You can create a PR from any status as long as a worktree is present — even `planning` or `coding` (incomplete builds).
**Where:** `apps/frontend/src/main/ipc-handlers/task/worktree-handlers.ts:2934`
**Fix:** Add status validation: only allow PR creation from `human_review` or `pr_created` (re-creation).

---

### FIX-028: Document ralph loop batching

**What should happen:** Architecture docs should explain that the coder processes up to 8 subtasks per session in batch mode.
**What actually happens:** The "ralph loop" batching is completely undocumented. Docs suggest 1 subtask per iteration.
**Where:** Architecture documentation
**Fix:** Add a section explaining: batch size (up to 8), how subtasks are selected, the ralph loop prompt format (task table, promises, anti-skip rules, hard stop rule), and the auto-continue behavior.

---

### FIX-029: Multiple tasks spawn parallel agents with no queue

**What should happen:** Tasks should be queued so only one (or a controlled number of) agent(s) run at a time, preventing resource contention.
**What actually happens:** Each task creation spawns its own agent process immediately. Multiple tasks running in parallel compete for CPU, memory, and API rate limits with no coordination.
**Where:** `apps/frontend/src/main/agent/agent-manager.ts`
**Fix:** Add a task execution queue. Allow configurable concurrency (default: 1). Queue additional tasks and start them when the current one completes.

---

### FIX-030: File watcher may miss initial plan state

**What should happen:** The file watcher should capture the initial state of the plan file when it starts watching.
**What actually happens:** `ignoreInitial: true` is set on the chokidar watcher. The plan file starts with empty phases. If the first write happens before the watcher is fully initialized, the change event is missed.
**Where:** `apps/frontend/src/main/file-watcher.ts:37`
**Fix:** Either set `ignoreInitial: false` and handle the initial empty state, or add a manual read-after-watch-start to capture the current state.

---

### FIX-031: Companion has no conversation persistence

**What should happen:** Multi-turn conversations with the companion should maintain context across messages.
**What actually happens:** Each user message creates a fresh `create_agent_session()` call. The companion has no memory of previous messages in the same conversation. The `conversation_history` array in `companion_agent.py` is maintained in Python memory, but the SDK session is fresh each time.
**Where:** `apps/backend/agents/companion_agent.py:313`
**Fix:** Either pass `conversation_history` to the SDK session (as system context or prior messages), or switch to a persistent session that accumulates messages.

---

### FIX-032: Auto-spawn companion has race condition

**What should happen:** When the coder exits, the companion spawns cleanly after a short delay.
**What actually happens:** There's a 1.5s delay before spawning, plus a context cleanup that waits for the companion spawn promise. The timing is fragile — if cleanup runs before the companion is ready, or if another event triggers during the delay, the companion may not spawn or may spawn with stale context.
**Where:** `apps/frontend/src/main/agent/agent-manager.ts:122-151`
**Fix:** Use a state machine for the companion lifecycle instead of timers. Transition: `coder_running → coder_exited → spawning_companion → companion_ready`. Each state blocks invalid transitions.

---

### FIX-033: Partial merge marks entire merge as failed

**What should happen:** If some files merge successfully and others fail, the successful merges should be kept and only the failures reported.
**What actually happens:** In the direct copy path, if any file copy fails, the entire merge is marked as failed — even though some files were already successfully merged.
**Where:** `apps/backend/core/workspace.py:688-700`
**Fix:** Track per-file merge status. Report which files succeeded and which failed. Let the user decide whether to accept the partial merge or roll back.

---

### FIX-034: Lock file handling asymmetry

**What should happen:** Lock files (package-lock.json, yarn.lock, etc.) should be handled identically in merge preview and actual merge.
**What actually happens:** The preview path and actual merge path have slightly different lock file exclusion logic, which can lead to "preview shows clean merge, actual merge has conflicts" situations.
**Where:** `apps/backend/core/workspace.py:1266-1277`
**Fix:** Extract lock file detection into a shared function used by both paths.

---

### FIX-035: Inconsistent JSON write methods

**What should happen:** All JSON writes to shared files should use the same atomic write method.
**What actually happens:** Tool-level writes use `write_json_atomic` (safe), but full plan sync uses `shutil.copy2` (can be partial on crash).
**Where:** `apps/backend/agents/utils.py` vs `apps/backend/agents/subtask.py`
**Fix:** Use `write_json_atomic` everywhere. Replace `shutil.copy2` for JSON files with read-then-atomic-write.

---

### FIX-036: Model selection only applies to first subtask in batch

**What should happen:** If a phase-specific model is configured, it should apply to all subtasks in that phase.
**What actually happens:** The model selection per phase only applies to the first subtask in a ralph loop batch. Subsequent subtasks in the same batch use whatever model was selected for the first one.
**Where:** `apps/backend/agents/coder.py:380-399`
**Fix:** Apply model selection per-subtask, not per-batch. Or document that batch mode uses a single model for the entire batch.

---

### FIX-037: PR creation impossible after marking done

**What should happen:** Users should be able to create a PR for completed work, even after marking a task as done.
**What actually happens:** Marking as done (after merge) deletes the worktree and branch. The "Create PR" button requires a worktree to exist. Once done, there's no way to create a PR without re-running the entire build.
**Where:** `apps/frontend/src/renderer/components/task-detail/task-review/WorkspaceStatus.tsx:460`
**Fix:** Two options: (1) prompt user to create PR before merge (reorder the UI flow), or (2) support PR creation from the main branch after merge (push a new branch from the merged commit).

---

### FIX-038: PR timeout doesn't verify outcome

**What should happen:** If PR creation times out, the system should check whether the PR was actually created on GitHub.
**What actually happens:** On timeout, the process is killed and the user is told "PR creation timed out." But the PR might have been created on GitHub before the timeout hit. The task status doesn't update to `pr_created`.
**Where:** `apps/frontend/src/main/ipc-handlers/task/worktree-handlers.ts:3023`
**Fix:** After timeout, run `gh pr list --head <branch>` to check if the PR exists. If it does, update status to `pr_created` and return the PR URL.

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| P0       | 4     | Crashes, data loss, infinite loops |
| P1       | 8     | Silent failures, stuck states, wrong results |
| P2       | 8     | Dead code, wrong docs, broken invariants |
| P3       | 18    | Architecture debt, missing features, race conditions |
| **Total**| **38** | |

### P4 — Quick Wins (< 1 hour each)
- FIX-014: Update phase count docs
- FIX-015: Fix "cosine similarity" doc
- FIX-017: Remove dead `requirements_context` load
- FIX-020: Fix hardcoded companion phase
- FIX-028: Document ralph loop batching

### P4 — High Impact (most user-visible improvement)
- FIX-001: SIMPLE fast-track crash (blocks all simple tasks)
- FIX-005: Stuck subtask loop (wastes API credits)
- FIX-008: Silent agent startup failure (user thinks task is processing)
- FIX-003: Stash pop data loss (user's uncommitted work lost)
