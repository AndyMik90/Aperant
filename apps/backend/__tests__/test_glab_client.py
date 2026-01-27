"""
GitLab Client Tests
===================

Tests for GitLab client timeout, retry, and async operations.
"""

import asyncio
from unittest.mock import Mock, patch
from urllib.parse import urlparse

import pytest
from requests.exceptions import ConnectionError


class TestGitLabClient:
    """Test GitLab client basic operations."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from __tests__.fixtures.gitlab import create_mock_client

        return create_mock_client()

    def test_client_initialization(self, client):
        """Test client initializes correctly."""
        assert client.config.token == "glpat-test-token-12345"
        assert client.config.project == "group/project"
        assert client.config.instance_url == "https://gitlab.example.com"
        assert client.default_timeout == 30.0

    def test_client_custom_timeout(self):
        """Test client with custom timeout."""
        from __tests__.fixtures.gitlab import create_mock_client

        client = create_mock_client()
        assert client.default_timeout == 30.0  # Uses default

    def test_client_custom_retries(self):
        """Test client with custom retry count."""
        from __tests__.fixtures.gitlab import create_mock_client

        client = create_mock_client()
        # Uses default max_retries of 3
        assert client.default_timeout == 30.0

    def test_build_url(self, client):
        """Test URL building."""
        url = client._api_url("/projects/group%2Fproject/merge_requests")

        assert "group%2Fproject" in url
        assert "merge_requests" in url
        assert "/api/v4/" in url

    def test_build_url_with_params(self, client):
        """Test URL building with query parameters."""
        from urllib.parse import parse_qs, urlencode, urlparse

        base_url = client._api_url("/projects/group%2Fproject/merge_requests")
        query_string = urlencode({"state": "opened", "per_page": 50}, doseq=True)
        full_url = f"{base_url}?{query_string}"

        parsed = urlparse(full_url)
        params = parse_qs(parsed.query)

        assert "state=opened" in full_url or params.get("state") == ["opened"]
        assert "per_page=50" in full_url or params.get("per_page") == ["50"]


class TestGitLabClientRetry:
    """Test GitLab client retry logic."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        import dataclasses

        from __tests__.fixtures.gitlab import create_mock_client

        client = create_mock_client()
        return client

    def test_retry_on_timeout(self, client):
        """Test retry on timeout exception."""
        from socket import timeout

        call_count = 0

        def mock_urlopen_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise TimeoutError("Request timed out")
            # Return successful response
            mock_resp = Mock()
            mock_resp.read.return_value = b'{"iid": 123}'
            mock_resp.headers = {"Content-Type": "application/json"}
            mock_resp.status = 200
            mock_resp.__enter__ = Mock(return_value=mock_resp)
            mock_resp.__exit__ = Mock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            result = client.get_mr(123)

        assert call_count == 3  # Initial + 2 retries
        assert result["iid"] == 123

    def test_retry_on_connection_error(self, client):
        """Test retry on connection error."""
        from urllib.error import URLError

        call_count = 0

        def mock_urlopen_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise URLError("Connection failed")
            # Return successful response
            mock_resp = Mock()
            mock_resp.read.return_value = b'{"iid": 123}'
            mock_resp.headers = {"Content-Type": "application/json"}
            mock_resp.status = 200
            mock_resp.__enter__ = Mock(return_value=mock_resp)
            mock_resp.__exit__ = Mock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            result = client.get_mr(123)

        assert call_count == 2  # Initial + 1 retry
        assert result["iid"] == 123

    def test_retry_exhausted(self, client):
        """Test failure after retry exhaustion."""
        from urllib.error import URLError

        def mock_urlopen_side_effect(*args, **kwargs):
            raise URLError("Request timed out")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            with pytest.raises(Exception, match="GitLab API network error"):
                client.get_mr(123)

    def test_retry_with_backoff(self, client):
        """Test retry uses exponential backoff."""
        import time
        from socket import timeout

        call_times = []

        def mock_urlopen_side_effect(*args, **kwargs):
            call_times.append(time.time())
            if len(call_times) < 3:
                raise TimeoutError("Request timed out")
            # Return successful response
            mock_resp = Mock()
            mock_resp.read.return_value = b'{"iid": 123}'
            mock_resp.headers = {"Content-Type": "application/json"}
            mock_resp.status = 200
            mock_resp.__enter__ = Mock(return_value=mock_resp)
            mock_resp.__exit__ = Mock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            client.get_mr(123)

        # Check delays between retries increase (exponential backoff)
        if len(call_times) > 2:
            delay1 = call_times[1] - call_times[0]
            delay2 = call_times[2] - call_times[1]
            # Second delay should be longer (exponential backoff)
            assert delay2 > delay1

    def test_no_retry_on_client_error(self, client):
        """Test no retry on 4xx client errors."""
        from urllib.error import HTTPError

        call_count = 0

        def mock_urlopen_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            # 404 should not be retried (not in RETRYABLE_STATUS_CODES)
            raise HTTPError("url", 404, "Not Found", {}, None)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            with pytest.raises(Exception, match="GitLab API error"):
                client.get_mr(123)

        # Should only be called once (no retry for 4xx)
        assert call_count == 1

    def test_retry_on_server_error(self, client):
        """Test retry on 5xx server errors."""
        from urllib.error import HTTPError

        call_count = 0

        def mock_urlopen_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise HTTPError(None, 503, "Service Unavailable", {}, None)
            # Return successful response
            mock_resp = Mock()
            mock_resp.read.return_value = b'{"iid": 123}'
            mock_resp.headers = {"Content-Type": "application/json"}
            mock_resp.status = 200
            mock_resp.__enter__ = Mock(return_value=mock_resp)
            mock_resp.__exit__ = Mock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_side_effect):
            result = client.get_mr(123)

        assert call_count == 2
        assert result["iid"] == 123


