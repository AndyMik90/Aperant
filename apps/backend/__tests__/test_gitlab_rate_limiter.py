"""
GitLab Rate Limiter Tests
=========================

Tests for token bucket rate limiting and rate limiter state model.
"""

import time

import pytest


class TestTokenBucket:
    """Test TokenBucket for rate limiting."""

    def test_token_bucket_initialization(self):
        """Test token bucket initializes correctly."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        assert bucket.capacity == 10
        assert bucket.refill_rate == 5.0
        assert bucket.tokens == 10

    def test_token_bucket_consume_success(self):
        """Test consuming tokens when available."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        success = bucket.consume(1)

        assert success is True
        assert bucket.available() == 9

    def test_token_bucket_consume_multiple(self):
        """Test consuming multiple tokens."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        success = bucket.consume(5)

        assert success is True
        assert bucket.available() == 5

    def test_token_bucket_consume_insufficient(self):
        """Test consuming when insufficient tokens."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        # Consume more than available
        success = bucket.consume(15)

        assert success is False
        assert bucket.available() == 10  # Should not change

    def test_token_bucket_refill(self):
        """Test token refill over time."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=10.0)

        # Consume all tokens
        bucket.consume(10)
        assert bucket.available() == 0

        # Wait for refill (0.1 seconds at 10 tokens/sec = 1 token)
        time.sleep(0.11)

        # Check refill - use get_available() to trigger refill
        available = bucket.get_available()
        assert available >= 1

    def test_token_bucket_refill_cap(self):
        """Test tokens don't exceed capacity."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=100.0)

        # Wait long time for refill
        time.sleep(0.2)

        # Should not exceed capacity - use available() to trigger refill
        assert bucket.available() <= 10

    def test_token_bucket_wait_for_token(self):
        """Test waiting for token availability."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=5, refill_rate=10.0)

        # Consume all
        bucket.consume(5)

        # Should wait for refill
        start = time.time()
        bucket.consume(1, wait=True)
        elapsed = time.time() - start

        # Should have waited at least 0.1 seconds
        assert elapsed >= 0.1

    def test_token_bucket_wait_with_tokens(self):
        """Test wait returns immediately when tokens available."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        start = time.time()
        bucket.consume(1, wait=True)
        elapsed = time.time() - start

        # Should be immediate
        assert elapsed < 0.01

    def test_token_bucket_get_available(self):
        """Test getting available token count."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        assert bucket.get_available() == 10

        bucket.consume(3)
        assert bucket.get_available() == 7

    def test_token_bucket_reset(self):
        """Test resetting token bucket."""
        from runners.gitlab.utils.rate_limiter import TokenBucket

        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        bucket.consume(5)
        assert bucket.tokens == 5

        bucket.reset()
        assert bucket.tokens == 10


class TestRateLimiterState:
    """Test RateLimiterState model."""

    def test_state_creation(self):
        """Test creating state object."""
        from runners.gitlab.utils.rate_limiter import RateLimiterState

        state = RateLimiterState(
            available_tokens=5.0,
            last_refill_time=1234567890.0,
        )

        assert state.available_tokens == 5.0
        assert state.last_refill_time == 1234567890.0

    def test_state_to_dict(self):
        """Test converting state to dict."""
        from runners.gitlab.utils.rate_limiter import RateLimiterState

        state = RateLimiterState(
            available_tokens=7.5,
            last_refill_time=1234567890.0,
        )

        data = state.to_dict()

        assert data["available_tokens"] == 7.5
        assert data["last_refill_time"] == 1234567890.0

    def test_state_from_dict(self):
        """Test loading state from dict."""
        from runners.gitlab.utils.rate_limiter import RateLimiterState

        data = {
            "available_tokens": 8.0,
            "last_refill_time": 1234567890.0,
        }

        state = RateLimiterState.from_dict(data)

        assert state.available_tokens == 8.0
        assert state.last_refill_time == 1234567890.0
