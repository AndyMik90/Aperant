"""
GitLab Client Tests
===================

Tests for GitLab client timeout, retry, and async operations.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from requests.exceptions import ConnectionError, Timeout


class TestGitLabClient:
    """Test GitLab client basic operations."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from runners.gitlab.glab_client import GitLabClient

        return GitLabClient(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
        )

    def test_client_initialization(self, client):
        """Test client initializes correctly."""
        assert client.token == "test-token"
        assert client.project == "group/project"
        assert client.instance_url == "https://gitlab.example.com"
        assert client.timeout == 30
        assert client.max_retries == 3

    def test_client_custom_timeout(self):
        """Test client with custom timeout."""
        from runners.gitlab.glab_client import GitLabClient

        client = GitLabClient(
            token="test-token",
            project="group/project",
            timeout=60,
        )

        assert client.timeout == 60

    def test_client_custom_retries(self):
        """Test client with custom retry count."""
        from runners.gitlab.glab_client import GitLabClient

        client = GitLabClient(
            token="test-token",
            project="group/project",
            max_retries=5,
        )

        assert client.max_retries == 5

    def test_build_url(self, client):
        """Test URL building."""
        url = client._build_url("projects", "group%2Fproject", "merge_requests")

        assert "group%2Fproject" in url
        assert "merge_requests" in url

    def test_build_url_with_params(self, client):
        """Test URL building with query parameters."""
        url = client._build_url(
            "projects",
            "group%2Fproject",
            "merge_requests",
            state="opened",
            per_page=50,
        )

        assert "state=opened" in url
        assert "per_page=50" in url


class TestGitLabClientRetry:
    """Test GitLab client retry logic."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from runners.gitlab.glab_client import GitLabClient

        return GitLabClient(
            token="test-token",
            project="group/project",
            max_retries=3,
            timeout=1,
        )

    def test_retry_on_timeout(self, client):
        """Test retry on timeout exception."""
        call_count = 0

        def mock_request(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Timeout("Request timed out")
            return {"data": "success"}

        with patch.object(client, "_make_request", mock_request):
            result = client.get_mr(123)

        assert call_count == 3  # Initial + 2 retries
        assert result["data"] == "success"

    def test_retry_on_connection_error(self, client):
        """Test retry on connection error."""
        call_count = 0

        def mock_request(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise ConnectionError("Connection failed")
            return {"id": 123}

        with patch.object(client, "_make_request", mock_request):
            result = client.get_mr(123)

        assert call_count == 2  # Initial + 1 retry
        assert result["id"] == 123

    def test_retry_exhausted(self, client):
        """Test failure after retry exhaustion."""

        def mock_request(*args, **kwargs):
            raise Timeout("Request timed out")

        with patch.object(client, "_make_request", mock_request):
            with pytest.raises(Timeout):
                client.get_mr(123)

    def test_retry_with_backoff(self, client):
        """Test retry uses exponential backoff."""
        call_times = []

        def mock_request(*args, **kwargs):
            call_times.append(time.time())
            if len(call_times) < 3:
                raise Timeout("Request timed out")
            return {"data": "success"}

        import time

        with patch.object(client, "_make_request", mock_request):
            client.get_mr(123)

        # Check delays between retries increase (exponential backoff)
        if len(call_times) > 2:
            delay1 = call_times[1] - call_times[0]
            delay2 = call_times[2] - call_times[1]
            # Second delay should be longer
            assert delay2 > delay1

    def test_no_retry_on_client_error(self, client):
        """Test no retry on 4xx client errors."""
        from requests.exceptions import HTTPError

        def mock_request(*args, **kwargs):
            response = Mock()
            response.status_code = 404
            response.raise_for_status.side_effect = HTTPError(response=response)
            return response

        with patch.object(client, "_make_request", mock_request):
            with pytest.raises(HTTPError):
                client.get_mr(123)

    def test_retry_on_server_error(self, client):
        """Test retry on 5xx server errors."""
        from requests.exceptions import HTTPError

        call_count = 0

        def mock_request(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                response = Mock()
                response.status_code = 503
                response.raise_for_status.side_effect = HTTPError(response=response)
                return response
            return {"id": 123}

        with patch.object(client, "_make_request", mock_request):
            result = client.get_mr(123)

        assert call_count == 2


class TestGitLabClientAsync:
    """Test GitLab client async operations."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from runners.gitlab.glab_client import GitLabClient

        return GitLabClient(
            token="test-token",
            project="group/project",
        )

    @pytest.mark.asyncio
    async def test_get_mr_async(self, client):
        """Test async get MR."""
        mock_data = {
            "iid": 123,
            "title": "Test MR",
            "state": "opened",
        }

        with patch.object(client, "get_mr", return_value=mock_data):
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

        with patch.object(client, "get_mr_changes", return_value=mock_data):
            result = await client.get_mr_changes_async(123)

        assert len(result["changes"]) == 1

    @pytest.mark.asyncio
    async def test_get_mr_commits_async(self, client):
        """Test async get MR commits."""
        mock_data = [
            {"id": "abc123", "message": "Commit 1"},
            {"id": "def456", "message": "Commit 2"},
        ]

        with patch.object(client, "get_mr_commits", return_value=mock_data):
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

        with patch.object(client, "get_mr_notes", return_value=mock_data):
            result = await client.get_mr_notes_async(123)

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_mr_pipelines_async(self, client):
        """Test async get MR pipelines."""
        mock_data = [
            {"id": 1001, "status": "success"},
            {"id": 1002, "status": "failed"},
        ]

        with patch.object(client, "get_mr_pipelines", return_value=mock_data):
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

        with patch.object(client, "get_issue", return_value=mock_data):
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

        with patch.object(client, "get_pipeline", return_value=mock_data):
            result = await client.get_pipeline_async(1001)

        assert result["id"] == 1001

    @pytest.mark.asyncio
    async def test_get_pipeline_jobs_async(self, client):
        """Test async get pipeline jobs."""
        mock_data = [
            {"id": 2001, "name": "test", "status": "success"},
            {"id": 2002, "name": "build", "status": "failed"},
        ]

        with patch.object(client, "get_pipeline_jobs", return_value=mock_data):
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

        with patch.object(client, "get_mr", return_value=mock_data):
            results = await asyncio.gather(
                fetch_mr(123),
                fetch_mr(456),
                fetch_mr(789),
            )

        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_async_error_handling(self, client):
        """Test async error handling."""
        with patch.object(client, "get_mr", side_effect=Exception("API Error")):
            with pytest.raises(Exception, match="API Error"):
                await client.get_mr_async(123)


