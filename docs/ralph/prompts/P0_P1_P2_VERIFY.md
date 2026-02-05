# P0-P1-P2 Verification Pass

**Date:** 2026-02-05
**Tasks:** 6 checks
**Max Iterations:** 30

---

## Copy-Paste Prompt

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

CURRENT STATUS: 0 of 6 checks complete. BEGIN NOW.
" --max-iterations 30 --completion-promise "ALL_FIXES_VERIFIED"
```
