"""
Tests for GitLab Client Error Handling
=======================================

Tests for enhanced retry logic, rate limiting, and error handling.
"""

import socket
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest

try:
    from runners.gitlab.glab_client import GitLabClient, GitLabConfig
except ImportError:
    from glab_client import GitLabClient, GitLabConfig


@pytest.fixture
def mock_config():
    """Create a mock GitLab config."""
    return GitLabConfig(
        token="test-token",
        project="namespace/test-project",
        instance_url="https://gitlab.example.com",
    )


@pytest.fixture
def client(mock_config, tmp_path):
    """Create a GitLab client instance."""
    return GitLabClient(
        project_dir=tmp_path,
        config=mock_config,
        default_timeout=5.0,
    )


def _create_mock_response(
    status=200, content=b'{"id": 123}', content_type="application/json", headers=None
):
    """Helper to create a mock HTTP response."""
    mock_resp = Mock()
    mock_resp.status = status
    mock_resp.read = lambda: content
    # Use a real dict for headers to properly support .get() method
    headers_dict = {"Content-Type": content_type}
    if headers:
        headers_dict.update(headers)
    mock_resp.headers = headers_dict
    # Support context manager protocol
    mock_resp.__enter__ = Mock(return_value=mock_resp)
    mock_resp.__exit__ = Mock(return_value=False)
    return mock_resp


class TestRetryLogic:
    """Tests for retry logic on transient failures."""

    @pytest.mark.asyncio
    async def test_retry_on_429_rate_limit(self, client):
        """Test retry on HTTP 429 rate limit."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call: rate limited
                error = urllib.error.HTTPError(
                    url="https://example.com",
                    code=429,
                    msg="Rate limited",
                    hdrs={"Retry-After": "1"},
                    fp=None,
                )
                error.read = lambda: b""
                raise error
            # Second call: success
            return _create_mock_response()

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            assert call_count == 2  # Retried once

    @pytest.mark.asyncio
    async def test_retry_on_500_server_error(self, client):
        """Test retry on HTTP 500 server error."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                error = urllib.error.HTTPError(
                    url="https://example.com",
                    code=500,
                    msg="Internal server error",
                    hdrs={},
                    fp=None,
                )
                error.read = lambda: b""
                raise error
            return _create_mock_response()

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_502_bad_gateway(self, client):
        """Test retry on HTTP 502 bad gateway."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                error = urllib.error.HTTPError(
                    url="https://example.com",
                    code=502,
                    msg="Bad gateway",
                    hdrs={},
                    fp=None,
                )
                error.read = lambda: b""
                raise error
            return _create_mock_response()

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_socket_timeout(self, client):
        """Test retry on socket timeout."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise TimeoutError("Connection timed out")
            return _create_mock_response()

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_connection_reset(self, client):
        """Test retry on connection reset."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionResetError("Connection reset")
            return _create_mock_response()

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            assert call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_404_not_found(self, client):
        """Test that 404 errors are not retried."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            error = urllib.error.HTTPError(
                url="https://example.com",
                code=404,
                msg="Not found",
                hdrs={},
                fp=None,
            )
            error.read = lambda: b""
            raise error

        with patch("urllib.request.urlopen", mock_urlopen):
            with pytest.raises(Exception):  # noqa: B017
                client._fetch("/projects/namespace%2Fproject")

            assert call_count == 1  # No retry

    @pytest.mark.asyncio
    async def test_max_retries_exceeded(self, client):
        """Test that max retries limit is respected."""
        call_count = 0

        def mock_urlopen(request, timeout=None):
            nonlocal call_count
            call_count += 1
            # Always fail
            raise urllib.error.HTTPError(
                url="https://example.com",
                code=500,
                msg="Server error",
                hdrs={},
                fp=None,
            )

        with patch("urllib.request.urlopen", mock_urlopen):
            with pytest.raises(Exception, match="GitLab API error"):
                client._fetch("/projects/namespace%2Fproject", max_retries=2)

            # With max_retries=2, the loop runs range(2) = [0, 1], so 2 attempts total
            assert call_count == 2


class TestRateLimiting:
    """Tests for rate limit handling."""

    @pytest.mark.asyncio
    async def test_retry_after_header_parsing(self, client):
        """Test parsing Retry-After header."""
        import time

        def mock_urlopen(request, timeout=None):
            error = urllib.error.HTTPError(
                url="https://example.com",
                code=429,
                msg="Rate limited",
                hdrs={"Retry-After": "2"},
                fp=None,
            )
            error.read = lambda: b""
            raise error

        with patch("urllib.request.urlopen", mock_urlopen):
            with patch("time.sleep") as mock_sleep:
                # Should fail after retries
                with pytest.raises(Exception):  # noqa: B017
                    client._fetch("/projects/namespace%2Fproject")

                # Check that sleep was called with Retry-After value
                mock_sleep.assert_called_with(2)


class TestErrorMessages:
    """Tests for helpful error messages."""

    @pytest.mark.asyncio
    async def test_gitlab_error_message_included(self, client):
        """Test that GitLab error messages are included in exceptions."""

        def mock_urlopen(request, timeout=None):
            error = urllib.error.HTTPError(
                url="https://example.com",
                code=400,
                msg="Bad request",
                hdrs={},
                fp=None,
            )
            error.read = lambda: b'{"message": "Invalid branch name"}'
            raise error

        with patch("urllib.request.urlopen", mock_urlopen):
            with pytest.raises(Exception) as exc_info:
                client._fetch("/projects/namespace%2Fproject")

            # Error message should include GitLab's message
            assert "Invalid branch name" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_invalid_endpoint_raises(self, client):
        """Test that invalid endpoints are rejected."""
        with pytest.raises(
            ValueError, match="does not match known GitLab API patterns"
        ):
            client._fetch("/invalid/endpoint")


class TestResponseSizeLimits:
    """Tests for response size limits."""

    @pytest.mark.asyncio
    async def test_large_response_rejected(self, client):
        """Test that overly large responses are rejected."""

        def mock_urlopen(request, timeout=None):
            # Use application/json to trigger size check (status < 400)
            return _create_mock_response(
                content=b"Large response",
                content_type="application/json",
                headers={"Content-Length": str(20 * 1024 * 1024)},  # 20MB
            )

        with patch("urllib.request.urlopen", mock_urlopen):
            with pytest.raises(ValueError, match="Response too large"):
                client._fetch("/projects/namespace%2Fproject")


class TestContentTypeHandling:
    """Tests for Content-Type validation."""

    @pytest.mark.asyncio
    async def test_non_json_response_handling(self, client):
        """Test handling of non-JSON responses on success."""

        def mock_urlopen(request, timeout=None):
            mock_resp = _create_mock_response(
                content=b"Plain text response", content_type="text/plain"
            )
            return mock_resp

        with patch("urllib.request.urlopen", mock_urlopen):
            result = client._fetch("/projects/namespace%2Fproject")

            # Should return raw response for non-JSON on success
            assert result == "Plain text response"
