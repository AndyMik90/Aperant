# Jerry Chat Performance Fix

**Date:** 2026-02-05
**Issue:** Jerry chat taking 5+ minutes to respond due to subagent cascade
**Status:** ✅ FIX APPLIED (2026-02-05)

---

## Problem

Jerry chat (Insights) was taking 5+ minutes to respond because:

1. **SDK Tool Config Issue**: `insights_runner.py` only set `allowed_tools` but not `tools`
2. **Default Toolset**: When `tools` is not explicitly set, the SDK defaults to ALL Claude Code tools including `Task`
3. **Subagent Cascade**: With `Task` tool available, Jerry would spawn:
   - Multiple "exploration agents" in parallel
   - A "Plan agent" for implementation strategy
   - Each subagent = multiple API turns = slow response

## Root Cause

```python
# BEFORE (broken) - insights_runner.py:194-199
options_kwargs = {
    "allowed_tools": ["Read", "Glob", "Grep"],  # Only sets allowlist filter
    "max_turns": 30,  # Too many turns
    ...
}
```

The `--allowedTools` CLI flag is just a filter on top of the default toolset. Without explicitly setting `--tools`, the CLI uses all Claude Code tools by default.

## Solution ✅ APPLIED

```python
# AFTER (fixed) - insights_runner.py:194-200
options_kwargs = {
    "model": resolve_model_id(model),
    "system_prompt": system_prompt,
    "allowed_tools": ["Read", "Glob", "Grep"],
    "disallowed_tools": ["Task"],  # ✅ ADDED - Block subagent spawning
    "max_turns": 15,  # ✅ REDUCED from 30
    "cwd": str(project_path),
}
```

## Design Decision: What Jerry Can/Can't Do

| Capability | Allowed? | Reason |
|------------|----------|--------|
| Read/Glob/Grep | ✅ Yes | Explore codebase |
| Write/Edit | ✅ Yes | Quick fixes when asked |
| Bash | ✅ Yes | Run commands when needed |
| Task suggestions | ✅ Yes | Text output `__TASK_SUGGESTION__` for kanban |
| Task tool (SDK) | ❌ No | Prevents subagent cascade |

## Key Insight

There are TWO different "task" concepts:

1. **Task tool (Claude SDK)** - Spawns subagents for parallel work
   - This causes the cascade problem
   - Block via `disallowed_tools: ["Task"]`

2. **Task suggestions (Auto-Claude)** - Creates kanban items
   - Just text output: `__TASK_SUGGESTION__:{...}`
   - NOT affected by blocking Task tool
   - Still works normally

## Files Modified ✅

- `apps/backend/runners/insights_runner.py`
  - ✅ Added `disallowed_tools: ["Task"]`
  - ✅ Reduced `max_turns` from 30 to 15

## Expected Impact

- Response time: 5+ minutes → ~30 seconds to 2 minutes
- Jerry stays as a single agent (no subagent spawning)
- Quick fix capability preserved
- Task creation for kanban preserved

---

## Related Issues

- SDK `allowed_tools` vs `tools` distinction (see `claude_agent_sdk/_internal/transport/subprocess_cli.py`)
- `--allowedTools` is a filter, `--tools` sets the base toolset
- `--disallowedTools` explicitly blocks specific tools
