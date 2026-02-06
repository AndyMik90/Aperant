# Memory & Learning Architecture

**Date:** 2026-02-06
**Status:** DESIGN COMPLETE — Ready for review
**Goal:** Close the feedback loop so agents learn from every QA finding and build a living knowledge base

---

## Problem Statement

The memory system has strong bones but three critical gaps:

1. **QA findings don't reach future agents.** Issues go to `memories/issues.md` but never get promoted to `memory/gotchas.md` — the file that's actually injected into agent system prompts. Future agents repeat the same mistakes.

2. **No unified project-level knowledge.** Each spec has its own `memory/` directory, but there's no consolidated document that captures cross-task learnings. An agent working on Task 5 doesn't know what the agent on Task 1 discovered.

3. **Agent writes are isolated.** When an agent calls `record_gotcha()` or `record_discovery()`, those go to the spec-level `memory/` directory. No mechanism promotes valuable findings to a project-wide document.

---

## Current State (What Already Works)

### Memory Save Points
| When | What | Where | Auto? |
|------|------|-------|-------|
| Post-session exit | Patterns, gotchas, codebase map, session insights | `spec/memory/` + Graphiti | Yes |
| QA rejection | Issues with root cause + prevention tip | `spec/memories/issues.md` | Yes |
| Agent tool call | Discoveries, gotchas (on-demand) | `spec/memory/` + Graphiti | Agent-initiated |
| Insight extraction | LLM-analyzed file insights, approach outcomes | `spec/memory/session_insights/` | Yes (Haiku) |

### Memory Load Points
| When | What | Source |
|------|------|--------|
| Agent startup | Patterns, gotchas, session recommendations | `get_graphiti_context()` → system prompt |
| Coder Step 1 | codebase_map, patterns.md, gotchas.md, session_insights | File reads in prompt |
| Agent tool call | On-demand session context | `get_session_context()` tool |

### The Gap
```
QA finds "Missing null check in API handler"
    ↓
Writes to memories/issues.md          ← FILE EXISTS, agents don't read it
Does NOT write to memory/gotchas.md   ← THIS is what agents read
Does NOT write to PROJECT_MEMORY.md   ← THIS doesn't exist yet
    ↓
Next agent makes same mistake
```

---

## Proposed Architecture

### Part A: QA → Gotchas Bridge (Auto-Promote)

**Flow:**
```
QA rejection
    ↓
persist_issues_to_memory()       ← already works
    ↓ NEW
promote_issues_to_gotchas()      ← extract prevention tips
    ↓
memory/gotchas.md updated        ← agents see this in system prompt
    ↓
Next agent startup → gotcha in context → mistake avoided
```

**What gets promoted:** Each QA issue's `prevention` field becomes a gotcha entry.

**Format in gotchas.md:**
```markdown
- [QA] Missing null check in API handlers — always validate input params before accessing properties (from QA iteration 2, 2026-02-06)
```

The `[QA]` prefix distinguishes auto-promoted gotchas from session-discovered ones.

**Implementation:** ~30 lines added to `qa/report.py` — call `append_gotcha()` inside `persist_issues_to_memory()`.

---

### Part B: Project-Level Living Document

**New file:** `.auto-claude/PROJECT_MEMORY.md` (per project, not per spec)

**Why project-level:**
- Spec-level memory already exists (`memory/` per spec)
- Cross-task learnings need a shared location
- Architecture decisions apply to all tasks
- Agent working on Task 5 needs to know what Task 1 learned

#### Document Structure

```markdown
# Project Memory

Auto-maintained knowledge base. Agents read this at startup and append learnings.
Last updated: {timestamp}

---

## Architecture Decisions

Significant technical decisions made during this project.

- **{date}** [{task}] {decision description}

## Code Patterns

Established patterns all agents should follow.

- **{date}** [{task}] {pattern description}

## Known Gotchas

Pitfalls to avoid. Includes auto-promoted QA findings.

- **{date}** [{task}] {gotcha description}
- **{date}** [QA] {prevention tip from QA finding}

## Testing & QA Notes

Testing strategies, coverage requirements, known flaky areas.

- **{date}** [{task}] {testing note}

## Agent Learnings

Cross-task insights agents found valuable during execution.

- **{date}** [{task}] {learning}
```

#### Access Model: Structured Append-Only

