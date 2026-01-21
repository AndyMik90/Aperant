"""
Tests for GitLab Client API Extensions
=========================================

Tests for new CRUD endpoints, branch operations, file operations, and webhooks.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Try imports with fallback for different environments
try:
    from runners.gitlab.glab_client import (
        GitLabClient,
        GitLabConfig,
        encode_project_path,
    )
except ImportError:
    from glab_client import GitLabClient, GitLabConfig, encode_project_path


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
    )


class TestMRExtensions:
    """Tests for MR CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_mr(self, client):
        """Test creating a merge request."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "iid": 123,
                "title": "Test MR",
                "source_branch": "feature",
                "target_branch": "main",
            }

            result = client.create_mr(
                source_branch="feature",
                target_branch="main",
                title="Test MR",
                description="Test description",
            )

            assert mock_fetch.called
            assert result["iid"] == 123

    @pytest.mark.asyncio
    async def test_list_mrs_filters(self, client):
        """Test listing MRs with filters."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = [
                {"iid": 1, "title": "MR 1"},
                {"iid": 2, "title": "MR 2"},
            ]

            result = client.list_mrs(state="opened", labels=["bug"])

            assert mock_fetch.called
            assert len(result) == 2

    @pytest.mark.asyncio
    async def test_update_mr(self, client):
        """Test updating a merge request."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"iid": 123, "title": "Updated"}

            result = client.update_mr(
                mr_iid=123,
                title="Updated",
                labels={"bug": True, "feature": False},
            )

            assert mock_fetch.called


class TestBranchOperations:
    """Tests for branch management operations."""

    @pytest.mark.asyncio
    async def test_list_branches(self, client):
        """Test listing branches."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = [
                {"name": "main", "commit": {"id": "abc123"}},
                {"name": "develop", "commit": {"id": "def456"}},
            ]

            result = client.list_branches()

            assert len(result) == 2
            assert result[0]["name"] == "main"

    @pytest.mark.asyncio
    async def test_get_branch(self, client):
        """Test getting a specific branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "name": "main",
                "commit": {"id": "abc123"},
                "protected": True,
            }

            result = client.get_branch("main")

            assert result["name"] == "main"

    @pytest.mark.asyncio
    async def test_create_branch(self, client):
        """Test creating a new branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "name": "feature-branch",
                "commit": {"id": "abc123"},
            }

            result = client.create_branch(
                branch_name="feature-branch",
                ref="main",
            )

            assert result["name"] == "feature-branch"

    @pytest.mark.asyncio
    async def test_delete_branch(self, client):
        """Test deleting a branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None  # 204 No Content

            result = client.delete_branch("feature-branch")

            # Should not raise on success
            assert result is None

    @pytest.mark.asyncio
    async def test_compare_branches(self, client):
        """Test comparing two branches."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "diff": "@@ -1,1 +1,1 @@",
                "commits": [{"id": "abc123"}],
            }

            result = client.compare_branches("main", "feature")

            assert "diff" in result


class TestFileOperations:
    """Tests for file operations."""

    @pytest.mark.asyncio
    async def test_get_file_contents(self, client):
        """Test getting file contents."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_name": "test.py",
                "content": "ZGVmIHRlc3Q=",  # base64
                "encoding": "base64",
            }

            result = client.get_file_contents("test.py", ref="main")

            assert result["file_name"] == "test.py"

    @pytest.mark.asyncio
    async def test_create_file(self, client):
        """Test creating a new file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "new_file.py",
                "branch": "main",
            }

            result = client.create_file(
                file_path="new_file.py",
                content="print('hello')",
                commit_message="Add new file",
                branch="main",
            )

            assert result["file_path"] == "new_file.py"

    @pytest.mark.asyncio
    async def test_update_file(self, client):
        """Test updating an existing file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "existing.py",
                "branch": "main",
            }

            result = client.update_file(
                file_path="existing.py",
                content="updated content",
                commit_message="Update file",
                branch="main",
            )

            assert result["file_path"] == "existing.py"

    @pytest.mark.asyncio
    async def test_delete_file(self, client):
        """Test deleting a file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None  # 204 No Content

            result = client.delete_file(
                file_path="old.py",
                commit_message="Remove old file",
                branch="main",
            )

            assert result is None


class TestWebhookOperations:
    """Tests for webhook management."""

    @pytest.mark.asyncio
    async def test_list_webhooks(self, client):
        """Test listing webhooks."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = [
                {"id": 1, "url": "https://example.com/hook"},
                {"id": 2, "url": "https://example.com/another"},
            ]

            result = client.list_webhooks()

            assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_webhook(self, client):
        """Test getting a specific webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 1,
                "url": "https://example.com/hook",
                "push_events": True,
            }

            result = client.get_webhook(1)

            assert result["id"] == 1

    @pytest.mark.asyncio
    async def test_create_webhook(self, client):
        """Test creating a webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 1,
                "url": "https://example.com/hook",
            }

            result = client.create_webhook(
                url="https://example.com/hook",
                push_events=True,
                merge_request_events=True,
            )

            assert result["id"] == 1

    @pytest.mark.asyncio
    async def test_update_webhook(self, client):
        """Test updating a webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 1,
                "url": "https://example.com/hook-updated",
            }

            result = client.update_webhook(
                hook_id=1,
                url="https://example.com/hook-updated",
            )

            assert result["url"] == "https://example.com/hook-updated"

    @pytest.mark.asyncio
    async def test_delete_webhook(self, client):
        """Test deleting a webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None  # 204 No Content

            result = client.delete_webhook(1)

            assert result is None


class TestAsyncMethods:
    """Tests for async method variants."""

    @pytest.mark.asyncio
    async def test_create_mr_async(self, client):
        """Test async variant of create_mr."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "iid": 123,
                "title": "Test MR",
            }

            result = await client.create_mr_async(
                source_branch="feature",
                target_branch="main",
                title="Test MR",
            )

            assert result["iid"] == 123

    @pytest.mark.asyncio
    async def test_list_branches_async(self, client):
        """Test async variant of list_branches."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = [
                {"name": "main"},
            ]

            result = await client.list_branches_async()

            assert len(result) == 1


class TestEncoding:
    """Tests for URL encoding."""

    def test_encode_project_path_simple(self):
        """Test encoding simple project path."""
        result = encode_project_path("namespace/project")
        assert result == "namespace%2Fproject"

    def test_encode_project_path_with_dots(self):
        """Test encoding project path with dots."""
        result = encode_project_path("group.name/project")
        assert "group.name%2Fproject" in result or "group%2Ename%2Fproject" in result

    def test_encode_project_path_with_slashes(self):
        """Test encoding project path with nested groups."""
        result = encode_project_path("group/subgroup/project")
        assert result == "group%2Fsubgroup%2Fproject"
