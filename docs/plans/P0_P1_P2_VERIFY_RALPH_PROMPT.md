# P0-P1-P2 Verification Pass - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-05
**Tasks:** 6 verifications
**Max Iterations:** 30

---

## Quick Start

Copy and paste this into Ralph:

```bash
/ralph-loop:ralph-loop "
You are completing a VERIFICATION PASS for P0, P1, P2 fixes in Auto-Claude.

YOUR IDENTITY:
- You are a VERIFIER, not an implementer.
- Check that all fixes are in place and working.
- This is a 6-CHECK JOB. Do NOT stop until all checks pass.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Backend: apps/backend/
- Frontend: apps/frontend/

---

VERIFICATION CHECKLIST (6 checks)

| # | Check | What to Verify | Promise |
|---|-------|----------------|---------|
| 1 | P0-a: Task Scope in spec_writer.md | grep '## Task Scope' prompts/spec_writer.md | CHECK_1_PASS |
| 2 | P0-b: Task Scope in spec_quick.md | grep '## Task Scope' prompts/spec_quick.md | CHECK_2_PASS |
| 3 | P0-c: Workflow Type in spec_quick.md | grep '## Workflow Type' prompts/spec_quick.md | CHECK_3_PASS |
| 4 | P0-d: Status transition fix | grep 'planning.*failure' agent-events-handlers.ts | CHECK_4_PASS |
| 5 | P1: FileReadCache exists | grep 'class FileReadCache' agent_runner.py | CHECK_5_PASS |
| 6 | P2: CI test passes | pytest test_prompt_validator_sync.py | CHECK_6_PASS |

FINAL: <promise>ALL_FIXES_VERIFIED</promise>

---

EXECUTION PROTOCOL

1. CHECK 1: Verify Task Scope in spec_writer.md
   cd apps/backend && grep -n '## Task Scope' prompts/spec_writer.md
   Expected: Line ~99 with '## Task Scope'

2. CHECK 2: Verify Task Scope in spec_quick.md
   grep -n '## Task Scope' prompts/spec_quick.md
   Expected: Line ~52 with '## Task Scope'

3. CHECK 3: Verify Workflow Type in spec_quick.md
   grep -n '## Workflow Type' prompts/spec_quick.md
   Expected: Line ~58 with '## Workflow Type'

4. CHECK 4: Verify status transition fix in agent-events-handlers.ts
   cd ../frontend && grep -A5 'FAILURE case' src/main/ipc-handlers/agent-events-handlers.ts
   Expected: Should see phase-aware status logic, NOT hardcoded 'human_review'

5. CHECK 5: Verify FileReadCache in agent_runner.py
   cd ../backend && grep -n 'class FileReadCache' spec/pipeline/agent_runner.py
   Expected: Class definition exists

6. CHECK 6: Run CI sync test
   cd apps/backend && python -m pytest tests/test_prompt_validator_sync.py -v
   Expected: All 5 tests pass

7. FINAL:
   When ALL 6 checks pass:
   <promise>ALL_FIXES_VERIFIED</promise>

---

CRITICAL CONSTRAINTS

1. VERIFY ONLY - Do NOT modify any files.
2. ALL MUST PASS - Every check must succeed.
3. REPORT FAILURES - If any check fails, report which one and why.
4. CONTINUATION - After each check, say: NEXT: Check N

---

CURRENT STATUS: 0 of 6 checks complete. BEGIN NOW.
" --max-iterations 30 --completion-promise "ALL_FIXES_VERIFIED"
```

---

## Check Checklist

- [ ] CHECK 1: Task Scope in spec_writer.md → `<promise>CHECK_1_PASS</promise>`
- [ ] CHECK 2: Task Scope in spec_quick.md → `<promise>CHECK_2_PASS</promise>`
- [ ] CHECK 3: Workflow Type in spec_quick.md → `<promise>CHECK_3_PASS</promise>`
- [ ] CHECK 4: Status transition fix → `<promise>CHECK_4_PASS</promise>`
- [ ] CHECK 5: FileReadCache exists → `<promise>CHECK_5_PASS</promise>`
- [ ] CHECK 6: CI test passes → `<promise>CHECK_6_PASS</promise>`
- [ ] Final → `<promise>ALL_FIXES_VERIFIED</promise>`

---

**Verification Pass - 6 checks | Read-only**
