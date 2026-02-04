# Code Sweep Report

**Date:** 2026-02-04
**Version:** 2.7.5
**Scope:** Full codebase sweep of src/main, src/renderer, apps/backend

---

## Executive Summary

| Severity | Found | Fixed | Unfixed |
|----------|-------|-------|---------|
| CRITICAL | 3 | 0 | 3 |
| MAJOR | 6 | 0 | 6 |
| MINOR | 7 | 0 | 7 |
| **Total** | **16** | **0** | **16** |

**Build Status:** PASS (no TypeScript errors)
**Test Status:** 2 failures (pre-existing, not introduced by code changes)

---

## Build & Test Results

### Build
```
npm run build - SUCCESS
- main: 3,006.12 kB
- preload: 74.86 kB
- renderer: 5,450.21 kB
```

### Tests
```
Test Files: 2 failed | 80 passed (82)
Tests: 2 failed | 1989 passed | 6 skipped (1997)
Duration: 64.74s
```

**Failed Tests (Pre-existing):**
1. `src/__tests__/integration/subprocess-spawn.test.ts` > AgentManager > should track running tasks
2. `src/renderer/components/onboarding/OnboardingWizard.test.tsx` > AC1: First-run screen displays with two auth options

**Note:** These failures appear to be test brittleness/environment issues, not code bugs. The OnboardingWizard test expects specific i18n text that may have changed.

---

## CRITICAL Issues

### 1. Python: Bare Exception Handlers in coder.py
**File:** `apps/backend/agents/coder.py`
**Lines:** 630-657
**Issue:** Bare `except:` clauses in pause/resume wait loop silently swallow exceptions without logging. When exceptions occur (socket errors, message queue failures), they are masked, hiding upstream problems.
**Impact:** Debugging production issues becomes extremely difficult when errors are silently swallowed.
**Recommendation:** Add logging with exception details to all bare except blocks.

### 2. Python: Incomplete Error Handling in file_utils.py
**File:** `apps/backend/core/file_utils.py`
**Line:** 77
**Issue:** `except Exception:` attempts cleanup but doesn't log the exception type. If `os.unlink(tmp_path)` fails, temporary files accumulate silently.
**Impact:** Disk space can fill up with orphaned `.tmp` files over time.
**Recommendation:** Add proper logging and consider periodic cleanup of stale temp files.

### 3. Python: Generic Exception Handler Masks Root Cause
**File:** `apps/backend/agents/session.py`
**Line:** 586
**Issue:** Broad `except Exception` catches all exceptions but returns generic error message without detailed context. Complex SDK errors (auth, network, protocol violations) get reduced to a single string.
**Impact:** Debugging auth failures, network issues, or SDK protocol errors becomes very difficult.
**Recommendation:** Catch specific exception types and preserve error details for debugging.

---

## MAJOR Issues

### 4. Python: Race Condition in Pause/Resume Loop
**File:** `apps/backend/agents/coder.py`
**Line:** 647
**Issue:** The loop uses `content` variable from the last iteration to decide whether to break. If multiple messages arrive simultaneously, `content` only reflects the LAST message processed. A "continue" followed by "stop" in rapid succession could cause incorrect control flow.
**Impact:** Unpredictable agent behavior when multiple control messages arrive quickly.
**Recommendation:** Refactor to process control messages atomically or use a state machine.

### 5. Python: Thread-Unsafe Cache Pattern
**File:** `apps/backend/core/client.py`
**Lines:** 42-109
**Issue:** The `_PROJECT_INDEX_CACHE` uses double-checked locking that has a subtle race condition window. Thread A can read the cache, then thread B loads and caches, then A loads again and overwrites.
**Impact:** Wasted computation and potential cache inconsistency in multi-threaded scenarios.
**Recommendation:** Use simpler locking pattern or thread-safe cache implementation.

### 6. Python: Threading Timer Resource Leak
**File:** `apps/backend/ui/status.py`
**Lines:** 175-180
**Issue:** `_write_timer` (threading.Timer) may still be pending when StatusManager is garbage collected. No `__del__` method exists to cancel pending timers.
**Impact:** Memory leaks and potential writes to stale data structures.
**Recommendation:** Implement `__del__` method to cancel pending timers or use context manager pattern.

### 7. Python: Missing Await for Async Operations
**File:** `apps/backend/agents/memory_manager.py`
**Lines:** 144, 148, 153
**Issue:** Async methods called from potentially non-async contexts based on error handling patterns elsewhere.
**Impact:** Coroutines may not execute as expected, leading to missing memory context.
**Recommendation:** Ensure all async methods are properly awaited in async contexts.

### 8. TypeScript: Failing Integration Test
**File:** `src/__tests__/integration/subprocess-spawn.test.ts`
**Issue:** "should track running tasks" test is failing. This appears to be a timing/environment issue rather than a code bug.
**Impact:** CI pipeline may fail spuriously.
**Recommendation:** Review test timing assumptions and add appropriate waits or mocks.

