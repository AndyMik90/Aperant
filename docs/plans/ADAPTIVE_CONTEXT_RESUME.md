# Adaptive Context Loading for Task Resume

**Created:** 2026-02-09
**Status:** Design
**Priority:** HIGH (massive token savings on every resumed session)
**Effort:** ~4-6 hours

---

## Problem Statement

When a task is resumed (user restarts a paused/stuck build, or a session auto-continues after error), the coder agent gets the **exact same prompts and system instructions** as a fresh-start task. This causes significant token waste because:

1. The agent re-reads files it already processed in previous sessions
2. The Ralph prompt includes ALL subtasks (completed + pending) instead of just pending ones
3. The system prompt (`coder.md`) gives identical "fresh context window" instructions regardless of whether the agent has prior progress
4. Session memory files grow unbounded and are all loaded every session
5. `spec.md` is re-read in full every session even though it never changes mid-build

### Measured Token Waste per Resumed Session

| Source | Tokens Wasted | Notes |
|--------|--------------|-------|
| Full `spec.md` re-read | 2,000-5,000 | Agent reads spec every session; content never changes |
| Completed subtasks in Ralph task table | 500-2,000 | `generate_prompt()` includes ALL subtasks |
| No resume-aware system prompt | ~500 | Same "FRESH context window" framing even on resume |
| Full `implementation_plan.json` re-read | 1,000-3,000 | Agent reads entire plan; completed subtasks are noise |
| Growing session memory | 500-3,000+ | Every session's insights loaded; old ones rarely relevant |
| `coder.md` Step 1 "Get Bearings" | 1,000-2,000 | 11-step discovery process is redundant on resume |
| **Total per resumed session** | **5,500-15,500** | **~10-20% of a 200k context window** |

Over a typical 8-subtask build with 10+ sessions, this compounds to **55,000-155,000 wasted tokens**.

---

## Current Resume Flow

### What Already Works Well

1. **Plan detection** (`coder.py:165-206`): If `implementation_plan.json` exists with valid subtasks, `first_run` is set to `False` and planning phase is skipped.

2. **Subtask skipping** (`progress.py:get_next_subtask()`): Correctly scans phases respecting dependencies and returns the first `pending` subtask, skipping all `completed` ones.

3. **Ralph batch protocol** (`ralph_prompt_generator.py:generate_batch_protocol()`): When used (the primary path at `coder.py:531-547`), generates a prompt scoped to only the **pending** subtask batch. This is already efficient.

4. **Frontend recovery** (`execution-handlers.ts:1239`): `TASK_RECOVER_STUCK` handler resets stuck subtasks to pending, leaves completed ones alone, and can auto-restart.

5. **Recovery hints** (`coder.py:596-608`): Previous attempt failures are captured and injected as retry context.

### What Wastes Tokens on Resume

1. **`coder.md` system prompt** (1,092 lines): Always injected as the system prompt. Contains a 13-step "GET YOUR BEARINGS" section that instructs the agent to `cat spec.md`, `cat implementation_plan.json`, read all memory files, check git history, etc. This is valuable on first session but redundant on session 5 of the same build.

2. **`generate_prompt()` fallback** (`ralph_prompt_generator.py:215-279`): If the primary `generate_batch_protocol()` call fails, falls back to `generate_prompt()` which loads ALL subtasks from the plan (including completed ones) into the Ralph task table.

3. **Graphiti context** (`coder.py:611-616`): Loaded every session. On resume, much of this context was already consumed in prior sessions.

4. **Session insights directory** (`coder.md` Step 1, lines 124-162): The agent is told to read ALL session insights. By session 8, this is 8 JSON files of diminishing relevance.

5. **No compact spec summary**: The agent is told to `cat "$SPEC_DIR/spec.md"` every session. A 200-line spec consumes 2,000-5,000 tokens that could be replaced by a 200-token summary after the first session.

---

## Implementation (Completed)

**Key discovery during implementation:** `coder.md` is NOT loaded by the automated pipeline.
The system prompt is a short generic string in `create_client()`, and the user prompt is the
Ralph batch protocol. So instead of creating a separate `coder_resume.md`, the changes target
the actual token-consuming code paths: the system prompt in `create_client`, the Ralph prompt
generator, and the prompt assembly in `coder.py`.

