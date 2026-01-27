"""
Tests for GitLab Webhook Operations
======================================

Tests for webhook listing, creation, updating, and deletion.
"""

from unittest.mock import patch

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
def sample_webhooks():
    """Sample webhook data."""
    return [
        {
            "id": 1,
            "url": "https://example.com/webhook",
            "project_id": 123,
            "push_events": True,
            "issues_events": False,
            "merge_requests_events": True,
            "wiki_page_events": False,
            "repository_update_events": False,
            "tag_push_events": False,
            "note_events": False,
            "confidential_note_events": False,
            "job_events": False,
            "pipeline_events": False,
            "deployment_events": False,
            "release_events": False,
        },
        {
            "id": 2,
            "url": "https://hooks.example.com/another",
            "project_id": 123,
            "push_events": False,
            "issues_events": True,
            "merge_requests_events": True,
        },
    ]


class TestListWebhooks:
    """Tests for list_webhooks method."""

    def test_list_all_webhooks(self, client, sample_webhooks):
        """Test listing all webhooks."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_webhooks

            result = client.list_webhooks()

            assert len(result) == 2
            assert result[0]["id"] == 1
            assert result[0]["url"] == "https://example.com/webhook"

    def test_list_webhooks_empty(self, client):
        """Test listing webhooks when none exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = []

            result = client.list_webhooks()

            assert result == []

    @pytest.mark.asyncio
    async def test_list_webhooks_async(self, client, sample_webhooks):
        """Test async variant of list_webhooks."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_webhooks

            result = await client.list_webhooks_async()

            assert len(result) == 2


class TestGetWebhook:
    """Tests for get_webhook method."""

    def test_get_existing_webhook(self, client, sample_webhooks):
        """Test getting an existing webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_webhooks[0]

            result = client.get_webhook(1)

            assert result["id"] == 1
            assert result["url"] == "https://example.com/webhook"

    @pytest.mark.asyncio
    async def test_get_webhook_async(self, client, sample_webhooks):
        """Test async variant of get_webhook."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = sample_webhooks[0]

            result = await client.get_webhook_async(1)

            assert result["id"] == 1

    def test_get_nonexistent_webhook(self, client):
        """Test getting a webhook that doesn't exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.get_webhook(999)


class TestCreateWebhook:
    """Tests for create_webhook method."""

    def test_create_webhook_basic(self, client):
        """Test creating a webhook with basic settings."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 3,
                "url": "https://example.com/new-hook",
            }

            result = client.create_webhook(
                url="https://example.com/new-hook",
            )

            assert result["id"] == 3
            assert result["url"] == "https://example.com/new-hook"

    def test_create_webhook_with_events(self, client):
        """Test creating a webhook with specific events."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 4,
                "url": "https://example.com/push-hook",
                "push_events": True,
                "issues_events": True,
            }

            result = client.create_webhook(
                url="https://example.com/push-hook",
                push_events=True,
                issues_events=True,
            )

            assert result["push_events"] is True

    def test_create_webhook_with_all_events(self, client):
        """Test creating a webhook that listens to all events."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"id": 5}

            result = client.create_webhook(
                url="https://example.com/all-events",
                push_events=True,
                merge_request_events=True,
                issues_events=True,
                note_events=True,
                job_events=True,
                pipeline_events=True,
                wiki_page_events=True,
            )

            assert result["id"] == 5

    @pytest.mark.asyncio
    async def test_create_webhook_async(self, client):
        """Test async variant of create_webhook."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"id": 6}

            result = await client.create_webhook_async(
                url="https://example.com/async-hook",
            )

            assert result["id"] == 6


class TestUpdateWebhook:
    """Tests for update_webhook method."""

    def test_update_webhook_url(self, client):
        """Test updating webhook URL."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 1,
                "url": "https://example.com/updated-url",
            }

            result = client.update_webhook(
                hook_id=1,
                url="https://example.com/updated-url",
            )

            assert result["url"] == "https://example.com/updated-url"

    def test_update_webhook_events(self, client):
        """Test updating webhook events."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {
                "id": 1,
                "push_events": False,  # Disabled
                "issues_events": True,  # Enabled
            }

            result = client.update_webhook(
                hook_id=1,
                push_events=False,
                issues_events=True,
            )

            assert result["push_events"] is False

    @pytest.mark.asyncio
    async def test_update_webhook_async(self, client):
        """Test async variant of update_webhook."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = {"id": 1, "url": "new"}

            result = await client.update_webhook_async(
                hook_id=1,
                url="new",
            )

            assert result["url"] == "new"


class TestDeleteWebhook:
    """Tests for delete_webhook method."""

    def test_delete_webhook(self, client):
        """Test deleting a webhook."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None  # 204 No Content

            result = client.delete_webhook(1)

            # Should not raise on success
            assert result is None

    @pytest.mark.asyncio
    async def test_delete_webhook_async(self, client):
        """Test async variant of delete_webhook."""
        # Patch _fetch instead of _fetch_async since _fetch_async calls _fetch
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.return_value = None

            result = await client.delete_webhook_async(2)

            assert result is None


class TestWebhookErrors:
    """Tests for webhook error handling."""

    def test_get_invalid_webhook_id(self, client):
        """Test getting webhook with invalid ID."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.get_webhook(0)

    def test_create_webhook_invalid_url(self, client):
        """Test creating webhook with invalid URL."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("400 Invalid URL")

            with pytest.raises(Exception):  # noqa: B017
                client.create_webhook(url="not-a-url")

    def test_delete_nonexistent_webhook(self, client):
        """Test deleting webhook that doesn't exist."""
        with patch.object(client, "_fetch") as mock_fetch:
            mock_fetch.side_effect = Exception("404 Not Found")

            with pytest.raises(Exception):  # noqa: B017
                client.delete_webhook(999)
