"""
Tests for Shared Protocol
=========================

Tests for the shared protocol module used by both GitHub and GitLab runners.
"""

from datetime import datetime, timezone
from typing import Any

import pytest

from runners.shared.protocol import (
    GitProvider,
    IssueData,
    IssueFilters,
    LabelData,
    PRData,
    PRFilters,
    ProviderType,
    ReviewData,
    ReviewFinding,
)


class TestProviderType:
    """Tests for ProviderType enum."""

    def test_github_value(self):
        """Test GitHub provider type value."""
        assert ProviderType.GITHUB.value == "github"

    def test_gitlab_value(self):
        """Test GitLab provider type value."""
        assert ProviderType.GITLAB.value == "gitlab"

    def test_bitbucket_value(self):
        """Test Bitbucket provider type value."""
        assert ProviderType.BITBUCKET.value == "bitbucket"

    def test_gitea_value(self):
        """Test Gitea provider type value."""
        assert ProviderType.GITEA.value == "gitea"

    def test_azure_devops_value(self):
        """Test Azure DevOps provider type value."""
        assert ProviderType.AZURE_DEVOPS.value == "azure_devops"

    def test_from_string(self):
        """Test creating ProviderType from string."""
        assert ProviderType("github") == ProviderType.GITHUB
        assert ProviderType("gitlab") == ProviderType.GITLAB

    def test_all_providers_exist(self):
        """Test that all expected providers exist."""
        providers = list(ProviderType)
        assert len(providers) == 5


class TestPRData:
    """Tests for PRData dataclass."""

    def test_basic_creation(self):
        """Test creating PRData with required fields."""
        now = datetime.now(timezone.utc)
        pr = PRData(
            number=123,
            title="Test PR",
            body="Description",
            author="user",
            state="open",
            source_branch="feature",
            target_branch="main",
            additions=10,
            deletions=5,
            changed_files=2,
            files=[{"path": "test.py"}],
            diff="diff content",
            url="https://github.com/owner/repo/pull/123",
            created_at=now,
            updated_at=now,
        )
        assert pr.number == 123
        assert pr.title == "Test PR"
        assert pr.state == "open"

    def test_default_values(self):
        """Test PRData default values."""
        now = datetime.now(timezone.utc)
        pr = PRData(
            number=1,
            title="",
            body="",
            author="",
            state="open",
            source_branch="",
            target_branch="",
            additions=0,
            deletions=0,
            changed_files=0,
            files=[],
            diff="",
            url="",
            created_at=now,
            updated_at=now,
        )
        assert pr.labels == []
        assert pr.reviewers == []
        assert pr.is_draft is False
        assert pr.mergeable is True
        assert pr.provider == ProviderType.GITHUB
        assert pr.raw_data == {}

    def test_custom_provider(self):
        """Test PRData with custom provider."""
        now = datetime.now(timezone.utc)
        pr = PRData(
            number=1,
            title="",
            body="",
            author="",
            state="open",
            source_branch="",
            target_branch="",
            additions=0,
            deletions=0,
            changed_files=0,
            files=[],
            diff="",
            url="",
            created_at=now,
            updated_at=now,
            provider=ProviderType.GITLAB,
        )
        assert pr.provider == ProviderType.GITLAB

    def test_with_labels_and_reviewers(self):
        """Test PRData with labels and reviewers."""
        now = datetime.now(timezone.utc)
        pr = PRData(
            number=1,
            title="",
            body="",
            author="",
            state="open",
            source_branch="",
            target_branch="",
            additions=0,
            deletions=0,
            changed_files=0,
            files=[],
            diff="",
            url="",
            created_at=now,
            updated_at=now,
            labels=["bug", "enhancement"],
            reviewers=["reviewer1", "reviewer2"],
        )
        assert pr.labels == ["bug", "enhancement"]
        assert pr.reviewers == ["reviewer1", "reviewer2"]


class TestIssueData:
    """Tests for IssueData dataclass."""

    def test_basic_creation(self):
        """Test creating IssueData with required fields."""
        now = datetime.now(timezone.utc)
        issue = IssueData(
            number=456,
            title="Bug report",
            body="Description",
            author="user",
            state="open",
            labels=["bug"],
            created_at=now,
            updated_at=now,
            url="https://github.com/owner/repo/issues/456",
        )
        assert issue.number == 456
        assert issue.title == "Bug report"

    def test_default_values(self):
        """Test IssueData default values."""
        now = datetime.now(timezone.utc)
        issue = IssueData(
            number=1,
            title="",
            body="",
            author="",
            state="open",
            labels=[],
            created_at=now,
            updated_at=now,
            url="",
        )
        assert issue.assignees == []
        assert issue.milestone is None
        assert issue.provider == ProviderType.GITHUB
        assert issue.raw_data == {}

    def test_with_assignees_and_milestone(self):
        """Test IssueData with assignees and milestone."""
        now = datetime.now(timezone.utc)
        issue = IssueData(
            number=1,
            title="",
            body="",
            author="",
            state="open",
            labels=[],
            created_at=now,
            updated_at=now,
            url="",
            assignees=["user1", "user2"],
            milestone="v1.0",
        )
        assert issue.assignees == ["user1", "user2"]
        assert issue.milestone == "v1.0"


