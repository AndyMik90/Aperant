"""
Tests for GitHub CLI Client (gh_client.py)
============================================

Tests the async wrapper for gh CLI commands with timeout and retry logic.
"""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

# Now we can use normal imports since __init__.py uses lazy loading
from runners.github.gh_client import (
    GHClient,
    GHTimeoutError,
    GHCommandError,
    GHCommandResult,
    PRTooLargeError,
)
from runners.github.rate_limiter import RateLimiter, RateLimitExceeded


# ============================================================================
# Helper function to create mock process
# ============================================================================


def create_mock_process(stdout=b'', stderr=b'', returncode=0):
    """Create a mock subprocess process."""
    mock_proc = AsyncMock()
    mock_proc.communicate = AsyncMock(return_value=(stdout, stderr))
    mock_proc.returncode = returncode
    mock_proc.kill = Mock()
    mock_proc.wait = AsyncMock(return_value=returncode)
    return mock_proc


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture(autouse=True)
def mock_gh_executable():
    """Mock get_gh_executable so tests don't depend on gh being installed."""
    with patch('runners.github.gh_client.get_gh_executable', return_value='gh'):
        yield


@pytest.fixture
def temp_project_dir(tmp_path):
    """Create a temporary project directory."""
    return tmp_path / "test_project"


@pytest.fixture
def gh_client(temp_project_dir):
    """Create a GHClient instance for testing."""
    # Disable rate limiting for tests
    return GHClient(project_dir=temp_project_dir, enable_rate_limiting=False)


# ============================================================================
# Initialization Tests
# ============================================================================


class TestGHClientInit:
    """Tests for GHClient initialization."""

    def test_init_with_defaults(self, temp_project_dir):
        """Test initialization with default values."""
        client = GHClient(project_dir=temp_project_dir)
        assert client.project_dir == temp_project_dir
        assert client.default_timeout == 30.0
        assert client.max_retries == 3

    def test_init_with_custom_timeout(self, temp_project_dir):
        """Test initialization with custom timeout."""
        client = GHClient(project_dir=temp_project_dir, default_timeout=300)
        assert client.default_timeout == 300

    def test_init_with_custom_retries(self, temp_project_dir):
        """Test initialization with custom retries."""
        client = GHClient(project_dir=temp_project_dir, max_retries=5)
        assert client.max_retries == 5


# ============================================================================
# run() Method Tests
# ============================================================================