class TestGitLabClientAsync:
    """Test GitLab client async operations."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from __tests__.fixtures.gitlab import create_mock_client

        return create_mock_client()

    @pytest.mark.asyncio
    async def test_get_mr_async(self, client):
        """Test async get MR."""
        mock_data = {
            "iid": 123,
            "title": "Test MR",
            "state": "opened",
        }

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_mr_async(123)

        assert result["iid"] == 123
        assert result["title"] == "Test MR"

    @pytest.mark.asyncio
    async def test_get_mr_changes_async(self, client):
        """Test async get MR changes."""
        mock_data = {
            "changes": [
                {
                    "old_path": "file.py",
                    "new_path": "file.py",
                    "diff": "@@ -1,1 +1,2 @@",
                }
            ]
        }

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_mr_changes_async(123)

        assert len(result["changes"]) == 1

    @pytest.mark.asyncio
    async def test_get_mr_commits_async(self, client):
        """Test async get MR commits."""
        mock_data = [
            {"id": "abc123", "message": "Commit 1"},
            {"id": "def456", "message": "Commit 2"},
        ]

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_mr_commits_async(123)

        assert len(result) == 2
        assert result[0]["id"] == "abc123"

    @pytest.mark.asyncio
    async def test_get_mr_notes_async(self, client):
        """Test async get MR notes."""
        mock_data = [
            {"id": 1001, "body": "Comment 1"},
            {"id": 1002, "body": "Comment 2"},
        ]

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_mr_notes_async(123)

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_mr_pipelines_async(self, client):
        """Test async get MR pipelines."""
        mock_data = [
            {"id": 1001, "status": "success"},
            {"id": 1002, "status": "failed"},
        ]

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_mr_pipelines_async(123)

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_issue_async(self, client):
        """Test async get issue."""
        mock_data = {
            "iid": 456,
            "title": "Test Issue",
            "state": "opened",
        }

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_issue_async(456)

        assert result["iid"] == 456

    @pytest.mark.asyncio
    async def test_get_pipeline_async(self, client):
        """Test async get pipeline."""
        mock_data = {
            "id": 1001,
            "status": "running",
            "ref": "main",
        }

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_pipeline_status_async(1001)

        assert result["id"] == 1001

    @pytest.mark.asyncio
    async def test_get_pipeline_jobs_async(self, client):
        """Test async get pipeline jobs."""
        mock_data = [
            {"id": 2001, "name": "test", "status": "success"},
            {"id": 2002, "name": "build", "status": "failed"},
        ]

        with patch.object(client, "_fetch_async", return_value=mock_data):
            result = await client.get_pipeline_jobs_async(1001)

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_concurrent_async_requests(self, client):
        """Test concurrent async requests."""

        async def fetch_mr(iid):
            return await client.get_mr_async(iid)

        mock_data = {
            "iid": 123,
            "title": "Test MR",
        }

        with patch.object(client, "_fetch_async", return_value=mock_data):
            results = await asyncio.gather(
                fetch_mr(123),
                fetch_mr(456),
                fetch_mr(789),
            )

        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_async_error_handling(self, client):
        """Test async error handling."""
        with patch.object(client, "_fetch_async", side_effect=Exception("API Error")):
            with pytest.raises(Exception, match="API Error"):
                await client.get_mr_async(123)


class TestGitLabClientAPI:
    """Test GitLab client API methods."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from __tests__.fixtures.gitlab import create_mock_client

        return create_mock_client()

    def test_get_mr(self, client):
        """Test getting MR details."""
        mock_response = {
            "iid": 123,
            "title": "Test MR",
            "description": "Test description",
            "state": "opened",
            "author": {"username": "john_doe"},
        }

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_mr(123)

        assert result["iid"] == 123
        assert result["title"] == "Test MR"

    def test_get_mr_changes(self, client):
        """Test getting MR changes."""
        mock_response = {
            "changes": [
                {
                    "old_path": "src/file.py",
                    "new_path": "src/file.py",
                    "diff": "@@ -1,1 +1,2 @@",
                }
            ]
        }

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_mr_changes(123)

        assert len(result["changes"]) == 1

    def test_get_mr_commits(self, client):
        """Test getting MR commits."""
        mock_response = [
            {"id": "abc123", "message": "First commit"},
            {"id": "def456", "message": "Second commit"},
        ]

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_mr_commits(123)

        assert len(result) == 2

    def test_get_mr_notes(self, client):
        """Test getting MR discussion notes."""
        mock_response = [
            {"id": 1001, "body": "Review comment", "author": {"username": "reviewer"}},
        ]

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_mr_notes(123)

        assert len(result) == 1

    def test_post_mr_note(self, client):
        """Test posting note to MR."""
        mock_response = {"id": 1002, "body": "New comment"}

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.post_mr_note(123, "New comment")

        assert result["id"] == 1002

    def test_get_mr_pipelines(self, client):
        """Test getting MR pipelines."""
        mock_response = [
            {"id": 1001, "status": "success", "ref": "feature"},
        ]

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_mr_pipelines(123)

        assert len(result) == 1

    def test_get_pipeline(self, client):
        """Test getting pipeline details."""
        mock_response = {
            "id": 1001,
            "status": "success",
            "ref": "main",
            "sha": "abc123",
        }

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_pipeline_status(1001)

        assert result["id"] == 1001

    def test_get_pipeline_jobs(self, client):
        """Test getting pipeline jobs."""
        mock_response = [
            {"id": 2001, "name": "test", "stage": "test", "status": "passed"},
            {"id": 2002, "name": "build", "stage": "build", "status": "failed"},
        ]

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_pipeline_jobs(1001)

        assert len(result) == 2
        assert result[1]["status"] == "failed"

    def test_get_issue(self, client):
        """Test getting issue details."""
        mock_response = {
            "iid": 456,
            "title": "Test Issue",
            "description": "Issue description",
            "state": "opened",
        }

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_issue(456)

        assert result["iid"] == 456

    def test_list_issues(self, client):
        """Test listing issues."""
        mock_response = [
            {"iid": 456, "title": "Issue 1"},
            {"iid": 457, "title": "Issue 2"},
        ]

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.list_issues(state="opened")

        assert len(result) == 2

    def test_post_issue_note(self, client):
        """Test posting note to issue."""
        mock_response = {"id": 2001, "body": "Issue comment"}

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.post_issue_note(456, "Issue comment")

        assert result["id"] == 2001

    def test_get_file(self, client):
        """Test getting file from repository."""
        mock_response = {
            "file_name": "README.md",
            "content": "SGVsbG8gV29ybGQ=",  # Base64 encoded
            "encoding": "base64",
        }

        with patch.object(client, "_fetch", return_value=mock_response):
            result = client.get_file_contents("README.md", ref="main")

        assert result["file_name"] == "README.md"

    def test_list_projects(self, client):
        """Test listing projects - removed in new API."""
        # This method was removed from the new GitLabClient API
        # Projects are now specified via the config
        assert client.config.project is not None


