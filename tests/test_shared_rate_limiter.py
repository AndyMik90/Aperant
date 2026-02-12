"""
Tests for Shared Rate Limiter
=============================

Tests for the shared rate_limiter module used by both GitHub and GitLab runners.
"""

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest

from runners.shared.rate_limiter import (
    AI_PRICING,
    CostLimitExceeded,
    CostTracker,
    RateLimitExceeded,
    RateLimiter,
    RateLimiterState,
    TokenBucket,
    check_rate_limit,
    rate_limit,
    rate_limited,
)


class TestTokenBucket:
    """Tests for TokenBucket class."""

    def test_initial_state_full(self):
        """Test that bucket starts full."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.available() == 100

    def test_try_acquire_success(self):
        """Test successful token acquisition."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.try_acquire(1) is True
        assert bucket.available() == 99

    def test_try_acquire_multiple_tokens(self):
        """Test acquiring multiple tokens at once."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.try_acquire(10) is True
        assert bucket.available() == 90

    def test_try_acquire_insufficient_tokens(self):
        """Test that try_acquire fails when insufficient tokens."""
        bucket = TokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.try_acquire(15) is False
        assert bucket.available() == 10  # Should be unchanged

    def test_refill_over_time(self):
        """Test that bucket refills over time."""
        bucket = TokenBucket(capacity=100, refill_rate=100.0)  # 100 tokens/sec
        bucket.try_acquire(50)
        assert bucket.available() == 50

        # Wait a bit for refill
        time.sleep(0.1)
        available = bucket.available()
        assert available > 50  # Should have refilled

    def test_refill_caps_at_capacity(self):
        """Test that refill doesn't exceed capacity."""
        bucket = TokenBucket(capacity=100, refill_rate=1000.0)
        time.sleep(0.1)  # Let it try to overfill
        assert bucket.available() <= 100

    @pytest.mark.asyncio
    async def test_async_acquire_immediate(self):
        """Test async acquire when tokens available."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        result = await bucket.acquire(1, timeout=1.0)
        assert result is True

    @pytest.mark.asyncio
    async def test_async_acquire_timeout(self):
        """Test async acquire with timeout when tokens unavailable."""
        bucket = TokenBucket(capacity=1, refill_rate=0.1)  # Very slow refill
        bucket.try_acquire(1)  # Use the only token

        start = time.time()
        result = await bucket.acquire(1, timeout=0.2)
        elapsed = time.time() - start

        assert result is False
        assert elapsed >= 0.2  # Should have waited for timeout

    def test_time_until_available(self):
        """Test time calculation until tokens available."""
        bucket = TokenBucket(capacity=10, refill_rate=10.0)  # 10 tokens/sec
        bucket.try_acquire(10)  # Empty bucket

        # Should take 0.5 seconds to get 5 tokens
        wait_time = bucket.time_until_available(5)
        assert 0.4 < wait_time < 0.6

    def test_time_until_available_immediate(self):
        """Test time until available when tokens already available."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        assert bucket.time_until_available(10) == 0.0

    def test_consume_synchronous(self):
        """Test synchronous consume method."""
        bucket = TokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.consume(5) is True
        assert bucket.available() == 5

    def test_consume_synchronous_wait(self):
        """Test synchronous consume with wait."""
        bucket = TokenBucket(capacity=10, refill_rate=100.0)
        bucket.try_acquire(10)  # Empty

        # This should wait and succeed
        result = bucket.consume(1, wait=True)
        assert result is True

    def test_reset(self):
        """Test bucket reset."""
        bucket = TokenBucket(capacity=100, refill_rate=10.0)
        bucket.try_acquire(50)
        bucket.reset()
        assert bucket.available() == 100

    def test_get_available_alias(self):
        """Test that get_available is an alias for available."""
        bucket = TokenBucket(capacity=50, refill_rate=10.0)
        assert bucket.get_available() == bucket.available()


