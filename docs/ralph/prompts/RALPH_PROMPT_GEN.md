# RALPH_PROMPT_GEN: Generate Ralph Prompt After Planning Phase

**Date:** 2026-02-06
**Tasks:** 3
**Max Iterations:** 40
**Priority:** HIGH
**Status:** READY FOR EXECUTION
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Dependencies:** None (independent of companion prompts)

---

## Problem

After the planning phase creates spec.md and implementation_plan.json, no Ralph Loop prompt is generated. The coding phase should execute a well-structured Ralph prompt, but currently the coder just iterates subtasks with ad-hoc prompts. We need the planning phase to produce a `ralph_prompt.md` as a concrete artifact.

## Goal

After spec creation completes, call the existing `RalphPromptGenerator` to produce `ralph_prompt.md` in the spec directory. This becomes the coding phase's execution instruction.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing RALPH_PROMPT_GEN for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 3-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/

---

OBJECTIVE: After the planning phase completes and creates implementation_plan.json, automatically generate a ralph_prompt.md file in the spec directory using the existing RalphPromptGenerator. This Ralph prompt becomes the coding phase's execution instruction.

Study the existing RalphPromptGenerator at apps/backend/prompts_pkg/ralph_prompt_generator.py to understand its API. Study how spec_runner.py and the orchestrator work to find the right insertion point.

---

RALPH_PROMPT_GEN: 3 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Generate Ralph prompt after planning | apps/backend/spec/pipeline/orchestrator.py | MODIFY - after the planning phase completes (where implementation_plan.json is created), add a call to generate the Ralph prompt. Import RalphPromptGenerator from prompts_pkg.ralph_prompt_generator. Call generator.save_prompt(spec_dir, project_dir) to create ralph_prompt.md in the spec directory. Wrap in try/except so it doesn't break the pipeline if it fails. Log success/failure. This should happen BEFORE the review checkpoint so the user can see the prompt before approving. | TASK_1_COMPLETE |
| 2 | Ensure RalphPromptGenerator reads plan correctly | apps/backend/prompts_pkg/ralph_prompt_generator.py | MODIFY (if needed) - verify that save_prompt() reads implementation_plan.json from the spec_dir and generates a proper Ralph-format prompt with: task table, executor identity, promises, anti-skip rules, verification steps. If the method doesn't exist or doesn't work with spec_dir, add or fix it. The output file should be ralph_prompt.md in the spec_dir. Make sure it handles the case where implementation_plan.json doesn't exist yet (return early). | TASK_2_COMPLETE |
| 3 | Add ralph_prompt.md to companion context | apps/backend/agents/companion_agent.py | MODIFY - in the build_context() method, add ralph_prompt.md to the list of files loaded from spec_dir. If it exists, include it under a '== RALPH PROMPT ==' section header so the companion can show it to users when asked 'show me the coding prompt'. | TASK_3_COMPLETE |

FINAL: <promise>RALPH_PROMPT_GEN_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Use the EXISTING RalphPromptGenerator — do NOT create a new one
2. ralph_prompt.md must be saved in the spec_dir (same directory as spec.md and implementation_plan.json)
3. Generation must happen AFTER implementation_plan.json exists but BEFORE review checkpoint
4. Wrap in try/except — prompt generation failure must NOT break the spec pipeline
5. The generated prompt must follow Ralph format: executor identity, task table with promises, verification, constraints, anti-skip rules
6. If implementation_plan.json doesn't exist, skip generation gracefully
7. Log the generation to stdout so it shows in the terminal output

---

VERIFICATION:
- Run: cd apps/backend && python -c 'from prompts_pkg.ralph_prompt_generator import RalphPromptGenerator; print(\"Import OK\")'
- Import succeeds with no errors

---

CRITICAL CONSTRAINTS

1. 3-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT modify the spec creation pipeline flow — only ADD the prompt generation step
3. Do NOT change how the coder consumes the plan (that's a future task)
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 40 --completion-promise "RALPH_PROMPT_GEN_COMPLETE"
```