| Who | Can Read | Can Write |
|-----|----------|-----------|
| All agents | Full document at startup | Append to specific sections only |
| QA auto-promote | N/A | Append to Known Gotchas |
| Post-session | N/A | Append to Code Patterns, Agent Learnings |
| Human (user) | Full document | Full edit (curation, cleanup) |

**Why append-only for agents:**
- Prevents agents from accidentally overwriting valuable entries
- Each entry is timestamped and attributed (task ID + date)
- Document only grows (user can curate/trim periodically)
- No risk of agent deleting another agent's findings

**Why NOT free-form:**
- Free-form risks agents rewriting the entire document
- Structured sections keep it organized
- Append is idempotent — worst case is a duplicate entry
- Deduplication logic prevents exact repeats

#### Loading Into System Prompt

```python
# In memory_manager.py, alongside get_graphiti_context()
def load_project_memory(project_dir: Path) -> str | None:
    """Load PROJECT_MEMORY.md and return as context string."""
    mem_file = Path(project_dir) / ".auto-claude" / "PROJECT_MEMORY.md"
    if not mem_file.exists():
        return None
    content = mem_file.read_text(encoding="utf-8")
    # Truncate if too long (keep last N lines per section)
    return truncate_project_memory(content, max_chars=4000)
```

Injected into every agent's system prompt:
```python
project_memory = load_project_memory(project_dir)
if project_memory:
    prompt += "\n\n## Project Memory\n" + project_memory
```

#### Writing From Agents

New agent tool: `append_project_memory`

```python
@tool("append_project_memory", "Append a learning to the project memory document")
async def append_project_memory(args: dict) -> dict:
    """
    Args:
        section: "architecture" | "patterns" | "gotchas" | "testing" | "learnings"
        content: str  # The learning to append
        task_id: str  # Current task ID for attribution
    """
```

**Agent instruction (added to system prompts):**
> If you discover something that would help future agents working on OTHER tasks in this project — an architecture pattern, a gotcha, a testing strategy — use `append_project_memory` to record it. Only record genuinely cross-task-useful insights, not task-specific details.

#### Auto-Population Hooks

**Post-QA (after rejection):**
```python
# In qa/report.py, inside persist_issues_to_memory()
for issue in issues:
    prevention = issue.get("prevention", "")
    if prevention:
        append_to_project_memory(
            project_dir,
            section="gotchas",
            content=prevention,
            source=f"QA iteration {iteration}",
        )
```

**Post-session (after successful completion):**
```python
# In session.py, inside post_session_processing()
if extracted_insights:
    for pattern in extracted_insights.get("patterns_discovered", []):
        append_to_project_memory(
            project_dir,
            section="patterns",
            content=pattern,
            source=f"Task {subtask_id}, session {session_num}",
        )
    for gotcha in extracted_insights.get("gotchas_discovered", []):
        append_to_project_memory(
            project_dir,
            section="gotchas",
            content=gotcha,
            source=f"Task {subtask_id}, session {session_num}",
        )
```

---

## File Change Summary

### Part A: QA → Gotchas Bridge

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/qa/report.py` | MODIFY | Add `promote_issues_to_gotchas()` call inside `persist_issues_to_memory()` |
| `apps/backend/memory/patterns.py` | VERIFY | Confirm `append_gotcha()` handles `[QA]` prefix and deduplication |

### Part B: Project Memory Document

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/memory/project_memory.py` | CREATE | `load_project_memory()`, `append_to_project_memory()`, `truncate_project_memory()`, `create_project_memory_template()` |
| `apps/backend/agents/memory_manager.py` | MODIFY | Add `load_project_memory()` call in `get_graphiti_context()`, include in returned context |
| `apps/backend/agents/session.py` | MODIFY | Add post-session hook to append patterns/gotchas to PROJECT_MEMORY.md |
| `apps/backend/qa/report.py` | MODIFY | Add post-QA hook to append prevention tips to PROJECT_MEMORY.md |
| `apps/backend/agents/tools_pkg/tools/memory.py` | MODIFY | Add `append_project_memory` tool |
| `apps/backend/agents/coder.py` | MODIFY | Load project memory alongside Graphiti context |
| `apps/backend/qa/reviewer.py` | MODIFY | Load project memory alongside Graphiti context |
| `apps/backend/qa/fixer.py` | MODIFY | Load project memory alongside Graphiti context |

**Total: 1 new file, 7 modified files**

---

## Ralph Prompts Plan

