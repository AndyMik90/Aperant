# Jerry — Comprehensive Code Sweep Findings & Remediation Plan

**Date:** February 6, 2026
**Scope:** Full codebase — backend (Python), frontend (Electron/React/TypeScript), CI/CD, tests, config
**Total Issues Found:** 70

---

## Remediation Progress

| Phase | Status | Issues Fixed |
|-------|--------|-------------|
| Phase 1 — Critical | COMPLETE | 8/8 |
| Phase 2 — High Priority | COMPLETE | 12/12 |
| Phase 3 — Medium | COMPLETE | 20/20 |
| Phase 4 — Low | COMPLETE | 26/26 |

---

## Executive Summary

A thorough sweep of the Jerry codebase identified 70 issues across 4 severity levels. The most urgent are 3 resource leak bugs in the Python backend and 5 race condition / stale closure bugs in the frontend React layer. The codebase is fundamentally healthy — no security breaches, no data corruption bugs in production paths — but the critical items can cause resource exhaustion and inconsistent UI state under load.

| Severity | Backend | Frontend | Cross-Cutting | Total |
|----------|---------|----------|---------------|-------|
| Critical | 3 | 5 | 0 | **8** |
| High | 6 | 0 | 0 | **6** |
| Medium | 8 | 14 | 8 | **30** |
| Low | 5 | 11 | 10 | **26** |
| **Total** | **22** | **30** | **18** | **70** |

---

## Phase 1 — Critical Fixes

### 1.1 File Descriptor Leak in `locked_write()`

- **File:** `apps/backend/runners/github/file_lock.py` — line 297
- **Severity:** CRITICAL
- **Category:** Resource Leak
- **Description:** `locked_write()` calls `os.fdopen(fd, mode)` which can fail after the file descriptor is already open. If `os.fdopen()` raises an exception, the raw fd is never closed, causing resource exhaustion over time.
- **Suggested Fix:** Wrap `os.fdopen()` in try-except; explicitly close `fd` in the except branch before re-raising.

### 1.2 File Lock Resource Leak — No Timeout, Bare Except

- **File:** `apps/backend/memory/project_memory.py` — lines 31–56
- **Severity:** CRITICAL
- **Category:** Resource Leak / Error Handling
- **Description:** The `_file_lock` context manager has three issues: (a) no timeout on lock acquisition — can hang forever if another process holds the lock; (b) bare `except Exception: pass` at line 54 silently swallows all unlock errors; (c) no validation that the lock was actually acquired before yielding.
- **Suggested Fix:** Add a 5-second timeout parameter. Replace `except Exception: pass` with `except (OSError, IOError) as e:` plus `logger.warning(...)`. Add an assertion after lock acquisition.

### 1.3 Bare Except Swallowing Errors

- **File:** `apps/backend/memory/project_memory.py` — line 54
- **Severity:** CRITICAL
- **Category:** Error Handling
- **Description:** `except Exception: pass` in the finally block of the file lock makes it impossible to diagnose lock failures. This is part of issue 1.2 and will be fixed together.
- **Suggested Fix:** Replace with `except (OSError, IOError) as e: logger.warning(f"Error unlocking fd {fd}: {e}")`.

### 1.4 Terminal Persistence Save Loop Race Condition

- **File:** `apps/frontend/src/main/terminal/terminal-manager.ts` — lines 42–46
- **Severity:** CRITICAL
- **Category:** Race Condition
- **Description:** A `setInterval` fires every 30 seconds calling `SessionHandler.persistAllSessionsAsync()` without waiting for the previous save to finish. If persistence takes longer than 30 seconds (large session data, slow disk), multiple concurrent writes will interleave and potentially corrupt JSON session files.
- **Suggested Fix:** Add a save-in-progress mutex. If a save is already running when the timer fires, queue the next save instead of starting a concurrent one.

### 1.5 App Quit Race Condition — Async Cleanup Not Awaited

- **File:** `apps/frontend/src/main/index.ts` — lines 467–484
- **Severity:** CRITICAL
- **Category:** Race Condition / Data Loss
- **Description:** The `before-quit` handler uses `async () => { ... }` but Node.js/Electron does not guarantee it will wait for all async operations to complete before the process exits. Critical cleanup (session persistence, terminal teardown) may not finish.
- **Suggested Fix:** Refactor to use `event.preventDefault()` + explicit promise chain + `app.quit()` after cleanup completes, with a hard timeout fallback (e.g., 5 seconds).

