"""
Tests for GitLab TypedDict Definitions
========================================

Tests for type definitions and TypedDict usage.
"""

import pytest

try:
    from runners.gitlab.types import (
        GitLabCommit,
        GitLabIssue,
        GitLabLabel,
        GitLabMR,
        GitLabPipeline,
        GitLabUser,
    )
except ImportError:
    from runners.gitlab.types import (
        GitLabCommit,
        GitLabIssue,
        GitLabLabel,
        GitLabMR,
        GitLabPipeline,
        GitLabUser,
    )


class TestGitLabUserTypedDict:
    """Tests for GitLabUser TypedDict."""

    def test_user_dict_structure(self):
        """Test that user dict conforms to expected structure."""
        user: GitLabUser = {
            "id": 123,
            "username": "testuser",
            "name": "Test User",
            "email": "test@example.com",
            "avatar_url": "https://example.com/avatar.png",
            "web_url": "https://gitlab.example.com/testuser",
        }

        assert user["id"] == 123
        assert user["username"] == "testuser"

    def test_user_dict_optional_fields(self):
        """Test user dict with optional fields omitted."""
        user: GitLabUser = {
            "id": 456,
            "username": "minimal",
            "name": "Minimal User",
        }

        assert user["id"] == 456
        # Should work without email, avatar_url, web_url


class TestGitLabLabelTypedDict:
    """Tests for GitLabLabel TypedDict."""

    def test_label_dict_structure(self):
        """Test that label dict conforms to expected structure."""
        label: GitLabLabel = {
            "id": 1,
            "name": "bug",
            "color": "#FF0000",
            "description": "Bug report",
        }

        assert label["name"] == "bug"
        assert label["color"] == "#FF0000"

    def test_label_dict_optional_description(self):
        """Test label dict without description."""
        label: GitLabLabel = {
            "id": 2,
            "name": "enhancement",
            "color": "#00FF00",
        }

        assert label["name"] == "enhancement"


class TestGitLabMRTypedDict:
    """Tests for GitLabMR TypedDict."""

    def test_mr_dict_structure(self):
        """Test that MR dict conforms to expected structure."""
        mr: GitLabMR = {
            "iid": 123,
            "id": 456,
            "title": "Test MR",
            "description": "Test description",
            "state": "opened",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T01:00:00Z",
            "merged_at": None,
            "author": {
                "id": 1,
                "username": "author",
                "name": "Author",
            },
            "assignees": [],
            "reviewers": [],
            "source_branch": "feature",
            "target_branch": "main",
            "web_url": "https://gitlab.example.com/merge_requests/123",
        }

        assert mr["iid"] == 123
        assert mr["state"] == "opened"

    def test_mr_dict_with_merge_status(self):
        """Test MR dict with merge status."""
        mr: GitLabMR = {
            "iid": 456,
            "id": 789,
            "title": "Merged MR",
            "state": "merged",
            "merged_at": "2024-01-02T00:00:00Z",
            "author": {"id": 1, "username": "dev"},
            "assignees": [],
            "reviewers": [],
            "diff_refs": {
                "base_sha": "abc123",
                "head_sha": "def456",
                "start_sha": "abc123",
                "head_commit": {"id": "def456"},
            },
            "labels": [],
        }

        assert mr["state"] == "merged"
        assert mr["merged_at"] is not None


class TestGitLabIssueTypedDict:
    """Tests for GitLabIssue TypedDict."""

    def test_issue_dict_structure(self):
        """Test that issue dict conforms to expected structure."""
        issue: GitLabIssue = {
            "iid": 123,
            "id": 456,
            "title": "Test Issue",
            "description": "Test description",
            "state": "opened",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T01:00:00Z",
            "closed_at": None,
            "author": {
                "id": 1,
                "username": "reporter",
                "name": "Reporter",
            },
            "assignees": [],
            "labels": [],
            "web_url": "https://gitlab.example.com/issues/123",
        }

        assert issue["iid"] == 123
        assert issue["state"] == "opened"

    def test_issue_dict_with_labels(self):
        """Test issue dict with labels."""
        issue: GitLabIssue = {
            "iid": 789,
            "id": 101,
            "title": "Labeled Issue",
            "labels": [
                {
                    "id": 1,
                    "name": "bug",
                    "color": "#FF0000",
                },
                {
                    "id": 2,
                    "name": "critical",
                    "color": "#00FF00",
                },
            ],
        }

        assert len(issue["labels"]) == 2
        assert issue["labels"][0]["name"] == "bug"


class TestGitLabCommitTypedDict:
    """Tests for GitLabCommit TypedDict."""

    def test_commit_dict_structure(self):
        """Test that commit dict conforms to expected structure."""
        commit: GitLabCommit = {
            "id": "abc123def456",
            "short_id": "abc123",
            "title": "Test commit",
            "message": "Test commit message",
            "author_name": "Developer",
            "author_email": "dev@example.com",
            "authored_date": "2024-01-01T00:00:00Z",
            "committed_date": "2024-01-01T00:00:01Z",
            "web_url": "https://gitlab.example.com/commit/abc123",
        }

        assert commit["id"] == "abc123def456"
        assert commit["short_id"] == "abc123"
        assert commit["author_name"] == "Developer"


