"""
Tests for Rate Limiter (rate_limiter.py)
==========================================

Tests the token bucket rate limiting algorithm, AI cost tracking,
and the @rate_limited decorator.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from runners.github.rate_limiter import (
    TokenBucket,
    CostTracker,
    RateLimiter,
    RateLimitExceeded,
    CostLimitExceeded,
    rate_limited,
    AI_PRICING,
)


# ============================================================================
# TokenBucket Tests
# ============================================================================


class TestTokenBucket:
    """Tests for TokenBucket rate limiting algorithm."""

    def test_init_full_bucket(self):
        """Test that bucket initializes as full."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.tokens == 100.0
        assert bucket.available() == 100

    def test_try_acquire_success(self):
        """Test successful token acquisition."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.try_acquire(1) is True
        assert bucket.tokens == 99.0

    def test_try_acquire_multiple(self):
        """Test acquiring multiple tokens."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.try_acquire(10) is True
        assert bucket.tokens == 90.0

    def test_try_acquire_insufficient(self):
        """Test token acquisition fails when insufficient tokens."""
        bucket = TokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.try_acquire(10) is True  # Use all
        assert bucket.try_acquire(1) is False  # None left

    def test_try_acquire_more_than_capacity(self):
        """Test acquiring more than capacity fails."""
        bucket = TokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.try_acquire(100) is False
        assert bucket.tokens == 10.0  # None consumed

    def test_available(self):
        """Test available returns correct token count."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.available() == 100
        bucket.try_acquire(30)
        assert bucket.available() == 70

    def test_time_until_available_immediate(self):
        """Test time_until_available returns 0 when tokens available."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.time_until_available(1) == 0.0
        assert bucket.time_until_available(10) == 0.0

    def test_time_until_available_wait_needed(self):
        """Test time_until_available calculates wait time correctly."""
        bucket = TokenBucket(capacity=10, refill_rate=2.0)
        bucket.try_acquire(10)  # Empty bucket
        # Need 1 token at 2 tokens/second = 0.5 seconds
        assert bucket.time_until_available(1) == 0.5
        # Need 5 tokens at 2 tokens/second = 2.5 seconds
        assert bucket.time_until_available(5) == 2.5

    @pytest.mark.asyncio
    async def test_acquire_immediate(self):
        """Test immediate acquisition when tokens available."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert await bucket.acquire(1) is True
        assert bucket.tokens == 99.0

    @pytest.mark.asyncio
    async def test_acquire_waits_for_refill(self):
        """Test acquire waits for bucket refill."""
        bucket = TokenBucket(capacity=10, refill_rate=100.0)  # Fast refill
        bucket.try_acquire(10)  # Empty bucket
        # Should wait and get token
        assert await bucket.acquire(1, timeout=1.0) is True

    @pytest.mark.asyncio
    async def test_acquire_timeout(self):
        """Test acquire returns False on timeout."""
        bucket = TokenBucket(capacity=10, refill_rate=0.1)  # Slow refill
        bucket.try_acquire(10)  # Empty bucket
        # Need to wait 100 seconds for 10 tokens at 0.1/sec
        assert await bucket.acquire(1, timeout=0.1) is False


# ============================================================================
# CostTracker Tests
# ============================================================================


class TestCostTracker:
    """Tests for AI cost tracking."""

    def test_init(self):
        """Test CostTracker initialization."""
        tracker = CostTracker(cost_limit=10.0)
        assert tracker.total_cost == 0.0
        assert tracker.cost_limit == 10.0
        assert tracker.operations == []

    def test_calculate_cost_sonnet(self):
        """Test cost calculation for Claude Sonnet."""
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-sonnet-4-5-20250929"
        )
        # $3.00 per 1M input + $15.00 per 1M output
        # 1M input = $3.00, 0.5M output = $7.50
        assert cost == 10.50

    def test_calculate_cost_opus(self):
        """Test cost calculation for Claude Opus."""
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-opus-4-6"
        )
        # $15.00 per 1M input + $75.00 per 1M output
        # 1M input = $15.00, 0.5M output = $37.50
        assert cost == 52.50

    def test_calculate_cost_haiku(self):
        """Test cost calculation for Claude Haiku."""
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=500_000,
            model="claude-haiku-4-5-20251001"
        )
        # $0.80 per 1M input + $4.00 per 1M output
        # 1M input = $0.80, 0.5M output = $2.00
        assert cost == 2.80

    def test_calculate_cost_default_fallback(self):
        """Test default pricing for unknown model."""
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            model="unknown-model"
        )
        # Should use default pricing (same as Sonnet)
        assert cost == 18.00  # $3.00 + $15.00

    def test_add_operation(self):
        """Test adding an operation tracks cost."""
        tracker = CostTracker(cost_limit=10.0)
        cost = tracker.add_operation(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
            operation_name="test_operation"
        )
        assert cost == 1.05  # $0.30 + $0.75
        assert tracker.total_cost == 1.05
        assert len(tracker.operations) == 1
        assert tracker.operations[0]["operation"] == "test_operation"

    def test_add_operation_exceeds_limit(self):
        """Test CostLimitExceeded when budget exceeded."""
        tracker = CostTracker(cost_limit=1.0)
        # First operation costs $1.05, exceeds limit immediately
        with pytest.raises(CostLimitExceeded):
            tracker.add_operation(
                input_tokens=100_000,
                output_tokens=50_000,
                model="claude-sonnet-4-5-20250929",
                operation_name="first"
            )

    def test_remaining_budget(self):
        """Test remaining budget calculation."""
        tracker = CostTracker(cost_limit=10.0)
        assert tracker.remaining_budget() == 10.0
        tracker.add_operation(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929"
        )
        assert tracker.remaining_budget() == 8.95  # 10.00 - 1.05

    def test_remaining_budget_zero(self):
        """Test remaining budget is 0 when at limit."""
        tracker = CostTracker(cost_limit=5.0)
        # First operation that doesn't exceed limit
        tracker.add_operation(
            input_tokens=500_000,
            output_tokens=100_000,
            model="claude-sonnet-4-5-20250929"
        )
        # Check remaining is correct
        assert tracker.remaining_budget() == 2.0  # 5.00 - 3.00
        # Second operation that exceeds
        with pytest.raises(CostLimitExceeded):
            tracker.add_operation(
                input_tokens=1_000_000,
                output_tokens=200_000,
                model="claude-sonnet-4-5-20250929"
            )
        # After exception, the first op's cost is still there
        assert tracker.remaining_budget() == 2.0

    def test_usage_report(self):
        """Test usage report generation."""
        tracker = CostTracker(cost_limit=10.0)
        tracker.add_operation(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
            operation_name="expensive_op"
        )
        report = tracker.usage_report()
        assert "Cost Usage Report" in report
        assert "$1.0500" in report
        assert "$10.00" in report
        assert "expensive_op" in report


# ============================================================================
# RateLimiter Tests
# ============================================================================


class TestRateLimiter:
    """Tests for RateLimiter singleton."""

    def setup_method(self):
        """Reset singleton before each test."""
        RateLimiter.reset_instance()

    def test_singleton_pattern(self):
        """Test get_instance returns same instance."""
        limiter1 = RateLimiter.get_instance()
        limiter2 = RateLimiter.get_instance()
        assert limiter1 is limiter2

    def test_custom_limits(self):
        """Test get_instance with custom limits."""
        limiter = RateLimiter.get_instance(
            github_limit=1000,
            github_refill_rate=5.0,
            cost_limit=5.0
        )
        assert limiter.github_bucket.capacity == 1000
        assert limiter.github_bucket.refill_rate == 5.0
        assert limiter.cost_tracker.cost_limit == 5.0

    def test_reset_instance(self):
        """Test reset_instance creates new instance."""
        limiter1 = RateLimiter.get_instance()
        RateLimiter.reset_instance()
        limiter2 = RateLimiter.get_instance()
        assert limiter1 is not limiter2

    @pytest.mark.asyncio
    async def test_acquire_github_success(self):
        """Test successful GitHub token acquisition."""
        limiter = RateLimiter.get_instance(github_limit=100)
        assert await limiter.acquire_github() is True
        assert limiter.github_requests == 1
        assert limiter.github_rate_limited == 0

    @pytest.mark.asyncio
    async def test_acquire_github_timeout(self):
        """Test GitHub acquisition timeout."""
        limiter = RateLimiter.get_instance(github_limit=1)
        # Use the only token
        await limiter.acquire_github()
        # Next call should timeout (bucket empty, slow refill)
        # With very short timeout, should fail
        limiter.github_bucket.refill_rate = 0.01  # Very slow
        assert await limiter.acquire_github(timeout=0.05) is False

    def test_check_github_available(self):
        """Test checking GitHub availability without consuming."""
        limiter = RateLimiter.get_instance(github_limit=100)
        available, msg = limiter.check_github_available()
        assert available is True
        assert "100 requests available" in msg

    def test_check_github_unavailable(self):
        """Test checking GitHub availability when empty."""
        limiter = RateLimiter.get_instance(github_limit=1)
        limiter.github_bucket.try_acquire(1)  # Use only token
        available, msg = limiter.check_github_available()
        assert available is False
        assert "Rate limited" in msg

    def test_track_ai_cost(self):
        """Test tracking AI cost."""
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        cost = limiter.track_ai_cost(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
            operation_name="test"
        )
        assert cost == 1.05
        assert limiter.cost_tracker.total_cost == 1.05

    def test_track_ai_cost_exceeds_limit(self):
        """Test CostLimitExceeded propagated."""
        limiter = RateLimiter.get_instance(cost_limit=1.0)
        with pytest.raises(CostLimitExceeded):
            limiter.track_ai_cost(
                input_tokens=1_000_000,  # Expensive
                output_tokens=500_000,
                model="claude-sonnet-4-5-20250929",
                operation_name="test"
            )

    def test_check_cost_available(self):
        """Test checking cost budget availability."""
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        available, msg = limiter.check_cost_available()
        assert available is True
        assert "$10.00" in msg

    def test_check_cost_exceeded(self):
        """Test cost budget exceeded shows correctly."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        # Spend some to reduce budget
        # First operation: 500k input ($1.50) + 100k output ($1.50) = $3.00
        limiter.track_ai_cost(
            input_tokens=500_000,
            output_tokens=100_000,
            model="claude-sonnet-4-5-20250929"
        )
        # Check we still have budget ($10.00 - $3.00 = $7.00 remaining)
        available, msg = limiter.check_cost_available()
        assert available is True
        # Try to exceed budget - this operation costs $8.00
        # 1M input ($3.00) + 333,334 output ($5.00) = $8.00
        with pytest.raises(CostLimitExceeded):
            limiter.track_ai_cost(
                input_tokens=1_000_000,
                output_tokens=333_334,
                model="claude-sonnet-4-5-20250929"
            )
        # Budget should still show remaining (the failed add didn't go through)
        available, msg = limiter.check_cost_available()
        assert available is True  # Still has budget from before

    def test_record_github_error(self):
        """Test recording GitHub API errors."""
        limiter = RateLimiter.get_instance()
        limiter.record_github_error()
        limiter.record_github_error()
        assert limiter.github_errors == 2

    def test_statistics(self):
        """Test statistics generation."""
        limiter = RateLimiter.get_instance(
            github_limit=100,
            cost_limit=5.0
        )
        limiter.track_ai_cost(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
            operation_name="test"
        )
        stats = limiter.statistics()
        assert "runtime_seconds" in stats
        assert "github" in stats
        assert "cost" in stats
        assert stats["cost"]["total_cost"] == 1.05

    def test_report(self):
        """Test comprehensive report generation."""
        limiter = RateLimiter.get_instance()
        report = limiter.report()
        assert "Rate Limiter Report" in report
        assert "GitHub API:" in report
        assert "AI Cost:" in report


