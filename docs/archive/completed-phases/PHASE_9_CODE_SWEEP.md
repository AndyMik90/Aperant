# Phase 9: Code Sweep Fixes

**Version:** 1.0
**Date:** 2026-02-04
**Status:** Planning
**Priority:** P1 - High (Technical debt / stability)

---

## Overview

Address 16 issues identified in the code sweep from 2026-02-04. Focus on Python backend exception handling, thread safety, and test stability.

See: [CODE_SWEEP_REPORT.md](../CODE_SWEEP_REPORT.md)

---

## Task Summary

| Severity | Count | Actionable |
|----------|-------|------------|
| CRITICAL | 3 | 3 |
| MAJOR | 6 | 5 (skip SWEEP-5 thread cache - complex) |
| MINOR | 7 | 4 (skip SWEEP-14/15/16 - dependency/arch) |

**Total actionable:** 12 tasks

---

## Task Specifications

### SWEEP-1: Add Logging to Bare Except in coder.py (CRITICAL)

**File:** `apps/backend/agents/coder.py`
**Lines:** 630-657

**Current:**
```python
except:
    pass  # Silent failure
```

**Target:**
```python
except Exception as e:
    logger.warning(f"Exception in pause/resume loop: {e}", exc_info=True)
```

**Steps:**
1. Find bare `except:` blocks in coder.py lines 630-657
2. Replace with `except Exception as e:` and add logging
3. Ensure logger is imported at top of file

---

### SWEEP-2: Add Logging to file_utils.py (CRITICAL)

**File:** `apps/backend/core/file_utils.py`
**Line:** 77

**Current:**
```python
except Exception:
    os.unlink(tmp_path)  # No logging
```

**Target:**
```python
except Exception as e:
    logger.error(f"Failed to write file, cleaning up temp: {e}", exc_info=True)
    try:
        os.unlink(tmp_path)
    except OSError:
        logger.warning(f"Failed to cleanup temp file: {tmp_path}")
```

**Steps:**
1. Add logger import if missing
2. Log the original exception
3. Wrap cleanup in try-except with logging

---

### SWEEP-3: Improve Exception Handling in session.py (CRITICAL)

**File:** `apps/backend/agents/session.py`
**Line:** 586

**Current:**
```python
except Exception:
    return "Error occurred"  # Generic message
```

**Target:**
```python
except Exception as e:
    logger.error(f"Session error: {type(e).__name__}: {e}", exc_info=True)
    return f"Error: {type(e).__name__}: {str(e)[:200]}"
```

**Steps:**
1. Preserve exception type in error message
2. Add detailed logging
3. Truncate message to prevent overflow

---

### SWEEP-4: Fix Race Condition in coder.py (MAJOR)

**File:** `apps/backend/agents/coder.py`
**Line:** 647

**Issue:** Loop uses `content` from last iteration; multiple messages can cause incorrect flow.

**Target:**
```python
# Process messages atomically
while True:
    msg = queue.get()
    if msg.content == "stop":
        break
    elif msg.content == "continue":
        continue
    # Don't use stale content variable
```

**Steps:**
1. Refactor to process each message independently
2. Remove reliance on previous iteration's `content` variable
3. Add test for rapid message scenario

---

### SWEEP-6: Add Timer Cleanup to status.py (MAJOR)

**File:** `apps/backend/ui/status.py`
**Lines:** 175-180

**Current:** No cleanup of `_write_timer` on garbage collection.

**Target:**
```python
def __del__(self):
    if self._write_timer is not None:
        self._write_timer.cancel()

def close(self):
    """Explicit cleanup method."""
    if self._write_timer is not None:
        self._write_timer.cancel()
        self._write_timer = None
```

**Steps:**
1. Add `__del__` method to cancel pending timer
2. Add explicit `close()` method for deterministic cleanup
3. Update callers to use `close()` when possible

---

### SWEEP-7: Fix Async Await in memory_manager.py (MAJOR)

**File:** `apps/backend/agents/memory_manager.py`
**Lines:** 144, 148, 153

**Issue:** Async methods may not be properly awaited.

**Steps:**
1. Audit all async method calls in memory_manager.py
2. Ensure all are properly awaited
3. Add `asyncio.run()` wrapper if called from sync context

