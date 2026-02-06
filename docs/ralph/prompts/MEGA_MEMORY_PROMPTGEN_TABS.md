# MEGA_MEMORY_PROMPTGEN_TABS: Project Memory + QA Bridge + Ralph Gen + Prompt Tabs

**Date:** 2026-02-06
**Tasks:** 14
**Max Iterations:** 100
**Priority:** HIGH
**Status:** ❌ FAILED — Prompt too long for Ralph Loop input (Claude Code CLI crashed on input acceptance). Split into FALLBACK_A + FALLBACK_B.
**Design Docs:**
- [docs/plans/MEMORY_LEARNING_ARCHITECTURE.md](../plans/MEMORY_LEARNING_ARCHITECTURE.md)
- [docs/plans/PERSISTENT_AGENT.md](../plans/PERSISTENT_AGENT.md)

---

## What This Combines

| Original Prompt | Tasks | Domain |
|----------------|-------|--------|
| PROJECT_MEMORY_SYSTEM | 4 | Backend Python |
| QA_MEMORY_BRIDGE | 3 | Backend Python |
| RALPH_PROMPT_GEN | 3 | Backend Python |
| PROMPT_TAB_UI | 4 | Frontend TypeScript |
| **TOTAL** | **14** | **Mixed** |

## Strategy

- Tasks 1-10: Backend Python (no build check needed between tasks)
- Tasks 11-14: Frontend TypeScript (single build check at the end)
- Dependencies: Tasks 5-7 use functions created in Tasks 1-4
- Task 8-10 independent of 1-7

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing MEGA_MEMORY_PROMPTGEN_TABS for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 14-TASK JOB. Do NOT stop until all tasks are complete.
- This is a STRESS TEST of the Ralph Loop system — prove that large task sets work.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/
- Frontend: apps/frontend/src/

---

OBJECTIVE: Implement 4 features in one batch: (A) Project Memory living document system, (B) QA-to-gotchas memory bridge, (C) Ralph prompt generation after planning, (D) Spec+Prompt tabs in the bottom panel UI. Backend tasks first (1-10), frontend tasks last (11-14).

Read the existing code thoroughly before modifying. Key files to understand:
- apps/backend/memory/patterns.py — existing append_gotcha(), append_pattern(), load functions
- apps/backend/agents/memory_manager.py — get_graphiti_context(), save_session_memory()
- apps/backend/agents/session.py — post_session_processing(), extract_session_insights()
- apps/backend/qa/report.py — persist_issues_to_memory(), record_iteration()
- apps/backend/agents/tools_pkg/tools/memory.py — existing record_discovery, record_gotcha tools
- apps/backend/agents/coder.py — where graphiti_context is loaded for coder and planner
- apps/backend/qa/reviewer.py — where graphiti_context is loaded for QA
- apps/backend/qa/fixer.py — where graphiti_context is loaded for fixer
- apps/backend/spec/pipeline/orchestrator.py — spec pipeline flow
- apps/backend/prompts_pkg/ralph_prompt_generator.py — existing RalphPromptGenerator
- apps/backend/agents/companion_agent.py — build_context() method
- apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx — existing tab system

---

MEGA_MEMORY_PROMPTGEN_TABS: 14 TASKS

=== PART A: PROJECT MEMORY SYSTEM (Tasks 1-4) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create project_memory.py module | apps/backend/memory/project_memory.py | CREATE - a new module with these functions: (a) create_project_memory_template(project_dir) — creates .auto-claude/PROJECT_MEMORY.md with sections: Architecture Decisions, Code Patterns, Known Gotchas, Testing & QA Notes, Agent Learnings. Each section has a heading and a placeholder line. (b) load_project_memory(project_dir, max_chars=4000) — reads PROJECT_MEMORY.md, truncates if too long (keeping most recent entries per section), returns string or None. (c) append_to_project_memory(project_dir, section, content, source) — appends a timestamped entry to the specified section. section must be one of: 'architecture', 'patterns', 'gotchas', 'testing', 'learnings'. Format each entry as: '- **{date}** [{source}] {content}'. Deduplicates by checking if content string already exists in the file. Creates the template first if file doesn't exist. (d) truncate_project_memory(content, max_chars) — if content exceeds max_chars, keep the header and last N entries per section. Use Path for all file operations. | TASK_1_COMPLETE |
| 2 | Load project memory in agent startup | apps/backend/agents/memory_manager.py | MODIFY - import load_project_memory from memory.project_memory. In get_graphiti_context(), after building the graphiti context string, also call load_project_memory(project_dir). If it returns content, append it to the context string under a '## Project Memory' header. This means ALL agents that call get_graphiti_context() will automatically receive project memory. Also handle the case where project_dir is None (skip loading). | TASK_2_COMPLETE |
| 3 | Add append_project_memory agent tool | apps/backend/agents/tools_pkg/tools/memory.py | MODIFY - add a new tool function called append_project_memory. It should accept args: section (str, one of 'architecture', 'patterns', 'gotchas', 'testing', 'learnings'), content (str, the learning to record), task_id (str, optional, for attribution). Import append_to_project_memory from memory.project_memory. Call it with project_dir from the tool context. Return success message. Add proper docstring explaining when agents should use this — only for cross-task insights, not task-specific details. Follow the exact same @tool decorator pattern as existing tools in this file. | TASK_3_COMPLETE |
| 4 | Wire project memory into all agents | apps/backend/agents/coder.py, apps/backend/qa/reviewer.py, apps/backend/qa/fixer.py | MODIFY - verify that coder.py, reviewer.py, and fixer.py all call get_graphiti_context() (they should already). Since Task 2 added project memory loading inside get_graphiti_context(), no code change may be needed. But verify by reading each file. If any agent constructs its prompt WITHOUT calling get_graphiti_context(), add the load_project_memory() call there. Also add a print statement like 'Project memory loaded' after successful loading in memory_manager.py for observability. | TASK_4_COMPLETE |

