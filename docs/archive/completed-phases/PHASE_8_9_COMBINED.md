# Phase 8+9: UX Polish + Code Sweep (Combined)

**Version:** 1.0
**Date:** 2026-02-04
**Status:** Planning
**Priority:** P1/P2 Combined

---

## Overview

Combined execution of:
- **Phase 8:** 7 UX Polish tasks (frontend)
- **Phase 9:** 12 Code Sweep fixes (backend + tests)

**Total:** 19 tasks

---

## Task Summary

### Phase 8: UX Polish (Frontend)

| ID | Task | Complexity |
|----|------|------------|
| UX-1 | Notification Center | Medium |
| UX-2 | Drag Reorder Within Columns | Medium |
| UX-3 | Loading Skeletons | Low |
| UX-4 | Micro-animations | Low |
| UX-5 | Keyboard Navigation (j/k, Enter, ?) | Low |
| UX-6 | Bulk Operations | Medium |
| UX-7 | Task Duration & ETA Display | Low |

### Phase 9: Code Sweep (Backend + Tests)

| ID | Task | Complexity |
|----|------|------------|
| SWEEP-1 | Add logging to coder.py except blocks | Low |
| SWEEP-2 | Add logging to file_utils.py | Low |
| SWEEP-3 | Preserve exception details in session.py | Low |
| SWEEP-4 | Fix race condition in coder.py | High |
| SWEEP-6 | Add timer cleanup to status.py | Medium |
| SWEEP-7 | Fix async await in memory_manager.py | Medium |
| SWEEP-8 | Fix failing integration test | Medium |
| SWEEP-9 | Fix failing onboarding test | Medium |
| SWEEP-10 | Add SDK emission logging | Low |
| SWEEP-11 | Add CI discovery logging | Low |
| SWEEP-12 | Add debug import logging | Low |
| SWEEP-13 | Add stdin timeout | High |

---

## Ralph Prompt (Phase 8+9 Combined)

```bash
/ralph-loop:ralph-loop "
You are completing Phase 8 (UX Polish) and Phase 9 (Code Sweep) for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 19-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude

Primary documentation:
- docs\plans\PHASE_8_UX_POLISH.md (UX tasks spec)
- docs\plans\PHASE_9_CODE_SWEEP.md (Code sweep spec)
- docs\CODE_SWEEP_REPORT.md (Issue details)
- docs\PROGRESS.md

---

PHASE 8: UX POLISH (7 tasks)

| # | Task | Promise |
|---|------|---------|
| 1 | UX-3: Loading Skeletons | UX_3_SKELETONS_COMPLETE |
| 2 | UX-4: Micro-animations | UX_4_ANIMATIONS_COMPLETE |
| 3 | UX-5: Keyboard Navigation | UX_5_KEYBOARD_NAV_COMPLETE |
| 4 | UX-7: Task Duration & ETA | UX_7_DURATION_ETA_COMPLETE |
| 5 | UX-1: Notification Center | UX_1_NOTIFICATION_CENTER_COMPLETE |
| 6 | UX-2: Drag Reorder | UX_2_DRAG_REORDER_COMPLETE |
| 7 | UX-6: Bulk Operations | UX_6_BULK_OPS_COMPLETE |

After completing Phase 8: <promise>PHASE_8_UX_POLISH_COMPLETE</promise>

---

PHASE 9: CODE SWEEP (12 tasks)

| # | Task | File | Promise |
|---|------|------|---------|
| 8 | SWEEP-1: Add logging | coder.py:630-657 | SWEEP_1_CODER_LOGGING_COMPLETE |
| 9 | SWEEP-2: Add logging | file_utils.py:77 | SWEEP_2_FILE_UTILS_COMPLETE |
| 10 | SWEEP-3: Exception detail | session.py:586 | SWEEP_3_SESSION_EXCEPTION_COMPLETE |
| 11 | SWEEP-10: SDK logging | session.py:70 | SWEEP_10_SDK_LOGGING_COMPLETE |
| 12 | SWEEP-11: CI logging | ci_discovery.py | SWEEP_11_CI_LOGGING_COMPLETE |
| 13 | SWEEP-12: Import logging | workspace.py:39-70 | SWEEP_12_WORKSPACE_COMPLETE |
| 14 | SWEEP-6: Timer cleanup | status.py:175-180 | SWEEP_6_TIMER_CLEANUP_COMPLETE |
| 15 | SWEEP-7: Async await | memory_manager.py | SWEEP_7_ASYNC_AWAIT_COMPLETE |
| 16 | SWEEP-8: Integration test | subprocess-spawn.test.ts | SWEEP_8_INTEGRATION_TEST_COMPLETE |
| 17 | SWEEP-9: Onboarding test | OnboardingWizard.test.tsx | SWEEP_9_ONBOARDING_TEST_COMPLETE |
| 18 | SWEEP-4: Race condition | coder.py:647 | SWEEP_4_RACE_CONDITION_COMPLETE |
| 19 | SWEEP-13: Stdin timeout | user_message_queue.py:121 | SWEEP_13_STDIN_TIMEOUT_COMPLETE |

After completing Phase 9: <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise>

---

FINAL: <promise>PHASE_8_9_ALL_COMPLETE</promise>

---

EXECUTION PROTOCOL

PHASE 8 (Tasks 1-7):
1. Read docs\plans\PHASE_8_UX_POLISH.md fully.
2. Complete each UX task per its specification.
3. After task 7, output: <promise>PHASE_8_UX_POLISH_COMPLETE</promise>
4. Say: NEXT: Phase 9

PHASE 9 (Tasks 8-19):
1. Read docs\plans\PHASE_9_CODE_SWEEP.md fully.
2. For Python files: Add logging with pattern below.
3. For tests: Fix to pass consistently.
4. After task 19, output: <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise>

VERIFICATION:
1. Run: npm run build
2. Run: npm test (fix any new failures)
3. Run: python -m py_compile apps/backend/agents/*.py
4. Fix any errors until all pass.

FINAL:
- When ALL 19 task promises + both phase promises are emitted
- AND builds/tests pass
- Output: <promise>PHASE_8_9_ALL_COMPLETE</promise>

---

PYTHON LOGGING PATTERN

```python
import logging
logger = logging.getLogger(__name__)

