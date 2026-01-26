"""
GitLab Provider Tests
=====================

Tests for GitLabProvider implementation of the GitProvider protocol.
"""

import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest
from __tests__.fixtures.gitlab import (
    MOCK_GITLAB_CONFIG,
    mock_issue_data,
    mock_mr_data,
    mock_pipeline_data,
)

# Mock ProviderType enum since GitHub runners aren't available in this branch
# Note: GitLabProvider defines its own ProviderType when GitHub runners aren't available,
# so we just use the string value for comparison
GITLAB_PROVIDER_VALUE = "gitlab"  # GitHub protocol uses lowercase

# Tests for GitLabProvider


class TestGitLabProvider:
    """Test GitLabProvider implements GitProvider protocol correctly."""

    @pytest.fixture
    def provider(self, tmp_path):
        """Create a GitLabProvider instance for testing."""
        from runners.gitlab.providers.gitlab_provider import GitLabProvider

        with patch(
            "runners.gitlab.providers.gitlab_provider.GitLabClient"
        ) as mock_client:
            provider = GitLabProvider(
                _repo="group/project",
                _token="test-token",
                _instance_url="https://gitlab.example.com",
                _project_dir=tmp_path,
                _glab_client=mock_client.return_value,
            )
            return provider

    def test_provider_type_property(self, provider):
        """Test provider type is GitLab."""
        # Compare the value since ProviderType may be defined in different modules
        assert provider.provider_type.value == GITLAB_PROVIDER_VALUE

    def test_repo_property(self, provider):
        """Test repo property returns the repository."""
        assert provider.repo == "group/project"

    def test_fetch_pr(self, provider):
        """Test fetching a single MR."""
        # Mock client responses
        provider._glab_client.get_mr.return_value = mock_mr_data()
        provider._glab_client.get_mr_changes.return_value = {
            "changes": [
                {
                    "diff": "@@ -0,0 +1,10 @@\n+new line",
                    "new_path": "test.py",
                    "old_path": "test.py",
                }
            ]
        }

        # Fetch MR
        pr = await_if_needed(provider.fetch_pr(123))

        assert pr.number == 123
        assert pr.title == "Add user authentication feature"
        assert pr.author == "john_doe"
        assert pr.state == "opened"
        assert pr.source_branch == "feature/oauth-auth"
        assert pr.target_branch == "main"
        assert pr.provider.name == "GITLAB"

    def test_fetch_prs_with_filters(self, provider):
        """Test fetching multiple MRs with filters."""
        provider._glab_client._fetch.return_value = [
            mock_mr_data(iid=100),
            mock_mr_data(iid=101, state="closed"),
        ]

        prs = await_if_needed(provider.fetch_prs())

        assert len(prs) == 2

    def test_fetch_pr_diff(self, provider):
        """Test fetching MR diff."""
        expected_diff = "diff content here"
        provider._glab_client.get_mr_diff.return_value = expected_diff

        diff = await_if_needed(provider.fetch_pr_diff(123))

        assert diff == expected_diff

    def test_fetch_issue(self, provider):
        """Test fetching a single issue."""
        from __tests__.fixtures.gitlab import SAMPLE_ISSUE_DATA

        provider._glab_client._fetch.return_value = SAMPLE_ISSUE_DATA

        issue = await_if_needed(provider.fetch_issue(42))

        assert issue.number == 42
        assert issue.title == "Bug: Login button not working"
        assert issue.author == "jane_smith"
        assert issue.state == "opened"

    def test_fetch_issues_with_filters(self, provider):
        """Test fetching issues with filters."""
        provider._glab_client._fetch.return_value = [
            mock_issue_data(iid=10),
            mock_issue_data(iid=11),
        ]

        issues = await_if_needed(provider.fetch_issues())

        assert len(issues) == 2

    def test_post_review(self, provider):
        """Test posting a review to an MR."""
        # Import ReviewData from GitHub protocol (which GitLabProvider uses)
        from runners.github.providers.protocol import ReviewData

        provider._glab_client.post_mr_note.return_value = {"id": 999}
        provider._glab_client._fetch.return_value = {}  # approve MR response

        review = ReviewData(
            pr_number=123,
            body="LGTM with minor suggestions",
            event="approve",
        )

        note_id = await_if_needed(provider.post_review(123, review))

        assert note_id == 999
        provider._glab_client.post_mr_note.assert_called_once()

    def test_merge_pr(self, provider):
        """Test merging an MR."""
        provider._glab_client.merge_mr.return_value = {"status": "success"}

        result = await_if_needed(provider.merge_pr(123, merge_method="merge"))

        assert result is True

    def test_close_pr(self, provider):
        """Test closing an MR."""
        provider._glab_client._fetch.return_value = {}

        result = await_if_needed(
            provider.close_pr(123, comment="Closing as not needed")
        )

        assert result is True

    def test_create_label(self, provider):
        """Test creating a label."""
        # Use LabelData from the provider's fallback protocol
        from runners.gitlab.providers.gitlab_provider import (
            LabelData as GitLabLabelData,
        )

        # Create an alias for readability
        LabelData = GitLabLabelData

        provider._glab_client._fetch.return_value = {}

        label = LabelData(
            name="bug",
            color="#ff0000",
            description="Bug report",
        )

        await_if_needed(provider.create_label(label))

        # Verify call was made (checking that it didn't raise)
        provider._glab_client._fetch.assert_called()

    def test_list_labels(self, provider):
        """Test listing labels."""
        provider._glab_client._fetch.return_value = [
            {"name": "bug", "color": "ff0000", "description": "Bug"},
            {"name": "feature", "color": "00ff00", "description": "Feature"},
        ]

        labels = await_if_needed(provider.list_labels())

        assert len(labels) == 2
        assert labels[0].name == "bug"
        assert labels[0].color == "#ff0000"

    def test_get_repository_info(self, provider):
        """Test getting repository info."""
        provider._glab_client._fetch.return_value = {
            "name": "project",
            "path_with_namespace": "group/project",
            "default_branch": "main",
        }

        info = await_if_needed(provider.get_repository_info())

        assert info["default_branch"] == "main"

    def test_get_default_branch(self, provider):
        """Test getting default branch."""
        provider._glab_client._fetch.return_value = {
            "default_branch": "main",
        }

        branch = await_if_needed(provider.get_default_branch())

        assert branch == "main"

    def test_api_get(self, provider):
        """Test low-level API GET."""
        provider._glab_client._fetch.return_value = {"data": "value"}

        result = await_if_needed(provider.api_get("/projects/1"))

        assert result["data"] == "value"

    def test_api_post(self, provider):
        """Test low-level API POST."""
        provider._glab_client._fetch.return_value = {"id": 123}

        result = await_if_needed(
            provider.api_post("/projects/1/notes", {"body": "test"})
        )

        assert result["id"] == 123


def await_if_needed(coro_or_result):
    """Helper to await async functions if needed."""
    import asyncio

    if hasattr(coro_or_result, "__await__"):
        return asyncio.run(coro_or_result)
    return coro_or_result