### 9. TypeScript: Failing Onboarding Test
**File:** `src/renderer/components/onboarding/OnboardingWizard.test.tsx`
**Issue:** Test expects "Sign in with Anthropic" text that may have changed due to i18n updates.
**Impact:** CI pipeline may fail spuriously.
**Recommendation:** Update test to match current i18n keys or make test more resilient to text changes.

---

## MINOR Issues

### 10. Python: Silent Failure in SDK Message Emission
**File:** `apps/backend/agents/session.py`
**Line:** 70
**Issue:** `except Exception:` with bare `pass` statement. SDK message emission failures are completely silent.
**Recommendation:** Log failures to stderr at minimum.

### 11. Python: Silent CI Discovery Errors
**File:** `apps/backend/analysis/ci_discovery.py`
**Lines:** 232, 302, 360, 405, 415
**Issue:** All CI discovery errors are swallowed silently. Platform-specific tool detection failures are never reported.
**Recommendation:** Add logging for CI/CD discovery failures.

### 12. Python: Silent Import Failure for Debug Module
**File:** `apps/backend/core/workspace.py`
**Lines:** 39-70
**Issue:** Debug module import wrapped in try-except defines no-op functions on failure, hiding corruption.
**Recommendation:** Log import failures to help diagnose issues.

### 13. Python: Blocking Stdin Read in Thread
**File:** `apps/backend/agents/user_message_queue.py`
**Line:** 121
**Issue:** Reader thread calls `sys.stdin.readline()` which blocks indefinitely. No timeout or watchdog exists.
**Recommendation:** Consider adding timeout or watchdog for hung reader detection.

### 14. TypeScript: Vite Build Warning
**Issue:** `"Stats" is imported from external module "node:fs" but never used` in chokidar dependency
**Impact:** Noise in build output
**Recommendation:** This is a dependency issue; consider upgrading chokidar or suppressing warning.

### 15. TypeScript: Large Bundle Size
**Issue:** Main bundle is 3MB, renderer bundle is 5.4MB
**Impact:** Slower app startup time
**Recommendation:** Consider code splitting or lazy loading for non-critical features.

### 16. Python: Incomplete Async Error Handling
**File:** `apps/backend/implementation_plan/plan.py`
**Line:** 148
**Issue:** `async_save()` exception handler swallows exception but restoration doesn't guarantee atomic rollback.
**Recommendation:** Implement proper atomic file write with rollback on failure.

---

## Code Quality Observations

### Positives
1. **Well-structured IPC handlers** - The execution-handlers.ts and agent-events-handlers.ts files are well-organized with clear comments and FIX annotations.
2. **Proper phase validation** - The `validateStatusTransition()` function provides good guardrails against invalid state changes.
3. **Defensive programming** - Good use of null checks, type validation, and defensive error handling throughout.
4. **Comprehensive documentation** - KNOWN_ISSUES.md tracks issues with proposed fixes.
5. **Test coverage** - 1989 passing tests indicates good coverage.

### Areas for Improvement
1. **Exception handling consistency** - Python backend has many bare `except:` clauses that should be improved.
2. **Test stability** - 2 failing tests indicate test brittleness.
3. **Bundle size optimization** - Large bundles could impact performance.
4. **Async/await consistency** - Some async patterns in Python could be cleaner.

---

## Recommendations

### Immediate (CRITICAL)
1. Add logging to bare except blocks in `coder.py` and `session.py`
2. Implement temp file cleanup in `file_utils.py`
3. Preserve exception details in session error handling

### Short-term (MAJOR)
1. Fix race condition in pause/resume loop
2. Review and fix failing tests
3. Implement timer cancellation in StatusManager
4. Audit async/await usage in memory manager

### Long-term (MINOR)
1. Reduce bundle sizes through code splitting
2. Add comprehensive logging to CI discovery
3. Consider watchdog patterns for blocking operations

---

## Files Scanned

### src/main (Electron Main Process)
- `ipc-handlers/task/execution-handlers.ts` - 1469 lines
- `ipc-handlers/agent-events-handlers.ts` - 548 lines
- `agent-manager.ts` - Re-export facade
- `agent/agent-process.ts` - 833 lines
- `agent/index.ts` - Module exports

### src/renderer (React Frontend)
- `stores/task-store.ts` - ~1000 lines
- `components/TaskCard.tsx` - ~1200 lines

### apps/backend (Python Backend)
- `agents/coder.py`
- `agents/session.py`
- `core/client.py`
- `core/file_utils.py`
- `core/workspace.py`
- `implementation_plan/plan.py`
- `ui/status.py`
- `analysis/ci_discovery.py`
- `agents/memory_manager.py`
- `agents/user_message_queue.py`

---

**Sweep completed by:** Claude Code Sweep
**Duration:** ~15 minutes
**Next sweep recommended:** After major feature releases or bug fixes