except Exception as e:
    logger.warning(f\"Description: {e}\", exc_info=True)
```

---

CRITICAL CONSTRAINTS

1. 19-TASK JOB - Do NOT stop until all 19 tasks are complete.
2. ALL REQUIRED - Every task must be executed.
3. NO SUMMARIES - Progress summaries are NOT stopping points.
4. CONTINUATION - After each task, say: NEXT: Task N

---

ANTI-SKIP RULES

You may NOT skip because:
- Task seems complex
- Current implementation works well
- You prefer a different design

You may ONLY skip if:
- Real error after 3 fix attempts
- Required file does not exist
- Dependency is genuinely missing

If you skip, you MUST:
- Document in docs\PROGRESS.md
- Mark task as blocked, not complete
- Continue to next task

---

HARD STOP RULE

You may NOT stop until:
- All 19 task promises have been output, AND
- <promise>PHASE_8_UX_POLISH_COMPLETE</promise> has been output, AND
- <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise> has been output, AND
- <promise>PHASE_8_9_ALL_COMPLETE</promise> has been output

If you write wrap-up language while tasks remain:
- STOP that thought
- Check how many tasks remain
- Continue with: NEXT: Task N

CURRENT STATUS: 0 of 19 tasks complete. BEGIN NOW.
\" --max-iterations 300 --completion-promise \"PHASE_8_9_ALL_COMPLETE\"
```

---

## Success Criteria

### Phase 8 (UX)
- [ ] Loading skeletons replace spinners
- [ ] Task cards have entrance animations
- [ ] j/k keyboard navigation works
- [ ] ? shows shortcuts help
- [ ] Elapsed time shows on running tasks
- [ ] ETA displayed for in-progress tasks
- [ ] Notification bell in header
- [ ] Can drag tasks within column
- [ ] Can select multiple tasks
- [ ] Bulk actions bar works

### Phase 9 (Code Quality)
- [ ] coder.py has logging in except blocks
- [ ] file_utils.py logs cleanup failures
- [ ] session.py preserves exception type
- [ ] SDK emission failures logged
- [ ] CI discovery errors logged
- [ ] Debug import failures logged
- [ ] StatusManager has cleanup methods
- [ ] memory_manager.py async properly awaited
- [ ] Integration test passes (3x)
- [ ] Onboarding test passes
- [ ] Race condition addressed
- [ ] Stdin has timeout/watchdog

### Build
- [ ] npm run build passes
- [ ] npm test passes (no new failures)
- [ ] Python syntax valid

---

## Estimated Duration

- Phase 8: ~45-60 minutes (7 UX tasks)
- Phase 9: ~30-45 minutes (12 code fixes)
- Verification: ~10 minutes
- **Total: ~90-120 minutes**

Max iterations: 300 (allows for build fixes)

---

**Combined: 19 tasks | 2 phases | 1 run**
