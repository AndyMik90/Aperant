"""
GitLab Rate Limiter Tests
=========================

Tests for token bucket rate limiting.
"""

import asyncio
import time
from unittest.mock import patch

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


class TestRateLimiter:
    """Test RateLimiter for API rate limiting."""

    @pytest.fixture
    def limiter(self):
        """Create a rate limiter for testing."""
        from runners.gitlab.utils.rate_limiter import RateLimiter

        return RateLimiter(
            requests_per_minute=60,
            burst_size=10,
        )

    def test_rate_limiter_initialization(self):
        """Test rate limiter initializes correctly."""
        from runners.gitlab.utils.rate_limiter import RateLimiter

        limiter = RateLimiter(
            requests_per_minute=60,
            burst_size=10,
        )

        assert limiter.requests_per_minute == 60
        assert limiter.burst_size == 10

    def test_acquire_request(self, limiter):
        """Test acquiring a request slot."""
        success = limiter.acquire()

        assert success is True

    def test_acquire_burst(self, limiter):
        """Test burst requests."""
        # Should be able to make burst_size requests immediately
        for _ in range(10):
            success = limiter.acquire()
            assert success is True

    def test_acquire_exceeds_burst(self, limiter):
        """Test exceeding burst limit."""
        # Consume burst capacity
        for _ in range(10):
            limiter.acquire()

        # Next request should fail
        success = limiter.acquire()
        assert success is False

    def test_acquire_with_wait(self, limiter):
        """Test acquire with wait option."""
        # Consume burst
        for _ in range(10):
            limiter.acquire()

        # Should wait for refill
        start = time.time()
        success = limiter.acquire(wait=True)
        elapsed = time.time() - start

        assert success is True
        # At 60 req/min, 1 request = 1 second
        assert elapsed >= 0.9

    def test_get_wait_time(self, limiter):
        """Test getting wait time."""
        # No wait needed initially
        wait_time = limiter.get_wait_time()
        assert wait_time == 0

        # Consume burst
        for _ in range(10):
            limiter.acquire()

        # Should need to wait
        wait_time = limiter.get_wait_time()
        assert wait_time > 0

    def test_reset(self, limiter):
        """Test resetting rate limiter."""
        # Consume some capacity
        for _ in range(5):
            limiter.acquire()

        limiter.reset()

        # Should have full capacity
        success = limiter.acquire()
        assert success is True

    def test_rate_limiter_state_tracking(self, limiter):
        """Test rate limiter tracks request state."""
        from runners.gitlab.utils.rate_limiter import RateLimiterState

        state = limiter.get_state()

        assert isinstance(state, RateLimiterState)
        assert state.available_tokens >= 0
        assert state.available_tokens <= limiter.burst_size

    def test_concurrent_requests(self, limiter):
        """Test concurrent request handling."""
        import threading

        results = []

        def make_request():
            success = limiter.acquire(wait=True)
            results.append(success)

        threads = [threading.Thread(target=make_request) for _ in range(15)]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        # All requests should succeed (some wait for refill)
        assert all(results)

    def test_rate_limiter_persistence(self, limiter, tmp_path):
        """Test saving and loading rate limiter state."""
        state_file = tmp_path / "rate_limiter_state.json"

        # Consume some tokens
        for _ in range(5):
            limiter.acquire()

        # Save state
        limiter.save_state(state_file)

        # Create new limiter and load state
        from runners.gitlab.utils.rate_limiter import RateLimiter

        new_limiter = RateLimiter(
            requests_per_minute=60,
            burst_size=10,
        )
        new_limiter.load_state(state_file)

        # Should have same state
        original_state = limiter.get_state()
        loaded_state = new_limiter.get_state()

        assert abs(original_state.available_tokens - loaded_state.available_tokens) < 1