### Change 1: Resume-Aware System Prompt

**File:** `apps/backend/core/client.py`

Added `is_resume` and `resume_context` parameters to `create_client()`. When `is_resume=True`,
a "RESUMED BUILD SESSION" section is appended to the system prompt telling the agent:
- This is a continued session, not a fresh start
- Skip full spec.md reads (spec summary is in the prompt)
- Focus on pending subtasks only
- Includes progress context (e.g., "Build progress: 7/12 subtasks completed")

### Change 2: Compact Spec Summary

**File:** `apps/backend/spec/compaction.py`

Added three functions:
- `generate_spec_summary(spec_dir)` — extracts feature name, workflow type, key requirements
  (first 5 bullet points), services, and subtask progress from spec.md + implementation_plan.json.
  No LLM call needed — pure text extraction. Produces ~200 tokens.
- `save_spec_summary(spec_dir)` — writes summary to `spec_summary.txt`
- `load_spec_summary(spec_dir)` — reads the saved summary

Called after every successful subtask completion in `coder.py`. The summary is refreshed
each time to keep progress counts current.

### Change 3: Resume-Optimized Ralph Prompt

**File:** `apps/backend/prompts_pkg/ralph_prompt_generator.py`

Added `is_resume` parameter to `generate_batch_protocol()` and `_build_prompt_content()`.
When `is_resume=True`:
- Replaces `"spec.md (READ THIS FULLY)"` with `"Spec summary provided in prompt header"`
- Replaces execution step `"Read spec.md fully before starting"` with
  `"Review the SPEC SUMMARY above and implementation_plan.json for your next subtask"`

### Change 4: Prompt Assembly with Spec Summary

**File:** `apps/backend/agents/coder.py`

- Detects `is_resume_session = not first_run` on each iteration
- Passes `is_resume=True` + progress context to `create_client()`
- Passes `is_resume=True` to `generate_ralph_batch_protocol()`
- Prepends spec summary header to the prompt when available:
  `"## SPEC SUMMARY (do NOT re-read full spec.md)\n\n{summary}"`
- Calls `save_spec_summary()` after every successful subtask batch

---

## Files Modified

| File | Change |
|------|--------|
| `apps/backend/spec/compaction.py` | Added `generate_spec_summary()`, `save_spec_summary()`, `load_spec_summary()` |
| `apps/backend/core/client.py` | Added `is_resume` + `resume_context` params to `create_client()` |
| `apps/backend/agents/coder.py` | Resume detection, spec summary injection, save summary after success |
| `apps/backend/prompts_pkg/ralph_prompt_generator.py` | `is_resume` param to skip full spec read instructions |

---

## Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Tokens per resumed session | ~80,000-120,000 | ~65,000-105,000 | ~15,000 saved (~15-20%) |
| Unnecessary spec reads | Every session | First session only | ~3,000 tokens/session |
| Session memory bloat | All sessions loaded | Latest only + summaries | ~1,000 tokens/session |
| System prompt size (resume) | 1,092 lines | ~600 lines | ~40% smaller |
| Cumulative savings (8-subtask build) | — | — | ~100,000-150,000 tokens |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Agent loses context on resume | Resume prompt still has all implementation rules; spec summary captures key requirements; agent still reads `implementation_plan.json` |
| `spec_summary.txt` gets stale | Regenerate after every session (cheap operation); include modification timestamp |
| `coder_resume.md` drifts from `coder.md` | Add sync comment at top of both files; future: extract shared sections into includes |
| First subtask in a new session needs more context | Agent can still `cat spec.md` if needed — the resume prompt doesn't forbid it, just doesn't mandate it |

---

## Not In Scope (Future Work)

- **Graphiti context pruning**: Currently loaded every session. Could be filtered to only entities relevant to pending subtasks. Deferred — requires Graphiti query changes.
- **Incremental plan loading**: Instead of reading full `implementation_plan.json`, serve only the current phase + next phase. Deferred — the plan is typically <3,000 tokens total and the filtered one-liner in the resume prompt handles the common case.
- **Wave-based parallelism**: Independent but complementary optimization. See [SHIPYARD_PORTS_TODO.md](./SHIPYARD_PORTS_TODO.md).
