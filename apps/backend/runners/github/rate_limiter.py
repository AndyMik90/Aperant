"""
Rate Limiting Protection for GitHub Automation
===============================================

Comprehensive rate limiting system that protects against:
1. GitHub API rate limits (5000 req/hour for authenticated users)
2. AI API cost overruns (configurable budget per run)
3. Thundering herd problems (exponential backoff)

Components:
- TokenBucket: Classic token bucket algorithm for rate limiting
- RateLimiter: Singleton managing GitHub and AI cost limits
- @rate_limited decorator: Automatic pre-flight checks with retry logic
- Cost tracking: Per-model AI API cost calculation and budgeting

Usage:
    # Singleton instance
    limiter = RateLimiter.get_instance(
        github_limit=5000,
        github_refill_rate=1.4,  # tokens per second
        cost_limit=10.0,  # $10 per run
    )

    # Decorate GitHub operations
    @rate_limited(operation_type="github")
    async def fetch_pr_data(pr_number: int):
        result = subprocess.run(["gh", "pr", "view", str(pr_number)])
        return result

    # Track AI costs
    limiter.track_ai_cost(
        input_tokens=1000,
        output_tokens=500,
        model="claude-sonnet-4-5-20250929"
    )

    # Manual rate check
    if not await limiter.acquire_github():
        raise RateLimitExceeded("GitHub API rate limit reached")
"""

from __future__ import annotations

import asyncio
import functools
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, TypeVar

# Type for decorated functions
F = TypeVar("F", bound=Callable[..., Any])