=== PART B: QA MEMORY BRIDGE (Tasks 5-7) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 5 | Add gotcha promotion to QA report | apps/backend/qa/report.py | MODIFY - inside persist_issues_to_memory(), after writing to memories/issues.md, add a loop that promotes each issue's prevention tip to the spec-level gotchas file. Import append_gotcha from memory.patterns. For each issue, if it has a non-empty 'prevention' field, call append_gotcha(spec_dir, f'[QA] {prevention} (from QA iteration {iteration})'. This means QA findings automatically become gotchas visible in future agent system prompts. | TASK_5_COMPLETE |
| 6 | Add project memory append to QA | apps/backend/qa/report.py | MODIFY - still inside persist_issues_to_memory(), after the gotcha promotion loop from Task 5, also call append_to_project_memory(). Import append_to_project_memory from memory.project_memory. For each issue with a non-empty 'prevention' field, call append_to_project_memory(project_dir, section='gotchas', content=prevention, source=f'QA iteration {iteration}'). You'll need to add project_dir as a parameter to persist_issues_to_memory() — find where it's called from (record_iteration or the QA loop) and pass project_dir through. If project_dir is not easily available, wrap in try/except and skip gracefully. | TASK_6_COMPLETE |
| 7 | Add project memory append to post-session | apps/backend/agents/session.py | MODIFY - in post_session_processing(), after the call to save_session_memory() succeeds, add a block that promotes discovered patterns and gotchas to PROJECT_MEMORY.md. Import append_to_project_memory from memory.project_memory. For each pattern in extracted_insights.get('patterns_discovered', []), call append_to_project_memory(project_dir, 'patterns', pattern, f'Task {subtask_id}'). For each gotcha in extracted_insights.get('gotchas_discovered', []), call append_to_project_memory(project_dir, 'gotchas', gotcha, f'Task {subtask_id}'). Wrap in try/except so failures don't break post-session processing. | TASK_7_COMPLETE |

=== PART C: RALPH PROMPT GENERATION (Tasks 8-10) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 8 | Generate Ralph prompt after planning | apps/backend/spec/pipeline/orchestrator.py | MODIFY - after the planning phase completes (where implementation_plan.json is written), add a call to generate the Ralph prompt. Import RalphPromptGenerator from prompts_pkg.ralph_prompt_generator. Read the orchestrator to find where implementation_plan.json is finalized. After that point, call the generator to create ralph_prompt.md in the spec directory. Wrap in try/except so failure doesn't break the pipeline. Print a status message like 'Ralph prompt generated: ralph_prompt.md'. This should happen BEFORE the review checkpoint. | TASK_8_COMPLETE |
| 9 | Ensure RalphPromptGenerator works with spec_dir | apps/backend/prompts_pkg/ralph_prompt_generator.py | MODIFY (if needed) - read the existing RalphPromptGenerator class. Verify it has a method that can take a spec_dir, read implementation_plan.json from it, and output ralph_prompt.md to the same directory. If the method exists, great — just verify it works. If it doesn't exist or has a different signature, add or adapt a save_prompt(spec_dir, project_dir=None) method that: reads implementation_plan.json from spec_dir, generates a Ralph-format prompt with executor identity, task table with promises, verification steps, anti-skip rules, and saves as ralph_prompt.md. Handle the case where implementation_plan.json doesn't exist (return early). | TASK_9_COMPLETE |
| 10 | Add ralph_prompt.md to companion context | apps/backend/agents/companion_agent.py | MODIFY - in build_context(), add ralph_prompt.md to the list of files loaded from spec_dir. After the existing file reads (spec.md, implementation_plan.json, etc.), add a check for ralph_prompt.md. If it exists, include its contents under a '== RALPH CODING PROMPT ==' section header. This lets the companion agent show users the generated coding prompt when asked. | TASK_10_COMPLETE |

