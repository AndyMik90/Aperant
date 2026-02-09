"""
Git Provider Protocol
=====================

Defines the abstract interface that all git hosting providers must implement.
Enables support for GitHub, GitLab, Bitbucket, and other providers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Protocol, runtime_checkable


class ProviderType(str, Enum):
    """Supported git hosting providers."""

    GITHUB = "github"
    GITLAB = "gitlab"
    BITBUCKET = "bitbucket"
    GITEA = "gitea"
    AZURE_DEVOPS = "azure_devops"


# ============================================================================
# DATA MODELS
# ============================================================================


@dataclass
class PRData:
    """
    Pull/Merge Request data structure.

    Provider-agnostic representation of a pull request.
    """

    number: int
    title: str
    body: str
    author: str
    state: str  # open, closed, merged
    source_branch: str
    target_branch: str
    additions: int
    deletions: int
    changed_files: int
    files: list[dict[str, Any]]
    diff: str
    url: str
    created_at: datetime
    updated_at: datetime
    labels: list[str] = field(default_factory=list)
    reviewers: list[str] = field(default_factory=list)
    is_draft: bool = False
    mergeable: bool = True
    provider: ProviderType = ProviderType.GITHUB

    # Provider-specific raw data (for debugging)
    raw_data: dict[str, Any] = field(default_factory=dict)


@dataclass
class IssueData:
    """
    Issue/Ticket data structure.

    Provider-agnostic representation of an issue.
    """

    number: int
    title: str
    body: str
    author: str
    state: str  # open, closed
    labels: list[str]
    created_at: datetime
    updated_at: datetime
    url: str
    assignees: list[str] = field(default_factory=list)
    milestone: str | None = None
    provider: ProviderType = ProviderType.GITHUB

    # Provider-specific raw data
    raw_data: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReviewFinding:
    """
    Individual finding in a code review.
    """

    id: str
    severity: str  # critical, high, medium, low, info
    category: str  # security, bug, performance, style, etc.
    title: str
    description: str
    file: str | None = None
    line: int | None = None
    end_line: int | None = None
    suggested_fix: str | None = None
    confidence: float = 0.8  # P3-4: Confidence scoring
    evidence: list[str] = field(default_factory=list)
    fixable: bool = False


@dataclass
class ReviewData:
    """
    Code review data structure.

    Provider-agnostic representation of a review.
    """

    pr_number: int
    event: str  # approve, request_changes, comment
    body: str
    findings: list[ReviewFinding] = field(default_factory=list)
    inline_comments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class IssueFilters:
    """
    Filters for listing issues.
    """

    state: str = "open"
    labels: list[str] = field(default_factory=list)
    author: str | None = None
    assignee: str | None = None
    since: datetime | None = None
    limit: int = 100
    include_prs: bool = False


@dataclass
class PRFilters:
    """
    Filters for listing pull requests.
    """

    state: str = "open"
    labels: list[str] = field(default_factory=list)
    author: str | None = None
    base_branch: str | None = None
    head_branch: str | None = None
    since: datetime | None = None
    limit: int = 100


@dataclass
class LabelData:
    """
    Label data structure.
    """

    name: str
    color: str
    description: str = ""


# ============================================================================
# PROVIDER PROTOCOL
# ============================================================================


@runtime_checkable
class GitProvider(Protocol):
    """
    Abstract protocol for git hosting providers.

    All provider implementations must implement these methods.
    This enables the system to work with GitHub, GitLab, Bitbucket, etc.
    """

    @property
    def provider_type(self) -> ProviderType:
        """Get the provider type."""

    @property
    def repo(self) -> str:
        """Get the repository in owner/repo format."""

    # -------------------------------------------------------------------------
    # Pull Request Operations
    # -------------------------------------------------------------------------

    async def fetch_pr(self, number: int) -> PRData:
        """
        Fetch a pull request by number.

        Args:
            number: PR/MR number

        Returns:
            PRData with full PR details including diff
        """
        ...

    async def fetch_prs(self, filters: PRFilters | None = None) -> list[PRData]:
        """
        Fetch pull requests with optional filters.

        Args:
            filters: Optional filters (state, labels, etc.)

        Returns:
            List of PRData
        """
        ...

    async def fetch_pr_diff(self, number: int) -> str:
        """
        Fetch the diff for a pull request.

        Args:
            number: PR number

        Returns:
            Unified diff string
        """
        ...

    async def post_review(
        self,
        pr_number: int,
        review: ReviewData,
    ) -> int:
        """
        Post a review to a pull request.

        Args:
            pr_number: PR number
            review: Review data with findings and comments

        Returns:
            Review ID
        """
        ...

    async def merge_pr(
        self,
        pr_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
    ) -> bool:
        """
        Merge a pull request.

        Args:
            pr_number: PR number
            merge_method: merge, squash, or rebase
            commit_title: Optional commit title

        Returns:
            True if merged successfully
        """
        ...

    async def close_pr(
        self,
        pr_number: int,
        comment: str | None = None,
    ) -> bool:
        """
        Close a pull request without merging.

        Args:
            pr_number: PR number
            comment: Optional closing comment

        Returns:
            True if closed successfully
        """
        ...

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """
        Fetch an issue by number.

        Args:
            number: Issue number

        Returns:
            IssueData with full issue details
        """
        ...

    async def fetch_issues(
        self, filters: IssueFilters | None = None
    ) -> list[IssueData]:
        """
        Fetch issues with optional filters.

        Args:
            filters: Optional filters

        Returns:
            List of IssueData
        """
        ...

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """
        Create a new issue.

        Args:
            title: Issue title
            body: Issue body
            labels: Optional labels
            assignees: Optional assignees

        Returns:
            Created IssueData
        """
        ...

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """
        Close an issue.

        Args:
            number: Issue number
            comment: Optional closing comment

        Returns:
            True if closed successfully
        """
        ...

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """
        Add a comment to an issue or PR.

        Args:
            issue_or_pr_number: Issue/PR number
            body: Comment body

        Returns:
            Comment ID
        """
        ...

    # -------------------------------------------------------------------------
    # Label Operations
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """
        Apply labels to an issue or PR.

        Args:
            issue_or_pr_number: Issue/PR number
            labels: Labels to apply
        """
        ...

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """
        Remove labels from an issue or PR.

        Args:
            issue_or_pr_number: Issue/PR number
            labels: Labels to remove
        """
        ...

    async def create_label(
        self,
        label: LabelData,
    ) -> None:
        """
        Create a label in the repository.

        Args:
            label: Label data
        """
        ...

    async def list_labels(self) -> list[LabelData]:
        """
        List all labels in the repository.

        Returns:
            List of LabelData
        """
        ...

    # -------------------------------------------------------------------------
    # Repository Operations
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """
        Get repository information.

        Returns:
            Repository metadata
        """
        ...

    async def get_default_branch(self) -> str:
        """
        Get the default branch name.

        Returns:
            Default branch name (e.g., "main", "master")
        """

    async def check_permissions(self, username: str) -> str:
        """
        Check a user's permission level on the repository.

        Args:
            username: GitHub/GitLab username

        Returns:
            Permission level (admin, write, read, none)
        """

    # -------------------------------------------------------------------------
    # API Operations (Low-level)
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """
        Make a GET request to the provider API.

        Args:
            endpoint: API endpoint
            params: Query parameters

        Returns:
            API response data
        """

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """
        Make a POST request to the provider API.

        Args:
            endpoint: API endpoint
            data: Request body

        Returns:
            API response data
        """
