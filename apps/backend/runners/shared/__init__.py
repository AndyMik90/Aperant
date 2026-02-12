"""
Shared Utilities for Provider Runners
=====================================

This package contains shared utilities used by both GitHub and GitLab runners
(and potentially other provider implementations in the future).

Modules:
- file_lock: Cross-process file locking for concurrent operations
- rate_limiter: API rate limiting and AI cost tracking
- protocol: Provider-agnostic data models and protocol definitions
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
from .protocol import (
    GitProvider,
    IssueData,
    IssueFilters,
    LabelData,
    PRData,
    PRFilters,
    ProviderType,
    ReviewData,
    ReviewFinding,
)
from .rate_limiter import (
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
    # Protocol
    "GitProvider",
    "IssueData",
    "IssueFilters",
    "LabelData",
    "PRData",
    "PRFilters",
    "ProviderType",
    "ReviewData",
    "ReviewFinding",
]