class TestReviewFinding:
    """Tests for ReviewFinding dataclass."""

    def test_basic_creation(self):
        """Test creating ReviewFinding with required fields."""
        finding = ReviewFinding(
            id="FIND-001",
            severity="high",
            category="security",
            title="SQL Injection",
            description="Potential SQL injection vulnerability",
        )
        assert finding.id == "FIND-001"
        assert finding.severity == "high"
        assert finding.category == "security"

    def test_default_values(self):
        """Test ReviewFinding default values."""
        finding = ReviewFinding(
            id="",
            severity="",
            category="",
            title="",
            description="",
        )
        assert finding.file is None
        assert finding.line is None
        assert finding.end_line is None
        assert finding.suggested_fix is None
        assert finding.confidence == 0.8
        assert finding.evidence == []
        assert finding.fixable is False

    def test_with_location_and_fix(self):
        """Test ReviewFinding with location and suggested fix."""
        finding = ReviewFinding(
            id="FIND-001",
            severity="medium",
            category="bug",
            title="Null check missing",
            description="Potential null pointer",
            file="src/main.py",
            line=42,
            end_line=45,
            suggested_fix="Add null check",
            confidence=0.9,
            fixable=True,
        )
        assert finding.file == "src/main.py"
        assert finding.line == 42
        assert finding.end_line == 45
        assert finding.suggested_fix == "Add null check"
        assert finding.confidence == 0.9
        assert finding.fixable is True


class TestReviewData:
    """Tests for ReviewData dataclass."""

    def test_basic_creation(self):
        """Test creating ReviewData with required fields."""
        review = ReviewData(
            pr_number=123,
            event="approve",
            body="LGTM!",
        )
        assert review.pr_number == 123
        assert review.event == "approve"
        assert review.body == "LGTM!"

    def test_default_values(self):
        """Test ReviewData default values."""
        review = ReviewData(
            pr_number=1,
            event="comment",
            body="",
        )
        assert review.findings == []
        assert review.inline_comments == []

    def test_with_findings(self):
        """Test ReviewData with findings."""
        finding = ReviewFinding(
            id="FIND-001",
            severity="high",
            category="security",
            title="Issue",
            description="Description",
        )
        review = ReviewData(
            pr_number=1,
            event="request_changes",
            body="Please fix",
            findings=[finding],
        )
        assert len(review.findings) == 1
        assert review.findings[0].id == "FIND-001"


class TestIssueFilters:
    """Tests for IssueFilters dataclass."""

    def test_default_values(self):
        """Test IssueFilters default values."""
        filters = IssueFilters()
        assert filters.state == "open"
        assert filters.labels == []
        assert filters.author is None
        assert filters.assignee is None
        assert filters.since is None
        assert filters.limit == 100
        assert filters.include_prs is False

    def test_custom_values(self):
        """Test IssueFilters with custom values."""
        since = datetime.now(timezone.utc)
        filters = IssueFilters(
            state="closed",
            labels=["bug", "urgent"],
            author="user1",
            assignee="user2",
            since=since,
            limit=50,
            include_prs=True,
        )
        assert filters.state == "closed"
        assert filters.labels == ["bug", "urgent"]
        assert filters.author == "user1"
        assert filters.assignee == "user2"
        assert filters.since == since
        assert filters.limit == 50
        assert filters.include_prs is True


class TestPRFilters:
    """Tests for PRFilters dataclass."""

    def test_default_values(self):
        """Test PRFilters default values."""
        filters = PRFilters()
        assert filters.state == "open"
        assert filters.labels == []
        assert filters.author is None
        assert filters.base_branch is None
        assert filters.head_branch is None
        assert filters.since is None
        assert filters.limit == 100

    def test_custom_values(self):
        """Test PRFilters with custom values."""
        since = datetime.now(timezone.utc)
        filters = PRFilters(
            state="merged",
            labels=["enhancement"],
            author="user1",
            base_branch="main",
            head_branch="feature/new-thing",
            since=since,
            limit=25,
        )
        assert filters.state == "merged"
        assert filters.labels == ["enhancement"]
        assert filters.author == "user1"
        assert filters.base_branch == "main"
        assert filters.head_branch == "feature/new-thing"
        assert filters.since == since
        assert filters.limit == 25