=== PART D: PROMPT TAB UI (Tasks 11-14) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 11 | Extend ViewMode and add tab buttons | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - (a) Change the ViewMode type from 'raw' or 'structured' to also include 'spec' and 'prompt'. (b) Add two new tab buttons in the existing view mode toggle area. The Spec button should use a FileText icon (from lucide-react) and the Prompt button should use a Terminal or Code icon. Follow the exact same button styling pattern as the existing Raw and Timeline buttons. Keep all 4 buttons in a single row. | TASK_11_COMPLETE |
| 12 | Create IPC handler to read spec files | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | MODIFY - add a new ipcMain.handle for 'task:read-spec-file' that takes (taskId, fileName) args. It should look up the task's spec directory from the agent manager's taskExecutionContext, then read the requested file (spec.md or ralph_prompt.md) from that directory using fs.readFile. Return the file contents as a string, or null if the file doesn't exist. Also add the IPC channel constant to the ipc channels file (find where IPC_CHANNELS or channel constants are defined — check shared/constants/ipc.ts). | TASK_12_COMPLETE |
| 13 | Create SpecDocView component | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | CREATE - a React component that displays rendered markdown content. Props: taskId (string), fileName (string, either 'spec.md' or 'ralph_prompt.md'), title (string). On mount, call window.api.invoke('task:read-spec-file', taskId, fileName) to load the content. Display in a ScrollArea with: (a) a header showing the title and file name, (b) the content displayed as preformatted text with whitespace-pre-wrap in a monospace font for prompt content, proportional for spec. (c) A 'Copy' button in the header to copy raw content to clipboard. (d) An empty state message if file doesn't exist yet ('Not available yet — planning phase has not completed'). Use bg-card for background, text-foreground for text. Cache the loaded content in state so tab switching doesn't reload. | TASK_13_COMPLETE |
| 14 | Render new tabs in bottom panel | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - in the content area where TaskMonitorChat is rendered for 'raw' mode, add conditional rendering for the new view modes. When viewMode is 'spec', render SpecDocView with fileName='spec.md' and title='Task Specification'. When viewMode is 'prompt', render SpecDocView with fileName='ralph_prompt.md' and title='Coding Prompt'. Pass the current taskId from the bottom panel state. Keep the existing Raw and Timeline rendering unchanged. Import SpecDocView from ./SpecDocView. | TASK_14_COMPLETE |

FINAL: <promise>MEGA_COMPLETE</promise>

---

KEY REQUIREMENTS:

PART A (Project Memory):
1. PROJECT_MEMORY.md lives at {project_dir}/.auto-claude/PROJECT_MEMORY.md
2. Five sections: Architecture Decisions, Code Patterns, Known Gotchas, Testing & QA Notes, Agent Learnings
3. Append-only — never overwrite existing entries
4. Deduplication — don't add the same content twice
5. Timestamp and source attribution on every entry
6. Max 4000 chars when loaded into system prompt
7. Graceful fallback — if file doesn't exist, return None (don't error)

PART B (QA Bridge):
8. QA prevention tips auto-promote to BOTH memory/gotchas.md AND PROJECT_MEMORY.md
9. [QA] prefix distinguishes auto-promoted gotchas from session-discovered ones
10. Must not break existing persist_issues_to_memory() flow — additions only
11. try/except around all new calls — memory failures must never break QA

PART C (Ralph Gen):
12. Use the EXISTING RalphPromptGenerator — do NOT create a new one
13. ralph_prompt.md saved in spec_dir alongside spec.md
14. Generation happens AFTER implementation_plan.json exists, BEFORE review checkpoint
15. Failure must NOT break the spec pipeline (try/except)

PART D (Prompt Tabs):
16. Tab buttons must match existing Raw/Timeline button style exactly
17. All 4 tabs in a single horizontal row: Raw | Timeline | Spec | Prompt
18. Content loads via IPC from spec directory on disk
19. Empty state when file doesn't exist
20. Copy button for raw content
21. Tab state persists while switching (don't reload every time)

---

VERIFICATION:
- Backend: cd apps/backend && python -c 'from memory.project_memory import load_project_memory, append_to_project_memory; print(\"OK\")'
- Backend: cd apps/backend && python -c 'from prompts_pkg.ralph_prompt_generator import RalphPromptGenerator; print(\"OK\")'
- Frontend: cd apps/frontend && npm run build
- All verifications pass with no errors

---

CRITICAL CONSTRAINTS

1. 14-TASK JOB - Do NOT stop until all tasks complete
2. Backend tasks (1-10) first, frontend tasks (11-14) last
3. Do NOT break any existing functionality — all changes are additive
4. Memory operations must be wrapped in try/except — never crash the pipeline
5. Follow EXISTING code patterns — match the style of surrounding code
6. Do NOT install new packages — use only what's in requirements/package.json
7. BUILD MUST PASS at the end
8. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT combine tasks — each task is a separate unit of work
- Do NOT output final promise until ALL verifications pass
- If you hit a build error, FIX IT before continuing

---

CURRENT STATUS: 0 of 14 tasks complete. BEGIN NOW.
" --max-iterations 100 --completion-promise "MEGA_COMPLETE"
```

---

## Expected Results

| Metric | Target |
|--------|--------|
| Tasks | 14 |
| Est. Duration | 15-25 min |
| Files Created | 2 (project_memory.py, SpecDocView.tsx) |
| Files Modified | ~12 |
| Build Check | Frontend only (at end) |
| Import Checks | 2 backend checks |