---

### SWEEP-8: Fix Failing Integration Test (MAJOR)

**File:** `src/__tests__/integration/subprocess-spawn.test.ts`
**Test:** "should track running tasks"

**Issue:** Timing/environment issue causing flaky test.

**Steps:**
1. Add explicit waits or use `waitFor` with appropriate timeout
2. Mock timing-sensitive operations if needed
3. Verify test passes consistently (run 3x)

---

### SWEEP-9: Fix Failing Onboarding Test (MAJOR)

**File:** `src/renderer/components/onboarding/OnboardingWizard.test.tsx`
**Test:** "AC1: First-run screen displays with two auth options"

**Issue:** Test expects "Sign in with Anthropic" text that may have changed.

**Steps:**
1. Check current i18n key for auth button
2. Update test to match current text or use i18n key
3. Verify test passes

---

### SWEEP-10: Add Logging to SDK Emission (MINOR)

**File:** `apps/backend/agents/session.py`
**Line:** 70

**Current:**
```python
except Exception:
    pass  # Completely silent
```

**Target:**
```python
except Exception as e:
    logger.debug(f"SDK message emission failed: {e}")
```

---

### SWEEP-11: Add Logging to CI Discovery (MINOR)

**File:** `apps/backend/analysis/ci_discovery.py`
**Lines:** 232, 302, 360, 405, 415

**Steps:**
1. Find all bare except blocks
2. Add `logger.debug()` for each
3. Use debug level to avoid noise in normal operation

---

### SWEEP-12: Add Logging to Debug Import (MINOR)

**File:** `apps/backend/core/workspace.py`
**Lines:** 39-70

**Current:** Silent fallback to no-op functions if debug import fails.

**Target:**
```python
except ImportError as e:
    logger.warning(f"Debug module not available: {e}")
    # Define no-op functions
```

---

### SWEEP-13: Add Timeout to Stdin Reader (MINOR)

**File:** `apps/backend/agents/user_message_queue.py`
**Line:** 121

**Issue:** `sys.stdin.readline()` blocks indefinitely.

**Target:** Add watchdog or use `select` with timeout (platform-dependent).

**Note:** This is complex on Windows. Consider adding a heartbeat check instead.

---

## Skipped Issues

| ID | Issue | Reason |
|----|-------|--------|
| SWEEP-5 | Thread-unsafe cache | Complex refactor, low impact |
| SWEEP-14 | Vite build warning | Dependency issue (chokidar) |
| SWEEP-15 | Large bundle size | Architectural (code splitting) |
| SWEEP-16 | Async error handling | Complex, needs atomic file ops |

---

## Implementation Order

| Order | Task | Complexity | Priority |
|-------|------|------------|----------|
| 1 | SWEEP-1: coder.py logging | Low | CRITICAL |
| 2 | SWEEP-2: file_utils.py logging | Low | CRITICAL |
| 3 | SWEEP-3: session.py exception detail | Low | CRITICAL |
| 4 | SWEEP-10: session.py SDK logging | Low | MINOR |
| 5 | SWEEP-11: ci_discovery.py logging | Low | MINOR |
| 6 | SWEEP-12: workspace.py import logging | Low | MINOR |
| 7 | SWEEP-6: status.py timer cleanup | Medium | MAJOR |
| 8 | SWEEP-7: memory_manager.py async | Medium | MAJOR |
| 9 | SWEEP-8: Fix integration test | Medium | MAJOR |
| 10 | SWEEP-9: Fix onboarding test | Medium | MAJOR |
| 11 | SWEEP-4: coder.py race condition | High | MAJOR |
| 12 | SWEEP-13: stdin timeout | High | MINOR |

---

## Ralph Prompt (Phase 9)