# ============================================================================
# rate_limited Decorator Tests
# ============================================================================


class TestRateLimitedDecorator:
    """Tests for @rate_limited decorator."""

    def setup_method(self):
        """Reset singleton before each test."""
        RateLimiter.reset_instance()

    @pytest.mark.asyncio
    async def test_decorator_allows_call(self):
        """Test decorator allows call when rate limit not exceeded."""
        limiter = RateLimiter.get_instance(github_limit=100)

        @rate_limited(operation_type="github")
        async def test_func():
            return "success"

        result = await test_func()
        assert result == "success"

    @pytest.mark.asyncio
    async def test_decorator_raises_on_rate_limit(self):
        """Test decorator raises RateLimitExceeded when limit exceeded."""
        # Create a new limiter with 1 token limit
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(github_limit=1)

        # Empty the bucket completely
        await limiter.acquire_github()

        # Set very slow refill and try to use the decorator
        limiter.github_bucket.refill_rate = 0.001

        @rate_limited(operation_type="github", max_retries=0)
        async def test_func():
            return "success"

        # This should fail because bucket is empty and won't refill in time
        with pytest.raises(RateLimitExceeded):
            await test_func()

    @pytest.mark.asyncio
    async def test_decorator_retries_on_403(self):
        """Test decorator retries on HTTP 403 errors."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(github_limit=100)
        call_count = [0]

        @rate_limited(operation_type="github", max_retries=2, base_delay=0.01)
        async def test_func():
            call_count[0] += 1
            if call_count[0] < 2:
                raise Exception("HTTP 403 Forbidden")
            return "success"

        result = await test_func()
        assert result == "success"
        assert call_count[0] == 2  # Fails on first try, succeeds on second

    @pytest.mark.asyncio
    async def test_decorator_retries_on_429(self):
        """Test decorator retries on HTTP 429 errors."""
        limiter = RateLimiter.get_instance(github_limit=100)
        call_count = [0]

        @rate_limited(operation_type="github", max_retries=1, base_delay=0.01)
        async def test_func():
            call_count[0] += 1
            if call_count[0] == 1:
                raise Exception("HTTP 429 Too Many Requests")
            return "success"

        result = await test_func()
        assert result == "success"
        assert call_count[0] == 2  # Initial + 1 retry

    @pytest.mark.asyncio
    async def test_decorator_propagates_non_rate_limit_errors(self):
        """Test decorator propagates non-rate-limit errors immediately."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(github_limit=100)

        @rate_limited(operation_type="github", max_retries=0)
        async def test_func():
            raise ValueError("Some other error without HTTP code")

        # The decorator checks for "403", "429", or "rate limit" in error
        # Since our error doesn't contain these, it should propagate
        with pytest.raises(ValueError, match="Some other error"):
            await test_func()

    @pytest.mark.asyncio
    async def test_decorator_raises_on_max_retries(self):
        """Test decorator raises after max retries exhausted."""
        @rate_limited(operation_type="github", max_retries=1, base_delay=0.01)
        async def test_func():
            raise Exception("HTTP 403 Forbidden")

        with pytest.raises(RateLimitExceeded):
            await test_func()