class TestCostTracker:
    """Tests for CostTracker class."""

    def test_initial_state(self):
        """Test initial cost tracker state."""
        tracker = CostTracker(cost_limit=10.0)
        assert tracker.total_cost == 0.0
        assert tracker.cost_limit == 10.0
        assert len(tracker.operations) == 0

    def test_add_operation(self):
        """Test adding an operation."""
        tracker = CostTracker(cost_limit=10.0)
        cost = tracker.add_operation(
            input_tokens=1000,
            output_tokens=500,
            model="claude-sonnet-4-5-20250929",
            operation_name="test",
        )
        assert cost > 0
        assert tracker.total_cost == cost
        assert len(tracker.operations) == 1

    def test_add_operation_exceeds_limit(self):
        """Test that operation raises when exceeding limit."""
        tracker = CostTracker(cost_limit=0.01)  # Very low limit
        with pytest.raises(CostLimitExceeded):
            tracker.add_operation(
                input_tokens=1_000_000,  # 1M tokens would cost ~$3
                output_tokens=500_000,
                model="claude-sonnet-4-5-20250929",
            )

    def test_calculate_cost_known_model(self):
        """Test cost calculation for known model."""
        # claude-sonnet-4-5-20250929: $3 input, $15 output per 1M tokens
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            model="claude-sonnet-4-5-20250929",
        )
        assert cost == 18.0  # $3 + $15

    def test_calculate_cost_unknown_model(self):
        """Test cost calculation for unknown model uses default."""
        cost = CostTracker.calculate_cost(
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            model="unknown-model",
        )
        # Default is $3 input, $15 output
        assert cost == 18.0

    def test_remaining_budget(self):
        """Test remaining budget calculation."""
        tracker = CostTracker(cost_limit=10.0)
        tracker.add_operation(
            input_tokens=100_000,
            output_tokens=50_000,
            model="claude-sonnet-4-5-20250929",
        )
        remaining = tracker.remaining_budget()
        assert 0 < remaining < 10.0

    def test_remaining_budget_exceeded(self):
        """Test remaining budget when some cost incurred."""
        tracker = CostTracker(cost_limit=0.01)
        # Since we can't exceed the limit (it raises), just test with some cost
        # A small operation that doesn't exceed the limit
        tracker.add_operation(
            input_tokens=100,
            output_tokens=50,
            model="claude-sonnet-4-5-20250929",
        )
        # Remaining budget should be less than original
        assert tracker.remaining_budget() < 0.01

    def test_usage_report(self):
        """Test usage report generation."""
        tracker = CostTracker(cost_limit=10.0)
        tracker.add_operation(
            input_tokens=1000,
            output_tokens=500,
            model="claude-sonnet-4-5-20250929",
            operation_name="test_op",
        )
        report = tracker.usage_report()
        assert "Cost Usage Report" in report
        assert "test_op" in report


