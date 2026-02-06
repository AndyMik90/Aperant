# Ralph Prompt Writing Guide

A guide for writing effective Ralph Loop prompts that get results.

---

## Core Principle

**Tell Ralph WHAT to do, not HOW to do it.**

Ralph is an intelligent agent. Give clear objectives and constraints, then let Ralph figure out the implementation.

---

## Prompt Structure

Every Ralph prompt should follow this structure:

```
1. IDENTITY      - Who Ralph is and the scope of work
2. REPOSITORY    - Project paths and key locations
3. OBJECTIVE     - What we're trying to achieve (high level)
4. TASK TABLE    - Specific tasks with files and promises
5. REQUIREMENTS  - Key constraints and rules
6. VERIFICATION  - How to confirm success
7. CONSTRAINTS   - Critical rules that must be followed
8. ANTI-SKIP     - Rules to prevent premature completion
9. STATUS        - Current progress indicator
```

---

## Good vs Bad Examples

### BAD: Telling Ralph HOW (too detailed)

```
TASK 1: Create the classifier
- File: classifier.py
- Implementation:
  ```python
  from enum import Enum
  class TaskComplexity(Enum):
      SIMPLE = 'simple'
      MEDIUM = 'medium'

  def classify(task):
      client = Anthropic()
      response = client.messages.create(
          model='claude-haiku',
          ...
      )
  ```
```

This is too prescriptive. You're writing the code for Ralph.

### GOOD: Telling Ralph WHAT (objective-focused)

```
TASK 1: Create classifier
- File: apps/backend/agents/complexity_classifier.py
- Action: NEW FILE - classify tasks as SIMPLE/MEDIUM/COMPLEX using Haiku
- Promise: TASK_1_COMPLETE
```

Ralph knows how to write Python. Just tell it what you need.

---

## Template

```bash
/ralph-loop:ralph-loop "
You are implementing [FEATURE_NAME] for [PROJECT].

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a [N]-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: [PATH]
- Frontend: [PATH]
- Backend: [PATH]

---

OBJECTIVE: [Clear 1-2 sentence description of what we're building]

[Optional: Brief context or requirements list]

---

[FEATURE_NAME]: [N] TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | [Short name] | [file path] | [Brief action] | TASK_1_COMPLETE |
| 2 | [Short name] | [file path] | [Brief action] | TASK_2_COMPLETE |
...

FINAL: <promise>[FEATURE]_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. [Requirement 1]
2. [Requirement 2]
...

---

VERIFICATION:
- [How to verify success]

---

CRITICAL CONSTRAINTS

1. [N]-TASK JOB - Do NOT stop until all tasks complete
2. [Key constraint]
3. BUILD MUST PASS
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of [N] tasks complete. BEGIN NOW.
" --max-iterations [N*10] --completion-promise "[FEATURE]_COMPLETE"
```

---

## Key Elements Explained

### YOUR IDENTITY
Sets Ralph's mindset. Always include:
- EXECUTOR, not EVALUATOR (prevents analysis paralysis)
- Task count (creates accountability)
- "Do NOT stop" instruction (prevents early termination)

### TASK TABLE
The heart of the prompt. Each row should have:
- **#**: Sequential number
- **Task**: 2-4 word description
- **File**: Full path from project root
- **Action**: Brief description (NEW FILE, ADD, MODIFY, etc.)
- **Promise**: What Ralph says when done (TASK_N_COMPLETE)

### KEY REQUIREMENTS
Specific constraints that affect implementation:
- Model names (e.g., "use claude-haiku-4-5-20251001")
- Output formats (e.g., "print 'Task complexity: X'")
- Behavior rules (e.g., "default to MEDIUM on failure")

Keep these short and specific. Don't include code.

### VERIFICATION
How Ralph confirms success:
- Build commands
- Test commands
- Syntax checks

### ANTI-SKIP RULES
Prevents Ralph from:
- Skipping tasks
- Marking incomplete work as done
- Outputting final promise prematurely

---

## Sizing Guidelines

| Task Count | Max Iterations | Complexity |
|------------|----------------|------------|
| 2-4 | 40-50 | Simple |
| 5-8 | 60-80 | Medium |
| 9-12 | 100-120 | Complex |
| 13+ | **Must split** | Exceeds input limit |

