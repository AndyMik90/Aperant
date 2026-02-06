# ADAPTIVE_TASK_ROUTING: Intelligent Model Selection

**Date:** 2026-02-06
**Tasks:** 8
**Max Iterations:** 80
**Priority:** HIGH
**Status:** READY FOR EXECUTION

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing ADAPTIVE_TASK_ROUTING for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is an 8-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

---

OBJECTIVE: Add intelligent task complexity classification that routes tasks through optimized pipelines.

The system should:
- Classify tasks as SIMPLE, MEDIUM, or COMPLEX using Haiku (fast & cheap)
- Use appropriate models per complexity: Simple=Haiku, Medium=Sonnet, Complex=Opus for planning
- Skip QA phase for simple tasks
- Show complexity badge on task cards in the UI

Model routing:
| Complexity | Planning | Coding | QA |
|------------|----------|--------|-----|
| SIMPLE | Haiku | Haiku | Skip |
| MEDIUM | Sonnet | Sonnet | Haiku |
| COMPLEX | Opus | Sonnet | Sonnet |

---

ADAPTIVE_TASK_ROUTING: 8 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create classifier | apps/backend/agents/complexity_classifier.py | NEW FILE - classify tasks using Haiku | TASK_1_COMPLETE |
| 2 | Update phase config | apps/backend/phase_config.py | Add COMPLEXITY_PHASE_CONFIG dict | TASK_2_COMPLETE |
| 3 | Integrate classifier | apps/backend/runners/spec_runner.py | Call classifier at start of spec creation | TASK_3_COMPLETE |
| 4 | Skip QA for simple | apps/backend/agents/coder.py | Check complexity before QA phase | TASK_4_COMPLETE |
| 5 | Add frontend types | apps/frontend/src/shared/types.ts | Add TaskComplexity type | TASK_5_COMPLETE |
| 6 | Parse complexity | apps/frontend/src/main/agent/agent-events.ts | Parse 'Task complexity: X - reason' output | TASK_6_COMPLETE |
| 7 | Emit complexity | apps/frontend/src/main/agent/agent-process.ts | Emit complexity-classified event | TASK_7_COMPLETE |
| 8 | Display badge | apps/frontend/src/renderer/components/TaskCard.tsx | Show colored complexity badge | TASK_8_COMPLETE |

FINAL: <promise>ADAPTIVE_ROUTING_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Classifier must use claude-haiku-4-5-20251001 for speed
2. Output format: print('Task complexity: {level} - {reason}')
3. Emit __EXEC_PHASE__:classifying before classification
4. Store complexity in task_metadata.json
5. Default to MEDIUM if classification fails
6. Badge colors: SIMPLE=green, MEDIUM=yellow, COMPLEX=red

---

VERIFICATION:
- Run: npm run build (must pass)
- Python syntax checks on new/modified .py files

---

CRITICAL CONSTRAINTS

1. 8-TASK JOB - Do NOT stop until all 8 tasks are complete.
2. USE HAIKU - The classifier MUST use Haiku for speed
3. DEFAULT TO MEDIUM - If classification fails
4. BUILD MUST PASS
5. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 8 tasks complete. BEGIN NOW.
" --max-iterations 80 --completion-promise "ADAPTIVE_ROUTING_COMPLETE"
```

---

## Expected Results

| Complexity | Planning Model | Coding Model | QA Phase | Est. Time |
|------------|----------------|--------------|----------|-----------|
| SIMPLE | Haiku | Haiku | Skip | ~30 sec |
| MEDIUM | Sonnet | Sonnet | Quick (Haiku) | 2-3 min |
| COMPLEX | Opus | Sonnet | Full (Sonnet) | 5-8 min |

## Files Modified

1. `apps/backend/agents/complexity_classifier.py` (NEW)
2. `apps/backend/phase_config.py`
3. `apps/backend/runners/spec_runner.py`
4. `apps/backend/agents/coder.py`
5. `apps/frontend/src/shared/types.ts`
6. `apps/frontend/src/main/agent/agent-events.ts`
7. `apps/frontend/src/main/agent/agent-process.ts`
8. `apps/frontend/src/renderer/components/TaskCard.tsx`

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Simple task time | ~3-5 min | < 1 min |
| Medium task time | ~5-8 min | 2-3 min |
| Complex task time | ~8-15 min | 5-8 min |
| Average task time | ~6 min | ~2.5 min |
