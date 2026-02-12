"""
GitLab Rate Limiter Tests
=========================

Tests for token bucket rate limiting and rate limiter state model.
"""

import time
from unittest.mock import patch

import pytest
from runners.gitlab.utils.rate_limiter import RateLimiterState, TokenBucket


class TestTokenBucket:
    """Test TokenBucket for rate limiting."""

    def test_token_bucket_initialization(self):
        """Test token bucket initializes correctly."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        assert bucket.capacity == 10
        assert bucket.refill_rate == 5.0
        assert bucket.tokens == 10

    def test_token_bucket_consume_success(self):
        """Test consuming tokens when available."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        success = bucket.consume(1)

        assert success is True
        assert bucket.available() == 9

    def test_token_bucket_consume_multiple(self):
        """Test consuming multiple tokens."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        success = bucket.consume(5)

        assert success is True
        assert bucket.available() == 5

    def test_token_bucket_consume_insufficient(self):
        """Test consuming when insufficient tokens."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        # Consume more than available
        success = bucket.consume(15)

        assert success is False
        assert bucket.available() == 10  # Should not change

    def test_token_bucket_refill(self):
        """Test token refill over time with mocked time."""
        # Use an incrementing counter for time to control the flow
        time_values = [0.0]  # Start at 0

        def get_time():
            return time_values[0]

        def advance_time(delta):
            time_values[0] += delta

        with patch(
            "runners.gitlab.utils.rate_limiter.time.monotonic", side_effect=get_time
        ):
            bucket = TokenBucket(capacity=10, refill_rate=10.0)

            # Consume all tokens (time is still 0.0)
            bucket.consume(10)
            assert bucket.available() == 0

            # Advance time by 0.15 seconds
            advance_time(0.15)

            # Now get_available should show refill (0.15 sec * 10 tokens/sec = 1.5 tokens)
            available = bucket.get_available()
            assert available >= 1

    def test_token_bucket_refill_cap(self):
        """Test tokens don't exceed capacity with mocked time."""
        # Use an incrementing counter for time to control the flow
        time_values = [0.0]

        def get_time():
            return time_values[0]

        with patch(
            "runners.gitlab.utils.rate_limiter.time.monotonic", side_effect=get_time
        ):
            bucket = TokenBucket(capacity=10, refill_rate=100.0)

            # Advance time by 1 second (would add 100 tokens without cap)
            time_values[0] = 1.0

            # Should not exceed capacity
            assert bucket.available() <= 10

    def test_token_bucket_wait_for_token(self):
        """Test waiting for token availability."""
        bucket = TokenBucket(capacity=5, refill_rate=10.0)

        # Consume all
        bucket.consume(5)

        # Mock time.sleep to avoid flaky timing-based tests
        sleep_calls = []
        with patch("time.sleep", side_effect=lambda x: sleep_calls.append(x)):
            bucket.consume(1, wait=True)

        # Should have called sleep to wait for refill
        assert len(sleep_calls) >= 1
        # First sleep should be for about 0.1 seconds (1 token / 10 tokens per sec)
        assert sleep_calls[0] > 0

    def test_token_bucket_wait_with_tokens(self):
        """Test wait returns immediately when tokens available."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        start = time.time()
        bucket.consume(1, wait=True)
        elapsed = time.time() - start

        # Should be immediate
        assert elapsed < 0.01

    def test_token_bucket_get_available(self):
        """Test getting available token count."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        assert bucket.get_available() == 10

        bucket.consume(3)
        assert bucket.get_available() == 7

    def test_token_bucket_reset(self):
        """Test resetting token bucket."""
        bucket = TokenBucket(capacity=10, refill_rate=5.0)

        bucket.consume(5)
        assert bucket.tokens == 5

        bucket.reset()
        assert bucket.tokens == 10


class TestRateLimiterState:
    """Test RateLimiterState model."""

    def test_state_creation(self):
        """Test creating state object."""
        state = RateLimiterState(
            available_tokens=5.0,
            last_refill_time=1234567890.0,
        )

        assert state.available_tokens == 5.0
        assert state.last_refill_time == 1234567890.0

    def test_state_to_dict(self):
        """Test converting state to dict."""
        state = RateLimiterState(
            available_tokens=7.5,
            last_refill_time=1234567890.0,
        )

        data = state.to_dict()

        assert data["available_tokens"] == 7.5
        assert data["last_refill_time"] == 1234567890.0

    def test_state_from_dict(self):
        """Test loading state from dict."""
        data = {
            "available_tokens": 8.0,
            "last_refill_time": 1234567890.0,
        }

        state = RateLimiterState.from_dict(data)

        assert state.available_tokens == 8.0
        assert state.last_refill_time == 1234567890.0