class TestLabelData:
    """Tests for LabelData dataclass."""

    def test_basic_creation(self):
        """Test creating LabelData with required fields."""
        label = LabelData(
            name="bug",
            color="#ff0000",
        )
        assert label.name == "bug"
        assert label.color == "#ff0000"
        assert label.description == ""

    def test_with_description(self):
        """Test LabelData with description."""
        label = LabelData(
            name="enhancement",
            color="#00ff00",
            description="New feature or request",
        )
        assert label.name == "enhancement"
        assert label.description == "New feature or request"


class TestGitProvider:
    """Tests for GitProvider protocol."""

    def test_is_runtime_checkable(self):
        """Test that GitProvider is runtime checkable."""

        class MockProvider:
            @property
            def provider_type(self):
                return ProviderType.GITHUB

            @property
            def repo(self):
                return "owner/repo"

            async def fetch_pr(self, number):
                pass

            async def fetch_prs(self, filters=None):
                return []

            async def fetch_pr_diff(self, number):
                return ""

            async def post_review(self, pr_number, review):
                return 1

            async def merge_pr(self, pr_number, merge_method="merge", commit_title=None):
                return True

            async def close_pr(self, pr_number, comment=None):
                return True

            async def fetch_issue(self, number):
                pass

            async def fetch_issues(self, filters=None):
                return []

            async def create_issue(self, title, body, labels=None, assignees=None):
                pass

            async def close_issue(self, number, comment=None):
                return True

            async def add_comment(self, issue_or_pr_number, body):
                return 1

            async def apply_labels(self, issue_or_pr_number, labels):
                pass

            async def remove_labels(self, issue_or_pr_number, labels):
                pass

            async def create_label(self, label):
                pass

            async def list_labels(self):
                return []

            async def get_repository_info(self):
                return {}

            async def get_default_branch(self):
                return "main"

            async def check_permissions(self, username):
                return "read"

            async def api_get(self, endpoint, params=None):
                return None

            async def api_post(self, endpoint, data=None):
                return None

        provider = MockProvider()
        assert isinstance(provider, GitProvider)

    def test_protocol_has_required_methods(self):
        """Test that protocol defines required methods."""
        # Check that the protocol has the expected methods
        assert hasattr(GitProvider, "provider_type")
        assert hasattr(GitProvider, "repo")
        assert hasattr(GitProvider, "fetch_pr")
        assert hasattr(GitProvider, "fetch_prs")
        assert hasattr(GitProvider, "fetch_pr_diff")
        assert hasattr(GitProvider, "post_review")
        assert hasattr(GitProvider, "merge_pr")
        assert hasattr(GitProvider, "close_pr")
        assert hasattr(GitProvider, "fetch_issue")
        assert hasattr(GitProvider, "fetch_issues")
        assert hasattr(GitProvider, "create_issue")
        assert hasattr(GitProvider, "close_issue")
        assert hasattr(GitProvider, "add_comment")
        assert hasattr(GitProvider, "apply_labels")
        assert hasattr(GitProvider, "remove_labels")
        assert hasattr(GitProvider, "create_label")
        assert hasattr(GitProvider, "list_labels")
        assert hasattr(GitProvider, "get_repository_info")
        assert hasattr(GitProvider, "get_default_branch")
        assert hasattr(GitProvider, "check_permissions")
        assert hasattr(GitProvider, "api_get")
        assert hasattr(GitProvider, "api_post")


class TestDataclassImmutability:
    """Tests for dataclass behavior."""

    def test_prdata_is_mutable(self):
        """Test that PRData fields can be modified."""
        now = datetime.now(timezone.utc)
        pr = PRData(
            number=1,
            title="Original",
            body="",
            author="",
            state="open",
            source_branch="",
            target_branch="",
            additions=0,
            deletions=0,
            changed_files=0,
            files=[],
            diff="",
            url="",
            created_at=now,
            updated_at=now,
        )
        pr.title = "Modified"
        assert pr.title == "Modified"

    def test_issue_filters_is_mutable(self):
        """Test that IssueFilters fields can be modified."""
        filters = IssueFilters()
        filters.state = "closed"
        filters.limit = 50
        assert filters.state == "closed"
        assert filters.limit == 50


class TestProviderTypeComparison:
    """Tests for ProviderType comparison operations."""

    def test_equality(self):
        """Test ProviderType equality."""
        assert ProviderType.GITHUB == ProviderType.GITHUB
        assert ProviderType.GITLAB == ProviderType.GITLAB
        assert ProviderType.GITHUB != ProviderType.GITLAB

    def test_string_comparison(self):
        """Test ProviderType string comparison."""
        assert ProviderType.GITHUB.value == "github"
        assert ProviderType.GITLAB.value == "gitlab"

    def test_hashable(self):
        """Test that ProviderType is hashable."""
        provider_set = {ProviderType.GITHUB, ProviderType.GITLAB, ProviderType.GITHUB}
        assert len(provider_set) == 2

    def test_iterable(self):
        """Test that ProviderType is iterable."""
        providers = list(ProviderType)
        assert ProviderType.GITHUB in providers
        assert ProviderType.GITLAB in providers