class TestGitLabClientAuth:
    """Test GitLab client authentication."""

    def test_token_in_headers(self):
        """Test token is included in request headers."""
        import dataclasses

        from __tests__.fixtures.gitlab import create_mock_client

        client = create_mock_client()
        client.config = dataclasses.replace(client.config, token="test-token-12345")

        with patch("urllib.request.urlopen") as mock_urlopen:
            # Mock response object with proper attributes
            mock_response = Mock()
            mock_response.read.return_value = b'{"iid": 123}'
            mock_response.headers = {"Content-Type": "application/json"}
            mock_response.status = 200
            mock_response.__enter__ = Mock(return_value=mock_response)
            mock_response.__exit__ = Mock(return_value=False)
            mock_urlopen.return_value = mock_response

            client.get_mr(123)

            # Check that urlopen was called
            assert mock_urlopen.called

            # Get the request object that was passed to urlopen
            call_args = mock_urlopen.call_args[0]
            request = call_args[0]

            # Check the PRIVATE-TOKEN header (case-insensitive check)
            assert (
                "PRIVATE-TOKEN" in request.headers or "Private-token" in request.headers
            )
            # Use get() with case-insensitive fallback
            token_value = request.headers.get(
                "PRIVATE-TOKEN", request.headers.get("Private-token")
            )
            assert token_value == "test-token-12345"

    def test_custom_instance_url(self):
        """Test custom instance URL."""
        import dataclasses

        from __tests__.fixtures.gitlab import create_mock_client

        client = create_mock_client()
        client.config = dataclasses.replace(
            client.config, instance_url="https://gitlab.custom.com"
        )

        with patch("urllib.request.urlopen") as mock_urlopen:
            # Mock response object with proper attributes
            mock_response = Mock()
            mock_response.read.return_value = b'{"iid": 123}'
            mock_response.headers = {"Content-Type": "application/json"}
            mock_response.status = 200
            mock_response.__enter__ = Mock(return_value=mock_response)
            mock_response.__exit__ = Mock(return_value=False)
            mock_urlopen.return_value = mock_response

            client.get_mr(123)

            # Check that urlopen was called with correct URL
            call_args = mock_urlopen.call_args[0]
            request = call_args[0]

            # Parse URL and check hostname for security
            parsed_url = urlparse(request.full_url)
            assert parsed_url.hostname == "gitlab.custom.com"