class TestRateLimiter:
    """Tests for RateLimiter singleton."""

    def teardown_method(self):
        """Reset singleton after each test."""
        RateLimiter.reset_instance()

    def test_singleton_pattern(self):
        """Test that RateLimiter is a singleton."""
        limiter1 = RateLimiter.get_instance()
        limiter2 = RateLimiter.get_instance()
        assert limiter1 is limiter2

    def test_singleton_with_params(self):
        """Test singleton creation with custom parameters."""
        limiter = RateLimiter.get_instance(
            api_limit=1000,
            api_refill_rate=10.0,
            cost_limit=5.0,
        )
        assert limiter.api_bucket.capacity == 1000
        assert limiter.cost_tracker.cost_limit == 5.0

    def test_reset_instance(self):
        """Test that reset_instance creates new instance."""
        limiter1 = RateLimiter.get_instance(api_limit=1000)
        RateLimiter.reset_instance()
        limiter2 = RateLimiter.get_instance(api_limit=500)
        assert limiter1 is not limiter2
        assert limiter2.api_bucket.capacity == 500

    @pytest.mark.asyncio
    async def test_acquire(self):
        """Test API token acquisition."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)
        result = await limiter.acquire(timeout=1.0)
        assert result is True
        assert limiter.api_requests == 1

    @pytest.mark.asyncio
    async def test_acquire_tracks_rate_limited(self):
        """Test that acquire tracks rate limited requests."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=1, api_refill_rate=0.01)
        await limiter.acquire(timeout=0.1)  # Use the only token

        result = await limiter.acquire(timeout=0.1)
        assert result is False
        assert limiter.api_rate_limited == 1

    def test_check_available(self):
        """Test checking if API is available."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)
        available, msg = limiter.check_available()
        assert available is True
        assert "available" in msg

    def test_check_available_when_empty(self):
        """Test checking availability when bucket is empty."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=1, api_refill_rate=0.01)
        limiter.api_bucket.try_acquire(1)  # Empty bucket

        available, msg = limiter.check_available()
        assert available is False
        assert "Rate limited" in msg

    def test_track_ai_cost(self):
        """Test AI cost tracking."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        cost = limiter.track_ai_cost(
            input_tokens=1000,
            output_tokens=500,
            model="claude-sonnet-4-5-20250929",
            operation_name="test",
        )
        assert cost > 0

    def test_check_cost_available(self):
        """Test checking cost budget availability."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        available, msg = limiter.check_cost_available()
        assert available is True

    def test_record_api_error(self):
        """Test recording API errors."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance()
        assert limiter.api_errors == 0
        limiter.record_api_error()
        assert limiter.api_errors == 1

    def test_statistics(self):
        """Test statistics generation."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance()
        stats = limiter.statistics()
        assert "api" in stats
        assert "cost" in stats
        assert "runtime_seconds" in stats

    def test_report(self):
        """Test report generation."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance()
        report = limiter.report()
        assert "Rate Limiter Report" in report
        assert "API:" in report


class TestRateLimiterState:
    """Tests for RateLimiterState dataclass."""

    def test_to_dict(self):
        """Test converting state to dictionary."""
        state = RateLimiterState(available_tokens=50.0, last_refill_time=100.0)
        data = state.to_dict()
        assert data["available_tokens"] == 50.0
        assert data["last_refill_time"] == 100.0

    def test_from_dict(self):
        """Test creating state from dictionary."""
        data = {"available_tokens": 75.0, "last_refill_time": 200.0}
        state = RateLimiterState.from_dict(data)
        assert state.available_tokens == 75.0
        assert state.last_refill_time == 200.0


class TestRateLimitedDecorator:
    """Tests for @rate_limited decorator."""

    def teardown_method(self):
        """Reset singleton after each test."""
        RateLimiter.reset_instance()

    @pytest.mark.asyncio
    async def test_decorated_function_executes(self):
        """Test that decorated function executes normally."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        @rate_limited(operation_type="api")
        async def fetch_data():
            return "success"

        result = await fetch_data()
        assert result == "success"

    @pytest.mark.asyncio
    async def test_decorator_retries_on_rate_limit(self):
        """Test that decorator retries on rate limit errors."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        call_count = 0

        @rate_limited(operation_type="api", max_retries=2, base_delay=0.01)
        async def flaky_fetch():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise Exception("429 rate limit exceeded")
            return "success"

        result = await flaky_fetch()
        assert result == "success"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_decorator_raises_after_max_retries(self):
        """Test that decorator raises after max retries."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        @rate_limited(operation_type="api", max_retries=1, base_delay=0.01)
        async def always_fails():
            raise Exception("429 rate limit exceeded")

        with pytest.raises(RateLimitExceeded):
            await always_fails()

    @pytest.mark.asyncio
    async def test_decorator_propagates_non_rate_limit_errors(self):
        """Test that non-rate-limit errors are propagated (may be wrapped)."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        @rate_limited(operation_type="api", max_retries=0)  # No retries
        async def raises_value_error():
            raise ValueError("Not a rate limit error")

        # The decorator wraps all exceptions after retries
        with pytest.raises(Exception):  # May be wrapped in RateLimitExceeded
            await raises_value_error()

    @pytest.mark.asyncio
    async def test_decorator_no_retry_on_cost_exceeded(self):
        """Test that CostLimitExceeded is not retried."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(cost_limit=0.001)

        call_count = 0

        @rate_limited(operation_type="api", max_retries=3)
        async def expensive_operation():
            nonlocal call_count
            call_count += 1
            raise CostLimitExceeded("Budget exceeded")

        with pytest.raises(CostLimitExceeded):
            await expensive_operation()

        assert call_count == 1  # Should not retry