### Prompt Length Limit (IMPORTANT)

**Ralph Loop has a maximum input string length.** Discovered 2026-02-06: a 14-task mega prompt (~6000 words) caused Claude Code to crash on input — the command string was too long for the shell/CLI to accept.

**Hard limits observed:**
- **10 tasks with medium detail** — Works reliably (Fallback A: 10 tasks, ~3000 words)
- **14 tasks with full detail** — Crashes on input (Mega: 14 tasks, ~6000 words)
- **Sweet spot: 4-8 tasks** — Best reliability and quality

**If you need 10+ tasks:** Split into domain-based batches (e.g., backend + frontend) rather than one mega prompt. Keep each batch under ~4000 words of prompt text.

**Workaround for large feature sets:**
1. Write the mega prompt as documentation (for reference)
2. Split into 2-3 domain-focused prompts
3. Run sequentially with dependencies noted
4. Compare: smaller prompts consistently outperform mega prompts in reliability

### Stress Test Results (2026-02-06)

Attempted 14 tasks across 4 features. Results:

| Attempt | Tasks | Duration | Per Task | Result |
|---------|-------|----------|----------|--------|
| Mega (14 tasks) | 0/14 | N/A | N/A | ❌ CLI crashed — input too long |
| Fallback A (10 backend) | 10/10 | 6m 2s | **36s** | ✅ Record speed |
| Fallback B (4 frontend) | 4/4 | 18m 28s | 4m 37s | ✅ Slow but complete |

**Key findings:**
1. **10 backend tasks in 6 min** — proof that high task counts work when domain is consistent (all Python, no build checks between tasks)
2. **4 frontend tasks took 18 min** — frontend tasks with IPC+component creation are inherently slower (more files to read, build verification)
3. **Backend-only prompts are fastest** — no build overhead, Python imports verify quickly
4. **Split by domain, not by size** — 10 backend tasks (6 min) was faster than 4 frontend tasks (18 min)
5. **Per-task speed varies wildly by complexity** — simple Python modifications: ~36s, new React components + IPC: ~4.5 min

---

## Common Mistakes

### 1. Too much implementation detail
❌ Including code snippets
❌ Step-by-step instructions
❌ Explaining algorithms

✅ Just state the objective and constraints

### 2. Vague task descriptions
❌ "Fix the bug"
❌ "Improve performance"
❌ "Update the code"

✅ "Add error handling to API calls in user-service.ts"
✅ "Add caching to getProjectData() with 5min TTL"
✅ "Replace moment.js with date-fns in date-utils.ts"

### 3. Missing file paths
❌ "Update the config file"
✅ "Update apps/backend/config/settings.py"

### 4. No verification step
Always include how to verify success (build, test, lint)

### 5. Too many tasks
If you have 15+ tasks, split into multiple Ralph prompts

---

## Prompt Checklist

Before running a Ralph prompt, verify:

- [ ] Identity section includes task count
- [ ] Repository paths are correct
- [ ] Objective is clear in 1-2 sentences
- [ ] Task table has all columns filled
- [ ] File paths are complete (from project root)
- [ ] Actions are brief but specific
- [ ] Each task has a promise
- [ ] Key requirements are listed (not code)
- [ ] Verification commands included
- [ ] Max iterations sized appropriately
- [ ] Completion promise matches FINAL line
- [ ] No code snippets in the prompt

---

## Example Prompts

See these files for reference implementations:

- `docs/ralph/prompts/SWEEP_P0_CRITICAL.md` - 4 task bug fix prompt
- `docs/ralph/prompts/SWEEP_P1_FRONTEND.md` - 5 task frontend fixes
- `docs/ralph/prompts/SWEEP_P1_BACKEND.md` - 4 task backend fixes
- `docs/ralph/prompts/ADAPTIVE_TASK_ROUTING.md` - 8 task feature build

---

## Quick Reference

```
WHAT to include:
- Clear objectives
- File paths
- Constraints
- Verification steps

WHAT to exclude:
- Code snippets
- Implementation details
- Step-by-step instructions
- Algorithm explanations
```

**Remember: Ralph is smart. Trust the agent.**
