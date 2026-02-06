# MEGA_FALLBACK_A: Backend Memory + QA Bridge + Ralph Gen

**Date:** 2026-02-06
**Tasks:** 10
**Max Iterations:** 80
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (6m 2s) — 10/10 tasks, all verifications passed
**Design Docs:** [MEMORY_LEARNING_ARCHITECTURE.md](../plans/MEMORY_LEARNING_ARCHITECTURE.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing MEGA_FALLBACK_A (Backend) for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 10-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

---

OBJECTIVE: Implement 3 backend features: (A) Project Memory living document system, (B) QA-to-gotchas memory bridge, (C) Ralph prompt generation after planning. All Python, no frontend.

Read existing code before modifying:
- apps/backend/memory/patterns.py — append_gotcha(), append_pattern()
- apps/backend/agents/memory_manager.py — get_graphiti_context(), save_session_memory()
- apps/backend/agents/session.py — post_session_processing()
- apps/backend/qa/report.py — persist_issues_to_memory()
- apps/backend/agents/tools_pkg/tools/memory.py — existing tool patterns
- apps/backend/agents/coder.py — graphiti_context loading
- apps/backend/qa/reviewer.py — graphiti_context loading
- apps/backend/qa/fixer.py — graphiti_context loading
- apps/backend/spec/pipeline/orchestrator.py — spec pipeline
- apps/backend/prompts_pkg/ralph_prompt_generator.py — RalphPromptGenerator
- apps/backend/agents/companion_agent.py — build_context()

---

MEGA_FALLBACK_A: 10 TASKS

=== PART A: PROJECT MEMORY SYSTEM (Tasks 1-4) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create project_memory.py module | apps/backend/memory/project_memory.py | CREATE - functions: create_project_memory_template(project_dir), load_project_memory(project_dir, max_chars=4000), append_to_project_memory(project_dir, section, content, source), truncate_project_memory(content, max_chars). PROJECT_MEMORY.md lives at {project_dir}/.auto-claude/PROJECT_MEMORY.md. Five sections: Architecture Decisions, Code Patterns, Known Gotchas, Testing & QA Notes, Agent Learnings. Entries formatted as '- **{date}** [{source}] {content}'. Dedup by checking if content already in file. Create template if file doesn't exist on append. | TASK_1_COMPLETE |
| 2 | Load project memory in agent startup | apps/backend/agents/memory_manager.py | MODIFY - import load_project_memory. In get_graphiti_context(), after building graphiti context, call load_project_memory(project_dir). If returns content, append under '## Project Memory' header. Handle project_dir=None. Print 'Project memory loaded' on success. | TASK_2_COMPLETE |
| 3 | Add append_project_memory agent tool | apps/backend/agents/tools_pkg/tools/memory.py | MODIFY - add append_project_memory tool. Args: section (str), content (str), task_id (str optional). Import append_to_project_memory. Follow existing @tool decorator pattern. | TASK_3_COMPLETE |
| 4 | Verify project memory loads in all agents | apps/backend/agents/coder.py, apps/backend/qa/reviewer.py, apps/backend/qa/fixer.py | VERIFY - confirm all agents call get_graphiti_context(). If any agent builds prompt without it, add load_project_memory() call. | TASK_4_COMPLETE |

=== PART B: QA MEMORY BRIDGE (Tasks 5-7) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 5 | Add gotcha promotion to QA | apps/backend/qa/report.py | MODIFY - in persist_issues_to_memory(), after writing issues.md, loop through issues. For each with non-empty 'prevention', call append_gotcha(spec_dir, f'[QA] {prevention} (from QA iteration {iteration})'). Import append_gotcha from memory.patterns. | TASK_5_COMPLETE |
| 6 | Add project memory append to QA | apps/backend/qa/report.py | MODIFY - in persist_issues_to_memory(), also call append_to_project_memory(project_dir, 'gotchas', prevention, f'QA iteration {iteration}'). Add project_dir param to function. Wrap in try/except. | TASK_6_COMPLETE |
| 7 | Add project memory append to post-session | apps/backend/agents/session.py | MODIFY - in post_session_processing(), after save_session_memory(), append patterns/gotchas to PROJECT_MEMORY.md. Wrap in try/except. | TASK_7_COMPLETE |

=== PART C: RALPH PROMPT GENERATION (Tasks 8-10) ===

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 8 | Generate Ralph prompt after planning | apps/backend/spec/pipeline/orchestrator.py | MODIFY - after implementation_plan.json is written, call RalphPromptGenerator to create ralph_prompt.md. try/except. Print status. | TASK_8_COMPLETE |
| 9 | Ensure RalphPromptGenerator works | apps/backend/prompts_pkg/ralph_prompt_generator.py | MODIFY if needed - verify save_prompt(spec_dir) method exists and works. Handle missing implementation_plan.json. | TASK_9_COMPLETE |
| 10 | Add ralph_prompt.md to companion context | apps/backend/agents/companion_agent.py | MODIFY - in build_context(), add ralph_prompt.md to loaded files under '== RALPH CODING PROMPT ==' header. | TASK_10_COMPLETE |

FINAL: <promise>MEGA_FALLBACK_A_COMPLETE</promise>

---

VERIFICATION:
- cd apps/backend && python -c 'from memory.project_memory import load_project_memory, append_to_project_memory; print(\"OK\")'
- cd apps/backend && python -c 'from prompts_pkg.ralph_prompt_generator import RalphPromptGenerator; print(\"OK\")'

---

CRITICAL CONSTRAINTS
1. 10-TASK JOB - Do NOT stop until all tasks complete
2. All changes additive — do NOT break existing functionality
3. Memory operations wrapped in try/except — never crash the pipeline
4. Match existing code patterns
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 10 tasks complete. BEGIN NOW.
" --max-iterations 80 --completion-promise "MEGA_FALLBACK_A_COMPLETE"
```
