"""
GitLab Utilities Package
========================

Utility modules for GitLab automation.
"""

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
    "CostLimitExceeded",
    "CostTracker",
    "RateLimitExceeded",
    "RateLimiter",
    "TokenBucket",
    "check_rate_limit",
    "rate_limited",
]