class TestRateLimiterIntegration:
    """Integration tests for rate limiting with API calls."""

    def test_rate_limiter_with_api_client(self):
        """Test rate limiter integrates with API client."""
        from runners.gitlab.utils.rate_limiter import RateLimiter

        limiter = RateLimiter(
            requests_per_minute=60,
            burst_size=5,
        )

        call_count = 0

        def mock_api_call():
            nonlocal call_count
            if limiter.acquire(wait=True):
                call_count += 1
                return {"data": "success"}
            return {"error": "rate limited"}

        # Make several calls
        results = [mock_api_call() for _ in range(8)]

        # Should have made all calls successfully (some waited)
        assert call_count == 8
        assert all(r.get("data") for r in results)

    def test_rate_limiter_respects_backoff(self):
        """Test rate limiter handles backoff correctly."""
        from runners.gitlab.utils.rate_limiter import RateLimiter

        limiter = RateLimiter(
            requests_per_minute=30,  # 0.5 req/sec
            burst_size=3,
        )

        times = []

        def track_time():
            times.append(time.time())
            return limiter.acquire(wait=True)

        # Make burst + 1 requests
        for _ in range(4):
            track_time()

        # First 3 should be immediate (burst)
        # 4th should have waited
        burst_duration = times[2] - times[0]
        wait_duration = times[3] - times[2]

        # 4th request should have taken longer
        assert wait_duration > burst_duration

    @pytest.mark.asyncio
    async def test_async_rate_limiting(self):
        """Test rate limiting with async operations."""
        from runners.gitlab.utils.rate_limiter import RateLimiter

        limiter = RateLimiter(
            requests_per_minute=60,
            burst_size=5,
        )

        async def make_request(i):
            if limiter.acquire(wait=True):
                await asyncio.sleep(0.01)  # Simulate API call
                return f"request-{i}"
            return "rate-limited"

        results = await asyncio.gather(*[make_request(i) for i in range(8)])

        # All should succeed
        assert len(results) == 8
        assert all("rate-limited" not in r for r in results)


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


class TestRateLimiterDecorators:
    """Test rate limiter decorators."""

    def test_rate_limit_decorator(self):
        """Test rate limit decorator for functions."""
        from runners.gitlab.utils.rate_limiter import rate_limit

        limiter = type(
            "MockLimiter",
            (),
            {
                "acquire": lambda wait=True: True,
            },
        )()

        @rate_limit(limiter)
        def api_function():
            return "success"

        result = api_function()
        assert result == "success"

    def test_rate_limit_decorator_with_wait(self):
        """Test rate limit decorator respects wait parameter."""
        from runners.gitlab.utils.rate_limiter import rate_limit

        call_count = 0

        class MockLimiter:
            def acquire(self, wait=True):
                nonlocal call_count
                call_count += 1
                return call_count <= 3  # Fail after 3 calls

        limiter = MockLimiter()

        @rate_limit(limiter, wait=True)
        def api_function():
            return "success"

        # First 3 succeed
        for _ in range(3):
            result = api_function()
            assert result == "success"

        # 4th should fail (would wait but our mock returns False)
        result = api_function()
        assert result is None


class TestAdaptiveRateLimiting:
    """Test adaptive rate limiting based on responses."""

    def test_adaptive_backoff_on_429(self):
        """Test adaptive backoff on rate limit errors."""
        from runners.gitlab.utils.rate_limiter import AdaptiveRateLimiter

        limiter = AdaptiveRateLimiter(
            requests_per_minute=60,
            burst_size=10,
        )

        # Simulate rate limit response
        limiter.handle_response(status_code=429)

        # Should reduce rate
        state = limiter.get_state()
        assert state.adaptive_factor < 1.0

    def test_adaptive_recovery_on_success(self):
        """Test adaptive recovery on successful requests."""
        from runners.gitlab.utils.rate_limiter import AdaptiveRateLimiter

        limiter = AdaptiveRateLimiter(
            requests_per_minute=60,
            burst_size=10,
        )

        # Trigger backoff
        limiter.handle_response(status_code=429)

        # Recover with successful requests
        for _ in range(10):
            limiter.handle_response(status_code=200)

        # Should recover rate
        state = limiter.get_state()
        assert state.adaptive_factor >= 0.9

    def test_adaptive_minimum_rate(self):
        """Test adaptive rate has minimum floor."""
        from runners.gitlab.utils.rate_limiter import AdaptiveRateLimiter

        limiter = AdaptiveRateLimiter(
            requests_per_minute=60,
            burst_size=10,
            min_adaptive_factor=0.1,
        )

        # Trigger many backoffs
        for _ in range(100):
            limiter.handle_response(status_code=429)

        # Should not go below minimum
        state = limiter.get_state()
        assert state.adaptive_factor >= 0.1