### 1.6 useIpc Stale Closure — Module-Level Shared State

- **File:** `apps/frontend/src/renderer/hooks/useIpc.ts` — lines 46–48
- **Severity:** CRITICAL
- **Category:** Stale Closure
- **Description:** `batchQueue`, `batchTimeout`, and `storeActionsRef` are declared at module level, meaning they're shared across all component instances. On unmount, cleanup runs but doesn't guarantee `flushBatch()` completes before callbacks are cleared. Updates can be queued after cleanup.
- **Suggested Fix:** Convert `storeActionsRef` to a `useRef()` inside the hook. Add cleanup guards to prevent queuing updates after unmount.

### 1.7 useIpc Store Action References Go Stale

- **File:** `apps/frontend/src/renderer/hooks/useIpc.ts` — line 176
- **Severity:** CRITICAL
- **Category:** Stale Closure
- **Description:** `storeActionsRef = { updateTaskStatus, ... }` is updated on every render but outside of `useEffect`. If a batch update was queued with the old reference and the component re-renders before the batch flushes, the old (stale) action function will be called.
- **Suggested Fix:** Move the ref update inside useEffect with proper dependencies. Add guard checks before using the ref in batch flush.

### 1.8 Task Status + Execution Progress Race Condition

- **File:** `apps/frontend/src/renderer/stores/task-store.ts` — lines 203–234
- **Severity:** CRITICAL
- **Category:** Race Condition
- **Description:** `updateTaskStatus()` writes to `executionProgress` based on status transitions. A concurrent call to `updateExecutionProgress()` between the status read and progress write will have its data silently overwritten.
- **Suggested Fix:** Add sequence numbers to progress updates. Compare sequence before overwriting — never replace newer data with older. Alternatively, combine status + progress into an atomic update.

---

## Phase 2 — High-Priority Fixes

### 2.1 Overly Broad Exception Handling (~36 locations)

- **Files:** `apps/backend/core/client.py`, `core/auth.py`, `agents/coder.py`, `agents/session.py`
- **Severity:** HIGH
- **Category:** Error Handling
- **Description:** Bare `except:` and `except Exception:` blocks in ~36 locations mask real errors. Some catch-all handlers also swallow `KeyboardInterrupt` and `SystemExit`.
- **Suggested Fix:** Replace with specific exception types (`FileNotFoundError`, `OSError`, `ValueError`, `json.JSONDecodeError`, etc.). Add structured logging for every caught exception.

### 2.2 Config Loading Failures Not Logged

- **Files:** `apps/backend/core/client.py` (create_client), `core/auth.py` (token resolution), `integrations/graphiti/config.py`
- **Severity:** HIGH
- **Category:** Observability
- **Description:** Configuration failures (missing env vars, invalid tokens, provider errors) are caught but never logged, making production debugging impossible.
- **Suggested Fix:** Add `logger.debug()` / `logger.warning()` at each config loading point. Include sanitized config values (never log secrets).

### 2.3 TYPE_CHECKING Import Confusion

- **Files:** Multiple backend files
- **Severity:** HIGH
- **Category:** Type Safety
- **Description:** Some `TYPE_CHECKING` imports are used at runtime, causing `NameError` in certain code paths. Forward references aren't consistently used.
- **Suggested Fix:** Audit all `TYPE_CHECKING` blocks. Ensure all type-only references use string literals. Add integration test that imports all modules.

### 2.4 Missing None Checks Before Attribute Access

- **Files:** `apps/backend/agents/session.py`, `agents/coder.py`, `core/client.py`
- **Severity:** HIGH
- **Category:** Bug — AttributeError
- **Description:** Code accesses `.attr` on objects that may be `None` without checking first. This causes `AttributeError` exceptions in edge cases (empty configs, missing optional fields).
- **Suggested Fix:** Add explicit `if obj is not None:` guards. Use type narrowing or `Optional[]` annotations.

### 2.5 Division by Zero Risk in Progress Calculations