### Prompt 1: QA_MEMORY_BRIDGE (3 tasks)

| # | Task | File | Action |
|---|------|------|--------|
| 1 | Add gotcha promotion to QA | `qa/report.py` | Call `append_gotcha()` for each issue's prevention tip inside `persist_issues_to_memory()`, prefix with `[QA]` |
| 2 | Add project memory append to QA | `qa/report.py` | After persisting issues, also call `append_to_project_memory()` for prevention tips |
| 3 | Add project memory append to post-session | `agents/session.py` | In `post_session_processing()`, append discovered patterns and gotchas to PROJECT_MEMORY.md |

### Prompt 2: PROJECT_MEMORY_SYSTEM (4 tasks)

| # | Task | File | Action |
|---|------|------|--------|
| 1 | Create project_memory.py module | `memory/project_memory.py` | Load, append, truncate, template functions |
| 2 | Load project memory in agent startup | `agents/memory_manager.py` | Add to context retrieval, inject into prompts |
| 3 | Add append_project_memory agent tool | `agents/tools_pkg/tools/memory.py` | Structured append-only tool |
| 4 | Wire project memory into all agents | `agents/coder.py`, `qa/reviewer.py`, `qa/fixer.py` | Load and inject project memory |

**Run order:** PROJECT_MEMORY_SYSTEM first (creates the infrastructure), then QA_MEMORY_BRIDGE (uses it).

---

## Design Decisions

### Q: Per-spec or per-project document?
**A: Per-project.** Spec-level memory already exists. The gap is cross-task knowledge. A project-level document fills that gap.

### Q: Free-form or structured append-only?
**A: Structured append-only.** Agents can only add entries to predefined sections. This prevents accidental overwrites and keeps the document organized. Users can curate manually.

### Q: What sections?
**A: Five sections** — Architecture Decisions, Code Patterns, Known Gotchas, Testing Notes, Agent Learnings. These cover the most common cross-task knowledge types. Can be extended later.

### Q: What triggers writes?
**A: Three triggers:**
1. **Auto (QA rejection)** → prevention tips → Known Gotchas
2. **Auto (post-session)** → patterns/gotchas → Code Patterns / Known Gotchas
3. **Agent-initiated** → `append_project_memory` tool → any section

### Q: Size limits?
**A: 4000 chars max in system prompt.** If the document grows beyond that, `truncate_project_memory()` keeps the most recent entries per section. Full document always on disk for reference.

### Q: Deduplication?
**A: Exact-match dedup on content** (ignoring timestamp/source). Same prevention tip won't be added twice. Semantic dedup (fuzzy matching) is a future enhancement.

### Q: When does the document get created?
**A: On first task creation** for a project. `create_project_memory_template()` generates the initial structure. If it doesn't exist when an agent tries to load it, returns None (graceful fallback).

---

## Complete Pipeline Vision

```
PLANNING PHASE
    Agent reads: PROJECT_MEMORY.md + Graphiti context + spec memory
    Agent learns: existing patterns, known gotchas, architecture decisions
    ↓
CODING PHASE (Ralph Loop)
    Agent reads: PROJECT_MEMORY.md + Graphiti context + spec memory
    Agent discovers: new patterns, new gotchas
    Agent writes: append_project_memory (if cross-task relevant)
    Post-session: auto-append patterns/gotchas to PROJECT_MEMORY.md
    ↓
QA REVIEW
    Agent reads: PROJECT_MEMORY.md + Graphiti context
    QA finds issues → persist to memories/issues.md
                    → promote to memory/gotchas.md       ← NEW
                    → append to PROJECT_MEMORY.md         ← NEW
    QA fixes applied → re-review
    ↓
HUMAN REVIEW
    User sees: PROJECT_MEMORY.md (curate if needed)
    Task complete → learnings persist for next task
    ↓
NEXT TASK
    Agent reads: PROJECT_MEMORY.md (now includes previous task's learnings)
    → Doesn't repeat same mistakes
    → Follows established patterns
    → Builds on prior architecture decisions
```

---

## Success Metrics

1. **Zero repeated QA failures** — If QA catches "missing null check" once, no future agent should make the same mistake
2. **PROJECT_MEMORY.md grows naturally** — After 5+ tasks, the document should contain actionable project-specific knowledge
3. **Agents reference memory** — Agent logs should show "loaded project memory context" at startup
4. **Reduced QA iterations** — Average iterations per task should decrease over time as agents learn