class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded and cannot proceed."""

    pass


class CostLimitExceeded(Exception):
    """Raised when AI cost budget is exceeded."""

    pass


@dataclass
class TokenBucket:
    """
    Token bucket algorithm for rate limiting.

    The bucket has a maximum capacity and refills at a constant rate.
    Each operation consumes one token. If bucket is empty, operations
    must wait for refill or be rejected.

    Args:
        capacity: Maximum number of tokens (e.g., 5000 for GitHub)
        refill_rate: Tokens added per second (e.g., 1.4 for 5000/hour)
    """

    capacity: int
    refill_rate: float  # tokens per second
    tokens: float = field(init=False)
    last_refill: float = field(init=False)

    def __post_init__(self):
        """Initialize bucket as full."""
        self.tokens = float(self.capacity)
        self.last_refill = time.monotonic()

    def _refill(self) -> None:
        """Refill bucket based on elapsed time."""
        now = time.monotonic()
        elapsed = now - self.last_refill
        tokens_to_add = elapsed * self.refill_rate
        self.tokens = min(self.capacity, self.tokens + tokens_to_add)
        self.last_refill = now

    def try_acquire(self, tokens: int = 1) -> bool:
        """
        Try to acquire tokens from bucket.

        Returns:
            True if tokens acquired, False if insufficient tokens
        """
        self._refill()
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

    async def acquire(self, tokens: int = 1, timeout: float | None = None) -> bool:
        """
        Acquire tokens from bucket, waiting if necessary.

        Args:
            tokens: Number of tokens to acquire
            timeout: Maximum time to wait in seconds

        Returns:
            True if tokens acquired, False if timeout reached
        """
        start_time = time.monotonic()

        while True:
            if self.try_acquire(tokens):
                return True

            # Check timeout
            if timeout is not None:
                elapsed = time.monotonic() - start_time
                if elapsed >= timeout:
                    return False

            # Wait for next refill
            # Calculate time until we have enough tokens
            tokens_needed = tokens - self.tokens
            wait_time = min(tokens_needed / self.refill_rate, 1.0)  # Max 1 second wait
            await asyncio.sleep(wait_time)

    def available(self) -> int:
        """Get number of available tokens."""
        self._refill()
        return int(self.tokens)

    def time_until_available(self, tokens: int = 1) -> float:
        """
        Calculate seconds until requested tokens available.

        Returns:
            0 if tokens immediately available, otherwise seconds to wait
        """
        self._refill()
        if self.tokens >= tokens:
            return 0.0
        tokens_needed = tokens - self.tokens
        return tokens_needed / self.refill_rate


# AI model pricing (per 1M tokens)
AI_PRICING = {
    # Claude 4.5 models (current)
    "claude-sonnet-4-5-20250929": {"input": 3.00, "output": 15.00},
    "claude-opus-4-5-20251101": {"input": 15.00, "output": 75.00},
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
    # Note: Opus 4.6 with 1M context (opus-1m) uses the same model ID with a beta
    # header, so it shares the same pricing key. Requests >200K tokens incur premium
    # rates (2x input, 1.5x output) automatically on the API side.
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.00},
    # Extended thinking models (higher output costs)
    "claude-sonnet-4-5-20250929-thinking": {"input": 3.00, "output": 15.00},
    # Default fallback
    "default": {"input": 3.00, "output": 15.00},
}


@dataclass
class CostTracker:
    """Track AI API costs."""

    total_cost: float = 0.0
    cost_limit: float = 10.0
    operations: list[dict] = field(default_factory=list)

    def add_operation(
        self,
        input_tokens: int,
        output_tokens: int,
        model: str,
        operation_name: str = "unknown",
    ) -> float:
        """
        Track cost of an AI operation.

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model identifier
            operation_name: Name of operation for tracking

        Returns:
            Cost of this operation in dollars

        Raises:
            CostLimitExceeded: If operation would exceed budget
        """
        cost = self.calculate_cost(input_tokens, output_tokens, model)

        # Check if this would exceed limit
        if self.total_cost + cost > self.cost_limit:
            raise CostLimitExceeded(
                f"Operation would exceed cost limit: "
                f"${self.total_cost + cost:.2f} > ${self.cost_limit:.2f}"
            )

        self.total_cost += cost
        self.operations.append(
            {
                "timestamp": datetime.now().isoformat(),
                "operation": operation_name,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost": cost,
            }
        )

        return cost

    @staticmethod
    def calculate_cost(input_tokens: int, output_tokens: int, model: str) -> float:
        """
        Calculate cost for model usage.

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model identifier

        Returns:
            Cost in dollars
        """
        # Get pricing for model (fallback to default)
        pricing = AI_PRICING.get(model, AI_PRICING["default"])

        input_cost = (input_tokens / 1_000_000) * pricing["input"]
        output_cost = (output_tokens / 1_000_000) * pricing["output"]

        return input_cost + output_cost

    def remaining_budget(self) -> float:
        """Get remaining budget in dollars."""
        return max(0.0, self.cost_limit - self.total_cost)

    def usage_report(self) -> str:
        """Generate cost usage report."""
        lines = [
            "Cost Usage Report",
            "=" * 50,
            f"Total Cost: ${self.total_cost:.4f}",
            f"Budget: ${self.cost_limit:.2f}",
            f"Remaining: ${self.remaining_budget():.4f}",
            f"Usage: {(self.total_cost / self.cost_limit * 100):.1f}%",
            "",
            f"Operations: {len(self.operations)}",
        ]

        if self.operations:
            lines.append("")
            lines.append("Top 5 Most Expensive Operations:")
            sorted_ops = sorted(self.operations, key=lambda x: x["cost"], reverse=True)
            for op in sorted_ops[:5]:
                lines.append(
                    f"  ${op['cost']:.4f} - {op['operation']} "
                    f"({op['input_tokens']} in, {op['output_tokens']} out)"
                )

        return "\n".join(lines)


class RateLimiter:
    """
    Singleton rate limiter for GitHub automation.

    Manages:
    - GitHub API rate limits (token bucket)
    - AI cost limits (budget tracking)
    - Request queuing and backoff
    """

    _instance: RateLimiter | None = None
    _initialized: bool = False

    def __init__(
        self,
        github_limit: int = 5000,
        github_refill_rate: float = 1.4,  # ~5000/hour
        cost_limit: float = 10.0,
        max_retry_delay: float = 300.0,  # 5 minutes
    ):
        """
        Initialize rate limiter.

        Args:
            github_limit: Maximum GitHub API calls (default: 5000/hour)
            github_refill_rate: Tokens per second refill rate
            cost_limit: Maximum AI cost in dollars per run
            max_retry_delay: Maximum exponential backoff delay
        """
        if RateLimiter._initialized:
            return

        self.github_bucket = TokenBucket(
            capacity=github_limit,
            refill_rate=github_refill_rate,
        )
        self.cost_tracker = CostTracker(cost_limit=cost_limit)
        self.max_retry_delay = max_retry_delay

        # Request statistics
        self.github_requests = 0
        self.github_rate_limited = 0
        self.github_errors = 0
        self.start_time = datetime.now()

        RateLimiter._initialized = True

    @classmethod
    def get_instance(
        cls,
        github_limit: int = 5000,
        github_refill_rate: float = 1.4,
        cost_limit: float = 10.0,
        max_retry_delay: float = 300.0,
    ) -> RateLimiter:
        """
        Get or create singleton instance.

        Args:
            github_limit: Maximum GitHub API calls
            github_refill_rate: Tokens per second refill rate
            cost_limit: Maximum AI cost in dollars
            max_retry_delay: Maximum retry delay

        Returns:
            RateLimiter singleton instance
        """
        if cls._instance is None:
            cls._instance = RateLimiter(
                github_limit=github_limit,
                github_refill_rate=github_refill_rate,
                cost_limit=cost_limit,
                max_retry_delay=max_retry_delay,
            )
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton (for testing)."""
        cls._instance = None
        cls._initialized = False

    async def acquire_github(self, timeout: float | None = None) -> bool:
        """
        Acquire permission for GitHub API call.

        Args:
            timeout: Maximum time to wait (None = wait forever)

        Returns:
            True if permission granted, False if timeout
        """
        self.github_requests += 1
        success = await self.github_bucket.acquire(tokens=1, timeout=timeout)
        if not success:
            self.github_rate_limited += 1
        return success

    def check_github_available(self) -> tuple[bool, str]:
        """
        Check if GitHub API is available without consuming token.

        Returns:
            (available, message) tuple
        """
        available = self.github_bucket.available()

        if available > 0:
            return True, f"{available} requests available"

        wait_time = self.github_bucket.time_until_available()
        return False, f"Rate limited. Wait {wait_time:.1f}s for next request"

    def track_ai_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        model: str,
        operation_name: str = "unknown",
    ) -> float:
        """
        Track AI API cost.

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model identifier
            operation_name: Operation name for tracking

        Returns:
            Cost of operation

        Raises:
            CostLimitExceeded: If budget exceeded
        """
        return self.cost_tracker.add_operation(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            operation_name=operation_name,
        )

    def check_cost_available(self) -> tuple[bool, str]:
        """
        Check if cost budget is available.

        Returns:
            (available, message) tuple
        """
        remaining = self.cost_tracker.remaining_budget()

        if remaining > 0:
            return True, f"${remaining:.2f} budget remaining"

        return False, f"Cost budget exceeded (${self.cost_tracker.total_cost:.2f})"

    def record_github_error(self) -> None:
        """Record a GitHub API error."""
        self.github_errors += 1

    def statistics(self) -> dict:
        """
        Get rate limiter statistics.

        Returns:
            Dictionary of statistics
        """
        runtime = (datetime.now() - self.start_time).total_seconds()

        return {
            "runtime_seconds": runtime,
            "github": {
                "total_requests": self.github_requests,
                "rate_limited": self.github_rate_limited,
                "errors": self.github_errors,
                "available_tokens": self.github_bucket.available(),
                "requests_per_second": self.github_requests / max(runtime, 1),
            },
            "cost": {
                "total_cost": self.cost_tracker.total_cost,
                "budget": self.cost_tracker.cost_limit,
                "remaining": self.cost_tracker.remaining_budget(),
                "operations": len(self.cost_tracker.operations),
            },
        }

    def report(self) -> str:
        """Generate comprehensive usage report."""
        stats = self.statistics()
        runtime = timedelta(seconds=int(stats["runtime_seconds"]))

        lines = [
            "Rate Limiter Report",
            "=" * 60,
            f"Runtime: {runtime}",
            "",
            "GitHub API:",
            f"  Total Requests: {stats['github']['total_requests']}",
            f"  Rate Limited: {stats['github']['rate_limited']}",
            f"  Errors: {stats['github']['errors']}",
            f"  Available Tokens: {stats['github']['available_tokens']}",
            f"  Rate: {stats['github']['requests_per_second']:.2f} req/s",
            "",
            "AI Cost:",
            f"  Total: ${stats['cost']['total_cost']:.4f}",
            f"  Budget: ${stats['cost']['budget']:.2f}",
            f"  Remaining: ${stats['cost']['remaining']:.4f}",
            f"  Operations: {stats['cost']['operations']}",
            "",
            self.cost_tracker.usage_report(),
        ]

        return "\n".join(lines)


