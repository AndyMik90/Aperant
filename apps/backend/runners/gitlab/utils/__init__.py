"""
GitLab Utilities Package
========================

Utility modules for GitLab automation.

Note: File locking and rate limiting are now provided by the shared utilities
in runners.shared. This module re-exports them for backwards compatibility.
"""

# Re-export from shared utilities for backwards compatibility
try:
    from runners.shared.file_lock import (
        FileLock,
        FileLockError,
        FileLockTimeout,
        atomic_write,
        locked_json_read,
        locked_json_update,
        locked_json_write,
        locked_read,
        locked_write,
    )
    from runners.shared.rate_limiter import (
        AI_PRICING,
        CostLimitExceeded,
        CostTracker,
        RateLimiter,
        RateLimiterState,
        RateLimitExceeded,
        TokenBucket,
        check_rate_limit,
        rate_limit,
        rate_limited,
    )
except ImportError:
    # Fallback to local implementations if shared not available
    from .file_lock import (
        FileLock,
        FileLockError,
        FileLockTimeout,
        atomic_write,
        locked_json_read,
        locked_json_update,
        locked_json_write,
        locked_read,
        locked_write,
    )
    from .rate_limiter import (
        CostLimitExceeded,
        CostTracker,
        RateLimiter,
        RateLimitExceeded,
        TokenBucket,
        check_rate_limit,
        rate_limited,
    )

    # These may not exist in the local version
    AI_PRICING = getattr(
        __import__("runners.gitlab.utils.rate_limiter", fromlist=["AI_PRICING"]),
        "AI_PRICING",
        {},
    )
    RateLimiterState = getattr(
        __import__("runners.gitlab.utils.rate_limiter", fromlist=["RateLimiterState"]),
        "RateLimiterState",
        None,
    )
    rate_limit = getattr(
        __import__("runners.gitlab.utils.rate_limiter", fromlist=["rate_limit"]),
        "rate_limit",
        None,
    )

__all__ = [
    # File locking
    "FileLock",
    "FileLockError",
    "FileLockTimeout",
    "atomic_write",
    "locked_json_read",
    "locked_json_update",
    "locked_json_write",
    "locked_read",
    "locked_write",
    # Rate limiting
    "AI_PRICING",
    "CostLimitExceeded",
    "CostTracker",
    "RateLimitExceeded",
    "RateLimiter",
    "RateLimiterState",
    "TokenBucket",
    "check_rate_limit",
    "rate_limit",
    "rate_limited",
]