- **Files:** `apps/backend/agents/session.py`, `core/progress.py`, `runners/github/`
- **Severity:** HIGH
- **Category:** Bug — ZeroDivisionError
- **Description:** Progress percentage calculations divide by total count without checking for zero. Happens when a spec has no subtasks or rate limit has zero remaining.
- **Suggested Fix:** Add `max(denominator, 1)` or explicit zero-check guards.

### 2.6 Unchecked Subprocess Return Codes

- **Files:** `apps/backend/core/git_executable.py`, `core/gh_executable.py`
- **Severity:** HIGH
- **Category:** Silent Failure
- **Description:** `subprocess.run()` calls don't check `returncode`. Git and GitHub CLI commands can fail silently, leaving the system in an inconsistent state.
- **Suggested Fix:** Use `check=True` or explicitly check `result.returncode`. Capture and log stderr on failure.

### 2.7 Synchronous FS Operations in IPC Handlers

- **File:** `apps/frontend/src/main/ipc-handlers/file-handlers.ts` — lines 59, 108
- **Severity:** MEDIUM (elevated due to UX impact)
- **Category:** Performance / Main Thread Blocking
- **Description:** `readdirSync()` and `statSync()` in IPC handlers block the Electron main process. For large directories, this causes visible UI freezing.
- **Suggested Fix:** Convert to `fs.promises.readdir()` and `fs.promises.stat()`. The handlers are already async.

### 2.8 Path Traversal Validation Incomplete

- **File:** `apps/frontend/src/main/ipc-handlers/file-handlers.ts` — lines 15–32
- **Severity:** MEDIUM (elevated due to security implications)
- **Category:** Security
- **Description:** Path validation splits on `path.sep` and checks for `..` but doesn't handle Unicode normalization attacks on macOS or double-encoded sequences. `path.normalize()` alone isn't sufficient.
- **Suggested Fix:** Use `fs.realpathSync()` to resolve to canonical path, then verify it starts with the allowed project directory.

### 2.9 Error Boundary Hardcoded English Strings

- **File:** `apps/frontend/src/renderer/components/ui/error-boundary.tsx` — line 58
- **Severity:** MEDIUM
- **Category:** i18n
- **Description:** Error boundary shows "Something went wrong" and "An error occurred..." as hardcoded English. Not translatable.
- **Suggested Fix:** Add keys to `en/errors.json` and `fr/errors.json`. Import `useTranslation()` in the boundary.

### 2.10 localStorage Race Condition in Task Order

- **File:** `apps/frontend/src/renderer/stores/task-store.ts` — lines 118–126
- **Severity:** MEDIUM
- **Category:** Race Condition
- **Description:** `TaskOrderState` is persisted to localStorage via `saveTaskOrder()`. Rapid reordering can queue multiple writes, and if multiple windows access the same project, they'll overwrite each other.
- **Suggested Fix:** Debounce writes (500ms). Add a version/timestamp to detect stale data.

### 2.11 Terminal Resume Errors Not Shown to User

- **File:** `apps/frontend/src/main/terminal/terminal-manager.ts` — lines 89–91
- **Severity:** MEDIUM
- **Category:** Error Handling / UX
- **Description:** `resumeClaudeAsync()` errors are caught and logged via `debugError()` but never propagated to the UI. Users see a silently failed terminal with no feedback.
- **Suggested Fix:** Emit an IPC event on failure. Show toast notification in renderer. Add retry with exponential backoff.

### 2.12 CI Action Version Inconsistency

- **File:** `.github/workflows/build-prebuilds.yml` — line 101
- **Severity:** MEDIUM
- **Category:** CI/CD
- **Description:** Uses `softprops/action-gh-release@v1` while `release.yml` and `beta-release.yml` use `@v2`. Inconsistent behavior across workflows.
- **Suggested Fix:** Standardize all workflows to `@v2`.

---

## Phase 3 — Medium-Priority Improvements

### Backend (8 issues)

| # | Issue | Files | Est. |
|---|-------|-------|------|
| 3.1 | Dead code / unused imports | Multiple | 1h |
| 3.2 | Inconsistent error message formats | Multiple | 1h |
| 3.3 | Missing docstrings on public functions | Multiple | 30m |
| 3.4 | Hardcoded values that should be configurable | Multiple | 30m |
| 3.5 | Incomplete input validation | Multiple | 30m |
| 3.6 | Missing type hints on functions | Multiple | 30m |
| 3.7 | Redundant try-except patterns | Multiple | 15m |
| 3.8 | Inconsistent logging levels | Multiple | 15m |