class TestGitLabClientAPI:
    """Test GitLab client API methods."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from runners.gitlab.glab_client import GitLabClient

        return GitLabClient(
            token="test-token",
            project="group/project",
        )

    def test_get_mr(self, client):
        """Test getting MR details."""
        mock_response = {
            "iid": 123,
            "title": "Test MR",
            "description": "Test description",
            "state": "opened",
            "author": {"username": "john_doe"},
        }

        with patch.object(client, "_make_request", return_value=mock_response):
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

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_mr_changes(123)

        assert len(result["changes"]) == 1

    def test_get_mr_commits(self, client):
        """Test getting MR commits."""
        mock_response = [
            {"id": "abc123", "message": "First commit"},
            {"id": "def456", "message": "Second commit"},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_mr_commits(123)

        assert len(result) == 2

    def test_get_mr_notes(self, client):
        """Test getting MR discussion notes."""
        mock_response = [
            {"id": 1001, "body": "Review comment", "author": {"username": "reviewer"}},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_mr_notes(123)

        assert len(result) == 1

    def test_post_mr_note(self, client):
        """Test posting note to MR."""
        mock_response = {"id": 1002, "body": "New comment"}

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.post_mr_note(123, "New comment")

        assert result["id"] == 1002

    def test_get_mr_pipelines(self, client):
        """Test getting MR pipelines."""
        mock_response = [
            {"id": 1001, "status": "success", "ref": "feature"},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
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

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_pipeline(1001)

        assert result["id"] == 1001

    def test_get_pipeline_jobs(self, client):
        """Test getting pipeline jobs."""
        mock_response = [
            {"id": 2001, "name": "test", "stage": "test", "status": "passed"},
            {"id": 2002, "name": "build", "stage": "build", "status": "failed"},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
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

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_issue(456)

        assert result["iid"] == 456

    def test_list_issues(self, client):
        """Test listing issues."""
        mock_response = [
            {"iid": 456, "title": "Issue 1"},
            {"iid": 457, "title": "Issue 2"},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.list_issues(state="opened")

        assert len(result) == 2

    def test_post_issue_note(self, client):
        """Test posting note to issue."""
        mock_response = {"id": 2001, "body": "Issue comment"}

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.post_issue_note(456, "Issue comment")

        assert result["id"] == 2001

    def test_get_file(self, client):
        """Test getting file from repository."""
        mock_response = {
            "file_name": "README.md",
            "content": "SGVsbG8gV29ybGQ=",  # Base64 encoded
            "encoding": "base64",
        }

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.get_file("README.md", ref="main")

        assert result["file_name"] == "README.md"

    def test_list_projects(self, client):
        """Test listing projects."""
        mock_response = [
            {"id": 1, "name": "project1"},
            {"id": 2, "name": "project2"},
        ]

        with patch.object(client, "_make_request", return_value=mock_response):
            result = client.list_projects()

        assert len(result) == 2


class TestGitLabClientAuth:
    """Test GitLab client authentication."""

    def test_token_in_headers(self):
        """Test token is included in request headers."""
        from runners.gitlab.glab_client import GitLabClient

        client = GitLabClient(
            token="test-token-12345",
            project="group/project",
        )

        with patch("requests.request") as mock_request:
            mock_request.return_value = Mock(json=lambda: {})

            client.get_mr(123)

            call_kwargs = mock_request.call_args[1]
            headers = call_kwargs.get("headers", {})

            assert "PRIVATE-TOKEN" in headers
            assert headers["PRIVATE-TOKEN"] == "test-token-12345"

    def test_custom_instance_url(self):
        """Test custom instance URL."""
        from runners.gitlab.glab_client import GitLabClient

        client = GitLabClient(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.custom.com",
        )

        with patch("requests.request") as mock_request:
            mock_request.return_value = Mock(json=lambda: {})

            client.get_mr(123)

            call_args = mock_request.call_args[0]
            url = call_args[0]

            assert "gitlab.custom.com" in url


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
        from runners.gitlab.glab_client import GitLabConfig

        config = GitLabConfig(
            token="test-token",
            project="group/project",
        )

        assert config.instance_url == "https://gitlab.com"
        assert config.timeout == 30
        assert config.max_retries == 3

    def test_config_to_dict(self):
        """Test converting config to dict."""
        from runners.gitlab.glab_client import GitLabConfig

        config = GitLabConfig(
            token="test-token",
            project="group/project",
        )

        data = config.to_dict()

        assert data["token"] == "test-token"
        assert data["project"] == "group/project"

    def test_config_from_dict(self):
        """Test loading config from dict."""
        from runners.gitlab.glab_client import GitLabConfig

        data = {
            "token": "test-token",
            "project": "group/project",
            "instance_url": "https://gitlab.example.com",
        }

        config = GitLabConfig.from_dict(data)

        assert config.token == "test-token"
        assert config.instance_url == "https://gitlab.example.com"


class TestGitLabClientErrorHandling:
    """Test GitLab client error handling."""

    @pytest.fixture
    def client(self):
        """Create a GitLab client for testing."""
        from runners.gitlab.glab_client import GitLabClient

        return GitLabClient(
            token="test-token",
            project="group/project",
        )

    def test_http_404_handling(self, client):
        """Test 404 error handling."""
        from requests.exceptions import HTTPError

        def mock_request(*args, **kwargs):
            response = Mock()
            response.status_code = 404
            response.text = "404 Not Found"
            response.raise_for_status.side_effect = HTTPError(response=response)
            return response

        with patch.object(client, "_make_request", mock_request):
            with pytest.raises(HTTPError):
                client.get_mr(99999)

    def test_http_403_handling(self, client):
        """Test 403 forbidden error handling."""
        from requests.exceptions import HTTPError

        def mock_request(*args, **kwargs):
            response = Mock()
            response.status_code = 403
            response.text = "403 Forbidden"
            response.raise_for_status.side_effect = HTTPError(response=response)
            return response

        with patch.object(client, "_make_request", mock_request):
            with pytest.raises(HTTPError):
                client.get_mr(123)

    def test_network_error_handling(self, client):
        """Test network error handling."""
        from requests.exceptions import ConnectionError

        with patch.object(
            client, "_make_request", side_effect=ConnectionError("Network error")
        ):
            with pytest.raises(ConnectionError):
                client.get_mr(123)

    def test_timeout_handling(self, client):
        """Test timeout handling."""
        from requests.exceptions import Timeout

        with patch.object(
            client, "_make_request", side_effect=Timeout("Request timed out")
        ):
            with pytest.raises(Timeout):
                client.get_mr(123)