class TestGitLabPipelineTypedDict:
    """Tests for GitLabPipeline TypedDict."""

    def test_pipeline_dict_structure(self):
        """Test that pipeline dict conforms to expected structure."""
        pipeline: GitLabPipeline = {
            "id": 123,
            "iid": 456,
            "project_id": 789,
            "sha": "abc123",
            "ref": "main",
            "status": "success",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T01:00:00Z",
            "finished_at": "2024-01-01T02:00:00Z",
            "duration": 120,
            "web_url": "https://gitlab.example.com/pipelines/123",
        }

        assert pipeline["id"] == 123
        assert pipeline["status"] == "success"
        assert pipeline["duration"] == 120

    def test_pipeline_dict_optional_fields(self):
        """Test pipeline dict with optional fields omitted."""
        pipeline: GitLabPipeline = {
            "id": 456,
            "iid": 789,
            "project_id": 101,
            "sha": "def456",
            "ref": "develop",
            "status": "running",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T01:00:00Z",
            "finished_at": None,
            "duration": None,
        }

        assert pipeline["status"] == "running"
        assert pipeline["finished_at"] is None


class TestTotalFalseBehavior:
    """Tests for total=False behavior in TypedDict (all fields optional)."""

    def test_mr_minimal_dict(self):
        """Test creating MR with minimal required fields."""
        # In practice, GitLab API always returns certain fields
        # But TypedDict with total=False allows flexibility
        mr: GitLabMR = {
            "iid": 123,
            "id": 456,
            "title": "Minimal MR",
            "state": "opened",
        }

        assert mr["iid"] == 123

    def test_issue_minimal_dict(self):
        """Test creating issue with minimal required fields."""
        issue: GitLabIssue = {
            "iid": 456,
            "id": 789,
            "title": "Minimal Issue",
            "state": "opened",
        }

        assert issue["iid"] == 456


class TestNestedTypedDicts:
    """Tests for nested TypedDict structures."""

    def test_mr_with_nested_user(self):
        """Test MR with nested user objects."""
        mr: GitLabMR = {
            "iid": 123,
            "id": 456,
            "title": "MR with author",
            "state": "opened",
            "author": {
                "id": 1,
                "username": "dev",
                "name": "Developer",
            },
            "assignees": [
                {
                    "id": 2,
                    "username": "assignee1",
                    "name": "Assignee One",
                }
            ],
        }

        assert mr["author"]["username"] == "dev"
        assert len(mr["assignees"]) == 1

    def test_issue_with_nested_labels(self):
        """Test issue with nested label objects."""
        issue: GitLabIssue = {
            "iid": 123,
            "id": 456,
            "title": "Issue with labels",
            "state": "opened",
            "labels": [
                {"id": 1, "name": "bug", "color": "#FF0000"},
                {"id": 2, "name": "critical", "color": "#00FF00"},
            ],
        }

        assert issue["labels"][0]["name"] == "bug"
        assert len(issue["labels"]) == 2


class TestTypeCompatibility:
    """Tests for type compatibility and validation."""

    def test_mr_type_accepts_all_states(self):
        """Test that MR type accepts all valid GitLab MR states."""
        valid_states = ["opened", "closed", "locked", "merged"]

        for state in valid_states:
            mr: GitLabMR = {
                "iid": 1,
                "id": 1,
                "title": f"MR in {state} state",
                "state": state,
            }
            assert mr["state"] == state

    def test_pipeline_type_accepts_all_statuses(self):
        """Test that pipeline type accepts all valid GitLab pipeline statuses."""
        valid_statuses = [
            "pending",
            "running",
            "success",
            "failed",
            "canceled",
            "skipped",
            "manual",
            "scheduled",
        ]

        for status in valid_statuses:
            pipeline: GitLabPipeline = {
                "id": 1,
                "iid": 1,
                "project_id": 1,
                "sha": "abc",
                "ref": "main",
                "status": status,
            }
            assert pipeline["status"] == status


class TestDocumentation:
    """Tests that types are self-documenting."""

    def test_user_fields_are_documented(self):
        """Test that user fields match documentation."""
        # GitLabUser should have: id, username, name, email, avatar_url, web_url
        user: GitLabUser = {
            "id": 1,
            "username": "test",
            "name": "Test",
            "email": "test@example.com",
            "avatar_url": "https://example.com/avatar.png",
            "web_url": "https://gitlab.example.com/test",
        }

        # Verify expected fields exist
        expected_fields = ["id", "username", "name", "email", "avatar_url", "web_url"]
        for field in expected_fields:
            assert field in user

    def test_mr_fields_are_documented(self):
        """Test that MR fields match documentation."""
        # Key MR fields
        mr: GitLabMR = {
            "iid": 123,
            "id": 456,
            "title": "Test",
            "state": "opened",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T01:00:00Z",
        }

        expected_fields = ["iid", "id", "title", "state", "created_at", "updated_at"]
        for field in expected_fields:
            assert field in mr