```bash
/ralph-loop:ralph-loop "
You are completing Phase 9: Code Sweep Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely.
- Add logging, not remove functionality.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude

Primary documentation:
- docs\plans\PHASE_9_CODE_SWEEP.md (THIS FILE)
- docs\CODE_SWEEP_REPORT.md
- docs\PROGRESS.md

---

TASKS (12 required)

| # | Task | File | Promise |
|---|------|------|---------|
| 1 | SWEEP-1: Add logging to bare except | coder.py:630-657 | SWEEP_1_CODER_LOGGING_COMPLETE |
| 2 | SWEEP-2: Add logging to file cleanup | file_utils.py:77 | SWEEP_2_FILE_UTILS_COMPLETE |
| 3 | SWEEP-3: Preserve exception details | session.py:586 | SWEEP_3_SESSION_EXCEPTION_COMPLETE |
| 4 | SWEEP-10: Add SDK emission logging | session.py:70 | SWEEP_10_SDK_LOGGING_COMPLETE |
| 5 | SWEEP-11: Add CI discovery logging | ci_discovery.py | SWEEP_11_CI_LOGGING_COMPLETE |
| 6 | SWEEP-12: Add debug import logging | workspace.py:39-70 | SWEEP_12_WORKSPACE_COMPLETE |
| 7 | SWEEP-6: Add timer cleanup | status.py:175-180 | SWEEP_6_TIMER_CLEANUP_COMPLETE |
| 8 | SWEEP-7: Fix async await | memory_manager.py | SWEEP_7_ASYNC_AWAIT_COMPLETE |
| 9 | SWEEP-8: Fix integration test | subprocess-spawn.test.ts | SWEEP_8_INTEGRATION_TEST_COMPLETE |
| 10 | SWEEP-9: Fix onboarding test | OnboardingWizard.test.tsx | SWEEP_9_ONBOARDING_TEST_COMPLETE |
| 11 | SWEEP-4: Fix race condition | coder.py:647 | SWEEP_4_RACE_CONDITION_COMPLETE |
| 12 | SWEEP-13: Add stdin timeout | user_message_queue.py:121 | SWEEP_13_STDIN_TIMEOUT_COMPLETE |

FINAL: <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read PHASE_9_CODE_SWEEP.md and CODE_SWEEP_REPORT.md fully.

2. For each task:
   - Read the target file first
   - Make the specified changes
   - Ensure logger is imported if adding logging
   - Output the task promise
   - Say: NEXT: Task N

3. After all tasks:
   - Run: npm run build (for TypeScript)
   - Run: python -m py_compile apps/backend/agents/coder.py (for Python syntax)
   - Fix any errors

4. Final:
   - When all 12 promises emitted AND builds pass
   - Output: <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise>

---

LOGGING PATTERN FOR PYTHON

Use this pattern for all Python logging additions:

```python
import logging
logger = logging.getLogger(__name__)

# In except blocks:
except Exception as e:
    logger.warning(f"Description: {e}", exc_info=True)
```

---

HARD STOP RULE

- Do NOT stop until <promise>PHASE_9_CODE_SWEEP_COMPLETE</promise> is output.
- If a task is blocked, document in PROGRESS.md and continue to next task.

CURRENT STATUS: 0 of 12 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "PHASE_9_CODE_SWEEP_COMPLETE"
```

---

## Success Criteria

- [ ] SWEEP-1: coder.py bare except blocks have logging
- [ ] SWEEP-2: file_utils.py logs cleanup failures
- [ ] SWEEP-3: session.py preserves exception type in error message
- [ ] SWEEP-10: SDK emission failures logged at debug level
- [ ] SWEEP-11: CI discovery errors logged at debug level
- [ ] SWEEP-12: Debug import failures logged
- [ ] SWEEP-6: StatusManager has __del__ and close() methods
- [ ] SWEEP-7: memory_manager.py async calls properly awaited
- [ ] SWEEP-8: Integration test passes (run 3x to verify)
- [ ] SWEEP-9: Onboarding test passes
- [ ] SWEEP-4: Race condition in coder.py addressed
- [ ] SWEEP-13: Stdin reader has timeout/watchdog
- [ ] Build passes: `npm run build`
- [ ] Python syntax valid: `python -m py_compile apps/backend/agents/*.py`

---

## Related Documentation

- [CODE_SWEEP_REPORT.md](../CODE_SWEEP_REPORT.md) - Full issue details
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) - SWEEP-1 through SWEEP-13
- [TODO.md](../TODO.md) - Master task list

---

**Phase 9: Code Sweep Fixes - 12 tasks**
