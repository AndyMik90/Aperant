"""
Tests for GitLab File Operations
===================================

Tests for file content retrieval, creation, updating, and deletion.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

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
    )


class TestGetFileContents:
    """Tests for get_file_contents method."""

    @pytest.mark.asyncio
    async def test_get_file_contents_current_version(self, client):
        """Test getting file contents from current HEAD."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_name": "test.py",
                "file_path": "src/test.py",
                "size": 100,
                "encoding": "base64",
                "content": "cHJpbnQoJ2hlbGxvJyk=",  # base64 for "print('hello')"
                "content_sha256": "abc123",
                "ref": "main",
            }

            result = client.get_file_contents("src/test.py")

            assert result["file_name"] == "test.py"
            assert result["encoding"] == "base64"

    @pytest.mark.asyncio
    async def test_get_file_contents_with_ref(self, client):
        """Test getting file contents from specific ref."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_name": "config.json",
                "ref": "develop",
                "content": "eyJjb25maWciOiB0cnVlfQ==",
            }

            result = client.get_file_contents("config.json", ref="develop")

            assert result["ref"] == "develop"

    @pytest.mark.asyncio
    async def test_get_file_contents_async(self, client):
        """Test async variant of get_file_contents."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_name": "test.py",
                "content": "dGVzdA==",
            }

            result = await client.get_file_contents_async("test.py")

            assert result["file_name"] == "test.py"


class TestCreateFile:
    """Tests for create_file method."""

    @pytest.mark.asyncio
    async def test_create_new_file(self, client):
        """Test creating a new file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "new_file.py",
                "branch": "main",
                "commit_id": "abc123",
            }

            result = client.create_file(
                file_path="new_file.py",
                content="print('hello world')",
                commit_message="Add new file",
                branch="main",
            )

            assert result["file_path"] == "new_file.py"

    @pytest.mark.asyncio
    async def test_create_file_with_author(self, client):
        """Test creating a file with author information."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "authored.py",
                "commit_id": "def456",
            }

            result = client.create_file(
                file_path="authored.py",
                content="# Author: John Doe",
                commit_message="Add file",
                branch="main",
                author_name="John Doe",
                author_email="john@example.com",
            )

            assert result["commit_id"] == "def456"

    @pytest.mark.asyncio
    async def test_create_file_async(self, client):
        """Test async variant of create_file."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"file_path": "async.py"}

            result = await client.create_file_async(
                file_path="async.py",
                content="content",
                commit_message="Add",
                branch="main",
            )

            assert result["file_path"] == "async.py"


class TestUpdateFile:
    """Tests for update_file method."""

    @pytest.mark.asyncio
    async def test_update_existing_file(self, client):
        """Test updating an existing file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "existing.py",
                "branch": "main",
                "commit_id": "ghi789",
            }

            result = client.update_file(
                file_path="existing.py",
                content="updated content",
                commit_message="Update file",
                branch="main",
            )

            assert result["commit_id"] == "ghi789"

    @pytest.mark.asyncio
    async def test_update_file_with_author(self, client):
        """Test updating file with author info."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "update.py",
                "commit_id": "jkl012",
            }

            result = client.update_file(
                file_path="update.py",
                content="new content",
                commit_message="Modify file",
                branch="develop",
                author_name="Jane Doe",
                author_email="jane@example.com",
            )

            assert result["commit_id"] == "jkl012"

    @pytest.mark.asyncio
    async def test_update_file_async(self, client):
        """Test async variant of update_file."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"file_path": "update.py"}

            result = await client.update_file_async(
                file_path="update.py",
                content="new content",
                commit_message="Update",
                branch="main",
            )

            assert result["file_path"] == "update.py"


class TestDeleteFile:
    """Tests for delete_file method."""

    @pytest.mark.asyncio
    async def test_delete_file(self, client):
        """Test deleting a file."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "file_path": "old.py",
                "branch": "main",
                "commit_id": "mno345",
            }

            result = client.delete_file(
                file_path="old.py",
                commit_message="Remove old file",
                branch="main",
            )

            assert result["commit_id"] == "mno345"

    @pytest.mark.asyncio
    async def test_delete_file_async(self, client):
        """Test async variant of delete_file."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"file_path": "delete.py"}

            result = await client.delete_file_async(
                file_path="delete.py",
                commit_message="Delete",
                branch="main",
            )

            assert result["file_path"] == "delete.py"


class TestFileOperationErrors:
    """Tests for file operation error handling."""

    @pytest.mark.asyncio
    async def test_get_nonexistent_file(self, client):
        """Test getting a file that doesn't exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 File Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.get_file_contents("nonexistent.py")

    @pytest.mark.asyncio
    async def test_create_file_already_exists(self, client):
        """Test creating a file that already exists."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("400 File already exists")

            with pytest.raises(Exception):  # noqa: B017
                client.create_file(
                    file_path="existing.py",
                    content="content",
                    commit_message="Add",
                    branch="main",
                )

    @pytest.mark.asyncio
    async def test_delete_nonexistent_file(self, client):
        """Test deleting a file that doesn't exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 File Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.delete_file(
                    file_path="nonexistent.py",
                    commit_message="Delete",
                    branch="main",
                )