class TestGHClientRun:
    """Tests for the run() method."""

    @pytest.mark.asyncio
    async def test_run_simple_command(self, gh_client):
        """Test running a simple gh command."""
        mock_proc = create_mock_process(
            stdout=b'{"result": "success"}',
            stderr=b'',
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.run(["version"])

                assert result.returncode == 0
                assert result.stdout == '{"result": "success"}'
                assert result.stderr == ''

    @pytest.mark.asyncio
    async def test_run_command_with_timeout(self, gh_client):
        """Test that timeout is enforced."""
        # Make communicate() raise TimeoutError
        mock_proc = create_mock_process(returncode=0)
        mock_proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                with pytest.raises(GHTimeoutError):
                    await gh_client.run(["pr", "list"])

    @pytest.mark.asyncio
    async def test_run_command_with_retries_on_timeout(self, gh_client):
        """Test that retries happen on timeout."""
        # Make communicate() raise TimeoutError first time, then succeed
        mock_proc = create_mock_process(returncode=0)
        call_count = [0]

        async def communicate_side_effect():
            call_count[0] += 1
            if call_count[0] == 1:
                raise asyncio.TimeoutError()
            return (b'{"success": true}', b'')

        mock_proc.communicate = AsyncMock(side_effect=communicate_side_effect)

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)
                with patch('asyncio.sleep'):  # Mock sleep between retries
                    gh_client.max_retries = 2

                    result = await gh_client.run(["pr", "list"])

                    assert result.returncode == 0
                    assert call_count[0] == 2  # 1 initial failed, 1 retry succeeded

    @pytest.mark.asyncio
    async def test_run_command_fails_on_nonzero_exit(self, gh_client):
        """Test that nonzero exit codes raise GHCommandError."""
        mock_proc = create_mock_process(
            stdout=b'',
            stderr=b'Error: not found',
            returncode=1
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                with pytest.raises(GHCommandError) as exc_info:
                    await gh_client.run(["pr", "view", "999"])

                assert "not found" in str(exc_info.value)


# ============================================================================
# PR Operations Tests
# ============================================================================


class TestGHClientPROperations:
    """Tests for PR-related operations."""

    @pytest.mark.asyncio
    async def test_pr_list(self, gh_client):
        """Test listing pull requests."""
        prs = [
            {"number": 1, "title": "First PR"},
            {"number": 2, "title": "Second PR"},
        ]
        mock_proc = create_mock_process(
            stdout=json.dumps(prs).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.pr_list()

                assert len(result) == 2
                assert result[0]["number"] == 1

    @pytest.mark.asyncio
    async def test_pr_get(self, gh_client):
        """Test getting a specific PR."""
        pr = {"number": 42, "title": "Test", "state": "open"}
        mock_proc = create_mock_process(
            stdout=json.dumps(pr).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.pr_get(42)

                assert result["number"] == 42

    @pytest.mark.asyncio
    async def test_pr_diff(self, gh_client):
        """Test getting PR diff."""
        diff_content = b"diff --git a/file.txt b/file.txt\n+new line"
        mock_proc = create_mock_process(
            stdout=diff_content,
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.pr_diff(42)

                assert "diff --git" in result


# ============================================================================
# Issue Operations Tests
# ============================================================================


class TestGHClientIssueOperations:
    """Tests for issue-related operations."""

    @pytest.mark.asyncio
    async def test_issue_list(self, gh_client):
        """Test listing issues."""
        issues = [
            {"number": 1, "title": "Bug"},
            {"number": 2, "title": "Feature"},
        ]
        mock_proc = create_mock_process(
            stdout=json.dumps(issues).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.issue_list()

                assert len(result) == 2

    @pytest.mark.asyncio
    async def test_issue_get(self, gh_client):
        """Test getting a specific issue."""
        issue = {"number": 42, "title": "Test Issue", "state": "open"}
        mock_proc = create_mock_process(
            stdout=json.dumps(issue).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.issue_get(42)

                assert result["number"] == 42

    @pytest.mark.asyncio
    async def test_issue_comment(self, gh_client):
        """Test commenting on an issue."""
        # The issue_comment method returns int (the comment ID), not the full response
        mock_proc = create_mock_process(
            stdout=b'11111',
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.issue_comment(42, "My comment")

                assert result == 11111


# ============================================================================
# CI/Checks Tests
# ============================================================================


class TestGHClientCIChecks:
    """Tests for CI/checks related operations."""

    @pytest.mark.asyncio
    async def test_get_pr_checks(self, gh_client):
        """Test getting CI checks for a PR."""
        # gh pr checks returns a list of check objects with 'name' and 'state' fields
        checks = [
            {"name": "test", "state": "SUCCESS"},
            {"name": "lint", "state": "FAILURE"},
        ]
        mock_proc = create_mock_process(
            stdout=json.dumps(checks).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.get_pr_checks(42)

                assert len(result["checks"]) == 2
                assert result["passing"] == 1
                assert result["failing"] == 1
                assert result["checks"][0]["state"] == "SUCCESS"


# ============================================================================
# API Methods Tests
# ============================================================================


class TestGHClientAPIMethods:
    """Tests for API-related methods."""

    @pytest.mark.asyncio
    async def test_api_get(self, gh_client):
        """Test API GET request."""
        response = {"id": 123, "state": "open"}
        mock_proc = create_mock_process(
            stdout=json.dumps(response).encode(),
            returncode=0
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                result = await gh_client.api_get("/repos/owner/repo/issues/42")

                assert result["id"] == 123


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestGHClientErrors:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_pr_too_large_error(self, gh_client):
        """Test PRTooLargeError is raised for large diffs."""
        # The PRTooLargeError is only raised when gh CLI returns specific error message
        mock_proc = create_mock_process(
            stdout=b'',
            stderr=b'diff exceeded the maximum number of lines',
            returncode=1
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                with pytest.raises(PRTooLargeError):
                    await gh_client.pr_diff(42)

    @pytest.mark.asyncio
    async def test_command_error_with_no_output(self, gh_client):
        """Test GHCommandError when command fails with no output."""
        mock_proc = create_mock_process(
            stdout=b'',
            stderr=b'',
            returncode=1
        )

        with patch('asyncio.create_subprocess_exec', return_value=mock_proc):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                with pytest.raises(GHCommandError):
                    await gh_client.run(["pr", "list"])


# ============================================================================
# GHCommandResult Tests
# ============================================================================


class TestGHCommandResult:
    """Tests for GHCommandResult class."""

    def test_command_result_creation(self):
        """Test creating a command result."""
        result = GHCommandResult(
            stdout='{"success": true}',
            stderr='',
            returncode=0,
            command=['gh', 'version'],
            attempts=1,
            total_time=0.1
        )

        assert result.returncode == 0
        assert result.stdout == '{"success": true}'
        assert result.stderr == ''


# ============================================================================
# RateLimiter Tests
# ============================================================================


class TestRateLimiter:
    """Tests for RateLimiter class."""

    def test_rate_limiter_singleton(self):
        """Test that RateLimiter uses singleton pattern."""
        limiter1 = RateLimiter.get_instance()
        limiter2 = RateLimiter.get_instance()
        assert limiter1 is limiter2

    @pytest.mark.asyncio
    async def test_rate_limit_exceeded_error(self):
        """Test RateLimitExceeded exception."""
        error = RateLimitExceeded("Rate limit exceeded")
        assert "Rate limit exceeded" in str(error)


# ============================================================================
# Integration Tests (More Complex Scenarios)
# ============================================================================


class TestGHClientIntegration:
    """Integration tests for common workflows."""

    @pytest.mark.asyncio
    async def test_full_pr_review_workflow(self, gh_client):
        """Test a complete PR review workflow."""
        pr_data = {"number": 42, "title": "Test PR", "diff_url": "/diff"}
        diff_content = b"diff --git a/file.py b/file.py\n+new code"

        call_count = [0]

        def create_mock_for_call(*args, **kwargs):
            """Create mock based on call count."""
            call_count[0] += 1
            if call_count[0] == 1:
                return create_mock_process(
                    stdout=json.dumps(pr_data).encode(),
                    returncode=0
                )
            else:
                return create_mock_process(
                    stdout=diff_content,
                    returncode=0
                )

        with patch('asyncio.create_subprocess_exec', side_effect=create_mock_for_call):
            with patch('asyncio.get_event_loop') as mock_loop:
                mock_loop.return_value.time = MagicMock(return_value=0.0)

                # Get PR
                result = await gh_client.pr_get(42)
                assert result["number"] == 42

                # Get diff
                result = await gh_client.pr_diff(42)
                assert "diff --git" in result
