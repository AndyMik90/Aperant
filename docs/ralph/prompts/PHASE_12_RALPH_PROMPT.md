# Phase 12: Code Quality Refactors - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-04
**Tasks:** 4
**Max Iterations:** 75

---

## Quick Start

Copy and paste this into Ralph:

```bash
/ralph-loop:ralph-loop "
You are completing Phase 12: Code Quality Refactors for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude
- Backend: apps/backend/

Primary documentation:
- docs/plans/PHASE_12_CODE_QUALITY.md (THIS IS YOUR SPEC)
- docs/PROGRESS.md

---

PHASE 12: CODE QUALITY REFACTORS (4 tasks)

| # | Task | File | Promise |
|---|------|------|---------|
| 1 | QUAL-1: Thread-safe cache | core/client.py | QUAL_1_THREADSAFE_COMPLETE |
| 2 | QUAL-2: Async error handling | agents/plan.py | QUAL_2_ASYNCERROR_COMPLETE |
| 3 | QUAL-3: Retry patterns | core/retry.py (new) | QUAL_3_RETRY_COMPLETE |
| 4 | QUAL-4: Exception hierarchy | core/exceptions.py (new) | QUAL_4_EXCEPTIONS_COMPLETE |

FINAL: <promise>PHASE_12_CODE_QUALITY_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs/plans/PHASE_12_CODE_QUALITY.md FULLY first.

2. QUAL-1: Thread-Safe Cache
   - Location: apps/backend/core/client.py
   - Add threading.RLock for cache access
   - Or use functools.lru_cache if stateless
   - Ensure no race conditions

3. QUAL-2: Async Error Handling
   - Location: apps/backend/agents/plan.py
   - Never catch asyncio.CancelledError
   - Log all errors with context
   - Propagate errors to caller

4. QUAL-3: Retry Patterns
   - Create: apps/backend/core/retry.py
   - Implement retry_async() with exponential backoff
   - Use in API calls

5. QUAL-4: Exception Hierarchy
   - Create: apps/backend/core/exceptions.py
   - AutoClaudeError base
   - AgentError, APIError, RateLimitError, etc.
   - Update existing code to use new types

6. VERIFICATION:
   - python -m py_compile apps/backend/core/*.py
   - python -m py_compile apps/backend/agents/*.py
   - npm run build
   - npm test

7. FINAL:
   When ALL 4 promises emitted AND builds pass:
   <promise>PHASE_12_CODE_QUALITY_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all 4 tasks are complete.
2. ALL REQUIRED - Every task must be executed.
3. THREAD SAFETY - Test concurrent access patterns.
4. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 75 --completion-promise "PHASE_12_CODE_QUALITY_COMPLETE"
```

---

## Task Checklist

- [ ] QUAL-1: Thread-safe cache → `<promise>QUAL_1_THREADSAFE_COMPLETE</promise>`
- [ ] QUAL-2: Async error handling → `<promise>QUAL_2_ASYNCERROR_COMPLETE</promise>`
- [ ] QUAL-3: Retry patterns → `<promise>QUAL_3_RETRY_COMPLETE</promise>`
- [ ] QUAL-4: Exception hierarchy → `<promise>QUAL_4_EXCEPTIONS_COMPLETE</promise>`
- [ ] Final → `<promise>PHASE_12_CODE_QUALITY_COMPLETE</promise>`

---

**Phase 12: Code Quality Refactors - 4 tasks | Medium risk**
