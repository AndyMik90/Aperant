"""
Tests for core/error_utils.py
==============================

Unit tests for error classification functions used across agent sessions and QA.
"""

from core.error_utils import (
    is_authentication_error,
    is_rate_limit_error,
    is_tool_concurrency_error,
)

# =============================================================================
# is_tool_concurrency_error
# =============================================================================


class TestIsToolConcurrencyError:
    """Tests for is_tool_concurrency_error()."""

    def test_400_tool_concurrency_error(self):
        err = Exception("400 tool concurrency error")
        assert is_tool_concurrency_error(err) is True

    def test_400_too_many_tools_running(self):
        err = Exception("400 too many tools running simultaneously")
        assert is_tool_concurrency_error(err) is True

    def test_400_concurrent_tool_limit(self):
        err = Exception("400 concurrent tool limit exceeded")
        assert is_tool_concurrency_error(err) is True

    def test_401_unauthorized_not_concurrency(self):
        err = Exception("401 unauthorized")
        assert is_tool_concurrency_error(err) is False

    def test_429_rate_limit_not_concurrency(self):
        err = Exception("429 rate limit exceeded")
        assert is_tool_concurrency_error(err) is False

    def test_400_bad_request_no_tool_keywords(self):
        err = Exception("400 bad request: invalid parameter")
        assert is_tool_concurrency_error(err) is False

    def test_500_server_error(self):
        err = Exception("500 internal server error")
        assert is_tool_concurrency_error(err) is False

    def test_empty_error_message(self):
        err = Exception("")
        assert is_tool_concurrency_error(err) is False

    def test_400_without_concurrency_keyword(self):
        err = Exception("400 tool execution failed")
        assert is_tool_concurrency_error(err) is False

    def test_case_insensitive(self):
        err = Exception("400 Tool Concurrency Error")
        assert is_tool_concurrency_error(err) is True


# =============================================================================
# is_rate_limit_error
# =============================================================================


class TestIsRateLimitError:
    """Tests for is_rate_limit_error()."""

    def test_http_429(self):
        err = Exception("HTTP 429 Too Many Requests")
        assert is_rate_limit_error(err) is True

    def test_429_with_word_boundary(self):
        err = Exception("Error: 429 rate limit")
        assert is_rate_limit_error(err) is True

    def test_limit_reached(self):
        err = Exception("API limit reached for this session")
        assert is_rate_limit_error(err) is True

    def test_rate_limit_phrase(self):
        err = Exception("rate limit exceeded, try again later")
        assert is_rate_limit_error(err) is True

    def test_too_many_requests(self):
        err = Exception("too many requests, slow down")
        assert is_rate_limit_error(err) is True

    def test_usage_limit(self):
        err = Exception("usage limit exceeded for weekly quota")
        assert is_rate_limit_error(err) is True

    def test_quota_exceeded(self):
        err = Exception("quota exceeded for this billing period")
        assert is_rate_limit_error(err) is True

    def test_401_unauthorized_not_rate_limit(self):
        err = Exception("401 unauthorized")
        assert is_rate_limit_error(err) is False

    def test_400_bad_request_not_rate_limit(self):
        err = Exception("400 bad request")
        assert is_rate_limit_error(err) is False

    def test_500_server_error(self):
        err = Exception("500 internal server error")
        assert is_rate_limit_error(err) is False

    def test_empty_error_message(self):
        err = Exception("")
        assert is_rate_limit_error(err) is False

    def test_429_embedded_in_number_no_boundary(self):
        """429 embedded in a larger number should not match due to word boundaries."""
        err = Exception("error code 14290 encountered")
        assert is_rate_limit_error(err) is False

    def test_case_insensitive(self):
        err = Exception("Rate Limit Exceeded")
        assert is_rate_limit_error(err) is True


# =============================================================================
# is_authentication_error
# =============================================================================


class TestIsAuthenticationError:
    """Tests for is_authentication_error()."""

    def test_http_401(self):
        err = Exception("HTTP 401 Unauthorized")
        assert is_authentication_error(err) is True

    def test_401_with_word_boundary(self):
        err = Exception("Error: 401 authentication required")
        assert is_authentication_error(err) is True

    def test_authentication_failed(self):
        err = Exception("authentication failed: invalid credentials")
        assert is_authentication_error(err) is True

    def test_authentication_error_phrase(self):
        err = Exception("authentication error occurred")
        assert is_authentication_error(err) is True

    def test_unauthorized(self):
        err = Exception("unauthorized access to resource")
        assert is_authentication_error(err) is True

    def test_invalid_token(self):
        err = Exception("invalid token provided")
        assert is_authentication_error(err) is True

    def test_token_expired(self):
        err = Exception("token expired, please re-authenticate")
        assert is_authentication_error(err) is True

    def test_authentication_error_underscore(self):
        err = Exception("authentication_error: check credentials")
        assert is_authentication_error(err) is True

    def test_invalid_token_underscore(self):
        err = Exception("invalid_token in request header")
        assert is_authentication_error(err) is True

    def test_token_expired_underscore(self):
        err = Exception("token_expired: refresh required")
        assert is_authentication_error(err) is True

    def test_not_authenticated(self):
        err = Exception("not authenticated")
        assert is_authentication_error(err) is True

    def test_http_401_lowercase(self):
        err = Exception("http 401 error")
        assert is_authentication_error(err) is True

    def test_429_rate_limit_not_auth(self):
        err = Exception("429 rate limit exceeded")
        assert is_authentication_error(err) is False

    def test_400_bad_request_not_auth(self):
        err = Exception("400 bad request")
        assert is_authentication_error(err) is False

    def test_500_server_error(self):
        err = Exception("500 internal server error")
        assert is_authentication_error(err) is False

    def test_empty_error_message(self):
        err = Exception("")
        assert is_authentication_error(err) is False

    def test_401_embedded_in_number_no_boundary(self):
        """401 embedded in a larger number should not match due to word boundaries."""
        err = Exception("error code 14010 encountered")
        assert is_authentication_error(err) is False

    def test_case_insensitive(self):
        err = Exception("UNAUTHORIZED access denied")
        assert is_authentication_error(err) is True