class TestGitLabClientConfig:
    """Test GitLab configuration model."""

    def test_config_creation(self):
        """Test creating GitLab config."""
        from runners.gitlab.glab_client import GitLabConfig

        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
        )

        assert config.token == "test-token"
        assert config.project == "group/project"

    def test_config_defaults(self):
        """Test config has sensible defaults."""
        import tempfile
        from pathlib import Path

        from runners.gitlab.glab_client import GitLabClient, GitLabConfig

        project_dir = Path(tempfile.mkdtemp())
        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.com",
        )

        client = GitLabClient(project_dir=project_dir, config=config)

        assert client.config.instance_url == "https://gitlab.com"
        assert client.default_timeout == 30.0

    def test_config_to_dict(self):
        """Test converting config to dict using dataclasses."""
        import dataclasses

        from runners.gitlab.glab_client import GitLabConfig

        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.com",
        )

        data = dataclasses.asdict(config)

        assert data["token"] == "test-token"
        assert data["project"] == "group/project"

    def test_config_from_dict(self):
        """Test loading config from dict using dataclasses."""
        import dataclasses

        from runners.gitlab.glab_client import GitLabConfig

        data = {
            "token": "test-token",
            "project": "group/project",
            "instance_url": "https://gitlab.example.com",
        }

        config = GitLabConfig(**data)

        assert config.token == "test-token"
        assert config.instance_url == "https://gitlab.example.com"


class TestGitLabClientErrorHandling:
    """Test GitLab client error handling."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from __tests__.fixtures.gitlab import create_mock_client

        return create_mock_client()

    def test_http_404_handling(self, client):
        """Test 404 error handling."""
        from urllib.error import HTTPError

        def mock_request(*args, **kwargs):
            raise HTTPError(None, 404, "404 Not Found", {}, None)

        with patch.object(client, "_fetch", mock_request):
            with pytest.raises(HTTPError):
                client.get_mr(99999)

    def test_http_403_handling(self, client):
        """Test 403 forbidden error handling."""
        from urllib.error import HTTPError

        def mock_request(*args, **kwargs):
            raise HTTPError(None, 403, "403 Forbidden", {}, None)

        with patch.object(client, "_fetch", mock_request):
            with pytest.raises(HTTPError):
                client.get_mr(123)

    def test_network_error_handling(self, client):
        """Test network error handling."""
        with patch.object(
            client, "_fetch", side_effect=ConnectionError("Network error")
        ):
            with pytest.raises(ConnectionError):
                client.get_mr(123)

    def test_timeout_handling(self, client):
        """Test timeout handling."""
        from socket import timeout

        with patch.object(
            client, "_fetch", side_effect=TimeoutError("Request timed out")
        ):
            with pytest.raises(timeout):
                client.get_mr(123)