### Frontend (7 issues)

| # | Issue | File | Est. |
|---|-------|------|------|
| 3.9 | 1,131 type assertions (excessive `as` casts) | Multiple (top 20 files) | 3h |
| 3.10 | Missing error toasts on critical store failures | `task-store.ts` | 1.5h |
| 3.11 | Date comparison by reference not value | `KanbanBoard.tsx:111` | 15m |
| 3.12 | Hardcoded `process.platform` checks (4+ places) | `index.ts`, others | 1h |
| 3.13 | `useSensors` array not memoized | `KanbanBoard.tsx:183` | 15m |
| 3.14 | Batch queue no size cap (16ms timeout) | `useIpc.ts:144` | 30m |
| 3.15 | Non-ENOENT file errors silently ignored | `index.ts:367-371` | 15m |

### Cross-Cutting (5 issues)

| # | Issue | File | Est. |
|---|-------|------|------|
| 3.16 | install-backend.js relative path without validation | `scripts/install-backend.js:118` | 30m |
| 3.17 | Hardcoded test mock configuration | `tests/conftest.py:104-116` | 45m |
| 3.18 | No `.env` variable validation at install time | `scripts/install-backend.js` | 30m |
| 3.19 | `sed` in pre-commit not macOS-compatible | `.pre-commit-config.yaml:33` | 15m |
| 3.20 | bump-version.js missing file existence validation | `scripts/bump-version.js:137-149` | 15m |

---

## Phase 4 — Low-Priority Cleanup

### Backend (5 issues)
- Code style inconsistencies
- TODO/FIXME comments left in place
- Minor naming convention issues
- Overly long functions needing decomposition
- Minor documentation gaps

### Frontend (11 issues)
- Excessive debug logging in terminal writes (`terminal-manager.ts:125-135`)
- `window.DEBUG` in React component (`KanbanBoard.tsx:154`) — should use store/context
- URL validation gap in `setWindowOpenHandler` for `mailto:` (`index.ts:207-226`)
- `.env` file exposure risk in file explorer IPC (`file-handlers.ts:64-68`)
- Build config manual dependency list (`electron.vite.config.ts:24-48`)
- TypeScript path alias mismatch (`tsconfig.json:16-24`)
- i18n gaps (FIX-* and SUG-* comment items)
- Missing ARIA `role="alert"` on error boundary (`error-boundary.tsx:53-75`)
- Missing `aria-label` on Kanban drag-drop columns (`KanbanBoard.tsx:197+`)
- DevTools auto-open in dev mode consumes resources (`index.ts:236-238`)
- Memory service cross-platform path detection fragile (`memory-service.ts:144-146`)

### Cross-Cutting (10 issues)
- Incomplete TODO in `apps/backend/core/workspace.py:1584-1586`
- Documentation clarity gaps in `docs/KNOWN_ISSUES.md`
- Pre-commit code duplication (3 places)
- TypeScript paths not validated against actual directory structure
- Missing AGPL license headers on backend files
- Version tag pattern in cleanup script doesn't support pre-release
- `.gitignore` redundant entries (lines 165, 170-175)
- Python 3.13 CI testing limited to Linux only
- Hardcoded Windows Python paths in `scripts/install-backend.js:34-39`
- Architecture docs not cross-referenced with current code

---

## Remediation Schedule

| Phase | Issues | Est. Time | Target |
|-------|--------|-----------|--------|
| 1 — Critical | 8 | ~7.5 hours | Same day |
| 2 — High | 12 | ~10.5 hours | This week |
| 3 — Medium | 20 | ~14.5 hours | Next sprint |
| 4 — Low | 30 | ~12 hours | Backlog |
| **Total** | **70** | **~44.5 hours** | |

## Verification After Each Phase

1. **Backend tests:** `apps/backend/.venv/bin/pytest tests/ -v`
2. **Frontend tests:** `cd apps/frontend && npm test`
3. **Linter:** `npm run lint`
4. **Manual smoke test:** Terminal persistence, task lifecycle, file operations, app quit/restart
