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

    def test_does_not_have_access_to_claude(self):
        """Detect 'does not have access to Claude' - returned as AI text response."""
        err = Exception(
            "Your account does not have access to Claude. "
            "Please login again or contact your administrator."
        )
        assert is_authentication_error(err) is True

    def test_please_login_again(self):
        err = Exception("Please login again to continue.")
        assert is_authentication_error(err) is True


# =============================================================================
# _is_auth_error_response (from sdk_utils)
# =============================================================================


class TestIsAuthErrorResponse:
    """Tests for _is_auth_error_response() length guard in sdk_utils.

    Uses importlib to load the module directly to avoid heavy package imports.
    """

    @staticmethod
    def _load_fn():
        """Load _is_auth_error_response without triggering runners.github.__init__."""
        import importlib.util
        import os

        spec = importlib.util.spec_from_file_location(
            "sdk_utils",
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "apps",
                "backend",
                "runners",
                "github",
                "services",
                "sdk_utils.py",
            ),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod._is_auth_error_response

    def test_short_auth_error_detected(self):
        """Short auth error text should be detected."""
        fn = self._load_fn()
        assert fn("Your account does not have access to Claude.") is True

    def test_short_please_login_again(self):
        """Short 'please login again' text should be detected."""
        fn = self._load_fn()
        assert fn("Please login again to continue.") is True

    def test_long_ai_discussion_not_detected(self):
        """Long AI discussion text mentioning auth phrases should NOT be detected."""
        fn = self._load_fn()
        long_review = (
            "This PR adds authentication error detection to prevent infinite retry loops. "
            "When the API returns a message like 'does not have access to Claude', the system "
            "now detects it and stops retrying. However, this pattern could also match if a "
            "user discusses authentication in a PR review. We should ensure the detection is "
            "specific enough to avoid false positives. The phrase 'please login again' could "
            "appear in normal discussion about auth flows without indicating an actual error."
        )
        assert len(long_review) > 300
        assert fn(long_review) is False

    def test_empty_text_not_detected(self):
        """Empty text should not be detected."""
        fn = self._load_fn()
        assert fn("") is False

    def test_unrelated_short_text_not_detected(self):
        """Short text without auth phrases should not be detected."""
        fn = self._load_fn()
        assert fn("Task completed successfully.") is False

    def test_generic_access_denied_not_detected(self):
        """Generic 'account does not have access' should NOT trigger (too broad)."""
        fn = self._load_fn()
        assert fn("This account does not have access to the repository.") is False
        assert fn("The service account does not have access to deploy.") is False

    def test_boundary_exactly_300_chars_detected(self):
        """Text of exactly 300 chars with auth phrase should be detected."""
        fn = self._load_fn()
        base = "does not have access to claude"  # 30 chars
        text_300 = base + "x" * (300 - len(base))
        assert len(text_300) == 300
        assert fn(text_300) is True

    def test_boundary_301_chars_not_detected(self):
        """Text of 301 chars with auth phrase should NOT be detected (> 300)."""
        fn = self._load_fn()
        base = "does not have access to claude"  # 30 chars
        text_301 = base + "x" * (301 - len(base))
        assert len(text_301) == 301
        assert fn(text_301) is False