def rate_limited(
    operation_type: str = "github",
    max_retries: int = 3,
    base_delay: float = 1.0,
) -> Callable[[F], F]:
    """
    Decorator to add rate limiting to functions.

    Features:
    - Pre-flight rate check
    - Automatic retry with exponential backoff
    - Error handling for 403/429 responses

    Args:
        operation_type: Type of operation ("github" or "ai")
        max_retries: Maximum number of retries
        base_delay: Base delay for exponential backoff

    Usage:
        @rate_limited(operation_type="github")
        async def fetch_pr_data(pr_number: int):
            result = subprocess.run(["gh", "pr", "view", str(pr_number)])
            return result
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            limiter = RateLimiter.get_instance()

            for attempt in range(max_retries + 1):
                try:
                    # Pre-flight check
                    if operation_type == "github":
                        available, msg = limiter.check_github_available()
                        if not available and attempt == 0:
                            # Try to acquire (will wait if needed)
                            if not await limiter.acquire_github(timeout=30.0):
                                raise RateLimitExceeded(
                                    f"GitHub API rate limit exceeded: {msg}"
                                )
                        elif not available:
                            # On retry, wait for token
                            await limiter.acquire_github(
                                timeout=limiter.max_retry_delay
                            )

                    # Execute function
                    result = await func(*args, **kwargs)
                    return result

                except CostLimitExceeded:
                    # Cost limit is hard stop - no retry
                    raise

                except RateLimitExceeded as e:
                    if attempt >= max_retries:
                        raise

                    # Exponential backoff
                    delay = min(
                        base_delay * (2**attempt),
                        limiter.max_retry_delay,
                    )
                    print(
                        f"[RateLimit] Retry {attempt + 1}/{max_retries} "
                        f"after {delay:.1f}s: {e}",
                        flush=True,
                    )
                    await asyncio.sleep(delay)

                except Exception as e:
                    # Check if it's a rate limit error (403/429)
                    error_str = str(e).lower()
                    if (
                        "403" in error_str
                        or "429" in error_str
                        or "rate limit" in error_str
                    ):
                        limiter.record_github_error()

                        if attempt >= max_retries:
                            raise RateLimitExceeded(
                                f"GitHub API rate limit (HTTP 403/429): {e}"
                            )

                        # Exponential backoff
                        delay = min(
                            base_delay * (2**attempt),
                            limiter.max_retry_delay,
                        )
                        print(
                            f"[RateLimit] HTTP 403/429 detected. "
                            f"Retry {attempt + 1}/{max_retries} after {delay:.1f}s",
                            flush=True,
                        )
                        await asyncio.sleep(delay)
                    else:
                        # Not a rate limit error - propagate immediately
                        raise

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            # For sync functions, run in event loop
            return asyncio.run(async_wrapper(*args, **kwargs))

        # Return appropriate wrapper
        if asyncio.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        else:
            return sync_wrapper  # type: ignore

    return decorator


# Convenience function for pre-flight checks
async def check_rate_limit(operation_type: str = "github") -> None:
    """
    Pre-flight rate limit check.

    Args:
        operation_type: Type of operation to check

    Raises:
        RateLimitExceeded: If rate limit would be exceeded
        CostLimitExceeded: If cost budget would be exceeded
    """
    limiter = RateLimiter.get_instance()

    if operation_type == "github":
        available, msg = limiter.check_github_available()
        if not available:
            raise RateLimitExceeded(f"GitHub API not available: {msg}")

    elif operation_type == "cost":
        available, msg = limiter.check_cost_available()
        if not available:
            raise CostLimitExceeded(f"Cost budget exceeded: {msg}")


# Example usage and testing
if __name__ == "__main__":

    async def example_usage():
        """Example of using the rate limiter."""

        # Initialize with custom limits
        limiter = RateLimiter.get_instance(
            github_limit=5000,
            github_refill_rate=1.4,
            cost_limit=10.0,
        )

        print("Rate Limiter Example")
        print("=" * 60)

        # Example 1: Manual rate check
        print("\n1. Manual rate check:")
        available, msg = limiter.check_github_available()
        print(f"   GitHub API: {msg}")

        # Example 2: Acquire token
        print("\n2. Acquire GitHub token:")
        if await limiter.acquire_github():
            print("   ✓ Token acquired")
        else:
            print("   ✗ Rate limited")

        # Example 3: Track AI cost
        print("\n3. Track AI cost:")
        try:
            cost = limiter.track_ai_cost(
                input_tokens=1000,
                output_tokens=500,
                model="claude-sonnet-4-5-20250929",
                operation_name="PR review",
            )
            print(f"   Cost: ${cost:.4f}")
            print(
                f"   Remaining budget: ${limiter.cost_tracker.remaining_budget():.2f}"
            )
        except CostLimitExceeded as e:
            print(f"   ✗ {e}")

        # Example 4: Decorated function
        print("\n4. Using @rate_limited decorator:")

        @rate_limited(operation_type="github")
        async def fetch_github_data(resource: str):
            print(f"   Fetching: {resource}")
            # Simulate GitHub API call
            await asyncio.sleep(0.1)
            return {"data": "example"}

        try:
            result = await fetch_github_data("pr/123")
            print(f"   Result: {result}")
        except RateLimitExceeded as e:
            print(f"   ✗ {e}")

        # Final report
        print("\n" + limiter.report())

    # Run example
    asyncio.run(example_usage())