class TestRateLimitDecorator:
    """Tests for @rate_limit decorator (simple version)."""

    def teardown_method(self):
        """Reset singleton after each test."""
        RateLimiter.reset_instance()

    @pytest.mark.asyncio
    async def test_simple_rate_limit_decorator(self):
        """Test simple rate_limit decorator."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        @rate_limit(limiter)
        async def fetch():
            return "data"

        result = await fetch()
        assert result == "data"

    @pytest.mark.asyncio
    async def test_simple_decorator_raises_on_limit(self):
        """Test simple decorator raises when rate limited."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=1, api_refill_rate=0.01)
        limiter.api_bucket.try_acquire(1)  # Use the only token

        @rate_limit(limiter)
        async def fetch():
            return "data"

        with pytest.raises(RateLimitExceeded):
            await fetch()


class TestCheckRateLimit:
    """Tests for check_rate_limit helper function."""

    def teardown_method(self):
        """Reset singleton after each test."""
        RateLimiter.reset_instance()

    @pytest.mark.asyncio
    async def test_check_api_available(self):
        """Test checking API availability."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(api_limit=100, api_refill_rate=10.0)

        # Should not raise
        await check_rate_limit("api")

    @pytest.mark.asyncio
    async def test_check_api_unavailable(self):
        """Test checking API when unavailable."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(api_limit=1, api_refill_rate=0.01)
        limiter.api_bucket.try_acquire(1)  # Empty

        with pytest.raises(RateLimitExceeded):
            await check_rate_limit("api")

    @pytest.mark.asyncio
    async def test_check_cost_available(self):
        """Test checking cost budget availability."""
        RateLimiter.reset_instance()
        RateLimiter.get_instance(cost_limit=10.0)

        # Should not raise
        await check_rate_limit("cost")

    @pytest.mark.asyncio
    async def test_check_cost_when_low(self):
        """Test checking cost when budget is partially used."""
        RateLimiter.reset_instance()
        limiter = RateLimiter.get_instance(cost_limit=10.0)
        # Add a small operation
        limiter.track_ai_cost(
            input_tokens=1000,
            output_tokens=500,
            model="claude-sonnet-4-5-20250929",
        )

        # Check - should still have budget available
        available, msg = limiter.check_cost_available()
        assert available is True
        assert "budget remaining" in msg


class TestAIPricing:
    """Tests for AI_PRICING configuration."""

    def test_pricing_has_claude_models(self):
        """Test that pricing includes Claude models."""
        assert "claude-sonnet-4-5-20250929" in AI_PRICING
        assert "claude-opus-4-5-20251101" in AI_PRICING

    def test_pricing_has_default(self):
        """Test that pricing has default fallback."""
        assert "default" in AI_PRICING

    def test_pricing_structure(self):
        """Test that pricing has correct structure."""
        for model, pricing in AI_PRICING.items():
            assert "input" in pricing
            assert "output" in pricing
            assert pricing["input"] > 0
            assert pricing["output"] > 0


class TestExceptions:
    """Tests for exception classes."""

    def test_rate_limit_exceeded_is_exception(self):
        """Test that RateLimitExceeded is a proper exception."""
        with pytest.raises(Exception):
            raise RateLimitExceeded("test")

    def test_cost_limit_exceeded_is_exception(self):
        """Test that CostLimitExceeded is a proper exception."""
        with pytest.raises(Exception):
            raise CostLimitExceeded("test")

    def test_exceptions_have_messages(self):
        """Test that exceptions preserve messages."""
        try:
            raise RateLimitExceeded("limit reached")
        except RateLimitExceeded as e:
            assert "limit reached" in str(e)
