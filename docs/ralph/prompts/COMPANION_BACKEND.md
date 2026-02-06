# COMPANION_BACKEND: Create Companion Agent Backend

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 60
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (3m 18s)
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Dependencies:** None (run first)

---

## Problem

When a task's execution phase exits (planning complete, coding complete, QA complete), there's no agent process running. The user can't ask questions about the plan, code, or QA results until they start the next phase. We need a lightweight "companion agent" that auto-spawns in these gaps.

## Goal

Create the backend Python scripts that power the companion agent — a read-only conversational agent with full task context from disk.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing COMPANION_BACKEND for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/
- Frontend: apps/frontend/src/

---

OBJECTIVE: Create the backend Python companion agent that provides a read-only conversational interface for users between task phases. The companion agent loads all task context from spec_dir files (spec.md, implementation_plan.json, qa_report.md) and uses the Claude SDK with Read/Glob/Grep tools only.

Study the existing agent patterns in apps/backend/agents/ (especially planner.py), the SDK client in apps/backend/core/client.py, and the UserMessageQueue in apps/backend/agents/user_message_queue.py to match the existing code style exactly.

---

COMPANION_BACKEND: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create companion agent class | apps/backend/agents/companion_agent.py | CREATE - a CompanionAgent class with: (a) __init__ taking spec_dir, project_dir, task_title, current_phase args. (b) build_context() method that reads spec.md, implementation_plan.json, qa_report.md, task_metadata.json, and context.json from spec_dir — each is optional, only include what exists. Returns a formatted string with section headers. (c) build_system_prompt() that combines the context with instructions telling the agent it is read-only, can answer questions about the task, and has Read/Glob/Grep tools. (d) async run() method that creates an SDK client (use create_client from core.client), initializes UserMessageQueue, prints a ready message to stdout, then loops: wait for user message from queue, send to Claude with system prompt, stream response to stdout. Use the same __SDK_MSG__ output format as other agents. | TASK_1_COMPLETE |
| 2 | Create companion runner CLI | apps/backend/runners/companion_runner.py | CREATE - CLI entry point using argparse with args: --spec-dir (required), --project-dir (required), --task-title (required), --current-phase (required, choices: spec_complete/planning/coding_complete/qa_complete/human_review), --task-id (required), --model (default: sonnet). Main function creates CompanionAgent and calls run(). Handle SIGTERM gracefully for clean shutdown. Follow the same pattern as runners/spec_runner.py for CLI structure. | TASK_2_COMPLETE |
| 3 | Add companion to phase config | apps/backend/phase_config.py | MODIFY - add a COMPANION_CONFIG section to phase_config.py with: model (sonnet), thinking_budget (2048 — low, this is Q&A), allowed_tools (['Read', 'Glob', 'Grep']), max_turns (25). Follow the existing PHASE_CONFIG pattern. | TASK_3_COMPLETE |
| 4 | Test companion runs standalone | apps/backend/runners/companion_runner.py | VERIFY - add a simple test block at the bottom of companion_runner.py (if __name__ == '__main__': main()) and ensure the module imports work. Run: cd apps/backend && python -c 'from agents.companion_agent import CompanionAgent; print(\"OK\")' to verify the import works. | TASK_4_COMPLETE |

FINAL: <promise>COMPANION_BACKEND_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. CompanionAgent must use the SAME SDK client pattern as other agents (create_client from core.client)
2. Must use UserMessageQueue for stdin message handling (same pattern as existing agents)
3. Output format must use __SDK_MSG__ structured markers so the frontend parser works
4. Tools restricted to Read, Glob, Grep ONLY — the companion must NOT have Write, Edit, Bash, or Task
5. System prompt must include all available context from spec_dir files
6. The agent should be conversational — wait for user input, respond, wait again
7. Handle missing files gracefully — not all spec_dir files exist at every phase
8. Print a clear 'ready' message when companion starts (so frontend knows it's up)
9. Handle SIGTERM for graceful shutdown (frontend sends this when execution phase starts)

---

VERIFICATION:
- Run: cd apps/backend && python -c 'from agents.companion_agent import CompanionAgent; print(\"Import OK\")'
- Run: cd apps/backend && python -c 'from runners.companion_runner import main; print(\"Import OK\")'
- Both imports succeed with no errors

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Follow EXISTING code patterns — match the style of planner.py and spec_runner.py
3. Do NOT install any new packages — use only what's already in requirements
4. Do NOT modify any existing agent files — only create new ones and modify phase_config
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "COMPANION_BACKEND_COMPLETE"
```