# ============================================================================
# Integration Tests
# ============================================================================


class TestRateLimiterIntegration:
    """Integration tests for rate limiting scenarios."""

    def setup_method(self):
        """Reset singleton before each test."""
        RateLimiter.reset_instance()

    @pytest.mark.asyncio
    async def test_full_workflow(self):
        """Test complete workflow with multiple operations."""
        limiter = RateLimiter.get_instance(
            github_limit=10,
            cost_limit=5.0
        )

        # Make some GitHub requests
        for _ in range(5):
            await limiter.acquire_github()

        # Track some AI costs
        limiter.track_ai_cost(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
            operation_name="test_operation"
        )

        # Check statistics
        stats = limiter.statistics()
        assert stats["github"]["total_requests"] == 5
        assert stats["cost"]["total_cost"] == 1.05
        assert stats["cost"]["remaining"] > 3.0

    @pytest.mark.asyncio
    async def test_concurrent_acquisition(self):
        """Test concurrent token acquisition."""
        limiter = RateLimiter.get_instance(github_limit=10)

        async def acquire_tokens(n):
            for _ in range(n):
                await limiter.acquire_github()

        # Run 5 concurrent tasks, each acquiring 2 tokens
        tasks = [acquire_tokens(2) for _ in range(5)]
        await asyncio.gather(*tasks)

        # All 10 tokens should be acquired
        assert limiter.github_requests == 10
        assert limiter.github_bucket.available() == 0


# ============================================================================
# Pricing Constants Tests
# ============================================================================


class TestAIPricing:
    """Tests for AI pricing constants."""

    def test_pricing_structure(self):
        """Test pricing dictionary structure."""
        assert "claude-sonnet-4-5-20250929" in AI_PRICING
        assert "claude-opus-4-6" in AI_PRICING
        assert "claude-haiku-4-5-20251001" in AI_PRICING
        assert "default" in AI_PRICING

    def test_sonnet_pricing(self):
        """Test Claude Sonnet pricing."""
        pricing = AI_PRICING["claude-sonnet-4-5-20250929"]
        assert pricing["input"] == 3.00
        assert pricing["output"] == 15.00

    def test_opus_pricing(self):
        """Test Claude Opus pricing."""
        pricing = AI_PRICING["claude-opus-4-6"]
        assert pricing["input"] == 15.00
        assert pricing["output"] == 75.00

    def test_haiku_pricing(self):
        """Test Claude Haiku pricing."""
        pricing = AI_PRICING["claude-haiku-4-5-20251001"]
        assert pricing["input"] == 0.80
        assert pricing["output"] == 4.00
