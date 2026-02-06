# Phase 12: Code Quality Refactors

**Version:** 1.0
**Date:** 2026-02-04
**Tasks:** 4
**Risk:** Medium
**Focus:** Thread safety and async error handling

---

## Overview

Address deferred complex refactors from Phase 9 code sweep. These require careful implementation due to concurrency and error handling concerns.

---

## Tasks

### QUAL-1: Thread-Safe Cache Pattern (SWEEP-5)

**Issue:** Thread-unsafe cache pattern in client.py
**Location:** `apps/backend/core/client.py:42-109`

**Current Problem:**
```python
# Potential race condition
class ClientCache:
    _cache = {}  # Shared mutable state

    def get(self, key):
        if key in self._cache:  # Check
            return self._cache[key]  # Use - TOCTOU race
        value = self._fetch(key)
        self._cache[key] = value  # Write - race with other threads
        return value
```

**Solution:** Use threading.Lock or functools.lru_cache

```python
import threading
from functools import lru_cache

class ClientCache:
    def __init__(self):
        self._cache = {}
        self._lock = threading.RLock()

    def get(self, key):
        with self._lock:
            if key not in self._cache:
                self._cache[key] = self._fetch(key)
            return self._cache[key]

# Or simpler with lru_cache (if stateless)
@lru_cache(maxsize=128)
def get_client(key: str) -> Client:
    return create_client(key)
```

**Acceptance:**
- [ ] No race conditions possible
- [ ] Thread-safe access to cache
- [ ] Existing functionality preserved

---

### QUAL-2: Async Error Handling in Planner (SWEEP-16)

**Issue:** Incomplete async error handling in plan.py
**Location:** `apps/backend/agents/plan.py:148`

**Current Problem:**
```python
async def generate_plan():
    try:
        result = await api_call()
    except Exception:
        pass  # Silently swallows errors
```

**Solution:** Proper error propagation with logging

```python
import logging

logger = logging.getLogger(__name__)

class PlanGenerationError(Exception):
    """Raised when plan generation fails."""
    pass

async def generate_plan():
    try:
        result = await api_call()
        return result
    except asyncio.CancelledError:
        # Don't catch cancellation - let it propagate
        raise
    except APIError as e:
        logger.error("API error during plan generation: %s", e, exc_info=True)
        raise PlanGenerationError(f"API call failed: {e}") from e
    except Exception as e:
        logger.error("Unexpected error in plan generation: %s", e, exc_info=True)
        raise PlanGenerationError(f"Plan generation failed: {e}") from e
```

**Acceptance:**
- [ ] All errors logged with context
- [ ] Errors propagate to caller
- [ ] asyncio.CancelledError not caught

---

### QUAL-3: Add Error Recovery Patterns

**Issue:** No retry logic for transient failures

**Solution:** Implement retry with exponential backoff

```python
import asyncio
from typing import TypeVar, Callable

T = TypeVar('T')

async def retry_async(
    func: Callable[[], T],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable_exceptions: tuple = (IOError, TimeoutError),
) -> T:
    """Retry async function with exponential backoff."""
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await func()
        except retryable_exceptions as e:
            last_exception = e
            if attempt < max_retries:
                delay = min(base_delay * (2 ** attempt), max_delay)
                logger.warning(
                    "Attempt %d failed, retrying in %.1fs: %s",
                    attempt + 1, delay, e
                )
                await asyncio.sleep(delay)

    raise last_exception
```

**Usage:**
```python
result = await retry_async(
    lambda: api.call(),
    retryable_exceptions=(RateLimitError, TimeoutError)
)
```

**Acceptance:**
- [ ] Retry utility created
- [ ] Used in API calls
- [ ] Configurable retry count and delay

---

### QUAL-4: Comprehensive Error Types

**Issue:** Generic exceptions don't help debugging

**Solution:** Create domain-specific exception hierarchy

```python
# apps/backend/core/exceptions.py

class AutoClaudeError(Exception):
    """Base exception for Auto-Claude."""
    pass

class AgentError(AutoClaudeError):
    """Base for agent-related errors."""
    pass

class PlanningError(AgentError):
    """Error during planning phase."""
    pass

class CodingError(AgentError):
    """Error during coding phase."""
    pass

class APIError(AutoClaudeError):
    """Error from external API."""
    pass

class RateLimitError(APIError):
    """API rate limit exceeded."""
    def __init__(self, retry_after: float = None):
        self.retry_after = retry_after
        super().__init__(f"Rate limited, retry after {retry_after}s")

class AuthenticationError(APIError):
    """API authentication failed."""
    pass

class ConfigurationError(AutoClaudeError):
    """Invalid configuration."""
    pass
```

**Acceptance:**
- [ ] Exception hierarchy created
- [ ] Used throughout codebase
- [ ] Better error messages in UI

---

## Verification

```bash
# Python syntax check
python -m py_compile apps/backend/core/client.py
python -m py_compile apps/backend/agents/plan.py
python -m py_compile apps/backend/core/exceptions.py

# Run tests
npm test

# Build
npm run build
```

---

## Success Criteria

- [ ] Thread-safe cache implementation
- [ ] Proper async error handling
- [ ] Retry utility for transient failures
- [ ] Domain-specific exception types
- [ ] All tests pass
- [ ] Build passes

---

## Completion Promise

```
<promise>PHASE_12_CODE_QUALITY_COMPLETE</promise>
```

---

**Phase 12: Code Quality Refactors - 4 tasks | Medium risk**
