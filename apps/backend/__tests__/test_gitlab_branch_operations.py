"""
Tests for GitLab Branch Operations
====================================

Tests for branch listing, creation, deletion, and comparison.
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


@pytest.fixture
def sample_branches():
    """Sample branch data."""
    return [
        {
            "name": "main",
            "merged": False,
            "protected": True,
            "default": True,
            "developers_can_push": False,
            "developers_can_merge": False,
            "commit": {
                "id": "abc123def456",
                "short_id": "abc123d",
                "title": "Stable branch",
            },
            "web_url": "https://gitlab.example.com/namespace/test-project/-/tree/main",
        },
        {
            "name": "develop",
            "merged": False,
            "protected": False,
            "default": False,
            "developers_can_push": True,
            "developers_can_merge": True,
            "commit": {
                "id": "def456abc123",
                "short_id": "def456a",
                "title": "Development branch",
            },
            "web_url": "https://gitlab.example.com/namespace/test-project/-/tree/develop",
        },
    ]


class TestListBranches:
    """Tests for list_branches method."""

    @pytest.mark.asyncio
    async def test_list_all_branches(self, client, sample_branches):
        """Test listing all branches."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_branches

            result = client.list_branches()

            assert len(result) == 2
            assert result[0]["name"] == "main"
            assert result[1]["name"] == "develop"

    @pytest.mark.asyncio
    async def test_list_branches_with_search(self, client, sample_branches):
        """Test listing branches with search filter."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = [sample_branches[0]]  # Only main

            result = client.list_branches(search="main")

            assert len(result) == 1
            assert result[0]["name"] == "main"

    @pytest.mark.asyncio
    async def test_list_branches_async(self, client, sample_branches):
        """Test async variant of list_branches."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_branches

            result = await client.list_branches_async()

            assert len(result) == 2


class TestGetBranch:
    """Tests for get_branch method."""

    @pytest.mark.asyncio
    async def test_get_existing_branch(self, client, sample_branches):
        """Test getting an existing branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_branches[0]

            result = client.get_branch("main")

            assert result["name"] == "main"
            assert result["protected"] is True
            assert result["commit"]["id"] == "abc123def456"

    @pytest.mark.asyncio
    async def test_get_branch_async(self, client, sample_branches):
        """Test async variant of get_branch."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_branches[0]

            result = await client.get_branch_async("main")

            assert result["name"] == "main"

    @pytest.mark.asyncio
    async def test_get_nonexistent_branch(self, client):
        """Test getting a branch that doesn't exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.get_branch("nonexistent")


class TestCreateBranch:
    """Tests for create_branch method."""

    @pytest.mark.asyncio
    async def test_create_branch_from_ref(self, client):
        """Test creating a branch from another branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "name": "feature-branch",
                "commit": {"id": "new123"},
                "protected": False,
            }

            result = client.create_branch(
                branch_name="feature-branch",
                ref="main",
            )

            assert result["name"] == "feature-branch"

    @pytest.mark.asyncio
    async def test_create_branch_from_commit(self, client):
        """Test creating a branch from a commit SHA."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "name": "fix-branch",
                "commit": {"id": "fix123"},
            }

            result = client.create_branch(
                branch_name="fix-branch",
                ref="abc123def",
            )

            assert result["name"] == "fix-branch"

    @pytest.mark.asyncio
    async def test_create_branch_async(self, client):
        """Test async variant of create_branch."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"name": "feature", "commit": {}}

            result = await client.create_branch_async("feature", "main")

            assert result["name"] == "feature"


class TestDeleteBranch:
    """Tests for delete_branch method."""

    @pytest.mark.asyncio
    async def test_delete_existing_branch(self, client):
        """Test deleting an existing branch."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None  # 204 No Content

            result = client.delete_branch("feature-branch")

            # Should not raise on success
            assert result is None

    @pytest.mark.asyncio
    async def test_delete_branch_async(self, client):
        """Test async variant of delete_branch."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None

            result = await client.delete_branch_async("old-branch")

            assert result is None


class TestCompareBranches:
    """Tests for compare_branches method."""

    @pytest.mark.asyncio
    async def test_compare_branches_basic(self, client):
        """Test comparing two branches."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "diff": "@@ -1,1 +1,1 @@",
                "commits": [{"id": "abc123"}],
                "compare_same_ref": False,
            }

            result = client.compare_branches("main", "feature")

            assert "diff" in result
            assert result["compare_same_ref"] is False

    @pytest.mark.asyncio
    async def test_compare_branches_async(self, client):
        """Test async variant of compare_branches."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "diff": "@@ -1,1 +1,1 @@",
            }

            result = await client.compare_branches_async("main", "feature")

            assert "diff" in result

    @pytest.mark.asyncio
    async def test_compare_same_branch(self, client):
        """Test comparing a branch to itself."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "diff": "",
                "compare_same_ref": True,
            }

            result = client.compare_branches("main", "main")

            assert result["compare_same_ref"] is True
